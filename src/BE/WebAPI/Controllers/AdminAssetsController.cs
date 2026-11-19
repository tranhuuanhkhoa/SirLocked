using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Picture uploads for the admin pages. See AdminAssetProcessor for what is accepted.</summary>
[Route("api/admin/assets")]
[Authorize(Roles = UserRole.Admin)]
public class AdminAssetsController : BaseApiController
{
    // Room above the limit so a file just over it gets the clear ASSET_TOO_LARGE instead of a bare 413.
    private const long RequestLimit = AdminAssetProcessor.MaxBytes + 1024 * 1024;

    private readonly AdminAssetService _assets;

    public AdminAssetsController(AdminAssetService assets) => _assets = assets;

    [HttpPost]
    [RequestSizeLimit(RequestLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = RequestLimit)]
    public async Task<ActionResult<ApiResponse<AdminAssetDto>>> Upload(IFormFile? file, CancellationToken ct)
    {
        if (file is null) return Ok(await _assets.UploadAsync(Caller, Array.Empty<byte>(), null, ct));
        if (file.Length > AdminAssetProcessor.MaxBytes) throw AdminAssetProcessor.TooLarge();
        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        return Ok(await _assets.UploadAsync(Caller, buffer.ToArray(), file.FileName, ct));
    }
}
