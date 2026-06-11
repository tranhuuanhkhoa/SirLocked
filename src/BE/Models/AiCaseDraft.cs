using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class AiDraftStatus
{
    public const string MockGeneratedValid = "MOCK_GENERATED_VALID";
    public const string DeepseekGeneratedValid = "DEEPSEEK_GENERATED_VALID";
    public const string GeneratedInvalid = "GENERATED_INVALID";
    public const string Imported = "IMPORTED";
}

[BsonIgnoreExtraElements]
public class AiCaseDraft
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string Prompt { get; set; } = string.Empty;
    public AiDraftSettings Settings { get; set; } = new();
    public string Status { get; set; } = string.Empty;
    public string Provider { get; set; } = "mock";
    public string GeneratedJson { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string JsonFilePath { get; set; } = string.Empty;
    public string JsonFolderPath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    /// <summary>Set when the draft has been imported into gameCases.</summary>
    public string? ImportedCaseId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class AiDraftSettings
{
    public int StageCount { get; set; } = 4;
    public string Difficulty { get; set; } = "medium";
    public string VisualStyle { get; set; } = "cinematic detective";
}

[BsonIgnoreExtraElements]
public class AiGenerationLog
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string DraftId { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string Response { get; set; } = string.Empty;
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
