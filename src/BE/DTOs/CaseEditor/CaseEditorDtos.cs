using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.CaseEditor;

/// <summary>Validation shown by the editor after every save: errors block publishing, warnings never do.</summary>
public sealed class CaseEditorValidation
{
    public bool CanPublish { get; set; }
    public List<CaseValidationError> Errors { get; set; } = new();
    public List<CaseValidationError> Warnings { get; set; } = new();
}

public sealed class CaseEditorRevisionSummary
{
    public int Number { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int EditorVersion { get; set; }
    public int ErrorCount { get; set; }
    public int WarningCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedByName { get; set; } = string.Empty;

    public static CaseEditorRevisionSummary From(CaseEditorRevision revision) => new()
    {
        Number = revision.Number,
        Kind = revision.Kind,
        Note = revision.Note,
        Title = revision.Title,
        EditorVersion = revision.EditorVersion,
        ErrorCount = revision.ErrorCount,
        WarningCount = revision.WarningCount,
        CreatedAt = revision.CreatedAt,
        CreatedByName = revision.CreatedByName
    };
}

/// <summary>Everything the editor needs to open a case.</summary>
public sealed class CaseEditorResponse
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    /// <summary>False for a published case: unpublish it first (the editor never changes what players are playing).</summary>
    public bool CanEdit { get; set; }
    public string SourceAiDraftId { get; set; } = string.Empty;
    /// <summary>World of the AI order (filters the NPC library); empty for hand-made cases.</summary>
    public string World { get; set; } = string.Empty;
    /// <summary>"Chơi thử" needs the AI draft the case was imported from.</summary>
    public bool CanPlaytest { get; set; }
    public int Version { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string UpdatedByName { get; set; } = string.Empty;
    public GameCase Case { get; set; } = new();
    public CaseEditorValidation Validation { get; set; } = new();
    public List<CaseEditorRevisionSummary> Revisions { get; set; } = new();
}

public sealed class CaseEditorRevisionResponse
{
    public CaseEditorRevisionSummary Revision { get; set; } = new();
    public GameCase Case { get; set; } = new();
}

public sealed class CaseEditorSaveRequest
{
    /// <summary>The version the editor loaded or last saved; an older one is refused with CASE_EDITOR_STALE.</summary>
    public int BaseVersion { get; set; }
    public JsonElement CaseJson { get; set; }
    /// <summary>True for "Lưu phiên bản": also keep a numbered copy. Autosave sends false.</summary>
    public bool Checkpoint { get; set; }
    public string? Note { get; set; }
}

public sealed class CaseEditorSaveResponse
{
    public int Version { get; set; }
    public DateTime UpdatedAt { get; set; }
    public CaseEditorValidation Validation { get; set; } = new();
    public CaseEditorRevisionSummary? Revision { get; set; }
    public List<CaseEditorRevisionSummary> Revisions { get; set; } = new();
}

public sealed class CaseEditorVersionRequest
{
    public int BaseVersion { get; set; }
    public string? Note { get; set; }
}

public sealed class CaseEditorPlaytestRequest
{
    /// <summary>Scene the playtest starts in (A4 "Chơi thử cảnh này"); empty starts at the first scene.</summary>
    public string? SceneId { get; set; }
}

public sealed class CaseEditorPublishResponse
{
    public CaseSummaryResponse Case { get; set; } = new();
    public int Version { get; set; }
    public CaseEditorRevisionSummary Revision { get; set; } = new();
}
