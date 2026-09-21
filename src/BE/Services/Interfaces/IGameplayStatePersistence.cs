using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IGameplayStatePersistence
{
    Task<bool> TrySaveAsync(
        GameRoom room,
        GameCase? gameCase = null,
        CancellationToken cancellationToken = default);
}
