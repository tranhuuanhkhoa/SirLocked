using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

internal static class RoomPresenceWriteRules
{
    // Mongo evaluates $$NOW at the write, closing the gap between the pre-join timeout read and
    // setting IsConnected. Clearing DisconnectedAt must never rescue an already expired match.
    internal static FilterDefinition<GameRoom> ReconnectFilter(string roomId, string userId)
    {
        var cutoff = new BsonDocument("$subtract", new BsonArray
        {
            "$$NOW", (long)RoomRecoveryRules.DisconnectTimeout.TotalMilliseconds
        });
        var effectiveDisconnect = new BsonDocument("$max", new BsonArray
        {
            new BsonDocument("$ifNull", new BsonArray { "$$player.disconnectedAt", "$gameplayState.startedAt" }),
            "$gameplayState.startedAt"
        });
        var expiredPlayer = new BsonDocument("$and", new BsonArray
        {
            new BsonDocument("$ne", new BsonArray
            {
                new BsonDocument("$ifNull", new BsonArray { "$$player.isConnected", false }), true
            }),
            new BsonDocument("$lte", new BsonArray { effectiveDisconnect, cutoff })
        });
        var hasExpiredPlayer = new BsonDocument("$anyElementTrue", new BsonArray
        {
            new BsonDocument("$map", new BsonDocument
            {
                { "input", new BsonDocument("$ifNull", new BsonArray { "$players", new BsonArray() }) },
                { "as", "player" },
                { "in", expiredPlayer }
            })
        });
        var allowed = new BsonDocument("$or", new BsonArray
        {
            new BsonDocument("$in", new BsonArray
            {
                "$status", new BsonArray { RoomStatus.Waiting, RoomStatus.Ready }
            }),
            new BsonDocument("$and", new BsonArray
            {
                new BsonDocument("$eq", new BsonArray { "$status", RoomStatus.InProgress }),
                new BsonDocument("$eq", new BsonArray { "$gameplayState.gameStatus", GameStatus.InProgress }),
                new BsonDocument("$not", new BsonArray { hasExpiredPlayer })
            })
        });
        return Builders<GameRoom>.Filter.Eq(room => room.Id, roomId)
            & Builders<GameRoom>.Filter.ElemMatch(room => room.Players, player => player.UserId == userId)
            & new BsonDocument("$expr", allowed);
    }
}
