using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

/// <summary>
/// Called after a game result is persisted. Implementations must be idempotent (a result can be
/// re-materialized) and must not throw: a finished game never fails because of a side effect.
/// </summary>
public interface IGameResultRewardHook
{
    Task OnGameResultPersistedAsync(GameResult result, CancellationToken cancellationToken = default);
}
