using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/game/rooms/{roomId}/accusation")]
[Authorize]
public sealed class AccusationsController : BaseApiController
{
    private readonly IAccusationConsensusCoordinator _coordinator;

    public AccusationsController(IAccusationConsensusCoordinator coordinator) =>
        _coordinator = coordinator;

    [HttpPost]
    public async Task<ActionResult<ApiResponse<AccusationCommandResponse>>> Propose(
        string roomId,
        [FromBody] AccuseRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.ProposeAsync(Caller, roomId, request, cancellationToken));

    [HttpPut("{attemptId}")]
    public async Task<ActionResult<ApiResponse<AccusationCommandResponse>>> Amend(
        string roomId,
        string attemptId,
        [FromBody] AmendAccusationRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.AmendAsync(Caller, roomId, attemptId, request, cancellationToken));

    [HttpPost("{attemptId}/confirm")]
    public async Task<ActionResult<ApiResponse<AccusationCommandResponse>>> Confirm(
        string roomId,
        string attemptId,
        [FromBody] AccusationRevisionRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.ConfirmAsync(Caller, roomId, attemptId, request, cancellationToken));

    [HttpPost("{attemptId}/cancel")]
    public async Task<ActionResult<ApiResponse<AccusationCommandResponse>>> Cancel(
        string roomId,
        string attemptId,
        [FromBody] AccusationRevisionRequest request,
        CancellationToken cancellationToken) =>
        Ok(await _coordinator.CancelAsync(Caller, roomId, attemptId, request, cancellationToken));
}
