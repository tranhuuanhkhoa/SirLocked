using System.Globalization;
using System.Text;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

public sealed record AdminMarketQuery(
    string? DefId = null,
    string? User = null,
    long? MinPrice = null,
    long? MaxPrice = null,
    string? Status = null,
    DateTime? From = null,
    DateTime? To = null,
    int Page = 1,
    int PageSize = AdminPlayersRules.DefaultPageSize);

/// <summary>
/// The market desk: what is in circulation, what is for sale, what looks odd and what is stuck. Removing a listing,
/// cancelling an order and recovering stuck work all call the market's own code; this class adds only the reason and the record.
/// </summary>
public sealed class AdminEconomyService
{
    private const int ScanLimit = 5000;
    private const int StuckLimitPerKind = 100;
    private const int MaxCsvRows = 10_000;

    private readonly AdminPlayersStore _store;
    private readonly MarketStore _market;
    private readonly MarketService _marketService;
    private readonly ChestService _chests;
    private readonly ProgressService _progress;
    private readonly AdminPlayerOperations _operations;
    private readonly AdminAvatarModeration _moderation;
    private readonly IAdminAudit _audit;
    private readonly ICatalogProvider _catalog;

    public AdminEconomyService(
        AdminPlayersStore store, MarketStore market, MarketService marketService, ChestService chests, ProgressService progress,
        AdminPlayerOperations operations, AdminAvatarModeration moderation, IAdminAudit audit, ICatalogProvider catalog)
    {
        _store = store;
        _market = market;
        _marketService = marketService;
        _chests = chests;
        _progress = progress;
        _operations = operations;
        _moderation = moderation;
        _audit = audit;
        _catalog = catalog;
    }

    private MongoDbContext Db => _market.Context;

    private long ReferencePriceOf(string defId) => _catalog.Current.Find(defId)?.ReferencePrice ?? 0;

    // ------------------------------------------------------------------ overview

    public async Task<AdminEconomyOverviewDto> OverviewAsync(int days, CancellationToken ct = default)
    {
        days = AdminEconomyRules.NormalizeDays(days);
        var (balance, held) = await CoinsAsync(ct);

        var owned = await _market.Items.Aggregate()
            .Group(item => item.DefId, group => new { DefId = group.Key, Count = group.Count() })
            .ToListAsync(ct);
        var catalog = _catalog.Current;
        var rows = owned.Select(row => (Def: catalog.Find(row.DefId), row.Count)).ToList();
        var byRarity = rows.GroupBy(row => row.Def?.Rarity ?? "UNKNOWN")
            .OrderBy(group => MarketRarities.Rank(group.Key))
            .Select(group => new AdminCountRowDto(group.Key, group.Sum(row => (long)row.Count))).ToList();
        var byCategory = rows.GroupBy(row => row.Def?.Category ?? "UNKNOWN")
            .OrderByDescending(group => group.Sum(row => row.Count))
            .Select(group => new AdminCountRowDto(group.Key, group.Sum(row => (long)row.Count))).ToList();

        var now = _market.Now;
        var flows = await FlowFactsAsync(now, days, ct);
        var dayRows = AdminEconomyRules.BuildFlowDays(now, days, flows);

        var richest = await _market.Accounts.Find(FilterDefinition<MarketAccount>.Empty)
            .SortByDescending(a => a.Balance).ThenBy(a => a.Id).Limit(20).ToListAsync(ct);
        var names = await AdminPlayersLookups.UsersByIdAsync(Db, richest.Select(a => a.Id), ct);

        return new AdminEconomyOverviewDto(
            balance, held, byRarity, byCategory, dayRows, AdminEconomyRules.Totals(dayRows),
            richest.Select(a => new AdminRichPlayerDto(a.Id, names.GetValueOrDefault(a.Id)?.FullName ?? a.Id, a.Balance, a.Held)).ToList());
    }

    private async Task<(long Balance, long Held)> CoinsAsync(CancellationToken ct)
    {
        var totals = await _market.Accounts.Aggregate()
            .Group(a => 1, group => new { Balance = group.Sum(a => a.Balance), Held = group.Sum(a => a.Held) })
            .FirstOrDefaultAsync(ct);
        return (totals?.Balance ?? 0, totals?.Held ?? 0);
    }

    private async Task<List<FlowFact>> FlowFactsAsync(DateTime now, int days, CancellationToken ct)
    {
        var since = MarketRules.WindowStartUtc(now, days);
        var runs = new[]
        {
            FlowAsync(_market.Accounts, AdminEconomyRules.FlowStarter, "createdAt", since, new BsonDocument(), MarketRules.StarterCoins, ct),
            FlowAsync(_market.Rewards, AdminEconomyRules.FlowGameRewards, "createdAt", since, new BsonDocument("applied", true), "$amount", ct),
            FlowAsync(_market.ChestPurchases, AdminEconomyRules.FlowChestShop, "createdAt", since, new BsonDocument("state", ChestOpeningStates.Done), "$price", ct),
            FlowAsync(_market.Sales, AdminEconomyRules.FlowMarketFees, "at", since, new BsonDocument(), "$fee", ct),
            FlowAsync(_store.Ops, AdminEconomyRules.FlowAdminIn, "createdAt", since,
                new BsonDocument { { "kind", AdminPlayerOpKinds.Coins }, { "state", ChestOpeningStates.Done }, { "amount", new BsonDocument("$gt", 0) } }, "$amount", ct),
            FlowAsync(_store.Ops, AdminEconomyRules.FlowAdminOut, "createdAt", since,
                new BsonDocument { { "kind", AdminPlayerOpKinds.Coins }, { "state", ChestOpeningStates.Done }, { "amount", new BsonDocument("$lt", 0) } },
                new BsonDocument("$abs", "$amount"), ct),
        };
        return (await Task.WhenAll(runs)).SelectMany(facts => facts).ToList();
    }

    private static async Task<IReadOnlyList<FlowFact>> FlowAsync<T>(
        IMongoCollection<T> collection, string source, string dateField, DateTime since, BsonDocument match, BsonValue amount, CancellationToken ct)
    {
        var offset = MarketRules.DayOffset;
        var timezone = $"{(offset < TimeSpan.Zero ? "-" : "+")}{offset:hh\\:mm}";
        var filter = new BsonDocument(match) { { dateField, new BsonDocument("$gte", since) } };
        var pipeline = new[]
        {
            new BsonDocument("$match", filter),
            new BsonDocument("$group", new BsonDocument
            {
                { "_id", new BsonDocument("$dateTrunc", new BsonDocument { { "date", "$" + dateField }, { "unit", "day" }, { "timezone", timezone } }) },
                { "sum", new BsonDocument("$sum", amount) },
            }),
        };
        var rows = await collection.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
        return rows.Select(row => new FlowFact(MarketRules.MarketDay(row["_id"].ToUniversalTime()), source, row["sum"].ToInt64())).ToList();
    }

    public async Task<AdminEconomyDashboardDto> DashboardAsync(CancellationToken ct = default)
    {
        var today = MarketRules.WindowStartUtc(_market.Now, 1);
        var newPlayers = await Db.Users.CountDocumentsAsync(u => u.CreatedAt >= today, cancellationToken: ct);
        var games = await Db.GameResults.CountDocumentsAsync(r => r.CreatedAt >= today, cancellationToken: ct);
        var opens = await _market.ChestOpenings.CountDocumentsAsync(o => o.State == ChestOpeningStates.Done && o.CreatedAt >= today, cancellationToken: ct);
        var (balance, _) = await CoinsAsync(ct);
        var stuck = await StuckAsync(ct);
        return new AdminEconomyDashboardDto(newPlayers, games, opens, balance, stuck.Items.Count, await _moderation.PendingCountAsync(ct));
    }

    // ------------------------------------------------------------------ the desk

    public async Task<AdminPageDto<AdminListingRowDto>> ListingsAsync(AdminMarketQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var filter = Builders<MarketListing>.Filter;
        var where = filter.Eq(l => l.Status, string.IsNullOrWhiteSpace(query.Status) ? MarketListingStatus.Active : query.Status.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(query.DefId)) where &= filter.Eq(l => l.DefId, query.DefId.Trim());
        if (query.MinPrice is { } min) where &= filter.Gte(l => l.Price, min);
        if (query.MaxPrice is { } max) where &= filter.Lte(l => l.Price, max);
        if (!string.IsNullOrWhiteSpace(query.User))
            where &= filter.In(l => l.SellerId, await AdminPlayersLookups.ResolveUserIdsAsync(Db, query.User, ct));

        var total = await _market.Listings.CountDocumentsAsync(where, cancellationToken: ct);
        var listings = await _market.Listings.Find(where)
            .SortByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var rows = listings.Select(l =>
        {
            var reference = ReferencePriceOf(l.DefId);
            return new AdminListingRowDto(l.Id, l.ItemId, _marketService.DefDto(l.DefId), l.SellerId, l.SellerName, l.Price, reference,
                AdminEconomyRules.PriceAnomaly(l.Price, reference), l.Status, l.CreatedAt);
        }).ToList();
        return new AdminPageDto<AdminListingRowDto>(rows, page, pageSize, total);
    }

    /// <summary>The market's own cancel: the item comes back free to its seller, and nobody is paid.</summary>
    public async Task<ListingDto> RemoveListingAsync(CurrentUser admin, string listingId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var listing = await _market.Listings.Find(l => l.Id == listingId).FirstOrDefaultAsync(ct)
            ?? throw MarketService.Error(404, MarketErrors.ListingNotFound, "Không tìm thấy tin rao này.");
        var removed = await _marketService.CancelListingAsync(listing.SellerId, listing.Id, ct);
        await _audit.LogAsync(admin, "listing.remove", "listing", listing.Id,
            new { sellerId = listing.SellerId, sellerName = listing.SellerName, itemId = listing.ItemId, defId = listing.DefId, price = listing.Price, status = listing.Status },
            new { status = removed.Status }, note, CancellationToken.None);
        return removed;
    }

    public async Task<AdminPageDto<AdminOrderRowDto>> OrdersAsync(AdminMarketQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var filter = Builders<MarketBuyOrder>.Filter;
        var where = filter.Eq(o => o.Status, string.IsNullOrWhiteSpace(query.Status) ? MarketOrderStatus.Active : query.Status.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(query.DefId)) where &= filter.Eq(o => o.DefId, query.DefId.Trim());
        if (query.MinPrice is { } min) where &= filter.Gte(o => o.Price, min);
        if (query.MaxPrice is { } max) where &= filter.Lte(o => o.Price, max);
        if (!string.IsNullOrWhiteSpace(query.User))
            where &= filter.In(o => o.BuyerId, await AdminPlayersLookups.ResolveUserIdsAsync(Db, query.User, ct));

        var total = await _market.Orders.CountDocumentsAsync(where, cancellationToken: ct);
        var orders = await _market.Orders.Find(where)
            .SortByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var rows = orders.Select(o =>
        {
            var reference = ReferencePriceOf(o.DefId);
            return new AdminOrderRowDto(o.Id, _marketService.DefDto(o.DefId), o.BuyerId, o.BuyerName, o.Price, reference,
                AdminEconomyRules.PriceAnomaly(o.Price, reference), o.Status, o.CreatedAt);
        }).ToList();
        return new AdminPageDto<AdminOrderRowDto>(rows, page, pageSize, total);
    }

    /// <summary>The market's own cancel: the held coins and the reserved slot go back to the buyer under one operation key.</summary>
    public async Task<OrderDto> CancelOrderAsync(CurrentUser admin, string orderId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var order = await _market.Orders.Find(o => o.Id == orderId).FirstOrDefaultAsync(ct)
            ?? throw MarketService.Error(404, MarketErrors.OrderNotFound, "Không tìm thấy lệnh mua này.");
        var cancelled = await _marketService.CancelOrderAsync(order.BuyerId, order.Id, ct);
        await _audit.LogAsync(admin, "order.cancel", "order", order.Id,
            new { buyerId = order.BuyerId, buyerName = order.BuyerName, defId = order.DefId, price = order.Price, status = order.Status },
            new { status = cancelled.Status, refunded = order.Price }, note, CancellationToken.None);
        return cancelled;
    }

    private async Task<FilterDefinition<MarketSale>> SalesFilterAsync(AdminMarketQuery query, CancellationToken ct)
    {
        var filter = Builders<MarketSale>.Filter;
        var where = filter.Empty;
        if (!string.IsNullOrWhiteSpace(query.DefId)) where &= filter.Eq(s => s.DefId, query.DefId.Trim());
        if (query.MinPrice is { } min) where &= filter.Gte(s => s.Price, min);
        if (query.MaxPrice is { } max) where &= filter.Lte(s => s.Price, max);
        if (query.From is { } from) where &= filter.Gte(s => s.At, from);
        if (query.To is { } to) where &= filter.Lte(s => s.At, to);
        if (!string.IsNullOrWhiteSpace(query.User))
        {
            var ids = await AdminPlayersLookups.ResolveUserIdsAsync(Db, query.User, ct);
            where &= filter.In(s => s.SellerId, ids) | filter.In(s => s.BuyerId, ids);
        }
        return where;
    }

    public async Task<AdminPageDto<AdminSaleRowDto>> SalesAsync(AdminMarketQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var where = await SalesFilterAsync(query, ct);
        var total = await _market.Sales.CountDocumentsAsync(where, cancellationToken: ct);
        var sales = await _market.Sales.Find(where).SortByDescending(s => s.At).ThenByDescending(s => s.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var rows = await ToSaleRowsAsync(sales, ct);
        return new AdminPageDto<AdminSaleRowDto>(rows, page, pageSize, total);
    }

    private async Task<List<AdminSaleRowDto>> ToSaleRowsAsync(IReadOnlyCollection<MarketSale> sales, CancellationToken ct)
    {
        var names = await AdminPlayersLookups.UsersByIdAsync(Db, sales.SelectMany(s => new[] { s.SellerId, s.BuyerId }), ct);
        return sales.Select(s => new AdminSaleRowDto(
            s.Id, _marketService.DefDto(s.DefId), s.ItemId, s.Price, s.Fee,
            AdminEconomyRules.PriceAnomaly(s.Price, ReferencePriceOf(s.DefId)),
            s.SellerId, names.GetValueOrDefault(s.SellerId)?.FullName ?? s.SellerId,
            s.BuyerId, names.GetValueOrDefault(s.BuyerId)?.FullName ?? s.BuyerId,
            s.ListingId, s.OrderId, s.At)).ToList();
    }

    /// <summary>The newest rows of the filter, up to <see cref="MaxCsvRows"/>, in UTF-8 with a BOM so a spreadsheet reads the Vietnamese names.</summary>
    public async Task<byte[]> ExportSalesCsvAsync(AdminMarketQuery query, CancellationToken ct = default)
    {
        var where = await SalesFilterAsync(query, ct);
        var sales = await _market.Sales.Find(where).SortByDescending(s => s.At).ThenByDescending(s => s.Id).Limit(MaxCsvRows).ToListAsync(ct);
        var rows = await ToSaleRowsAsync(sales, ct);
        var csv = new StringBuilder("at,defId,name,price,fee,sellerId,seller,buyerId,buyer,listingId\r\n");
        foreach (var row in rows)
        {
            csv.AppendJoin(',',
                row.At.ToString("o", CultureInfo.InvariantCulture),
                AdminEconomyRules.CsvField(row.Def.Id),
                AdminEconomyRules.CsvField(row.Def.Name),
                row.Price.ToString(CultureInfo.InvariantCulture),
                row.Fee.ToString(CultureInfo.InvariantCulture),
                AdminEconomyRules.CsvField(row.SellerId),
                AdminEconomyRules.CsvField(row.SellerName),
                AdminEconomyRules.CsvField(row.BuyerId),
                AdminEconomyRules.CsvField(row.BuyerName),
                AdminEconomyRules.CsvField(row.ListingId)).Append("\r\n");
        }
        return AdminEconomyRules.ToCsvBytes(csv.ToString());
    }

    public async Task<AdminPageDto<AdminTradeRowDto>> TradesAsync(AdminMarketQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var filter = Builders<TradeOffer>.Filter;
        var where = filter.Empty;
        if (!string.IsNullOrWhiteSpace(query.Status)) where &= filter.Eq(t => t.Status, query.Status.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(query.User))
        {
            var ids = await AdminPlayersLookups.ResolveUserIdsAsync(Db, query.User, ct);
            where &= filter.In(t => t.FromUserId, ids) | filter.In(t => t.ToUserId, ids);
        }
        var total = await _market.Trades.CountDocumentsAsync(where, cancellationToken: ct);
        var trades = await _market.Trades.Find(where).SortByDescending(t => t.CreatedAt).ThenByDescending(t => t.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        return new AdminPageDto<AdminTradeRowDto>(trades.Select(t => AdminPlayersLookups.ToTradeRow(t, _marketService)).ToList(), page, pageSize, total);
    }

    // ------------------------------------------------------------------ anomalies

    /// <summary>Only reads. An admin decides what, if anything, to do about a flag.</summary>
    public async Task<AdminAnomaliesDto> AnomaliesAsync(CancellationToken ct = default)
    {
        var since = _market.Now.AddDays(-AdminEconomyRules.AnomalyWindowDays);

        var listings = await _market.Listings.Find(l => l.Status == MarketListingStatus.Active)
            .SortByDescending(l => l.CreatedAt).Limit(ScanLimit).ToListAsync(ct);
        var sales = await _market.Sales.Find(s => s.At >= since).SortByDescending(s => s.At).Limit(ScanLimit).ToListAsync(ct);
        var trades = await _market.Trades
            .Find(t => t.Status == TradeOfferStatus.Accepted && t.RespondedAt >= since)
            .SortByDescending(t => t.RespondedAt).Limit(ScanLimit).ToListAsync(ct);

        var facts = trades.Select(t => new TradeFact(
            t.Id, t.FromUserId, t.ToUserId, t.FromCoins, t.ToCoins, t.FromItems.Count, t.ToItems.Count, t.RespondedAt ?? t.UpdatedAt)).ToList();
        var userIds = facts.SelectMany(t => new[] { t.FromId, t.ToId }).Concat(sales.Select(s => s.SellerId));
        var users = await AdminPlayersLookups.UsersByIdAsync(Db, userIds, ct);
        string NameOf(string id) => users.GetValueOrDefault(id)?.FullName ?? id;

        var prices = new List<AdminPriceAnomalyDto>();
        foreach (var listing in listings)
        {
            var reference = ReferencePriceOf(listing.DefId);
            if (AdminEconomyRules.PriceAnomaly(listing.Price, reference) is { } flag)
                prices.Add(new AdminPriceAnomalyDto("LISTING", listing.Id, null, _marketService.DefDto(listing.DefId), listing.Price, reference, flag,
                    listing.SellerId, listing.SellerName, listing.CreatedAt));
        }
        foreach (var sale in sales)
        {
            var reference = ReferencePriceOf(sale.DefId);
            if (AdminEconomyRules.PriceAnomaly(sale.Price, reference) is { } flag)
                prices.Add(new AdminPriceAnomalyDto("SALE", sale.ListingId, sale.Id, _marketService.DefDto(sale.DefId), sale.Price, reference, flag,
                    sale.SellerId, NameOf(sale.SellerId), sale.At));
        }

        var created = users.Values.ToDictionary(user => user.Id, user => user.CreatedAt, StringComparer.Ordinal);
        var funnels = AdminEconomyRules.FindNewAccountFunnels(facts, created).Select(flag => new AdminFunnelDto(
            flag.ReceiverId, NameOf(flag.ReceiverId), flag.Coins, flag.Items, flag.GiverIds, flag.GiverIds.Select(NameOf).ToList(), flag.TradeIds)).ToList();
        var pairs = AdminEconomyRules.FindRepeatedPairs(facts).Select(flag => new AdminRepeatedPairDto(
            flag.FirstId, NameOf(flag.FirstId), flag.SecondId, NameOf(flag.SecondId), flag.Trades, flag.LastAt)).ToList();

        return new AdminAnomaliesDto(prices, funnels, pairs, since,
            listings.Count >= ScanLimit || sales.Count >= ScanLimit || trades.Count >= ScanLimit);
    }

    // ------------------------------------------------------------------ stuck operations

    public async Task<AdminStuckDto> StuckAsync(CancellationToken ct = default)
    {
        var now = _market.Now;
        var cutoff = now.AddMinutes(-AdminEconomyRules.StuckAfterMinutes);
        var rows = new List<AdminStuckRowDto>();
        void Add(string kind, string id, string state, string? userId, DateTime updatedAt, string? detail) =>
            rows.Add(new AdminStuckRowDto(kind, id, state, userId, updatedAt, (long)(now - updatedAt).TotalSeconds, detail));

        var listings = await _market.Listings
            .Find(l => (l.Status == MarketListingStatus.Opening || l.Status == MarketListingStatus.Pending) && l.UpdatedAt < cutoff)
            .SortBy(l => l.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var l in listings) Add(AdminEconomyRules.StuckListing, l.Id, l.Status, l.SellerId, l.UpdatedAt, $"{l.DefId} · {l.Price} xu");

        var orders = await _market.Orders
            .Find(o => (o.Status == MarketOrderStatus.Opening || o.Status == MarketOrderStatus.Pending
                        || (o.Status == MarketOrderStatus.Cancelled && o.Held && !o.Released)) && o.UpdatedAt < cutoff)
            .SortBy(o => o.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var o in orders) Add(AdminEconomyRules.StuckOrder, o.Id, o.Status, o.BuyerId, o.UpdatedAt, $"{o.DefId} · {o.Price} xu");

        var trades = await _market.Trades
            .Find(t => t.Status == TradeOfferStatus.Accepting && t.UpdatedAt < cutoff)
            .SortBy(t => t.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var t in trades) Add(AdminEconomyRules.StuckTrade, t.Id, t.Status, t.FromUserId, t.UpdatedAt, $"{t.FromName} → {t.ToName}");

        var txs = await _market.Txs
            .Find(t => (t.State == MarketTxStates.Pending || t.State == MarketTxStates.RollingBack) && t.UpdatedAt < cutoff)
            .SortBy(t => t.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var t in txs) Add(AdminEconomyRules.StuckTransaction, t.Id, t.State, t.BuyerId ?? t.FromId, t.UpdatedAt, t.Kind);

        var openings = await _market.ChestOpenings
            .Find(o => (o.State == ChestOpeningStates.Pending || o.State == ChestOpeningStates.RollingBack) && o.UpdatedAt < cutoff)
            .SortBy(o => o.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var o in openings) Add(AdminEconomyRules.StuckChestOpening, o.Id, o.State, o.UserId, o.UpdatedAt, o.ChestDefId);

        var purchases = await _market.ChestPurchases
            .Find(p => p.State == ChestOpeningStates.Pending && p.UpdatedAt < cutoff)
            .SortBy(p => p.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var p in purchases) Add(AdminEconomyRules.StuckChestPurchase, p.Id, p.State, p.UserId, p.UpdatedAt, $"{p.DefId} · {p.Price} xu");

        var exchanges = await _market.XpExchanges
            .Find(e => (e.State == ChestOpeningStates.Pending || e.State == ChestOpeningStates.RollingBack) && e.UpdatedAt < cutoff)
            .SortBy(e => e.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var e in exchanges) Add(AdminEconomyRules.StuckXpExchange, e.Id, e.State, e.UserId, e.UpdatedAt, $"{e.ItemIds.Count} vật phẩm · {e.Xp} KN");

        var operations = await _store.Ops
            .Find(o => (o.State == ChestOpeningStates.Pending || (o.State == ChestOpeningStates.Done && !o.Audited)) && o.UpdatedAt < cutoff)
            .SortBy(o => o.UpdatedAt).Limit(StuckLimitPerKind).ToListAsync(ct);
        foreach (var o in operations) Add(AdminEconomyRules.StuckAdminOperation, o.Id, o.State, o.TargetUserId, o.UpdatedAt, o.Kind);

        var truncated = new[] { listings.Count, orders.Count, trades.Count, txs.Count, openings.Count, purchases.Count, exchanges.Count, operations.Count }
            .Any(count => count >= StuckLimitPerKind);
        return new AdminStuckDto(rows.OrderByDescending(row => row.AgeSeconds).ToList(), AdminEconomyRules.StuckAfterMinutes, truncated);
    }

    /// <summary>One pass of exactly what the maintenance worker runs every 30 seconds, plus the player admin's own journal. No repair logic of its own.</summary>
    public async Task<AdminRecoveryReportDto> RecoverAsync(CurrentUser admin, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var market = await _marketService.RecoverAsync(MarketMaintenanceWorker.StaleAfter, ct);
        var chests = await _chests.RecoverAsync(MarketMaintenanceWorker.StaleAfter, ct);
        var exchanges = await _progress.RecoverAsync(MarketMaintenanceWorker.StaleAfter, ct);
        var operations = await _operations.RecoverAsync(MarketMaintenanceWorker.StaleAfter, ct);
        var still = await StuckAsync(ct);
        var report = new AdminRecoveryReportDto(
            market.Total + chests.Total + exchanges + operations,
            market.Transactions, market.Listings, market.Orders, market.Locks, market.Rewards, market.StarterGrants, market.Matches,
            chests.Openings, chests.Purchases, exchanges, operations, still.Items.Count);
        await _audit.LogAsync(admin, "economy.recover", "economy", "recovery", null, report, note, CancellationToken.None);
        return report;
    }
}
