using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.DTOs.Playtest;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin")]
[Authorize(Roles = "ADMIN")]
public class AdminController : BaseApiController
{
    private readonly IAdminService _adminService;
    private readonly PlaytestSummaryService _playtestSummary;
    private readonly GameplayV3Settings _gameplayV3;

    public AdminController(
        IAdminService adminService,
        PlaytestSummaryService playtestSummary,
        IOptions<GameplayV3Settings> gameplayV3)
    {
        _adminService = adminService;
        _playtestSummary = playtestSummary;
        _gameplayV3 = gameplayV3.Value;
    }

    [HttpGet("dashboard")]
    public async Task<ActionResult<ApiResponse<object>>> Dashboard() =>
        Ok(await _adminService.GetDashboardAsync());

    [HttpGet("users")]
    public async Task<ActionResult<ApiResponse<List<UserResponse>>>> Users() =>
        Ok(await _adminService.GetUsersAsync());

    [HttpPatch("users/{userId}/lock")]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Lock(string userId) =>
        Ok(await _adminService.SetUserStatusAsync(userId, UserStatus.Locked), "User locked.");

    [HttpPatch("users/{userId}/unlock")]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Unlock(string userId) =>
        Ok(await _adminService.SetUserStatusAsync(userId, UserStatus.Active), "User unlocked.");

    [HttpPatch("users/{userId}/role")]
    public async Task<ActionResult<ApiResponse<UserResponse>>> SetRole(string userId, [FromBody] SetUserRoleRequest request) =>
        Ok(await _adminService.SetUserRoleAsync(userId, request.Role), "User role updated.");

    /// <summary>Playtest aggregates. 404 while instrumentation is off, so callers can hide the panel.</summary>
    [HttpGet("playtest/summary")]
    public async Task<ActionResult<ApiResponse<PlaytestSummaryResponse>>> PlaytestSummary(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        if (!_gameplayV3.Enabled || !_gameplayV3.PlaytestInstrumentationEnabled)
        {
            throw ApiException.NotFound("Playtest instrumentation is not enabled.");
        }
        return Ok(await _playtestSummary.GetSummaryAsync(from, to, cancellationToken));
    }
}
