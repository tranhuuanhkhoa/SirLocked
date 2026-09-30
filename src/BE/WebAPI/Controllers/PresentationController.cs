using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;

namespace SirLocked.Api.WebAPI.Controllers;

[Authorize(Roles = UserRole.Admin + "," + UserRole.Vip)]
[Route("api/admin/ai-cases/{draftId}/presentation")]
public sealed class PresentationController(PresentationService service) : BaseApiController
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> Get(string draftId, CancellationToken ct) => Ok(await service.GetAsync(Caller, draftId, ct));
    [HttpPut]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> Update(string draftId, PresentationUpdateRequest request, CancellationToken ct) =>
        Ok(await service.UpdateAsync(Caller, draftId, request, ct));
    [HttpPost("generate")]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> Generate(string draftId, PresentationGenerateRequest request, CancellationToken ct) =>
        Accepted(await service.GenerateAsync(Caller, draftId, request, ct), "Presentation jobs queued after budget approval.");
    [HttpPost("clips/{clipId}/approve")]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> ApproveClip(string draftId, string clipId, PresentationRevisionRequest request, CancellationToken ct) =>
        Ok(await service.ApproveAsync(Caller, draftId, request.ExpectedVersion, clipId, ct));
    [HttpPost("clips/{clipId}/generate")]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> GenerateClip(string draftId, string clipId, PresentationGenerateRequest request, CancellationToken ct) =>
        Accepted(await service.GenerateAsync(Caller, draftId, request, ct, clipId), "Only the selected clip was queued.");
    [HttpPost("approve")]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> Approve(string draftId, PresentationRevisionRequest request, CancellationToken ct) =>
        Ok(await service.ApproveAsync(Caller, draftId, request.ExpectedVersion, null, ct));
    [HttpPost("clips/{clipId}/recover")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<PresentationAdminResponse>>> Recover(string draftId, string clipId, PresentationRecoveryRequest request, CancellationToken ct)
    {
        await service.RecoverAsync(Caller, draftId, clipId, request.ProviderRequestId, ct);
        return Ok(await service.GetAsync(Caller, draftId, ct));
    }
    [HttpGet("media/{assetId}")]
    public async Task<IActionResult> Media(string draftId, string assetId, CancellationToken ct)
    {
        var result = await service.ReadAdminMediaAsync(Caller, draftId, assetId, ct);
        Response.Headers.CacheControl = "private, no-store";
        return File(result.Bytes, result.ContentType, enableRangeProcessing: true);
    }
}

public class PresentationRecoveryRequest { public string ProviderRequestId { get; set; } = string.Empty; }

[Authorize]
[Route("api/game/rooms/{roomId}/presentation/media")]
public sealed class GamePresentationMediaController(PresentationService service) : BaseApiController
{
    [HttpGet("{assetId}")]
    public async Task<IActionResult> Media(string roomId, string assetId, CancellationToken ct)
    {
        var result = await service.ReadGameMediaAsync(CallerId, roomId, assetId, ct);
        Response.Headers.CacheControl = "private, no-store";
        return File(result.Bytes, result.ContentType, enableRangeProcessing: true);
    }
}
