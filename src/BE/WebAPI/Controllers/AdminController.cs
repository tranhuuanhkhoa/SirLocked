using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.DTOs.Playtest;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Security;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin")]
[Authorize(Roles = "ADMIN")]
public class AdminController : BaseApiController
{
    private readonly IAdminService _adminService;
    private readonly PlaytestSummaryService _playtestSummary;
    private readonly GameplayV3Settings _gameplayV3;
    private readonly IAdminAudit _audit;
    private readonly AdminPlayersService _players;
    private readonly AdminSecurityService _adminSecurity;

    public AdminController(
        IAdminService adminService,
        PlaytestSummaryService playtestSummary,
        IOptions<GameplayV3Settings> gameplayV3,
        IAdminAudit audit,
        AdminPlayersService players,
        AdminSecurityService adminSecurity)
    {
        _adminService = adminService;
        _playtestSummary = playtestSummary;
        _gameplayV3 = gameplayV3.Value;
        _audit = audit;
        _players = players;
        _adminSecurity = adminSecurity;
    }

    [HttpGet("dashboard")]
    public async Task<ActionResult<ApiResponse<object>>> Dashboard() =>
        Ok(await _adminService.GetDashboardAsync());

    [HttpGet("users")]
    [Authorize(Policy = AdminPolicies.Players)]
    public async Task<ActionResult<ApiResponse<List<UserResponse>>>> Users() =>
        Ok(await _adminService.GetUsersAsync());

    [HttpPatch("users/{userId}/lock")]
    [Authorize(Policy = AdminPolicies.Players)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Lock(string userId, [FromQuery] string? reason) =>
        Ok(await AuditedAsync(userId, "player.lock", reason, () => _adminService.SetUserStatusAsync(userId, UserStatus.Locked)), "User locked.");

    [HttpPatch("users/{userId}/unlock")]
    [Authorize(Policy = AdminPolicies.Players)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Unlock(string userId, [FromQuery] string? reason) =>
        Ok(await AuditedAsync(userId, "player.unlock", reason, () => _adminService.SetUserStatusAsync(userId, UserStatus.Active)), "User unlocked.");

    [HttpPatch("users/{userId}/role")]
    [Authorize(Policy = AdminPolicies.Roles)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<UserResponse>>> SetRole(string userId, [FromBody] SetUserRoleRequest request, [FromQuery] string? reason) =>
        Ok(await AuditedAsync(userId, "player.role", reason, () => _adminService.SetUserRoleAsync(userId, request.Role)), "User role updated.");

    [HttpPatch("users/{userId}/admin-role")]
    [Authorize(Policy = AdminPolicies.Roles)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<UserResponse>>> SetAdminRole(
        string userId, [FromBody] SetAdminRoleRequest request, CancellationToken ct)
    {
        var before = await _adminService.GetUserAsync(userId);
        var updated = await _adminService.SetAdminRoleAsync(userId, request.AdminRole);
        await _audit.LogAsync(Caller, "admin.role", "user", userId,
            new { adminRole = before.AdminRole }, new { adminRole = updated.AdminRole }, ct: ct);
        return Ok(updated, "Admin role updated.");
    }

    [HttpPost("users/{userId}/2fa/reset")]
    [Authorize(Policy = AdminPolicies.Roles)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<UserResponse>>> ResetTwoFactor(string userId, CancellationToken ct) =>
        Ok(await _adminSecurity.ResetAsync(Caller, userId, ct), "Admin two-factor authentication reset.");

    /// <summary>These routes predate the audit log. They behave as before and now also say what they did; the reason is optional here.</summary>
    private async Task<UserResponse> AuditedAsync(string userId, string action, string? reason, Func<Task<UserResponse>> change)
    {
        var before = await _players.AuditSnapshotAsync(userId);
        var updated = await change();
        await _audit.LogAsync(Caller, action, "user", userId, before, new { status = updated.Status, role = updated.Role }, reason);
        return updated;
    }

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
