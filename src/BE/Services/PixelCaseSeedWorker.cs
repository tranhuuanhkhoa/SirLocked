using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

/// <summary>
/// Puts the bundled pixel cases into the database when the API starts, so the game does not depend on a
/// launcher script or an admin pressing a seed button. It only inserts cases that are missing and never
/// stops the API: a failure is logged and retried a few times (MongoDB may still be starting).
/// </summary>
public sealed class PixelCaseSeedWorker(
    IServiceScopeFactory scopeFactory, IOptions<CaseCatalogSettings> settings, ILogger<PixelCaseSeedWorker> logger) : BackgroundService
{
    internal static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(15);
    internal const int MaxAttempts = 4;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Value.SeedPixelOnStartup) return;
        try
        {
            for (var attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                if (await RunPassAsync(stoppingToken)) return;
                if (attempt < MaxAttempts) await Task.Delay(RetryDelay, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    /// <returns>True when the pass finished (even if nothing was missing); false when it failed.</returns>
    internal async Task<bool> RunPassAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var seeded = await scope.ServiceProvider.GetRequiredService<IPixelCaseSeeder>().SeedMissingPixelCasesAsync(ct);
            if (seeded.Count > 0) logger.LogInformation("Seeded pixel cases: {CaseIds}", string.Join(", ", seeded));
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            logger.LogError(exception, "Seeding the pixel cases failed; the API keeps running.");
            return false;
        }
    }
}
