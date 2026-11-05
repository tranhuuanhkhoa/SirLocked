using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>What is in circulation, what is on the market, what looks odd and what is stuck.</summary>
[Route("api/admin/economy")]
[Authorize(Roles = UserRole.Admin)]
public class AdminEconomyController : BaseApiController
{
    private readonly AdminEconomyService _economy;

    public AdminEconomyController(AdminEconomyService economy) => _economy = economy;

    [HttpGet("overview")]
    public async Task<ActionResult<ApiResponse<AdminEconomyOverviewDto>>> Overview([FromQuery] int days = 7, CancellationToken ct = default) =>
        Ok(await _economy.OverviewAsync(days, ct));

    [HttpGet("dashboard")]
    public async Task<ActionResult<ApiResponse<AdminEconomyDashboardDto>>> Dashboard(CancellationToken ct) =>
        Ok(await _economy.DashboardAsync(ct));

    [HttpGet("listings")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminListingRowDto>>>> Listings([FromQuery] MarketQueryParameters query, CancellationToken ct) =>
        Ok(await _economy.ListingsAsync(query.ToQuery(), ct));

    [HttpPost("listings/{listingId}/remove")]
    public async Task<ActionResult<ApiResponse<ListingDto>>> RemoveListing(string listingId, [FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _economy.RemoveListingAsync(Caller, listingId, request.Reason, ct), "Đã gỡ tin rao.");

    [HttpGet("orders")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminOrderRowDto>>>> Orders([FromQuery] MarketQueryParameters query, CancellationToken ct) =>
        Ok(await _economy.OrdersAsync(query.ToQuery(), ct));

    [HttpPost("orders/{orderId}/cancel")]
    public async Task<ActionResult<ApiResponse<OrderDto>>> CancelOrder(string orderId, [FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _economy.CancelOrderAsync(Caller, orderId, request.Reason, ct), "Đã hủy lệnh mua và trả xu.");

    [HttpGet("sales")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminSaleRowDto>>>> Sales([FromQuery] MarketQueryParameters query, CancellationToken ct) =>
        Ok(await _economy.SalesAsync(query.ToQuery(), ct));

    [HttpGet("sales/export")]
    public async Task<IActionResult> ExportSales([FromQuery] MarketQueryParameters query, CancellationToken ct) =>
        File(await _economy.ExportSalesCsvAsync(query.ToQuery(), ct), "text/csv; charset=utf-8", $"lich-su-ban-{DateTime.UtcNow:yyyyMMdd-HHmm}.csv");

    [HttpGet("trades")]
    public async Task<ActionResult<ApiResponse<AdminPageDto<AdminTradeRowDto>>>> Trades([FromQuery] MarketQueryParameters query, CancellationToken ct) =>
        Ok(await _economy.TradesAsync(query.ToQuery(), ct));

    [HttpGet("anomalies")]
    public async Task<ActionResult<ApiResponse<AdminAnomaliesDto>>> Anomalies(CancellationToken ct) =>
        Ok(await _economy.AnomaliesAsync(ct));

    [HttpGet("stuck")]
    public async Task<ActionResult<ApiResponse<AdminStuckDto>>> Stuck(CancellationToken ct) =>
        Ok(await _economy.StuckAsync(ct));

    [HttpPost("recover")]
    public async Task<ActionResult<ApiResponse<AdminRecoveryReportDto>>> Recover([FromBody] AdminReasonRequest request, CancellationToken ct) =>
        Ok(await _economy.RecoverAsync(Caller, request.Reason, ct), "Đã chạy khôi phục.");

    /// <summary>The filters of the market desk as they arrive in a query string.</summary>
    public sealed class MarketQueryParameters
    {
        public string? DefId { get; set; }
        public string? User { get; set; }
        public long? MinPrice { get; set; }
        public long? MaxPrice { get; set; }
        public string? Status { get; set; }
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = AdminPlayersRules.DefaultPageSize;

        public AdminMarketQuery ToQuery() => new(DefId, User, MinPrice, MaxPrice, Status, From, To, Page, PageSize);
    }
}
