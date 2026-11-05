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
        ("GET", "/api/admin/chests"),
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
            }, SchemeName);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
        }
    }
}
