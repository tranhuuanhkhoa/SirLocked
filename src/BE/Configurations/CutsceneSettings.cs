namespace SirLocked.Api.Configurations;

public class CutsceneSettings
{
    /// <summary>Pixel cases without an intro get one DRAFT script written in the background, once.</summary>
    public bool AutoGenerateForPixelCases { get; set; } = true;

    /// <summary>When true a script that passes validation is approved without an admin.</summary>
    public bool AutoApprove { get; set; }

    /// <summary>Master switch: false hides every cutscene from players.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>OpenAI model for scripts; empty uses OpenAI:LogicModel.</summary>
    public string Model { get; set; } = string.Empty;

    public int MaxOutputTokens { get; set; } = 6000;
}
