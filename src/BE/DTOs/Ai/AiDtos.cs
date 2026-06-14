using System.ComponentModel.DataAnnotations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Ai;

public class GenerateAiCaseRequest
{
    [MaxLength(2000)]
    public string? Prompt { get; set; }

    [Range(2, 6)]
    public int StageCount { get; set; } = 4;

    public string Difficulty { get; set; } = "medium";

    /// <summary>
    /// Kept for backward-compatible clients. The server always applies the fixed SirLocked visual contract.
    /// </summary>
    public string VisualStyle { get; set; } = AiVisualStyleDefaults.PixelDetectiveTheme;
}

public class AiDraftResponse
{
    public string DraftId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public AiDraftSettings Settings { get; set; } = new();
    public string Status { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public AiStoryPreview? StoryPreview { get; set; }
    public AiAssetManifest? AssetManifest { get; set; }
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string GeneratedJson { get; set; } = string.Empty;
    public string JsonFilePath { get; set; } = string.Empty;
    public string JsonFolderPath { get; set; } = string.Empty;
    public List<string> ValidationErrors { get; set; } = new();
    public string? ImportedCaseId { get; set; }
    public CaseSummaryResponse? PublishedCase { get; set; }
    public DateTime CreatedAt { get; set; }

    public static AiDraftResponse From(AiCaseDraft d, bool includeJson = true, CaseSummaryResponse? publishedCase = null) => new()
    {
        DraftId = d.Id,
        Prompt = d.Prompt,
        Settings = d.Settings,
        Status = d.Status,
        Provider = d.Provider,
        StoryPreview = HasStoryPreview(d.StoryPreview) ? d.StoryPreview : null,
        AssetManifest = HasAssetManifest(d.AssetManifest) ? d.AssetManifest : null,
        CaseId = d.CaseId,
        CaseTitle = d.CaseTitle,
        GeneratedJson = includeJson ? d.GeneratedJson : string.Empty,
        JsonFilePath = d.JsonFilePath,
        JsonFolderPath = d.JsonFolderPath,
        ValidationErrors = d.ValidationErrors,
        ImportedCaseId = d.ImportedCaseId,
        PublishedCase = publishedCase,
        CreatedAt = d.CreatedAt
    };

    private static bool HasStoryPreview(AiStoryPreview? preview) =>
        preview is not null
        && (!string.IsNullOrWhiteSpace(preview.Title)
            || !string.IsNullOrWhiteSpace(preview.Summary)
            || !string.IsNullOrWhiteSpace(preview.OpeningIncident));

    private static bool HasAssetManifest(AiAssetManifest? manifest) =>
        manifest is not null
        && (!string.IsNullOrWhiteSpace(manifest.AssetRootUrl) || manifest.Assets.Count > 0);
}
