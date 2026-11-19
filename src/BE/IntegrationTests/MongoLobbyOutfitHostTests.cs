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
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>PUT /api/rooms/{roomId}/outfit through the real pipeline: route, DI and JSON. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.</summary>
public sealed class MongoLobbyOutfitHostTests
{
    private const string HostId = "507f1f77bcf86cd799439031";
    private const string GuestId = "507f1f77bcf86cd799439032";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task APlayerPutsOnAndTakesOffAnOutfitFromTheLobby()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        var (roomId, outfitId) = await SeedAsync(factory);

        using var wear = await client.PutAsJsonAsync($"/api/rooms/{roomId}/outfit", new { category = MarketCategories.SkinSherlock, itemId = outfitId });
        Assert.True(wear.StatusCode == HttpStatusCode.OK, $"PUT outfit answered {(int)wear.StatusCode}: {await wear.Content.ReadAsStringAsync()}");
        Assert.Equal(new[] { SkinCatalog.SherlockWhitechapel }, SkinsOf(await wear.Content.ReadAsStringAsync(), GuestId));

        using var room = await client.GetAsync($"/api/rooms/{roomId}");
        Assert.Equal(new[] { SkinCatalog.SherlockWhitechapel }, SkinsOf(await room.Content.ReadAsStringAsync(), GuestId));

        using var off = await client.PutAsJsonAsync($"/api/rooms/{roomId}/outfit", new { category = MarketCategories.SkinSherlock, itemId = (string?)null });
        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        Assert.Empty(SkinsOf(await off.Content.ReadAsStringAsync(), GuestId));
    }

    [Fact]
    public async Task AnUnknownSlotIsA400()
    {
        if (!Enabled) return;
        await using var factory = new HostFactory();
        using var client = factory.CreateClient();
        var (roomId, _) = await SeedAsync(factory);

        using var response = await client.PutAsJsonAsync($"/api/rooms/{roomId}/outfit", new { category = "FRAME", itemId = (string?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static string[] SkinsOf(string json, string userId)
    {
        using var body = JsonDocument.Parse(json);
        var player = body.RootElement.GetProperty("data").GetProperty("players").EnumerateArray()
            .Single(p => p.GetProperty("userId").GetString() == userId);
        return player.GetProperty("skinDefIds").EnumerateArray().Select(id => id.GetString()!).ToArray();
    }

    /// <summary>Two real accounts in a waiting room; the guest (the caller) owns a Sherlock outfit.</summary>
    private static async Task<(string RoomId, string OutfitId)> SeedAsync(HostFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        foreach (var id in new[] { HostId, GuestId })
        {
            await db.Users.InsertOneAsync(new User
            {
                Id = id,
                FullName = id == HostId ? "Chủ phòng" : "Khách",
                Email = $"{id}@integration.test",
                Role = UserRole.Player,
                Status = UserStatus.Active,
                IsEmailVerified = true,
            });
        }
        var market = scope.ServiceProvider.GetRequiredService<MarketService>();
        await market.AdminGrantAsync(GuestId, SkinCatalog.SherlockWhitechapel, 0);
        var store = scope.ServiceProvider.GetRequiredService<MarketStore>();
        var outfit = await store.Items.Find(i => i.OwnerId == GuestId && i.DefId == SkinCatalog.SherlockWhitechapel).SingleAsync();

        var gameCase = new GameCase { CaseId = "vu-thu-trang-phuc", Title = "Vụ thử", Status = CaseStatus.Published };
        await db.Cases.InsertOneAsync(gameCase);
        var roomId = MongoDB.Bson.ObjectId.GenerateNewId().ToString();
        await db.Rooms.InsertOneAsync(new GameRoom
        {
            Id = roomId,
            RoomCode = roomId[^6..].ToUpperInvariant(),
            CaseId = gameCase.CaseId,
            HostUserId = HostId,
            Status = RoomStatus.Waiting,
            Players = new List<RoomPlayer>
            {
                new() { UserId = HostId, Username = "Chủ phòng" },
                new() { UserId = GuestId, Username = "Khách", Role = PlayerRole.Interrogator },
            },
        });
        return (roomId, outfit.Id);
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

    /// <summary>Every request is the guest, a verified player.</summary>
    private sealed class TestAuth : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public const string SchemeName = "LobbyOutfitTest";

        public TestAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var identity = new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, GuestId),
                new Claim(ClaimTypes.Name, "Khách"),
                new Claim(ClaimTypes.Role, UserRole.Player),
                // UserStatusMiddleware refuses a token without the authorization version (45f56a9); a fresh user is at 0.
                new Claim(SirLocked.Api.Models.User.AuthorizationVersionClaim, "0"),
            }, SchemeName);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
        }
    }
}
