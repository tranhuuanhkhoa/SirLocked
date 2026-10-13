using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/admin/ai-cases/{draftId}/usage")]
[Authorize(Roles = UserRole.Admin + "," + UserRole.Vip)]
public sealed class AiUsageController(MongoDbContext db) : BaseApiController
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<object>>> Get(string draftId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(draftId, out _)) throw ApiException.NotFound("AI draft was not found.");
        var draft = await db.AiCaseDrafts.Find(x => x.Id == draftId).FirstOrDefaultAsync(cancellationToken)
            ?? throw ApiException.NotFound("AI draft was not found.");
        if (Caller.Role != UserRole.Admin && draft.CreatedByUserId != Caller.Id) throw ApiException.Forbidden();
        var events = await db.Database.GetCollection<AiUsageEvent>("aiUsageEvents")
            .Find(x => x.Lease.DraftId == draftId && x.State != "DENIED")
            .SortByDescending(x => x.Lease.StartedAt).Limit(5001).ToListAsync(cancellationToken);
        var truncated = events.Count > 5000;
        if (truncated) events.RemoveAt(5000);
        // Reservations are authoritative in the atomic ledger, including the
        // window after a response is RECORDED but before settlement completes.
        var ledger = await db.AiBudgetLedger.Find(x => x.Id == AiBudgetLedger.GlobalId)
            .FirstOrDefaultAsync(cancellationToken);
        var draftKey = AiUsageAccounting.DraftKey(draftId);
        var reserved = ledger?.DraftUsage.GetValueOrDefault(draftKey)?.ReservedUsd ?? 0m;
        return Ok<object>(new
        {
            isTruncated = truncated, calls = events.Count,
            measuredCostUsd = events.Where(x => x.CostSource == "PROVIDER").Sum(x => x.CostUsd ?? 0m),
            calculatedCostUsd = events.Where(x => x.CostSource != "PROVIDER").Sum(x => x.CostUsd ?? 0m),
            knownCostUsd = events.Sum(x => x.CostUsd ?? 0m),
            unknownCalls = events.Count(x => !x.CostUsd.HasValue),
            reservedUsd = reserved,
            inputTokens = events.Sum(x => x.InputTokens ?? 0), outputTokens = events.Sum(x => x.OutputTokens ?? 0),
            cachedInputTokens = events.Sum(x => x.CachedInputTokens ?? 0),
            reasoningTokens = events.Sum(x => x.ReasoningTokens ?? 0),
            events = events.Select(x => new
            {
                callId = x.Id, x.Lease.Step, x.Lease.Kind, x.Lease.Model, x.Lease.PriceVersion,
                x.State, x.InputTokens, x.OutputTokens, x.CachedInputTokens, x.ReasoningTokens,
                x.CostUsd, x.CostSource, x.LatencyMs, x.StatusCode
            })
        });
    }
}
