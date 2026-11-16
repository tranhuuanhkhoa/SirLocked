using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Cutscene;
using SirLocked.Api.Services.Cutscene;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/cases")]
[Authorize]
public class CasesController : BaseApiController
{
    private readonly ICaseService _caseService;
    private readonly CutsceneService _cutscenes;
    private readonly IRoomService _rooms;

    public CasesController(ICaseService caseService, CutsceneService cutscenes, IRoomService rooms)
    {
        _caseService = caseService;
        _cutscenes = cutscenes;
        _rooms = rooms;
    }

    /// <summary>A member of a playtest room of this (unpublished) case may read it like a published one.</summary>
    private async Task<bool> PlaytestAsync(string caseId, string? roomId) =>
        !string.IsNullOrWhiteSpace(roomId) && await _rooms.IsPlaytestMemberAsync(CallerId, roomId, caseId);

    [HttpGet("published")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryResponse>>>> GetPublished() =>
        Ok(await _caseService.GetPublishedAsync());

    /// <summary><paramref name="roomId"/>: a playtest room the caller sits in, for a case that is not published.</summary>
    [HttpGet("{caseId}")]
    public async Task<ActionResult<ApiResponse<CasePublicDetailResponse>>> GetDetail(string caseId, [FromQuery] string? roomId = null) =>
        Ok(await PlaytestAsync(caseId, roomId)
            ? CasePublicDetailResponse.FromCase(await _caseService.GetCaseAsync(caseId))
            : await _caseService.GetPublicDetailAsync(caseId));

    /// <summary>
    /// The approved intro cutscene of a case a player can open. <c>data</c> is null when there is none (also for hidden
    /// or unpublished cases and drafts), which the client treats as "go straight to the investigation".
    /// </summary>
    [HttpGet("{caseId}/intro-cutscene")]
    public async Task<ActionResult<ApiResponse<PlayerCutsceneDto?>>> GetIntroCutscene(string caseId, CancellationToken ct, [FromQuery] string? roomId = null) =>
        Ok(await _cutscenes.GetPlayerIntroAsync(caseId, ct, playtest: await PlaytestAsync(caseId, roomId)));
}
