using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Payments;
using SirLocked.Api.Services.Payments;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/payments")]
[Authorize]
[EnableRateLimiting("payments")]
public sealed class PaymentsController(PaymentService payments) : BaseApiController
{
    [HttpGet("packages")]
    public IActionResult Packages() => new OkObjectResult(ApiResponse<object>.Ok(new { enabled = payments.Enabled, packages = payments.Packages }));

    [HttpPost("orders")]
    public async Task<ActionResult<ApiResponse<PaymentOrderDto>>> Create(CreateTopUpRequest request, CancellationToken ct) =>
        Ok(await payments.CreateAsync(CallerId, request, ct));

    [HttpGet("orders")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<PaymentOrderDto>>>> History(CancellationToken ct) =>
        Ok(await payments.HistoryAsync(CallerId, ct));

    [HttpGet("orders/{code:long}")]
    public async Task<ActionResult<ApiResponse<PaymentOrderDto>>> Get(long code, CancellationToken ct) =>
        Ok(await payments.GetAsync(CallerId, code, ct));

    [HttpPost("orders/{code:long}/cancel")]
    public async Task<ActionResult<ApiResponse<PaymentOrderDto>>> Cancel(long code, CancellationToken ct) =>
        Ok(await payments.CancelAsync(CallerId, code, ct));

    [HttpPost("payos/webhook")]
    [AllowAnonymous]
    [DisableRateLimiting] // Provider retries must not share the anonymous/user limiter.
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Webhook(PayOsWebhook webhook, CancellationToken ct)
    {
        await payments.HandleWebhookAsync(webhook, ct);
        return new OkObjectResult(new { success = true });
    }
}
