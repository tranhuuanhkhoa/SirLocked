namespace SirLocked.Api.Configurations;

public sealed class GameplayV3Settings
{
    /// <summary>V3 commands are opt-in until the human gameplay gate passes.</summary>
    public bool Enabled { get; set; }
}
