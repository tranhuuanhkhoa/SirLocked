using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.API.DTOs.Admin;
using SirLocked.API.Helpers;
using SirLocked.API.Services;

namespace SirLocked.API.Controllers;

[ApiController]
[Authorize(Policy = "AdminOnly")]
[Route("api/admin/ai-cases")]
public sealed class AiCaseController : ControllerBase
{
    private readonly IAiCaseService _aiCaseService;

    public AiCaseController(IAiCaseService aiCaseService)
    {
        _aiCaseService = aiCaseService;
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateAiCaseRequest request, CancellationToken cancellationToken)
    {
        var draft = await _aiCaseService.CreateDraftAsync(request, cancellationToken);
        return Ok(ApiResponse<AiCaseDraftResponse>.Ok(draft, "AI case draft created."));
    }
}
