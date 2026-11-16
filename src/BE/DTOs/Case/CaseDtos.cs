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
    /// <summary>True when every scene renders in pixel mode (see <c>CaseCatalogRules.IsPixel</c>).</summary>
    public bool IsPixel { get; set; }
    /// <summary>False when the case is hidden from players (a draft, or not a pixel case while the catalogue is pixel-only). Set on the admin list.</summary>
    public bool PlayerVisible { get; set; } = true;
    public DateTime UpdatedAt { get; set; }
    /// <summary>Non-blocking validation findings of an import or publish (for example missing hint levels on an existing case). Absent elsewhere.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public List<CaseValidationError>? ValidationWarnings { get; set; }

    public CaseSummaryResponse WithPlayerVisible(bool visible)
    {
        var copy = (CaseSummaryResponse)MemberwiseClone();
        copy.PlayerVisible = visible;
        return copy;
    }

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
        IsPixel = SirLocked.Api.Services.CaseCatalogRules.IsPixel(c),
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
            IsPixel = summary.IsPixel,
            UpdatedAt = summary.UpdatedAt,
            Characters = c.Characters.Select(CaseCharacterDto.From).ToList()
        };
    }
}

public class CaseCharacterDto
{
    public SirLocked.Api.DTOs.Investigation.CharacterPresentationDto? Presentation { get; set; }
    public string CharacterId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    /// <summary>Optional speech blip; absent on cases that predate it.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public CharacterVoice? Voice { get; set; }

    public static CaseCharacterDto From(CaseCharacter c) => new()
    {
        Voice = c.Voice?.Blip is not { } blip ? null : new CharacterVoice
        {
            Blip = new VoiceBlip { Pitch = blip.Pitch, Speed = blip.Speed, Wave = blip.Wave, Variance = blip.Variance }
        },
        Presentation = c.Presentation?.SpriteSheet is not { } sheet ? null : new()
        {
            SpriteSheet = new()
            {
                Url = sheet.Url, FrameWidth = sheet.FrameWidth, FrameHeight = sheet.FrameHeight,
                FrameCount = sheet.FrameCount, Fps = sheet.Fps, IdleFrames = sheet.IdleFrames.ToList(),
                AnchorX = sheet.AnchorX, AnchorY = sheet.AnchorY
            }
        },
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
    /// <summary>Keep server-owned AI metadata (preset, contract versions, review stamps). Ignored in Production.</summary>
    public bool PreserveServerMetadata { get; set; }
}

public class CaseValidationResponse
{
    public bool IsValid { get; set; }
    public List<CaseValidationError> Errors { get; set; } = new();
    /// <summary>Non-blocking findings, such as missing hint levels on a case that already existed.</summary>
    public List<CaseValidationError> Warnings { get; set; } = new();
}
