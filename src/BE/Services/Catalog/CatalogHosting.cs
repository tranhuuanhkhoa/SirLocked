namespace SirLocked.Api.Services.Catalog;

/// <summary>
/// Reloads the catalog every 60 seconds, so a change written by another process reaches this one. Also finishes the
/// seed when the database was not reachable at startup (only a degraded development start gets that far).
/// </summary>
public sealed class CatalogRefreshWorker : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    private readonly ICatalogProvider _catalog;
    private readonly CatalogSeeder _seeder;
    private readonly ILogger<CatalogRefreshWorker> _logger;

    public CatalogRefreshWorker(ICatalogProvider catalog, CatalogSeeder seeder, ILogger<CatalogRefreshWorker> logger)
    {
        _catalog = catalog;
        _seeder = seeder;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        var seeded = false;
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                if (!seeded)
                {
                    await _seeder.SeedAsync(stoppingToken);
                    seeded = true;
                }
                await _catalog.RefreshAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogWarning(exception, "The catalog could not be refreshed; the last good copy keeps answering.");
            }
        }
    }
}

public static class CatalogServiceCollectionExtensions
{
    /// <summary>Registers the admin-managed catalog. Program.cs seeds it and loads it before the API takes requests.</summary>
    public static IServiceCollection AddCatalog(this IServiceCollection services)
    {
        services.AddSingleton<CatalogStore>();
        services.AddSingleton<CatalogSeeder>();
        services.AddSingleton<ICatalogProvider, CatalogProvider>();
        services.AddHostedService<CatalogRefreshWorker>();
        return services;
    }
}
