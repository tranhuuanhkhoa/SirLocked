using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>
/// Frames, titles and lobby entrances for the /admin/cosmetics page. Every write checks on the server, saves, tells
/// the catalog, then records itself. docs/admin-cosmetics.md has the whole picture.
/// </summary>
public sealed class AdminCosmeticsService
{
    /// <summary>What follows a write that has landed runs to its end even if the admin's connection is gone by then.</summary>
    private static readonly CancellationToken Finish = CancellationToken.None;

    private const int PlayerSearchLimit = 20;
    private const int MaxIdAttempts = 50;
    private static readonly string[] CosmeticCategories = { MarketCategories.Frame, MarketCategories.Title, MarketCategories.Entrance };

    private readonly CatalogStore _catalogStore;
    private readonly MarketStore _market;
    private readonly MarketService _marketService;
    private readonly ICatalogProvider _catalog;
    private readonly ICosmeticDefaults _defaults;
    private readonly IAdminAudit _audit;

    public AdminCosmeticsService(
        CatalogStore catalogStore, MarketStore market, MarketService marketService, ICatalogProvider catalog, ICosmeticDefaults defaults, IAdminAudit audit)
    {
        _catalogStore = catalogStore;
        _market = market;
        _marketService = marketService;
        _catalog = catalog;
        _defaults = defaults;
        _audit = audit;
    }

    private DateTime Now => _market.Now;

    private static ApiException Refuse(int status, string code, string message) => MarketService.Error(status, code, message);

    private static ApiException Refuse(int status, CatalogRuleViolation violation) => Refuse(status, violation.Code, violation.Message);

    private static string RequireReason(string? reason) =>
        AdminCosmeticRules.CleanReason(reason)
        ?? throw Refuse(400, AdminCosmeticCodes.ReasonRequired, "Hãy nhập lý do cho thao tác này.");

    // ------------------------------------------------------------------ reads

    public async Task<AdminCosmeticsPageDto> ListAsync(CancellationToken ct = default)
    {
        var problems = new List<string>(_catalog.Current.Problems);
        var items = await ReadAsync(_catalogStore.Items, new BsonDocument("category", new BsonDocument("$in", new BsonArray(CosmeticCategories))), problems, ct);
        var context = await ContextAsync(problems, ct);
        var owners = await OwnersAsync(items.Select(item => item.Id).ToList(), ct);
        var catalog = _catalog.Current;
        return new AdminCosmeticsPageDto(
            items.OrderBy(item => item.SortOrder).ThenBy(item => item.Id, StringComparer.Ordinal)
                .Select(item => ToDto(item, owners.GetValueOrDefault(item.Id), context))
                .ToList(),
            AchievementMetrics.All,
            catalog.RareXp,
            catalog.EpicXp,
            ProgressRules.MaxLevel,
            ToDto(context.Defaults),
            problems);
    }

    public async Task<AdminCosmeticDto> GetAsync(string id, CancellationToken ct = default)
    {
        var item = await LoadAsync(id, ct);
        var owners = await OwnersAsync(new[] { item.Id }, ct);
        return ToDto(item, owners.GetValueOrDefault(item.Id), await ContextAsync(new List<string>(), ct));
    }

    /// <summary>What players' pages need to draw and explain every cosmetic. Read from memory: a lobby asks for it.</summary>
    public async Task<CosmeticCatalogDto> PublicCatalogAsync(CancellationToken ct = default)
    {
        var catalog = _catalog.Current;
        var defaults = await _defaults.GetAsync(ct);
        var levels = catalog.LevelRewards
            .GroupBy(reward => reward.DefId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Min(reward => reward.Level), StringComparer.Ordinal);
        var achievements = catalog.Achievements.ToDictionary(achievement => achievement.TitleDefId, StringComparer.Ordinal);
        var entries = catalog.All
            .Where(def => CosmeticCatalog.IsCosmetic(def.Category))
            .Select((def, index) =>
            {
                var achievement = achievements.GetValueOrDefault(def.Id);
                return new CosmeticCatalogEntryDto(
                    def.Id, def.Category, def.Rarity, def.Name, def.NameEn, def.Description, def.DescriptionEn,
                    def.Tradable, def.Retired, index, def.Visual,
                    levels.TryGetValue(def.Id, out var level) ? level : null,
                    achievement?.Metric,
                    achievement?.Target,
                    achievement?.Countable == true,
                    catalog.ActiveChests.Where(chest => chest.Items.Any(item => item.Id == def.Id)).Select(chest => chest.Name).ToList(),
                    catalog.ActiveChests.Count);
            })
            .ToList();
        return new CosmeticCatalogDto(entries, ToDto(defaults), catalog.RareXp, catalog.EpicXp);
    }

    public async Task<IReadOnlyList<AdminCosmeticPlayerDto>> SearchPlayersAsync(string? query, CancellationToken ct = default)
    {
        var text = query?.Trim();
        if (string.IsNullOrEmpty(text)) return Array.Empty<AdminCosmeticPlayerDto>();
        if (text.Length > 60) text = text[..60];
        var filters = Builders<Models.User>.Filter;
        var pattern = new BsonRegularExpression(Regex.Escape(text), "i");
        var users = await _market.Context.Users
            .Find(filters.Or(filters.Regex(u => u.FullName, pattern), filters.Regex(u => u.Email, pattern)))
            .Limit(PlayerSearchLimit)
            .ToListAsync(ct);
        var ids = users.Select(user => user.Id).ToList();
        var levels = await _market.PlayerProgress.Find(p => ids.Contains(p.Id)).ToListAsync(ct);
        return users
            .Select(user => new AdminCosmeticPlayerDto(user.Id, user.FullName, user.Email, levels.FirstOrDefault(p => p.Id == user.Id)?.Level ?? 1))
            .ToList();
    }

    // ------------------------------------------------------------------ create and edit

    public async Task<AdminCosmeticDto> CreateAsync(CurrentUser admin, AdminCosmeticCreateRequest request, CancellationToken ct = default)
    {
        var category = request.Category ?? string.Empty;
        if (!CosmeticCatalog.IsCosmetic(category))
            throw Refuse(400, AdminCosmeticCodes.NotCosmetic, "Chỉ tạo được viền, danh hiệu hoặc hiệu ứng vào sảnh.");
        var fields = CheckFields(request.Name, request.NameEn, request.Description, request.DescriptionEn, request.Rarity, request.ReferencePrice, DefaultPriceOf);

        var slug = AdminCosmeticRules.SlugOf(fields.Name);
        var prefix = AdminCosmeticRules.PrefixOf(category);
        // The id only decides where the item lives, so the check needs a stand-in that is the right shape.
        var check = AdminCosmeticRules.ValidateVisual(category, prefix + slug, request.Visual?.ImageUrl, request.Visual?.Template, request.Visual?.Params);
        if (check.Violations.Count > 0) throw Refuse(400, check.Violations[0]);

        var last = await _catalogStore.Items.Find(FilterDefinition<CatalogItem>.Empty).SortByDescending(i => i.SortOrder).Limit(1).FirstOrDefaultAsync(ct);
        var now = Now;
        var item = new CatalogItem
        {
            Category = category,
            Rarity = fields.Rarity,
            Name = fields.Name,
            NameEn = fields.NameEn,
            Description = fields.Description,
            DescriptionEn = fields.DescriptionEn,
            ReferencePrice = fields.ReferencePrice,
            Tradable = request.Tradable,
            Retired = false,
            SortOrder = (last?.SortOrder ?? 0) + 1,
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedBy = admin.Id,
            Version = 1,
            Visual = check.Visual!,
        };

        for (var attempt = 1; ; attempt++)
        {
            item.Id = prefix + (attempt == 1 ? slug : $"{slug}-{attempt}");
            item.Visual.IconKey = item.Id;
            try
            {
                await _catalogStore.Items.InsertOneAsync(item, cancellationToken: ct);
                break;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey && attempt < MaxIdAttempts)
            {
                // Two items with one name are fine: the next number is free.
            }
        }

        _catalog.Invalidate();
        await _audit.LogAsync(admin, "item.create", "catalogItem", item.Id, null, item, AdminCosmeticRules.CleanReason(request.Reason), Finish);
        return await GetAsync(item.Id, ct);
    }

    public async Task<AdminCosmeticDto> UpdateAsync(CurrentUser admin, string id, AdminCosmeticUpdateRequest request, CancellationToken ct = default)
    {
        var before = await LoadAsync(id, ct);
        if (request.ExpectedVersion is { } expected && expected != before.Version) throw StaleEdit();
        var fields = CheckFields(request.Name, request.NameEn, request.Description, request.DescriptionEn, request.Rarity, request.ReferencePrice, _ => before.ReferencePrice);
        // It changes what every player holding a copy can do with it.
        if (request.Tradable != before.Tradable) RequireReason(request.Reason);

        var visual = before.Visual ?? new CatalogVisual();
        if (string.IsNullOrEmpty(visual.BuiltinId))
        {
            if (request.Visual is null) throw Refuse(400, AdminCosmeticCodes.TemplateUnknown, "Thiếu cấu hình hình ảnh.");
            var check = AdminCosmeticRules.ValidateVisual(before.Category, before.Id, request.Visual.ImageUrl, request.Visual.Template, request.Visual.Params);
            if (check.Violations.Count > 0) throw Refuse(400, check.Violations[0]);
            visual = check.Visual!;
        }

        var context = await ContextAsync(new List<string>(), ct);
        var mode = ModeOf(before, context);
        if (request.Tradable && (AdminCosmeticRules.IsEarnedMode(mode) || CosmeticDefaults.IsDefaultInCode(before.Category, before.Id)))
            throw Refuse(409, AdminCosmeticCodes.EarnedNotTradable, "Món nhận theo cấp, thành tích hoặc mặc định không được bán hay giao dịch.");
        if (request.Tradable && !before.Tradable) await EnsureCanStartTradingAsync(before.Id, ct);
        if (!request.Tradable && before.Tradable) await EnsureCanStopTradingAsync(before.Id, ct);

        var after = BsonSerializer.Deserialize<CatalogItem>(before.ToBsonDocument());
        after.Rarity = fields.Rarity;
        after.ReferencePrice = fields.ReferencePrice;
        await EnsureChestsStayValidAsync(before, after, ct);

        var result = await _catalogStore.Items.UpdateOneAsync(
            i => i.Id == before.Id && i.Version == before.Version,
            Builders<CatalogItem>.Update
                .Set(i => i.Name, fields.Name)
                .Set(i => i.NameEn, fields.NameEn)
                .Set(i => i.Description, fields.Description)
                .Set(i => i.DescriptionEn, fields.DescriptionEn)
                .Set(i => i.Rarity, fields.Rarity)
                .Set(i => i.ReferencePrice, fields.ReferencePrice)
                .Set(i => i.Tradable, request.Tradable)
                .Set(i => i.Visual, visual)
                .Set(i => i.UpdatedAt, Now)
                .Set(i => i.UpdatedBy, admin.Id)
                .Inc(i => i.Version, 1),
            cancellationToken: ct);
        if (result.ModifiedCount == 0) throw StaleEdit();

        _catalog.Invalidate();
        var saved = await LoadAsync(before.Id, ct);
        await _audit.LogAsync(admin, "item.update", "catalogItem", before.Id, before, saved, AdminCosmeticRules.CleanReason(request.Reason), Finish);
        return await GetAsync(before.Id, ct);
    }

    private static ApiException StaleEdit() =>
        Refuse(409, AdminCosmeticCodes.VersionConflict, "Món này vừa được sửa ở nơi khác. Hãy tải lại trang rồi sửa tiếp.");

    private sealed record CheckedFields(string Name, string NameEn, string Description, string DescriptionEn, string Rarity, long ReferencePrice);

    private static CheckedFields CheckFields(
        string? name, string? nameEn, string? description, string? descriptionEn, string? rarity, long? referencePrice, Func<string, long> fallbackPrice)
    {
        if (AdminCosmeticRules.ValidateName(name) is { } badName) throw Refuse(400, badName);
        if (!string.IsNullOrWhiteSpace(nameEn) && AdminCosmeticRules.ValidateName(nameEn) is { } badEnglish) throw Refuse(400, badEnglish);
        if (rarity is null || !MarketRarities.IsValid(rarity)) throw Refuse(400, AdminCosmeticCodes.RarityInvalid, "Độ hiếm không hợp lệ.");
        var cleanDescription = (description ?? string.Empty).Trim();
        var cleanEnglish = (descriptionEn ?? string.Empty).Trim();
        if (cleanDescription.Length > AdminCosmeticRules.MaxDescriptionLength || cleanEnglish.Length > AdminCosmeticRules.MaxDescriptionLength)
            throw Refuse(400, AdminCosmeticCodes.NameInvalid, $"Mô tả dài tối đa {AdminCosmeticRules.MaxDescriptionLength} ký tự.");
        var price = referencePrice ?? fallbackPrice(rarity);
        if (CatalogRules.ValidatePrice("Giá tham chiếu", price) is { } badPrice) throw Refuse(400, badPrice);
        var cleanName = name!.Trim();
        return new CheckedFields(cleanName, string.IsNullOrWhiteSpace(nameEn) ? cleanName : nameEn.Trim(), cleanDescription, cleanEnglish, rarity, price);
    }

    /// <summary>Same scale as the shipped cosmetics, so a new one does not push a chest over its price.</summary>
    private static long DefaultPriceOf(string rarity) => rarity switch
    {
        MarketRarities.Rare => 340,
        MarketRarities.Epic => 1100,
        MarketRarities.Legendary => 3600,
        MarketRarities.Mystery => 12000,
        _ => 100,
    };

    // ------------------------------------------------------------------ how it is obtained

    public async Task<AdminCosmeticDto> SetAcquisitionAsync(CurrentUser admin, string id, AdminCosmeticAcquisitionRequest request, CancellationToken ct = default)
    {
        var reason = RequireReason(request.Reason);
        var item = await LoadAsync(id, ct);
        var mode = request.Mode ?? string.Empty;
        if (mode is not (AdminCosmeticRules.ModeLevel or AdminCosmeticRules.ModeAchievement or AdminCosmeticRules.ModeDefault or AdminCosmeticRules.ModeAdmin))
            throw Refuse(400, AdminCosmeticCodes.ModeInvalid, "Cách nhận không hợp lệ.");
        if (mode == AdminCosmeticRules.ModeLevel && AdminCosmeticRules.ValidateLevel(request.Level) is { } badLevel) throw Refuse(400, badLevel);
        if (mode == AdminCosmeticRules.ModeAchievement && AdminCosmeticRules.ValidateAchievement(request.Metric, request.Target) is { } badAchievement)
            throw Refuse(400, badAchievement);
        if (item.Retired && AdminCosmeticRules.IsEarnedMode(mode))
            throw Refuse(409, AdminCosmeticCodes.RetiredCannotBeEarned, "Món đã ngừng phát hành. Hãy bỏ retired trước khi đặt cách nhận.");

        var context = await ContextAsync(new List<string>(), ct);
        var before = AcquisitionOf(item, context);
        var wasDefault = context.Defaults.For(item.Category) == item.Id;
        if (wasDefault && mode != AdminCosmeticRules.ModeDefault && CosmeticDefaults.IsDefaultInCode(item.Category, item.Id))
            throw Refuse(409, AdminCosmeticCodes.DefaultRequired, "Nhóm này luôn cần một món mặc định. Hãy đặt món khác làm mặc định trước.");
        if (AdminCosmeticRules.IsEarnedMode(mode) && item.Tradable) await EnsureCanStopTradingAsync(item.Id, ct);

        // These writes cannot be one transaction on a standalone MongoDB, so their order is what keeps the game safe:
        // a reward may reach players only once its item can no longer be sold or burned for XP, or a copy could be
        // turned into XP, granted again, and turned into XP again. Each step can run again, so a failure half way
        // is put right by saving once more, and once writing has begun a dropped connection does not stop it.
        try
        {
            if (AdminCosmeticRules.IsEarnedMode(mode) && item.Tradable)
            {
                await _catalogStore.Items.UpdateOneAsync(
                    i => i.Id == item.Id,
                    Builders<CatalogItem>.Update.Set(i => i.Tradable, false).Set(i => i.UpdatedAt, Now).Set(i => i.UpdatedBy, admin.Id).Inc(i => i.Version, 1),
                    cancellationToken: Finish);
                // Readers must see this before anything below can hand the item out.
                _catalog.Invalidate();
            }

            var keepReward = mode == AdminCosmeticRules.ModeLevel ? CatalogLevelReward.IdOf(request.Level!.Value, item.Id) : null;
            await _catalogStore.LevelRewards.DeleteManyAsync(r => r.DefId == item.Id && r.Id != keepReward, Finish);
            if (keepReward is not null)
            {
                await _catalogStore.LevelRewards.UpdateOneAsync(
                    r => r.Id == keepReward,
                    Builders<CatalogLevelReward>.Update.Set(r => r.Level, request.Level!.Value).Set(r => r.DefId, item.Id),
                    new UpdateOptions { IsUpsert = true },
                    Finish);
            }

            if (mode == AdminCosmeticRules.ModeAchievement)
            {
                var last = await _catalogStore.Achievements.Find(FilterDefinition<CatalogAchievement>.Empty).SortByDescending(a => a.SortOrder).Limit(1).FirstOrDefaultAsync(Finish);
                await _catalogStore.Achievements.UpdateOneAsync(
                    a => a.TitleDefId == item.Id,
                    Builders<CatalogAchievement>.Update
                        .Set(a => a.Metric, request.Metric)
                        .Set(a => a.Target, request.Target!.Value)
                        .SetOnInsert(a => a.SortOrder, (last?.SortOrder ?? 0) + 1),
                    new UpdateOptions { IsUpsert = true },
                    Finish);
            }
            else
            {
                await _catalogStore.Achievements.DeleteOneAsync(a => a.TitleDefId == item.Id, Finish);
            }

            if (mode == AdminCosmeticRules.ModeDefault) await _defaults.SetAsync(item.Category, item.Id, Finish);
            else if (wasDefault) await _defaults.SetAsync(item.Category, null, Finish);
        }
        finally
        {
            _catalog.Invalidate();
        }

        var saved = await GetAsync(item.Id, Finish);
        await _audit.LogAsync(
            admin, "item.acquisition", "catalogItem", item.Id,
            new { before.Mode, before.Level, before.Metric, before.Target, item.Tradable },
            new { saved.Acquisition.Mode, saved.Acquisition.Level, saved.Acquisition.Metric, saved.Acquisition.Target, saved.Tradable },
            reason, Finish);
        return saved;
    }

    // ------------------------------------------------------------------ retire and delete

    public async Task<AdminCosmeticDto> SetRetiredAsync(CurrentUser admin, string id, AdminCosmeticRetireRequest request, CancellationToken ct = default)
    {
        var reason = RequireReason(request.Reason);
        var before = await LoadAsync(id, ct);
        if (before.Retired == request.Retired) return await GetAsync(id, ct);

        if (request.Retired)
        {
            var defaults = await _defaults.GetAsync(ct);
            if (defaults.For(before.Category) == before.Id)
                throw Refuse(409, AdminCosmeticCodes.DefaultCannotRetire, "Đây là món mặc định. Hãy đặt món khác làm mặc định trước khi ngừng phát hành.");
            // It takes over the moment another default steps down, so it has to stay fit for that.
            if (CosmeticDefaults.IsDefaultInCode(before.Category, before.Id))
                throw Refuse(409, AdminCosmeticCodes.DefaultCannotRetire, "Đây là món mặc định gốc của game, nên không ngừng phát hành được.");
        }
        // Both ways: an item coming back can raise what a chest pays out above what it costs.
        var after = BsonSerializer.Deserialize<CatalogItem>(before.ToBsonDocument());
        after.Retired = request.Retired;
        await EnsureChestsStayValidAsync(before, after, ct);

        await _catalogStore.Items.UpdateOneAsync(
            i => i.Id == before.Id,
            Builders<CatalogItem>.Update.Set(i => i.Retired, request.Retired).Set(i => i.UpdatedAt, Now).Set(i => i.UpdatedBy, admin.Id).Inc(i => i.Version, 1),
            cancellationToken: ct);
        _catalog.Invalidate();
        await _audit.LogAsync(
            admin, request.Retired ? "item.retire" : "item.unretire", "catalogItem", before.Id,
            new { before.Retired }, new { request.Retired }, reason, Finish);
        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(CurrentUser admin, string id, string? reasonText, CancellationToken ct = default)
    {
        var reason = RequireReason(reasonText);
        var item = await LoadAsync(id, ct);
        if (!string.IsNullOrEmpty(item.Visual?.BuiltinId))
            throw Refuse(409, AdminCosmeticCodes.BuiltinCannotBeDeleted, "Món có sẵn của game không xóa được. Hãy ngừng phát hành (retired).");
        var defaults = await _defaults.GetAsync(ct);
        if (defaults.For(item.Category) == item.Id)
            throw Refuse(409, AdminCosmeticCodes.DefaultCannotRetire, "Đây là món mặc định. Hãy đặt món khác làm mặc định trước.");

        var problems = new List<string>();
        var references = CatalogRules.ReferencesTo(
            item.Id,
            await ReadAsync(_catalogStore.Chests, new BsonDocument(), problems, ct),
            await ReadAsync(_catalogStore.LevelRewards, new BsonDocument(), problems, ct),
            await ReadAsync(_catalogStore.Achievements, new BsonDocument(), problems, ct));
        var owned = await _market.Items.CountDocumentsAsync(i => i.DefId == item.Id, cancellationToken: ct);
        if (CatalogRules.ValidateDelete(item.Id, owned, references) is { } violation) throw Refuse(409, violation);
        // Buy orders hold coins under this item's name, and nothing owned stands for them.
        await EnsureCanStopTradingAsync(item.Id, ct);

        await _catalogStore.Items.DeleteOneAsync(i => i.Id == item.Id, ct);
        _catalog.Invalidate();
        await _audit.LogAsync(admin, "item.delete", "catalogItem", item.Id, item, null, reason, Finish);
    }

    // ------------------------------------------------------------------ giving one to a player

    public async Task<AdminCosmeticGrantResultDto> GrantAsync(CurrentUser admin, string id, AdminCosmeticGrantRequest request, CancellationToken ct = default)
    {
        var reason = RequireReason(request.Reason);
        var item = await LoadAsync(id, ct);
        var userId = request.UserId?.Trim();
        if (string.IsNullOrEmpty(userId)) throw Refuse(400, MarketErrors.UserNotFound, "Hãy chọn người chơi.");
        if (await _market.Items.CountDocumentsAsync(i => i.OwnerId == userId && i.DefId == item.Id, cancellationToken: ct) > 0)
            throw Refuse(409, AdminCosmeticCodes.AlreadyOwned, "Người chơi này đã có món đó.");

        // A copy that can never be sold would hold its bag slot for good, so it is given the way earned ones are: no slot, and one per player.
        WalletDto wallet;
        if (item.Tradable)
        {
            wallet = await _marketService.AdminGrantAsync(userId, item.Id, 0, ct);
        }
        else
        {
            wallet = await _marketService.GetWalletForGrantAsync(userId, ct);
            try
            {
                await _market.Items.InsertOneAsync(new MarketItem
                {
                    Id = ProgressService.EarnedItemId(userId, item.Id),
                    OwnerId = userId,
                    DefId = item.Id,
                    Source = MarketItemSources.Level,
                    AcquiredAt = Now,
                }, cancellationToken: ct);
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
            {
                throw Refuse(409, AdminCosmeticCodes.AlreadyOwned, "Người chơi này đã có món đó.");
            }
        }
        await _audit.LogAsync(admin, "player.grant", "user", userId, null, new { defId = item.Id, item.Name }, reason, Finish);
        return new AdminCosmeticGrantResultDto(userId, item.Id, wallet.SlotsUsed, wallet.SlotCap);
    }

    // ------------------------------------------------------------------ XP rates

    public async Task<AdminXpSettingsDto> SetXpAsync(CurrentUser admin, AdminXpSettingsRequest request, CancellationToken ct = default)
    {
        var reason = RequireReason(request.Reason);
        if (AdminCosmeticRules.ValidateXp(request.RareXp, request.EpicXp) is { } violation) throw Refuse(400, violation);
        var current = _catalog.Current;
        var before = new { rareXp = current.RareXp, epicXp = current.EpicXp };
        await _catalogStore.ProgressSettings.UpdateOneAsync(
            s => s.Id == ProgressSettingsDocument.DocumentId,
            Builders<ProgressSettingsDocument>.Update.Set(s => s.RareXp, request.RareXp).Set(s => s.EpicXp, request.EpicXp),
            new UpdateOptions { IsUpsert = true },
            ct);
        _catalog.Invalidate();
        await _audit.LogAsync(admin, "gameSettings.update", "gameSettings", ProgressSettingsDocument.DocumentId, before, new { rareXp = request.RareXp, epicXp = request.EpicXp }, reason, Finish);
        return new AdminXpSettingsDto(request.RareXp, request.EpicXp);
    }

    // ------------------------------------------------------------------ the checks that need the database

    /// <summary>
    /// A change may not break a chest that is fine now. A chest already out of order is not this change's fault, so
    /// only what it newly breaks counts. See "khi retire một def" in docs/admin-contracts.md.
    /// </summary>
    private async Task EnsureChestsStayValidAsync(CatalogItem before, CatalogItem after, CancellationToken ct)
    {
        var problems = new List<string>();
        var chests = (await ReadAsync(_catalogStore.Chests, new BsonDocument("pool", before.Id), problems, ct)).ToList();
        if (chests.Count == 0) return;
        var items = (await ReadAsync(_catalogStore.Items, new BsonDocument(), problems, ct)).ToDictionary(item => item.Id, StringComparer.Ordinal);
        var changed = new Dictionary<string, CatalogItem>(items, StringComparer.Ordinal) { [before.Id] = after };
        foreach (var chest in chests)
        {
            var already = CatalogRules.ValidateChest(chest, items).Select(v => v.Code).ToHashSet(StringComparer.Ordinal);
            var fresh = CatalogRules.ValidateChest(chest, changed)
                .FirstOrDefault(v => v.Code is CatalogRuleCodes.RarityEmpty or CatalogRuleCodes.ExpectedValueTooHigh && !already.Contains(v.Code));
            if (fresh is not null) throw Refuse(409, fresh.Code, $"{chest.Name}: {fresh.Message}");
        }
    }

    /// <summary>Offers on an item that stops being tradable would vanish from the market with coins or the item still held.</summary>
    private async Task EnsureCanStopTradingAsync(string defId, CancellationToken ct)
    {
        var locked = await _market.Items.CountDocumentsAsync(i => i.DefId == defId && i.LockedBy != null, cancellationToken: ct);
        var orders = await _market.Orders.CountDocumentsAsync(
            o => o.DefId == defId && (o.Status == MarketOrderStatus.Active || o.Status == MarketOrderStatus.Pending || o.Status == MarketOrderStatus.Opening),
            cancellationToken: ct);
        if (locked + orders > 0)
            throw Refuse(409, AdminCosmeticCodes.OpenOrders, $"Món này đang có {locked + orders} lệnh trên chợ hoặc trong giao dịch. Hãy đợi các lệnh đó kết thúc.");
    }

    /// <summary>Copies earned for free would become money, and earned copies take no bag slot for a sale to give back.</summary>
    private async Task EnsureCanStartTradingAsync(string defId, CancellationToken ct)
    {
        var earned = await _market.Items.CountDocumentsAsync(
            i => i.DefId == defId && (i.Source == MarketItemSources.Level || i.Source == MarketItemSources.Achievement),
            cancellationToken: ct);
        if (earned > 0)
            throw Refuse(409, AdminCosmeticCodes.EarnedCopiesExist, $"Đã có {earned} bản được nhận miễn phí theo cấp hoặc thành tích, nên món này không thể bật giao dịch.");
    }

    // ------------------------------------------------------------------ shared reading

    private sealed record ReadContext(
        IReadOnlyList<CatalogLevelReward> LevelRewards,
        IReadOnlyList<CatalogAchievement> Achievements,
        IReadOnlyList<CatalogChest> Chests,
        CosmeticDefaults Defaults);

    private async Task<ReadContext> ContextAsync(List<string> problems, CancellationToken ct) => new(
        await ReadAsync(_catalogStore.LevelRewards, new BsonDocument(), problems, ct),
        await ReadAsync(_catalogStore.Achievements, new BsonDocument(), problems, ct),
        await ReadAsync(_catalogStore.Chests, new BsonDocument(), problems, ct),
        await _defaults.GetAsync(ct));

    private async Task<CatalogItem> LoadAsync(string id, CancellationToken ct)
    {
        var item = await _catalogStore.Items.Find(i => i.Id == id).FirstOrDefaultAsync(ct);
        if (item is null || !CosmeticCatalog.IsCosmetic(item.Category))
            throw Refuse(404, AdminCosmeticCodes.NotFound, "Không tìm thấy mỹ phẩm này.");
        return item;
    }

    /// <summary>One malformed document costs that document and shows up in the page's problems, not the whole page.</summary>
    private static async Task<List<T>> ReadAsync<T>(IMongoCollection<T> collection, BsonDocument filter, List<string> problems, CancellationToken ct)
    {
        var name = collection.CollectionNamespace.CollectionName;
        var documents = await collection.Database.GetCollection<BsonDocument>(name).Find(filter).ToListAsync(ct);
        var read = new List<T>(documents.Count);
        foreach (var document in documents)
        {
            try
            {
                read.Add(BsonSerializer.Deserialize<T>(document));
            }
            catch (Exception exception) when (exception is FormatException or BsonException or InvalidOperationException)
            {
                problems.Add($"{name}/{document.GetValue("_id", BsonNull.Value)}: {exception.Message}");
            }
        }
        return read;
    }

    private async Task<Dictionary<string, long>> OwnersAsync(IReadOnlyCollection<string> defIds, CancellationToken ct)
    {
        var groups = await _market.Items.Aggregate()
            .Match(i => defIds.Contains(i.DefId))
            .Group(i => new { i.DefId, i.OwnerId }, group => new { group.Key.DefId })
            .Group(row => row.DefId, group => new { DefId = group.Key, Count = group.LongCount() })
            .ToListAsync(ct);
        return groups.ToDictionary(row => row.DefId, row => row.Count, StringComparer.Ordinal);
    }

    private static string ModeOf(CatalogItem item, ReadContext context) => AcquisitionOf(item, context).Mode;

    private static AdminCosmeticAcquisitionDto AcquisitionOf(CatalogItem item, ReadContext context)
    {
        var chests = context.Chests
            .Where(chest => (chest.Pool ?? new List<string>()).Contains(item.Id, StringComparer.Ordinal))
            .OrderBy(chest => chest.SortOrder)
            .Select(chest => new AdminCosmeticChestDto(chest.Id, chest.Name, chest.Active))
            .ToList();
        if (context.Defaults.For(item.Category) == item.Id)
            return new AdminCosmeticAcquisitionDto(AdminCosmeticRules.ModeDefault, null, null, null, chests);
        var level = context.LevelRewards.Where(r => r.DefId == item.Id).OrderBy(r => r.Level).FirstOrDefault();
        if (level is not null)
            return new AdminCosmeticAcquisitionDto(AdminCosmeticRules.ModeLevel, level.Level, null, null, chests);
        var achievement = context.Achievements.FirstOrDefault(a => a.TitleDefId == item.Id);
        return achievement is not null
            ? new AdminCosmeticAcquisitionDto(AdminCosmeticRules.ModeAchievement, null, achievement.Metric, achievement.Target, chests)
            : new AdminCosmeticAcquisitionDto(AdminCosmeticRules.ModeAdmin, null, null, null, chests);
    }

    private AdminCosmeticDto ToDto(CatalogItem item, long owners, ReadContext context)
    {
        var def = _catalog.Current.Find(item.Id);
        var visual = item.Visual ?? new CatalogVisual();
        return new AdminCosmeticDto(
            item.Id, item.Category, item.Rarity, item.Name, item.NameEn, item.Description, item.DescriptionEn,
            def?.Description ?? item.Description,
            item.ReferencePrice, item.Tradable, item.Retired, item.SortOrder, item.Version, item.UpdatedAt, item.UpdatedBy,
            def?.Visual ?? new ItemVisual(visual.IconKey, visual.ImageUrl, visual.BuiltinId, visual.Template, (visual.Params ?? new BsonDocument()).ToDictionary()!),
            owners,
            AcquisitionOf(item, context));
    }

    private static CosmeticDefaultsDto ToDto(CosmeticDefaults defaults) => new(defaults.Frame, defaults.Title, defaults.Entrance);
}
