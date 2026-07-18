namespace SirLocked.Api.Configurations;

public sealed class GameplayV3Settings
{
    /// <summary>V3 commands are opt-in until the human gameplay gate passes.</summary>
    public bool Enabled { get; set; }

    /// <summary>Privacy-safe playtest events are disabled outside the isolated local audit environment.</summary>
    public bool PlaytestInstrumentationEnabled { get; set; }
}
