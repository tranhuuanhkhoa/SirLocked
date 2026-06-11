using System.ComponentModel.DataAnnotations;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Ai;

public class GenerateAiCaseRequest
{
    [Required, MinLength(8), MaxLength(2000)]
    public string Prompt { get; set; } = string.Empty;

    [Range(2, 6)]
    public int StageCount { get; set; } = 4;

    public string Difficulty { get; set; } = "medium";
    public string VisualStyle { get; set; } = "cinematic detective";
}

public class AiDraftResponse
{
    public string DraftId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public AiDraftSettings Settings { get; set; } = new();
    public string Status { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string GeneratedJson { get; set; } = string.Empty;
    public string JsonFilePath { get; set; } = string.Empty;
    public string JsonFolderPath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    public string? ImportedCaseId { get; set; }
    public DateTime CreatedAt { get; set; }

    public static AiDraftResponse From(AiCaseDraft d, bool includeJson = true) => new()
    {
        DraftId = d.Id,
        Prompt = d.Prompt,
        Settings = d.Settings,
        Status = d.Status,
        Provider = d.Provider,
        CaseId = d.CaseId,
        CaseTitle = d.CaseTitle,
        GeneratedJson = includeJson ? d.GeneratedJson : string.Empty,
        JsonFilePath = d.JsonFilePath,
        JsonFolderPath = d.JsonFolderPath,
        ValidationErrors = d.ValidationErrors,
        ImportedCaseId = d.ImportedCaseId,
        CreatedAt = d.CreatedAt
    };
}
