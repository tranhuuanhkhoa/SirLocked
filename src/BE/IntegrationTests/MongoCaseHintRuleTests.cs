using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The hint rule of VUAN-6 at the import door, against a real loopback MongoDB (SIRLOCKED_RUN_MONGO_IT=true):
/// a new case must carry three hint levels everywhere; a case that already exists or ships with the server
/// (the published pixel cases) only gets warnings, on import, validate and publish.
/// </summary>
public sealed class MongoCaseHintRuleTests
{
    private const string Sample = "case-pixel-dong-ho-dem-mua-vi.json";
    private const string PixelSeed = "case-pixel-lo-thuoc-thu-nam-vi";

    private static JsonObject Fixture() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", Sample)))!.AsObject();

    private static JsonObject Seed(string caseId) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", $"{caseId}.json")))!.AsObject();

    private static JsonObject WithoutHint(JsonObject gameCase, string hintId)
    {
        var hints = gameCase["hints"]!.AsArray();
        hints.Remove(hints.Single(hint => hint!["hintId"]!.GetValue<string>() == hintId));
        return gameCase;
    }

    private static JsonElement Element(JsonObject json) => JsonDocument.Parse(json.ToJsonString()).RootElement.Clone();

    [Fact]
    public Task NewCase_WithAMissingLevel_IsRefused_WithTheExactTarget() => WithCases(async cases =>
    {
        var json = WithoutHint(Fixture(), "hint-dh-ben-2");
        json["caseId"] = "case-hint-rule-new";

        var check = await cases.ValidateJsonForImportAsync(Element(json));
        Assert.False(check.IsValid);
        var error = Assert.Single(check.Errors);
        Assert.Equal(CaseHintCodes.MissingHintLevel, error.Code);
        Assert.Equal("hints[SCENE:scene-dh-ben-cang]", error.Path);

        var refused = await Assert.ThrowsAsync<ApiException>(() => cases.ImportJsonAsync(Element(json), overwrite: false));
        Assert.Equal(422, refused.StatusCode);
        Assert.Contains(Assert.IsAssignableFrom<IEnumerable<CaseValidationError>>(refused.Errors),
            item => item.Code == CaseHintCodes.MissingHintLevel && item.RefId == "scene-dh-ben-cang");
        Assert.Null(await cases.FindCaseAsync("case-hint-rule-new"));
    });

    [Fact]
    public Task NewCase_WithEveryLevel_ImportsCleanly() => WithCases(async cases =>
    {
        var summary = await cases.ImportJsonAsync(Element(Fixture()), overwrite: false);
        Assert.Null(summary.ValidationWarnings);
        Assert.True((await cases.ValidateJsonForImportAsync(Element(Fixture()))).IsValid);
    });

    [Fact]
    public Task ExistingCase_MissingALevel_OnlyWarns_OnImportValidateAndPublish() => WithCases(async cases =>
    {
        await cases.ImportJsonAsync(Element(Fixture()), overwrite: false);
        var edited = WithoutHint(Fixture(), "hint-dh-doi-chat-3");

        var check = await cases.ValidateJsonForImportAsync(Element(edited));
        Assert.True(check.IsValid);
        Assert.Contains(check.Warnings, warning => warning.Code == CaseHintCodes.MissingHintLevel);

        var summary = await cases.ImportJsonAsync(Element(edited), overwrite: true);
        Assert.Contains(summary.ValidationWarnings!, warning => warning.RefId == "challenge-dh-vao-tiem");
        var published = await cases.PublishAsync(summary.CaseId);
        Assert.Equal("PUBLISHED", published.Status);
        Assert.Contains(published.ValidationWarnings!, warning => warning.Code == CaseHintCodes.MissingHintLevel);
    });

    [Fact]
    public Task PublishedPixelCases_WithoutHints_StillSeedImportAndPublish() => WithCases(async cases =>
    {
        // Startup seeding of the bundled cases is never blocked by the rule ...
        Assert.Equal(2, (await cases.SeedPixelDemoAsync()).Count);
        // ... nor is importing one of them by hand, even into an empty database (the studio playtest does that).
        await cases.Db.Cases.DeleteOneAsync(item => item.CaseId == PixelSeed);
        var summary = await cases.ImportJsonAsync(Element(Seed(PixelSeed)), overwrite: true);
        Assert.Contains(summary.ValidationWarnings!, warning => CaseHintCodes.All.Contains(warning.Code));
        var published = await cases.PublishAsync(PixelSeed);
        Assert.Equal("PUBLISHED", published.Status);
    });

    private sealed class Cases(MongoDbContext db, CaseService service)
    {
        public MongoDbContext Db { get; } = db;
        public Task<CaseValidationResponse> ValidateJsonForImportAsync(JsonElement json) => service.ValidateJsonForImportAsync(json);
        public Task<CaseSummaryResponse> ImportJsonAsync(JsonElement json, bool overwrite) => service.ImportJsonAsync(json, overwrite);
        public Task<CaseSummaryResponse> PublishAsync(string caseId) => service.PublishAsync(caseId);
        public Task<List<CaseSummaryResponse>> SeedPixelDemoAsync() => service.SeedPixelDemoAsync();
        public Task<SirLocked.Api.Models.GameCase?> FindCaseAsync(string caseId) => service.FindCaseAsync(caseId);
    }

    private static async Task WithCases(Func<Cases, Task> test)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase))
            return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        EnsureLoopbackTestDatabase(settings);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.PingAsync();
            await db.EnsureIndexesAsync();
            var cache = new CaseCache(new MemoryCache(new MemoryCacheOptions()), Options.Create(new CaseCacheSettings()));
            var service = new CaseService(db, cache, new CaseValidationService(), Options.Create(new GameplayV3Settings { Enabled = true }),
                new TestEnvironment(), NullLogger<CaseService>.Instance,
                new CaseCatalogPolicy(new CaseCatalogSettings { PixelOnly = true }));
            await test(new Cases(db, service));
        }
        finally
        {
            EnsureLoopbackTestDatabase(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private static void EnsureLoopbackTestDatabase(MongoDbSettings settings)
    {
        if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal))
            throw new InvalidOperationException("Test database must start with 'sirlocked_it_'.");
        var servers = new MongoUrl(settings.ConnectionString).Servers.ToList();
        if (servers.Count == 0 || servers.Any(server => !(string.Equals(server.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || (IPAddress.TryParse(server.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address)))))
            throw new InvalidOperationException("Integration tests require a loopback-only MongoDB connection.");
    }

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "SirLocked.Api";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = AppContext.BaseDirectory;
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
