using SirLocked.API.DTOs.Investigation;

namespace SirLocked.API.Services;

public interface IGameplayService
{
    Task<GameStateResponse> GetStateAsync(string roomId, CancellationToken cancellationToken = default);
    Task<GameStateResponse> InspectItemAsync(string roomId, string userId, InspectItemRequest request, CancellationToken cancellationToken = default);
    Task<GameStateResponse> AskDialogueAsync(string roomId, string userId, AskDialogueRequest request, CancellationToken cancellationToken = default);
    Task<GameStateResponse> PresentEvidenceAsync(string roomId, string userId, PresentEvidenceRequest request, CancellationToken cancellationToken = default);
    Task<GameStateResponse> CompleteSceneAsync(string roomId, string userId, CancellationToken cancellationToken = default);
    Task<GameStateResponse> CompleteStageAsync(string roomId, string userId, CancellationToken cancellationToken = default);
    Task<GameResultResponse> AccuseAsync(string roomId, string userId, AccuseRequest request, CancellationToken cancellationToken = default);
}
