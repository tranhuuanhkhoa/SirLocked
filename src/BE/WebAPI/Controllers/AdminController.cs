using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin")]
[Authorize(Roles = "ADMIN")]
public class AdminController : BaseApiController
{
    private readonly IAdminService _adminService;

    public AdminController(IAdminService adminService) => _adminService = adminService;

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
}
