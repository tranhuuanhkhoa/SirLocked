using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>Filters of the opening log. Null or blank means "any". <see cref="Player"/> matches part of a name or email.</summary>
public sealed record AdminOpeningQuery(
    string? Player = null,
    string? ChestId = null,
    string? Rarity = null,
    DateTime? From = null,
    DateTime? To = null,
    int Page = 1,
    int PageSize = AdminChestsStatsService.DefaultPageSize);

/// <summary>What chests have paid out, the log of openings, and granting chests to a detective.</summary>
public sealed class AdminChestsStatsService
{
    public const int DefaultPageSize = 30;
    public const int MaxPageSize = 100;
    public const int MaxDays = 90;
    private const int TopItemCount = 10;
    private const int RareDropCount = 20;
    private const int PlayerMatchLimit = 20;
    private const int PlayerFilterLimit = 200;

    private readonly MongoDbContext _db;
    private readonly MarketStore _market;
    private readonly ICatalogProvider _provider;
    private readonly ChestService _chests;
    private readonly IAdminAudit _audit;
    private readonly MarketService _marketService;

    public AdminChestsStatsService(MongoDbContext db, MarketStore market, ICatalogProvider provider, ChestService chests, IAdminAudit audit, MarketService marketService)
    {
        _marketService = marketService;
        _db = db;
        _market = market;
        _provider = provider;
        _chests = chests;
        _audit = audit;
    }

    // ------------------------------------------------------------------ statistics

    public async Task<AdminChestStatsDto> StatsAsync(string chestId, int days, CancellationToken ct = default)
    {
        var catalog = _provider.Current;
        var chest = catalog.FindChest(chestId)
            ?? throw AdminChestsErrors.Error(404, AdminChestsErrors.ChestNotFound, $"Không có hòm {chestId}.");
        var window = Math.Clamp(days, 1, MaxDays);
        var since = _market.Now.AddDays(-window);

        var rewards = await _market.ChestOpenings.Aggregate()
            .Match(o => o.ChestDefId == chestId && o.State == ChestOpeningStates.Done && o.CreatedAt >= since)
            .Group(o => o.RewardDefId, group => new { DefId = group.Key, Count = group.Count() })
            .ToListAsync(ct);
        var opens = rewards.Sum(reward => (long)reward.Count);

        var counts = MarketRarities.All.ToDictionary(rarity => rarity, _ => 0L, StringComparer.Ordinal);
        foreach (var reward in rewards)
        {
            if (catalog.Find(reward.DefId) is { } def) counts[def.Rarity] += reward.Count;
        }
        var rates = MarketRarities.All.Select(rarity => new AdminChestRateDto(
            rarity,
            counts[rarity],
            opens == 0 ? 0m : counts[rarity] * 100m / opens,
            chest.DropRates.FirstOrDefault(rate => rate.Rarity == rarity)?.Percent ?? 0m)).ToList();

        var top = rewards
            .OrderByDescending(reward => reward.Count).ThenBy(reward => reward.DefId, StringComparer.Ordinal)
            .Take(TopItemCount)
            .Select(reward => new AdminChestTopItemDto(DefDto(catalog, reward.DefId), reward.Count))
            .ToList();

        var purchases = await _market.ChestPurchases.Aggregate()
            .Match(p => p.ChestDefId == chestId && p.State == ChestOpeningStates.Done && p.CreatedAt >= since)
            .Group(p => p.DefId, group => new { DefId = group.Key, Coins = group.Sum(p => p.Price) })
            .ToListAsync(ct);
        var fromChests = purchases.Where(p => p.DefId == chest.Id).Sum(p => p.Coins);
        var fromKeys = purchases.Where(p => p.DefId == chest.KeyDefId).Sum(p => p.Coins);

        var rareIds = rewards
            .Select(reward => reward.DefId)
            .Where(id => catalog.Find(id)?.Rarity is MarketRarities.Legendary or MarketRarities.Mystery)
            .ToList();
        var rareDrops = rareIds.Count == 0
            ? new List<ChestOpening>()
            : await _market.ChestOpenings
                .Find(o => o.ChestDefId == chestId && o.State == ChestOpeningStates.Done && o.CreatedAt >= since && rareIds.Contains(o.RewardDefId))
                .SortByDescending(o => o.CreatedAt).Limit(RareDropCount).ToListAsync(ct);
        var names = await NamesAsync(rareDrops.Select(o => o.UserId), ct);

        return new AdminChestStatsDto(chestId, window, opens, fromChests, fromKeys, rates, top,
            rareDrops.Select(o => new AdminChestRareDropDto(DefDto(catalog, o.RewardDefId), o.UserId, names.GetValueOrDefault(o.UserId, o.UserId), o.CreatedAt)).ToList());
    }

    // ------------------------------------------------------------------ the log

    public async Task<AdminOpeningPageDto> OpeningsAsync(AdminOpeningQuery query, CancellationToken ct = default)
    {
        var catalog = _provider.Current;
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);

        var filter = Builders<ChestOpening>.Filter;
        // A failed opening spent nothing and paid nothing: it did not happen as far as the log is concerned.
        var conditions = new List<FilterDefinition<ChestOpening>> { filter.Ne(o => o.State, ChestOpeningStates.Failed) };
        if (!string.IsNullOrWhiteSpace(query.Player))
        {
            var ids = await UsersMatchingAsync(query.Player, PlayerFilterLimit, activeOnly: false, ct);
            conditions.Add(filter.In(o => o.UserId, ids.Select(user => user.Id)));
        }
        if (!string.IsNullOrWhiteSpace(query.ChestId)) conditions.Add(filter.Eq(o => o.ChestDefId, query.ChestId));
        if (!string.IsNullOrWhiteSpace(query.Rarity))
        {
            var defIds = catalog.All.Where(def => def.Rarity == query.Rarity).Select(def => def.Id);
            conditions.Add(filter.In(o => o.RewardDefId, defIds));
        }
        if (query.From is { } from) conditions.Add(filter.Gte(o => o.CreatedAt, from));
        if (query.To is { } to) conditions.Add(filter.Lte(o => o.CreatedAt, to));
        var combined = filter.And(conditions);

        var total = await _market.ChestOpenings.CountDocumentsAsync(combined, cancellationToken: ct);
        var rows = await _market.ChestOpenings.Find(combined)
            .SortByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);
        var names = await NamesAsync(rows.Select(o => o.UserId), ct);

        return new AdminOpeningPageDto(rows.Select(o => new AdminOpeningRowDto(
            o.Id, o.CreatedAt, o.UserId, names.GetValueOrDefault(o.UserId, o.UserId), o.ChestDefId,
            catalog.FindChest(o.ChestDefId)?.Name ?? o.ChestDefId, DefDto(catalog, o.RewardDefId), o.State)).ToList(),
            page, pageSize, total);
    }

    // ------------------------------------------------------------------ granting

    public async Task<IReadOnlyList<AdminPlayerRefDto>> FindPlayersAsync(string? text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return Array.Empty<AdminPlayerRefDto>();
        return (await UsersMatchingAsync(text, PlayerMatchLimit, activeOnly: true, ct))
            .Select(user => new AdminPlayerRefDto(user.Id, user.FullName, user.Email))
            .ToList();
    }

    public async Task<WalletDto> GrantAsync(CurrentUser admin, AdminChestGrantRequest request, CancellationToken ct = default)
    {
        AdminChestsErrors.RequireReason(request.Reason, "cấp hòm hoặc chìa");
        // Several items, one write each: once started it runs to the end and is recorded, whatever happens to the caller.
        return await _marketService.IdempotentAsync(admin.Id, request.RequestId, async () =>
        {
            var wallet = await _chests.AdminGrantAsync(request.UserId ?? string.Empty, request.ChestId ?? string.Empty, request.Chests, request.Keys, CancellationToken.None);
            await _audit.LogAsync(admin, "chest.grant", "user", request.UserId!, null,
                new { chestId = request.ChestId, chests = request.Chests, keys = request.Keys }, request.Reason, CancellationToken.None);
            return wallet;
        }, ct);
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>Typed text is matched literally and without regard to case, so a stray ".*" lists nobody.</summary>
    private Task<List<User>> UsersMatchingAsync(string text, int limit, bool activeOnly, CancellationToken ct)
    {
        var pattern = new BsonRegularExpression(Regex.Escape(text.Trim()), "i");
        var filter = Builders<User>.Filter;
        var matches = filter.Regex(u => u.FullName, pattern) | filter.Regex(u => u.Email, pattern);
        if (activeOnly) matches &= filter.Eq(u => u.Status, UserStatus.Active);
        return _db.Users.Find(matches).SortBy(u => u.FullName).Limit(limit).ToListAsync(ct);
    }

    private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string> userIds, CancellationToken ct)
    {
        // Journals hold whatever id they were given; only a real one can be looked up.
        var ids = userIds.Distinct(StringComparer.Ordinal).Where(id => ObjectId.TryParse(id, out _)).ToList();
        if (ids.Count == 0) return new Dictionary<string, string>(StringComparer.Ordinal);
        var users = await _db.Users.Find(u => ids.Contains(u.Id)).ToListAsync(ct);
        return users.ToDictionary(user => user.Id, user => user.FullName, StringComparer.Ordinal);
    }

    /// <summary>A def since deleted still has a row in the log, under its id.</summary>
    private static ItemDefDto DefDto(CatalogSnapshot catalog, string defId) =>
        catalog.Find(defId) is { } def
            ? MarketService.ToDefDto(def)
            : new ItemDefDto(defId, MarketCategories.Curio, MarketRarities.Common, defId, defId, string.Empty, string.Empty, 0);
}
