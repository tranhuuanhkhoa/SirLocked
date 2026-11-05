using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>Curios and old gear (/admin/items): list, create, edit, retire, delete. Cosmetics, chests and keys only appear here.</summary>
public sealed class AdminChestsItemService
{
    private const int MaxIdAttempts = 5;

    private readonly CatalogStore _catalog;
    private readonly MarketStore _market;
    private readonly AdminChestsStore _store;
    private readonly ICatalogProvider _provider;
    private readonly IAdminAudit _audit;

    public AdminChestsItemService(CatalogStore catalog, MarketStore market, AdminChestsStore store, ICatalogProvider provider, IAdminAudit audit)
    {
        _catalog = catalog;
        _market = market;
        _store = store;
        _provider = provider;
        _audit = audit;
    }

    // ------------------------------------------------------------------ reads

    public async Task<AdminItemListDto> ListAsync(CancellationToken ct = default)
    {
        var items = await AdminChestsStore.ReadAllAsync(_catalog.Items, ct);
        var chests = await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct);
        var rewards = await AdminChestsStore.ReadAllAsync(_catalog.LevelRewards, ct);
        var achievements = await AdminChestsStore.ReadAllAsync(_catalog.Achievements, ct);
        var copies = await CountCopiesAsync(ct);
        var dropped = await CountDroppedAsync(ct);
        var orders = await CountOpenOrdersAsync(ct);

        var snapshot = _provider.Current;
        var rows = items
            .OrderBy(item => item.SortOrder).ThenBy(item => item.Id, StringComparer.Ordinal)
            .Select(item =>
            {
                var owned = copies.GetValueOrDefault(item.Id);
                var references = CatalogRules.ReferencesTo(item.Id, chests, rewards, achievements);
                var deletable = AdminChestsRules.IsEditableHere(item.Category)
                    && owned == 0 && references.Count == 0
                    && dropped.GetValueOrDefault(item.Id) == 0 && orders.GetValueOrDefault(item.Id) == 0;
                return ToDto(item, snapshot, owned, chests, deletable);
            })
            .ToList();
        var nextId = AdminChestsRules.NextCurioId(await TakenIdsAsync(items, ct));
        return new AdminItemListDto(rows, nextId, snapshot.Problems);
    }

    /// <summary>Ids a new item must not take: those in use, and those an old chest version lists, which restoring it would bring back.</summary>
    private async Task<List<string>> TakenIdsAsync(IEnumerable<CatalogItem> items, CancellationToken ct)
    {
        var listed = await _store.Versions.Distinct<string>("snapshot.pool", FilterDefinition<ChestVersion>.Empty).ToListAsync(ct);
        return items.Select(item => item.Id).Concat(listed).ToList();
    }

    private async Task<Dictionary<string, long>> CountCopiesAsync(CancellationToken ct)
    {
        var groups = await _market.Items.Aggregate()
            .Group(item => item.DefId, group => new { DefId = group.Key, Count = group.Count() })
            .ToListAsync(ct);
        return groups.ToDictionary(group => group.DefId, group => (long)group.Count, StringComparer.Ordinal);
    }

    private async Task<Dictionary<string, long>> CountDroppedAsync(CancellationToken ct)
    {
        var groups = await _market.ChestOpenings.Aggregate()
            .Group(opening => opening.RewardDefId, group => new { DefId = group.Key, Count = group.Count() })
            .ToListAsync(ct);
        return groups.ToDictionary(group => group.DefId, group => (long)group.Count, StringComparer.Ordinal);
    }

    private async Task<Dictionary<string, long>> CountOpenOrdersAsync(CancellationToken ct)
    {
        var groups = await _market.Orders.Aggregate()
            .Match(order => order.Status == MarketOrderStatus.Active || order.Status == MarketOrderStatus.Opening || order.Status == MarketOrderStatus.Pending)
            .Group(order => order.DefId, group => new { DefId = group.Key, Count = group.Count() })
            .ToListAsync(ct);
        return groups.ToDictionary(group => group.DefId, group => (long)group.Count, StringComparer.Ordinal);
    }

    private static AdminItemDto ToDto(CatalogItem item, CatalogSnapshot snapshot, long circulating, IEnumerable<CatalogChest> chests, bool deletable)
    {
        // The provider writes a cosmetic's description from the pools, so what players read comes from there.
        var def = snapshot.Find(item.Id);
        var visual = item.Visual ?? new CatalogVisual();
        return new AdminItemDto(
            item.Id, item.Category, item.Rarity, item.Name, item.NameEn, item.Description, item.DescriptionEn,
            def?.Description ?? item.Description, def?.DescriptionEn ?? item.DescriptionEn,
            item.ReferencePrice, item.Tradable, item.Retired, item.SortOrder, item.Version, visual.IconKey,
            new ItemVisual(visual.IconKey, visual.ImageUrl, visual.BuiltinId, visual.Template,
                visual.Params is null ? new Dictionary<string, object?>() : visual.Params.ToDictionary()!),
            circulating,
            chests.Where(chest => chest.Pool?.Contains(item.Id, StringComparer.Ordinal) == true)
                .Select(chest => new AdminItemChestDto(chest.Id, chest.Name))
                .ToList(),
            AdminChestsRules.IsEditableHere(item.Category),
            deletable);
    }

    private async Task<AdminItemDto> RowAsync(CatalogItem item, CancellationToken ct)
    {
        var copies = await _market.Items.CountDocumentsAsync(i => i.DefId == item.Id, cancellationToken: ct);
        var chests = await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct);
        return ToDto(item, _provider.Current, copies, chests, deletable: false);
    }

    // ------------------------------------------------------------------ create

    public async Task<AdminItemDto> CreateAsync(CurrentUser admin, AdminItemCreateRequest request, CancellationToken ct = default)
    {
        var now = _market.Now;
        var existing = await AdminChestsStore.ReadAllAsync(_catalog.Items, ct);
        var item = new CatalogItem
        {
            Category = MarketCategories.Curio,
            SortOrder = existing.Count == 0 ? 0 : existing.Max(other => other.SortOrder) + 1,
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedBy = admin.Id,
            Version = 1,
            Visual = new CatalogVisual { Params = new BsonDocument() },
        };
        Fill(item, request);
        var violations = AdminChestsRules.ValidateItem(item);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);

        var taken = await TakenIdsAsync(existing, ct);
        for (var attempt = 1; ; attempt++)
        {
            item.Id = AdminChestsRules.NextCurioId(taken);
            try
            {
                await _catalog.Items.InsertOneAsync(item, cancellationToken: ct);
                break;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey && attempt < MaxIdAttempts)
            {
                // Another admin took this number between the read and the write.
                taken.Add(item.Id);
            }
        }
        _provider.Invalidate();
        await _audit.LogAsync(admin, "item.create", "catalogItem", item.Id, null, item, null, CancellationToken.None);
        return await RowAsync(item, ct);
    }

    private static void Fill(CatalogItem item, AdminItemCreateRequest request)
    {
        item.Name = request.Name?.Trim() ?? string.Empty;
        item.NameEn = request.NameEn?.Trim() ?? string.Empty;
        item.Description = request.Description?.Trim() ?? string.Empty;
        item.DescriptionEn = request.DescriptionEn?.Trim() ?? string.Empty;
        item.Rarity = request.Rarity ?? string.Empty;
        item.ReferencePrice = request.ReferencePrice;
        item.Tradable = request.Tradable;
        item.Visual.IconKey = string.IsNullOrWhiteSpace(request.IconKey) ? null : request.IconKey.Trim();
        item.Visual.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();
    }

    // ------------------------------------------------------------------ edit

    public async Task<AdminItemDto> UpdateAsync(CurrentUser admin, string id, AdminItemUpdateRequest request, CancellationToken ct = default)
    {
        var (before, items, chests) = await LoadEditableAsync(id, ct);
        var after = AdminChestsCopies.Copy(before);
        Fill(after, request);

        var violations = AdminChestsRules.ValidateItem(after);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);

        if (await _market.Items.CountDocumentsAsync(i => i.DefId == id, cancellationToken: ct) > 0)
        {
            if (before.Rarity != after.Rarity) AdminChestsErrors.RequireReason(request.Reason, "đổi độ hiếm khi đã có người sở hữu");
            // Those copies can then be neither sold nor traded, and each keeps its slot in the bag.
            if (before.Tradable && !after.Tradable) AdminChestsErrors.RequireReason(request.Reason, "ngừng cho bán khi đã có người sở hữu");
        }

        RefuseIfAChestBreaks(after, items, chests);
        await SaveAsync(admin, before, after, request.ExpectedVersion, ct);
        await _audit.LogAsync(admin, "item.update", "catalogItem", id, before, after, request.Reason, CancellationToken.None);
        return await RowAsync(after, ct);
    }

    public async Task<AdminItemDto> SetRetiredAsync(CurrentUser admin, string id, bool retired, string? reason, CancellationToken ct = default)
    {
        var (before, items, chests) = await LoadEditableAsync(id, ct);
        if (retired) AdminChestsErrors.RequireReason(reason, "ngừng phát hành");
        if (before.Retired == retired) return await RowAsync(before, ct);

        var after = AdminChestsCopies.Copy(before);
        after.Retired = retired;
        RefuseIfAChestBreaks(after, items, chests);
        await SaveAsync(admin, before, after, before.Version, ct);
        await _audit.LogAsync(admin, retired ? "item.retire" : "item.unretire", "catalogItem", id, before, after, reason, CancellationToken.None);
        return await RowAsync(after, ct);
    }

    public async Task DeleteAsync(CurrentUser admin, string id, string? reason, CancellationToken ct = default)
    {
        var (before, _, chests) = await LoadEditableAsync(id, ct);
        AdminChestsErrors.RequireReason(reason, "xóa");

        var owned = await _market.Items.CountDocumentsAsync(i => i.DefId == id, cancellationToken: ct);
        var rewards = await AdminChestsStore.ReadAllAsync(_catalog.LevelRewards, ct);
        var achievements = await AdminChestsStore.ReadAllAsync(_catalog.Achievements, ct);
        var references = CatalogRules.ReferencesTo(id, chests, rewards, achievements).ToList();
        // The log and any unfinished opening still name it, and a buy order is waiting for it.
        var dropped = await _market.ChestOpenings.CountDocumentsAsync(o => o.RewardDefId == id, cancellationToken: ct);
        if (dropped > 0) references.Add($"{dropped} lượt mở hòm đã ra món này");
        var orders = await _market.Orders.CountDocumentsAsync(
            o => o.DefId == id && (o.Status == MarketOrderStatus.Active || o.Status == MarketOrderStatus.Opening || o.Status == MarketOrderStatus.Pending),
            cancellationToken: ct);
        if (orders > 0) references.Add($"{orders} lệnh mua đang mở");

        if (CatalogRules.ValidateDelete(id, owned, references) is { } violation)
            throw AdminChestsErrors.Refused(new[] { violation });

        var deleted = await _catalog.Items.DeleteOneAsync(i => i.Id == id && i.Version == before.Version, ct);
        if (deleted.DeletedCount == 0) throw AdminChestsErrors.Conflict();
        _provider.Invalidate();
        await _audit.LogAsync(admin, "item.delete", "catalogItem", id, before, null, reason, CancellationToken.None);
    }

    private async Task<(CatalogItem Item, Dictionary<string, CatalogItem> Items, List<CatalogChest> Chests)> LoadEditableAsync(string id, CancellationToken ct)
    {
        var all = await AdminChestsStore.ReadAllAsync(_catalog.Items, ct);
        var items = all.ToDictionary(item => item.Id, StringComparer.Ordinal);
        if (!items.TryGetValue(id, out var item))
            throw AdminChestsErrors.Error(404, AdminChestsErrors.ItemNotFound, $"Không có vật phẩm {id}.");
        if (!AdminChestsRules.IsEditableHere(item.Category))
            throw AdminChestsErrors.Error(409, AdminChestsErrors.ManagedElsewhere, $"{item.Name} được quản lý ở trang riêng, không sửa ở đây.");
        return (item, items, await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct));
    }

    /// <summary>An item's rarity, price and retirement all feed the tables of the chests that list it.</summary>
    private static void RefuseIfAChestBreaks(CatalogItem after, Dictionary<string, CatalogItem> items, IEnumerable<CatalogChest> chests)
    {
        var changed = new Dictionary<string, CatalogItem>(items, StringComparer.Ordinal) { [after.Id] = after };
        var violations = chests
            .Where(chest => chest.Pool?.Contains(after.Id, StringComparer.Ordinal) == true)
            .SelectMany(chest => CatalogRules.ValidateChest(chest, changed)
                .Select(violation => new CatalogRuleViolation(violation.Code, $"{chest.Name}: {violation.Message}")))
            .ToList();
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);
    }

    private async Task SaveAsync(CurrentUser admin, CatalogItem before, CatalogItem after, int expectedVersion, CancellationToken ct)
    {
        if (expectedVersion != before.Version) throw AdminChestsErrors.Conflict();
        after.Version = before.Version + 1;
        after.UpdatedAt = _market.Now;
        after.UpdatedBy = admin.Id;
        var replaced = await _catalog.Items.ReplaceOneAsync(i => i.Id == before.Id && i.Version == before.Version, after, cancellationToken: ct);
        if (replaced.ModifiedCount == 0) throw AdminChestsErrors.Conflict();
        _provider.Invalidate();
    }
}

/// <summary>Independent copies of stored documents, for "before" and "after" in one operation.</summary>
internal static class AdminChestsCopies
{
    public static CatalogItem Copy(CatalogItem item) => new()
    {
        Id = item.Id,
        Category = item.Category,
        Rarity = item.Rarity,
        Name = item.Name,
        NameEn = item.NameEn,
        Description = item.Description,
        DescriptionEn = item.DescriptionEn,
        ReferencePrice = item.ReferencePrice,
        Tradable = item.Tradable,
        Retired = item.Retired,
        SortOrder = item.SortOrder,
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
        UpdatedBy = item.UpdatedBy,
        Version = item.Version,
        Visual = new CatalogVisual
        {
            IconKey = item.Visual?.IconKey,
            ImageUrl = item.Visual?.ImageUrl,
            BuiltinId = item.Visual?.BuiltinId,
            Template = item.Visual?.Template,
            Params = item.Visual?.Params?.DeepClone().AsBsonDocument ?? new BsonDocument(),
        },
    };
}
