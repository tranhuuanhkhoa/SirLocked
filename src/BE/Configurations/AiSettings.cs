namespace SirLocked.API.Configurations;

public sealed class AiSettings
{
    public const string SectionName = "AI";

    public string DeepseekApiKey { get; init; } = string.Empty;
    public string ChatGptApiKey { get; init; } = string.Empty;
    public string GeminiApiKey { get; init; } = string.Empty;
}
