using System.Net;
using System.Net.Http.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The studio runner's push channel: /hubs/bridge sends WorkAvailable when the machine connects and whenever a bridge
/// request becomes PENDING, so the machine never polls.
/// </summary>
public sealed partial class AiBridgeWorkflowHostTests
{
    [Fact]
    public async Task BridgeHub_WrongOrMissingKey_IsRefused()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        foreach (var key in new[] { BridgeKey + "x", null })
        {
            await using var connection = Hub(factory, key);
            var error = await Assert.ThrowsAsync<HttpRequestException>(() => connection.StartAsync());
            Assert.Equal(HttpStatusCode.Unauthorized, error.StatusCode);
        }
    }

    [Fact]
    public async Task BridgeHub_Connect_ReceivesWorkAvailable_Immediately()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await using var connection = Hub(factory, BridgeKey);
        var events = Listen(connection);
        await connection.StartAsync();
        await NextAsync(events, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task BridgeHub_NewOrder_PushesWorkAvailable_And_PendingCountSeesIt()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        await using var connection = Hub(factory, BridgeKey);
        var events = Listen(connection);
        await connection.StartAsync();
        await NextAsync(events, TimeSpan.FromSeconds(5)); // the hello on connect

        var created = await admin.PostAsJsonAsync("/api/admin/ai-cases", new GenerateAiCaseRequest
        {
            GenerationPreset = AiGenerationPresets.ShortDemo, Language = "en", Order = new AiCaseOrder()
        });
        Assert.Equal(HttpStatusCode.Accepted, created.StatusCode);
        await NextAsync(events, TimeSpan.FromSeconds(30));
        Assert.True(await connection.InvokeAsync<int>("PendingCount") >= 1);
    }

    [Fact]
    public async Task BridgeHub_Release_PushesWorkAvailable()
    {
        if (!Enabled) return;
        await using var factory = new BridgeFactory();
        await SeedUsersAsync(factory);
        using var admin = User(factory, AdminId, UserRole.Admin);
        using var bot = Bot(factory);
        var draftId = await CreateAsync(factory, admin, AiCaseReviewModes.Full);
        var requestId = await WaitForRequestAsync(bot, draftId);
        await TakeAsync(bot, requestId);

        await using var connection = Hub(factory, BridgeKey);
        var events = Listen(connection);
        await connection.StartAsync();
        await NextAsync(events, TimeSpan.FromSeconds(5)); // the hello on connect

        var released = await bot.PostAsync($"/api/bridge/requests/{requestId}/release", null);
        Assert.Equal(HttpStatusCode.OK, released.StatusCode);
        await NextAsync(events, TimeSpan.FromSeconds(10));
    }

    private static HubConnection Hub(BridgeFactory factory, string? key) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/bridge"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                if (key is not null) options.Headers["X-Bridge-Key"] = key;
            })
            .Build();

    private static ChannelReader<bool> Listen(HubConnection connection)
    {
        var channel = Channel.CreateUnbounded<bool>();
        connection.On("WorkAvailable", () => channel.Writer.TryWrite(true));
        return channel.Reader;
    }

    private static async Task NextAsync(ChannelReader<bool> events, TimeSpan timeout)
    {
        using var cancel = new CancellationTokenSource(timeout);
        try { await events.ReadAsync(cancel.Token); }
        catch (OperationCanceledException) { Assert.Fail($"No WorkAvailable within {timeout.TotalSeconds:0} s."); }
    }
}
