using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Users;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize(Policy = "AdminOnly")]
[Route("api/admin/users")]
public sealed class AdminUsersController : ControllerBase
{
    private readonly IUserService _userService;

    public AdminUsersController(IUserService userService)
    {
        _userService = userService;
    }

    [HttpGet]
    public async Task<IActionResult> GetUsers(CancellationToken cancellationToken)
    {
        var users = await _userService.GetAllAsync(cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<UserProfileResponse>>.Ok(users));
    }

    [HttpPatch("{id}/lock")]
    public async Task<IActionResult> Lock(string id, CancellationToken cancellationToken)
    {
        var user = await _userService.LockAsync(id, cancellationToken);
        return user is null
            ? NotFound(ApiResponse<object>.Fail("User not found."))
            : Ok(ApiResponse<UserProfileResponse>.Ok(user, "User locked."));
    }

    [HttpPatch("{id}/unlock")]
    public async Task<IActionResult> Unlock(string id, CancellationToken cancellationToken)
    {
        var user = await _userService.UnlockAsync(id, cancellationToken);
        return user is null
            ? NotFound(ApiResponse<object>.Fail("User not found."))
            : Ok(ApiResponse<UserProfileResponse>.Ok(user, "User unlocked."));
    }
}
