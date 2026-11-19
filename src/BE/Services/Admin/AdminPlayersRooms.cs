using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Admin;

public sealed record AdminRoomQuery(
    string? Status = null,
    string? Search = null,
    int Page = 1,
    int PageSize = AdminPlayersRules.DefaultPageSize);

/// <summary>Rooms still open or being played, and closing the ones that hung.</summary>
public sealed class AdminRoomsService
{
    private const int CloseAttempts = 3;
    private static readonly TimeSpan QuietGame = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan QuietLobby = TimeSpan.FromHours(1);
    private static readonly string[] OpenStatuses = [RoomStatus.Waiting, RoomStatus.Ready, RoomStatus.InProgress];

    private readonly MongoDbContext _db;
    private readonly IGameNotifier _notifier;
    private readonly RoomDisconnectTimeoutService _timeouts;
    private readonly IAdminAudit _audit;

    public AdminRoomsService(MongoDbContext db, IGameNotifier notifier, RoomDisconnectTimeoutService timeouts, IAdminAudit audit)
    {
        _db = db;
        _notifier = notifier;
        _timeouts = timeouts;
        _audit = audit;
    }

    /// <summary>Everyone offline, or nothing has happened for a long while. A hint for the admin, nothing acts on it.</summary>
    public static bool LooksHung(GameRoom room, DateTime lastActivity, DateTime now)
    {
        var quiet = now - lastActivity;
        return room.Status == RoomStatus.InProgress
            ? room.Players.All(player => !player.IsConnected) || quiet >= QuietGame
            : quiet >= QuietLobby;
    }

    private static DateTime LastActivity(GameRoom room) =>
        room.GameplayState is { } state && state.UpdatedAt > room.UpdatedAt ? state.UpdatedAt : room.UpdatedAt;

    public async Task<AdminPageDto<AdminRoomRowDto>> ListAsync(AdminRoomQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var filter = Builders<GameRoom>.Filter;
        var status = (query.Status ?? string.Empty).Trim().ToUpperInvariant();
        if (status.Length > 0 && !OpenStatuses.Contains(status))
            throw AdminPlayersRules.Error(400, AdminPlayerErrors.BadQuery, "Trạng thái phòng không hợp lệ.");
        var where = status.Length > 0 ? filter.Eq(r => r.Status, status) : filter.In(r => r.Status, OpenStatuses);

        var search = AdminPlayersRules.CleanSearch(query.Search);
        if (search.Length > 0)
        {
            var pattern = new BsonRegularExpression(Regex.Escape(search), "i");
            where &= filter.Eq(r => r.RoomCode, search.ToUpperInvariant())
                | filter.Regex(r => r.CaseId, pattern)
                | filter.ElemMatch(r => r.Players, Builders<RoomPlayer>.Filter.Regex(p => p.Username, pattern));
        }

        var total = await _db.Rooms.CountDocumentsAsync(where, cancellationToken: ct);
        // Never the saved investigation: only the few fields of it this list shows.
        var projection = Builders<GameRoom>.Projection
            .Include(r => r.RoomCode).Include(r => r.CaseId).Include(r => r.Status).Include(r => r.Visibility).Include(r => r.HostUserId)
            .Include(r => r.Players).Include(r => r.CreatedAt).Include(r => r.UpdatedAt)
            .Include("gameplayState.startedAt").Include("gameplayState.updatedAt").Include("gameplayState.gameStatus");
        var rooms = await _db.Rooms.Find(where)
            .SortByDescending(r => r.UpdatedAt).ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize)
            .Project<GameRoom>(projection)
            .ToListAsync(ct);

        var titles = await TitlesAsync(rooms.Select(r => r.CaseId), ct);
        var now = DateTime.UtcNow;
        return new AdminPageDto<AdminRoomRowDto>(rooms.Select(room => ToRow(room, titles, now)).ToList(), page, pageSize, total);
    }

    private async Task<Dictionary<string, string>> TitlesAsync(IEnumerable<string> caseIds, CancellationToken ct)
    {
        var ids = caseIds.Distinct(StringComparer.Ordinal).ToList();
        var cases = await _db.Cases.Find(c => ids.Contains(c.CaseId)).Project(c => new { c.CaseId, c.Title }).ToListAsync(ct);
        return cases.ToDictionary(c => c.CaseId, c => c.Title, StringComparer.Ordinal);
    }

    private static AdminRoomRowDto ToRow(GameRoom room, IReadOnlyDictionary<string, string> titles, DateTime now)
    {
        var lastActivity = LastActivity(room);
        return new AdminRoomRowDto(
            room.Id, room.RoomCode, room.CaseId, titles.GetValueOrDefault(room.CaseId, room.CaseId), room.Status, room.Visibility, room.HostUserId,
            room.Players.Select(p => new AdminRoomPlayerDto(p.UserId, p.Username, p.Role, p.IsReady, p.IsConnected, p.DisconnectedAt)).ToList(),
            room.CreatedAt, room.GameplayState?.StartedAt, lastActivity, LooksHung(room, lastActivity, now));
    }

    /// <summary>
    /// A game in progress ends the way a timed-out one does: ABANDONED and failed, nobody paid, and the room told through
    /// GameStateUpdated, whatever a presence flag left behind by a crash claims. A lobby cannot become ABANDONED (see
    /// RoomLifecycle), so it goes the way an empty one does: deleted. Whoever is in it is sent the ended room, which their page draws.
    /// </summary>
    public async Task<AdminRoomRowDto> CloseAsync(CurrentUser admin, string roomId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        for (var attempt = 0; attempt < CloseAttempts; attempt++)
        {
            var room = ObjectId.TryParse(roomId, out _) ? await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync(ct) : null;
            if (room is null) throw AdminPlayersRules.Error(404, AdminPlayerErrors.RoomNotFound, "Không tìm thấy phòng này.");
            if (RoomLifecycle.IsTerminal(room.Status))
                throw ApiException.Conflict(RoomService.RoomEndedMessage, RoomService.RoomEndedCode, RoomService.RoomEndedMessageKey);

            var before = new
            {
                roomCode = room.RoomCode,
                caseId = room.CaseId,
                status = room.Status,
                hostUserId = room.HostUserId,
                players = room.Players.Select(p => new { userId = p.UserId, username = p.Username, isConnected = p.IsConnected }).ToList(),
            };
            var now = DateTime.UtcNow;
            var closed = room.Status == RoomStatus.InProgress
                ? await _timeouts.TryForceAbandonAsync(room, admin.Id, now, ct)
                : await TryCloseLobbyAsync(room, admin, ct);
            if (!closed) continue;

            room.Status = RoomStatus.Abandoned;
            await _audit.LogAsync(admin, "room.close", "room", room.Id, before, new { status = RoomStatus.Abandoned }, note, CancellationToken.None);
            var titles = await TitlesAsync(new[] { room.CaseId }, CancellationToken.None);
            return ToRow(room, titles, now);
        }
        throw AdminPlayersRules.Error(409, AdminPlayerErrors.RoomChanged, "Phòng vừa thay đổi liên tục. Hãy tải lại rồi thử lại.");
    }

    private async Task<bool> TryCloseLobbyAsync(GameRoom room, CurrentUser admin, CancellationToken ct)
    {
        var deleted = await _db.Rooms.DeleteOneAsync(
            Builders<GameRoom>.Filter.Eq(r => r.Id, room.Id)
            & Builders<GameRoom>.Filter.In(r => r.Status, RoomLifecycle.LobbyStatuses)
            & Builders<GameRoom>.Filter.Eq(r => r.LobbyVersion, room.LobbyVersion),
            ct);
        if (deleted.DeletedCount == 0) return false;

        room.Status = RoomStatus.Abandoned;
        var titles = await TitlesAsync(new[] { room.CaseId }, CancellationToken.None);
        await _notifier.ReadyUpdated(room.Id, admin.Id, RoomResponse.From(room, titles.GetValueOrDefault(room.CaseId, room.CaseId)));
        return true;
    }
}
