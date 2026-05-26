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
    [HttpPost("image")]
    public IActionResult UploadImage()
    {
        var response = new UploadImageResponse
        {
            Url = string.Empty,
            Status = "Week 1 Cloudinary placeholder. Real upload starts later."
        };

        return Ok(ApiResponse<UploadImageResponse>.Ok(response));
    }
}
