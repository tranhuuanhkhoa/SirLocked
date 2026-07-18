using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/game/rooms/{roomId}/paired-confrontations")]
[Authorize]
public sealed class PairedConfrontationsController : BaseApiController
{
    private readonly IPairedConfrontationCoordinator _coordinator;

    public PairedConfrontationsController(IPairedConfrontationCoordinator coordinator) =>
        _coordinator = coordinator;

    [HttpPost]
    public async Task<ActionResult<ApiResponse<PairedConfrontationCommandResponse>>> Start(
        string roomId,
        [FromBody] StartPairedConfrontationRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.StartAsync(Caller, roomId, request, cancellationToken));

    [HttpPut("{attemptId}/testimony")]
    public async Task<ActionResult<ApiResponse<PairedConfrontationCommandResponse>>> EditTestimony(
        string roomId,
        string attemptId,
        [FromBody] EditPairedTestimonyRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.EditTestimonyAsync(Caller, roomId, attemptId, request, cancellationToken));

    [HttpPut("{attemptId}/evidence")]
    public async Task<ActionResult<ApiResponse<PairedConfrontationCommandResponse>>> SubmitEvidence(
        string roomId,
        string attemptId,
        [FromBody] SubmitPairedEvidenceRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.SubmitEvidenceAsync(Caller, roomId, attemptId, request, cancellationToken));

    [HttpPost("{attemptId}/confirm")]
    public async Task<ActionResult<ApiResponse<PairedConfrontationCommandResponse>>> Confirm(
        string roomId,
        string attemptId,
        [FromBody] PairedConfrontationRevisionRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.ConfirmAsync(Caller, roomId, attemptId, request, cancellationToken));

    [HttpPost("{attemptId}/cancel")]
    public async Task<ActionResult<ApiResponse<PairedConfrontationCommandResponse>>> Cancel(
        string roomId,
        string attemptId,
        [FromBody] PairedConfrontationRevisionRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.CancelAsync(Caller, roomId, attemptId, request, cancellationToken));
}
