namespace SirLocked.Api.Services.Interfaces;

/// <summary>Seeds the bundled pixel cases that are not in the database yet (never overwrites).</summary>
public interface IPixelCaseSeeder
{
    /// <returns>The caseIds that were inserted and published by this call.</returns>
    Task<IReadOnlyList<string>> SeedMissingPixelCasesAsync(CancellationToken ct = default);
}
