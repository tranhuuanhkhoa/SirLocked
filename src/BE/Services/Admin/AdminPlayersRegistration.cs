using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

public static class AdminPlayersRegistration
{
    /// <summary>Services of the Players and economy admin area (ADMIN-3). Register them here, not in Program.cs.</summary>
    public static IServiceCollection AddAdminPlayers(this IServiceCollection services)
    {
        services.AddScoped<AdminPlayersStore>();
        services.AddHttpClient<IAvatarFileRemover, CloudinaryAvatarFileRemover>(client => client.Timeout = TimeSpan.FromSeconds(20));
        services.AddScoped<AdminPlayerOperations>();
        services.AddScoped<AdminPlayersService>();
        services.AddScoped<AdminAvatarModeration>();
        services.AddScoped<AdminEconomyService>();
        services.AddScoped<AdminRoomsService>();
        services.AddScoped<AdminReviewsService>();
        services.AddHostedService<AdminPlayersMaintenanceWorker>();
        return services;
    }
}

/// <summary>Creates this area's indexes at startup and finishes journals a crash interrupted, on the same rhythm as the market's sweep.</summary>
public sealed class AdminPlayersMaintenanceWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<AdminPlayersMaintenanceWorker> _logger;

    public AdminPlayersMaintenanceWorker(IServiceScopeFactory scopes, ILogger<AdminPlayersMaintenanceWorker> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AdminPlayersStore>().EnsureIndexesAsync(stoppingToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(exception, "Player admin indexes could not be ensured; the pages still work, only slower.");
        }

        using var timer = new PeriodicTimer(MarketMaintenanceWorker.Interval);
        do
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var resumed = await scope.ServiceProvider.GetRequiredService<AdminPlayerOperations>().RecoverAsync(MarketMaintenanceWorker.StaleAfter, stoppingToken);
                if (resumed > 0) _logger.LogInformation("Player admin recovery: {Resumed} operations resumed.", resumed);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogWarning(exception, "Player admin recovery sweep failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
