using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.DTOs.Users;
using SirLocked.API.Helpers;
using SirLocked.API.Repositories;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize]
[Route("api/users")]
public sealed class UsersController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly IGameplayRepository _gameplayRepository;

    public UsersController(IUserService userService, IGameplayRepository gameplayRepository)
    {
        _userService = userService;
        _gameplayRepository = gameplayRepository;
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

    [HttpGet("me/results")]
    public async Task<IActionResult> MyResults(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return Unauthorized(ApiResponse<object>.Fail("Missing user identity."));
        }

        var results = await _gameplayRepository.GetResultsByUserAsync(userId, 50, cancellationToken);
        var response = results.Select(AdminService.MapResult).ToList();
        return Ok(ApiResponse<IReadOnlyList<GameResultResponse>>.Ok(response));
    }
}
