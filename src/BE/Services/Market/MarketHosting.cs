using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Market;

/// <summary>Pays the Chợ đồ coin reward when a game result is persisted (see MongoGameResultStore).</summary>
public sealed class MarketGameRewardHook : IGameResultRewardHook
{
    private readonly MarketService _market;
    private readonly ILogger<MarketGameRewardHook> _logger;

    public MarketGameRewardHook(MarketService market, ILogger<MarketGameRewardHook> logger)
    {
        _market = market;
        _logger = logger;
    }

    public async Task OnGameResultPersistedAsync(GameResult result, CancellationToken cancellationToken = default)
    {
        try
        {
            await _market.GrantGameRewardsAsync(result, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Never fail a finished game because of the market; the recovery sweep pays missed rewards.
            _logger.LogError(exception, "Market reward for room {RoomId} failed; recovery will retry.", result.RoomId);
        }
    }
}

/// <summary>Creates market indexes at startup and runs the crash-recovery sweep every 30 seconds.</summary>
public sealed class MarketMaintenanceWorker : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(30);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<MarketMaintenanceWorker> _logger;

    public MarketMaintenanceWorker(IServiceScopeFactory scopes, ILogger<MarketMaintenanceWorker> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<MarketStore>().EnsureIndexesAsync(stoppingToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(exception, "Market indexes could not be ensured; the market still works, only slower.");
        }

        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var report = await scope.ServiceProvider.GetRequiredService<MarketService>().RecoverAsync(StaleAfter, stoppingToken);
                if (report.Total > 0) _logger.LogInformation("Market recovery: {Report}", report);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogWarning(exception, "Market recovery sweep failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

public static class MarketServiceCollectionExtensions
{
    /// <summary>Registers Chợ đồ (wallet, inventory, market, trades, game rewards).</summary>
    public static IServiceCollection AddMarket(this IServiceCollection services)
    {
        services.AddScoped<MarketStore>();
        services.AddScoped<MarketService>();
        services.AddScoped<IGameResultRewardHook, MarketGameRewardHook>();
        services.AddHostedService<MarketMaintenanceWorker>();
        return services;
    }
}
