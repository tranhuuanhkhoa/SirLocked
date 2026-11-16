using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

/// <summary>Keeps the bundled newcomer tutorial case (SeedData/V3/case-pixel-tan-thu-vi.json) in the database.</summary>
public interface ITutorialCaseSeeder
{
    /// <summary>
    /// Inserts the tutorial case when it is missing and refreshes it from the bundled file once per process. It stays a
    /// DRAFT: it never shows in the public catalogue and is only played through the solo tutorial room.
    /// </summary>
    Task<GameCase> EnsureTutorialCaseAsync(CancellationToken ct = default);
}
