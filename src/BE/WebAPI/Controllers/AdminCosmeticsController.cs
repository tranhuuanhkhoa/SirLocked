using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Frames, titles, lobby entrances, how each is obtained, and what an exchanged item pays. The /admin/cosmetics page.</summary>
[Route("api/admin/cosmetics")]
[Authorize(Roles = UserRole.Admin)]
public class AdminCosmeticsController : BaseApiController
{
    private readonly AdminCosmeticsService _cosmetics;

    public AdminCosmeticsController(AdminCosmeticsService cosmetics) => _cosmetics = cosmetics;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AdminCosmeticsPageDto>>> List(CancellationToken ct) =>
        Ok(await _cosmetics.ListAsync(ct));

    [HttpGet("players")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AdminCosmeticPlayerDto>>>> Players([FromQuery] string? q, CancellationToken ct) =>
        Ok(await _cosmetics.SearchPlayersAsync(q, ct));

    [HttpPut("settings/xp")]
    public async Task<ActionResult<ApiResponse<AdminXpSettingsDto>>> SetXp([FromBody] AdminXpSettingsRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.SetXpAsync(Caller, request, ct));

    [HttpGet("{id}")]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> Get(string id, CancellationToken ct) =>
        Ok(await _cosmetics.GetAsync(id, ct));

    [HttpPost]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> Create([FromBody] AdminCosmeticCreateRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.CreateAsync(Caller, request, ct));

    [HttpPut("{id}")]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> Update(string id, [FromBody] AdminCosmeticUpdateRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.UpdateAsync(Caller, id, request, ct));

    [HttpPut("{id}/acquisition")]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> SetAcquisition(string id, [FromBody] AdminCosmeticAcquisitionRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.SetAcquisitionAsync(Caller, id, request, ct));

    [HttpPut("{id}/retired")]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> SetRetired(string id, [FromBody] AdminCosmeticRetireRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.SetRetiredAsync(Caller, id, request, ct));

    [HttpDelete("{id}")]
    public async Task<ActionResult<ApiResponse<object?>>> Delete(string id, [FromQuery] string? reason, CancellationToken ct)
    {
        await _cosmetics.DeleteAsync(Caller, id, reason, ct);
        return Ok<object?>(null);
    }

    [HttpPost("{id}/grant")]
    public async Task<ActionResult<ApiResponse<AdminCosmeticGrantResultDto>>> Grant(string id, [FromBody] AdminCosmeticGrantRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.GrantAsync(Caller, id, request, ct));
}
