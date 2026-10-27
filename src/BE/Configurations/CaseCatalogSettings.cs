namespace SirLocked.Api.Configurations;

/// <summary>Which cases players get to see and play.</summary>
public sealed class CaseCatalogSettings
{
    /// <summary>
    /// When true, players only see and can create rooms or find matches with pixel-art cases. Older cases
    /// stay in the database (admin still lists them, finished rooms and results still open); they are
    /// just hidden from the player catalogue.
    /// </summary>
    public bool PixelOnly { get; set; }

    /// <summary>Seeds the bundled pixel cases that are missing from the database when the API starts.</summary>
    public bool SeedPixelOnStartup { get; set; }
}
