using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Weekly features: public read endpoints under api/workshop/weekly, admin write endpoints under
/// api/admin/weekly. Admin auth reuses the existing [Authorize(Roles="ADMIN")] mechanism.
/// </summary>
[Route("api/workshop/weekly")]
public class WeeklyController : BaseApiController
{
    private readonly IWeeklyService _weekly;

    public WeeklyController(IWeeklyService weekly) => _weekly = weekly;

    [HttpGet("case-of-week")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<WeeklyFeatureDto?>>> CaseOfWeek() =>
        Ok(await _weekly.GetActiveCaseOfWeekAsync());

    [HttpGet("challenge")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<WeeklyFeatureDto?>>> GetChallenge() =>
        Ok(await _weekly.GetActiveChallengeAsync());

    [HttpGet("challenge/leaderboard")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<LeaderboardDto>>> ChallengeLeaderboard([FromQuery] int limit = 100) =>
        Ok(await _weekly.GetChallengeLeaderboardAsync(limit));
}

/// <summary>Admin-only weekly feature management. Same controller family, admin-gated route.</summary>
[Route("api/admin/weekly")]
[Authorize(Roles = "ADMIN")]
public class AdminWeeklyController : BaseApiController
{
    private readonly IWeeklyService _weekly;

    public AdminWeeklyController(IWeeklyService weekly) => _weekly = weekly;

    [HttpPost]
    public async Task<ActionResult<ApiResponse<WeeklyFeatureDto>>> Set([FromBody] SetWeeklyFeatureRequest request) =>
        Ok(await _weekly.SetWeeklyFeatureAsync(Caller, request), "Weekly feature updated.");

    [HttpDelete("{type}")]
    public async Task<ActionResult<ApiResponse<bool>>> Clear(string type) =>
        Ok(await _weekly.ClearWeeklyFeatureAsync(Caller, type), "Weekly feature cleared.");
}
