using SirLocked.Api.Configurations;
using Microsoft.Extensions.Options;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiUsageAccountingTests
{
    private static AiCallLease Lease(string kind = "text") => new()
    {
        DraftId = "draft", Kind = kind, Model = "test", PriceVersion = "test-only",
        Price = new AiModelPrice { InputPerMillionUsd = 2, CachedInputPerMillionUsd = .2m, OutputPerMillionUsd = 8 }
    };

    [Fact]
    public void CountsCachedInputAndDoesNotDoubleBillReasoning()
    {
        var item = AiUsageParser.Parse(Lease(), """
            {"id":"response","usage":{"input_tokens":1000,"output_tokens":100,
            "input_tokens_details":{"cached_tokens":800},"output_tokens_details":{"reasoning_tokens":80}}}
            """, 200);
        Assert.Equal(.00136m, item.CostUsd);
        Assert.Equal(80, item.ReasoningTokens);
        Assert.Equal("RECORDED", item.State);
    }

    [Theory]
    [InlineData(null)] [InlineData("not json")] [InlineData("{}")] [InlineData("{\"usage\":{}}")]
    public void UnknownUsageNeverBecomesZeroCost(string? body)
    {
        var item = AiUsageParser.Parse(Lease(), body, null);
        Assert.Null(item.CostUsd);
        Assert.Equal("UNKNOWN", item.State);
    }

    [Fact]
    public void XaiUsesProviderBilledTicksWithDecimalPrecision()
    {
        var item = AiUsageParser.Parse(Lease("video"), "{\"usage\":{\"cost_in_usd_ticks\":37756000}}", 200);
        Assert.Equal(.0037756m, item.CostUsd);
        Assert.Equal("PROVIDER", item.CostSource);
    }

    [Fact]
    public void IncompleteResponsesStillConsumeBudget()
    {
        var item = AiUsageParser.Parse(Lease(), "{\"status\":\"incomplete\",\"usage\":{\"input_tokens\":1000,\"output_tokens\":500}}", 200);
        Assert.Equal(.006m, item.CostUsd);
    }

    [Fact]
    public void ImagePriceMustBeExplicit()
    {
        var lease = Lease("image");
        var body = "{\"usage\":{\"input_tokens\":100,\"output_tokens\":1000,\"input_tokens_details\":{\"image_tokens\":80}}}";
        Assert.Null(AiUsageParser.Parse(lease, body, 200).CostUsd);
        lease.Price!.ImageInputPerMillionUsd = 3;
        lease.Price.ImageOutputPerMillionUsd = 12;
        Assert.Equal(.01228m, AiUsageParser.Parse(lease, body, 200).CostUsd);
    }

    [Fact]
    public void MissingModelPriceKeepsCostUnknown()
    {
        var lease = Lease(); lease.Price = null;
        Assert.Null(AiUsageParser.Parse(lease, "{\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}", 200).CostUsd);
    }

    [Fact]
    public void LeaseAndUsageRoundTripWithoutSerializingProviderContent()
    {
        var lease = Lease();
        var usage = AiUsageParser.Parse(lease, "{\"output_text\":\"PRIVATE_SENTINEL\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}", 200);
        Assert.DoesNotContain("PRIVATE_SENTINEL", System.Text.Json.JsonSerializer.Serialize(usage));
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"usage\":{\"input_tokens\":\"10\",\"output_tokens\":5}}")]
    [InlineData("{\"usage\":{\"input_tokens\":10,\"output_tokens\":-1}}")]
    [InlineData("{\"usage\":{\"input_tokens\":10,\"output_tokens\":5,\"input_tokens_details\":{\"cached_tokens\":\"bad\"}}}")]
    [InlineData("{\"usage\":{\"input_tokens\":10,\"output_tokens\":5,\"output_tokens_details\":false}}")]
    public void MalformedCountersNeverThrowOrBecomeAPricedRecord(string body)
    {
        var item = AiUsageParser.Parse(Lease(), body, 200);
        Assert.Equal("UNKNOWN", item.State);
        Assert.Null(item.CostUsd);
    }

    [Fact]
    public void AmbiguousCachedImageOverlapDoesNotPretendCountersAreDisjoint()
    {
        var lease = Lease("image");
        lease.Price!.ImageInputPerMillionUsd = 3;
        lease.Price.ImageOutputPerMillionUsd = 12;
        var item = AiUsageParser.Parse(lease, """
            {"usage":{"input_tokens":1000,"output_tokens":100,"input_tokens_details":{"cached_tokens":200,"image_tokens":300}}}
            """, 200);
        Assert.Equal(200, item.CachedInputTokens);
        Assert.Equal(300, item.ImageInputTokens);
        Assert.Null(item.CostUsd);
    }

    [Fact]
    public void ImageWithoutModalityBreakdownKeepsCostUnknown()
    {
        var lease = Lease("image");
        lease.Price!.ImageInputPerMillionUsd = 3;
        lease.Price.ImageOutputPerMillionUsd = 12;
        Assert.Null(AiUsageParser.Parse(lease, "{\"usage\":{\"input_tokens\":100,\"output_tokens\":1000}}", 200).CostUsd);
    }

    [Fact]
    public void UnrelatedProviderTicksDoNotPriceTextResponses()
    {
        Assert.Null(AiUsageParser.Parse(Lease(), "{\"usage\":{\"cost_in_usd_ticks\":1000000}}", 200).CostUsd);
    }

    [Fact]
    public void NegativeOptionalPricesAndImpossibleReasoningRemainUnknown()
    {
        var lease = Lease();
        lease.Price!.CachedInputPerMillionUsd = -1;
        Assert.Null(AiUsageParser.Parse(lease, "{\"usage\":{\"input_tokens\":100,\"output_tokens\":10}}", 200).CostUsd);
        lease.Price.CachedInputPerMillionUsd = 0;
        Assert.Null(AiUsageParser.Parse(lease, """
            {"usage":{"input_tokens":100,"output_tokens":10,"output_tokens_details":{"reasoning_tokens":11}}}
            """, 200).CostUsd);
    }

    [Fact]
    public async Task DisabledQuotaFailsBeforeAnyDatabaseOrProviderWork()
    {
        var service = new AiUsageAccounting(null!, Options.Create(new AiQuotaSettings()), Options.Create(new AiUsageSettings()));
        var exception = await Assert.ThrowsAsync<ApiException>(() => service.BeforeCallAsync("draft", "preview", "text", "model"));
        Assert.Equal(409, exception.StatusCode);
    }

    [Theory]
    [InlineData("text")]
    [InlineData("image")]
    public async Task MissingPricesFailBeforeReservingEvenWhenACallerSuppliesMoney(string kind)
    {
        var service = new AiUsageAccounting(null!,
            Options.Create(new AiQuotaSettings { Enabled = true, GlobalBudgetUsd = 100 }),
            Options.Create(new AiUsageSettings { PriceVersion = "test-only" }));
        var exception = await Assert.ThrowsAsync<ApiException>(() =>
            service.BeforeCallAsync("draft", "generate", kind, "unpriced-model", reservationUsd: 5));
        Assert.Equal(409, exception.StatusCode);
    }
}
