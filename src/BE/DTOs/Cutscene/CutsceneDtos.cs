using SirLocked.Api.Services.Cutscene;

namespace SirLocked.Api.DTOs.Cutscene;

public class ComicAssetRef
{
    public string Title { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
}

/// <summary>The images a script may point at, keyed by the ids the script uses. Only art that exists is listed.</summary>
public class ComicAssetsDto
{
    public Dictionary<string, ComicAssetRef> Scenes { get; set; } = new();
    public Dictionary<string, ComicAssetRef> Characters { get; set; } = new();
    public Dictionary<string, ComicAssetRef> Items { get; set; } = new();
    public string CoverUrl { get; set; } = string.Empty;
}

/// <summary>What the player (and the case list) receives: an approved script and its images.</summary>
public class PlayerCutsceneDto
{
    public string CaseId { get; set; } = string.Empty;
    public string Trigger { get; set; } = string.Empty;
    public int Version { get; set; }
    public MotionComicScript Script { get; set; } = new();
    public ComicAssetsDto Assets { get; set; } = new();
}

public class CutsceneVersionDto
{
    public string Id { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public double EstimatedSeconds { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ApprovedAt { get; set; }
}

public class AdminCutsceneDto
{
    public string CaseId { get; set; } = string.Empty;
    /// <summary>Set while a script request waits for, or is being answered by, the Claude bot.</summary>
    public CutsceneClaudeRequestDto? ClaudeRequest { get; set; }
    public List<CutsceneVersionDto> Versions { get; set; } = new();
    /// <summary>The newest version, whatever its status; the editor and preview work on this one.</summary>
    public CutsceneVersionDto? Latest { get; set; }
    public MotionComicScript? Script { get; set; }
    public ComicAssetsDto Assets { get; set; } = new();
}

public class CutsceneGenerateRequest
{
    /// <summary>Must be true to generate again for a case that already has a script (this costs AI budget).</summary>
    public bool Regenerate { get; set; }
}

public class CutsceneScriptUpdateRequest
{
    public MotionComicScript Script { get; set; } = new();
}

public class CutsceneClaudeRequestDto
{
    public string RequestId { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
