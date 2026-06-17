using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/game/rooms/{roomId}")]
[Authorize]
public class GameController : BaseApiController
{
    private readonly IGameplayService _gameplayService;

    public GameController(IGameplayService gameplayService) => _gameplayService = gameplayService;

    [HttpGet("state")]
    public async Task<ActionResult<ApiResponse<GameStateResponse>>> GetState(string roomId) =>
        Ok(await _gameplayService.GetStateAsync(CallerId, roomId));

    [HttpPost("inspect-item")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> InspectItem(string roomId, [FromBody] InspectItemRequest request) =>
        Ok(await _gameplayService.InspectItemAsync(Caller, roomId, request.ItemId));

    [HttpPost("capture-clue")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> CaptureClue(string roomId, [FromBody] CaptureClueRequest request) =>
        Ok(await _gameplayService.CaptureClueAsync(Caller, roomId, request));

    [HttpPost("ask-dialogue")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> AskDialogue(string roomId, [FromBody] AskDialogueRequest request) =>
        Ok(await _gameplayService.AskDialogueAsync(Caller, roomId, request.DialogueId));

    [HttpPost("present-evidence")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> PresentEvidence(string roomId, [FromBody] PresentEvidenceRequest request) =>
        Ok(await _gameplayService.PresentEvidenceAsync(Caller, roomId, request.DialogueId, request.EvidenceId));

    [HttpPost("complete-scene")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> CompleteScene(string roomId) =>
        Ok(await _gameplayService.CompleteSceneAsync(Caller, roomId));

    [HttpPost("complete-stage")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> CompleteStage(string roomId) =>
        Ok(await _gameplayService.CompleteStageAsync(Caller, roomId));

    [HttpPost("go-to-scene")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> GoToScene(string roomId, [FromBody] GoToSceneRequest request) =>
        Ok(await _gameplayService.GoToSceneAsync(Caller, roomId, request.SceneId));

    [HttpPost("accuse")]
    public async Task<ActionResult<ApiResponse<GameResultResponse>>> Accuse(string roomId, [FromBody] AccuseRequest request) =>
        Ok(await _gameplayService.AccuseAsync(Caller, roomId, request));

    [HttpGet("result")]
    public async Task<ActionResult<ApiResponse<GameResultResponse>>> GetResult(string roomId) =>
        Ok(await _gameplayService.GetResultAsync(CallerId, roomId));
}
