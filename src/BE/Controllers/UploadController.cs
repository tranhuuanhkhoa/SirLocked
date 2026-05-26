using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Admin;
using SirLocked.API.Helpers;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize(Policy = "AdminOnly")]
[Route("api/uploads")]
public sealed class UploadController : ControllerBase
{
    private readonly IWebHostEnvironment _environment;

    public UploadController(IWebHostEnvironment environment)
    {
        _environment = environment;
    }

    [HttpPost("image")]
    [RequestSizeLimit(5_000_000)]
    public async Task<IActionResult> UploadImage(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(ApiResponse<object>.Fail("Image file is required."));
        }

        var extension = Path.GetExtension(file.FileName);
        var assetName = $"{Guid.NewGuid():N}{extension}";
        var targetDirectory = Path.Combine(_environment.ContentRootPath, "wwwroot", "mock-uploads");
        Directory.CreateDirectory(targetDirectory);
        var targetPath = Path.Combine(targetDirectory, assetName);

        await using (var stream = System.IO.File.Create(targetPath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var response = new UploadImageResponse
        {
            Url = $"/mock-uploads/{assetName}",
            Status = "MOCK_UPLOADED"
        };

        return Ok(ApiResponse<UploadImageResponse>.Ok(response));
    }
}
