using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Leaderboard;
using SirLocked.Api.DTOs.Weekly;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Weekly features: public read endpoints under api/workshop/weekly, admin write endpoints under
/// api/admin/weekly. Admin auth reuses the existing [Authorize(Roles="ADMIN")] mechanism.
/// The challenge reward (the caller's weekly chest) needs a signed-in player.
/// </summary>
[Route("api/workshop/weekly")]
public class WeeklyController : BaseApiController
{
    private readonly IWeeklyService _weekly;
    private readonly WeeklyDropService _drops;

    public WeeklyController(IWeeklyService weekly, WeeklyDropService drops)
    {
        _weekly = weekly;
        _drops = drops;
    }

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

    /// <summary>The caller's chest of this week and every chest still waiting for room.</summary>
    [HttpGet("challenge/reward")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<WeeklyRewardDto>>> ChallengeReward(CancellationToken ct) =>
        Ok(await _drops.GetMineAsync(CallerId, ct));

    /// <summary>What the caller's game in this room did for their weekly chest (the result page).</summary>
    [HttpGet("challenge/reward/{roomId}")]
    [Authorize]
    [EnableRateLimiting("chests")]
    public async Task<ActionResult<ApiResponse<WeeklyDropStatusDto>>> ChallengeRewardForRoom(string roomId, CancellationToken ct) =>
        Ok(await _drops.GetForRoomAsync(CallerId, roomId, ct));

    /// <summary>Puts a waiting chest in the caller's bag. 404 WEEKLY_DROP_NOT_FOUND if not theirs, 409 SLOTS_FULL if the bag is still full.</summary>
    [HttpPost("challenge/reward/{dropId}/claim")]
    [Authorize]
    [EnableRateLimiting("chests")]
    public async Task<ActionResult<ApiResponse<WeeklyDropDto>>> ClaimChallengeReward(string dropId, CancellationToken ct) =>
        Ok(await _drops.ClaimAsync(Caller, dropId, ct));
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
