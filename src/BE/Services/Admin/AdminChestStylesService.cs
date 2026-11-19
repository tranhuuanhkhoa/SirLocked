using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

/// <summary>
/// Opening scenes made by admins (/admin/chests?tab=kieu-hom): a room picture, what drifts in it, its colours, its stamp,
/// and the chest and key pictures of the chests that use it. A chest uses one by naming its id as its look's template.
/// </summary>
public sealed class AdminChestStylesService
{
    private const int MaxIdAttempts = 5;

    private readonly CatalogStore _catalog;
    private readonly MarketStore _market;
    private readonly ICatalogProvider _provider;
    private readonly IAdminAudit _audit;

    public AdminChestStylesService(CatalogStore catalog, MarketStore market, ICatalogProvider provider, IAdminAudit audit)
    {
        _catalog = catalog;
        _market = market;
        _provider = provider;
        _audit = audit;
    }

    public async Task<AdminChestStyleListDto> ListAsync(CancellationToken ct = default)
    {
        var styles = await _catalog.ChestStyles.Find(FilterDefinition<CatalogChestStyle>.Empty).SortBy(style => style.Id).ToListAsync(ct);
        var chests = await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct);
        return new AdminChestStyleListDto(styles.Select(style => ToDto(style, chests)).ToList());
    }

    public async Task<AdminChestStyleDto> CreateAsync(CurrentUser admin, AdminChestStyleRequest request, CancellationToken ct = default)
    {
        var now = _market.Now;
        var style = Apply(new CatalogChestStyle(), request);
        var violations = AdminChestsRules.ValidateStyle(style);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);
        style.Version = 1;
        style.CreatedAt = now;
        style.UpdatedAt = now;
        style.UpdatedBy = admin.Id;

        var taken = (await _catalog.ChestStyles.Find(FilterDefinition<CatalogChestStyle>.Empty).Project(s => s.Id).ToListAsync(ct)).ToList();
        for (var attempt = 1; ; attempt++)
        {
            style.Id = AdminChestsRules.NextStyleId(taken);
            try
            {
                await _catalog.ChestStyles.InsertOneAsync(style, cancellationToken: ct);
                break;
            }
            catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey && attempt < MaxIdAttempts)
            {
                taken.Add(style.Id);
            }
        }

        _provider.Invalidate();
        await _audit.LogAsync(admin, "chestStyle.create", "chestStyle", style.Id, null, style, request.Reason, CancellationToken.None);
        return ToDto(style, await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct));
    }

    /// <summary>
    /// Replaces a style as a whole, refused if another admin saved it since <see cref="AdminChestStyleRequest.ExpectedVersion"/>.
    /// The chests that use it follow at once: their chest and key types show its new pictures where they have none of their own.
    /// </summary>
    public async Task<AdminChestStyleDto> UpdateAsync(CurrentUser admin, string id, AdminChestStyleRequest request, CancellationToken ct = default)
    {
        var before = await RequireAsync(id, ct);
        var after = Apply(before, request);
        var violations = AdminChestsRules.ValidateStyle(after);
        if (violations.Count > 0) throw AdminChestsErrors.Refused(violations);
        if (request.ExpectedVersion != before.Version) throw AdminChestsErrors.Conflict();
        after.Version = before.Version + 1;
        after.UpdatedAt = _market.Now;
        after.UpdatedBy = admin.Id;

        var replaced = await _catalog.ChestStyles.ReplaceOneAsync(s => s.Id == id && s.Version == before.Version, after, cancellationToken: ct);
        if (replaced.ModifiedCount == 0) throw AdminChestsErrors.Conflict();

        var chests = await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct);
        try
        {
            foreach (var chest in chests.Where(chest => chest.Look?.Template == id))
            {
                await FollowAsync(admin, chest.Id, AdminChestsRules.ChestPictureOf(chest, after), CancellationToken.None);
                await FollowAsync(admin, chest.KeyDefId, AdminChestsRules.KeyPictureOf(chest, after), CancellationToken.None);
            }
        }
        finally
        {
            _provider.Invalidate();
        }
        await _audit.LogAsync(admin, "chestStyle.update", "chestStyle", id, before, after, request.Reason, CancellationToken.None);
        return ToDto(after, chests);
    }

    /// <summary>Only a style no chest uses can go: a chest whose style vanished would have no room to open in.</summary>
    public async Task DeleteAsync(CurrentUser admin, string id, string? reason, CancellationToken ct = default)
    {
        var style = await RequireAsync(id, ct);
        var users = (await AdminChestsStore.ReadChestsAsync(_catalog.Chests, ct)).Where(chest => chest.Look?.Template == id).ToList();
        if (users.Count > 0)
            throw AdminChestsErrors.Error(409, AdminChestsRules.StyleInvalid,
                $"Kiểu hòm này đang được dùng ở {string.Join(", ", users.Select(chest => chest.Name))}. Đổi kiểu của các hòm đó trước khi xóa.");
        await _catalog.ChestStyles.DeleteOneAsync(s => s.Id == id, ct);
        _provider.Invalidate();
        await _audit.LogAsync(admin, "chestStyle.delete", "chestStyle", id, style, null, reason, CancellationToken.None);
    }

    private async Task FollowAsync(CurrentUser admin, string defId, string? imageUrl, CancellationToken ct) =>
        await _catalog.Items.UpdateOneAsync(item => item.Id == defId && item.Visual.ImageUrl != imageUrl, Builders<CatalogItem>.Update
            .Set(item => item.Visual.ImageUrl, imageUrl)
            .Set(item => item.UpdatedAt, _market.Now)
            .Set(item => item.UpdatedBy, admin.Id)
            .Inc(item => item.Version, 1), cancellationToken: ct);

    private async Task<CatalogChestStyle> RequireAsync(string id, CancellationToken ct) =>
        await _catalog.ChestStyles.Find(style => style.Id == id).FirstOrDefaultAsync(ct)
        ?? throw AdminChestsErrors.Error(404, AdminChestsRules.StyleInvalid, $"Không có kiểu hòm {id}.");

    private static CatalogChestStyle Apply(CatalogChestStyle before, AdminChestStyleRequest request) => new()
    {
        Id = before.Id,
        Name = request.Name?.Trim() ?? string.Empty,
        NameEn = request.NameEn?.Trim() ?? string.Empty,
        BackdropUrl = request.BackdropUrl?.Trim() ?? string.Empty,
        Particles = string.IsNullOrWhiteSpace(request.Particles) ? ChestStyleParticles.Dust : request.Particles.Trim(),
        ParticleUrl = string.IsNullOrWhiteSpace(request.ParticleUrl) ? null : request.ParticleUrl.Trim(),
        Accent = request.Accent?.Replace(" ", string.Empty, StringComparison.Ordinal) ?? string.Empty,
        Accent2 = request.Accent2?.Replace(" ", string.Empty, StringComparison.Ordinal) ?? string.Empty,
        StampText = request.StampText?.Trim() ?? string.Empty,
        StampTextEn = request.StampTextEn?.Trim() ?? string.Empty,
        StampColor = request.StampColor?.Replace(" ", string.Empty, StringComparison.Ordinal) ?? string.Empty,
        ChestImageUrl = request.ChestImageUrl?.Trim() ?? string.Empty,
        KeyImageUrl = request.KeyImageUrl?.Trim() ?? string.Empty,
        Version = before.Version,
        CreatedAt = before.CreatedAt,
        UpdatedAt = before.UpdatedAt,
        UpdatedBy = before.UpdatedBy,
    };

    private static AdminChestStyleDto ToDto(CatalogChestStyle style, IEnumerable<CatalogChest> chests) => new(
        style.Id, style.Name, style.NameEn, style.BackdropUrl, style.Particles, style.ParticleUrl,
        style.Accent, style.Accent2, style.StampText, style.StampTextEn, style.StampColor, style.ChestImageUrl, style.KeyImageUrl,
        style.Version, style.UpdatedAt,
        chests.Where(chest => chest.Look?.Template == style.Id).Select(chest => new AdminChestStyleUserDto(chest.Id, chest.Name)).ToList());
}
