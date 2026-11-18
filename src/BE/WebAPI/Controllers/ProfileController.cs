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
    public async Task<ActionResult<ApiResponse<DetectiveProfileDto>>> GetMine(
        [FromServices] SirLocked.Api.Services.Vip.AuthorBadgeReader badges, CancellationToken ct = default) =>
        Ok(await badges.FillAsync(await _profiles.GetProfileAsync(CallerId, ct), ct));

    [HttpGet("{userId}")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<DetectiveProfileDto>>> Get(
        string userId, [FromServices] SirLocked.Api.Services.Vip.AuthorBadgeReader badges, CancellationToken ct = default) =>
        Ok(await badges.FillAsync(await _profiles.GetProfileAsync(userId, ct), ct));
}
