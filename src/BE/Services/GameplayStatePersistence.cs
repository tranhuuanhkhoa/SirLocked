using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class GameplayStatePersistence : IGameplayStatePersistence
{
    private readonly MongoDbContext _db;
    private readonly TimeProvider _timeProvider;

    public GameplayStatePersistence(MongoDbContext db, TimeProvider timeProvider)
    {
        _db = db;
        _timeProvider = timeProvider;
    }

    public async Task<bool> TrySaveAsync(
        GameRoom room,
        GameCase? gameCase = null,
        CancellationToken cancellationToken = default)
    {
        var state = room.GameplayState!;
        if (gameCase is not null && state.GameStatus == GameStatus.InProgress)
        {
            GameRules.AutoCompleteProgress(gameCase, state);
        }

        var expectedVersion = state.Version;
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        state.Version = expectedVersion + 1;
        state.UpdatedAt = now;
        room.UpdatedAt = now;

        var filter = Builders<GameRoom>.Filter.And(
            Builders<GameRoom>.Filter.Eq(candidate => candidate.Id, room.Id),
            Builders<GameRoom>.Filter.Eq("gameplayState.version", expectedVersion),
            Builders<GameRoom>.Filter.In(candidate => candidate.Status,
                [RoomStatus.InProgress, RoomStatus.Completed]));
        // Update only the authoritative gameplay fields. Replacing the whole room with
        // a stale snapshot can erase a presence change written by SignalR or a lobby
        // metadata update that raced this gameplay command.
        var update = Builders<GameRoom>.Update
            .Set(candidate => candidate.GameplayState, state)
            .Set(candidate => candidate.Status, room.Status)
            .Set(candidate => candidate.UpdatedAt, now);
        var result = await _db.Rooms.UpdateOneAsync(filter, update, cancellationToken: cancellationToken);
        if (result.ModifiedCount != 0) return true;

        state.Version = expectedVersion;
        return false;
    }
}
