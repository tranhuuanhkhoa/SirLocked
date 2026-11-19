using System.Collections.Concurrent;
using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Payments;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Models.Payments;
using SirLocked.Api.Services.Market;
using SirLocked.Api.Services.Payments;
using SirLocked.Api.WebAPI.Controllers;
using SirLocked.Api.WebAPI.Middlewares;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class PaymentMongoFactAttribute : FactAttribute
{
    public PaymentMongoFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT") != "true")
            Skip = "Set SIRLOCKED_RUN_MONGO_IT=true and SIRLOCKED_TEST_MONGO to a loopback MongoDB.";
    }
}

public sealed class MongoPaymentTests
{
    [PaymentMongoFact]
    public async Task HttpEndpoints_EnforceAuthentication_ValidateInput_AndAcceptSignedAnonymousWebhook()
    {
        await using var env = await Env.CreateAsync();
        using var server = new TestServer(new WebHostBuilder().ConfigureServices(services =>
        {
            services.AddSingleton(env.Service);
            services.AddRouting();
            services.AddControllers().AddApplicationPart(typeof(PaymentsController).Assembly);
            services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, TestAuth>("test", _ => { });
            services.AddAuthorization();
            services.AddRateLimiter(options => options.AddPolicy("payments", _ => RateLimitPartition.GetNoLimiter("test")));
        }).Configure(app =>
        {
            app.UseMiddleware<ErrorHandlingMiddleware>();
            app.UseRouting(); app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
            app.UseEndpoints(endpoints => endpoints.MapControllers());
        }));
        using var client = server.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/payments/orders")).StatusCode);
        client.DefaultRequestHeaders.Add("X-Test-User", "buyer");
        var packages = await client.GetFromJsonAsync<JsonElement>("/api/payments/packages");
        Assert.True(packages.GetProperty("data").GetProperty("enabled").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/payments/orders", new { packageId = "starter", requestId = "bad" })).StatusCode);
        var created = await client.PostAsJsonAsync("/api/payments/orders", new { packageId = "starter", requestId = "http-request-123", amount = 1, coins = 999999 });
        created.EnsureSuccessStatusCode();
        var json = await created.Content.ReadFromJsonAsync<JsonElement>();
        var dto = json.GetProperty("data");
        Assert.Equal(10000, dto.GetProperty("amount").GetInt32());
        Assert.Equal(1000, dto.GetProperty("coins").GetInt32());
        var code = dto.GetProperty("orderCode").GetInt64();
        client.DefaultRequestHeaders.Remove("X-Test-User");
        client.DefaultRequestHeaders.Add("X-Test-User", "other");
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/payments/orders/{code}")).StatusCode);
        client.DefaultRequestHeaders.Remove("X-Test-User");
        var order = (await env.Service.HistoryAsync("buyer", default)).Single();
        env.Provider.Links[code] = env.Provider.Links[code] with { Status = "PAID", AmountPaid = order.Amount };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/payments/payos/webhook", env.Webhook(order) with { Signature = "forged" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/payments/payos/webhook", env.Webhook(order))).StatusCode);
        Assert.Equal(MarketRules.StarterCoins + order.Coins, (await env.Market.GetWalletAsync("buyer")).Balance);
    }

    [PaymentMongoFact]
    public async Task ConcurrentWebhookRetries_CreditOnce_EvenAfterGameOperationWindowIsCleared()
    {
        await using var env = await Env.CreateAsync();
        var order = await env.CreateOrder();
        env.Provider.Links[order.OrderCode] = env.Provider.Links[order.OrderCode] with { Status = "PAID", AmountPaid = order.Amount };
        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => env.Service.HandleWebhookAsync(env.Webhook(order), default)));
        Assert.Equal(MarketRules.StarterCoins + order.Coins, (await env.Market.GetWalletAsync("buyer")).Balance);
        Assert.Equal("CREDITED", (await env.Service.GetAsync("buyer", order.OrderCode, default)).Status);
        // Simulate a crash after wallet credit but before marking the order credited, long after game ops were pruned.
        await env.Store.Accounts.UpdateOneAsync(a => a.Id == "buyer", Builders<MarketAccount>.Update.Set(a => a.Ops, new List<string>()));
        await env.Service.Orders.UpdateOneAsync(o => o.OrderCode == order.OrderCode,
            Builders<PaymentOrder>.Update.Set(o => o.Status, "PAID").Set(o => o.CreditedAt, null));
        await env.Service.RecoverAsync(default);
        Assert.Equal(MarketRules.StarterCoins + order.Coins, (await env.Market.GetWalletAsync("buyer")).Balance);
        Assert.Equal("CREDITED", (await env.Service.GetAsync("buyer", order.OrderCode, default)).Status);
    }

    [PaymentMongoFact]
    public async Task ConcurrentCreate_UsesOneOrder_AndRejectsRequestKeyReuseForDifferentPackage()
    {
        await using var env = await Env.CreateAsync();
        var request = new CreateTopUpRequest("starter", "same-request-123");
        var orders = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => env.Service.CreateAsync("buyer", request, default)));
        Assert.Single(orders.Select(o => o.OrderCode).Distinct());
        Assert.Equal(1, await env.Service.Orders.CountDocumentsAsync(FilterDefinition<PaymentOrder>.Empty));
        Assert.Equal(10000, orders[0].Amount);
        Assert.Equal(1000, orders[0].Coins);
        var error = await Assert.ThrowsAsync<ApiException>(() => env.Service.CreateAsync("buyer", request with { PackageId = "master" }, default));
        Assert.Equal(409, error.StatusCode);
    }

    [PaymentMongoFact]
    public async Task CreateResponseLost_RetryRecoversExistingProviderOrder()
    {
        await using var env = await Env.CreateAsync();
        env.Provider.LoseCreateResponse = true;
        var request = new CreateTopUpRequest("starter", "lost-response-123");
        var first = await env.Service.CreateAsync("buyer", request, default);
        Assert.Equal("CREATING", first.Status);
        var second = await env.Service.CreateAsync("buyer", request, default);
        Assert.Equal(first.OrderCode, second.OrderCode);
        Assert.Equal("PENDING", second.Status);
        Assert.Equal(1, env.Provider.Creates);
    }

    [PaymentMongoFact]
    public async Task WrongSignatureOrProviderAmount_CannotCredit_PartialPaymentWaits()
    {
        await using var env = await Env.CreateAsync();
        var order = await env.CreateOrder();
        var webhook = env.Webhook(order);
        var invalid = await Assert.ThrowsAsync<ApiException>(() => env.Service.HandleWebhookAsync(webhook with { Signature = new string('0', 64) }, default));
        Assert.Equal(400, invalid.StatusCode);
        var good = env.Provider.Links[order.OrderCode];
        env.Provider.Links[order.OrderCode] = good with { Amount = 2000, AmountPaid = 2000, Status = "PAID" };
        await Assert.ThrowsAsync<ApiException>(() => env.Service.HandleWebhookAsync(webhook, default));
        env.Provider.Links[order.OrderCode] = good with { AmountPaid = 2000 };
        await env.Service.HandleWebhookAsync(webhook, default);
        Assert.Equal(MarketRules.StarterCoins, (await env.Market.GetWalletAsync("buyer")).Balance);
        env.Provider.Links[order.OrderCode] = good with { AmountPaid = 10001, Status = "PAID" };
        await env.Service.HandleWebhookAsync(webhook, default);
        Assert.Equal("REVIEW", (await env.Service.HistoryAsync("buyer", default)).Single().Status);
        Assert.Equal(MarketRules.StarterCoins, (await env.Market.GetWalletAsync("buyer")).Balance);
    }

    [PaymentMongoFact]
    public async Task CancelRace_DoesNotDowngradePaidOrder_AndOtherUsersCannotReadOrCancel()
    {
        await using var env = await Env.CreateAsync();
        var order = await env.CreateOrder();
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => env.Service.GetAsync("other", order.OrderCode, default))).StatusCode);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => env.Service.CancelAsync("other", order.OrderCode, default))).StatusCode);
        Assert.Empty(await env.Service.HistoryAsync("other", default));
        // Payment won the race at payOS; cancellation returns the provider's already-paid state.
        env.Provider.Links[order.OrderCode] = env.Provider.Links[order.OrderCode] with { Status = "PAID", AmountPaid = order.Amount };
        await env.Service.CancelAsync("buyer", order.OrderCode, default);
        await env.Service.HandleWebhookAsync(env.Webhook(order), default);
        Assert.Equal("CREDITED", (await env.Service.GetAsync("buyer", order.OrderCode, default)).Status);
        Assert.Equal(MarketRules.StarterCoins + order.Coins, (await env.Market.GetWalletAsync("buyer")).Balance);
    }

    [PaymentMongoFact]
    public async Task SignedUnknownWebhook_IsAcknowledgedWithoutCreatingWalletOrOrder()
    {
        await using var env = await Env.CreateAsync();
        await env.Service.HandleWebhookAsync(env.Webhook(new PaymentOrderDto(123, 3000, 0, "PENDING", "", "", "", "", "", "", DateTime.UtcNow, DateTime.UtcNow, null)), default);
        Assert.Equal(0, await env.Store.Accounts.CountDocumentsAsync(FilterDefinition<MarketAccount>.Empty));
        Assert.Equal(0, await env.Service.Orders.CountDocumentsAsync(FilterDefinition<PaymentOrder>.Empty));
    }

    [PaymentMongoFact]
    public async Task RecoveryFindsPaymentWhenWebhookIsLost_AndDisabledModeRejectsNewOrders()
    {
        await using var env = await Env.CreateAsync();
        var order = await env.CreateOrder();
        env.Provider.Links[order.OrderCode] = env.Provider.Links[order.OrderCode] with { Status = "PAID", AmountPaid = order.Amount };
        await env.Service.RecoverAsync(default);
        Assert.Equal(MarketRules.StarterCoins + order.Coins, (await env.Market.GetWalletAsync("buyer")).Balance);
        env.Settings.Enabled = false;
        Assert.Equal(503, (await Assert.ThrowsAsync<ApiException>(() => env.CreateOrder())).StatusCode);
    }

    private sealed class FakeProvider : IPayOsClient
    {
        public ConcurrentDictionary<long, PayOsLink> Links { get; } = new();
        public bool LoseCreateResponse;
        public int Creates;
        public Task<PayOsLink> CreateAsync(PaymentOrder order, CancellationToken ct)
        {
            Interlocked.Increment(ref Creates);
            var link = Links.GetOrAdd(order.OrderCode, _ => new(order.OrderCode, order.Amount, 0,
                "124c33293c934a85be5b7f8761a27a07000", "PENDING", "https://pay.payos.vn/web/124c33293c934a85be5b7f8761a27a07000", "qr"));
            if (LoseCreateResponse) { LoseCreateResponse = false; throw new HttpRequestException("Simulated lost response"); }
            return Task.FromResult(link);
        }
        public Task<PayOsLink?> GetAsync(long code, CancellationToken ct) => Task.FromResult(Links.GetValueOrDefault(code));
        public Task<PayOsLink> CancelAsync(long code, CancellationToken ct) => Task.FromResult(Links.AddOrUpdate(code,
            _ => throw new HttpRequestException(), (_, old) => old.Status == "PAID" ? old : old with { Status = "CANCELLED" }));
    }

    private sealed class TestAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var user = Request.Headers["X-Test-User"].ToString();
            return Task.FromResult(string.IsNullOrEmpty(user) ? AuthenticateResult.NoResult() : AuthenticateResult.Success(
                new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user)], "test")), "test")));
        }
    }

    private sealed class Env : IAsyncDisposable
    {
        public PayOsSettings Settings { get; } = new() { Enabled = true, ChecksumKey = "test-key", ClientId = "test", ApiKey = "test" };
        public FakeProvider Provider { get; } = new();
        public MarketStore Store { get; }
        public MarketService Market { get; }
        public PaymentService Service { get; }
        private readonly MongoClient _client;
        private readonly string _database;
        private Env(string connection)
        {
            _database = "sirlocked_it_payments_" + Guid.NewGuid().ToString("N");
            _client = new MongoClient(connection);
            Store = new MarketStore(new MongoDbContext(Options.Create(new MongoDbSettings { ConnectionString = connection, DatabaseName = _database })));
            Market = new MarketService(Store, NullLogger<MarketService>.Instance);
            Service = new PaymentService(Store, Market, Provider, Options.Create(Settings), NullLogger<PaymentService>.Instance);
        }
        public static async Task<Env> CreateAsync()
        {
            var connection = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017";
            if (!new MongoUrl(connection).Servers.All(s => s.Host is "127.0.0.1" or "localhost" or "::1"))
                throw new InvalidOperationException("Payment tests require a loopback MongoDB.");
            var env = new Env(connection);
            await env.Store.Context.PingAsync();
            return env;
        }
        public Task<PaymentOrderDto> CreateOrder() => Service.CreateAsync("buyer", new("starter", Guid.NewGuid().ToString()), default);
        public PayOsWebhook Webhook(PaymentOrderDto order)
        {
            var data = JsonSerializer.SerializeToElement(new { orderCode = order.OrderCode, amount = order.Amount,
                currency = "VND", code = "00", paymentLinkId = "124c33293c934a85be5b7f8761a27a07000", reference = "transfer-123" });
            return new("00", true, data, PayOsSignature.Sign(data, Settings.ChecksumKey));
        }
        public ValueTask DisposeAsync() => new(_client.DropDatabaseAsync(_database));
    }
}
