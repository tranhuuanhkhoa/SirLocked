using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public sealed class CaseCache
{
    private const string PublishedCasesKey = "cases:published";
    private const string AdminCasesKey = "cases:admin";

    private readonly IMemoryCache _cache;
    private readonly MemoryCacheEntryOptions _entryOptions;

    public CaseCache(IMemoryCache cache, IOptions<CaseCacheSettings> options)
    {
        _cache = cache;
        var settings = options.Value;
        _entryOptions = new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(
                Math.Clamp(settings.AbsoluteExpirationSeconds, 30, 3600)),
            SlidingExpiration = TimeSpan.FromSeconds(
                Math.Clamp(settings.SlidingExpirationSeconds, 10, 600))
        };
    }

    public Task<GameCase> GetCaseAsync(string caseId, Func<Task<GameCase>> factory) =>
        GetOrCreateAsync(CaseKey(caseId), factory);

    public Task<List<CaseSummaryResponse>> GetPublishedAsync(
        Func<Task<List<CaseSummaryResponse>>> factory) =>
        GetOrCreateAsync(PublishedCasesKey, factory);

    public Task<List<CaseSummaryResponse>> GetAdminListAsync(
        Func<Task<List<CaseSummaryResponse>>> factory) =>
        GetOrCreateAsync(AdminCasesKey, factory);

    public void Invalidate(string caseId)
    {
        _cache.Remove(CaseKey(caseId));
        _cache.Remove(PublishedCasesKey);
        _cache.Remove(AdminCasesKey);
    }

    private async Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> factory)
    {
        if (_cache.TryGetValue(key, out T? cached) && cached is not null)
        {
            return cached;
        }

        var value = await factory();
        _cache.Set(key, value, _entryOptions);
        return value;
    }

    private static string CaseKey(string caseId) => $"cases:id:{caseId}";
}
