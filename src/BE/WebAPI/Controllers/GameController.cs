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

    [HttpPost("use-item")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> UseItem(string roomId, [FromBody] UseItemRequest request) =>
        Ok(await _gameplayService.UseItemAsync(Caller, roomId, request));

    [HttpPost("combine-items")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> CombineItems(string roomId, [FromBody] CombineItemsRequest request) =>
        Ok(await _gameplayService.CombineItemsAsync(Caller, roomId, request));

    [HttpPost("interactions/{interactionId}/activate")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> ActivateEnvironmentInteraction(string roomId, string interactionId) =>
        Ok(await _gameplayService.ActivateEnvironmentInteractionAsync(Caller, roomId, interactionId));

    [HttpPost("solve-puzzle")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> SolvePuzzle(string roomId, [FromBody] SolvePuzzleRequest request) =>
        Ok(await _gameplayService.SolvePuzzleAsync(Caller, roomId, request));

    [HttpPost("capture-clue")]
    [Consumes("multipart/form-data")]
    [RequestFormLimits(MultipartBodyLengthLimit = 1_100_000)]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> CaptureClue(string roomId, [FromForm] CaptureClueRequest request) =>
        Ok(await _gameplayService.CaptureClueAsync(Caller, roomId, request));

    [HttpGet("clues/{clueId}/photo")]
    public async Task<IActionResult> GetEvidencePhoto(string roomId, string clueId)
    {
        var photo = await _gameplayService.GetEvidencePhotoAsync(CallerId, roomId, clueId);
        return File(photo.Data, photo.ContentType);
    }

    [HttpPost("ask-dialogue")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> AskDialogue(string roomId, [FromBody] AskDialogueRequest request) =>
        Ok(await _gameplayService.AskDialogueAsync(Caller, roomId, request.DialogueId));

    [HttpPost("converse")]
    public async Task<ActionResult<ApiResponse<ConverseResponse>>> Converse(string roomId, [FromBody] ConverseRequest request) =>
        Ok(await _gameplayService.ConverseAsync(Caller, roomId, request));

    [HttpPost("present-evidence")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> PresentEvidence(string roomId, [FromBody] PresentEvidenceRequest request) =>
        Ok(await _gameplayService.PresentEvidenceAsync(Caller, roomId, request));

    [HttpPost("hint")]
    public async Task<ActionResult<ApiResponse<HintResponse>>> Hint(string roomId, [FromBody] HintRequest request) =>
        Ok(await _gameplayService.RequestHintAsync(Caller, roomId, request));

    [HttpPost("solve-deduction")]
    public async Task<ActionResult<ApiResponse<GameActionResponse>>> SolveDeduction(string roomId, [FromBody] SolveDeductionRequest request) =>
        Ok(await _gameplayService.SolveDeductionAsync(Caller, roomId, request));

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
