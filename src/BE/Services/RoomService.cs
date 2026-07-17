using System.Security.Cryptography;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class RoomService : IRoomService
{
    public const int MaxPlayers = 2;
    public static readonly TimeSpan DisconnectGracePeriod = TimeSpan.FromSeconds(30);

    private readonly MongoDbContext _db;
    private readonly ICaseService _caseService;
    private readonly IGameNotifier _notifier;

    public RoomService(MongoDbContext db, ICaseService caseService, IGameNotifier notifier)
    {
        _db = db;
        _caseService = caseService;
        _notifier = notifier;
    }

    // Người chơi phải xác minh email trước khi tạo/vào phòng. Admin được miễn.
    private async Task EnsureEmailVerifiedAsync(CurrentUser user)
    {
        if (user.Role == UserRole.Admin) return;

        var account = await _db.Users.Find(u => u.Id == user.Id).FirstOrDefaultAsync();
        if (account is null || !account.IsEmailVerified)
        {
            throw ApiException.Forbidden("Vui lòng xác minh email trước khi vào game.");
        }
    }

    public async Task<RoomResponse> CreateAsync(CurrentUser user, string caseId)
    {
        await EnsureEmailVerifiedAsync(user);

        var gameCase = await _caseService.GetCaseAsync(caseId);
        if (gameCase.Status != CaseStatus.Published)
        {
            throw ApiException.BadRequest("Rooms can only be created from published cases.");
        }

        var room = new GameRoom
        {
            CaseId = gameCase.CaseId,
            HostUserId = user.Id,
            Status = RoomStatus.Waiting,
            Players = new List<RoomPlayer>
            {
                new() { UserId = user.Id, Username = user.FullName }
            }
        };

        // Room codes are random; retry on the rare unique-index collision.
        for (var attempt = 0; ; attempt++)
        {
            room.RoomCode = GenerateRoomCode();
            try
            {
                await _db.Rooms.InsertOneAsync(room);
                break;
            }
            catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey && attempt < 5)
            {
            }
        }

        return RoomResponse.From(room, gameCase.Title);
    }

    public async Task<RoomResponse> JoinAsync(CurrentUser user, string roomCode)
    {
        await EnsureEmailVerifiedAsync(user);

        var code = roomCode.Trim().ToUpperInvariant();
        var room = await _db.Rooms.Find(r => r.RoomCode == code).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("No room with this code was found.");

        var gameCase = await _caseService.GetCaseAsync(room.CaseId);

        if (room.Players.Any(p => p.UserId == user.Id))
        {
            // Re-joining your own room (e.g. page refresh) is idempotent.
            return RoomResponse.From(room, gameCase.Title);
        }

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
        var result = await _db.Rooms.UpdateOneAsync(joinFilter, update);
        if (result.ModifiedCount == 0)
        {
            throw ApiException.Conflict("This room is already full or has started.");
        }

        var updated = await RequireRoomAsync(room.Id);
        var response = RoomResponse.From(updated, gameCase.Title);
        await _notifier.PlayerJoined(room.Id, user.Id, response);
        return response;
    }

    public async Task<RoomResponse> GetAsync(string userId, string roomId)
    {
        var room = await RequireRoomAsync(roomId);
        RequireMember(room, userId);
        var gameCase = await _caseService.GetCaseAsync(room.CaseId);
        return RoomResponse.From(room, gameCase.Title);
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

            room.Players.RemoveAll(p => p.UserId == user.Id);

            if (room.Players.Count == 0)
            {
                var deleted = await _db.Rooms.DeleteOneAsync(r => r.Id == roomId && r.LobbyVersion == room.LobbyVersion);
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

            room.Status = RoomStatus.Waiting;
            if (!await TrySaveLobbyAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);
            var response = RoomResponse.From(room, gameCase.Title);
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
            if (!await TrySaveLobbyAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);
            var response = RoomResponse.From(room, gameCase.Title);
            await _notifier.RolesUpdated(roomId, user.Id, response);
            return response;
        }
    }

    public async Task<RoomResponse> AbandonAsync(CurrentUser user, string roomId)
    {
        var room = await RequireRoomAsync(roomId);
        if (room.HostUserId != user.Id)
            throw ApiException.Forbidden("Only the host can abandon an interrupted game.");
        if (room.Status != RoomStatus.InProgress || room.GameplayState is null)
            throw ApiException.BadRequest("Only a game in progress can be abandoned.");

        var teammate = room.Players.FirstOrDefault(player => player.UserId != user.Id)
            ?? throw ApiException.BadRequest("There is no teammate in this game.");
        var now = DateTime.UtcNow;
        if (!RoomRecoveryRules.CanAbandon(teammate, now, DisconnectGracePeriod))
            throw ApiException.Conflict("Wait 30 seconds for your teammate to reconnect before abandoning the game.");

        var result = await _db.Rooms.UpdateOneAsync(
            candidate => candidate.Id == roomId
                && candidate.HostUserId == user.Id
                && candidate.Status == RoomStatus.InProgress
                && candidate.GameplayState!.Version == room.GameplayState.Version,
            Builders<GameRoom>.Update
                .Set(candidate => candidate.Status, RoomStatus.Abandoned)
                .Set(candidate => candidate.GameplayState!.GameStatus, GameStatus.Failed)
                .Set(candidate => candidate.GameplayState!.CompletedAt, now)
                .Set(candidate => candidate.GameplayState!.UpdatedAt, now)
                .Set(candidate => candidate.UpdatedAt, now)
                .Inc(candidate => candidate.GameplayState!.Version, 1));
        if (result.ModifiedCount != 1)
            throw ApiException.Conflict("The room changed; refresh before abandoning.");

        room.Status = RoomStatus.Abandoned;
        room.GameplayState.GameStatus = GameStatus.Failed;
        room.GameplayState.CompletedAt = now;
        room.GameplayState.Version++;
        await _notifier.SystemMessage(roomId, "The host abandoned the game after the reconnect grace period expired.");
        var gameCase = await _caseService.GetCaseAsync(room.CaseId);
        return RoomResponse.From(room, gameCase.Title);
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
            room.Status = room.Players.Count == MaxPlayers && room.Players.All(p => p.IsReady)
                ? RoomStatus.Ready
                : RoomStatus.Waiting;
            if (!await TrySaveLobbyAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var gameCase = await _caseService.GetCaseAsync(room.CaseId);
            var response = RoomResponse.From(room, gameCase.Title);
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
            if (room.Status == RoomStatus.InProgress)
            {
                throw ApiException.Conflict("The game has already started.");
            }
            if (room.Status == RoomStatus.Completed)
            {
                throw ApiException.BadRequest("This room is already completed.");
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
            var firstStage = gameCase.Stages.OrderBy(s => s.Order).First();
            var firstScene = firstStage.Scenes.First();

            room.Status = RoomStatus.InProgress;
            room.GameplayState = new GameplayState
            {
                CurrentStageId = firstStage.StageId,
                CurrentSceneId = firstScene.SceneId,
                PlayerSceneIds = room.Players.ToDictionary(p => p.UserId, _ => firstScene.SceneId),
                Version = 1,
                VisitedSceneIds = new List<string> { firstScene.SceneId },
                UnlockedSceneIds = new List<string> { firstScene.SceneId },
                GameStatus = GameStatus.InProgress,
                StartedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            if (!await TrySaveLobbyAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The room changed; please retry.");
                continue;
            }

            var response = RoomResponse.From(room, gameCase.Title);
            await _notifier.GameStarted(roomId, response);
            return response;
        }
    }

    private async Task<GameRoom> RequireRoomAsync(string roomId)
    {
        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync();
        return room ?? throw ApiException.NotFound("Room not found.");
    }

    private static RoomPlayer RequireMember(GameRoom room, string userId) =>
        room.Players.FirstOrDefault(p => p.UserId == userId)
            ?? throw ApiException.Forbidden("You are not a member of this room.");

    private static void RequireLobby(GameRoom room)
    {
        if (room.Status is RoomStatus.InProgress or RoomStatus.Completed)
        {
            throw ApiException.Conflict("The game has already started.");
        }
    }

    private async Task<bool> TrySaveLobbyAsync(GameRoom room)
    {
        var expectedVersion = room.LobbyVersion;
        room.LobbyVersion = expectedVersion + 1;
        room.UpdatedAt = DateTime.UtcNow;

        var result = await _db.Rooms.ReplaceOneAsync(
            r => r.Id == room.Id && r.LobbyVersion == expectedVersion,
            room);
        if (result.ModifiedCount == 0)
        {
            room.LobbyVersion = expectedVersion;
            return false;
        }
        return true;
    }

    private static string GenerateRoomCode()
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
