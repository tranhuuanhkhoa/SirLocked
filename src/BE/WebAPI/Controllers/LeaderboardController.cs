using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Public per-case leaderboard. Standalone controller sharing the
/// <c>api/workshop/cases/{caseId}</c> prefix; does not touch the Workshop controller.
/// </summary>
[Route("api/workshop/cases/{caseId}/leaderboard")]
public class LeaderboardController : BaseApiController
{
    private readonly ILeaderboardService _leaderboard;

    public LeaderboardController(ILeaderboardService leaderboard) => _leaderboard = leaderboard;

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<LeaderboardDto>>> Get(
        string caseId,
        [FromQuery] string metric = LeaderboardMetrics.Fastest,
        [FromQuery] int limit = 100) =>
        Ok(await _leaderboard.GetCaseLeaderboardAsync(caseId, metric, limit));
}
