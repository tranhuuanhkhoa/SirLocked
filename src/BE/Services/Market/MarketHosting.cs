using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Pays the Chợ đồ coin reward and drops the weekly challenge chest when a game result is persisted (see
/// MongoGameResultStore). A result can be persisted again; both steps are idempotent.
/// </summary>
public sealed class MarketGameRewardHook : IGameResultRewardHook
{
    private readonly MarketService _market;
    private readonly ProgressService _progress;
    private readonly WeeklyDropService _drops;
    private readonly ILogger<MarketGameRewardHook> _logger;

    public MarketGameRewardHook(MarketService market, ProgressService progress, WeeklyDropService drops, ILogger<MarketGameRewardHook> logger)
    {
        _market = market;
        _progress = progress;
        _drops = drops;
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
        try
        {
            await _drops.EvaluateAsync(result, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Same: the recovery sweep evaluates challenge games whose players have no drop yet.
            _logger.LogError(exception, "Weekly drop for room {RoomId} failed; recovery will retry.", result.RoomId);
        }
        foreach (var userId in result.Players.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal))
        {
            try
            {
                await _progress.SyncAchievementsAsync(userId, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Recounted the next time this detective opens their profile.
                _logger.LogWarning(exception, "Achievements of {UserId} could not be updated.", userId);
            }
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
                var chests = await scope.ServiceProvider.GetRequiredService<ChestService>().RecoverAsync(StaleAfter, stoppingToken);
                if (chests.Total > 0) _logger.LogInformation("Chest recovery: {Report}", chests);
                var exchanges = await scope.ServiceProvider.GetRequiredService<ProgressService>().RecoverAsync(StaleAfter, stoppingToken);
                if (exchanges > 0) _logger.LogInformation("Progress recovery: {Exchanges} exchanges resumed.", exchanges);
                var drops = await scope.ServiceProvider.GetRequiredService<WeeklyDropService>().RecoverAsync(StaleAfter, stoppingToken);
                if (drops > 0) _logger.LogInformation("Weekly drop recovery: {Drops} chests finished or dropped.", drops);
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
    /// <summary>Registers Chợ đồ (wallet, inventory, market, trades, game rewards), Mở hòm and Hồ sơ thám tử.</summary>
    public static IServiceCollection AddMarket(this IServiceCollection services)
    {
        services.AddScoped<MarketStore>();
        services.AddScoped<MarketService>();
        services.AddScoped<CoinWalletService>();
        services.AddOptions();
        services.AddSingleton<IChestRandom, CryptoChestRandom>();
        services.AddScoped<ChestService>();
        services.AddScoped<ProgressService>();
        services.AddScoped<IPlayerCosmeticsReader>(provider => provider.GetRequiredService<ProgressService>());
        services.AddScoped<LobbyEntranceService>();
        services.AddScoped<LobbyOutfitService>();
        services.AddScoped<WeeklyDropService>(); // needs IWeeklyService, registered in Program.cs
        services.AddScoped<IGameResultRewardHook, MarketGameRewardHook>();
        services.AddHostedService<MarketMaintenanceWorker>();
        return services;
    }
}
