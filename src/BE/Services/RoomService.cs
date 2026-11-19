using System.Security.Cryptography;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services;

public partial class RoomService : IRoomService
{
    public const int MaxPlayers = 2;
    public const int MyRoomsLimit = 20;
    /// <summary>Refusal for a COMPLETED/ABANDONED room; kept distinct from "already started" so FE can end the flow.</summary>
    public const string RoomEndedMessage = "This room has already ended and cannot be reused.";
    public const string RoomEndedLeaveMessage = "This room has already ended.";
    public const string RoomEndedCode = "ROOM_ENDED";
    public const string RoomEndedMessageKey = "room.ended";
    public const string GameAlreadyStartedMessage = "The game has already started.";
    public static readonly TimeSpan DisconnectGracePeriod = RoomRecoveryRules.DisconnectTimeout;

    private readonly MongoDbContext _db;
    private readonly ICaseService _caseService;
    private readonly IGameNotifier _notifier;
    private readonly CaseCatalogPolicy _catalog;

    public const string CaseNotPlayableCode = "CASE_NOT_PLAYABLE";

    private readonly LegacyCaseCatalog? _legacy;
    private readonly IPlayerCosmeticsReader? _cosmetics;
    private readonly ILogger<RoomService>? _logger;

    public RoomService(MongoDbContext db, ICaseService caseService, IGameNotifier notifier, CaseCatalogPolicy? catalog = null,
        LegacyCaseCatalog? legacy = null, IPlayerCosmeticsReader? cosmetics = null, ILogger<RoomService>? logger = null)
    {
        _db = db;
        _caseService = caseService;
        _notifier = notifier;
        _catalog = catalog ?? CaseCatalogPolicy.Open;
        _legacy = legacy;
        _cosmetics = cosmetics;
        _logger = logger;
    }

    /// <summary>The lobby's view of a room. Looks come from the server only; failing to load them must not close a lobby.</summary>
    private async Task<RoomResponse> ToLobbyResponseAsync(GameRoom room, string caseTitle)
    {
        var response = RoomResponse.From(room, caseTitle);
        if (_cosmetics is null) return response;
        try
        {
            var looks = await _cosmetics.GetCosmeticsAsync(response.Players.Select(player => player.UserId).ToList());
            foreach (var player in response.Players)
            {
                if (!looks.TryGetValue(player.UserId, out var look)) continue;
                player.Level = look.Level;
                player.Avatar = look.Avatar;
                player.AvatarUrl = look.AvatarUrl;
                player.FrameDefId = look.FrameDefId;
                player.TitleDefId = look.TitleDefId;
                player.EntranceDefId = look.EntranceDefId;
                player.SkinDefIds = look.SkinDefIds?.ToList() ?? new List<string>();
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger?.LogWarning(exception, "Lobby cosmetics could not be loaded for room {RoomId}.", room.Id);
        }
        return response;
    }

    /// <summary>Rooms of hidden (legacy) cases stay out of every room list; the rooms themselves are untouched.</summary>
    private async Task<FilterDefinition<GameRoom>> WithoutLegacyAsync(FilterDefinition<GameRoom> filter) =>
        _legacy is null ? filter : await _legacy.ExcludeAsync(filter, room => room.CaseId);

    // Người chơi phải xác minh email trước khi tạo/vào phòng. Admin được miễn.
    private async Task EnsureEmailVerifiedAsync(CurrentUser user)
    {
        if (user.Role == UserRole.Admin) return;

        var account = await _db.Users.Find(u => u.Id == user.Id).FirstOrDefaultAsync();
        if (account is null || !account.IsEmailVerified)
        {
            throw ApiException.Forbidden("Vui lòng xác minh email trước khi vào game.");
        }
        // Người mới chọn "Nhập môn" phải chơi xong màn tân thủ trước.
        TutorialRules.EnsureNotRequired(account);
    }

    public async Task<RoomResponse> CreateAsync(CurrentUser user, string caseId, string? visibility = null)
    {
        if (!RoomVisibility.TryNormalize(visibility, out var normalizedVisibility))
        {
            throw ApiException.BadRequest(
                $"Visibility must be {RoomVisibility.Public} or {RoomVisibility.Private}.",
                new Dictionary<string, string[]> { ["visibility"] = [$"Use {RoomVisibility.Public} or {RoomVisibility.Private}."] });
        }
        await EnsureEmailVerifiedAsync(user);

        var gameCase = await _caseService.GetCaseAsync(caseId);
        if (gameCase.Status != CaseStatus.Published)
        {
            throw ApiException.BadRequest("Rooms can only be created from published cases.");
        }
        if (!_catalog.IsPlayable(gameCase))
        {
            throw ApiException.Unprocessable("This case is not available to play. Pick one of the pixel cases.",
                new ApiErrorDetails(CaseNotPlayableCode, "case.notPlayable"));
        }

        var room = new GameRoom
        {
            CaseId = gameCase.CaseId,
            HostUserId = user.Id,
            Status = RoomStatus.Waiting,
            Visibility = normalizedVisibility,
            Players = new List<RoomPlayer>
            {
                new() { UserId = user.Id, Username = user.FullName }
            }
        };

        await InsertWithRoomCodeAsync(room);
        return await ToLobbyResponseAsync(room, gameCase.Title);
    }

    /// <summary>Room codes are random; retry on the rare unique-index collision.</summary>
    private async Task InsertWithRoomCodeAsync(GameRoom room)
    {
        for (var attempt = 0; ; attempt++)
        {
            room.RoomCode = GenerateRoomCode();
            try
            {
                await _db.Rooms.InsertOneAsync(room);
                return;
            }
            catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey && attempt < 5)
            {
            }
        }
    }

    public async Task<RoomResponse> JoinAsync(CurrentUser user, string roomCode, string? inviteToken = null)
    {
        await EnsureEmailVerifiedAsync(user);

        var code = roomCode.Trim().ToUpperInvariant();
        var room = await _db.Rooms.Find(r => r.RoomCode == code).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("No room with this code was found.");

        var gameCase = await _caseService.GetCaseAsync(room.CaseId);

        if (room.Players.Any(p => p.UserId == user.Id))
        {
            // Re-joining your own room (e.g. page refresh) is idempotent.
            return await ToLobbyResponseAsync(room, gameCase.Title);
        }

        // A playtest of an unpublished draft: the room code alone lets nobody in (checked before "full" or "started",
        // so a stranger learns nothing about the room).
        var entry = room.Playtest is null ? PlaytestEntry.Allowed : PlaytestRoomRules.Evaluate(room.Playtest, user, inviteToken);
        if (entry == PlaytestEntry.Forbidden) throw PlaytestRoomRules.Forbidden();

        if (room.Status is RoomStatus.InProgress or RoomStatus.Completed)
        {
            throw ApiException.Conflict("This room has already started.");
        }

        if (room.Players.Count >= MaxPlayers)
        {
            throw ApiException.Conflict("This room is already full.");
        }

        var update = Builders<GameRoom>.Update
            .Push(r => r.Players, new RoomPlayer { UserId = user.Id, Username = user.FullName })
            .Inc(r => r.LobbyVersion, 1)
            .Set(r => r.UpdatedAt, DateTime.UtcNow);

        // Guard against two players grabbing the last slot at the same time.
        var joinFilter = Builders<GameRoom>.Filter.And(
            Builders<GameRoom>.Filter.Eq(r => r.Id, room.Id),
            Builders<GameRoom>.Filter.Eq(r => r.Status, RoomStatus.Waiting),
            Builders<GameRoom>.Filter.SizeLt(r => r.Players, MaxPlayers));
        if (entry == PlaytestEntry.ClaimsInvite)
        {
            // The invite is single use: whoever claims it first is the only one it ever lets in.
            joinFilter &= Builders<GameRoom>.Filter.Eq(r => r.Playtest!.InvitedUserId, null);
            update = update.Set(r => r.Playtest!.InvitedUserId, user.Id);
        }
        var result = await _db.Rooms.UpdateOneAsync(joinFilter, update);
        if (result.ModifiedCount == 0)
        {
            if (entry == PlaytestEntry.ClaimsInvite)
            {
                var latest = await RequireRoomAsync(room.Id);
                if (latest.Playtest is { } claimed && PlaytestRoomRules.Evaluate(claimed, user, inviteToken) == PlaytestEntry.Forbidden)
                    throw PlaytestRoomRules.Forbidden();
            }
            throw ApiException.Conflict("This room is already full or has started.");
        }

        var updated = await RequireRoomAsync(room.Id);
        var response = await ToLobbyResponseAsync(updated, gameCase.Title);
        await _notifier.PlayerJoined(room.Id, user.Id, response);
        return response;
    }

    public async Task<RoomResponse> GetAsync(string userId, string roomId)
    {
        var room = await RequireRoomAsync(roomId);
        RequireMember(room, userId);
        var gameCase = await _caseService.GetCaseAsync(room.CaseId);
        return await ToLobbyResponseAsync(room, gameCase.Title);
    }

    public async Task<List<RoomResponse>> GetMineAsync(string userId, CancellationToken cancellationToken = default)
    {
        var filter = Builders<GameRoom>.Filter.ElemMatch(room => room.Players, player => player.UserId == userId)
            & Builders<GameRoom>.Filter.In(room => room.Status, [RoomStatus.Waiting, RoomStatus.Ready, RoomStatus.InProgress]);
        filter = await WithoutLegacyAsync(filter);
        var rooms = await _db.Rooms.Find(filter)
            .SortByDescending(room => room.UpdatedAt)
            .ThenByDescending(room => room.CreatedAt)
            .ThenByDescending(room => room.Id)
            .Limit(MyRoomsLimit)
            // The room list needs lobby metadata only, never the saved investigation or answers.
            .Project(room => new GameRoom
            {
                Id = room.Id, RoomCode = room.RoomCode, CaseId = room.CaseId,
                HostUserId = room.HostUserId, Status = room.Status, Players = room.Players,
                Visibility = room.Visibility, CreatedAt = room.CreatedAt, Playtest = room.Playtest
            })
            .ToListAsync(cancellationToken);
        if (rooms.Count == 0) return [];

        var caseIds = rooms.Select(room => room.CaseId).Distinct().ToArray();
        var titles = await _db.Cases.Find(gameCase => caseIds.Contains(gameCase.CaseId))
            .Project(gameCase => new { gameCase.CaseId, gameCase.Title })
            .ToListAsync(cancellationToken);
        var titlesByCase = titles.ToDictionary(gameCase => gameCase.CaseId, gameCase => gameCase.Title);
        return rooms.Select(room => RoomResponse.From(room,
            titlesByCase.GetValueOrDefault(room.CaseId, room.CaseId))).ToList();
    }

    public async Task<List<PublicRoomResponse>> ListPublicAsync(string userId, PublicRoomQuery query, CancellationToken cancellationToken = default)
    {
        if (!PublicRoomRules.TryParseLanguage(query.Language, out var language))
        {
            throw ApiException.BadRequest("Language must be vi, en or ALL.",
                new Dictionary<string, string[]> { ["language"] = ["Use vi, en or ALL."] });
        }
        var search = query.Q?.Trim();
        if (search is { Length: > PublicRoomRules.MaxQueryLength })
        {
            throw ApiException.BadRequest("The search text is too long.",
                new Dictionary<string, string[]> { ["q"] = [$"At most {PublicRoomRules.MaxQueryLength} characters."] });
        }

        var rooms = await _db.Rooms.Find(await WithoutLegacyAsync(PublicRoomRules.ListingFilter(DateTime.UtcNow)))
            .SortByDescending(room => room.UpdatedAt)
            .Limit(PublicRoomRules.ScanLimit)
            // Listing metadata only: never the embedded gameplay state.
            .Project(room => new GameRoom
            {
                Id = room.Id, RoomCode = room.RoomCode, CaseId = room.CaseId, HostUserId = room.HostUserId,
                Status = room.Status, Visibility = room.Visibility, Players = room.Players, CreatedAt = room.CreatedAt
            })
            .ToListAsync(cancellationToken);
        if (rooms.Count == 0) return [];

        // Case title, length and language come from the cached published catalogue; a room whose case
        // was unpublished afterwards falls back to the per-case cache, and is dropped if the case is gone.
        var published = (await _caseService.GetPublishedAsync()).ToDictionary(c => c.CaseId, StringComparer.Ordinal);
        var rows = new List<PublicRoomResponse>(rooms.Count);
        foreach (var room in rooms)
        {
            string title; int minutes; string caseLanguage;
            if (published.TryGetValue(room.CaseId, out var summary))
            {
                (title, minutes, caseLanguage) = (summary.Title, summary.EstimatedMinutes, summary.Language);
            }
            else
            {
                GameCase gameCase;
                try { gameCase = await _caseService.GetCaseAsync(room.CaseId); }
                catch (ApiException missing) when (missing.StatusCode == 404) { continue; }
                (title, minutes, caseLanguage) = (gameCase.Title, gameCase.EstimatedMinutes, CaseLanguages.Normalize(gameCase.Language));
            }
            var host = room.Players.FirstOrDefault(p => p.UserId == room.HostUserId) ?? room.Players.FirstOrDefault();
            rows.Add(new PublicRoomResponse
            {
                RoomId = room.Id,
                RoomCode = room.RoomCode,
                CaseId = room.CaseId,
                CaseTitle = title,
                EstimatedMinutes = minutes,
                Language = caseLanguage,
                HostUsername = host?.Username ?? string.Empty,
                PlayerCount = room.Players.Count,
                Status = room.Status,
                IsJoinable = PublicRoomRules.IsJoinable(room),
                IsMember = room.Players.Any(p => p.UserId == userId),
                CreatedAt = room.CreatedAt
            });
        }
        return PublicRoomRules.Apply(rows, language, query.OpenOnly, search, query.Limit).ToList();
    }

    public async Task<RoomResponse?> LeaveAsync(CurrentUser user, string roomId)
    {
        for (var attempt = 0; ; attempt++)
        {
            var room = await RequireRoomAsync(roomId);
            RequireMember(room, user.Id);

            if (room.Status == RoomStatus.InProgress)
            {
                throw ApiException.BadRequest("You cannot leave a game that is in progress.");
            }
            if (RoomLifecycle.IsTerminal(room.Status))
            {
                // Leaving a finished room must not drop it back to WAITING and resurrect it.
                throw ApiException.Conflict(RoomEndedLeaveMessage, RoomEndedCode, RoomEndedMessageKey);
            }

            room.PendingRemovedPlayerId = user.Id;
            room.Players.RemoveAll(p => p.UserId == user.Id);

            if (room.Players.Count == 0)
            {
                var deleteFilter = Builders<GameRoom>.Filter.And(
                    Builders<GameRoom>.Filter.Eq(r => r.Id, roomId),
                    Builders<GameRoom>.Filter.In(r => r.Status, RoomLifecycle.LobbyStatuses),
                    Builders<GameRoom>.Filter.Eq(r => r.LobbyVersion, room.LobbyVersion));
                var deleted = await _db.Rooms.DeleteOneAsync(deleteFilter);
                if (deleted.DeletedCount == 0)
                {
                    if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                    continue;
                }
                return null;
            }

            if (room.HostUserId == user.Id)
            {
                room.HostUserId = room.Players[0].UserId;
            }

            RecomputeLobbyStatus(room);
            if (!await TrySaveLobbyAsync(room, RoomLifecycle.LobbyStatuses))
            {
                room.PendingRemovedPlayerId = null;
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }
            room.PendingRemovedPlayerId = null;

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);
            var response = await ToLobbyResponseAsync(room, gameCase.Title);
            await _notifier.PlayerLeft(roomId, user.Id, response);
            return response;
        }
    }

    public async Task<RoomResponse> SelectRoleAsync(CurrentUser user, string roomId, string role)
    {
        role = role.Trim().ToUpperInvariant();
        if (!PlayerRole.IsValid(role))
        {
            throw ApiException.BadRequest($"Role must be {PlayerRole.Investigator} or {PlayerRole.Interrogator}.");
        }

        for (var attempt = 0; ; attempt++)
        {
            var room = await RequireRoomAsync(roomId);
            var player = RequireMember(room, user.Id);
            RequireLobby(room);

            if (room.Players.Any(p => p.UserId != user.Id && p.Role == role))
            {
                throw ApiException.Conflict("The other player has already taken this role.");
            }

            player.Role = role;
            player.IsReady = false; // changing role resets readiness
            RecomputeLobbyStatus(room);
            if (!await TrySaveLobbyAsync(room, RoomLifecycle.LobbyStatuses))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);
            var response = await ToLobbyResponseAsync(room, gameCase.Title);
            await _notifier.RolesUpdated(roomId, user.Id, response);
            return response;
        }
    }

    public async Task<RoomResponse> AbandonAsync(CurrentUser user, string roomId)
    {
        var room = await RequireRoomAsync(roomId);
        RequireMember(room, user.Id);
        if (room.Status != RoomStatus.InProgress || room.GameplayState is null)
            throw ApiException.BadRequest("Only a game in progress can be abandoned.");

        var teammate = room.Players.FirstOrDefault(player => player.UserId != user.Id)
            ?? throw ApiException.BadRequest("There is no teammate in this game.");
        var now = DateTime.UtcNow;
        if (!RoomRecoveryRules.CanAbandon(room, teammate, now))
            throw ApiException.Conflict("Wait 5 minutes for your teammate to reconnect before abandoning the game.");

        var timeouts = new RoomDisconnectTimeoutService(_db, _notifier, TimeProvider.System);
        if (!await timeouts.TryExpireAsync(room, teammate, now, user.Id))
            throw ApiException.Conflict("The room changed; refresh before abandoning.");

        var gameCase = await _caseService.GetCaseAsync(room.CaseId);
        return await ToLobbyResponseAsync(room, gameCase.Title);
    }

    public async Task<RoomResponse> SetReadyAsync(CurrentUser user, string roomId, bool isReady)
    {
        for (var attempt = 0; ; attempt++)
        {
            var room = await RequireRoomAsync(roomId);
            var player = RequireMember(room, user.Id);
            RequireLobby(room);

            if (isReady && string.IsNullOrEmpty(player.Role))
            {
                throw ApiException.BadRequest("Select a role before readying up.");
            }

            player.IsReady = isReady;
            RecomputeLobbyStatus(room);
            if (!await TrySaveLobbyAsync(room, RoomLifecycle.LobbyStatuses))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);
            var response = await ToLobbyResponseAsync(room, gameCase.Title);
            await _notifier.ReadyUpdated(roomId, user.Id, response);
            return response;
        }
    }

    public async Task<RoomResponse> StartAsync(CurrentUser user, string roomId)
    {
        for (var attempt = 0; ; attempt++)
        {
            var room = await RequireRoomAsync(roomId);
            RequireMember(room, user.Id);

            if (room.HostUserId != user.Id)
            {
                throw ApiException.Forbidden("Only the host can start the game.");
            }
            if (!RoomLifecycle.AllowsLobbyMutation(room.Status))
            {
                // Refused before any GameplayState is built, so a terminal room keeps its finished run.
                // WAITING is deliberately allowed through: the "not everyone is ready" case below gives a
                // far more useful message than a status conflict. READY stays the only status that can
                // actually commit a start, enforced by the StartableStatuses filter on the write.
                throw NotLobbyConflict(room.Status);
            }

            var notReady = room.Players.Where(p => !p.IsReady || string.IsNullOrEmpty(p.Role))
                .Select(p => p.Username).ToList();
            if (room.Players.Count < MaxPlayers || notReady.Count > 0)
            {
                throw ApiException.BadRequest("All players must join, pick a role, and ready up before starting.",
                    new { playersInRoom = room.Players.Count, requiredPlayers = MaxPlayers, notReadyPlayers = notReady });
            }

            var roles = room.Players.Select(p => p.Role).ToHashSet();
            if (roles.Count != MaxPlayers)
            {
                throw ApiException.Conflict("Players must have two different roles.");
            }

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);

            room.Status = RoomStatus.InProgress;
            room.GameplayState = CreateInitialGameplayState(gameCase, room.Players.Select(p => p.UserId), room.Playtest?.StartSceneId);
            // READY is the only startable stored status, so two concurrent starts cannot both commit.
            if (!await TrySaveLobbyAsync(room, RoomLifecycle.StartableStatuses))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var response = await ToLobbyResponseAsync(room, gameCase.Title);
            await _notifier.GameStarted(roomId, response);
            return response;
        }
    }

    /// <summary>The gameplay state a room starts with (also used by the solo tutorial room).</summary>
    /// <param name="startSceneId">
    /// Playtest only (Case Studio "Chơi thử cảnh này"): both detectives start in this scene. An unknown id falls back to
    /// the first scene. In a classic case the first scene stays unlocked too, so the way back still exists.
    /// </param>
    internal static GameplayState CreateInitialGameplayState(GameCase gameCase, IEnumerable<string> userIds, string? startSceneId = null)
    {
        var firstStage = gameCase.Stages.OrderBy(s => s.Order).First();
        var firstScene = firstStage.Scenes.First();
        var startStage = firstStage;
        var startScene = firstScene;
        if (!string.IsNullOrWhiteSpace(startSceneId))
        {
            foreach (var stage in gameCase.Stages.OrderBy(s => s.Order))
            {
                var match = stage.Scenes.FirstOrDefault(scene => scene.SceneId == startSceneId);
                if (match is null) continue;
                startStage = stage;
                startScene = match;
                break;
            }
        }
        var now = DateTime.UtcNow;
        return new GameplayState
        {
            CurrentStageId = startStage.StageId,
            CurrentSceneId = startScene.SceneId,
            PlayerSceneIds = userIds.Distinct().ToDictionary(userId => userId, _ => startScene.SceneId),
            Version = 1,
            VisitedSceneIds = new List<string> { startScene.SceneId },
            // Open-coop cases let both detectives roam every place from the first second.
            UnlockedSceneIds = CaseRuleSets.IsOpenCoop(gameCase)
                ? gameCase.Stages.OrderBy(s => s.Order).SelectMany(s => s.Scenes).Select(s => s.SceneId).ToList()
                : new[] { firstScene.SceneId, startScene.SceneId }.Distinct().ToList(),
            GameStatus = GameStatus.InProgress,
            StartedAt = now,
            UpdatedAt = now
        };
    }

    /// <summary>Virtual so lifecycle guards can be exercised against an in-memory room without MongoDB.</summary>
    protected virtual async Task<GameRoom> RequireRoomAsync(string roomId)
    {
        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync();
        return room ?? throw ApiException.NotFound("Room not found.");
    }

    private static RoomPlayer RequireMember(GameRoom room, string userId) =>
        room.Players.FirstOrDefault(p => p.UserId == userId)
            ?? throw ApiException.Forbidden("You are not a member of this room.");

    private static void RequireLobby(GameRoom room)
    {
        if (!RoomLifecycle.AllowsLobbyMutation(room.Status))
        {
            throw NotLobbyConflict(room.Status);
        }
    }

    /// <summary>The refusal of a lobby action on a room past its lobby: ROOM_ENDED once it has ended, so the lobby shows its closed page.</summary>
    internal static ApiException NotLobbyConflict(string status) =>
        RoomLifecycle.IsTerminal(status)
            ? ApiException.Conflict(RoomEndedMessage, RoomEndedCode, RoomEndedMessageKey)
            : ApiException.Conflict(GameAlreadyStartedMessage);

    /// <summary>
    /// The stored status must stay derivable from the players, otherwise a role change that clears
    /// readiness leaves the room claiming READY while nobody is ready.
    /// </summary>
    private static void RecomputeLobbyStatus(GameRoom room) =>
        room.Status = room.Players.Count == MaxPlayers && room.Players.All(p => p.IsReady)
            ? RoomStatus.Ready
            : RoomStatus.Waiting;

    /// <summary>Virtual so lifecycle guards can be exercised against an in-memory room without MongoDB.</summary>
    protected virtual async Task<bool> TrySaveLobbyAsync(GameRoom room, IReadOnlyCollection<string> expectedStatuses)
    {
        var expectedVersion = room.LobbyVersion;
        room.LobbyVersion = expectedVersion + 1;
        room.UpdatedAt = DateTime.UtcNow;

        // Status sits in the filter next to LobbyVersion: two requests that agree on the version can
        // still disagree on the transition, and a room that turned terminal must not be revived.
        var filter = Builders<GameRoom>.Filter.And(
            Builders<GameRoom>.Filter.Eq(r => r.Id, room.Id),
            Builders<GameRoom>.Filter.In(r => r.Status, expectedStatuses),
            Builders<GameRoom>.Filter.Eq(r => r.LobbyVersion, expectedVersion));
        // Lobby actions only change role/readiness/player membership. Update those
        // fields in place so a concurrent SignalR presence write and the embedded
        // gameplay state are preserved. LeaveAsync supplies a transient marker so
        // the removed member is pulled atomically without replacing the array.
        var update = Builders<GameRoom>.Update
            .Set(r => r.Status, room.Status)
            .Set(r => r.HostUserId, room.HostUserId)
            .Set(r => r.LobbyVersion, room.LobbyVersion)
            .Set(r => r.UpdatedAt, room.UpdatedAt);
        if (room.GameplayState is not null)
        {
            update = update.Set(r => r.GameplayState, room.GameplayState);
        }
        if (!string.IsNullOrWhiteSpace(room.PendingRemovedPlayerId))
        {
            update = update.PullFilter(
                r => r.Players,
                player => player.UserId == room.PendingRemovedPlayerId);
        }
        else
        {
            for (var index = 0; index < room.Players.Count; index++)
            {
                var player = room.Players[index];
                update = update
                    .Set($"Players.{index}.UserId", player.UserId)
                    .Set($"Players.{index}.Username", player.Username)
                    .Set($"Players.{index}.Role", player.Role)
                    .Set($"Players.{index}.IsReady", player.IsReady);
            }
        }

        var result = await _db.Rooms.UpdateOneAsync(filter, update);
        if (result.ModifiedCount == 0)
        {
            room.LobbyVersion = expectedVersion;
            return false;
        }
        return true;
    }

    internal static string GenerateRoomCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoids 0/O and 1/I
        Span<char> code = stackalloc char[6];
        for (var i = 0; i < code.Length; i++)
        {
            code[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        }
        return new string(code);
    }
}
