using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/game/rooms/{roomId}")]
public sealed class GameController : ControllerBase
{
    private readonly IGameplayService _gameplayService;

    public GameController(IGameplayService gameplayService)
    {
        _gameplayService = gameplayService;
    }

    [HttpGet("state")]
    public async Task<IActionResult> GetState(string roomId, CancellationToken cancellationToken)
    {
        var state = await _gameplayService.GetStateAsync(roomId, cancellationToken);
        return Ok(ApiResponse<GameStateResponse>.Ok(state));
    }

    [HttpPost("inspect-item")]
    public async Task<IActionResult> InspectItem(string roomId, InspectItemRequest request, CancellationToken cancellationToken)
    {
        var state = await _gameplayService.InspectItemAsync(roomId, GetUserId(), request, cancellationToken);
        return Ok(ApiResponse<GameStateResponse>.Ok(state, "Inspect item scaffold completed."));
    }

    [HttpPost("accuse")]
    public async Task<IActionResult> Accuse(string roomId, AccuseRequest request, CancellationToken cancellationToken)
    {
        var result = await _gameplayService.AccuseAsync(roomId, GetUserId(), request, cancellationToken);
        return Ok(ApiResponse<GameResultResponse>.Ok(result));
    }

    private string GetUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
}
