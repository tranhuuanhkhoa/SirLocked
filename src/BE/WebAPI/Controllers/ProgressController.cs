using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Hồ sơ thám tử: level and XP, exchanging items for XP, choosing an avatar.</summary>
[Route("api/progress")]
[Authorize]
public class ProgressController : BaseApiController
{
    private readonly ProgressService _progress;

    public ProgressController(ProgressService progress) => _progress = progress;

    [HttpGet("me")]
    public async Task<ActionResult<ApiResponse<ProgressDto>>> Me(CancellationToken ct) =>
        Ok(await _progress.GetMeAsync(CallerId, ct));

    [HttpGet("users/{userId}")]
    public async Task<ActionResult<ApiResponse<PlayerCosmeticsDto>>> Public(string userId, CancellationToken ct) =>
        Ok(await _progress.GetPublicAsync(userId, ct));

    [HttpPost("exchange")]
    [EnableRateLimiting("chests")]
    public async Task<ActionResult<ApiResponse<ExchangeResultDto>>> Exchange([FromBody] ProgressExchangeRequest request, CancellationToken ct) =>
        Ok(await _progress.ExchangeAsync(Caller, request.ItemIds, request.IdempotencyKey, ct));

    [HttpPost("avatar")]
    public async Task<ActionResult<ApiResponse<ProgressDto>>> SetAvatar([FromBody] SetAvatarRequest request, CancellationToken ct) =>
        Ok(await _progress.SetAvatarAsync(CallerId, request.Avatar, ct));

    [HttpPost("avatar/upload")]
    [EnableRateLimiting("chests")]
    [RequestSizeLimit(AvatarImageProcessor.MaxBytes + 64 * 1024)]
    public async Task<ActionResult<ApiResponse<ProgressDto>>> UploadAvatar(IFormFile file, CancellationToken ct)
    {
        if (file.Length > AvatarImageProcessor.MaxBytes)
            throw MarketService.Error(400, AvatarErrors.TooLarge, "The picture must be 2 MB or smaller.");
        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        return Ok(await _progress.UploadAvatarAsync(CallerId, buffer.ToArray(), ct));
    }
}
