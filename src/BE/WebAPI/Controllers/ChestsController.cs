using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Mở hòm: lists chests, buys chests and keys, opens chests. Every result is decided here, never by the client.</summary>
[Route("api/chests")]
[Authorize]
public class ChestsController : BaseApiController
{
    private readonly ChestService _chests;

    public ChestsController(ChestService chests) => _chests = chests;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<ChestListDto>>> List(CancellationToken ct) =>
        Ok(await _chests.ListAsync(CallerId, ct));

    [HttpPost("{chestId}/keys")]
    [EnableRateLimiting("chests")]
    public async Task<ActionResult<ApiResponse<ChestPurchaseResultDto>>> BuyKey(string chestId, [FromBody] ChestOperationRequest request, CancellationToken ct) =>
        Ok(await _chests.BuyKeyAsync(Caller, chestId, request.IdempotencyKey, ct, request.ExpectedPrice));

    [HttpPost("{chestId}/buy")]
    [EnableRateLimiting("chests")]
    public async Task<ActionResult<ApiResponse<ChestPurchaseResultDto>>> BuyChest(string chestId, [FromBody] ChestOperationRequest request, CancellationToken ct) =>
        Ok(await _chests.BuyChestAsync(Caller, chestId, request.IdempotencyKey, ct, request.ExpectedPrice));

    [HttpPost("{chestId}/open")]
    [EnableRateLimiting("chests")]
    public async Task<ActionResult<ApiResponse<ChestOpenResultDto>>> Open(string chestId, [FromBody] ChestOperationRequest request, CancellationToken ct) =>
        Ok(await _chests.OpenAsync(Caller, chestId, request.IdempotencyKey, ct));

    [HttpPost("admin/grant")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<WalletDto>>> AdminGrant([FromBody] ChestAdminGrantRequest request, CancellationToken ct) =>
        Ok(await _chests.AdminGrantAsync(request.UserId, request.ChestId, request.Chests, request.Keys, ct));
}
