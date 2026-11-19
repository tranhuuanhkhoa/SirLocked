using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Cutscene;

/// <summary>
/// After the pixel cases are in the database, inserts the approved cutscenes shipped in SeedData/Cutscenes for cases that
/// have none. Like the case seeder it only adds what is missing and never stops the API.
/// </summary>
public sealed class CutsceneSeedWorker(IServiceScopeFactory scopeFactory, ILogger<CutsceneSeedWorker> logger) : BackgroundService
{
    internal static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(15);
    internal const int MaxAttempts = 6;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // The case seeder runs at the same moment; give it a head start, then retry while the catalogue is still empty.
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            for (var attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                if (await RunPassAsync(stoppingToken)) return;
                if (attempt < MaxAttempts) await Task.Delay(RetryDelay, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    internal async Task<bool> RunPassAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var cases = scope.ServiceProvider.GetRequiredService<ICaseService>();
            var summaries = await cases.GetPublishedAsync();
            if (summaries.Count == 0) return false;
            var loaded = new List<GameCase>();
            foreach (var summary in summaries)
                if (await cases.FindCaseAsync(summary.CaseId) is { } gameCase) loaded.Add(gameCase);
            var seeded = await scope.ServiceProvider.GetRequiredService<CutsceneService>().SeedMissingAsync(loaded, ct);
            if (seeded.Count > 0) logger.LogInformation("Seeded cutscenes: {CaseIds}", string.Join(", ", seeded));
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            logger.LogError(exception, "Seeding the cutscenes failed; the API keeps running.");
            return false;
        }
    }
}
