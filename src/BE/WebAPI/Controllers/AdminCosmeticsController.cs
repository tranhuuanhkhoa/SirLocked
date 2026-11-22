using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.WebAPI;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Frames, titles, lobby entrances, how each is obtained, and what an exchanged item pays. The /admin/cosmetics page.</summary>
[Route("api/admin/cosmetics")]
[Authorize(Roles = UserRole.Admin)]
public class AdminCosmeticsController : BaseApiController
{
    private readonly AdminCosmeticsService _cosmetics;

    public AdminCosmeticsController(AdminCosmeticsService cosmetics) => _cosmetics = cosmetics;

    [HttpGet]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminCosmeticsPageDto>>> List(CancellationToken ct) =>
        Ok(await _cosmetics.ListAsync(ct));

    [HttpGet("players")]
    [Authorize(Policy = AdminPolicies.Players)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AdminCosmeticPlayerDto>>>> Players([FromQuery] string? q, CancellationToken ct) =>
        Ok(await _cosmetics.SearchPlayersAsync(q, ct));

    [HttpPut("settings/xp")]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminXpSettingsDto>>> SetXp([FromBody] AdminXpSettingsRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.SetXpAsync(Caller, request, ct));

    [HttpGet("{id}")]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> Get(string id, CancellationToken ct) =>
        Ok(await _cosmetics.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> Create([FromBody] AdminCosmeticCreateRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.CreateAsync(Caller, request, ct));

    [HttpPut("{id}")]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> Update(string id, [FromBody] AdminCosmeticUpdateRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.UpdateAsync(Caller, id, request, ct));

    [HttpPut("{id}/acquisition")]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> SetAcquisition(string id, [FromBody] AdminCosmeticAcquisitionRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.SetAcquisitionAsync(Caller, id, request, ct));

    [HttpPut("{id}/retired")]
    [Authorize(Policy = AdminPolicies.Content)]
    public async Task<ActionResult<ApiResponse<AdminCosmeticDto>>> SetRetired(string id, [FromBody] AdminCosmeticRetireRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.SetRetiredAsync(Caller, id, request, ct));

    [HttpDelete("{id}")]
    [Authorize(Policy = AdminPolicies.Content)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<object?>>> Delete(string id, [FromQuery] string? reason, CancellationToken ct)
    {
        await _cosmetics.DeleteAsync(Caller, id, reason, ct);
        return Ok<object?>(null);
    }

    [HttpPost("{id}/grant")]
    [Authorize(Policy = AdminPolicies.Economy)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<AdminCosmeticGrantResultDto>>> Grant(string id, [FromBody] AdminCosmeticGrantRequest request, CancellationToken ct) =>
        Ok(await _cosmetics.GrantAsync(Caller, id, request, ct));
}
