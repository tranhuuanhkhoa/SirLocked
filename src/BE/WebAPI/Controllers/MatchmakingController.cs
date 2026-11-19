using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Matchmaking;
using SirLocked.Api.Services;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Find game: queue, poll, accept or decline. Every action works on the caller's own ticket or on a
/// match the caller belongs to; pushes arrive as "MatchmakingUpdated" on /hubs/game.
/// </summary>
[Route("api/matchmaking")]
[Authorize]
public class MatchmakingController : BaseApiController
{
    private readonly MatchmakingService _matchmaking;

    public MatchmakingController(MatchmakingService matchmaking) => _matchmaking = matchmaking;

    [HttpPost("queue")]
    public async Task<ActionResult<ApiResponse<MatchmakingStatusResponse>>> Enqueue([FromBody] EnqueueMatchRequest request, CancellationToken ct) =>
        Ok(await _matchmaking.EnqueueAsync(Caller, request, ct), "Searching for a partner.");

    /// <summary>Current state; while searching it also keeps the ticket alive (poll every few seconds).</summary>
    [HttpGet("status")]
    public async Task<ActionResult<ApiResponse<MatchmakingStatusResponse>>> Status(CancellationToken ct) =>
        Ok(await _matchmaking.GetStatusAsync(CallerId, heartbeat: true, ct));

    /// <summary>Leaves the queue; a match waiting for confirmation is declined.</summary>
    [HttpPost("cancel")]
    public async Task<ActionResult<ApiResponse<MatchmakingStatusResponse>>> Cancel(CancellationToken ct) =>
        Ok(await _matchmaking.CancelAsync(Caller, ct), "Search cancelled.");

    [HttpPost("matches/{matchId}/accept")]
    public async Task<ActionResult<ApiResponse<MatchmakingStatusResponse>>> Accept(string matchId, CancellationToken ct) =>
        Ok(await _matchmaking.AcceptAsync(Caller, matchId, ct), "Match accepted.");

    [HttpPost("matches/{matchId}/decline")]
    public async Task<ActionResult<ApiResponse<MatchmakingStatusResponse>>> Decline(string matchId, CancellationToken ct) =>
        Ok(await _matchmaking.DeclineAsync(Caller, matchId, ct), "Match declined.");
}
