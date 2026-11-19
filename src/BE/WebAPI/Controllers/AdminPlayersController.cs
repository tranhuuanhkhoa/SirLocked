using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Finding a player, seeing everything about them, and the actions an admin can take. Locking and roles stay on /api/admin/users.</summary>
[Route("api/admin/players")]
[Authorize(Roles = UserRole.Admin)]
public class AdminPlayersController : BaseApiController
{
    private readonly AdminPlayersService _players;
    private readonly AdminPlayerOperations _operations;
    private readonly AdminAvatarModeration _avatars;

    public AdminPlayersController(AdminPlayersService players, AdminPlayerOperations operations, AdminAvatarModeration avatars)
    {
        _players = players;
        _operations = operations;
        _avatars = avatars;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminPlayerRowDto>>>> List(
        [FromQuery] string? q,
        [FromQuery] string? role,
        [FromQuery] string? status,
        [FromQuery] string? sort,
        [FromQuery] bool asc = false,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _players.ListAsync(new AdminPlayerQuery(q, role, status, sort, asc, page, pageSize), ct));

    [HttpGet("avatars")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminAvatarRowDto>>>> Avatars(
        [FromQuery] bool pending = true,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _avatars.ListAsync(pending, page, pageSize, ct));

    [HttpGet("{userId}")]
    public async Task<ActionResult<ApiResponse<AdminPlayerDetailDto>>> Detail(string userId, CancellationToken ct) =>
        Ok(await _players.GetDetailAsync(userId, ct));

    [HttpGet("{userId}/games")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminGameRowDto>>>> Games(
        string userId, [FromQuery] int page = 1, [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize, CancellationToken ct = default) =>
        Ok(await _players.GamesAsync(userId, page, pageSize, ct));

    [HttpGet("{userId}/chest-openings")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminChestOpeningRowDto>>>> ChestOpenings(
        string userId, [FromQuery] int page = 1, [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize, CancellationToken ct = default) =>
        Ok(await _players.ChestOpeningsAsync(userId, page, pageSize, ct));

    [HttpGet("{userId}/sales")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminPlayerSaleRowDto>>>> Sales(
        string userId, [FromQuery] int page = 1, [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize, CancellationToken ct = default) =>
        Ok(await _players.SalesAsync(userId, page, pageSize, ct));

    [HttpGet("{userId}/trades")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminTradeRowDto>>>> Trades(
        string userId, [FromQuery] int page = 1, [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize, CancellationToken ct = default) =>
        Ok(await _players.TradesAsync(userId, page, pageSize, ct));

    [HttpGet("{userId}/audit")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminAuditEntryDto>>>> Audit(
        string userId, [FromQuery] int page = 1, [FromQuery] int pageSize = AdminPlayersRules.DefaultPageSize, CancellationToken ct = default) =>
        Ok(await _players.AuditAsync(userId, page, pageSize, ct));

    [HttpPost("{userId}/coins")]
    public async Task<ActionResult<ApiResponse<AdminOperationResultDto>>> Coins(string userId, [FromBody] AdminCoinsRequest request, CancellationToken ct) =>
        Ok(await _operations.AdjustCoinsAsync(Caller, userId, request, ct), "Đã cập nhật số xu.");

    [HttpPost("{userId}/items")]
    public async Task<ActionResult<ApiResponse<AdminOperationResultDto>>> GrantItem(string userId, [FromBody] AdminGrantItemRequest request, CancellationToken ct) =>
        Ok(await _operations.GrantItemAsync(Caller, userId, request, ct), "Đã cấp vật phẩm.");

    [HttpPost("{userId}/items/{itemId}/revoke")]
    public async Task<ActionResult<ApiResponse<AdminOperationResultDto>>> RevokeItem(string userId, string itemId, [FromBody] AdminRevokeItemRequest request, CancellationToken ct) =>
        Ok(await _operations.RevokeItemAsync(Caller, userId, itemId, request, ct), "Đã thu hồi vật phẩm.");

    [HttpPost("{userId}/progress")]
    public async Task<ActionResult<ApiResponse<AdminOperationResultDto>>> Progress(string userId, [FromBody] AdminSetProgressRequest request, CancellationToken ct) =>
        Ok(await _operations.SetProgressAsync(Caller, userId, request, ct), "Đã đặt cấp và KN.");

    [HttpPost("{userId}/avatar/remove")]
    public async Task<ActionResult<ApiResponse<AdminAvatarRemovalDto>>> RemoveAvatar(string userId, [FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _operations.RemoveAvatarAsync(Caller, userId, request.Reason, ct), "Đã xóa ảnh đại diện.");

    [HttpPost("{userId}/avatar/approve")]
    public async Task<ActionResult<ApiResponse<bool>>> ApproveAvatar(string userId, CancellationToken ct)
    {
        await _avatars.ApproveAsync(Caller, userId, ct);
        return Ok(true, "Đã duyệt ảnh.");
    }

    [HttpPost("{userId}/force-logout")]
    public async Task<ActionResult<ApiResponse<bool>>> ForceLogout(string userId, [FromBody] AdminReasonRequest request, CancellationToken ct)
    {
        await _operations.ForceLogoutAsync(Caller, userId, request.Reason, ct);
        return Ok(true, "Đã buộc đăng xuất.");
    }
}
