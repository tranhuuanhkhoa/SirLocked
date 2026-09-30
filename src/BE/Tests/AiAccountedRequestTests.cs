using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiAccountedRequestTests
{
    [Theory]
    [InlineData("text")]
    [InlineData("vision")]
    public async Task ResponseIsAccountedOnceBeforeItReturns(string kind)
    {
        var accounting = new RecordingAccounting();
        var service = Service(accounting);
        var response = new AiProviderHttpResponse(200, true, "{\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}");
        Assert.Same(response, await service.AccountedResponseAsync("draft", "step", kind, "model", () => Task.FromResult(response)));
        Assert.Equal(kind, Assert.Single(accounting.Leases).Kind);
        var record = Assert.Single(accounting.Records);
        Assert.Equal(response.Body, record.Body);
        Assert.Equal(200, record.Status);
    }

    [Fact]
    public async Task FailedOrCancelledSendStillRecordsAnUnknownAttemptWithIndependentCleanup()
    {
        var accounting = new RecordingAccounting();
        var service = Service(accounting);
        await Assert.ThrowsAsync<OperationCanceledException>(() => service.AccountedResponseAsync(
            "draft", "step", "text", "model", () => throw new OperationCanceledException()));
        var record = Assert.Single(accounting.Records);
        Assert.Null(record.Body);
        Assert.Null(record.Status);
        Assert.False(record.Cancelled);
    }

    [Fact]
    public async Task BudgetDenialPreventsSendingAndDoesNotRecordAnUnsentCall()
    {
        var accounting = new RecordingAccounting { Deny = true };
        var sent = false;
        await Assert.ThrowsAsync<ApiException>(() => Service(accounting).AccountedResponseAsync(
            "draft", "step", "text", "model", () =>
            {
                sent = true;
                return Task.FromResult(new AiProviderHttpResponse(200, true, "{}"));
            }));
        Assert.False(sent);
        Assert.Empty(accounting.Records);
    }

    [Fact]
    public async Task EachImageHttpAttemptGetsItsOwnReservationAndKeepsTheResponseBody()
    {
        var accounting = new RecordingAccounting();
        var service = Service(accounting);
        using var first = await service.AccountedImageAsync("draft", "image", "model", () =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Content = new StringContent("rate limited") }));
        using var second = await service.AccountedImageAsync("draft", "image", "model", () =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("image-response") }));
        Assert.Equal(2, accounting.Leases.Select(lease => lease.Id).Distinct().Count());
        Assert.Equal(new int?[] { 429, 200 }, accounting.Records.Select(record => record.Status));
        Assert.Equal("image-response", await second.Content.ReadAsStringAsync());
    }

    private static AiCaseService Service(IAiUsageAccounting accounting) => new(
        db: null!, workflow: null!, caseService: null!, validator: null!, truthService: null!,
        projectionPlanner: null!, projectionSchemaFactory: null!, projectionCompiler: null!, projectionGraphValidator: null!,
        openAiClient: null!, exportService: null!, httpClientFactory: null!,
        settings: Options.Create(new OpenAiSettings()), quota: Options.Create(new AiQuotaSettings()),
        cloudinary: Options.Create(new CloudinarySettings()), v3PresetSettings: Options.Create(new AiCaseV3PresetSettings()),
        gameplayV3Settings: Options.Create(new GameplayV3Settings()), env: null!, logger: NullLogger<AiCaseService>.Instance,
        usageAccounting: accounting);

    private sealed class RecordingAccounting : IAiUsageAccounting
    {
        public bool Deny { get; set; }
        public List<AiCallLease> Leases { get; } = [];
        public List<(string? Body, int? Status, bool Cancelled)> Records { get; } = [];
        public Task<AiCallLease> BeforeCallAsync(string draftId, string step, string kind, string model,
            CancellationToken cancellationToken = default, decimal? reservationUsd = null, string? priceVersion = null)
        {
            if (Deny) throw ApiException.Conflict("Budget exhausted.");
            var lease = new AiCallLease { DraftId = draftId, Step = step, Kind = kind, Model = model };
            Leases.Add(lease);
            return Task.FromResult(lease);
        }
        public Task RecordAsync(AiCallLease lease, string? responseBody, int? statusCode, CancellationToken cancellationToken = default)
        {
            Records.Add((responseBody, statusCode, cancellationToken.IsCancellationRequested));
            return Task.CompletedTask;
        }
    }
}
