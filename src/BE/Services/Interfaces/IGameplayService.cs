using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;

namespace SirLocked.Api.Services.Interfaces;

public interface IGameplayService
{
    Task<GameStateResponse> GetStateAsync(string userId, string roomId);
    Task<GameActionResponse> InspectItemAsync(CurrentUser user, string roomId, string itemId);
    Task<GameActionResponse> AskDialogueAsync(CurrentUser user, string roomId, string dialogueId);
    Task<GameActionResponse> PresentEvidenceAsync(CurrentUser user, string roomId, string dialogueId, string evidenceId);
    Task<GameActionResponse> CompleteSceneAsync(CurrentUser user, string roomId);
    Task<GameActionResponse> CompleteStageAsync(CurrentUser user, string roomId);
    Task<GameActionResponse> GoToSceneAsync(CurrentUser user, string roomId, string sceneId);
    Task<GameResultResponse> AccuseAsync(CurrentUser user, string roomId, AccuseRequest request);
    Task<GameResultResponse> GetResultAsync(string userId, string roomId);
}
