using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Payments;
using SirLocked.Api.Services.Payments;
using Xunit;

namespace SirLocked.Tests;

public sealed class PayOsTests
{
    private const string Key = "1a54716c8f0efb2744fb28b6e38b25da7f67a925d98bc1c18bd8faaecadd7675";
    private static JsonElement Sample() => JsonSerializer.SerializeToElement(new
    {
        orderCode = 123, amount = 3000, description = "VQRIO123", accountNumber = "12345678",
        reference = "TF230204212323", transactionDateTime = "2023-02-04 18:25:00", currency = "VND",
        paymentLinkId = "124c33293c43417ab7879e14c8d9eb18", code = "00", desc = "Thành công",
        counterAccountBankId = "", counterAccountBankName = "", counterAccountName = "", counterAccountNumber = "",
        virtualAccountName = "", virtualAccountNumber = ""
    });

    [Fact]
    public void Signature_MatchesOfficialPayOsVector_AndRejectsTampering()
    {
        const string signature = "412e915d2871504ed31be63c8f62a149a4410d34c4c42affc9006ef9917eaa03";
        Assert.True(PayOsSignature.Verify(Sample(), signature, Key));
        Assert.False(PayOsSignature.Verify(Sample(), signature, "wrong-key"));
        Assert.False(PayOsSignature.Verify(Sample(), new string('z', 64), Key));
        var changed = JsonDocument.Parse(Sample().GetRawText().Replace("3000", "3001")).RootElement;
        Assert.False(PayOsSignature.Verify(changed, signature, Key));
        Assert.False(PayOsSignature.Verify(JsonDocument.Parse("{\"amount\":1,\"amount\":2}").RootElement, signature, Key));
    }

    [Fact]
    public void Signature_HandlesNullsAndSortedArrayObjects()
    {
        var first = JsonDocument.Parse("{\"z\":null,\"a\":[{\"z\":2,\"a\":\"Việt\"}]}").RootElement;
        var second = JsonDocument.Parse("{\"a\":[{\"a\":\"Việt\",\"z\":2}],\"z\":\"null\"}").RootElement;
        Assert.Equal(PayOsSignature.Sign(first, Key), PayOsSignature.Sign(second, Key));
    }

    [Fact]
    public void ConfiguredPackages_ReplaceExamplesInsteadOfAppendingDuplicatePrices()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["PayOS:Packages:0:Id"] = "starter", ["PayOS:Packages:0:Amount"] = "2000", ["PayOS:Packages:0:Coins"] = "200"
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddPayments(configuration);
        using var provider = services.BuildServiceProvider();
        var settings = provider.GetRequiredService<IOptions<PayOsSettings>>().Value;
        Assert.Equal(new CoinPackage("starter", 2000, 200), Assert.Single(settings.Packages));
    }

    [Fact]
    public void OrderCodes_AreStableCallerScopedAndJavascriptSafe()
    {
        var code = PaymentService.OrderCode("one", "request-123");
        Assert.Equal(code, PaymentService.OrderCode("one", "request-123"));
        Assert.NotEqual(code, PaymentService.OrderCode("two", "request-123"));
        Assert.InRange(code, 1_000_000_000_000_000L, 9_007_199_254_740_991L);
    }

    [Fact]
    public void Matching_RejectsDifferentAmountOrderAndLink()
    {
        var order = new PaymentOrder { OrderCode = 123, Amount = 10000, PaymentLinkId = "link-a" };
        var link = new PayOsLink(123, 10000, 10000, "link-a", "PAID");
        Assert.True(PaymentService.Matches(order, link));
        Assert.False(PaymentService.Matches(order, link with { Amount = 2000 }));
        Assert.False(PaymentService.Matches(order, link with { OrderCode = 124 }));
        Assert.False(PaymentService.Matches(order, link with { Id = "link-b" }));
    }

    [Fact]
    public void Settings_DisabledNeedsNoSecrets_EnabledRequiresValidOriginAndPackages()
    {
        Assert.True(new PayOsSettings().IsValid());
        Assert.False(new PayOsSettings { Enabled = true }.IsValid());
        var settings = new PayOsSettings { Enabled = true, ClientId = "test", ApiKey = "test", ChecksumKey = Key };
        Assert.True(settings.IsValid());
        settings.FrontendUrl = "https://game.test/?redirect=evil";
        Assert.False(settings.IsValid());
        settings.FrontendUrl = "https://game.test";
        settings.Packages = [new("bad", 0, 1000)];
        Assert.False(settings.IsValid());
    }

    [Fact]
    public async Task Client_SignsServerAmountAndChecksResponse()
    {
        var handler = new Handler(async request =>
        {
            Assert.Equal("https://api-merchant.payos.vn/v2/payment-requests", request.RequestUri!.ToString());
            Assert.Equal("client", request.Headers.GetValues("x-client-id").Single());
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            var root = body.RootElement;
            var expected = JsonSerializer.SerializeToElement(new { amount = 10000, cancelUrl = "https://game.test/#/payments/123",
                description = "SLNAPXU", orderCode = 123, returnUrl = "https://game.test/#/payments/123" });
            Assert.True(PayOsSignature.Verify(expected, root.GetProperty("signature").GetString(), Key));
            var data = JsonSerializer.SerializeToElement(new { orderCode = 123, amount = 10000, paymentLinkId = "abc",
                status = "PENDING", checkoutUrl = "https://pay.payos.vn/web/abc", qrCode = "qr" });
            return Response(new { code = "00", data, signature = PayOsSignature.Sign(data, Key) });
        });
        var client = Client(handler);
        var link = await client.CreateAsync(new PaymentOrder { OrderCode = 123, Amount = 10000, Description = "SLNAPXU",
            ReturnUrl = "https://game.test/#/payments/123", ExpiresAt = DateTime.UtcNow.AddMinutes(15) }, default);
        Assert.Equal("abc", link.Id);
        Assert.Equal("qr", link.QrCode);
    }

    [Fact]
    public async Task Client_RejectsUnsignedResponse_AndDoesNotTreatProviderErrorsAsMissing()
    {
        var handler = new Handler(_ => Task.FromResult(Response(new { code = "00", data = Sample(), signature = new string('0', 64) })));
        await Assert.ThrowsAsync<HttpRequestException>(() => Client(handler).GetAsync(123, default));
        handler = new Handler(_ => Task.FromResult(Response(new { code = "231", desc = "bad credentials" })));
        await Assert.ThrowsAsync<HttpRequestException>(() => Client(handler).GetAsync(123, default));
        handler = new Handler(_ => Task.FromResult(Response(new { code = "101", desc = "not found" })));
        Assert.Null(await Client(handler).GetAsync(123, default));
    }

    private static PayOsClient Client(HttpMessageHandler handler) => new(new HttpClient(handler), Options.Create(new PayOsSettings
        { ClientId = "client", ApiKey = "api-test", ChecksumKey = Key }));
    private static HttpResponseMessage Response(object body) => new(HttpStatusCode.OK)
        { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
