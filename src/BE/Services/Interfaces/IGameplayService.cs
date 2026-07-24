using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;

namespace SirLocked.Api.Services.Interfaces;

public interface IGameplayService
{
    Task<GameStateResponse> GetStateAsync(string userId, string roomId);
    Task<GameActionResponse> InspectItemAsync(CurrentUser user, string roomId, string itemId);
    Task<GameActionResponse> UseItemAsync(CurrentUser user, string roomId, UseItemRequest request);
    Task<GameActionResponse> CombineItemsAsync(CurrentUser user, string roomId, CombineItemsRequest request);
    Task<GameActionResponse> ActivateEnvironmentInteractionAsync(CurrentUser user, string roomId, string interactionId);
    Task<GameActionResponse> SolvePuzzleAsync(CurrentUser user, string roomId, SolvePuzzleRequest request);
    Task<GameActionResponse> CaptureClueAsync(CurrentUser user, string roomId, CaptureClueRequest request);
    Task<EvidencePhotoContent> GetEvidencePhotoAsync(string userId, string roomId, string clueId);
    Task<GameActionResponse> AskDialogueAsync(CurrentUser user, string roomId, string dialogueId);
    Task<ConverseResponse> ConverseAsync(CurrentUser user, string roomId, ConverseRequest request);
    Task<GameActionResponse> PresentEvidenceAsync(CurrentUser user, string roomId, PresentEvidenceRequest request);
    Task<HintResponse> RequestHintAsync(CurrentUser user, string roomId, HintRequest request);
    Task<GameActionResponse> SolveDeductionAsync(CurrentUser user, string roomId, SolveDeductionRequest request);
    Task<GameActionResponse> CompleteSceneAsync(CurrentUser user, string roomId);
    Task<GameActionResponse> CompleteStageAsync(CurrentUser user, string roomId);
    Task<GameActionResponse> GoToSceneAsync(CurrentUser user, string roomId, string sceneId);
    Task<GameResultResponse> AccuseAsync(CurrentUser user, string roomId, AccuseRequest request);
    Task<GameResultResponse> GetResultAsync(string userId, string roomId);
}

public sealed record EvidencePhotoContent(byte[] Data, string ContentType);
