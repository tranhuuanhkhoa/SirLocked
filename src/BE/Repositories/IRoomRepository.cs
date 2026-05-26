using SirLocked.API.Models;

namespace SirLocked.API.Repositories;

public interface IRoomRepository
{
    Task<GameRoom?> GetByIdAsync(string id, CancellationToken cancellationToken = default);
    Task<GameRoom?> GetByCodeAsync(string roomCode, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GameRoom>> GetRecentAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomChatMessage>> GetRecentMessagesAsync(string roomId, int limit = 50, CancellationToken cancellationToken = default);
    Task CreateAsync(GameRoom room, CancellationToken cancellationToken = default);
    Task UpdateAsync(GameRoom room, CancellationToken cancellationToken = default);
    Task AddMessageAsync(RoomChatMessage message, CancellationToken cancellationToken = default);
    Task<long> CountAsync(CancellationToken cancellationToken = default);
}
