using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Profile;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/profile")]
public class ProfileController : BaseApiController
{
    private readonly IProfileService _profiles;

    public ProfileController(IProfileService profiles) => _profiles = profiles;

    // The literal "me" route is matched before the {userId} parameter route by ASP.NET routing.
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<DetectiveProfileDto>>> GetMine(CancellationToken ct = default) =>
        Ok(await _profiles.GetProfileAsync(CallerId, ct));

    [HttpGet("{userId}")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<DetectiveProfileDto>>> Get(string userId, CancellationToken ct = default) =>
        Ok(await _profiles.GetProfileAsync(userId, ct));
}
