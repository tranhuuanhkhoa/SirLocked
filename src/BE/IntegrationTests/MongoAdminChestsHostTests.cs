using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>The chests and items admin through the real pipeline: routes, authorization and the error envelope. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.</summary>
public sealed class MongoAdminChestsHostTests
{
    private const string AdminId = "507f1f77bcf86cd799439021";
    private const string PlayerId = "507f1f77bcf86cd799439022";
    private const string VipId = "507f1f77bcf86cd799439023";

    /// <summary>The API refuses a token whose account is gone, so each caller needs a real one for a 403 to be about the role.</summary>
    private static async Task AddUsersAsync(HostFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        foreach (var (id, role) in new[] { (AdminId, UserRole.Admin), (PlayerId, UserRole.Player), (VipId, UserRole.Vip) })
        {
            await db.Users.InsertOneAsync(new User
            {
                Id = id,
                FullName = role,
                Email = $"{id}@integration.test",
                Role = role,
                Status = UserStatus.Active,
                IsEmailVerified = true,
            });
        }
    }

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static readonly (string Method, string Path)[] Routes =
    {
        ("GET", "/api/admin/items"),
        ("POST", "/api/admin/items"),
        ("PUT", "/api/admin/items/VC-0388"),
        ("POST", "/api/admin/items/VC-0388/retire"),
        ("POST", "/api/admin/items/VC-0388/delete"),
        ("GET", "/api/admin/chest-styles"),
        ("POST", "/api/admin/chest-styles"),
        ("PUT", "/api/admin/chest-styles/style_001"),
        ("POST", "/api/admin/chest-styles/style_001/delete"),
        ("GET", "/api/admin/chests"),
        ("POST", "/api/admin/chests"),
        ("POST", "/api/admin/chests/check"),
        ("GET", "/api/admin/chests/chest_np"),
        ("PUT", "/api/admin/chests/chest_np"),
        ("POST", "/api/admin/chests/chest_np/check"),
        ("POST", "/api/admin/chests/chest_np/clone"),
        ("GET", "/api/admin/chests/chest_np/versions"),
        ("POST", "/api/admin/chests/chest_np/versions/1/restore"),
        ("GET", "/api/admin/chests/chest_np/preview"),
        ("POST", "/api/admin/chests/chest_np/preview/open"),
        ("GET", "/api/admin/chests/chest_np/stats"),
        ("GET", "/api/admin/chests/openings"),
        ("GET", "/api/admin/chests/players?q=a"),
        ("POST", "/api/admin/chests/grant"),
    };

    [Fact]
    public async Task SomeoneWhoIsNotAnAdminGets403OnEveryRoute()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        await AddUsersAsync(factory);
        foreach (var (id, role) in new[] { (PlayerId, UserRole.Player), (VipId, UserRole.Vip) })
        {
            client.DefaultRequestHeaders.Remove("X-Test-UserId");
            client.DefaultRequestHeaders.Add("X-Test-UserId", id);
            client.DefaultRequestHeaders.Remove("X-Test-Role");
            client.DefaultRequestHeaders.Add("X-Test-Role", role);
            foreach (var (method, path) in Routes)
            {
                using var request = new HttpRequestMessage(new HttpMethod(method), path);
                if (method != "GET") request.Content = JsonContent.Create(new { });
                using var response = await client.SendAsync(request);

                Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{role} {method} {path} answered {(int)response.StatusCode}.");
            }
        }
    }

    [Fact]
    public async Task AnAdminReachesEveryRead_AndARefusedSaveExplainsItselfInVietnamese()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        await AddUsersAsync(factory);
        foreach (var path in new[] { "/api/admin/items", "/api/admin/chests", "/api/admin/chests/chest_np", "/api/admin/chests/chest_np/versions", "/api/admin/chests/chest_np/stats?days=7", "/api/admin/chests/openings", "/api/admin/chests/players?q=a", "/api/admin/chests/chest_np/preview" })
        {
            using var read = await client.GetAsync(path);
            Assert.True(read.StatusCode == HttpStatusCode.OK, $"{path} answered {(int)read.StatusCode}: {await read.Content.ReadAsStringAsync()}");
        }

        using var refused = await client.PutAsJsonAsync("/api/admin/chests/chest_np", new
        {
            name = "Hòm Niêm Phong", nameEn = "Sealed Case", subtitle = "", subtitleEn = "", keyName = "chìa", keyNameEn = "key",
            chestPrice = 120, keyPrice = 180, active = true, sortOrder = 0,
            look = new { template = "seal", light = "1,2,3", hi = "1,2,3", core = "1,2,3" },
            dropWeights = new Dictionary<string, int> { ["COMMON"] = 9000 },
            pool = new[] { "VC-0388" },
            expectedVersion = 1,
            reason = "Thử",
        });

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        using var body = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
        var errors = body.RootElement.GetProperty("errors");
        Assert.Equal("ADMIN_VALIDATION", errors.GetProperty("code").GetString());
        var violation = errors.GetProperty("violations").EnumerateArray().Single(v => v.GetProperty("code").GetString() == "CHEST_WEIGHTS_TOTAL");
        Assert.StartsWith("Tổng trọng số", violation.GetProperty("message").GetString());
    }

    [Fact]
    public async Task AnAdminChecksAndCreatesANewChestOverHttp()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        await AddUsersAsync(factory);
        using var sourceResponse = await client.GetAsync("/api/admin/chests/chest_np");
        var source = JsonDocument.Parse(await sourceResponse.Content.ReadAsStringAsync()).RootElement.GetProperty("data");
        var draft = new
        {
            name = "Hòm Gió Mùa", nameEn = "Monsoon Chest", subtitle = "", subtitleEn = "", keyName = "chìa gió", keyNameEn = "wind key",
            chestPrice = source.GetProperty("chestPrice").GetInt64(), keyPrice = source.GetProperty("keyPrice").GetInt64(),
            active = false, sortOrder = 0,
            look = new { template = "bank", light = "1,2,3", hi = "4,5,6", core = "7,8,9" },
            dropWeights = source.GetProperty("dropWeights").Deserialize<Dictionary<string, int>>(),
            pool = source.GetProperty("pool").EnumerateArray().Select(item => item.GetProperty("def").GetProperty("id").GetString()).ToArray(),
            expectedVersion = 0,
            reason = "Sự kiện",
        };

        using var check = await client.PostAsJsonAsync("/api/admin/chests/check", draft);
        var checkBody = await check.Content.ReadAsStringAsync();
        Assert.True(check.StatusCode == HttpStatusCode.OK, checkBody);
        Assert.Empty(JsonDocument.Parse(checkBody).RootElement.GetProperty("data").GetProperty("violations").EnumerateArray());

        using var created = await client.PostAsJsonAsync("/api/admin/chests", draft);
        var createdBody = await created.Content.ReadAsStringAsync();
        Assert.True(created.StatusCode == HttpStatusCode.OK, createdBody);
        var id = JsonDocument.Parse(createdBody).RootElement.GetProperty("data").GetProperty("id").GetString();
        using var read = await client.GetAsync($"/api/admin/chests/{id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    [Fact]
    public async Task TheChallengeWeightTravelsAsJson_OnListDetailVersionsAndSave()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        await AddUsersAsync(factory);

        using var list = JsonDocument.Parse(await client.GetStringAsync("/api/admin/chests"));
        var row = list.RootElement.GetProperty("data").GetProperty("chests").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "chest_np");
        Assert.Equal(60, row.GetProperty("challengeWeight").GetInt32());
        Assert.Equal(60m, row.GetProperty("challengePercent").GetDecimal());

        using var detail = JsonDocument.Parse(await client.GetStringAsync("/api/admin/chests/chest_np"));
        var data = detail.RootElement.GetProperty("data");
        var response = await client.PutAsJsonAsync("/api/admin/chests/chest_np", new
        {
            name = data.GetProperty("name").GetString(), nameEn = data.GetProperty("nameEn").GetString(),
            subtitle = data.GetProperty("subtitle").GetString(), subtitleEn = data.GetProperty("subtitleEn").GetString(),
            keyName = data.GetProperty("keyName").GetString(), keyNameEn = data.GetProperty("keyNameEn").GetString(),
            chestPrice = data.GetProperty("chestPrice").GetInt64(), keyPrice = data.GetProperty("keyPrice").GetInt64(),
            active = true, sortOrder = data.GetProperty("sortOrder").GetInt32(),
            look = JsonSerializer.Deserialize<JsonElement>(data.GetProperty("look").GetRawText()),
            dropWeights = JsonSerializer.Deserialize<JsonElement>(data.GetProperty("dropWeights").GetRawText()),
            pool = data.GetProperty("pool").EnumerateArray().Select(item => item.GetProperty("def").GetProperty("id").GetString()).ToArray(),
            challengeWeight = 30,
            expectedVersion = data.GetProperty("version").GetInt32(),
            reason = "Giảm tỷ lệ rơi",
        });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        using var saved = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(30, saved.RootElement.GetProperty("data").GetProperty("challengeWeight").GetInt32());
        Assert.Equal(42.86m, saved.RootElement.GetProperty("data").GetProperty("challengePercent").GetDecimal());

        using var versions = JsonDocument.Parse(await client.GetStringAsync("/api/admin/chests/chest_np/versions"));
        var newest = versions.RootElement.GetProperty("data").EnumerateArray().First();
        Assert.Equal(30, newest.GetProperty("challengeWeight").GetInt32());
        Assert.Contains(newest.GetProperty("diff").GetProperty("fields").EnumerateArray(), field => field.GetProperty("field").GetString() == "challengeWeight");
    }

    [Fact]
    public async Task AMissingChestAndAMissingItemAre404()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        await AddUsersAsync(factory);

        using var chest = await client.GetAsync("/api/admin/chests/khong-co");
        Assert.Equal(HttpStatusCode.NotFound, chest.StatusCode);
        using var item = await client.PostAsJsonAsync("/api/admin/items/khong-co/retire", new { retired = true, reason = "Thử" });
        Assert.Equal(HttpStatusCode.NotFound, item.StatusCode);
    }

    private sealed class HostFactory : WebApplicationFactory<Program>
    {
        private readonly string _connectionString =
            Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";
        private readonly string _databaseName = $"sirlocked_it_{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName });
            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.ClearProviders());
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["MongoDb:ConnectionString"] = _connectionString,
                ["MongoDb:DatabaseName"] = _databaseName,
                ["MOCK_AI_RESPONSES"] = "true",
                ["SKIP_ASSET_GENERATION"] = "true",
                ["CaseCatalog:PixelOnly"] = "false",
                ["CaseCatalog:SeedPixelOnStartup"] = "false",
                ["Jwt:Secret"] = "integration-test-secret-with-at-least-32-characters",
                ["Google:ClientId"] = "integration-test-google-client",
                ["Google:ClientSecret"] = "integration-test-google-secret",
                ["Email:SmtpHost"] = "127.0.0.1",
                ["Email:SmtpPort"] = "1",
                ["Email:SenderEmail"] = "integration@example.invalid",
                ["Email:Username"] = "integration-only",
                ["Email:Password"] = "unused-integration-placeholder",
                ["Email:FrontendUrl"] = "http://127.0.0.1:5173",
            }));
            builder.ConfigureTestServices(services =>
            {
                services.AddDataProtection().UseEphemeralDataProtectionProvider();
                services.PostConfigure<GoogleOptions>(GoogleDefaults.AuthenticationScheme, options =>
                {
                    options.ClientId = "integration-test-google-client";
                    options.ClientSecret = "integration-test-google-secret";
                });
                services.AddAuthentication(options =>
                    {
                        options.DefaultAuthenticateScheme = TestAuth.SchemeName;
                        options.DefaultChallengeScheme = TestAuth.SchemeName;
                    })
                    .AddScheme<AuthenticationSchemeOptions, TestAuth>(TestAuth.SchemeName, _ => { });
            });
        }

        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync();
            await new MongoClient(_connectionString).DropDatabaseAsync(_databaseName);
        }
    }

    private sealed class TestAuth : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public const string SchemeName = "AdminChestsTest";

        public TestAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var role = Request.Headers["X-Test-Role"].FirstOrDefault() ?? UserRole.Admin;
            var userId = Request.Headers["X-Test-UserId"].FirstOrDefault() ?? AdminId;
            var identity = new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId),
                new Claim(ClaimTypes.Name, "Integration Admin"),
                new Claim(ClaimTypes.Role, role),
                // Like a real login token: UserStatusMiddleware refuses a token without authz_ver.
                new Claim(SirLocked.Api.Models.User.AuthorizationVersionClaim, "0"),
            }, SchemeName);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
        }
    }
}
