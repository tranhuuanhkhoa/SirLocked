using System.Text.Json;
using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

public sealed record AdminPlayerQuery(
    string? Search = null,
    string? Role = null,
    string? Status = null,
    string? Sort = null,
    bool Ascending = false,
    int Page = 1,
    int PageSize = AdminPlayersRules.DefaultPageSize);

/// <summary>Reads shared by the admin services. Only the fields a page shows ever leave the user document.</summary>
internal static class AdminPlayersLookups
{
    internal sealed record UserSummary(string Id, string FullName, string Email, DateTime CreatedAt);

    /// <summary>Ids that are not ObjectIds belong to nobody: a lookup must not throw on one.</summary>
    internal static async Task<Dictionary<string, UserSummary>> UsersByIdAsync(MongoDbContext db, IEnumerable<string> ids, CancellationToken ct)
    {
        var valid = ids.Where(id => ObjectId.TryParse(id, out _)).Distinct(StringComparer.Ordinal).ToList();
        if (valid.Count == 0) return new Dictionary<string, UserSummary>();
        var users = await db.Users.Find(Builders<User>.Filter.In(u => u.Id, valid))
            .Project(u => new { u.Id, u.FullName, u.Email, u.CreatedAt })
            .ToListAsync(ct);
        return users.ToDictionary(u => u.Id, u => new UserSummary(u.Id, u.FullName, u.Email, u.CreatedAt), StringComparer.Ordinal);
    }

    /// <summary>Who a free-text filter means: an id as it is, otherwise everyone whose name or e-mail contains it.</summary>
    internal static async Task<List<string>> ResolveUserIdsAsync(MongoDbContext db, string? text, CancellationToken ct)
    {
        var search = AdminPlayersRules.CleanSearch(text);
        if (ObjectId.TryParse(search, out _)) return new List<string> { search };
        var pattern = new BsonRegularExpression(Regex.Escape(search), "i");
        return await db.Users
            .Find(Builders<User>.Filter.Regex(u => u.FullName, pattern) | Builders<User>.Filter.Regex(u => u.Email, pattern))
            .Project(u => u.Id).Limit(200).ToListAsync(ct);
    }

    internal static AdminTradeRowDto ToTradeRow(TradeOffer offer, MarketService market) => new(
        offer.Id, offer.FromUserId, offer.FromName, offer.ToUserId, offer.ToName,
        offer.FromItems.Select(item => market.DefDto(item.DefId)).ToList(),
        offer.ToItems.Select(item => market.DefDto(item.DefId)).ToList(),
        offer.FromCoins, offer.ToCoins, offer.Message, offer.Status, offer.FailReason, offer.CreatedAt, offer.RespondedAt);
}

/// <summary>
/// The reading side of the player admin. Nothing here writes: looking at someone who never opened the market must not
/// create their wallet and hand them the one-time starter grant.
/// </summary>
public sealed class AdminPlayersService
{
    private readonly AdminPlayersStore _store;
    private readonly MarketStore _market;
    private readonly CatalogStore _catalogStore;
    private readonly MarketService _marketService;
    private readonly IPlayerCosmeticsReader _cosmetics;
    private readonly ICatalogProvider _catalog;

    public AdminPlayersService(
        AdminPlayersStore store, MarketStore market, CatalogStore catalogStore, MarketService marketService, IPlayerCosmeticsReader cosmetics, ICatalogProvider catalog)
    {
        _store = store;
        _market = market;
        _catalogStore = catalogStore;
        _marketService = marketService;
        _cosmetics = cosmetics;
        _catalog = catalog;
    }

    private MongoDbContext Db => _market.Context;

    private async Task<User> RequireUserAsync(string userId, CancellationToken ct)
    {
        var user = ObjectId.TryParse(userId, out _) ? await Db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync(ct) : null;
        return user ?? throw AdminPlayersRules.Error(404, AdminPlayerErrors.PlayerNotFound, "Không tìm thấy người chơi này.");
    }

    /// <summary>What the old lock and role routes record. Null for an id that is not one: those routes keep their own answer to it.</summary>
    public async Task<object?> AuditSnapshotAsync(string userId, CancellationToken ct = default)
    {
        if (!ObjectId.TryParse(userId, out _)) return null;
        var user = await Db.Users.Find(u => u.Id == userId).Project(u => new { u.Status, u.Role }).FirstOrDefaultAsync(ct);
        return user is null ? null : new { status = user.Status, role = user.Role };
    }

    // ------------------------------------------------------------------ the list

    private static FilterDefinition<User> BuildFilter(AdminPlayerQuery query)
    {
        var filter = Builders<User>.Filter;
        var conditions = new List<FilterDefinition<User>>();

        var search = AdminPlayersRules.CleanSearch(query.Search);
        if (search.Length > 0)
        {
            var pattern = new BsonRegularExpression(Regex.Escape(search), "i");
            var matches = filter.Regex(u => u.FullName, pattern) | filter.Regex(u => u.Email, pattern);
            conditions.Add(ObjectId.TryParse(search, out _) ? matches | filter.Eq(u => u.Id, search) : matches);
        }

        var role = (query.Role ?? string.Empty).Trim().ToUpperInvariant();
        if (role.Length > 0)
        {
            if (role is not (UserRole.Player or UserRole.Vip or UserRole.Admin))
                throw AdminPlayersRules.Error(400, AdminPlayerErrors.BadQuery, "Vai trò không hợp lệ.");
            conditions.Add(filter.Eq(u => u.Role, role));
        }

        switch ((query.Status ?? string.Empty).Trim().ToUpperInvariant())
        {
            case "":
                break;
            case AdminPlayerStatusFilter.Active:
                conditions.Add(filter.Eq(u => u.Status, UserStatus.Active));
                break;
            case AdminPlayerStatusFilter.Locked:
                conditions.Add(filter.Eq(u => u.Status, UserStatus.Locked));
                break;
            case AdminPlayerStatusFilter.Unverified:
                conditions.Add(filter.Ne(u => u.IsEmailVerified, true));
                break;
            default:
                throw AdminPlayersRules.Error(400, AdminPlayerErrors.BadQuery, "Trạng thái lọc không hợp lệ.");
        }
        return conditions.Count == 0 ? filter.Empty : filter.And(conditions);
    }

    /// <summary>
    /// The page is cut on the server. Sorting by coins or level has to read each matching player's wallet first; those
    /// lookups go by _id, so they cost one index read per player. Sorting by date reads only the rows of the page.
    /// </summary>
    public async Task<AdminPageDto<AdminPlayerRowDto>> ListAsync(AdminPlayerQuery query, CancellationToken ct = default)
    {
        var (page, pageSize) = AdminPlayersRules.Paging(query.Page, query.PageSize);
        var sort = string.IsNullOrWhiteSpace(query.Sort) ? AdminPlayerSorts.Created : query.Sort.Trim().ToLowerInvariant();
        if (sort is not (AdminPlayerSorts.Created or AdminPlayerSorts.Level or AdminPlayerSorts.Coins))
            throw AdminPlayersRules.Error(400, AdminPlayerErrors.BadQuery, "Cách sắp xếp không hợp lệ.");
        var filter = BuildFilter(query);
        var total = await Db.Users.CountDocumentsAsync(filter, cancellationToken: ct);
        var direction = query.Ascending ? 1 : -1;

        var pipeline = Db.Users.Aggregate(new AggregateOptions { AllowDiskUse = true }).Match(filter)
            .AppendStage<BsonDocument>(new BsonDocument("$project", new BsonDocument
            {
                { "fullName", 1 }, { "email", 1 }, { "role", 1 }, { "status", 1 }, { "isEmailVerified", 1 }, { "createdAt", 1 },
                { "uid", new BsonDocument("$toString", "$_id") },
            }));
        var cut = new[]
        {
            new BsonDocument("$skip", (page - 1) * pageSize),
            new BsonDocument("$limit", pageSize),
        };
        if (sort == AdminPlayerSorts.Created)
        {
            pipeline = pipeline.AppendStage<BsonDocument>(new BsonDocument("$sort", new BsonDocument { { "createdAt", direction }, { "_id", direction } }));
            foreach (var stage in cut) pipeline = pipeline.AppendStage<BsonDocument>(stage);
        }
        pipeline = pipeline
            .AppendStage<BsonDocument>(new BsonDocument("$lookup", new BsonDocument { { "from", "marketAccounts" }, { "localField", "uid" }, { "foreignField", "_id" }, { "as", "wallet" } }))
            .AppendStage<BsonDocument>(new BsonDocument("$lookup", new BsonDocument { { "from", "playerProgress" }, { "localField", "uid" }, { "foreignField", "_id" }, { "as", "progress" } }))
            .AppendStage<BsonDocument>(new BsonDocument("$addFields", new BsonDocument
            {
                { "balance", new BsonDocument("$ifNull", new BsonArray { new BsonDocument("$first", "$wallet.balance"), 0 }) },
                { "held", new BsonDocument("$ifNull", new BsonArray { new BsonDocument("$first", "$wallet.held"), 0 }) },
                { "level", new BsonDocument("$ifNull", new BsonArray { new BsonDocument("$first", "$progress.level"), 1 }) },
                { "avatar", new BsonDocument("$ifNull", new BsonArray { new BsonDocument("$first", "$progress.avatar"), CosmeticCatalog.DefaultAvatar }) },
                { "avatarUrl", new BsonDocument("$first", "$progress.avatarUrl") },
            }))
            .AppendStage<BsonDocument>(new BsonDocument("$project", new BsonDocument { { "wallet", 0 }, { "progress", 0 } }));
        if (sort != AdminPlayerSorts.Created)
        {
            var field = sort == AdminPlayerSorts.Coins ? "balance" : "level";
            pipeline = pipeline.AppendStage<BsonDocument>(new BsonDocument("$sort", new BsonDocument { { field, direction }, { "_id", direction } }));
            foreach (var stage in cut) pipeline = pipeline.AppendStage<BsonDocument>(stage);
        }

        var rows = await pipeline.ToListAsync(ct);
        return new AdminPageDto<AdminPlayerRowDto>(rows.Select(ToRow).ToList(), page, pageSize, total);
    }

    private static AdminPlayerRowDto ToRow(BsonDocument row) => new(
        row["uid"].AsString,
        row.GetValue("fullName", string.Empty).AsString,
        row.GetValue("email", string.Empty).AsString,
        row.GetValue("role", UserRole.Player).AsString,
        row.GetValue("status", UserStatus.Active).AsString,
        row.GetValue("isEmailVerified", false).ToBoolean(),
        row.GetValue("createdAt", BsonNull.Value) is { IsBsonNull: false } created ? created.ToUniversalTime() : default,
        row["level"].ToInt32(),
        row["balance"].ToInt64(),
        row["held"].ToInt64(),
        row["avatar"].AsString,
        row.GetValue("avatarUrl", BsonNull.Value) is { IsString: true } url ? url.AsString : null);

    // ------------------------------------------------------------------ the detail

    public async Task<AdminPlayerDetailDto> GetDetailAsync(string userId, CancellationToken ct = default)
    {
        var user = await RequireUserAsync(userId, ct);
        var progress = await _market.PlayerProgress.Find(p => p.Id == userId).FirstOrDefaultAsync(ct);
        var account = await _market.FindAccountAsync(userId, ct);
        var wallet = account is null ? null : await _marketService.AdminWalletAsync(account, ct);
        var look = (await _cosmetics.GetCosmeticsAsync(new[] { userId }, ct))[userId];
        var inventory = await _marketService.AdminInventoryAsync(userId, account, ct);

        var offers = await _market.Trades
            .Find(t => (t.FromUserId == userId || t.ToUserId == userId)
                       && (t.Status == TradeOfferStatus.Pending || t.Status == TradeOfferStatus.Accepting))
            .ToListAsync(ct);
        var offersByItem = offers
            .SelectMany(offer => offer.FromItems.Concat(offer.ToItems).Select(item => (item.ItemId, offer.Id)))
            .GroupBy(pair => pair.ItemId)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<string>)group.Select(pair => pair.Id).Distinct().ToList());

        var level = progress?.Level ?? 1;
        return new AdminPlayerDetailDto(
            new AdminPlayerAccountDto(
                user.Id, user.FullName, user.Email, user.Role, user.Status, user.IsEmailVerified,
                !string.IsNullOrWhiteSpace(user.PasswordHash),
                user.RefreshTokenExpiry > _market.Now,
                user.CreatedAt, user.UpdatedAt),
            new AdminPlayerProgressDto(
                level, progress?.Xp ?? 0, level >= ProgressRules.MaxLevel ? 0 : ProgressRules.XpToNext(level), ProgressRules.MaxLevel,
                progress?.Avatar ?? CosmeticCatalog.DefaultAvatar, progress?.AvatarUrl, progress?.AvatarUploadedAt),
            wallet is null
                ? new AdminPlayerWalletDto(false, 0, 0, 0, MarketRules.InventorySlots, 0, 0)
                : new AdminPlayerWalletDto(true, wallet.Balance, wallet.Held, wallet.SlotsUsed, wallet.SlotCap, wallet.ItemCount, wallet.ReservedSlots),
            new AdminPlayerLookDto(look.FrameDefId, look.TitleDefId, look.EntranceDefId),
            inventory.Select(item => new AdminPlayerItemDto(
                item.ItemId, item.Def, item.Locked, item.LockReason, item.ListingId, item.ListingPrice, item.Equipped, item.Source, item.AcquiredAt,
                offersByItem.GetValueOrDefault(item.ItemId, Array.Empty<string>()))).ToList());
    }

    // ------------------------------------------------------------------ histories

    public async Task<AdminPageDto<AdminGameRowDto>> GamesAsync(string userId, int page, int pageSize, CancellationToken ct = default)
    {
        await RequireUserAsync(userId, ct);
        (page, pageSize) = AdminPlayersRules.Paging(page, pageSize);
        var filter = Builders<GameResult>.Filter.AnyEq(r => r.Players, userId);
        var total = await Db.GameResults.CountDocumentsAsync(filter, cancellationToken: ct);
        // A result embeds the case definition it was played on, which this list does not need.
        var projection = Builders<GameResult>.Projection
            .Include(r => r.RoomId).Include(r => r.CaseId).Include(r => r.Success).Include(r => r.Ending).Include(r => r.CreatedAt)
            .Include("caseDefinitionSnapshot.title").Include("scoreSummary.totalScore").Include("scoreSummary.rank");
        var results = await Db.GameResults.Find(filter)
            .SortByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize)
            .Project<GameResult>(projection)
            .ToListAsync(ct);
        var items = results.Select(r => new AdminGameRowDto(
            r.Id, r.RoomId, r.CaseId,
            string.IsNullOrEmpty(r.CaseDefinitionSnapshot?.Title) ? r.CaseId : r.CaseDefinitionSnapshot!.Title,
            r.Success, r.Ending, r.ScoreSummary?.TotalScore ?? 0, r.ScoreSummary?.Rank ?? string.Empty, r.CreatedAt)).ToList();
        return new AdminPageDto<AdminGameRowDto>(items, page, pageSize, total);
    }

    public async Task<AdminPageDto<AdminChestOpeningRowDto>> ChestOpeningsAsync(string userId, int page, int pageSize, CancellationToken ct = default)
    {
        await RequireUserAsync(userId, ct);
        (page, pageSize) = AdminPlayersRules.Paging(page, pageSize);
        var total = await _market.ChestOpenings.CountDocumentsAsync(o => o.UserId == userId, cancellationToken: ct);
        var openings = await _market.ChestOpenings.Find(o => o.UserId == userId)
            .SortByDescending(o => o.CreatedAt).Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var catalog = _catalog.Current;
        var items = openings.Select(o => new AdminChestOpeningRowDto(
            o.Id, o.ChestDefId, catalog.FindChest(o.ChestDefId)?.Name ?? o.ChestDefId,
            _marketService.DefDto(o.RewardDefId), o.State, o.CreatedAt)).ToList();
        return new AdminPageDto<AdminChestOpeningRowDto>(items, page, pageSize, total);
    }

    public async Task<AdminPageDto<AdminPlayerSaleRowDto>> SalesAsync(string userId, int page, int pageSize, CancellationToken ct = default)
    {
        await RequireUserAsync(userId, ct);
        (page, pageSize) = AdminPlayersRules.Paging(page, pageSize);
        var total = await _market.Sales.CountDocumentsAsync(s => s.SellerId == userId || s.BuyerId == userId, cancellationToken: ct);
        var sales = await _market.Sales.Find(s => s.SellerId == userId || s.BuyerId == userId)
            .SortByDescending(s => s.At).Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var others = await AdminPlayersLookups.UsersByIdAsync(Db, sales.Select(s => s.SellerId == userId ? s.BuyerId : s.SellerId), ct);
        var items = sales.Select(s =>
        {
            var sold = s.SellerId == userId;
            var other = sold ? s.BuyerId : s.SellerId;
            return new AdminPlayerSaleRowDto(
                s.Id, sold ? "SOLD" : "BOUGHT", _marketService.DefDto(s.DefId), s.ItemId, s.Price, s.Fee,
                other, others.GetValueOrDefault(other)?.FullName ?? other, s.At);
        }).ToList();
        return new AdminPageDto<AdminPlayerSaleRowDto>(items, page, pageSize, total);
    }

    public async Task<AdminPageDto<AdminTradeRowDto>> TradesAsync(string userId, int page, int pageSize, CancellationToken ct = default)
    {
        await RequireUserAsync(userId, ct);
        (page, pageSize) = AdminPlayersRules.Paging(page, pageSize);
        var total = await _market.Trades.CountDocumentsAsync(t => t.FromUserId == userId || t.ToUserId == userId, cancellationToken: ct);
        var trades = await _market.Trades.Find(t => t.FromUserId == userId || t.ToUserId == userId)
            .SortByDescending(t => t.CreatedAt).Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        return new AdminPageDto<AdminTradeRowDto>(trades.Select(t => AdminPlayersLookups.ToTradeRow(t, _marketService)).ToList(), page, pageSize, total);
    }

    /// <summary>
    /// Everything admins did to this person: what names them as the target, and what names them inside (a removed listing,
    /// a cancelled order, a closed room, a hidden review). Ids are 24 hex characters, so matching one in the stored JSON is
    /// exact. It scans the log, which only grows by admin actions.
    /// </summary>
    public async Task<AdminPageDto<AdminAuditEntryDto>> AuditAsync(string userId, int page, int pageSize, CancellationToken ct = default)
    {
        await RequireUserAsync(userId, ct);
        (page, pageSize) = AdminPlayersRules.Paging(page, pageSize);
        var filter = Builders<AdminAuditEntry>.Filter;
        var mention = new BsonRegularExpression(Regex.Escape(userId));
        var related = filter.Eq(a => a.TargetId, userId) | filter.Regex(a => a.Before, mention) | filter.Regex(a => a.After, mention);
        var total = await _catalogStore.Audit.CountDocumentsAsync(related, cancellationToken: ct);
        var entries = await _catalogStore.Audit.Find(related)
            .SortByDescending(a => a.At).ThenByDescending(a => a.Id)
            .Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        return new AdminPageDto<AdminAuditEntryDto>(entries.Select(ToAuditDto).ToList(), page, pageSize, total);
    }

    private static AdminAuditEntryDto ToAuditDto(AdminAuditEntry entry) => new(
        entry.Id, entry.At, entry.AdminId, entry.AdminName, entry.Action, entry.TargetType, entry.TargetId,
        ParseJson(entry.Before), ParseJson(entry.After), entry.Reason);

    private static JsonElement? ParseJson(string? json)
    {
        if (json is null) return null;
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}
