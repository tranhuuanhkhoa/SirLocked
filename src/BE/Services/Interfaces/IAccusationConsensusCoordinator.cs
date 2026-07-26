using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Submission;

namespace SirLocked.Api.Services.Interfaces;

public interface IAccusationConsensusCoordinator
{
    Task<AccusationCommandResponse> ProposeAsync(
        CurrentUser user,
        string roomId,
        AccuseRequest request,
        CancellationToken cancellationToken = default);

    Task<AccusationCommandResponse> AmendAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        AmendAccusationRequest request,
        CancellationToken cancellationToken = default);

    Task<AccusationCommandResponse> ConfirmAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        AccusationRevisionRequest request,
        CancellationToken cancellationToken = default);

    Task<AccusationCommandResponse> CancelAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        AccusationRevisionRequest request,
        CancellationToken cancellationToken = default);
}
