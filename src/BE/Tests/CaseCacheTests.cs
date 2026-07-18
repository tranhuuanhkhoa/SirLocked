using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class CaseCacheTests
{
    [Fact]
    public async Task CaseAndListEntries_AreReusedUntilCaseIsInvalidated()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var cache = new CaseCache(memory, Options.Create(new CaseCacheSettings()));
        var caseLoads = 0;
        var publishedLoads = 0;
        var adminLoads = 0;

        Task<GameCase> LoadCase()
        {
            caseLoads++;
            return Task.FromResult(new GameCase { CaseId = "case-1", Title = $"Load {caseLoads}" });
        }

        Task<List<CaseSummaryResponse>> LoadPublished()
        {
            publishedLoads++;
            return Task.FromResult(new List<CaseSummaryResponse>());
        }

        Task<List<CaseSummaryResponse>> LoadAdmin()
        {
            adminLoads++;
            return Task.FromResult(new List<CaseSummaryResponse>());
        }

        var first = await cache.GetCaseAsync("case-1", LoadCase);
        var second = await cache.GetCaseAsync("case-1", LoadCase);
        await cache.GetPublishedAsync(LoadPublished);
        await cache.GetPublishedAsync(LoadPublished);
        await cache.GetAdminListAsync(LoadAdmin);
        await cache.GetAdminListAsync(LoadAdmin);

        Assert.Same(first, second);
        Assert.Equal(1, caseLoads);
        Assert.Equal(1, publishedLoads);
        Assert.Equal(1, adminLoads);

        cache.Invalidate("case-1");

        var refreshed = await cache.GetCaseAsync("case-1", LoadCase);
        await cache.GetPublishedAsync(LoadPublished);
        await cache.GetAdminListAsync(LoadAdmin);

        Assert.NotSame(first, refreshed);
        Assert.Equal(2, caseLoads);
        Assert.Equal(2, publishedLoads);
        Assert.Equal(2, adminLoads);
    }
}
