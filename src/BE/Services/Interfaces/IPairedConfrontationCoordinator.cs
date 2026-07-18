using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;

namespace SirLocked.Api.Services.Interfaces;

public interface IPairedConfrontationCoordinator
{
    Task<PairedConfrontationCommandResponse> StartAsync(
        CurrentUser user,
        string roomId,
        StartPairedConfrontationRequest request,
        CancellationToken cancellationToken = default);

    Task<PairedConfrontationCommandResponse> EditTestimonyAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        EditPairedTestimonyRequest request,
        CancellationToken cancellationToken = default);

    Task<PairedConfrontationCommandResponse> SubmitEvidenceAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        SubmitPairedEvidenceRequest request,
        CancellationToken cancellationToken = default);

    Task<PairedConfrontationCommandResponse> ConfirmAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        PairedConfrontationRevisionRequest request,
        CancellationToken cancellationToken = default);

    Task<PairedConfrontationCommandResponse> CancelAsync(
        CurrentUser user,
        string roomId,
        string attemptId,
        PairedConfrontationRevisionRequest request,
        CancellationToken cancellationToken = default);
}
