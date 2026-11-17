using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Tutorial;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public interface ITutorialService
{
    Task<TutorialStatusResponse> GetStatusAsync(string userId, CancellationToken ct = default);
    Task<TutorialStatusResponse> ChooseAsync(string userId, string path, CancellationToken ct = default);
    Task<TutorialStartResponse> StartAsync(CurrentUser user, CancellationToken ct = default);
    Task SwitchRoleAsync(CurrentUser user, string roomId, string role, CancellationToken ct = default);
}

/// <summary>
/// The newcomer tutorial (màn tân thủ): the Kỳ cựu / Nhập môn choice, the solo tutorial room, and the role switch
/// that lets one player try both detectives. Rules live in <see cref="TutorialRules"/>.
/// </summary>
public sealed class TutorialService : ITutorialService
{
    private readonly MongoDbContext _db;
    private readonly ITutorialCaseSeeder _cases;
    private readonly IGameNotifier _notifier;
    private readonly CutsceneService? _cutscenes;
    private readonly ILogger<TutorialService>? _logger;

    public TutorialService(MongoDbContext db, ITutorialCaseSeeder cases, IGameNotifier notifier,
        CutsceneService? cutscenes = null, ILogger<TutorialService>? logger = null)
    {
        _db = db;
        _cases = cases;
        _notifier = notifier;
        _cutscenes = cutscenes;
        _logger = logger;
    }

    public async Task<TutorialStatusResponse> GetStatusAsync(string userId, CancellationToken ct = default)
    {
        var account = await RequireUserAsync(userId, ct);
        var active = await FindActiveRoomAsync(userId, ct);
        return ToStatus(account, active?.Id);
    }

    public async Task<TutorialStatusResponse> ChooseAsync(string userId, string path, CancellationToken ct = default)
    {
        if (!TutorialRules.TryNormalizePath(path, out var normalized))
        {
            throw ApiException.BadRequest(
                $"Path must be {TutorialRules.PathVeteran} or {TutorialRules.PathBeginner}.",
                new Dictionary<string, string[]> { ["path"] = [$"Use {TutorialRules.PathVeteran} or {TutorialRules.PathBeginner}."] });
        }

        var account = await RequireUserAsync(userId, ct);
        if (!TutorialRules.NeedsChoice(account))
        {
            // Choosing the same path again is a retry; a beginner may not switch to veteran to skip the tutorial.
            if (string.Equals(TutorialRules.EffectivePath(account), normalized, StringComparison.Ordinal))
                return ToStatus(account, (await FindActiveRoomAsync(userId, ct))?.Id);
            throw ApiException.Conflict("Bạn đã chọn kiểu người chơi rồi.", TutorialRules.PathAlreadyChosenCode, "tutorial.pathChosen");
        }

        var update = Builders<User>.Update
            .Set(user => user.ExperiencePath, normalized)
            .Set(user => user.UpdatedAt, DateTime.UtcNow);
        // The null filter makes two racing choices settle on the first one.
        await _db.Users.UpdateOneAsync(user => user.Id == userId && user.ExperiencePath == null, update, cancellationToken: ct);
        account = await RequireUserAsync(userId, ct);
        return ToStatus(account, (await FindActiveRoomAsync(userId, ct))?.Id);
    }

    public async Task<TutorialStartResponse> StartAsync(CurrentUser user, CancellationToken ct = default)
    {
        var account = await RequireUserAsync(user.Id, ct);
        var active = await FindActiveRoomAsync(user.Id, ct);
        if (active is not null) return new TutorialStartResponse { RoomId = active.Id, Resumed = true };

        var gameCase = await _cases.EnsureTutorialCaseAsync(ct);
        await EnsureIntroCutsceneAsync(gameCase, ct);

        var room = new GameRoom
        {
            CaseId = gameCase.CaseId,
            HostUserId = user.Id,
            Mode = TutorialRules.RoomMode,
            Status = RoomStatus.InProgress,
            Visibility = RoomVisibility.Private,
            Players = new List<RoomPlayer>
            {
                // Sherlock first: the tutorial opens by questioning the owner; the role switch hands over to Watson.
                new()
                {
                    UserId = user.Id,
                    Username = string.IsNullOrWhiteSpace(account.FullName) ? user.FullName : account.FullName,
                    Role = PlayerRole.Interrogator,
                    IsReady = true,
                    EntranceAnnounced = true
                }
            },
            GameplayState = RoomService.CreateInitialGameplayState(gameCase, new[] { user.Id })
        };

        for (var attempt = 0; ; attempt++)
        {
            room.RoomCode = RoomService.GenerateRoomCode();
            try
            {
                await _db.Rooms.InsertOneAsync(room, cancellationToken: ct);
                break;
            }
            catch (MongoWriteException error) when (error.WriteError?.Category == ServerErrorCategory.DuplicateKey && attempt < 5)
            {
            }
        }

        _logger?.LogInformation("Tutorial room {RoomId} started for user {UserId}.", room.Id, user.Id);
        return new TutorialStartResponse { RoomId = room.Id, Resumed = false };
    }

    public async Task SwitchRoleAsync(CurrentUser user, string roomId, string role, CancellationToken ct = default)
    {
        if (!PlayerRole.IsValid(role))
            throw ApiException.BadRequest($"Role must be {PlayerRole.Investigator} or {PlayerRole.Interrogator}.");

        var room = await _db.Rooms.Find(candidate => candidate.Id == roomId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Room not found.");
        if (!TutorialRules.IsTutorialRoom(room))
            throw ApiException.Forbidden("Chỉ màn tân thủ mới được đổi vai giữa chừng.", TutorialRules.NotTutorialRoomCode, "tutorial.roomOnly");
        var player = room.Players.FirstOrDefault(candidate => candidate.UserId == user.Id)
            ?? throw ApiException.Forbidden("You are not a member of this room.");
        if (room.Status != RoomStatus.InProgress || room.GameplayState is null)
            throw ApiException.Conflict("The tutorial has already ended.");
        if (string.Equals(player.Role, role, StringComparison.Ordinal)) return;

        // The version bump makes every open page refetch the state (the role decides what the page offers).
        var filter = Builders<GameRoom>.Filter.And(
            Builders<GameRoom>.Filter.Eq(candidate => candidate.Id, roomId),
            Builders<GameRoom>.Filter.Eq(candidate => candidate.Mode, TutorialRules.RoomMode),
            Builders<GameRoom>.Filter.Eq(candidate => candidate.Status, RoomStatus.InProgress),
            Builders<GameRoom>.Filter.ElemMatch(candidate => candidate.Players, candidate => candidate.UserId == user.Id));
        var update = Builders<GameRoom>.Update
            .Set("Players.$.Role", role)
            .Inc(candidate => candidate.GameplayState!.Version, 1L)
            .Set(candidate => candidate.GameplayState!.UpdatedAt, DateTime.UtcNow)
            .Set(candidate => candidate.UpdatedAt, DateTime.UtcNow);
        var result = await _db.Rooms.UpdateOneAsync(filter, update, cancellationToken: ct);
        if (result.ModifiedCount == 0) throw ApiException.Conflict("The tutorial has already ended.");
        await _notifier.GameStateUpdated(roomId, room.GameplayState.Version + 1);
    }

    /// <summary>Marks the tutorial as finished for these players (first finish wins; later runs keep the date).</summary>
    internal static Task MarkCompletedAsync(MongoDbContext db, IEnumerable<string> userIds, DateTime completedAt)
    {
        var ids = userIds.Distinct().ToList();
        var update = Builders<User>.Update
            .Set(user => user.TutorialCompletedAt, completedAt)
            .Set(user => user.UpdatedAt, completedAt);
        return db.Users.UpdateManyAsync(user => ids.Contains(user.Id) && user.TutorialCompletedAt == null, update);
    }

    private async Task EnsureIntroCutsceneAsync(GameCase gameCase, CancellationToken ct)
    {
        if (_cutscenes is null) return;
        try
        {
            // Adds the approved intro from SeedData/Cutscenes when the case has none; never overwrites an edited one.
            await _cutscenes.SeedMissingAsync(new[] { gameCase }, ct);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            _logger?.LogWarning(error, "Tutorial intro cutscene could not be seeded; the tutorial starts without it.");
        }
    }

    private async Task<GameRoom?> FindActiveRoomAsync(string userId, CancellationToken ct)
    {
        var filter = Builders<GameRoom>.Filter.And(
            Builders<GameRoom>.Filter.Eq(room => room.Mode, TutorialRules.RoomMode),
            Builders<GameRoom>.Filter.Eq(room => room.Status, RoomStatus.InProgress),
            Builders<GameRoom>.Filter.ElemMatch(room => room.Players, player => player.UserId == userId));
        return await _db.Rooms.Find(filter).SortByDescending(room => room.CreatedAt).FirstOrDefaultAsync(ct);
    }

    private async Task<User> RequireUserAsync(string userId, CancellationToken ct) =>
        await _db.Users.Find(user => user.Id == userId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Account not found.");

    private static TutorialStatusResponse ToStatus(User account, string? activeRoomId) => new()
    {
        Path = TutorialRules.EffectivePath(account),
        NeedsChoice = TutorialRules.NeedsChoice(account),
        Required = TutorialRules.IsRequired(account),
        Completed = account.TutorialCompletedAt is not null,
        CompletedAt = account.TutorialCompletedAt,
        ActiveRoomId = activeRoomId,
        CaseId = TutorialRules.CaseId
    };
}

/// <summary>The tutorial never stores a game result: it is built in memory for the result page and dropped.</summary>
public sealed class TutorialResultStore : IGameResultStore
{
    public static readonly TutorialResultStore Instance = new();

    private TutorialResultStore() { }

    public Task<GameResult?> FindByRoomIdAsync(string roomId, CancellationToken cancellationToken = default) =>
        Task.FromResult<GameResult?>(null);

    public Task<GameResult> UpsertAsync(GameResult result, CancellationToken cancellationToken = default) =>
        Task.FromResult(result);
}
