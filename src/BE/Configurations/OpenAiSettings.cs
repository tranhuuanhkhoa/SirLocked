namespace SirLocked.Api.Configurations;

public class OpenAiSettings
{
    public string ApiKey { get; set; } = string.Empty;
    public string LogicModel { get; set; } = "gpt-5.5";
    public string SemanticReviewModel { get; set; } = string.Empty;
    public string ImageModel { get; set; } = "gpt-image-2";
    public string CutoutImageModel { get; set; } = "gpt-image-1.5";
    public string CharacterImageQuality { get; set; } = "high";
    public string CharacterStyleReferencePath { get; set; } =
        "characters/mona-sprite.png";
    public List<string> CharacterStyleReferencePaths { get; set; } =
    [
        "players/holmes.png",
        "characters/mona-sprite.png",
        "characters/samuel-sprite.png",
        "characters/victor-sprite.png",
        "characters/eleanor-sprite.png"
    ];
    public string BaseUrl { get; set; } = "https://api.openai.com/v1";
    public int TimeoutSeconds { get; set; } = 900;
    public int MaxConcurrentImageRequests { get; set; } = 2;
    public int MaxConcurrentVisionRequests { get; set; } = 2;
    public bool AiDryRun { get; set; }
    public bool MockAiResponses { get; set; }
    public bool SkipAssetGeneration { get; set; }
    public bool DisableAutoPublish { get; set; }
    public bool GenerateJsonOnly { get; set; }
    public bool ValidateOnly { get; set; }
    public bool EnableBlindSolvabilityReview { get; set; }

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);
    public bool BlocksAiCalls => AiDryRun || MockAiResponses;
    public bool BlocksAssetCalls => AiDryRun || SkipAssetGeneration || GenerateJsonOnly || ValidateOnly;
    public bool BlocksImportOrPublish => AiDryRun || DisableAutoPublish || ValidateOnly;
    public string EffectiveSemanticReviewModel => string.IsNullOrWhiteSpace(SemanticReviewModel)
        ? LogicModel
        : SemanticReviewModel.Trim();
}
