using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>
/// Chests (/admin/chests): prices, drawing, drop table and pool, saved as a whole with a version behind each save.
/// A chest's own item type and its key's follow it, so the market and inventories show the same names and icons.
/// </summary>
public sealed class AdminChestsChestService
{
    private const int MaxIdAttempts = 5;
    /// <summary>What "Xem thử" pretends to own, enough to keep opening without ever seeing "buy".</summary>
    private const int PreviewStock = 99;

    private readonly CatalogStore _catalog;
    private readonly MarketStore _market;
    private readonly AdminChestsStore _store;
    private readonly ICatalogProvider _provider;
    private readonly IAdminAudit _audit;
    private readonly IChestRandom _random;

    public AdminChestsChestService(
        CatalogStore catalog, MarketStore market, AdminChestsStore store, ICatalogProvider provider, IAdminAudit audit, IChestRandom random)
    {
        _catalog = catalog;
        _market = market;
        _store = store;
        _provider = provider;
        _audit = audit;
        _random = random;
    }

    // ------------------------------------------------------------------ reads

    public async Task<AdminChestListDto> ListAsync(CancellationToken ct = default)
    {
        var chests = await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct);
        var items = await ItemsAsync(ct);
        var since = _market.Now.AddDays(-7);
        var opens = await _market.ChestOpenings.Aggregate()
            .Match(opening => opening.State == ChestOpeningStates.Done && opening.CreatedAt >= since)
            .Group(opening => opening.ChestDefId, group => new { ChestId = group.Key, Count = group.Count() })
            .ToListAsync(ct);
        var opensById = opens.ToDictionary(open => open.ChestId, open => (long)open.Count, StringComparer.Ordinal);

        var rows = chests
            .OrderBy(chest => chest.SortOrder).ThenBy(chest => chest.Id, StringComparer.Ordinal)
            .Select(chest => new AdminChestRowDto(
                chest.Id, chest.KeyDefId, chest.Name, chest.NameEn, chest.Subtitle, chest.KeyName, chest.IconKey, chest.KeyIconKey,
                LookOf(chest), chest.Prices.Chest, chest.Prices.Key, chest.Active, chest.SortOrder, chest.Version,
                opensById.GetValueOrDefault(chest.Id), CatalogRules.ExpectedValue(chest, items),
                chest.Prices.Chest + chest.Prices.Key, chest.Pool.Count))
            .ToList();
        return new AdminChestListDto(rows, _provider.Current.Problems);
    }

    public async Task<AdminChestDetailDto> GetAsync(string id, CancellationToken ct = default) =>
        ToDetail(await RequireAsync(id, ct), await ItemsAsync(ct));

    public async Task<AdminChestCheckDto> CheckAsync(string id, AdminChestDraftRequest draft, CancellationToken ct = default)
    {
        var before = await RequireAsync(id, ct);
        var after = Apply(before, draft);
        var items = await ItemsAsync(ct);
        return new AdminChestCheckDto(
            ViolationsOf(before, after, items),
            CatalogRules.ExpectedValue(after, items),
            after.Prices.Chest + after.Prices.Key,
            after.DropWeights.Values.Sum(weight => (long)weight),
            AdminChestsRules.ItemRates(after, items),
            AdminChestsRules.Diff(before, after));
    }

    public async Task<IReadOnlyList<AdminChestVersionDto>> VersionsAsync(string id, CancellationToken ct = default)
    {
        var current = await RequireAsync(id, ct);
        var stored = await _store.Versions.Find(v => v.ChestId == id).SortByDescending(v => v.Version).ToListAsync(ct);
        // A chest nobody has saved yet still has one version: the one it was seeded with.
        if (stored.Count == 0) stored.Add(BaseVersion(current));

        return stored.Select((version, index) =>
        {
            var previous = index + 1 < stored.Count ? stored[index + 1].Snapshot : version.Snapshot;
            return new AdminChestVersionDto(
                version.Version, version.Action, version.At, version.AdminName, version.Reason, version.Version == current.Version,
                version.Snapshot.Prices.Chest, version.Snapshot.Prices.Key, version.Snapshot.DropWeights, version.Snapshot.Pool.Count,
                AdminChestsRules.Diff(previous, version.Snapshot));
        }).ToList();
    }

    // ------------------------------------------------------------------ writes

    public async Task<AdminChestDetailDto> UpdateAsync(CurrentUser admin, string id, AdminChestDraftRequest draft, CancellationToken ct = default)
    {
        var before = await RequireAsync(id, ct);
        var after = Apply(before, draft);
        var items = await ItemsAsync(ct);

        var violations = ViolationsOf(before, after, items);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);
        if (AdminChestsRules.Diff(before, after).IsEmpty)
            throw AdminChestsErrors.Error(400, AdminChestsErrors.NoChange, "Chưa có gì thay đổi để lưu.");
        AdminChestsErrors.RequireReason(draft.Reason, "thay đổi hòm");

        await SaveAsync(admin, before, after, draft.ExpectedVersion, "update", draft.Reason, items, ct);
        await _audit.LogAsync(admin, "chest.update", "chest", id, before, after, draft.Reason, CancellationToken.None);
        return ToDetail(after, await ItemsAsync(ct));
    }

    public async Task<AdminChestDetailDto> RestoreAsync(CurrentUser admin, string id, int version, AdminChestRestoreRequest request, CancellationToken ct = default)
    {
        var before = await RequireAsync(id, ct);
        var stored = await _store.Versions.Find(v => v.Id == ChestVersion.IdOf(id, version)).FirstOrDefaultAsync(ct)
            ?? throw AdminChestsErrors.Error(404, AdminChestsErrors.VersionNotFound, $"Hòm này không có phiên bản {version}.");

        var after = AdminChestsRules.Clone(stored.Snapshot);
        // On/off and the display order are today's decisions, not part of what a version describes.
        after.Active = before.Active;
        after.SortOrder = before.SortOrder;

        var items = await ItemsAsync(ct);
        // Measured against the version itself: an item retired since then may come back listed, it just cannot drop.
        var violations = AdminChestsRules.Validate(stored.Snapshot, after, items);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);
        if (AdminChestsRules.Diff(before, after).IsEmpty)
            throw AdminChestsErrors.Error(400, AdminChestsErrors.NoChange, "Hòm đang giống hệt phiên bản này.");
        AdminChestsErrors.RequireReason(request.Reason, "khôi phục phiên bản");

        await SaveAsync(admin, before, after, request.ExpectedVersion, "restore", request.Reason, items, ct);
        await _audit.LogAsync(admin, "chest.restore", "chest", id, before, after, request.Reason, CancellationToken.None);
        return ToDetail(after, await ItemsAsync(ct));
    }

    public async Task<AdminChestDetailDto> CloneAsync(CurrentUser admin, string sourceId, AdminChestCloneRequest request, CancellationToken ct = default)
    {
        var source = await RequireAsync(sourceId, ct);
        var items = await ItemsAsync(ct);
        var chests = await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct);
        var now = _market.Now;

        var chest = AdminChestsRules.Clone(source);
        chest.Name = string.IsNullOrWhiteSpace(request.Name) ? $"{source.Name} (bản sao)" : request.Name.Trim();
        chest.NameEn = string.IsNullOrWhiteSpace(request.NameEn) ? $"{source.NameEn} (copy)" : request.NameEn.Trim();
        chest.Active = false;
        chest.SortOrder = chests.Max(other => other.SortOrder) + 1;
        chest.Version = 1;
        chest.UpdatedBy = admin.Id;
        chest.CreatedAt = now;
        chest.UpdatedAt = now;

        var violations = AdminChestsRules.Validate(source, chest, items);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);

        var taken = items.Keys.Concat(chests.Select(other => other.Id)).Concat(chests.Select(other => other.KeyDefId)).ToList();
        var sortOrder = items.Values.Max(item => item.SortOrder) + 1;
        CatalogItem chestDef, keyDef;
        for (var attempt = 1; ; attempt++)
        {
            (chest.Id, chest.KeyDefId) = AdminChestsRules.NextChestIds(taken);
            chestDef = NewDef(admin, chest.Id, MarketCategories.Chest, chest.Name, chest.NameEn,
                $"Hòm vật chứng. Cần {chest.KeyName} để mở.", $"An evidence chest. Opens with a {chest.KeyNameEn}.",
                chest.Prices.Chest, chest.IconKey, sortOrder, now);
            keyDef = NewDef(admin, chest.KeyDefId, MarketCategories.Key, Capitalized(chest.KeyName), Capitalized(chest.KeyNameEn),
                $"Chỉ mở được {chest.Name}.", $"Opens only the {chest.NameEn}.",
                chest.Prices.Key, chest.KeyIconKey, sortOrder + 1, now);
            try
            {
                await _catalog.Items.InsertManyAsync(new[] { chestDef, keyDef }, cancellationToken: ct);
                await _catalog.Chests.InsertOneAsync(chest, cancellationToken: CancellationToken.None);
                break;
            }
            catch (Exception exception)
            {
                // A chest or key type with no chest behind it could never be removed, so whatever this attempt wrote goes.
                // Only what it wrote: on a duplicate, the other document belongs to the admin who got there first.
                var (chestDefId, keyDefId) = (chestDef.Id, keyDef.Id);
                await _catalog.Items.DeleteManyAsync(
                    i => (i.Id == chestDefId || i.Id == keyDefId) && i.UpdatedBy == admin.Id && i.CreatedAt == now, CancellationToken.None);
                if (!IsDuplicate(exception) || attempt >= MaxIdAttempts) throw;
                taken.Add(chest.Id);
                taken.Add(chest.KeyDefId);
            }
        }

        _provider.Invalidate();
        await _store.Versions.InsertOneAsync(VersionOf(chest, "clone", admin, request.Reason), cancellationToken: CancellationToken.None);
        await _audit.LogAsync(admin, "chest.clone", "chest", chest.Id, new { sourceId }, new { chest, chestDef, keyDef }, request.Reason, CancellationToken.None);
        return ToDetail(chest, await ItemsAsync(ct));
    }

    private static bool IsDuplicate(Exception exception) => exception switch
    {
        MongoWriteException write => write.WriteError?.Category == ServerErrorCategory.DuplicateKey,
        MongoBulkWriteException bulk => bulk.WriteErrors.Any(error => error.Category == ServerErrorCategory.DuplicateKey),
        _ => false,
    };

    /// <summary>An item's description names its chest and key: a rename reaches it. A name that was blank has nothing to replace.</summary>
    private static string Renamed(string? text, string? oldName, string newName) =>
        string.IsNullOrEmpty(text) || string.IsNullOrEmpty(oldName) ? text ?? string.Empty : text.Replace(oldName, newName, StringComparison.Ordinal);

    private static string Capitalized(string text) =>
        string.IsNullOrEmpty(text) ? text : char.ToUpper(text[0], System.Globalization.CultureInfo.InvariantCulture) + text[1..];

    /// <summary>Off, a chest and its key behave like retired items on the market: gone unless someone is still trading them.</summary>
    private static CatalogItem NewDef(
        CurrentUser admin, string id, string category, string name, string nameEn, string description, string descriptionEn,
        long price, string iconKey, int sortOrder, DateTime now) => new()
    {
        Id = id,
        Category = category,
        Rarity = MarketRarities.Common,
        Name = name,
        NameEn = nameEn,
        Description = description,
        DescriptionEn = descriptionEn,
        ReferencePrice = price,
        Tradable = true,
        Retired = true,
        SortOrder = sortOrder,
        CreatedAt = now,
        UpdatedAt = now,
        UpdatedBy = admin.Id,
        Version = 1,
        Visual = new CatalogVisual { IconKey = iconKey, Params = new BsonDocument() },
    };

    /// <summary>Compare-and-set on the version, so two admins cannot silently overwrite each other. Then the history, then the item types.</summary>
    private async Task SaveAsync(
        CurrentUser admin, CatalogChest before, CatalogChest after, int expectedVersion, string action, string? reason,
        IReadOnlyDictionary<string, CatalogItem> items, CancellationToken ct)
    {
        if (expectedVersion != before.Version) throw AdminChestsErrors.Conflict();
        after.Version = before.Version + 1;
        after.UpdatedAt = _market.Now;
        after.UpdatedBy = admin.Id;

        await EnsureBaseVersionAsync(before, ct);
        var replaced = await _catalog.Chests.ReplaceOneAsync(c => c.Id == before.Id && c.Version == before.Version, after, cancellationToken: ct);
        if (replaced.ModifiedCount == 0) throw AdminChestsErrors.Conflict();

        // The chest has changed. From here an admin closing the tab must not leave its history and item types behind.
        try
        {
            await _store.Versions.ReplaceOneAsync(v => v.Id == ChestVersion.IdOf(after.Id, after.Version),
                VersionOf(after, action, admin, reason), new ReplaceOptions { IsUpsert = true }, CancellationToken.None);
            await FollowAsync(admin, before, after, items, CancellationToken.None);
        }
        finally
        {
            _provider.Invalidate();
        }
    }

    /// <summary>
    /// The rules a save must pass. Only switching a chest off is exempt: it is what a chest that has gone wrong needs
    /// first, and it adds nothing a player could buy.
    /// </summary>
    private static IReadOnlyList<CatalogRuleViolation> ViolationsOf(CatalogChest before, CatalogChest after, IReadOnlyDictionary<string, CatalogItem> items)
    {
        var diff = AdminChestsRules.Diff(before, after);
        var onlySwitchedOff = before.Active && !after.Active && diff.Added.Count == 0 && diff.Removed.Count == 0
            && diff.Weights.Count == 0 && !diff.Reordered && diff.Fields.Count == 1;
        return onlySwitchedOff ? Array.Empty<CatalogRuleViolation>() : AdminChestsRules.Validate(before, after, items);
    }

    /// <summary>The state before the first save was never recorded (it came from the seed), and it must stay restorable.</summary>
    private async Task EnsureBaseVersionAsync(CatalogChest chest, CancellationToken ct)
    {
        try
        {
            await _store.Versions.InsertOneAsync(BaseVersion(chest), cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Already recorded by the save that made it.
        }
    }

    private static ChestVersion BaseVersion(CatalogChest chest) => new()
    {
        Id = ChestVersion.IdOf(chest.Id, chest.Version),
        ChestId = chest.Id,
        Version = chest.Version,
        Action = "base",
        At = chest.UpdatedAt,
        AdminId = chest.UpdatedBy,
        Snapshot = chest,
    };

    private ChestVersion VersionOf(CatalogChest chest, string action, CurrentUser admin, string? reason) => new()
    {
        Id = ChestVersion.IdOf(chest.Id, chest.Version),
        ChestId = chest.Id,
        Version = chest.Version,
        Action = action,
        At = _market.Now,
        AdminId = admin.Id,
        AdminName = admin.FullName,
        Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
        Snapshot = chest,
    };

    private async Task FollowAsync(CurrentUser admin, CatalogChest before, CatalogChest after, IReadOnlyDictionary<string, CatalogItem> items, CancellationToken ct)
    {
        async Task Sync(string defId, string name, string nameEn, long price, string iconKey)
        {
            if (!items.TryGetValue(defId, out var def)) return;
            var description = Renamed(Renamed(def.Description, before.Name, after.Name), before.KeyName, after.KeyName);
            var descriptionEn = Renamed(Renamed(def.DescriptionEn, before.NameEn, after.NameEn), before.KeyNameEn, after.KeyNameEn);
            if (def.Name == name && def.NameEn == nameEn && def.ReferencePrice == price && def.Visual?.IconKey == iconKey
                && def.Retired == !after.Active && def.Description == description && def.DescriptionEn == descriptionEn) return;

            await _catalog.Items.UpdateOneAsync(i => i.Id == defId, Builders<CatalogItem>.Update
                .Set(i => i.Name, name)
                .Set(i => i.NameEn, nameEn)
                .Set(i => i.Description, description)
                .Set(i => i.DescriptionEn, descriptionEn)
                .Set(i => i.ReferencePrice, price)
                .Set(i => i.Visual.IconKey, iconKey)
                .Set(i => i.Retired, !after.Active)
                .Set(i => i.UpdatedAt, after.UpdatedAt)
                .Set(i => i.UpdatedBy, admin.Id)
                .Inc(i => i.Version, 1), cancellationToken: ct);
        }

        // Defs were written with a capital and chests with a lower-case key name. Keep what each one used unless it was renamed.
        var keyName = after.KeyName == before.KeyName && items.TryGetValue(after.KeyDefId, out var key) ? key.Name : Capitalized(after.KeyName);
        var keyNameEn = after.KeyNameEn == before.KeyNameEn && items.TryGetValue(after.KeyDefId, out var keyEn) ? keyEn.NameEn : Capitalized(after.KeyNameEn);
        await Sync(after.Id, after.Name, after.NameEn, after.Prices.Chest, after.IconKey);
        await Sync(after.KeyDefId, keyName, keyNameEn, after.Prices.Key, after.KeyIconKey);
    }

    // ------------------------------------------------------------------ trying a chest out

    /// <summary>The shape /kho-ruong reads, for one chest of any state. Pretends the admin owns plenty; nothing is stored.</summary>
    public Task<ChestListDto> PreviewAsync(string id)
    {
        var chest = RequireLive(id);
        var dto = ChestService.ToDto(chest, PreviewStock, PreviewStock);
        return Task.FromResult(new ChestListDto(new[] { dto }, dto.Odds!, Array.Empty<ChestDto>(), PreviewWallet()));
    }

    /// <summary>A result rolled by the real table. It creates no item, spends nothing and leaves no journal.</summary>
    public Task<ChestOpenResultDto> PreviewOpenAsync(string id)
    {
        var chest = RequireLive(id);
        if (chest.Items.Count == 0)
            throw AdminChestsErrors.Error(409, AdminChestsErrors.NothingToRoll, "Hòm này chưa có món nào đang phát hành.");
        var item = MarketService.ToDefDto(chest.Roll(_random));
        return Task.FromResult(new ChestOpenResultDto(chest.Id, "preview", item, PreviewStock, PreviewStock, PreviewWallet()));
    }

    private ChestDef RequireLive(string id) =>
        _provider.Current.FindChest(id)
        ?? throw AdminChestsErrors.Error(404, AdminChestsErrors.ChestNotFound, $"Không có hòm {id}.");

    private static WalletDto PreviewWallet() =>
        new(0, 0, 0, MarketRules.InventorySlots, 0, 0, MarketRules.FeePercent);

    // ------------------------------------------------------------------ helpers

    private async Task<CatalogChest> RequireAsync(string id, CancellationToken ct) =>
        (await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct)).FirstOrDefault(chest => chest.Id == id)
        ?? throw AdminChestsErrors.Error(404, AdminChestsErrors.ChestNotFound, $"Không có hòm {id}.");

    private async Task<Dictionary<string, CatalogItem>> ItemsAsync(CancellationToken ct) =>
        (await AdminChestsStore.ReadAllAsync(_catalog.Items, ct)).ToDictionary(item => item.Id, StringComparer.Ordinal);

    private static CatalogChest Apply(CatalogChest before, AdminChestDraftRequest draft)
    {
        var after = AdminChestsRules.Clone(before);
        after.Name = draft.Name?.Trim() ?? string.Empty;
        after.NameEn = draft.NameEn?.Trim() ?? string.Empty;
        after.Subtitle = draft.Subtitle?.Trim() ?? string.Empty;
        after.SubtitleEn = draft.SubtitleEn?.Trim() ?? string.Empty;
        after.KeyName = draft.KeyName?.Trim() ?? string.Empty;
        after.KeyNameEn = draft.KeyNameEn?.Trim() ?? string.Empty;
        after.Prices = new CatalogChestPrices { Chest = draft.ChestPrice, Key = draft.KeyPrice };
        after.Active = draft.Active;
        after.SortOrder = draft.SortOrder;
        after.DropWeights = new Dictionary<string, int>(draft.DropWeights ?? new Dictionary<string, int>(), StringComparer.Ordinal);
        after.Pool = new List<string>(draft.Pool ?? new List<string>());
        if (draft.Look is { } look)
        {
            after.Look = new CatalogChestLook
            {
                Template = look.Template ?? string.Empty,
                Light = look.Light ?? string.Empty,
                Hi = look.Hi ?? string.Empty,
                Core = look.Core ?? string.Empty,
            };
        }
        // The inventory and the market draw a chest and its key from these, so they follow the drawing.
        if (after.Look.Template != before.Look.Template && AdminChestsRules.IsKnownDrawing(after.Look.Template))
            (after.IconKey, after.KeyIconKey) = AdminChestsRules.IconsOf(after.Look.Template);
        return after;
    }

    private static ChestLookDto LookOf(CatalogChest chest) =>
        new(chest.Look.Template, chest.Look.Light, chest.Look.Hi, chest.Look.Core);

    private AdminChestDetailDto ToDetail(CatalogChest chest, IReadOnlyDictionary<string, CatalogItem> items)
    {
        var snapshot = _provider.Current;
        var rates = AdminChestsRules.ItemRates(chest, items);
        var pool = chest.Pool
            .Select(id => snapshot.Find(id))
            .Where(def => def is not null)
            .Select(def => new AdminPoolItemDto(MarketService.ToDefDto(def!), def!.Retired, rates.GetValueOrDefault(def.Id)))
            .ToList();
        var problems = snapshot.Problems.Where(problem => problem.Contains(chest.Id, StringComparison.Ordinal)).ToList();
        return new AdminChestDetailDto(
            chest.Id, chest.KeyDefId, chest.Name, chest.NameEn, chest.Subtitle, chest.SubtitleEn, chest.KeyName, chest.KeyNameEn,
            chest.IconKey, chest.KeyIconKey, LookOf(chest), chest.Prices.Chest, chest.Prices.Key, chest.Active, chest.SortOrder, chest.Version,
            chest.DropWeights, pool, CatalogRules.ExpectedValue(chest, items), chest.Prices.Chest + chest.Prices.Key, problems);
    }
}
