namespace SirLocked.Api.Configurations;

public class AiSettings
{
    public string DeepseekApiKey { get; set; } = string.Empty;
    public string DeepseekModel { get; set; } = "deepseek-chat";
    public string DeepseekBaseUrl { get; set; } = "https://api.deepseek.com";
    public int DeepseekTimeoutSeconds { get; set; } = 900;
    public string GeminiApiKey { get; set; } = string.Empty;
    public string ChatGptApiKey { get; set; } = string.Empty;

    public bool HasDeepseek => !string.IsNullOrWhiteSpace(DeepseekApiKey);
}
