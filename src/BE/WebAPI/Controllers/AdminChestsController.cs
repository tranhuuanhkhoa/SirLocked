using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Chests and items admin. Every write is checked on the server, recorded in the audit log and takes effect at once.</summary>
[Route("api/admin")]
[Authorize(Roles = UserRole.Admin)]
public class AdminChestsController : BaseApiController
{
    private readonly AdminChestsItemService _items;
    private readonly AdminChestsChestService _chests;
    private readonly AdminChestsStatsService _stats;
    private readonly AdminChestStylesService _styles;

    public AdminChestsController(AdminChestsItemService items, AdminChestsChestService chests, AdminChestsStatsService stats, AdminChestStylesService styles)
    {
        _items = items;
        _chests = chests;
        _stats = stats;
        _styles = styles;
    }

    // ------------------------------------------------------------------ items

    [HttpGet("items")]
    public async Task<ActionResult<ApiResponse<AdminItemListDto>>> ListItems(CancellationToken ct) =>
        Ok(await _items.ListAsync(ct));

    [HttpPost("items")]
    public async Task<ActionResult<ApiResponse<AdminItemDto>>> CreateItem([FromBody] AdminItemCreateRequest request, CancellationToken ct) =>
        Ok(await _items.CreateAsync(Caller, request, ct));

    [HttpPut("items/{id}")]
    public async Task<ActionResult<ApiResponse<AdminItemDto>>> UpdateItem(string id, [FromBody] AdminItemUpdateRequest request, CancellationToken ct) =>
        Ok(await _items.UpdateAsync(Caller, id, request, ct));

    [HttpPost("items/{id}/retire")]
    public async Task<ActionResult<ApiResponse<AdminItemDto>>> RetireItem(string id, [FromBody] AdminItemRetireRequest request, CancellationToken ct) =>
        Ok(await _items.SetRetiredAsync(Caller, id, request.Retired, request.Reason, ct));

    [HttpPost("items/{id}/delete")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteItem(string id, [FromBody] AdminDeleteItemRequest request, CancellationToken ct)
    {
        await _items.DeleteAsync(Caller, id, request.Reason, ct);
        return Ok(true);
    }

    // ------------------------------------------------------------------ chest styles (Kiểu hòm)

    [HttpGet("chest-styles")]
    public async Task<ActionResult<ApiResponse<AdminChestStyleListDto>>> ListStyles(CancellationToken ct) =>
        Ok(await _styles.ListAsync(ct));

    [HttpPost("chest-styles")]
    public async Task<ActionResult<ApiResponse<AdminChestStyleDto>>> CreateStyle([FromBody] AdminChestStyleRequest request, CancellationToken ct) =>
        Ok(await _styles.CreateAsync(Caller, request, ct));

    [HttpPut("chest-styles/{id}")]
    public async Task<ActionResult<ApiResponse<AdminChestStyleDto>>> UpdateStyle(string id, [FromBody] AdminChestStyleRequest request, CancellationToken ct) =>
        Ok(await _styles.UpdateAsync(Caller, id, request, ct));

    [HttpPost("chest-styles/{id}/delete")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteStyle(string id, [FromBody] AdminChestStyleDeleteRequest request, CancellationToken ct)
    {
        await _styles.DeleteAsync(Caller, id, request.Reason, ct);
        return Ok(true);
    }

    // ------------------------------------------------------------------ chests

    [HttpGet("chests")]
    public async Task<ActionResult<ApiResponse<AdminChestListDto>>> ListChests(CancellationToken ct) =>
        Ok(await _chests.ListAsync(ct));

    /// <summary>A new chest from the form (/admin/chests/moi), under the same rules as a save, with its own chest and key types.</summary>
    [HttpPost("chests")]
    public async Task<ActionResult<ApiResponse<AdminChestDetailDto>>> CreateChest([FromBody] AdminChestDraftRequest request, CancellationToken ct) =>
        Ok(await _chests.CreateAsync(Caller, request, ct));

    /// <summary>What creating this chest would do: broken rules, expected value and each item's rate. Writes nothing.</summary>
    [HttpPost("chests/check")]
    public async Task<ActionResult<ApiResponse<AdminChestCheckDto>>> CheckNewChest([FromBody] AdminChestDraftRequest request, CancellationToken ct) =>
        Ok(await _chests.CheckNewAsync(request, ct));

    [HttpGet("chests/{id}")]
    public async Task<ActionResult<ApiResponse<AdminChestDetailDto>>> GetChest(string id, CancellationToken ct) =>
        Ok(await _chests.GetAsync(id, ct));

    [HttpPut("chests/{id}")]
    public async Task<ActionResult<ApiResponse<AdminChestDetailDto>>> UpdateChest(string id, [FromBody] AdminChestDraftRequest request, CancellationToken ct) =>
        Ok(await _chests.UpdateAsync(Caller, id, request, ct));

    /// <summary>What a save would do: broken rules, expected value, each item's rate and the comparison. Writes nothing.</summary>
    [HttpPost("chests/{id}/check")]
    public async Task<ActionResult<ApiResponse<AdminChestCheckDto>>> CheckChest(string id, [FromBody] AdminChestDraftRequest request, CancellationToken ct) =>
        Ok(await _chests.CheckAsync(id, request, ct));

    [HttpPost("chests/{id}/clone")]
    public async Task<ActionResult<ApiResponse<AdminChestDetailDto>>> CloneChest(string id, [FromBody] AdminChestCloneRequest request, CancellationToken ct) =>
        Ok(await _chests.CloneAsync(Caller, id, request, ct));

    [HttpGet("chests/{id}/versions")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AdminChestVersionDto>>>> ChestVersions(string id, CancellationToken ct) =>
        Ok(await _chests.VersionsAsync(id, ct));

    [HttpPost("chests/{id}/versions/{version:int}/restore")]
    public async Task<ActionResult<ApiResponse<AdminChestDetailDto>>> RestoreChest(string id, int version, [FromBody] AdminChestRestoreRequest request, CancellationToken ct) =>
        Ok(await _chests.RestoreAsync(Caller, id, version, request, ct));

    [HttpGet("chests/{id}/preview")]
    public async Task<ActionResult<ApiResponse<ChestListDto>>> PreviewChest(string id) =>
        Ok(await _chests.PreviewAsync(id));

    [HttpPost("chests/{id}/preview/open")]
    public async Task<ActionResult<ApiResponse<ChestOpenResultDto>>> PreviewOpen(string id) =>
        Ok(await _chests.PreviewOpenAsync(id));

    // ------------------------------------------------------------------ statistics and tools

    [HttpGet("chests/{id}/stats")]
    public async Task<ActionResult<ApiResponse<AdminChestStatsDto>>> ChestStats(string id, [FromQuery] int days = 7, CancellationToken ct = default) =>
        Ok(await _stats.StatsAsync(id, days, ct));

    [HttpGet("chests/openings")]
    public async Task<ActionResult<ApiResponse<AdminOpeningPageDto>>> Openings(
        [FromQuery] string? player,
        [FromQuery] string? chestId,
        [FromQuery] string? rarity,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = AdminChestsStatsService.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _stats.OpeningsAsync(new AdminOpeningQuery(player, chestId, rarity, from, to, page, pageSize), ct));

    [HttpGet("chests/players")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AdminPlayerRefDto>>>> FindPlayers([FromQuery] string? q, CancellationToken ct) =>
        Ok(await _stats.FindPlayersAsync(q, ct));

    [HttpPost("chests/grant")]
    public async Task<ActionResult<ApiResponse<WalletDto>>> Grant([FromBody] AdminChestGrantRequest request, CancellationToken ct) =>
        Ok(await _stats.GrantAsync(Caller, request, ct));
}
