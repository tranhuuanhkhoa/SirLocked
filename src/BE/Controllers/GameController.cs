using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.Helpers;
using SirLocked.API.Hubs;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/game/rooms/{roomId}")]
public sealed class GameController : ControllerBase
{
    private readonly IGameplayService _gameplayService;
    private readonly IHubContext<GameHub> _hubContext;

    public GameController(IGameplayService gameplayService, IHubContext<GameHub> hubContext)
    {
        _gameplayService = gameplayService;
        _hubContext = hubContext;
    }

    [HttpGet("state")]
    public async Task<IActionResult> GetState(string roomId, CancellationToken cancellationToken)
    {
        try
        {
            var state = await _gameplayService.GetStateAsync(roomId, cancellationToken);
            return Ok(ApiResponse<GameStateResponse>.Ok(state));
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("inspect-item")]
    public async Task<IActionResult> InspectItem(string roomId, InspectItemRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var before = await _gameplayService.GetStateAsync(roomId, cancellationToken);
            var state = await _gameplayService.InspectItemAsync(roomId, GetUserId(), request, cancellationToken);
            var itemWasNew = !before.FoundItemIds.Contains(request.ItemId, StringComparer.OrdinalIgnoreCase);
            var newClueIds = state.FoundClueIds
                .Where(clueId => !before.FoundClueIds.Contains(clueId, StringComparer.OrdinalIgnoreCase))
                .ToList();

            await _hubContext.Clients.Group(roomId).SendAsync("GameStateUpdated", state, cancellationToken);
            if (itemWasNew)
            {
                await _hubContext.Clients.Group(roomId).SendAsync("ItemFound", new
                {
                    roomId,
                    itemId = request.ItemId,
                    userId = GetUserId()
                }, cancellationToken);
            }

            foreach (var clueId in newClueIds)
            {
                await _hubContext.Clients.Group(roomId).SendAsync("ClueUnlocked", new
                {
                    roomId,
                    clueId,
                    itemId = request.ItemId,
                    userId = GetUserId()
                }, cancellationToken);
            }

            return Ok(ApiResponse<GameStateResponse>.Ok(state, "Item inspected."));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("ask-dialogue")]
    public async Task<IActionResult> AskDialogue(string roomId, AskDialogueRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var before = await _gameplayService.GetStateAsync(roomId, cancellationToken);
            var state = await _gameplayService.AskDialogueAsync(roomId, GetUserId(), request, cancellationToken);
            await BroadcastGameStateAsync(roomId, state, cancellationToken);
            await _hubContext.Clients.Group(roomId).SendAsync("DialogueAnswered", new
            {
                roomId,
                dialogueId = request.DialogueId,
                userId = GetUserId()
            }, cancellationToken);
            await BroadcastNewCluesAsync(roomId, request.DialogueId, before, state, cancellationToken);
            return Ok(ApiResponse<GameStateResponse>.Ok(state, "Dialogue answered."));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("present-evidence")]
    public async Task<IActionResult> PresentEvidence(string roomId, PresentEvidenceRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var before = await _gameplayService.GetStateAsync(roomId, cancellationToken);
            var state = await _gameplayService.PresentEvidenceAsync(roomId, GetUserId(), request, cancellationToken);
            await BroadcastGameStateAsync(roomId, state, cancellationToken);
            await _hubContext.Clients.Group(roomId).SendAsync("EvidencePresented", new
            {
                roomId,
                dialogueId = request.DialogueId,
                evidenceId = request.EvidenceId,
                userId = GetUserId()
            }, cancellationToken);
            await BroadcastNewCluesAsync(roomId, request.DialogueId, before, state, cancellationToken);
            return Ok(ApiResponse<GameStateResponse>.Ok(state, "Evidence presented."));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("complete-scene")]
    public async Task<IActionResult> CompleteScene(string roomId, CancellationToken cancellationToken)
    {
        try
        {
            var before = await _gameplayService.GetStateAsync(roomId, cancellationToken);
            var state = await _gameplayService.CompleteSceneAsync(roomId, GetUserId(), cancellationToken);
            await BroadcastGameStateAsync(roomId, state, cancellationToken);
            await _hubContext.Clients.Group(roomId).SendAsync("SceneChanged", new
            {
                roomId,
                previousSceneId = before.CurrentSceneId,
                currentSceneId = state.CurrentSceneId,
                userId = GetUserId()
            }, cancellationToken);
            return Ok(ApiResponse<GameStateResponse>.Ok(state, "Scene completed."));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("complete-stage")]
    public async Task<IActionResult> CompleteStage(string roomId, CancellationToken cancellationToken)
    {
        try
        {
            var before = await _gameplayService.GetStateAsync(roomId, cancellationToken);
            var state = await _gameplayService.CompleteStageAsync(roomId, GetUserId(), cancellationToken);
            await BroadcastGameStateAsync(roomId, state, cancellationToken);
            await _hubContext.Clients.Group(roomId).SendAsync("StageChanged", new
            {
                roomId,
                previousStageId = before.CurrentStageId,
                currentStageId = state.CurrentStageId,
                previousSceneId = before.CurrentSceneId,
                currentSceneId = state.CurrentSceneId,
                isFinalStageCompleted = before.CurrentStageId == state.CurrentStageId,
                userId = GetUserId()
            }, cancellationToken);
            return Ok(ApiResponse<GameStateResponse>.Ok(state, "Stage completed."));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpPost("accuse")]
    public async Task<IActionResult> Accuse(string roomId, AccuseRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var result = await _gameplayService.AccuseAsync(roomId, GetUserId(), request, cancellationToken);
            await _hubContext.Clients.Group(roomId).SendAsync("GameCompleted", result, cancellationToken);
            return Ok(ApiResponse<GameResultResponse>.Ok(result));
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<object>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<object>.Fail(ex.Message));
        }
    }

    private string GetUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;

    private async Task BroadcastGameStateAsync(string roomId, GameStateResponse state, CancellationToken cancellationToken)
    {
        await _hubContext.Clients.Group(roomId).SendAsync("GameStateUpdated", state, cancellationToken);
    }

    private async Task BroadcastNewCluesAsync(
        string roomId,
        string sourceId,
        GameStateResponse before,
        GameStateResponse state,
        CancellationToken cancellationToken)
    {
        var newClueIds = state.FoundClueIds
            .Where(clueId => !before.FoundClueIds.Contains(clueId, StringComparer.OrdinalIgnoreCase))
            .ToList();

        foreach (var clueId in newClueIds)
        {
            await _hubContext.Clients.Group(roomId).SendAsync("ClueUnlocked", new
            {
                roomId,
                clueId,
                sourceId,
                userId = GetUserId()
            }, cancellationToken);
        }
    }
}
