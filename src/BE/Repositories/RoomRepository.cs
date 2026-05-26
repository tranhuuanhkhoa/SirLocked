using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.API.Configurations;
using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public sealed class RoomRepository : IRoomRepository
{
    private readonly IMongoCollection<GameRoom> _rooms;
    private readonly IMongoCollection<RoomChatMessage> _messages;

    public RoomRepository(IMongoClient mongoClient, IOptions<MongoDbSettings> settings)
    {
        var database = mongoClient.GetDatabase(settings.Value.DatabaseName);
        _rooms = database.GetCollection<GameRoom>(settings.Value.RoomsCollectionName);
        _messages = database.GetCollection<RoomChatMessage>(settings.Value.RoomChatMessagesCollectionName);
    }

    public async Task<GameRoom?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        return await _rooms.Find(room => room.Id == id).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<GameRoom?> GetByCodeAsync(string roomCode, CancellationToken cancellationToken = default)
    {
        var normalized = roomCode.Trim().ToUpperInvariant();
        return await _rooms.Find(room => room.RoomCode == normalized).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<GameRoom>> GetRecentAsync(CancellationToken cancellationToken = default)
    {
        return await _rooms.Find(_ => true).SortByDescending(room => room.CreatedAt).Limit(50).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<RoomChatMessage>> GetRecentMessagesAsync(string roomId, int limit = 50, CancellationToken cancellationToken = default)
    {
        var safeLimit = Math.Clamp(limit, 1, 200);
        var messages = await _messages.Find(message => message.RoomId == roomId)
            .SortByDescending(message => message.SentAt)
            .Limit(safeLimit)
            .ToListAsync(cancellationToken);
        messages.Reverse();
        return messages;
    }

    public async Task CreateAsync(GameRoom room, CancellationToken cancellationToken = default)
    {
        await _rooms.InsertOneAsync(room, cancellationToken: cancellationToken);
    }

    public async Task UpdateAsync(GameRoom room, CancellationToken cancellationToken = default)
    {
        room.UpdatedAt = DateTime.UtcNow;
        await _rooms.ReplaceOneAsync(existing => existing.Id == room.Id, room, cancellationToken: cancellationToken);
    }

    public async Task AddMessageAsync(RoomChatMessage message, CancellationToken cancellationToken = default)
    {
        await _messages.InsertOneAsync(message, cancellationToken: cancellationToken);
    }

    public async Task<long> CountAsync(CancellationToken cancellationToken = default)
    {
        return await _rooms.CountDocumentsAsync(_ => true, cancellationToken: cancellationToken);
    }
}
