using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IGameStateBuilder
{
    Task<GameStateResponse> BuildStateAsync(GameRoom room, GameCase gameCase, string userId);
}
