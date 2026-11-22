using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
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
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Security;
using SirLocked.Api.WebAPI;
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

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Request("POST /api/auth/admin/step-up", admin.Token,
            new { password = AdminHost.Password }))).StatusCode);
        var forced = await client.SendAsync(Request($"POST /api/admin/players/{player.UserId}/force-logout", admin.Token, new { reason = "Tài khoản bị lộ" }));
        Assert.Equal(HttpStatusCode.OK, forced.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Request("GET /api/market/me", player.Token))).StatusCode);
        using var bodyClient = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var refreshed = await bodyClient.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = player.RefreshToken });
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

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Request("POST /api/auth/admin/step-up", admin.Token,
            new { password = AdminHost.Password }))).StatusCode);
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

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Request("POST /api/auth/admin/step-up", admin.Token,
            new { password = AdminHost.Password }))).StatusCode);
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

    private static string RefreshCookieValue(HttpResponseMessage response)
    {
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        var pair = cookie.Split(';', 2)[0];
        return pair[(pair.IndexOf('=') + 1)..];
    }

    private static string RefreshTokenValue(HttpResponseMessage response) =>
        Uri.UnescapeDataString(RefreshCookieValue(response));

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

    [Fact]
    public async Task AuthRefresh_UsesHttpOnlyCookieWithCsrfHeaderAndSupportsBodyFallback()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        using var client = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var email = await host.InsertUserAsync(UserRole.Player);
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = AdminHost.Password });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var loginJson = await login.Content.ReadAsStringAsync();
        Assert.DoesNotContain("\"refreshToken\":", loginJson, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("refreshTokenExpiry", loginJson, StringComparison.OrdinalIgnoreCase);
        var originalCookie = RefreshCookieValue(login);
        var setCookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.Contains("HttpOnly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("SameSite=Strict", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Path=/api/auth", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Expires=", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Secure", setCookie, StringComparison.OrdinalIgnoreCase);

        using var emptyRefresh = await client.PostAsync("/api/auth/refresh", content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, emptyRefresh.StatusCode);

        using var missingHeader = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        missingHeader.Headers.Add("Cookie", $"{AuthCookies.RefreshCookieName}={originalCookie}");
        using var blocked = await client.SendAsync(missingHeader);
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal("CSRF_HEADER_MISSING",
            (await blocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").GetProperty("code").GetString());

        using var bodyRefresh = await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = RefreshTokenValue(login) });
        Assert.Equal(HttpStatusCode.OK, bodyRefresh.StatusCode);
        Assert.DoesNotContain("\"refreshToken\":", await bodyRefresh.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        var rotatedCookie = RefreshCookieValue(bodyRefresh);

        using var cookieRefresh = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        cookieRefresh.Headers.Add("Cookie", $"{AuthCookies.RefreshCookieName}={rotatedCookie}");
        cookieRefresh.Headers.Add("X-SirLocked-Client", "web");
        using var refreshed = await client.SendAsync(cookieRefresh);
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        var refreshedSetCookie = Assert.Single(refreshed.Headers.GetValues("Set-Cookie"));
        Assert.Contains("HttpOnly", refreshedSetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("SameSite=Strict", refreshedSetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Path=/api/auth", refreshedSetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Expires=", refreshedSetCookie, StringComparison.OrdinalIgnoreCase);
        var nextCookie = RefreshCookieValue(refreshed);

        using var reusedCookie = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        reusedCookie.Headers.Add("Cookie", $"{AuthCookies.RefreshCookieName}={rotatedCookie}");
        reusedCookie.Headers.Add("X-SirLocked-Client", "web");
        using var replay = await client.SendAsync(reusedCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        Assert.NotEqual(rotatedCookie, nextCookie);
    }

    [Fact]
    public async Task Logout_RevokesAValidRefreshCookieWithoutAnAccessTokenAndClearsIt()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        using var client = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var email = await host.InsertUserAsync(UserRole.Player);
        var session = await host.SignInAsync(client, email);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        request.Headers.Add("Cookie", $"{AuthCookies.RefreshCookieName}={Uri.EscapeDataString(session.RefreshToken)}");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var clearedCookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.Contains("sirlocked_refresh=", clearedCookie, StringComparison.Ordinal);
        Assert.Contains("Path=/api/auth", clearedCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Expires=", clearedCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("HttpOnly", clearedCookie, StringComparison.OrdinalIgnoreCase);
        var saved = await host.Db.Users.Find(user => user.Email == email).FirstAsync();
        Assert.Null(saved.RefreshTokenHash);
        Assert.Null(saved.RefreshTokenExpiry);
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
        using var bodyClient = host.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var refreshed = await bodyClient.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = session.RefreshToken });
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

    [Theory]
    [InlineData("/api/auth/login")]
    [InlineData("/api/auth/admin/login")]
    public async Task AdminPasswordLoginRequiresTwoFactorBeforeIssuingTokensOrCookies(string route)
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(UserRole.Admin);
        var user = await host.Db.Users.Find(candidate => candidate.Email == email).FirstAsync();
        var secret = Totp.EncodeBase32(Encoding.ASCII.GetBytes("12345678901234567890"));
        var protector = host.Services.GetRequiredService<IDataProtectionProvider>()
            .CreateProtector("SirLocked.AdminTotp.v1");
        await host.Db.Users.UpdateOneAsync(candidate => candidate.Id == user.Id,
            Builders<User>.Update
                .Set(candidate => candidate.TwoFactorEnabled, true)
                .Set(candidate => candidate.TwoFactorSecretProtected, protector.Protect(secret)));

        using var missing = await client.PostAsJsonAsync(route, new { email, password = AdminHost.Password });
        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        var missingBody = await missing.Content.ReadAsStringAsync();
        Assert.Contains("TWO_FACTOR_REQUIRED", missingBody, StringComparison.Ordinal);
        Assert.DoesNotContain("token", missingBody, StringComparison.OrdinalIgnoreCase);
        AssertNoRefreshCookie(missing);

        var step = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / Totp.StepSeconds;
        var code = Totp.ComputeCode(Encoding.ASCII.GetBytes("12345678901234567890"), step);
        using var accepted = await client.PostAsJsonAsync(route, new { email, password = AdminHost.Password, twoFactorCode = code });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Contains("sirlocked_refresh=", string.Join(';', accepted.Headers.GetValues("Set-Cookie")), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AdminRecoveryCodeIsAcceptedOnceAndGoogleLoginRequiresPasswordAndCode()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(UserRole.Admin);
        var user = await host.Db.Users.Find(candidate => candidate.Email == email).FirstAsync();
        const string recoveryCode = "ABCD1234EF";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(recoveryCode)));
        var protector = host.Services.GetRequiredService<IDataProtectionProvider>()
            .CreateProtector("SirLocked.AdminTotp.v1");
        await host.Db.Users.UpdateOneAsync(candidate => candidate.Id == user.Id,
            Builders<User>.Update
                .Set(candidate => candidate.TwoFactorEnabled, true)
                .Set(candidate => candidate.TwoFactorSecretProtected, protector.Protect(Totp.GenerateSecret()))
                .Set(candidate => candidate.TwoFactorRecoveryCodeHashes, new List<string> { hash }));

        using var accepted = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = AdminHost.Password, twoFactorCode = recoveryCode });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var saved = await host.Db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        Assert.Empty(saved.TwoFactorRecoveryCodeHashes);

        using var replay = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = AdminHost.Password, twoFactorCode = recoveryCode });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        Assert.Contains("TWO_FACTOR_INVALID", await replay.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var googleError = await Assert.ThrowsAsync<ApiException>(() =>
            host.Services.GetRequiredService<IAuthService>().GoogleLoginAsync(email, user.FullName));
        Assert.Equal("ADMIN_2FA_REQUIRED", Assert.IsType<ApiErrorDetails>(googleError.Errors).Code);
    }

    [Fact]
    public async Task RequireTwoFactorGateLeavesAuthSetupReachableUntilAdminEnablesIt()
    {
        if (!Enabled) return;
        await using var host = new AdminHost(requireTwoFactor: true);
        var client = host.CreateClient();
        var email = await host.InsertUserAsync(UserRole.Admin);
        var session = await host.SignInAsync(client, email);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.Token);

        using var blocked = await client.GetAsync("/api/admin/dashboard");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Contains("TWO_FACTOR_SETUP_REQUIRED", await blocked.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        foreach (var path in new[] { "/api/chests/admin/grant", "/api/market/admin/grant" })
        {
            using var blockedGrant = await client.PostAsJsonAsync(path, new { });
            Assert.Equal(HttpStatusCode.Forbidden, blockedGrant.StatusCode);
            Assert.Contains("TWO_FACTOR_SETUP_REQUIRED", await blockedGrant.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
        using var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var setup = await client.PostAsJsonAsync("/api/auth/admin/2fa/setup", new { });
        Assert.Equal(HttpStatusCode.OK, setup.StatusCode);
        var setupJson = await setup.Content.ReadFromJsonAsync<JsonElement>();
        var secret = setupJson.GetProperty("data").GetProperty("secret").GetString()!;
        var code = Totp.ComputeCode(Totp.DecodeBase32(secret), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / Totp.StepSeconds);
        using var enabled = await client.PostAsJsonAsync("/api/auth/admin/2fa/enable", new { code });
        Assert.Equal(HttpStatusCode.OK, enabled.StatusCode);
        using var allowed = await client.GetAsync("/api/admin/dashboard");
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task StepUpExpiresAndSensitiveAdminActionsRequireRenewal()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var client = host.CreateClient();
        var admin = await host.RegisterAsync(client, "Admin", UserRole.Admin);
        var player = await host.RegisterAsync(client, "Player", UserRole.Player);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", admin.Token);

        using var denied = await client.PostAsJsonAsync($"/api/admin/players/{player.UserId}/force-logout", new { reason = "test" });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Contains("STEP_UP_REQUIRED", await denied.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        using var stepUp = await client.PostAsJsonAsync("/api/auth/admin/step-up", new { password = AdminHost.Password });
        Assert.Equal(HttpStatusCode.OK, stepUp.StatusCode);
        using var allowed = await client.PostAsJsonAsync($"/api/admin/players/{player.UserId}/force-logout", new { reason = "test" });
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);

        await host.Db.Users.UpdateOneAsync(user => user.Id == admin.UserId,
            Builders<User>.Update.Set(user => user.AdminStepUpUntil, DateTime.UtcNow.AddMinutes(-1)));
        using var expired = await client.PostAsJsonAsync($"/api/admin/players/{player.UserId}/force-logout", new { reason = "test" });
        Assert.Equal(HttpStatusCode.Forbidden, expired.StatusCode);
        Assert.Contains("STEP_UP_REQUIRED", await expired.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AdminPermissionPoliciesMatchTheRoleMatrixAndDashboardRemainsAvailable()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var routes = new[]
        {
            (Permission: AdminRoles.ContentPermission, Route: "/api/admin/cases"),
            (Permission: AdminRoles.EconomyPermission, Route: "/api/admin/economy/overview"),
            (Permission: AdminRoles.PlayersPermission, Route: "/api/admin/players"),
            (Permission: AdminRoles.ModerationPermission, Route: "/api/admin/rooms"),
            (Permission: AdminRoles.AuditPermission, Route: "/api/admin/audit"),
        };

        foreach (var role in new[] { AdminRoles.SuperAdmin, AdminRoles.Content, AdminRoles.Finance, AdminRoles.Support, AdminRoles.Moderator })
        {
            var client = host.CreateClient();
            var email = await host.InsertUserAsync(UserRole.Admin, adminRole: role == AdminRoles.SuperAdmin ? null : role);
            var session = await host.SignInAsync(client, email);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.Token);
            using var dashboard = await client.GetAsync("/api/admin/dashboard");
            Assert.Equal(HttpStatusCode.OK, dashboard.StatusCode);

            foreach (var route in routes)
            {
                using var response = await client.GetAsync(route.Route);
                var allowed = AdminRoles.HasPermission(role, route.Permission);
                Assert.Equal(allowed ? HttpStatusCode.OK : HttpStatusCode.Forbidden, response.StatusCode);
            }
        }

    }

    [Fact]
    public async Task AdminRoleChangesGuardTheLastSuperAdminAndInvalidateOldAuthorizationVersions()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var caller = host.CreateClient();
        var callerEmail = await host.InsertUserAsync(UserRole.Admin);
        var callerSession = await host.SignInAsync(caller, callerEmail);
        caller.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", callerSession.Token);
        using var stepUp = await caller.PostAsJsonAsync("/api/auth/admin/step-up", new { password = AdminHost.Password });
        Assert.Equal(HttpStatusCode.OK, stepUp.StatusCode);

        using var lastSuper = await caller.PatchAsJsonAsync($"/api/admin/users/{callerSession.UserId}/admin-role",
            new { adminRole = AdminRoles.Content });
        Assert.Equal(HttpStatusCode.Conflict, lastSuper.StatusCode);
        Assert.Contains("LAST_SUPER_ADMIN", await lastSuper.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var targetEmail = await host.InsertUserAsync(UserRole.Admin);
        var targetClient = host.CreateClient();
        var target = await host.SignInAsync(targetClient, targetEmail);
        targetClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", target.Token);
        using var changed = await caller.PatchAsJsonAsync($"/api/admin/users/{target.UserId}/admin-role",
            new { adminRole = AdminRoles.Content });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var changedUser = (await changed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal(AdminRoles.Content, changedUser.GetProperty("adminRole").GetString());

        using var stale = await targetClient.GetAsync("/api/admin/dashboard");
        Assert.Equal(HttpStatusCode.Unauthorized, stale.StatusCode);
        targetClient.DefaultRequestHeaders.Authorization = null;
        var refreshed = await host.SignInAsync(targetClient, targetEmail);
        targetClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.Token);
        using var allowed = await targetClient.GetAsync("/api/admin/cases");
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        using var denied = await targetClient.GetAsync("/api/admin/economy/overview");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }

    [Fact]
    public async Task SetUserRolePromotionAndDemotionInvalidatePreviouslyIssuedTokens()
    {
        if (!Enabled) return;
        await using var host = new AdminHost();
        var admin = host.CreateClient();
        var adminEmail = await host.InsertUserAsync(UserRole.Admin);
        var adminSession = await host.SignInAsync(admin, adminEmail);
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminSession.Token);
        using var stepUp = await admin.PostAsJsonAsync("/api/auth/admin/step-up", new { password = AdminHost.Password });
        Assert.Equal(HttpStatusCode.OK, stepUp.StatusCode);

        var targetEmail = await host.InsertUserAsync(UserRole.Player);
        var targetClient = host.CreateClient();
        var playerSession = await host.SignInAsync(targetClient, targetEmail);
        targetClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", playerSession.Token);

        using var promoted = await admin.PatchAsJsonAsync($"/api/admin/users/{playerSession.UserId}/role",
            new { role = UserRole.Admin });
        Assert.Equal(HttpStatusCode.OK, promoted.StatusCode);
        using var stalePlayerToken = await targetClient.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, stalePlayerToken.StatusCode);

        targetClient.DefaultRequestHeaders.Authorization = null;
        var adminTargetSession = await host.SignInAsync(targetClient, targetEmail);
        targetClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminTargetSession.Token);
        using var demoted = await admin.PatchAsJsonAsync($"/api/admin/users/{playerSession.UserId}/role",
            new { role = UserRole.Player });
        Assert.Equal(HttpStatusCode.OK, demoted.StatusCode);
        using var staleAdminToken = await targetClient.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, staleAdminToken.StatusCode);
    }

    private static void AssertNoRefreshCookie(HttpResponseMessage response)
    {
        if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.DoesNotContain(cookies, cookie => cookie.StartsWith("sirlocked_refresh=", StringComparison.Ordinal));
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
        private readonly bool _requireTwoFactor;
        private readonly string _connectionString =
            Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";
        private readonly string _databaseName = $"sirlocked_it_{Guid.NewGuid():N}";
        private MongoClient? _client;

        public AdminHost(bool requireTwoFactor = false) => _requireTwoFactor = requireTwoFactor;

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
                ["AdminSecurity:RequireTwoFactor"] = _requireTwoFactor.ToString(),
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
        public async Task<string> InsertUserAsync(string role, string status = UserStatus.Active, string name = "Thám tử",
            string? passwordHash = null, string? adminRole = null)
        {
            var email = $"{Guid.NewGuid():N}@tests.invalid";
            await Db.Users.InsertOneAsync(new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = name,
                Email = email,
                PasswordHash = passwordHash ?? BCrypt.Net.BCrypt.HashPassword(Password),
                Role = role,
                AdminRole = adminRole,
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
            return new Session(data.GetProperty("user").GetProperty("userId").GetString()!, data.GetProperty("token").GetString()!, RefreshTokenValue(login));
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
