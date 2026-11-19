using MongoDB.Driver;
using MongoDB.Driver.Linq;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Tells a room that someone arrived, so every client can play that player's entrance. One conditional write per
/// arrival decides who announces: a refresh, a reconnect or a second tab finds the flag already set and stays quiet.
/// Leaving and joining again adds a new seat, which is a new arrival.
/// </summary>
public sealed class LobbyEntranceService
{
    private readonly MongoDbContext _db;
    private readonly IPlayerCosmeticsReader _cosmetics;
    private readonly IGameNotifier _notifier;

    public LobbyEntranceService(MongoDbContext db, IPlayerCosmeticsReader cosmetics, IGameNotifier notifier)
    {
        _db = db;
        _cosmetics = cosmetics;
        _notifier = notifier;
    }

    /// <returns>Whether this call was the one that announced the arrival.</returns>
    public async Task<bool> AnnounceAsync(string roomId, string userId, CancellationToken ct = default)
    {
        var filter = Builders<GameRoom>.Filter;
        var room = await _db.Rooms.FindOneAndUpdateAsync<GameRoom?>(
            filter.Eq(r => r.Id, roomId)
            & filter.Eq(r => r.Status, RoomStatus.Waiting)
            & filter.ElemMatch(r => r.Players, p => p.UserId == userId && !p.EntranceAnnounced),
            Builders<GameRoom>.Update.Set(r => r.Players.FirstMatchingElement().EntranceAnnounced, true),
            new FindOneAndUpdateOptions<GameRoom, GameRoom?> { ReturnDocument = ReturnDocument.After },
            ct);
        if (room is null) return false;

        var player = room.Players.First(p => p.UserId == userId);
        var look = (await _cosmetics.GetCosmeticsAsync(new[] { userId }, ct))[userId];
        await _notifier.PlayerEntrance(roomId, new PlayerEntranceDto(
            roomId, userId, player.Username, look.Level, look.Avatar, look.AvatarUrl, look.FrameDefId, look.TitleDefId, look.EntranceDefId));
        return true;
    }
}
