using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Chợ đồ: wallet, inventory, listings, buy orders, trade offers and game rewards. Split over partial
/// files: this one (accounts, reads, rewards, idempotency), .Exchange (listings/orders/buying),
/// .Trades (trade offers) and .Recovery (replay of interrupted operations).
/// </summary>
public sealed partial class MarketService
{
    private static readonly JsonSerializerOptions ResultJson = new(JsonSerializerDefaults.Web);
    internal static readonly Regex RequestIdPattern = new("^[A-Za-z0-9_-]{8,64}$", RegexOptions.Compiled);

    private readonly MarketStore _store;
    private readonly ILogger<MarketService> _logger;
    private readonly ICatalogProvider _catalog;

    public MarketService(MarketStore store, ILogger<MarketService> logger, ICatalogProvider? catalog = null)
    {
        _store = store;
        _logger = logger;
        _catalog = catalog ?? FixedCatalogProvider.Default;
    }

    private DateTime Now => _store.Now;

    // ------------------------------------------------------------------ errors

    internal static ApiException Error(int status, string code, string message) =>
        new(status, message, new ApiErrorDetails(code, "market." + code));

    private static ApiException ErrorFor(string code) => code switch
    {
        MarketErrors.InsufficientFunds => Error(409, code, "You do not have enough coins."),
        MarketErrors.InventoryFull => Error(409, code, "Your inventory is full."),
        MarketErrors.ListingUnavailable => Error(409, code, "This listing is no longer available."),
        MarketErrors.OrderUnavailable => Error(409, code, "This buy order is no longer open."),
        MarketErrors.TradeClosed => Error(409, code, "This trade offer is no longer open."),
        MarketErrors.TradeItemUnavailable => Error(409, code, "An item in this offer is no longer available."),
        MarketErrors.TradeSenderFunds => Error(409, code, "The sender no longer has the offered coins."),
        MarketErrors.TradeSenderInventory => Error(409, code, "The sender's inventory is full."),
        MarketErrors.TradeRecipientFunds => Error(409, code, "You do not have the requested coins."),
        MarketErrors.TradeRecipientInventory => Error(409, code, "Your inventory is full."),
        MarketErrors.NoListingAtPrice => Error(409, code, "Nothing is for sale at this price any more."),
        MarketErrors.ItemNotTradable => Error(409, code, "This item was earned and cannot be sold or traded."),
        _ => Error(409, code, "The market changed; please try again.")
    };

    // ------------------------------------------------------------------ accounts

    /// <summary>Returns the caller's account, creating it with the one-time starter grant on first access.</summary>
    public async Task<MarketAccount> EnsureAccountAsync(string userId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userId)) throw ApiException.Unauthorized();
        var account = await _store.FindAccountAsync(userId, ct);
        if (account is null)
        {
            var now = Now;
            var fresh = new MarketAccount
            {
                Id = userId,
                Balance = MarketRules.StarterCoins,
                Slots = MarketCatalog.StarterItemIds.Count,
                Ops = new List<string> { "starter" },
                CreatedAt = now,
                UpdatedAt = now
            };
            try
            {
                await _store.Accounts.InsertOneAsync(fresh, cancellationToken: ct);
                account = fresh;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                account = await _store.FindAccountAsync(userId, ct)
                    ?? throw new InvalidOperationException($"Market account {userId} vanished after a duplicate insert.");
            }
        }
        if (!account.StarterItemsIssued) await IssueStarterItemsAsync(account, ct);
        return account;
    }

    /// <summary>Deterministic ids make issuing the starter items idempotent (a replay hits duplicate keys).</summary>
    public static string StarterItemId(string userId, int index)
    {
        var hash = MD5.HashData(Encoding.UTF8.GetBytes($"starter:{userId}:{index}"));
        return Convert.ToHexString(hash, 0, 12).ToLowerInvariant();
    }

    private async Task IssueStarterItemsAsync(MarketAccount account, CancellationToken ct)
    {
        var now = Now;
        var items = MarketCatalog.StarterItemIds.Select((defId, index) => new MarketItem
        {
            Id = StarterItemId(account.Id, index),
            OwnerId = account.Id,
            DefId = defId,
            Source = MarketItemSources.Starter,
            AcquiredAt = now
        }).ToList();
        try
        {
            await _store.Items.InsertManyAsync(items, new InsertManyOptions { IsOrdered = false }, ct);
        }
        catch (MongoBulkWriteException exception) when (exception.WriteErrors.All(error => error.Category == ServerErrorCategory.DuplicateKey))
        {
            // Already issued by a concurrent first access or an interrupted earlier attempt.
        }
        await _store.Accounts.UpdateOneAsync(a => a.Id == account.Id,
            Builders<MarketAccount>.Update.Set(a => a.StarterItemsIssued, true), cancellationToken: ct);
        account.StarterItemsIssued = true;
    }

    public async Task<WalletDto> GetWalletAsync(string userId, CancellationToken ct = default)
    {
        var account = await EnsureAccountAsync(userId, ct);
        return await WalletAsync(account, ct);
    }

    private async Task<WalletDto> WalletAsync(string userId, CancellationToken ct) =>
        await WalletAsync(await _store.FindAccountAsync(userId, ct) ?? await EnsureAccountAsync(userId, ct), ct);

    private async Task<WalletDto> WalletAsync(MarketAccount account, CancellationToken ct)
    {
        // Earned cosmetics take no slot, so they do not count as bag contents either.
        var itemCount = (int)await _store.Items.CountDocumentsAsync(
            i => i.OwnerId == account.Id && i.Source != MarketItemSources.Level && i.Source != MarketItemSources.Achievement,
            cancellationToken: ct);
        var reserved = (int)await _store.Orders.CountDocumentsAsync(
            o => o.BuyerId == account.Id && o.Held && !o.Released
                 && (o.Status == MarketOrderStatus.Active || o.Status == MarketOrderStatus.Pending
                     || o.Status == MarketOrderStatus.Opening || o.Status == MarketOrderStatus.Cancelled),
            cancellationToken: ct);
        return new WalletDto(account.Balance, account.Held, account.Slots, MarketRules.InventorySlots,
            itemCount, reserved, MarketRules.FeePercent);
    }

    // ------------------------------------------------------------------ catalog & browse

    public static ItemDefDto ToDefDto(MarketItemDef def) =>
        new(def.Id, def.Category, def.Rarity, def.Name, def.NameEn, def.Description, def.DescriptionEn, def.ReferencePrice, def.IconKey, def.Tradable, def.Visual);

    internal ItemDefDto DefDto(string defId) =>
        _catalog.Current.Find(defId) is { } def
            ? ToDefDto(def)
            : new ItemDefDto(defId, MarketCategories.Magnifier, MarketRarities.Common, defId, defId, string.Empty, string.Empty, 0);

    /// <summary>What can be had. A retired item is gone from here, but its name and icon still reach whoever owns one.</summary>
    public IReadOnlyList<ItemDefDto> GetCatalog() => _catalog.Current.All.Where(def => !def.Retired).Select(ToDefDto).ToList();

    /// <summary>A retired item leaves the market, except while someone still sells or bids for it: those offers must stay reachable.</summary>
    private async Task<List<MarketItemDef>> WithoutIdleRetiredAsync(List<MarketItemDef> defs, CancellationToken ct)
    {
        var retired = defs.Where(def => def.Retired).Select(def => def.Id).ToList();
        if (retired.Count == 0) return defs;
        var books = await LoadBooksAsync(retired, ct);
        return defs
            .Where(def => !def.Retired || (books.TryGetValue(def.Id, out var book) && (book.AskCount > 0 || book.BidCount > 0)))
            .ToList();
    }

    /// <summary>
    /// The ledger of item types, filtered and sorted, then cut to one page. A <paramref name="pageSize"/> of 0 returns
    /// every row; a page past the end returns the last one, so a list that shrank meanwhile still shows something.
    /// </summary>
    public async Task<MarketBrowseDto> BrowseAsync(
        string? query, string? category, IReadOnlyCollection<string>? rarities, string? sort,
        int page = 1, int pageSize = 0, CancellationToken ct = default)
    {
        var normalized = MarketRules.NormalizeSearch(query);
        var rarityFilter = (rarities ?? Array.Empty<string>()).Where(MarketRarities.IsValid).ToHashSet();
        var searched = _catalog.Current.All
            .Where(def => def.Tradable)
            .Where(def => MarketRules.MatchesSearch(def, normalized))
            .Where(def => rarityFilter.Count == 0 || rarityFilter.Contains(def.Rarity))
            .ToList();
        searched = await WithoutIdleRetiredAsync(searched, ct);
        var counts = MarketCategories.All.ToDictionary(cat => cat, cat => searched.Count(def => def.Category == cat));
        var defs = MarketCategories.IsValid(category) ? searched.Where(def => def.Category == category).ToList() : searched;

        var ids = defs.Select(def => def.Id).ToList();
        var books = await LoadBooksAsync(ids, ct);
        var histories = await LoadHistoriesAsync(ids, 30, ct);
        var rows = defs.Select(def =>
        {
            books.TryGetValue(def.Id, out var book);
            var history = histories[def.Id];
            return new MarketRowDto(
                ToDefDto(def),
                book?.AskCount ?? 0,
                book?.LowestAsk,
                book?.HighestBid,
                book?.BidCount ?? 0,
                history.Line.Skip(Math.Max(0, history.Line.Count - 10)).ToList(),
                history.ChangePercent,
                history.Volume);
        });

        rows = (sort ?? "popular") switch
        {
            "price_asc" => rows.OrderBy(row => row.LowestAsk is null).ThenBy(row => row.LowestAsk ?? row.Def.ReferencePrice),
            "price_desc" => rows.OrderBy(row => row.LowestAsk is null).ThenByDescending(row => row.LowestAsk ?? row.Def.ReferencePrice),
            "name" => rows.OrderBy(row => MarketRules.NormalizeSearch(row.Def.Name), StringComparer.Ordinal),
            "rarity" => rows.OrderByDescending(row => MarketRarities.Rank(row.Def.Rarity)).ThenBy(row => row.Def.Name, StringComparer.Ordinal),
            _ => rows.OrderByDescending(row => row.Volume30)
                .ThenByDescending(row => row.ListedCount)
                .ThenByDescending(row => row.BidCount)
                .ThenByDescending(row => MarketRarities.Rank(row.Def.Rarity))
        };
        var sorted = rows.ToList();
        if (pageSize <= 0) return new MarketBrowseDto(sorted, counts, searched.Count, sorted.Count, 1, sorted.Count);
        var lastPage = Math.Max(1, (sorted.Count + pageSize - 1) / pageSize);
        var current = Math.Clamp(page, 1, lastPage);
        var slice = sorted.Skip((current - 1) * pageSize).Take(pageSize).ToList();
        return new MarketBrowseDto(slice, counts, searched.Count, sorted.Count, current, pageSize);
    }

    private sealed record BookSummary(long? LowestAsk, int AskCount, long? HighestBid, int BidCount);

    private async Task<Dictionary<string, BookSummary>> LoadBooksAsync(IReadOnlyCollection<string> defIds, CancellationToken ct)
    {
        if (defIds.Count == 0) return new Dictionary<string, BookSummary>();
        var asks = await _store.Listings.Aggregate()
            .Match(l => l.Status == MarketListingStatus.Active && defIds.Contains(l.DefId))
            .Group(l => l.DefId, g => new { DefId = g.Key, Min = g.Min(l => l.Price), Count = g.Count() })
            .ToListAsync(ct);
        var bids = await _store.Orders.Aggregate()
            .Match(o => o.Status == MarketOrderStatus.Active && defIds.Contains(o.DefId))
            .Group(o => o.DefId, g => new { DefId = g.Key, Max = g.Max(o => o.Price), Count = g.Count() })
            .ToListAsync(ct);
        var result = new Dictionary<string, BookSummary>();
        foreach (var id in defIds)
        {
            var ask = asks.FirstOrDefault(a => a.DefId == id);
            var bid = bids.FirstOrDefault(b => b.DefId == id);
            result[id] = new BookSummary(ask?.Min, ask?.Count ?? 0, bid?.Max, bid?.Count ?? 0);
        }
        return result;
    }

    private async Task<Dictionary<string, PriceHistory>> LoadHistoriesAsync(IReadOnlyCollection<string> defIds, int days, CancellationToken ct)
    {
        var now = Now;
        var aggregates = new Dictionary<string, List<DailyAggregate>>();
        if (defIds.Count > 0)
        {
            var offset = MarketRules.DayOffset;
            var timezone = $"{(offset < TimeSpan.Zero ? "-" : "+")}{offset:hh\\:mm}";
            var pipeline = new[]
            {
                new BsonDocument("$match", new BsonDocument
                {
                    { "defId", new BsonDocument("$in", new BsonArray(defIds)) },
                    { "at", new BsonDocument("$gte", MarketRules.WindowStartUtc(now, days)) }
                }),
                new BsonDocument("$group", new BsonDocument
                {
                    { "_id", new BsonDocument
                        {
                            { "d", "$defId" },
                            { "day", new BsonDocument("$dateTrunc", new BsonDocument
                                { { "date", "$at" }, { "unit", "day" }, { "timezone", timezone } }) }
                        }
                    },
                    { "sum", new BsonDocument("$sum", "$price") },
                    { "count", new BsonDocument("$sum", 1) },
                    { "min", new BsonDocument("$min", "$price") },
                    { "max", new BsonDocument("$max", "$price") }
                })
            };
            var docs = await _store.Sales.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
            foreach (var doc in docs)
            {
                var key = doc["_id"].AsBsonDocument;
                var defId = key["d"].AsString;
                var day = MarketRules.MarketDay(key["day"].ToUniversalTime());
                if (!aggregates.TryGetValue(defId, out var list)) aggregates[defId] = list = new List<DailyAggregate>();
                list.Add(new DailyAggregate(day, doc["sum"].ToInt64(), doc["count"].ToInt32(), doc["min"].ToInt64(), doc["max"].ToInt64()));
            }
        }
        return defIds.ToDictionary(id => id, id => MarketRules.BuildHistory(
            aggregates.TryGetValue(id, out var list) ? list : new List<DailyAggregate>(), now, days));
    }

    private static PriceHistoryDto ToHistoryDto(PriceHistory history) => new(
        history.Days.Select(day => new DailyPriceDto(day.Day.ToString("yyyy-MM-dd"), day.Average, day.Low, day.High, day.Volume)).ToList(),
        history.Line, history.Low, history.High, history.ChangePercent, history.Volume);

    public async Task<MarketItemDetailDto> GetItemDetailAsync(string userId, string defId, CancellationToken ct = default)
    {
        var def = _catalog.Current.Find(defId) ?? throw Error(404, MarketErrors.UnknownItemType, "Unknown item type.");
        var book = (await LoadBooksAsync(new[] { def.Id }, ct))[def.Id];
        var history = (await LoadHistoriesAsync(new[] { def.Id }, 30, ct))[def.Id];
        var listings = await _store.Listings
            .Find(l => l.DefId == def.Id && l.Status == MarketListingStatus.Active)
            .SortBy(l => l.Price).ThenBy(l => l.CreatedAt).Limit(10).ToListAsync(ct);
        var bidLevels = await _store.Orders.Aggregate()
            .Match(o => o.DefId == def.Id && o.Status == MarketOrderStatus.Active)
            .Group(o => o.Price, g => new { Price = g.Key, Count = g.Count() })
            .SortByDescending(level => level.Price)
            .Limit(8)
            .ToListAsync(ct);
        var mine = await _store.Listings
            .Find(l => l.SellerId == userId && l.DefId == def.Id
                       && (l.Status == MarketListingStatus.Active || l.Status == MarketListingStatus.Pending))
            .SortBy(l => l.Price).ToListAsync(ct);
        var myOrders = await _store.Orders
            .Find(o => o.BuyerId == userId && o.DefId == def.Id
                       && (o.Status == MarketOrderStatus.Active || o.Status == MarketOrderStatus.Pending))
            .SortByDescending(o => o.Price).ToListAsync(ct);
        var owned = (int)await _store.Items.CountDocumentsAsync(i => i.OwnerId == userId && i.DefId == def.Id, cancellationToken: ct);

        return new MarketItemDetailDto(
            ToDefDto(def),
            book.AskCount, book.LowestAsk, book.BidCount, book.HighestBid,
            listings.Select(l => new ListingRowDto(l.Id, l.Price, l.SellerName, l.SellerId == userId, l.CreatedAt)).ToList(),
            bidLevels.Select(level => new BidLevelDto(level.Price, level.Count)).ToList(),
            ToHistoryDto(history),
            mine.Select(ToListingDto).ToList(),
            myOrders.Select(ToOrderDto).ToList(),
            owned);
    }

    internal ListingDto ToListingDto(MarketListing listing) => new(
        listing.Id, listing.ItemId, DefDto(listing.DefId), listing.Price,
        MarketRules.Fee(listing.Price), MarketRules.SellerProceeds(listing.Price),
        listing.Status, listing.SoldPrice, listing.CreatedAt, listing.ClosedAt);

    internal OrderDto ToOrderDto(MarketBuyOrder order) => new(
        order.Id, DefDto(order.DefId), order.Price, order.Status, order.FilledPrice, order.CreatedAt, order.ClosedAt);

    internal SaleDto ToSaleDto(MarketSale sale, string viewerId)
    {
        var sold = sale.SellerId == viewerId;
        return new SaleDto(sale.Id, DefDto(sale.DefId), sale.ItemId, sale.Price, sale.Fee,
            sold ? "SOLD" : "BOUGHT", sold ? sale.Price - sale.Fee : -sale.Price, sale.At);
    }

    // ------------------------------------------------------------------ inventory & equipment

    public async Task<InventoryDto> GetInventoryAsync(string userId, CancellationToken ct = default)
    {
        var account = await EnsureAccountAsync(userId, ct);
        var items = await LoadInventoryItemsAsync(userId, account.Equipped, ct);
        // Earned cosmetics live in the profile, not in the 12-slot bag; they can still be what is equipped.
        var bag = items.Where(item => !MarketItemSources.IsEarned(item.Source)).ToList();
        return new InventoryDto(bag, await WalletAsync(account, ct), ValidEquipped(account.Equipped, items));
    }

    /// <summary>Another detective's items, so a trade offer can ask for specific pieces.</summary>
    public async Task<PublicInventoryDto> GetPublicInventoryAsync(string ownerId, CancellationToken ct = default)
    {
        var owner = await FindActiveUserAsync(ownerId, ct)
            ?? throw Error(404, MarketErrors.UserNotFound, "No detective with this id was found.");
        var account = await _store.FindAccountAsync(ownerId, ct);
        var items = await LoadInventoryItemsAsync(ownerId, account?.Equipped ?? new Dictionary<string, string>(), ct);
        return new PublicInventoryDto(new TradePartyDto(owner.Id, owner.FullName), items.Where(item => item.Def.Tradable).ToList());
    }

    private async Task<List<InventoryItemDto>> LoadInventoryItemsAsync(
        string userId, IReadOnlyDictionary<string, string> equipped, CancellationToken ct)
    {
        var items = await _store.Items.Find(i => i.OwnerId == userId).SortByDescending(i => i.AcquiredAt).ThenBy(i => i.Id).ToListAsync(ct);
        var listingIds = items.Select(i => i.LockedBy).Where(key => key?.StartsWith(ListingLockPrefix, StringComparison.Ordinal) == true)
            .Select(key => key![ListingLockPrefix.Length..]).ToList();
        var listings = listingIds.Count == 0
            ? new Dictionary<string, MarketListing>()
            : (await _store.Listings.Find(l => listingIds.Contains(l.Id)).ToListAsync(ct)).ToDictionary(l => l.Id);
        var equippedIds = equipped.Values.ToHashSet(StringComparer.Ordinal);
        return items.Select(item =>
        {
            string? reason = null;
            string? listingId = null;
            long? listingPrice = null;
            if (item.LockedBy?.StartsWith(ListingLockPrefix, StringComparison.Ordinal) == true)
            {
                reason = "LISTED";
                listingId = item.LockedBy[ListingLockPrefix.Length..];
                if (listings.TryGetValue(listingId, out var listing)) listingPrice = listing.Price;
            }
            else if (item.LockedBy?.StartsWith(ChestLockPrefix, StringComparison.Ordinal) == true)
            {
                reason = "OPENING";
            }
            else if (item.LockedBy?.StartsWith(XpLockPrefix, StringComparison.Ordinal) == true)
            {
                reason = "EXCHANGING";
            }
            else if (item.LockedBy is not null)
            {
                reason = "TRADE";
            }
            return new InventoryItemDto(item.Id, DefDto(item.DefId), item.LockedBy is not null, reason, listingId, listingPrice,
                item.LockedBy is null && equippedIds.Contains(item.Id), item.Source, item.AcquiredAt);
        })
        .OrderByDescending(item => MarketRarities.Rank(item.Def.Rarity))
        .ThenBy(item => MarketCategories.All.ToList().IndexOf(item.Def.Category))
        .ThenByDescending(item => item.AcquiredAt)
        .ToList();
    }

    private static Dictionary<string, string> ValidEquipped(IReadOnlyDictionary<string, string> equipped, IReadOnlyList<InventoryItemDto> items)
    {
        var usable = items.Where(item => !item.Locked).ToDictionary(item => item.ItemId);
        return equipped
            .Where(pair => usable.TryGetValue(pair.Value, out var item) && item.Def.Category == pair.Key)
            .ToDictionary(pair => pair.Key, pair => pair.Value);
    }

    public async Task<InventoryDto> EquipAsync(string userId, string itemId, CancellationToken ct = default)
    {
        await EnsureAccountAsync(userId, ct);
        var item = await _store.Items.Find(i => i.Id == itemId && i.OwnerId == userId).FirstOrDefaultAsync(ct)
            ?? throw Error(404, MarketErrors.ItemNotFound, "This item is not in your inventory.");
        if (item.LockedBy is not null)
            throw Error(409, MarketErrors.ItemLocked, "Items for sale or in a trade cannot be equipped.");
        var def = _catalog.Current.Find(item.DefId) ?? throw Error(409, MarketErrors.UnknownItemType, "Unknown item type.");
        if (!MarketCategories.IsEquippable(def.Category))
            throw Error(409, MarketErrors.NotEquippable, "Chests, keys and collectibles cannot be put in use.");
        await _store.Accounts.UpdateOneAsync(a => a.Id == userId,
            Builders<MarketAccount>.Update.Set($"equipped.{def.Category}", item.Id).Set(a => a.UpdatedAt, Now),
            cancellationToken: ct);
        return await GetInventoryAsync(userId, ct);
    }

    public async Task<InventoryDto> UnequipAsync(string userId, string category, CancellationToken ct = default)
    {
        if (!MarketCategories.IsValid(category))
            throw Error(400, MarketErrors.UnknownItemType, "Unknown item category.");
        await EnsureAccountAsync(userId, ct);
        await _store.Accounts.UpdateOneAsync(a => a.Id == userId,
            Builders<MarketAccount>.Update.Unset($"equipped.{category}").Set(a => a.UpdatedAt, Now),
            cancellationToken: ct);
        return await GetInventoryAsync(userId, ct);
    }

    /// <summary>Equipped cosmetics of any detective (for showing them in rooms/games later).</summary>
    public async Task<IReadOnlyList<EquippedItemDto>> GetEquippedAsync(string userId, CancellationToken ct = default)
    {
        var account = await _store.FindAccountAsync(userId, ct);
        if (account is null || account.Equipped.Count == 0) return Array.Empty<EquippedItemDto>();
        var ids = account.Equipped.Values.ToList();
        var items = (await _store.Items.Find(i => ids.Contains(i.Id) && i.OwnerId == userId && i.LockedBy == null).ToListAsync(ct))
            .ToDictionary(i => i.Id);
        return MarketCategories.All
            .Where(category => account.Equipped.TryGetValue(category, out var id) && items.TryGetValue(id, out var item)
                               && _catalog.Current.Find(item.DefId)?.Category == category)
            .Select(category =>
            {
                var item = items[account.Equipped[category]];
                return new EquippedItemDto(category, item.Id, DefDto(item.DefId));
            })
            .ToList();
    }

    // ------------------------------------------------------------------ my market activity

    public async Task<MyMarketDto> GetMineAsync(string userId, CancellationToken ct = default)
    {
        await EnsureAccountAsync(userId, ct);
        var listings = await _store.Listings
            .Find(l => l.SellerId == userId && (l.Status == MarketListingStatus.Active || l.Status == MarketListingStatus.Pending))
            .SortByDescending(l => l.CreatedAt).Limit(50).ToListAsync(ct);
        var orders = await _store.Orders
            .Find(o => o.BuyerId == userId && (o.Status == MarketOrderStatus.Active || o.Status == MarketOrderStatus.Pending))
            .SortByDescending(o => o.CreatedAt).Limit(50).ToListAsync(ct);
        var history = await _store.Sales
            .Find(s => s.SellerId == userId || s.BuyerId == userId)
            .SortByDescending(s => s.At).Limit(20).ToListAsync(ct);
        return new MyMarketDto(
            listings.Select(ToListingDto).ToList(),
            orders.Select(ToOrderDto).ToList(),
            history.Select(sale => ToSaleDto(sale, userId)).ToList());
    }

    // ------------------------------------------------------------------ users

    public async Task<IReadOnlyList<UserSearchDto>> SearchUsersAsync(string callerId, string? query, CancellationToken ct = default)
    {
        var text = (query ?? string.Empty).Trim();
        if (text.Length < 2 || text.Length > 40) return Array.Empty<UserSearchDto>();
        var filter = Builders<User>.Filter.Regex(u => u.FullName, new BsonRegularExpression(Regex.Escape(text), "i"))
                     & Builders<User>.Filter.Eq(u => u.Status, UserStatus.Active)
                     & Builders<User>.Filter.Ne(u => u.Id, callerId);
        var users = await _store.Context.Users.Find(filter)
            .Project(u => new { u.Id, u.FullName })
            .SortBy(u => u.FullName).Limit(8).ToListAsync(ct);
        return users.Select(u => new UserSearchDto(u.Id, u.FullName)).ToList();
    }

    /// <summary>
    /// Anything that moves coins or items between detectives needs a verified e-mail, so throwaway
    /// accounts cannot farm the starter grant and funnel it to a main account.
    /// </summary>
    internal async Task RequireVerifiedAsync(string userId, CancellationToken ct)
    {
        var verified = ObjectId.TryParse(userId, out _) && await _store.Context.Users.CountDocumentsAsync(
            u => u.Id == userId && u.IsEmailVerified && u.Status == UserStatus.Active, cancellationToken: ct) > 0;
        if (!verified)
            throw Error(403, MarketErrors.EmailNotVerified, "Verify your e-mail before trading on the market.");
    }

    private async Task<User?> FindActiveUserAsync(string userId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(userId, out _)) return null;
        return await _store.Context.Users.Find(u => u.Id == userId && u.Status == UserStatus.Active).FirstOrDefaultAsync(ct);
    }

    // ------------------------------------------------------------------ game rewards

    public static string RewardId(string roomId, string userId) => $"{roomId}:{userId}";

    /// <summary>
    /// Credits every player of a completed game once (win 120 xu, loss 30 xu). Idempotent by room + user:
    /// the reward document is created once and applied with a wallet operation key.
    /// </summary>
    public async Task GrantGameRewardsAsync(GameResult result, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(result.RoomId)) return;
        foreach (var userId in result.Players.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal))
        {
            var id = RewardId(result.RoomId, userId);
            try
            {
                await _store.Rewards.UpdateOneAsync(
                    r => r.Id == id,
                    Builders<MarketReward>.Update
                        .SetOnInsert(r => r.UserId, userId)
                        .SetOnInsert(r => r.RoomId, result.RoomId)
                        .SetOnInsert(r => r.Amount, MarketRules.RewardFor(result.Success))
                        .SetOnInsert(r => r.Won, result.Success)
                        .SetOnInsert(r => r.Applied, false)
                        .SetOnInsert(r => r.CreatedAt, Now),
                    new UpdateOptions { IsUpsert = true },
                    ct);
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                // A concurrent materialization created the same reward.
            }
            var reward = await _store.Rewards.Find(r => r.Id == id).FirstOrDefaultAsync(ct);
            if (reward is { Applied: false }) await ApplyRewardAsync(reward, ct);
        }
    }

    private async Task ApplyRewardAsync(MarketReward reward, CancellationToken ct)
    {
        await EnsureAccountAsync(reward.UserId, ct);
        var write = await _store.ApplyWalletAsync(reward.UserId, $"reward:{reward.Id}", reward.Amount, ct: ct);
        if (write == WalletWrite.Rejected)
        {
            _logger.LogError("Market reward {RewardId} could not be applied.", reward.Id);
            return;
        }
        await _store.Rewards.UpdateOneAsync(r => r.Id == reward.Id,
            Builders<MarketReward>.Update.Set(r => r.Applied, true), cancellationToken: ct);
    }

    public async Task<RewardDto?> GetRewardAsync(string userId, string roomId, CancellationToken ct = default)
    {
        var reward = await _store.Rewards.Find(r => r.Id == RewardId(roomId, userId)).FirstOrDefaultAsync(ct);
        return reward is null ? null : new RewardDto(reward.RoomId, reward.Amount, reward.Won, reward.Applied);
    }

    // ------------------------------------------------------------------ admin

    /// <summary>The wallet of an existing detective, for operator tools that must not create accounts for unknown ids.</summary>
    internal async Task<WalletDto> GetWalletForGrantAsync(string userId, CancellationToken ct)
    {
        if (await FindActiveUserAsync(userId, ct) is null)
            throw Error(404, MarketErrors.UserNotFound, "No detective with this id was found.");
        return await GetWalletAsync(userId, ct);
    }

    /// <summary>Operator tool (events, support, manual testing): grants coins and/or one item.</summary>
    public async Task<WalletDto> AdminGrantAsync(string userId, string? defId, long coins, CancellationToken ct = default)
    {
        if (await FindActiveUserAsync(userId, ct) is null)
            throw Error(404, MarketErrors.UserNotFound, "No detective with this id was found.");
        if (coins < 0 || coins > 100_000) throw Error(400, MarketErrors.InvalidPrice, "Coins must be between 0 and 100,000.");
        var def = string.IsNullOrWhiteSpace(defId) ? null
            : _catalog.Current.Find(defId) ?? throw Error(400, MarketErrors.UnknownItemType, "Unknown item type.");
        await EnsureAccountAsync(userId, ct);
        if (def is not null)
        {
            var itemId = MarketStore.NewId();
            if (await _store.ApplyWalletAsync(userId, $"grant:{itemId}", 0, slotDelta: 1, ct: ct) == WalletWrite.Rejected)
                throw ErrorFor(MarketErrors.InventoryFull);
            await _store.Items.InsertOneAsync(new MarketItem
            {
                Id = itemId, OwnerId = userId, DefId = def.Id, Source = MarketItemSources.Grant, AcquiredAt = Now
            }, cancellationToken: ct);
        }
        if (coins > 0) await _store.ApplyWalletAsync(userId, $"grant:{MarketStore.NewId()}", coins, ct: ct);
        return await WalletAsync(userId, ct);
    }

    // ------------------------------------------------------------------ idempotency

    /// <summary>
    /// Runs <paramref name="action"/> once per (user, requestId). A retried request (double click, network
    /// retry) gets the stored result instead of buying or listing twice.
    /// </summary>
    public async Task<T> IdempotentAsync<T>(string userId, string? requestId, Func<Task<T>> action, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(requestId)) return await action();
        if (!RequestIdPattern.IsMatch(requestId))
            throw Error(400, MarketErrors.InvalidRequestId, "requestId must be 8-64 letters, digits, '-' or '_'.");
        var id = $"{userId}:{requestId}";
        try
        {
            await _store.Requests.InsertOneAsync(new MarketRequest { Id = id, CreatedAt = Now }, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            var existing = await _store.Requests.Find(r => r.Id == id).FirstOrDefaultAsync(ct);
            if (existing is { State: "DONE", ResultJson: not null })
                return JsonSerializer.Deserialize<T>(existing.ResultJson, ResultJson)!;
            var takeover = existing is not null && existing.CreatedAt < Now.AddMinutes(-2)
                && (await _store.Requests.ReplaceOneAsync(r => r.Id == id && r.State == "RUNNING" && r.CreatedAt == existing.CreatedAt,
                    new MarketRequest { Id = id, CreatedAt = Now }, cancellationToken: ct)).ModifiedCount == 1;
            if (!takeover) throw Error(409, MarketErrors.RequestInProgress, "This request is already being processed.");
        }

        T result;
        try
        {
            result = await action();
        }
        catch
        {
            await _store.Requests.DeleteOneAsync(r => r.Id == id, CancellationToken.None);
            throw;
        }
        await _store.Requests.UpdateOneAsync(r => r.Id == id,
            Builders<MarketRequest>.Update.Set(r => r.State, "DONE").Set(r => r.ResultJson, JsonSerializer.Serialize(result, ResultJson)),
            cancellationToken: CancellationToken.None);
        return result;
    }
}
