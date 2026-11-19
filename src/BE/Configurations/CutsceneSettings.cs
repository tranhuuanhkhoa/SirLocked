namespace SirLocked.Api.Configurations;

public class CutsceneSettings
{
    /// <summary>Retired: startup no longer queues scripts; an admin asks Claude for one. Kept so old configuration binds.</summary>
    public bool AutoGenerateForPixelCases { get; set; } = true;

    /// <summary>When true a script that passes validation is approved without an admin.</summary>
    public bool AutoApprove { get; set; }

    /// <summary>Master switch: false hides every cutscene from players.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Retired: scripts are written by the Claude bot through the bridge. Kept so old configuration still binds.</summary>
    public string Model { get; set; } = string.Empty;

    public int MaxOutputTokens { get; set; } = 6000;
}
