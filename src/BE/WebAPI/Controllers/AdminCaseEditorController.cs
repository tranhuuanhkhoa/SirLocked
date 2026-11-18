using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.CaseEditor;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.CaseEditor;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Case Studio (/admin/editor/{caseId}): an admin edits an unpublished case (usually one the bot just imported) and
/// publishes it once it looks right. VIP authors are not let in: publishing stays the owner's decision.
/// </summary>
[Route("api/admin/case-editor")]
[Authorize(Roles = UserRole.Admin)]
public class AdminCaseEditorController : BaseApiController
{
    private readonly CaseEditorService _editor;

    public AdminCaseEditorController(CaseEditorService editor) => _editor = editor;

    [HttpGet("{caseId}")]
    public async Task<ActionResult<ApiResponse<CaseEditorResponse>>> Open(string caseId) =>
        Ok(await _editor.OpenAsync(Caller, caseId));

    /// <summary>Autosave (checkpoint false) and "Lưu phiên bản" (checkpoint true).</summary>
    [HttpPut("{caseId}")]
    [RequestSizeLimit(8 * 1024 * 1024)]
    public async Task<ActionResult<ApiResponse<CaseEditorSaveResponse>>> Save(string caseId, [FromBody] CaseEditorSaveRequest request) =>
        Ok(await _editor.SaveAsync(Caller, caseId, request), "Đã lưu.");

    [HttpGet("{caseId}/revisions")]
    public async Task<ActionResult<ApiResponse<List<CaseEditorRevisionSummary>>>> Revisions(string caseId) =>
        Ok(await _editor.ListRevisionsAsync(caseId));

    [HttpGet("{caseId}/revisions/{number:int}")]
    public async Task<ActionResult<ApiResponse<CaseEditorRevisionResponse>>> Revision(string caseId, int number) =>
        Ok(await _editor.GetRevisionAsync(caseId, number));

    [HttpPost("{caseId}/revisions/{number:int}/restore")]
    public async Task<ActionResult<ApiResponse<CaseEditorResponse>>> Restore(
        string caseId, int number, [FromBody] CaseEditorVersionRequest request) =>
        Ok(await _editor.RestoreAsync(Caller, caseId, number, request), $"Đã khôi phục bản #{number}.");

    [HttpPost("{caseId}/publish")]
    public async Task<ActionResult<ApiResponse<CaseEditorPublishResponse>>> Publish(
        string caseId, [FromBody] CaseEditorVersionRequest request) =>
        Ok(await _editor.PublishAsync(Caller, caseId, request), "Đã xuất bản.");

    [HttpPost("{caseId}/playtest")]
    public async Task<ActionResult<ApiResponse<RoomResponse>>> Playtest(string caseId, [FromBody] CaseEditorPlaytestRequest request) =>
        Ok(await _editor.PlaytestAsync(Caller, caseId, request), "Phòng chơi thử đã sẵn sàng.");
}
