using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Knows which cases are "legacy" (not pixel) while <c>CaseCatalog:PixelOnly</c> is on, so everything that belongs
/// to them — rooms, results, reviews, leaderboards, admin lists and counters — can be hidden in one consistent way.
/// Nothing is deleted: switching PixelOnly off brings all of it back.
/// </summary>
public sealed class LegacyCaseCatalog
{
    private readonly MongoDbContext _db;
    private readonly CaseCache _cache;
    private readonly CaseCatalogPolicy _policy;

    public LegacyCaseCatalog(MongoDbContext db, CaseCache cache, CaseCatalogPolicy policy)
    {
        _db = db;
        _cache = cache;
        _policy = policy;
    }

    /// <summary>True when legacy cases are being hidden at all.</summary>
    public bool Enabled => _policy.PixelOnly;

    /// <summary>A summary is legacy when it is not a pixel case and legacy cases are hidden.</summary>
    public bool IsLegacy(CaseSummaryResponse summary) => Enabled && !summary.IsPixel;

    /// <summary>Ids of every stored case that is not a pixel case; empty when legacy cases are not hidden.</summary>
    public async Task<IReadOnlyList<string>> GetHiddenCaseIdsAsync()
    {
        if (!Enabled) return [];
        var all = await _cache.GetAdminListAsync(() => CaseService.LoadAdminListAsync(_db));
        return all.Where(summary => !summary.IsPixel).Select(summary => summary.CaseId).ToList();
    }

    public async Task<bool> IsHiddenAsync(string caseId)
    {
        if (!Enabled) return false;
        var hidden = await GetHiddenCaseIdsAsync();
        return hidden.Contains(caseId, StringComparer.Ordinal);
    }

    /// <summary>The admin list: legacy cases stay out unless the admin asks for them.</summary>
    public List<CaseSummaryResponse> FilterAdminList(IEnumerable<CaseSummaryResponse> all, bool includeLegacy) =>
        includeLegacy ? all.ToList() : all.Where(summary => !IsLegacy(summary)).ToList();

    /// <summary>Adds "caseId is not a legacy case" to a filter. A no-op when nothing is hidden.</summary>
    public async Task<FilterDefinition<T>> ExcludeAsync<T>(FilterDefinition<T> filter, System.Linq.Expressions.Expression<Func<T, string>> caseIdField)
    {
        var hidden = await GetHiddenCaseIdsAsync();
        return hidden.Count == 0 ? filter : filter & Builders<T>.Filter.Nin(caseIdField, hidden);
    }
}
