using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Tutorial;
using SirLocked.Api.Services;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Màn tân thủ: the Kỳ cựu / Nhập môn choice, starting the solo tutorial room and its role switch.</summary>
[Route("api/tutorial")]
[Authorize]
public class TutorialController : BaseApiController
{
    private readonly ITutorialService _tutorial;

    public TutorialController(ITutorialService tutorial) => _tutorial = tutorial;

    [HttpGet("status")]
    public async Task<ActionResult<ApiResponse<TutorialStatusResponse>>> Status(CancellationToken ct) =>
        Ok(await _tutorial.GetStatusAsync(CallerId, ct));

    [HttpPost("choice")]
    public async Task<ActionResult<ApiResponse<TutorialStatusResponse>>> Choose([FromBody] TutorialChoiceRequest request, CancellationToken ct) =>
        Ok(await _tutorial.ChooseAsync(CallerId, request.Path, ct));

    [HttpPost("start")]
    public async Task<ActionResult<ApiResponse<TutorialStartResponse>>> Start(CancellationToken ct) =>
        Ok(await _tutorial.StartAsync(Caller, ct));

    [HttpPost("rooms/{roomId}/role")]
    public async Task<ActionResult<ApiResponse<object>>> SwitchRole(string roomId, [FromBody] TutorialRoleRequest request, CancellationToken ct)
    {
        await _tutorial.SwitchRoleAsync(Caller, roomId, request.Role, ct);
        return Ok<object>(new { role = request.Role });
    }
}
