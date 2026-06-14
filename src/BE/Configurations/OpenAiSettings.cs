namespace SirLocked.Api.Configurations;

public class OpenAiSettings
{
    public string ApiKey { get; set; } = string.Empty;
    public string LogicModel { get; set; } = "gpt-5.5";
    public string ImageModel { get; set; } = "gpt-image-2";
    public string CutoutImageModel { get; set; } = "gpt-image-1.5";
    public string BaseUrl { get; set; } = "https://api.openai.com/v1";
    public int TimeoutSeconds { get; set; } = 900;

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);
}
