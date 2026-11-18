using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Vip;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>VUAN-7 part H, admin side: authors, their badges and payouts; hold, release and revoke are logged.</summary>
[Route("api/admin/authors")]
[Authorize(Roles = UserRole.Admin)]
public class AdminAuthorsController(AuthorRewardService rewards, IAdminAudit audit, MongoDbContext db) : BaseApiController
{
    public sealed record AuthorRow(string UserId, string Name, AuthorStats Stats, long PaidXu, long HeldXu, long RevokedXu);
    public sealed record PayoutReason(string? Reason);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<AuthorRow>>>> Authors(CancellationToken ct)
    {
        var stats = await rewards.Stats.Find(FilterDefinition<AuthorStats>.Empty).ToListAsync(ct);
        var ids = stats.Select(item => item.Id).ToList();
        var names = (await db.Users.Find(Builders<User>.Filter.In(item => item.Id, ids)).Project(item => new { item.Id, item.FullName }).ToListAsync(ct))
            .ToDictionary(item => item.Id, item => item.FullName, StringComparer.Ordinal);
        var payouts = await rewards.Payouts.Find(Builders<AuthorPayout>.Filter.In(item => item.AuthorUserId, ids)).ToListAsync(ct);
        return Ok(stats.Select(item =>
        {
            var mine = payouts.Where(payout => payout.AuthorUserId == item.Id).ToList();
            return new AuthorRow(item.Id, names.GetValueOrDefault(item.Id) ?? item.Id, item,
                mine.Where(payout => payout.State == AuthorPayoutStates.Paid).Sum(payout => payout.Xu),
                mine.Where(payout => payout.State is AuthorPayoutStates.Held or AuthorPayoutStates.OnHold).Sum(payout => payout.Xu),
                mine.Sum(payout => payout.RevokedXu));
        }).OrderByDescending(row => AuthorTiers.Rank(row.Stats.Tier)).ThenByDescending(row => row.PaidXu).ToList());
    }

    [HttpGet("payouts")]
    public async Task<ActionResult<ApiResponse<List<AuthorPayout>>>> Payouts(
        [FromQuery] string? state, [FromQuery] string? authorUserId, [FromQuery] int limit = 100, CancellationToken ct = default) =>
        Ok(await rewards.ListAsync(state, authorUserId, limit, ct));

    [HttpPost("payouts/{id}/hold")]
    public async Task<ActionResult<ApiResponse<AuthorPayout>>> Hold(string id, [FromBody] PayoutReason request, CancellationToken ct)
    {
        var changed = await rewards.HoldAsync(id, Caller.Id, Clip(request.Reason), ct);
        await audit.LogAsync(Caller, "author-payout.hold", "authorPayouts", id, new { State = AuthorPayoutStates.Held }, new { changed.State }, request.Reason, ct);
        return Ok(changed, "Payout held.");
    }

    [HttpPost("payouts/{id}/release")]
    public async Task<ActionResult<ApiResponse<AuthorPayout>>> Release(string id, CancellationToken ct)
    {
        var changed = await rewards.ReleaseAsync(id, Caller.Id, ct);
        await audit.LogAsync(Caller, "author-payout.release", "authorPayouts", id, new { State = AuthorPayoutStates.OnHold }, new { changed.State }, ct: ct);
        return Ok(changed, "Payout released.");
    }

    [HttpPost("payouts/{id}/revoke")]
    public async Task<ActionResult<ApiResponse<AuthorPayout>>> Revoke(string id, [FromBody] PayoutReason request, CancellationToken ct)
    {
        var reason = Clip(request.Reason);
        if (reason.Length == 0)
            throw ApiException.BadRequest("A revocation needs a reason.", new ApiErrorDetails("AUTHOR_REVOKE_REASON", "admin.authors.reasonRequired"));
        var before = await rewards.Payouts.Find(item => item.Id == id).FirstOrDefaultAsync(ct) ?? throw ApiException.NotFound("Payout not found.");
        var changed = await rewards.RevokeAsync(id, Caller.Id, reason, ct);
        await audit.LogAsync(Caller, "author-payout.revoke", "authorPayouts", id, new { before.State, before.Xu },
            new { changed.State, changed.RevokedXu }, reason, ct);
        return Ok(changed, "Payout revoked.");
    }

    private static string Clip(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= 500 ? text : text[..500];
    }
}
