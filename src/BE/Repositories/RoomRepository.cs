using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.API.Configurations;
using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public sealed class RoomRepository : IRoomRepository
{
    private readonly IMongoCollection<GameRoom> _rooms;

    public RoomRepository(IMongoClient mongoClient, IOptions<MongoDbSettings> settings)
    {
        var database = mongoClient.GetDatabase(settings.Value.DatabaseName);
        _rooms = database.GetCollection<GameRoom>(settings.Value.RoomsCollectionName);
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

    public async Task CreateAsync(GameRoom room, CancellationToken cancellationToken = default)
    {
        await _rooms.InsertOneAsync(room, cancellationToken: cancellationToken);
    }

    public async Task UpdateAsync(GameRoom room, CancellationToken cancellationToken = default)
    {
        room.UpdatedAt = DateTime.UtcNow;
        await _rooms.ReplaceOneAsync(existing => existing.Id == room.Id, room, cancellationToken: cancellationToken);
    }
}
