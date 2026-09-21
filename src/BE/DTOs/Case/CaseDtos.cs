using System.Text.Json;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Case;

public class CaseSummaryResponse
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Language { get; set; } = CaseLanguages.English;
    public string Status { get; set; } = string.Empty;
    public int MechanicsVersion { get; set; }
    public int LogicContractVersion { get; set; }
    public string LogicVerificationStatus { get; set; } = CaseLogicVerificationStatuses.LegacyUnverified;
    public string GenerationMode { get; set; } = string.Empty;
    public string GenerationPreset { get; set; } = string.Empty;
    public string AiSemanticReviewStatus { get; set; } = string.Empty;
    public bool HasSourceAiDraft { get; set; }
    public int EstimatedMinutes { get; set; }
    public string CoverImageUrl { get; set; } = string.Empty;
    public int StageCount { get; set; }
    public int SceneCount { get; set; }
    public int CharacterCount { get; set; }
    public int ItemCount { get; set; }
    public int ClueCount { get; set; }
    public int DialogueCount { get; set; }
    public DateTime UpdatedAt { get; set; }

    public static CaseSummaryResponse From(GameCase c) => new()
    {
        CaseId = c.CaseId,
        Title = c.Title,
        Summary = c.Summary,
        Language = CaseLanguages.Normalize(c.Language),
        Status = c.Status,
        MechanicsVersion = c.MechanicsVersion,
        LogicContractVersion = c.LogicContractVersion,
        LogicVerificationStatus = c.LogicVerificationStatus,
        GenerationMode = c.GenerationMode,
        GenerationPreset = c.GenerationPreset,
        AiSemanticReviewStatus = c.AiSemanticReviewStatus,
        HasSourceAiDraft = !string.IsNullOrWhiteSpace(c.SourceAiDraftId),
        EstimatedMinutes = c.EstimatedMinutes,
        CoverImageUrl = c.CoverImageUrl,
        StageCount = c.Stages.Count,
        SceneCount = c.Stages.Sum(s => s.Scenes.Count),
        CharacterCount = c.Characters.Count,
        ItemCount = c.Items.Count,
        ClueCount = c.Clues.Count,
        DialogueCount = c.Dialogues.Count,
        UpdatedAt = c.UpdatedAt
    };
}

/// <summary>Player-facing case detail without spoilers (no clues, dialogues, final logic).</summary>
public class CasePublicDetailResponse : CaseSummaryResponse
{
    public List<CaseCharacterDto> Characters { get; set; } = new();

    public static CasePublicDetailResponse FromCase(GameCase c)
    {
        var summary = From(c);
        return new CasePublicDetailResponse
        {
            CaseId = summary.CaseId,
            Title = summary.Title,
            Summary = summary.Summary,
            Language = summary.Language,
            Status = summary.Status,
            MechanicsVersion = summary.MechanicsVersion,
            LogicContractVersion = summary.LogicContractVersion,
            LogicVerificationStatus = summary.LogicVerificationStatus,
            GenerationMode = summary.GenerationMode,
            GenerationPreset = summary.GenerationPreset,
            AiSemanticReviewStatus = summary.AiSemanticReviewStatus,
            HasSourceAiDraft = summary.HasSourceAiDraft,
            EstimatedMinutes = summary.EstimatedMinutes,
            CoverImageUrl = summary.CoverImageUrl,
            StageCount = summary.StageCount,
            SceneCount = summary.SceneCount,
            CharacterCount = summary.CharacterCount,
            ItemCount = summary.ItemCount,
            ClueCount = summary.ClueCount,
            DialogueCount = summary.DialogueCount,
            UpdatedAt = summary.UpdatedAt,
            Characters = c.Characters.Select(CaseCharacterDto.From).ToList()
        };
    }
}

public class CaseCharacterDto
{
    public string CharacterId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public static CaseCharacterDto From(CaseCharacter c) => new()
    {
        CharacterId = c.CharacterId,
        Name = c.Name,
        Role = c.Role,
        ImageUrl = c.ImageUrl,
        Description = c.Description
    };
}

/// <summary>Admin import/validate payload: the raw GameCase JSON document.</summary>
public class CaseJsonRequest
{
    public JsonElement CaseJson { get; set; }
    /// <summary>When true, import overwrites an existing case with the same caseId.</summary>
    public bool Overwrite { get; set; }
}

public class CaseValidationResponse
{
    public bool IsValid { get; set; }
    public List<CaseValidationError> Errors { get; set; } = new();
}
