using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Cutscene;
using SirLocked.Api.Services.Cutscene;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/cases/{caseId}/cutscene")]
[Authorize(Roles = "ADMIN")]
public class AdminCutscenesController(CutsceneService cutscenes) : BaseApiController
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<AdminCutsceneDto>>> Get(string caseId, CancellationToken ct) =>
        Ok(await cutscenes.GetAdminAsync(caseId, ct));

    /// <summary>First generation is free to call; generating again needs <c>regenerate: true</c> because it costs AI budget.</summary>
    [HttpPost("generate")]
    public async Task<ActionResult<ApiResponse<AdminCutsceneDto>>> Generate(string caseId, [FromBody] CutsceneGenerateRequest? request, CancellationToken ct) =>
        Ok(await cutscenes.GenerateAsync(caseId, request?.Regenerate ?? false, Caller.Id, ct), "Cutscene draft created.");

    [HttpPut("{id}/script")]
    public async Task<ActionResult<ApiResponse<AdminCutsceneDto>>> UpdateScript(string caseId, string id, [FromBody] CutsceneScriptUpdateRequest request, CancellationToken ct) =>
        Ok(await cutscenes.UpdateScriptAsync(caseId, id, request.Script, Caller.Id, ct), "Cutscene saved.");

    [HttpPost("{id}/approve")]
    public async Task<ActionResult<ApiResponse<AdminCutsceneDto>>> Approve(string caseId, string id, CancellationToken ct) =>
        Ok(await cutscenes.ApproveAsync(caseId, id, Caller.Id, ct), "Cutscene approved.");

    [HttpPost("disable")]
    public async Task<ActionResult<ApiResponse<AdminCutsceneDto>>> Disable(string caseId, CancellationToken ct) =>
        Ok(await cutscenes.DisableAsync(caseId, ct), "Cutscene hidden from players.");

    /// <summary>The approved script as JSON, to commit as SeedData/Cutscenes/{caseId}.intro.json.</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export(string caseId, CancellationToken ct)
    {
        var json = await cutscenes.ExportApprovedAsync(caseId, ct);
        return json is null ? NotFound(ApiResponse<object>.Fail("No approved cutscene to export.")) : Content(json, "application/json");
    }
}
