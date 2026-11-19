using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Chợ đồ: wallet, inventory, market listings, buy orders and trade offers. Every route needs a signed-in player.</summary>
[Route("api/market")]
[Authorize]
public class MarketController : BaseApiController
{
    private readonly MarketService _market;

    public MarketController(MarketService market) => _market = market;

    // ----- wallet & catalog

    [HttpGet("me")]
    public async Task<ActionResult<ApiResponse<WalletDto>>> Wallet(CancellationToken ct) =>
        Ok(await _market.GetWalletAsync(CallerId, ct));

    [HttpGet("catalog")]
    public ActionResult<ApiResponse<IReadOnlyList<ItemDefDto>>> Catalog() => Ok(_market.GetCatalog());

    [HttpGet("items")]
    public async Task<ActionResult<ApiResponse<MarketBrowseDto>>> Browse(
        [FromQuery] string? q, [FromQuery] string? category, [FromQuery] string? rarity, [FromQuery] string? sort,
        [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var rarities = (rarity ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // No pageSize (or 0): the whole ledger, as before paging existed. Otherwise at most MaxBrowsePageSize rows.
        var size = pageSize is null or <= 0 ? 0 : Math.Min(pageSize.Value, MaxBrowsePageSize);
        return Ok(await _market.BrowseAsync(q?.Length > 60 ? q[..60] : q, category, rarities, sort, page ?? 1, size, ct));
    }

    private const int MaxBrowsePageSize = 100;

    [HttpGet("items/{defId}")]
    public async Task<ActionResult<ApiResponse<MarketItemDetailDto>>> Item(string defId, CancellationToken ct) =>
        Ok(await _market.GetItemDetailAsync(CallerId, defId, ct));

    [HttpPost("items/{defId}/buy")]
    public async Task<ActionResult<ApiResponse<PurchaseResultDto>>> BuyLowest(string defId, [FromBody] BuyRequest request, CancellationToken ct)
    {
        if (request.MaxPrice is null)
            throw MarketService.Error(400, MarketErrors.InvalidPrice, "maxPrice is required.");
        var caller = Caller;
        return Ok(await _market.IdempotentAsync(caller.Id, request.RequestId,
            () => _market.BuyLowestAsync(caller, defId, request.MaxPrice.Value, ct), ct));
    }

    // ----- listings

    [HttpPost("listings")]
    public async Task<ActionResult<ApiResponse<ListingResultDto>>> CreateListing([FromBody] CreateListingRequest request, CancellationToken ct)
    {
        var caller = Caller;
        return Ok(await _market.IdempotentAsync(caller.Id, request.RequestId,
            () => _market.CreateListingAsync(caller, request.ItemId, request.Price, ct), ct));
    }

    [HttpPost("listings/{listingId}/buy")]
    public async Task<ActionResult<ApiResponse<PurchaseResultDto>>> BuyListing(string listingId, [FromBody] BuyRequest? request, CancellationToken ct)
    {
        var caller = Caller;
        return Ok(await _market.IdempotentAsync(caller.Id, request?.RequestId,
            () => _market.BuyListingAsync(caller, listingId, ct), ct));
    }

    [HttpDelete("listings/{listingId}")]
    public async Task<ActionResult<ApiResponse<ListingDto>>> CancelListing(string listingId, CancellationToken ct) =>
        Ok(await _market.CancelListingAsync(CallerId, listingId, ct));

    // ----- buy orders

    [HttpPost("orders")]
    public async Task<ActionResult<ApiResponse<OrderResultDto>>> PlaceOrder([FromBody] PlaceOrderRequest request, CancellationToken ct)
    {
        var caller = Caller;
        return Ok(await _market.IdempotentAsync(caller.Id, request.RequestId,
            () => _market.PlaceOrderAsync(caller, request.DefId, request.Price, ct), ct));
    }

    [HttpDelete("orders/{orderId}")]
    public async Task<ActionResult<ApiResponse<OrderDto>>> CancelOrder(string orderId, CancellationToken ct) =>
        Ok(await _market.CancelOrderAsync(CallerId, orderId, ct));

    [HttpGet("mine")]
    public async Task<ActionResult<ApiResponse<MyMarketDto>>> Mine(CancellationToken ct) =>
        Ok(await _market.GetMineAsync(CallerId, ct));

    // ----- inventory & equipment

    [HttpGet("inventory")]
    public async Task<ActionResult<ApiResponse<InventoryDto>>> Inventory(CancellationToken ct) =>
        Ok(await _market.GetInventoryAsync(CallerId, ct));

    [HttpGet("users/{userId}/inventory")]
    public async Task<ActionResult<ApiResponse<PublicInventoryDto>>> UserInventory(string userId, CancellationToken ct) =>
        Ok(await _market.GetPublicInventoryAsync(userId, ct));

    [HttpPost("inventory/{itemId}/equip")]
    public async Task<ActionResult<ApiResponse<InventoryDto>>> Equip(string itemId, CancellationToken ct) =>
        Ok(await _market.EquipAsync(CallerId, itemId, ct));

    [HttpDelete("equipped/{category}")]
    public async Task<ActionResult<ApiResponse<InventoryDto>>> Unequip(string category, CancellationToken ct) =>
        Ok(await _market.UnequipAsync(CallerId, category, ct));

    [HttpGet("equipped/{userId}")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<EquippedItemDto>>>> Equipped(string userId, CancellationToken ct) =>
        Ok(await _market.GetEquippedAsync(userId, ct));

    // ----- trade offers

    [HttpGet("trades")]
    public async Task<ActionResult<ApiResponse<TradesDto>>> Trades(CancellationToken ct) =>
        Ok(await _market.GetTradesAsync(CallerId, ct));

    [HttpPost("trades")]
    public async Task<ActionResult<ApiResponse<TradeOfferDto>>> CreateTrade([FromBody] CreateTradeRequest request, CancellationToken ct)
    {
        var caller = Caller;
        return Ok(await _market.IdempotentAsync(caller.Id, request.RequestId,
            () => _market.CreateTradeAsync(caller, request, ct), ct));
    }

    [HttpPost("trades/{offerId}/accept")]
    public async Task<ActionResult<ApiResponse<TradeOfferDto>>> AcceptTrade(string offerId, CancellationToken ct) =>
        Ok(await _market.AcceptTradeAsync(Caller, offerId, ct));

    [HttpPost("trades/{offerId}/decline")]
    public async Task<ActionResult<ApiResponse<TradeOfferDto>>> DeclineTrade(string offerId, CancellationToken ct) =>
        Ok(await _market.DeclineTradeAsync(CallerId, offerId, ct));

    [HttpPost("trades/{offerId}/cancel")]
    public async Task<ActionResult<ApiResponse<TradeOfferDto>>> CancelTrade(string offerId, CancellationToken ct) =>
        Ok(await _market.CancelTradeAsync(CallerId, offerId, ct));

    [HttpPost("trades/{offerId}/counter")]
    public async Task<ActionResult<ApiResponse<TradeOfferDto>>> CounterTrade(string offerId, [FromBody] TradeTermsRequest request, CancellationToken ct)
    {
        var caller = Caller;
        return Ok(await _market.IdempotentAsync(caller.Id, request.RequestId,
            () => _market.CounterTradeAsync(caller, offerId, request, ct), ct));
    }

    // ----- rewards & admin

    [HttpGet("rewards/{roomId}")]
    public async Task<ActionResult<ApiResponse<RewardDto?>>> Reward(string roomId, CancellationToken ct) =>
        Ok(await _market.GetRewardAsync(CallerId, roomId, ct));

    [HttpPost("admin/grant")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<WalletDto>>> AdminGrant([FromBody] AdminGrantRequest request, CancellationToken ct) =>
        Ok(await _market.AdminGrantAsync(request.UserId, request.DefId, request.Coins, ct));
}

/// <summary>Finds detectives by display name for trade offers. Returns id + name only, never e-mail.</summary>
[Route("api/users")]
[Authorize]
public class UserSearchController : BaseApiController
{
    private readonly MarketService _market;

    public UserSearchController(MarketService market) => _market = market;

    [HttpGet("search")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<UserSearchDto>>>> Search([FromQuery] string? q, CancellationToken ct) =>
        Ok(await _market.SearchUsersAsync(CallerId, q, ct));
}
