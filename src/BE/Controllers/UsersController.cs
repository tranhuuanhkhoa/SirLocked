using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Users;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/users")]
public sealed class UsersController : ControllerBase
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService)
    {
        _userService = userService;
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return Unauthorized(ApiResponse<object>.Fail("Missing user identity."));
        }

        var user = await _userService.GetByIdAsync(userId, cancellationToken);
        return user is null
            ? NotFound(ApiResponse<object>.Fail("User not found."))
            : Ok(ApiResponse<UserProfileResponse>.Ok(user));
    }

    [HttpPatch("me/profile")]
    public async Task<IActionResult> UpdateProfile(UpdateProfileRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return Unauthorized(ApiResponse<object>.Fail("Missing user identity."));
        }

        var user = await _userService.UpdateProfileAsync(userId, request, cancellationToken);
        return user is null
            ? NotFound(ApiResponse<object>.Fail("User not found."))
            : Ok(ApiResponse<UserProfileResponse>.Ok(user, "Profile updated."));
    }
}
