using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>Expires persisted disconnects without depending on a connected client or browser timer.</summary>
public sealed class RoomDisconnectTimeoutService(MongoDbContext db, IGameNotifier notifier, TimeProvider timeProvider)
{
    internal const int BatchSize = 100;

    public async Task<int> ExpireDueRoomsAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var cutoff = now.Subtract(RoomRecoveryRules.DisconnectTimeout);
        var players = Builders<RoomPlayer>.Filter;
        var rooms = Builders<GameRoom>.Filter;
        var filter = rooms.Eq(room => room.Status, RoomStatus.InProgress)
            & rooms.Eq(room => room.GameplayState!.GameStatus, GameStatus.InProgress)
            & rooms.Lte(room => room.GameplayState!.StartedAt, cutoff)
            & rooms.ElemMatch(room => room.Players, players.Ne(player => player.IsConnected, true)
                & (players.Eq(player => player.DisconnectedAt, null) | players.Lte(player => player.DisconnectedAt, cutoff)));
        var candidates = await db.Rooms.Find(filter)
            .SortBy(room => room.GameplayState!.StartedAt).ThenBy(room => room.Id)
            .Limit(BatchSize).ToListAsync(cancellationToken);
        var expired = 0;
        foreach (var room in candidates)
        {
            var player = room.Players.FirstOrDefault(player => RoomRecoveryRules.CanAbandon(room, player, now));
            if (player is not null && await TryExpireAsync(room, player, now, cancellationToken: cancellationToken)) expired++;
        }
        return expired;
    }

    // Called before reconnect writes as well as by the periodic worker. A reconnect arriving after
    // the deadline must not rescue an expired match during the interval between worker passes.
    public async Task<bool> ExpireRoomIfNeededAsync(string roomId, DateTime now, CancellationToken cancellationToken = default)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var room = await db.Rooms.Find(room => room.Id == roomId).FirstOrDefaultAsync(cancellationToken);
            if (room is null) return false;
            if (room.Status == RoomStatus.Abandoned) return true;
            var player = room.Players.FirstOrDefault(player => RoomRecoveryRules.CanAbandon(room, player, now));
            if (player is null) return false;
            if (await TryExpireAsync(room, player, now, cancellationToken: cancellationToken)) return true;
        }
        throw ApiException.Conflict("The room changed while checking its reconnect deadline. Please reconnect again.");
    }

    internal async Task<bool> TryExpireAsync(GameRoom room, RoomPlayer disconnectedPlayer, DateTime now,
        string cancelledByUserId = "system:disconnect-timeout", CancellationToken cancellationToken = default)
    {
        if (!RoomRecoveryRules.CanAbandon(room, disconnectedPlayer, now)) return false;
        var state = room.GameplayState!;
        var expectedVersion = state.Version;
        PairedConfrontationRules.CancelForAbandon(state, cancelledByUserId, now);
        if (state.ActiveAccusation is { } accusation)
        {
            accusation.Status = AccusationProposalStatus.Cancelled;
            accusation.UpdatedAt = now;
            state.AccusationAttempts.Add(accusation);
            state.ActiveAccusation = null;
        }

        var playerFilter = Builders<RoomPlayer>.Filter.Eq(player => player.UserId, disconnectedPlayer.UserId)
            & Builders<RoomPlayer>.Filter.Ne(player => player.IsConnected, true)
            & Builders<RoomPlayer>.Filter.Eq(player => player.DisconnectedAt, disconnectedPlayer.DisconnectedAt)
            & Builders<RoomPlayer>.Filter.Eq(player => player.LastConnectedAt, disconnectedPlayer.LastConnectedAt);
        var filter = Builders<GameRoom>.Filter.Eq(candidate => candidate.Id, room.Id)
            & Builders<GameRoom>.Filter.Eq(candidate => candidate.Status, RoomStatus.InProgress)
            & Builders<GameRoom>.Filter.Eq(candidate => candidate.GameplayState!.GameStatus, GameStatus.InProgress)
            & Builders<GameRoom>.Filter.Eq(candidate => candidate.GameplayState!.Version, expectedVersion)
            & Builders<GameRoom>.Filter.ElemMatch(candidate => candidate.Players, playerFilter);
        var update = Builders<GameRoom>.Update
            .Set(candidate => candidate.Status, RoomStatus.Abandoned)
            .Set(candidate => candidate.GameplayState!.GameStatus, GameStatus.Failed)
            .Set(candidate => candidate.GameplayState!.ActiveConfrontation, state.ActiveConfrontation)
            .Set(candidate => candidate.GameplayState!.PairedConfrontationAttempts, state.PairedConfrontationAttempts)
            .Set(candidate => candidate.GameplayState!.ActiveAccusation, state.ActiveAccusation)
            .Set(candidate => candidate.GameplayState!.AccusationAttempts, state.AccusationAttempts)
            .Set(candidate => candidate.GameplayState!.CompletedAt, now)
            .Set(candidate => candidate.GameplayState!.UpdatedAt, now)
            .Set(candidate => candidate.UpdatedAt, now)
            .Inc(candidate => candidate.GameplayState!.Version, 1);
        var result = await db.Rooms.UpdateOneAsync(filter, update, cancellationToken: cancellationToken);
        if (result.ModifiedCount != 1) return false;

        room.Status = RoomStatus.Abandoned;
        room.UpdatedAt = now;
        state.GameStatus = GameStatus.Failed;
        state.CompletedAt = state.UpdatedAt = now;
        state.Version = expectedVersion + 1;
        // Legacy cases also need the version event to leave their active game screen.
        await notifier.GameStateUpdated(room.Id, state.Version);
        return true;
    }
}
