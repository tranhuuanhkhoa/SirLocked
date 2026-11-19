using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests.AdminPlayers;

/// <summary>
/// The admin routes behind the real pipeline (JWT, roles, session check): who gets in, what an old token gets after a
/// forced logout, and what the answers contain. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAdminPlayersHostTests
{
    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static readonly string[] AdminRoutes =
    [
        "GET /api/admin/players",
        "GET /api/admin/players/507f1f77bcf86cd799439071",
        "GET /api/admin/players/507f1f77bcf86cd799439071/games",
        "GET /api/admin/players/507f1f77bcf86cd799439071/chest-openings",
        "GET /api/admin/players/507f1f77bcf86cd799439071/sales",
        "GET /api/admin/players/507f1f77bcf86cd799439071/trades",
        "GET /api/admin/players/507f1f77bcf86cd799439071/audit",
        "POST /api/admin/players/507f1f77bcf86cd799439071/coins",
        "POST /api/admin/players/507f1f77bcf86cd799439071/items",
        "POST /api/admin/players/507f1f77bcf86cd799439071/items/i1/revoke",
        "POST /api/admin/players/507f1f77bcf86cd799439071/progress",
        "POST /api/admin/players/507f1f77bcf86cd799439071/avatar/remove",
        "POST /api/admin/players/507f1f77bcf86cd799439071/avatar/approve",
        "POST /api/admin/players/507f1f77bcf86cd799439071/force-logout",
        "GET /api/admin/players/avatars",
        "GET /api/admin/economy/overview",
        "GET /api/admin/economy/dashboard",
        "GET /api/admin/economy/listings",
        "POST /api/admin/economy/listings/l1/remove",
        "GET /api/admin/economy/orders",
        "POST /api/admin/economy/orders/o1/cancel",
        "GET /api/admin/economy/sales",
        "GET /api/admin/economy/sales/export",
        "GET /api/admin/economy/trades",
        "GET /api/admin/economy/anomalies",
        "GET /api/admin/economy/stuck",
        "POST /api/admin/economy/recover",
        "GET /api/admin/rooms",
        "POST /api/admin/rooms/r1/close",
        "GET /api/admin/reviews",
        "POST /api/admin/reviews/r1/hide",
        "POST /api/admin/reviews/r1/unhide",
        "DELETE /api/admin/reviews/r1",
    ];

    private static HttpRequestMessage Request(string route, string? token, object? body = null)
    {
        var parts = route.Split(' ');
        var request = new HttpRequestMessage(new HttpMethod(parts[0]), parts[1]);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        else if (parts[0] != "GET") request.Content = JsonContent.Create(new { });
        return request;
    }

    [Fact]
    public async Task EveryAdminRoute_RefusesAPlayerAndAnonymous()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var player = await host.RegisterAsync(client, "Người chơi");

        foreach (var route in AdminRoutes)
        {
            var anonymous = await client.SendAsync(Request(route, null));
            Assert.True(anonymous.StatusCode == HttpStatusCode.Unauthorized, $"{route}: anonymous got {anonymous.StatusCode}");
            var forbidden = await client.SendAsync(Request(route, player.Token));
            Assert.True(forbidden.StatusCode == HttpStatusCode.Forbidden, $"{route}: player got {forbidden.StatusCode}");
        }
    }

    [Fact]
    public async Task EveryAdminRoute_Exists_ForAnAdmin()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var admin = await host.RegisterAsync(client, "Yến", UserRole.Admin);

        foreach (var route in AdminRoutes)
        {
            var response = await client.SendAsync(Request(route, admin.Token));
            // Not a routing miss and not a crash. A made-up id may answer 404 with the API's own envelope, a missing reason 400.
            Assert.True((int)response.StatusCode < 500, $"{route}: {response.StatusCode}");
            var isRoutingMiss = response.StatusCode == HttpStatusCode.NotFound
                && (await response.Content.ReadAsStringAsync()).Length == 0;
            Assert.False(isRoutingMiss, $"{route} has no endpoint.");
        }
    }

    [Fact]
    public async Task AForcedLogout_MakesTheOldTokenAnswer401_AndTheRefreshTokenUseless()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var admin = await host.RegisterAsync(client, "Yến", UserRole.Admin);
        var player = await host.RegisterAsync(client, "An");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Request("GET /api/market/me", player.Token))).StatusCode);

        var forced = await client.SendAsync(Request($"POST /api/admin/players/{player.UserId}/force-logout", admin.Token, new { reason = "Tài khoản bị lộ" }));
        Assert.Equal(HttpStatusCode.OK, forced.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Request("GET /api/market/me", player.Token))).StatusCode);
        var refreshed = await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = player.RefreshToken });
        Assert.False(refreshed.IsSuccessStatusCode, $"The refresh token still works: {refreshed.StatusCode}");
    }

    [Fact]
    public async Task AdminAnswers_NeverContainASecret()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var admin = await host.RegisterAsync(client, "Yến", UserRole.Admin);
        var player = await host.RegisterAsync(client, "An");
        var stored = await host.Db.Users.Find(u => u.Id == player.UserId).FirstAsync();
        Assert.False(string.IsNullOrEmpty(stored.PasswordHash));
        Assert.False(string.IsNullOrEmpty(stored.RefreshTokenHash));

        await client.SendAsync(Request($"POST /api/admin/players/{player.UserId}/force-logout", admin.Token, new { reason = "Tài khoản bị lộ" }));
        foreach (var route in new[] { "GET /api/admin/players?pageSize=50", $"GET /api/admin/players/{player.UserId}", $"GET /api/admin/players/{player.UserId}/audit", "GET /api/admin/audit" })
        {
            var text = await (await client.SendAsync(Request(route, admin.Token))).Content.ReadAsStringAsync();
            Assert.DoesNotContain(stored.PasswordHash, text);
            Assert.DoesNotContain(stored.RefreshTokenHash!, text);
            Assert.DoesNotContain("passwordHash", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("refreshToken", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("verificationToken", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task TheOldLockAndRoleRoutes_NowLeaveAnAudit_WithTheirReason()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var admin = await host.RegisterAsync(client, "Yến", UserRole.Admin);
        var player = await host.RegisterAsync(client, "An");

        Assert.True((await client.SendAsync(Request($"PATCH /api/admin/users/{player.UserId}/lock?reason=Gian%20l%E1%BA%ADn", admin.Token))).IsSuccessStatusCode);
        Assert.True((await client.SendAsync(Request($"PATCH /api/admin/users/{player.UserId}/unlock", admin.Token))).IsSuccessStatusCode);
        Assert.True((await client.SendAsync(Request($"PATCH /api/admin/users/{player.UserId}/role?reason=Th%E1%BB%AD%20nghi%E1%BB%87m", admin.Token, new { role = "VIP" }))).IsSuccessStatusCode);

        var log = await (await client.SendAsync(Request($"GET /api/admin/audit?targetType=user&targetId={player.UserId}", admin.Token))).Content.ReadFromJsonAsync<JsonElement>();
        var items = log.GetProperty("data").GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(new[] { "player.role", "player.unlock", "player.lock" }, items.Select(item => item.GetProperty("action").GetString()));
        Assert.Equal("Gian lận", items[2].GetProperty("reason").GetString());
        Assert.Equal("ACTIVE", items[2].GetProperty("before").GetProperty("status").GetString());
        Assert.Equal("LOCKED", items[2].GetProperty("after").GetProperty("status").GetString());
        Assert.Equal("VIP", items[0].GetProperty("after").GetProperty("role").GetString());
    }

    [Fact]
    public async Task TheCsvExport_DownloadsAsAFile()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var admin = await host.RegisterAsync(client, "Yến", UserRole.Admin);

        var response = await client.SendAsync(Request("GET /api/admin/economy/sales/export", admin.Token));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.StartsWith("text/csv", response.Content.Headers.ContentType!.ToString());
        Assert.Contains("attachment", response.Content.Headers.ContentDisposition!.ToString());
    }

    private sealed record Session(string UserId, string Token, string RefreshToken);

    [Fact]
    public async Task AdminLogin_SignsInAnAdmin()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(UserRole.Admin);

        var response = await client.PostAsJsonAsync("/api/auth/admin/login", new { email, password = AdminHost.Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal(UserRole.Admin, data.GetProperty("user").GetProperty("role").GetString());
        var players = await client.SendAsync(Request("GET /api/admin/players", data.GetProperty("token").GetString()));
        Assert.Equal(HttpStatusCode.OK, players.StatusCode);
    }

    [Theory]
    [InlineData(UserRole.Player)]
    [InlineData(UserRole.Vip)]
    public async Task AdminLogin_RefusesOtherRoles_AndLeavesTheirSessionAlone(string role)
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(role);
        var session = await host.SignInAsync(client, email);

        var refused = await client.PostAsJsonAsync("/api/auth/admin/login", new { email, password = AdminHost.Password });

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.DoesNotContain("token", await refused.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        // Each account holds one refresh token, so issuing one here would have ended the session they are playing in.
        var refreshed = await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = session.RefreshToken });
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
    }

    [Fact]
    public async Task AdminLogin_WithoutThePassword_SaysTheSameThingForEveryAccount()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var attempts = new[]
        {
            await host.InsertUserAsync(UserRole.Admin),
            await host.InsertUserAsync(UserRole.Player),
            $"{Guid.NewGuid():N}@tests.invalid",
        };

        var answers = new List<string>();
        foreach (var email in attempts)
        {
            var response = await client.PostAsJsonAsync("/api/auth/admin/login", new { email, password = "Wrong-password-123!" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            answers.Add(await response.Content.ReadAsStringAsync());
        }

        Assert.Single(answers.Distinct());
    }

    [Fact]
    public async Task AdminLogin_RefusesAGoogleOnlyAdmin_WithoutAnError()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(UserRole.Admin, passwordHash: string.Empty);

        var response = await client.PostAsJsonAsync("/api/auth/admin/login", new { email, password = AdminHost.Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AdminLogin_RefusesALockedAdmin()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(UserRole.Admin, UserStatus.Locked);

        var response = await client.PostAsJsonAsync("/api/auth/admin/login", new { email, password = AdminHost.Password });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AdminLogin_SharesTheLimitOfThePlayerSignIn()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var wrong = new { email = "nobody@tests.invalid", password = "Wrong-password-123!" };

        // Five a minute in all, so a second door does not give anyone twice the guesses.
        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/login", wrong)).StatusCode);
        for (var i = 0; i < 2; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/admin/login", wrong)).StatusCode);

        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/auth/admin/login", wrong)).StatusCode);
    }

    private sealed class AdminHost : WebApplicationFactory<Program>
    {
        private readonly string _connectionString =
            Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";
        private readonly string _databaseName = $"sirlocked_it_{Guid.NewGuid():N}";
        private MongoClient? _client;

        public IMongoDatabase Raw => (_client ??= new MongoClient(_connectionString)).GetDatabase(_databaseName);
        public SirLocked.Api.DataAccess.MongoDbContext Db => Services.GetRequiredService<SirLocked.Api.DataAccess.MongoDbContext>();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName });
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["MongoDb:ConnectionString"] = _connectionString,
                ["MongoDb:DatabaseName"] = _databaseName,
                ["MOCK_AI_RESPONSES"] = "true",
                ["SKIP_ASSET_GENERATION"] = "true",
                ["CaseCatalog:SeedPixelOnStartup"] = "false",
                ["Jwt:Secret"] = "integration-test-secret-with-at-least-32-characters",
                ["Google:ClientId"] = "integration-test-google-client",
                ["Google:ClientSecret"] = "integration-test-google-secret",
                ["Auth:AutoVerifyRegistrations"] = "true",
                ["Email:SmtpHost"] = "127.0.0.1",
                ["Email:SmtpPort"] = "1",
                ["Email:SenderEmail"] = "integration@example.invalid",
                ["Email:Username"] = "integration-only",
                ["Email:Password"] = "unused-integration-placeholder",
                ["Email:FrontendUrl"] = "http://127.0.0.1:5173",
            }));
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHostedService>();
                services.AddDataProtection().UseEphemeralDataProtectionProvider();
                // Program reads the Google settings before this configuration applies, and empty ones answer 500 to every request.
                services.PostConfigure<GoogleOptions>(GoogleDefaults.AuthenticationScheme, options =>
                {
                    options.ClientId = "integration-test-google-client";
                    options.ClientSecret = "integration-test-google-secret";
                });
            });
        }

        public const string Password = "Test-password-123!";

        public async Task<Session> RegisterAsync(HttpClient client, string name, string role = UserRole.Player) =>
            await SignInAsync(client, await InsertUserAsync(role, name: name));

        /// <summary>Registering would send a verification mail. Everything from the sign-in on is the real thing.</summary>
        public async Task<string> InsertUserAsync(string role, string status = UserStatus.Active, string name = "Thám tử", string? passwordHash = null)
        {
            var email = $"{Guid.NewGuid():N}@tests.invalid";
            await Db.Users.InsertOneAsync(new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = name,
                Email = email,
                PasswordHash = passwordHash ?? BCrypt.Net.BCrypt.HashPassword(Password),
                Role = role,
                Status = status,
                IsEmailVerified = true,
            });
            return email;
        }

        public async Task<Session> SignInAsync(HttpClient client, string email)
        {
            var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
            Xunit.Assert.True(login.IsSuccessStatusCode, $"Sign-in failed: {(int)login.StatusCode} {await login.Content.ReadAsStringAsync()}");
            var data = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            return new Session(data.GetProperty("user").GetProperty("userId").GetString()!, data.GetProperty("token").GetString()!, data.GetProperty("refreshToken").GetString()!);
        }

        public override async ValueTask DisposeAsync()
        {
            if (_client is not null)
            {
                await _client.DropDatabaseAsync(_databaseName);
                _client.Dispose();
            }
            else
            {
                using var client = new MongoClient(_connectionString);
                await client.DropDatabaseAsync(_databaseName);
            }
            await base.DisposeAsync();
        }
    }
}
