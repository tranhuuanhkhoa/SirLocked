using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Vip;

/// <summary>VUAN-7 part F: what VIP orders really cost and earned, and what cases earn from hints and ads.</summary>
public sealed class VipReportService(MongoDbContext db, VipSettingsStore settings, TimeProvider? time = null)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    public sealed record ModelCost(string Model, int Calls, long InputTokens, long OutputTokens, long CacheReadTokens,
        long CacheWriteTokens, decimal CostUsd, long CostVnd, int BatchCalls);

    public sealed record OrderRow(
        string DraftId, string CreatedByUserId, string Preset, string Speed, string Status, string OrderStatus, string BillingState,
        long PriceXu, long ChargedXu, long RefundedXu, decimal SpentUsd, long SpentVnd, long PixelLabVnd, long EarnedVnd,
        long ProfitVnd, List<ModelCost> Models, DateTime CreatedAt);

    public sealed record Average(string Preset, string Speed, int Orders, long AvgPriceXu, long AvgCostVnd, long AvgEarnedVnd, long AvgProfitVnd);

    public sealed record CaseEarning(string CaseId, string Title, string AuthorUserId, long HintXu, int PaidHints, int AdViews,
        long AdVnd, long AuthorShareXu);

    public sealed record AuthorTotals(long PaidXu, long HeldXu, long RevokedXu, long ClippedXu, int Payouts);

    public sealed record Report(DateTime From, DateTime To, decimal UsdToVnd, int VndPerXu, List<OrderRow> Orders,
        List<Average> Averages, List<CaseEarning> Cases, AuthorTotals Authors);

    public async Task<Report> BuildAsync(int days = 30, CancellationToken ct = default)
    {
        var to = _time.GetUtcNow().UtcDateTime;
        var from = to.AddDays(-Math.Clamp(days, 1, 365));
        var pricing = await settings.GetPricingAsync(ct);

        var drafts = await db.AiCaseDrafts.Find(item => item.VipBilling != null && item.CreatedAt >= from)
            .SortByDescending(item => item.CreatedAt).Limit(500).ToListAsync(ct);
        var ids = drafts.Select(item => item.Id).ToList();
        var usage = await db.Database.GetCollection<AiVipUsageRecord>("aiVipUsage")
            .Find(Builders<AiVipUsageRecord>.Filter.In(item => item.DraftId, ids)).ToListAsync(ct);
        var byDraft = usage.GroupBy(item => item.DraftId).ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);

        var orders = drafts.Select(draft =>
        {
            var billing = draft.VipBilling!;
            var rows = byDraft.GetValueOrDefault(draft.Id) ?? [];
            var vndPerXu = billing.VndPerXu > 0 ? billing.VndPerXu : pricing.VndPerXu;
            var pixelLab = (draft.AssetPlan?.EstimatedGenerations ?? 0) * Math.Max(0, billing.PixelLabVndPerGeneration);
            var spentVnd = rows.Sum(item => item.CostVnd);
            var earned = billing.ChargedXu * vndPerXu;
            return new OrderRow(
                draft.Id, draft.CreatedByUserId, billing.Preset, billing.Speed, draft.Status, draft.OrderStatus, billing.State,
                billing.PriceXu, billing.ChargedXu, billing.RefundedXu, rows.Sum(item => item.CostUsd), spentVnd, pixelLab, earned,
                earned - spentVnd - pixelLab,
                rows.GroupBy(item => item.Model).Select(group => new ModelCost(group.Key, group.Count(),
                    group.Sum(item => item.InputTokens), group.Sum(item => item.OutputTokens), group.Sum(item => item.CacheReadTokens),
                    group.Sum(item => item.CacheWriteTokens), group.Sum(item => item.CostUsd), group.Sum(item => item.CostVnd),
                    group.Count(item => item.Batch))).OrderByDescending(item => item.CostVnd).ToList(),
                draft.CreatedAt);
        }).ToList();

        // Averages only over settled orders (their cost and price are final).
        var averages = orders.Where(order => order.BillingState is AiVipBillingStates.Charged or AiVipBillingStates.Refunded
                                             or AiVipBillingStates.PartiallyRefunded)
            .GroupBy(order => (order.Preset, order.Speed))
            .Select(group => new Average(group.Key.Preset, group.Key.Speed, group.Count(),
                (long)group.Average(order => order.PriceXu), (long)group.Average(order => order.SpentVnd + order.PixelLabVnd),
                (long)group.Average(order => order.EarnedVnd), (long)group.Average(order => order.ProfitVnd)))
            .OrderBy(item => item.Preset, StringComparer.Ordinal).ThenBy(item => item.Speed, StringComparer.Ordinal).ToList();

        var revenue = await db.Database.GetCollection<CaseRevenueEvent>("caseRevenue").Find(item => item.At >= from).ToListAsync(ct);
        var payouts = await db.Database.GetCollection<AuthorPayout>("authorPayouts").Find(item => item.CreatedAt >= from).ToListAsync(ct);
        var caseIds = revenue.Select(item => item.CaseId).Distinct().ToList();
        var cases = (await db.Cases.Find(Builders<GameCase>.Filter.In(item => item.CaseId, caseIds))
                .Project(item => new { item.CaseId, item.Title, item.AuthorUserId }).ToListAsync(ct))
            .ToDictionary(item => item.CaseId, StringComparer.Ordinal);
        var earnings = revenue.GroupBy(item => item.CaseId).Select(group =>
        {
            cases.TryGetValue(group.Key, out var info);
            return new CaseEarning(group.Key, info?.Title ?? group.Key, info?.AuthorUserId ?? string.Empty,
                group.Where(item => item.Kind == CaseRevenueKinds.HintCoins).Sum(item => item.Xu),
                group.Count(item => item.Kind == CaseRevenueKinds.HintCoins),
                group.Count(item => item.Kind == CaseRevenueKinds.AdView),
                group.Where(item => item.Kind == CaseRevenueKinds.AdView).Sum(item => item.Vnd),
                payouts.Where(payout => payout.CaseId == group.Key && payout.Kind == AuthorPayoutKinds.Share
                                        && payout.State != AuthorPayoutStates.Revoked).Sum(payout => payout.Xu));
        }).OrderByDescending(item => item.HintXu * pricing.VndPerXu + item.AdVnd).ToList();

        var authors = new AuthorTotals(
            payouts.Where(item => item.State == AuthorPayoutStates.Paid).Sum(item => item.Xu),
            payouts.Where(item => item.State is AuthorPayoutStates.Held or AuthorPayoutStates.OnHold).Sum(item => item.Xu),
            payouts.Sum(item => item.RevokedXu),
            payouts.Sum(item => item.ClippedXu),
            payouts.Count);
        return new Report(from, to, pricing.UsdToVnd, pricing.VndPerXu, orders, averages, earnings, authors);
    }
}
