using System.ComponentModel.DataAnnotations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;

namespace SirLocked.Api.DTOs.Investigation;

public class InspectItemRequest
{
    [Required]
    public string ItemId { get; set; } = string.Empty;
}

public class UseItemRequest
{
    [Required]
    public string ItemId { get; set; } = string.Empty;

    [Required]
    public string TargetId { get; set; } = string.Empty;
}

public class CombineItemsRequest
{
    [Required]
    public List<string> ItemIds { get; set; } = new();
}

public class ActivateEnvironmentInteractionRequest
{
    [Required]
    public string InteractionId { get; set; } = string.Empty;
}

public class SolvePuzzleRequest
{
    [Required]
    public string PuzzleId { get; set; } = string.Empty;

    public string Answer { get; set; } = string.Empty;

    public List<string> AnswerSequence { get; set; } = new();
}

public class AskDialogueRequest
{
    [Required]
    public string DialogueId { get; set; } = string.Empty;
}

public class ConverseRequest
{
    [Required]
    public string CharacterId { get; set; } = string.Empty;

    public string? NodeId { get; set; }
    public string? ChoiceId { get; set; }
}

public class CaptureRectDto
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}

public class CaptureClueRequest
{
    [Required]
    public string SceneId { get; set; } = string.Empty;

    [Required]
    public CaptureRectDto CaptureRect { get; set; } = new();

    [Required]
    public IFormFile Photo { get; set; } = null!;
}

public class PresentEvidenceRequest
{
    public string DialogueId { get; set; } = string.Empty;

    public string ChallengeId { get; set; } = string.Empty;

    [Required]
    public string EvidenceId { get; set; } = string.Empty;
}

public class HintRequest
{
    [Required]
    public string ContextType { get; set; } = string.Empty;

    [Required]
    public string TargetId { get; set; } = string.Empty;
}

public class HintResponse
{
    public GameStateResponse State { get; set; } = new();
    public string HintId { get; set; } = string.Empty;
    public string ContextType { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public bool IsNew { get; set; }
}

public class SolveDeductionRequest
{
    [Required]
    public string DeductionId { get; set; } = string.Empty;

    [Required]
    public string OptionId { get; set; } = string.Empty;
}

public class InvestigationUpdateDto
{
    public string Type { get; set; } = string.Empty;
    public string ActorUserId { get; set; } = string.Empty;
    public string ActorRole { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public string? TargetId { get; set; }
    /// <summary>NPC the update relates to, when known — lets the client name/badge the right character.</summary>
    public string? CharacterId { get; set; }
    public string Message { get; set; } = string.Empty;
    public long Version { get; set; }
}

public class GoToSceneRequest
{
    [Required]
    public string SceneId { get; set; } = string.Empty;
}

public class HotspotDto
{
    public string HotspotId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public int ZIndex { get; set; }
    public string Label { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public bool IsLocked { get; set; }
    public List<string> MissingClueIds { get; set; } = new();

    public static HotspotDto From(SceneHotspot h, IReadOnlySet<string> unlockedClues)
    {
        var missing = h.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        return new HotspotDto
        {
            HotspotId = h.HotspotId,
            Type = h.Type,
            TargetId = h.TargetId,
            X = h.X,
            Y = h.Y,
            Width = h.Width,
            Height = h.Height,
            ZIndex = h.ZIndex,
            Label = h.Label,
            RequiredClueIds = h.RequiredClueIds,
            IsLocked = missing.Count > 0,
            MissingClueIds = missing
        };
    }
}

public class SceneItemDto
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public bool IsInspected { get; set; }
    /// <summary>InspectText is only revealed after the item has been inspected.</summary>
    public string? InspectText { get; set; }

    public static SceneItemDto From(CaseItem item, bool inspected) => new()
    {
        ItemId = item.ItemId,
        Name = item.Name,
        Description = item.Description,
        ImageUrl = item.ImageUrl,
        IsInspected = inspected,
        InspectText = inspected ? item.InspectText : null
    };
}

public class SceneDialogueDto
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public bool IsLocked { get; set; }
    public List<string> MissingClueIds { get; set; } = new();
    public bool IsAsked { get; set; }
    /// <summary>The answer is only revealed once the dialogue has been asked.</summary>
    public string? Answer { get; set; }
    public List<EvidenceChallengeDto> EvidenceChallenges { get; set; } = new();

    public static SceneDialogueDto From(CaseDialogue d, IReadOnlySet<string> unlockedClues, bool asked)
    {
        var missing = d.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        return new SceneDialogueDto
        {
            DialogueId = d.DialogueId,
            CharacterId = d.CharacterId,
            Question = d.Question,
            RequiredClueIds = d.RequiredClueIds,
            IsLocked = missing.Count > 0,
            MissingClueIds = missing,
            IsAsked = asked,
            Answer = asked ? d.Answer : null
        };
    }
}

public class ClueDto
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsCritical { get; set; }
    public bool IsEvidence { get; set; }
    public string Source { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public string DiscoverMethod { get; set; } = string.Empty;
    public string InventoryDescription { get; set; } = string.Empty;
    public string NarrativeMeaning { get; set; } = string.Empty;
    public List<string> Tags { get; set; } = new();
    public List<string> RelatedCharacterIds { get; set; } = new();
    public string? PhotoUrl { get; set; }

    // isRedHerring is intentionally NOT exposed to players: spotting red herrings is gameplay.
    public static ClueDto From(CaseClue c) => new()
    {
        ClueId = c.ClueId,
        Title = c.Title,
        Content = c.Content,
        IsCritical = c.IsCritical,
        IsEvidence = c.IsEvidence,
        Source = c.Source,
        SourceType = c.SourceType,
        SceneId = c.SceneId,
        DiscoverMethod = string.IsNullOrWhiteSpace(c.DiscoverMethod) ? c.SourceType : c.DiscoverMethod,
        InventoryDescription = c.InventoryDescription,
        NarrativeMeaning = c.NarrativeMeaning,
        Tags = c.Tags,
        RelatedCharacterIds = c.RelatedCharacterIds
    };
}

public class EvidenceChallengeDto
{
    public string ChallengeId { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public bool IsResolved { get; set; }
    public string? Resolution { get; set; }
}

public class ScenePuzzleDto
{
    public string PuzzleId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public List<string> Options { get; set; } = new();
    public int AnswerLength { get; set; }
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public bool IsLocked { get; set; }
    public bool IsSolved { get; set; }
    public List<string> MissingItemIds { get; set; } = new();
    public List<string> MissingClueIds { get; set; } = new();

    public static ScenePuzzleDto From(
        CasePuzzle puzzle,
        IReadOnlySet<string> collectedItems,
        IReadOnlySet<string> unlockedClues,
        IReadOnlySet<string> solvedPuzzles)
    {
        var missingItems = puzzle.RequiredItemIds.Where(id => !collectedItems.Contains(id)).ToList();
        var missingClues = puzzle.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        return new ScenePuzzleDto
        {
            PuzzleId = puzzle.PuzzleId,
            Type = puzzle.Type,
            TargetId = puzzle.TargetId,
            Prompt = puzzle.Prompt,
            Options = puzzle.Options,
            AnswerLength = puzzle.Type.Equals(CasePuzzleTypes.CodePuzzle, StringComparison.OrdinalIgnoreCase)
                ? 1
                : Math.Max(1, puzzle.CorrectSequence.Count),
            RequiredItemIds = puzzle.RequiredItemIds,
            RequiredClueIds = puzzle.RequiredClueIds,
            IsLocked = missingItems.Count > 0 || missingClues.Count > 0,
            IsSolved = solvedPuzzles.Contains(puzzle.PuzzleId),
            MissingItemIds = missingItems,
            MissingClueIds = missingClues
        };
    }
}

public class ConversationLineDto
{
    public string Speaker { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;

    public static ConversationLineDto From(ConversationLine line) => new()
    {
        Speaker = line.Speaker,
        Text = line.Text
    };
}

public class ConversationNodeDto
{
    public string NodeId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public bool IsRoot { get; set; }
    public List<ConversationLineDto> Lines { get; set; } = new();
    public string? ChallengeId { get; set; }

    public static ConversationNodeDto From(ConversationNode node) => new()
    {
        NodeId = node.NodeId,
        CharacterId = node.CharacterId,
        IsRoot = node.IsRoot,
        Lines = node.Lines.Select(ConversationLineDto.From).ToList(),
        ChallengeId = node.ChallengeId
    };
}

public class ConversationChoiceDto
{
    public string ChoiceId { get; set; } = string.Empty;
    public string? Label { get; set; }
    public bool IsLocked { get; set; }

    public static ConversationChoiceDto From(ConversationChoice choice, IReadOnlySet<string> unlockedClues)
    {
        var isLocked = choice.RequiredClueIds.Any(id => !unlockedClues.Contains(id));
        return new ConversationChoiceDto
        {
            ChoiceId = choice.ChoiceId,
            Label = isLocked ? null : choice.Label,
            IsLocked = isLocked
        };
    }
}

public class ConverseResponse
{
    public ConversationNodeDto Node { get; set; } = new();
    public List<ConversationChoiceDto> Choices { get; set; } = new();
    public EvidenceChallengeDto? Challenge { get; set; }
    public List<string> UnlockedClueIds { get; set; } = new();
    public GameStateResponse State { get; set; } = new();
    public bool Changed { get; set; }
}

/// <summary>
/// Authoritative transcript of a visited conversation node, used by the client to
/// rebuild the chat log idempotently. Only visited nodes are projected, so no
/// unseen content leaks.
/// </summary>
public class ConversationTranscriptEntryDto
{
    public string NodeId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public List<ConversationLineDto> Lines { get; set; } = new();
    public EvidenceChallengeDto? Challenge { get; set; }
}

public class ResolvedConfrontationDto
{
    public string ChallengeId { get; set; } = string.Empty;
    public string EvidenceId { get; set; } = string.Empty;
    public string EvidenceTitle { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string Resolution { get; set; } = string.Empty;
    public string ResolvedByUserId { get; set; } = string.Empty;
    public DateTime ResolvedAt { get; set; }
}

public class TestimonyDto
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterName { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public string Answer { get; set; } = string.Empty;
}

public class AccusationOptionDto
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

public class AccusationConfigDto
{
    public List<AccusationOptionDto> MotiveOptions { get; set; } = new();
    public List<AccusationOptionDto> MethodOptions { get; set; } = new();
    public List<string> ClaimTypes { get; set; } = new();
}

public class DeductionOptionDto
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

public class DeductionDto
{
    public string DeductionId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> RequiredChallengeIds { get; set; } = new();
    public List<string> MissingClueIds { get; set; } = new();
    public List<string> MissingChallengeIds { get; set; } = new();
    public List<DeductionOptionDto> Options { get; set; } = new();
    public bool IsAvailable { get; set; }
    public bool IsSolved { get; set; }
    public string? Resolution { get; set; }
}

public class SolvedDeductionDto
{
    public string DeductionId { get; set; } = string.Empty;
    public string SelectedOptionId { get; set; } = string.Empty;
    public string SolvedByUserId { get; set; } = string.Empty;
    public DateTime SolvedAt { get; set; }
}

public class VisibleSceneDto
{
    public string SceneId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string BackgroundUrl { get; set; } = string.Empty;
    public SceneRuntime? Runtime { get; set; }
    public List<HotspotDto> Hotspots { get; set; } = new();
    public List<SceneItemDto> Items { get; set; } = new();
    public List<CaseCharacterDto> Characters { get; set; } = new();
    public List<SceneDialogueDto> AvailableDialogues { get; set; } = new();
    public List<string> ConversationTreeCharacterIds { get; set; } = new();
    public List<ConversationTranscriptEntryDto> ConversationTranscript { get; set; } = new();
    public List<ScenePuzzleDto> Puzzles { get; set; } = new();
}

public class SceneMapEntryDto
{
    public string SceneId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public bool IsCurrent { get; set; }
    public bool IsVisited { get; set; }
    public bool IsUnlocked { get; set; }
    public bool IsCompleted { get; set; }
    /// <summary>How many complete-condition requirements (items, clues, dialogues) are still open here.</summary>
    public int PendingRequirementCount { get; set; }
}

public class ActionLogEntryDto
{
    public string ActionType { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class GameStateResponse
{
    public string RoomId { get; set; } = string.Empty;
    public string RoomCode { get; set; } = string.Empty;
    public string HostUserId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string CaseTitle { get; set; } = string.Empty;
    public string CaseSummary { get; set; } = string.Empty;
    public string Language { get; set; } = CaseLanguages.English;
    public int MechanicsVersion { get; set; }
    public string RoomStatus { get; set; } = string.Empty;
    public string CurrentStageId { get; set; } = string.Empty;
    public string CurrentSceneId { get; set; } = string.Empty;
    public long Version { get; set; }
    public List<RoomPlayerDto> Players { get; set; } = new();
    public List<string> VisitedSceneIds { get; set; } = new();
    public List<string> UnlockedSceneIds { get; set; } = new();
    public List<string> InspectedItemIds { get; set; } = new();
    public List<string> CollectedItemIds { get; set; } = new();
    public List<string> CapturedClueIds { get; set; } = new();
    public List<string> UnlockedClueIds { get; set; } = new();
    public List<string> UsedInteractionIds { get; set; } = new();
    public List<string> SolvedPuzzleIds { get; set; } = new();
    public List<string> AskedDialogueIds { get; set; } = new();
    public List<string> VisitedConversationNodeIds { get; set; } = new();
    public List<string> CompletedSceneIds { get; set; } = new();
    public List<string> CompletedStageIds { get; set; } = new();
    public List<string> SelectedEvidenceIds { get; set; } = new();
    public int WrongPuzzleCount { get; set; }
    public string GameStatus { get; set; } = string.Empty;
    public bool AvailableForAccusation { get; set; }
    public bool CurrentSceneCanComplete { get; set; }
    public MissingRequirementsDto CurrentSceneMissingRequirements { get; set; } = new();
    public string CurrentObjective { get; set; } = string.Empty;
    /// <summary>
    /// True only when the room has completed its normal final-accusation/result flow.
    /// Resolving one or all Crack challenges never completes a V3 case by itself.
    /// </summary>
    public bool IsCaseComplete { get; set; }
    public VisibleSceneDto VisibleScene { get; set; } = new();
    /// <summary>Full metadata for collected items, including items picked up in other scenes.</summary>
    public List<SceneItemDto> CollectedItems { get; set; } = new();
    public List<SceneMapEntryDto> SceneMap { get; set; } = new();
    public List<ClueDto> UnlockedClues { get; set; } = new();
    public List<ClueDto> EvidenceClues { get; set; } = new();
    public List<ResolvedConfrontationDto> ResolvedConfrontations { get; set; } = new();
    public List<DeductionDto> Deductions { get; set; } = new();
    public List<SolvedDeductionDto> SolvedDeductions { get; set; } = new();
    public List<TestimonyDto> Testimonies { get; set; } = new();
    public AccusationConfigDto? AccusationConfig { get; set; }
    /// <summary>All case characters: used by the final accusation suspect picker.</summary>
    public List<CaseCharacterDto> Suspects { get; set; } = new();
    public List<ActionLogEntryDto> ActionLog { get; set; } = new();
    /// <summary>V3 caller-owned physical evidence. Empty for mechanics V1/V2.</summary>
    public List<PrivateEvidenceDto> PrivateEvidence { get; set; } = new();
    /// <summary>V3 caller-owned testimony fragments. Empty for mechanics V1/V2.</summary>
    public List<PrivateTestimonyDto> PrivateTestimonies { get; set; } = new();
    /// <summary>V3 pairs intentionally disclosed through joint review.</summary>
    public SharedKnowledgeDto SharedKnowledge { get; set; } = new();
    /// <summary>Caller-safe view of the single active V3 confrontation.</summary>
    public PairedConfrontationViewDto? ActiveConfrontation { get; set; }
    /// <summary>
    /// The final-accusation proposal awaiting the pair's confirmation, or null when none is open.
    /// Its contents are shared by design: this is the step where both detectives read one decision.
    /// </summary>
    public Submission.AccusationProposalDto? ActiveAccusation { get; set; }
}

public class GameActionResponse
{
    public GameStateResponse State { get; set; } = new();
    public bool Changed { get; set; }
    public List<string> UnlockedClueIds { get; set; } = new();
    public List<string> UnlockedItemIds { get; set; } = new();
    public List<string> UnlockedSceneIds { get; set; } = new();
    public string? InteractionId { get; set; }
    public string? PuzzleId { get; set; }
    public string Message { get; set; } = string.Empty;
    /// <summary>Inspect text / dialogue answer for the action just performed.</summary>
    public string? Detail { get; set; }
    public string CaptureResult { get; set; } = string.Empty;
    public string? MatchedClueId { get; set; }
}

public class MissingRequirementsDto
{
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> RequiredDialogueIds { get; set; } = new();
}
