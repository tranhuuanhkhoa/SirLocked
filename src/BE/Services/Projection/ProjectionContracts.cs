using System.Text.Json.Serialization;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public static class GameplayProjectionVersions
{
    public const string Plan = "gameplay-projection-plan-v1";
    public const string Content = "gameplay-projection-content-v1";
    public const string Prompt = "ai-projection-content-prompt-v1";
    public const string V3CrackContent = "v3-crack-content-v1";
    public const string Compiler = "projection-compiler-v1";
}

public static class ProjectionBuildModes
{
    public const string AiCompiled = "AI_COMPILED";
    public const string ManualFullJson = "MANUAL_FULL_JSON";
    public const string LegacyFullJson = "LEGACY_FULL_JSON";
}

[BsonIgnoreExtraElements]
public sealed class GameplayProjectionPlan
{
    public string SchemaVersion { get; set; } = GameplayProjectionVersions.Plan;
    public string CompilerVersion { get; set; } = GameplayProjectionVersions.Compiler;
    public string CaseId { get; set; } = string.Empty;
    public string TruthHash { get; set; } = string.Empty;
    public string SettingsHash { get; set; } = string.Empty;
    public string BlueprintHash { get; set; } = string.Empty;
    public string PlanHash { get; set; } = string.Empty;
    public GameCase Skeleton { get; set; } = new();
    public Dictionary<string, StageProjectionSlot> Stages { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, SceneProjectionSlot> Scenes { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, CharacterProjectionSlot> Characters { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ItemProjectionSlot> Items { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ClueProjectionSlot> Clues { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, DialogueProjectionSlot> Dialogues { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, TestimonyProjectionSlot> TestimonyFragments { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, PuzzleProjectionSlot> Puzzles { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, DeductionProjectionSlot> Deductions { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ChallengeProjectionSlot> Challenges { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ConversationProjectionSlot> ConversationNodes { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, InteractionProjectionSlot> Interactions { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, TeamworkProjectionSlot> TeamworkChains { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, HintProjectionSlot> Hints { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, RedHerringProjectionSlot> RedHerrings { get; set; } = new(StringComparer.Ordinal);
    public FinalLogicProjectionSlot FinalLogic { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class StageProjectionSlot
{
    public string StageId { get; set; } = string.Empty;
    public int Order { get; set; }
    public List<string> SceneIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class SceneProjectionSlot
{
    public string SceneId { get; set; } = string.Empty;
    public string TruthLocationId { get; set; } = string.Empty;
    public string StageId { get; set; } = string.Empty;
    public int Order { get; set; }
}

[BsonIgnoreExtraElements]
public sealed class CharacterProjectionSlot
{
    public string CharacterId { get; set; } = string.Empty;
    public List<string> SceneIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class ItemProjectionSlot
{
    public string ItemId { get; set; } = string.Empty;
    public List<string> SceneIds { get; set; } = new();
    public List<string> InteractionIds { get; set; } = new();
    public List<string> UnlockClueIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class ClueProjectionSlot
{
    public string ClueId { get; set; } = string.Empty;
    public string TraceId { get; set; } = string.Empty;
    public string SourceActionId { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public string IndependentSourceGroup { get; set; } = string.Empty;
    public List<string> SupportsConclusionIds { get; set; } = new();
    public string AcquisitionSourceType { get; set; } = string.Empty;
    public string AcquisitionSourceId { get; set; } = string.Empty;
    public string AcquisitionMethod { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public sealed class DialogueProjectionSlot
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public List<string> StatementIds { get; set; } = new();
    public List<string> AvailableSceneIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class TestimonyProjectionSlot
{
    public string FragmentId { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public List<string> StatementIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class PuzzleProjectionSlot
{
    public string PuzzleId { get; set; } = string.Empty;
    public List<string> BasedOnTruthIds { get; set; } = new();
    public List<string> RevealsConclusionIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class DeductionProjectionSlot
{
    public string DeductionId { get; set; } = string.Empty;
    public string ConclusionId { get; set; } = string.Empty;
    public List<string> RequiredClueIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class ChallengeProjectionSlot
{
    public string ChallengeId { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string StatementId { get; set; } = string.Empty;
    public string CorrectEvidenceId { get; set; } = string.Empty;
    public string CorrectTraceId { get; set; } = string.Empty;
    public List<string> CandidateEvidenceIds { get; set; } = new();
    public List<string> CandidateStatementIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class ConversationProjectionSlot
{
    public string NodeId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public string ChallengeId { get; set; } = string.Empty;
    public List<string> NextNodeIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class InteractionProjectionSlot
{
    public string InteractionId { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public List<string> RequiredItemIds { get; set; } = new();
    public List<string> RequiredClueIds { get; set; } = new();
    public List<string> UnlockItemIds { get; set; } = new();
    public List<string> UnlockClueIds { get; set; } = new();
    public List<string> UnlockSceneIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class TeamworkProjectionSlot
{
    public string ChainId { get; set; } = string.Empty;
    public string InvestigatorClueId { get; set; } = string.Empty;
    public string InterrogatorChallengeId { get; set; } = string.Empty;
    public string DeductionId { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public sealed class HintProjectionSlot
{
    public string HintId { get; set; } = string.Empty;
    public string ContextType { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    public int Order { get; set; }
}

[BsonIgnoreExtraElements]
public sealed class RedHerringProjectionSlot
{
    public string RedHerringId { get; set; } = string.Empty;
    public string ClueId { get; set; } = string.Empty;
    public List<string> ClearingClueIds { get; set; } = new();
    public List<string> ClearingDialogueIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class FinalLogicProjectionSlot
{
    public string CulpritId { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<FinalEvidenceProjectionSlot> EvidenceLinks { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class FinalEvidenceProjectionSlot
{
    public string ClaimType { get; set; } = string.Empty;
    public string ConclusionId { get; set; } = string.Empty;
    public string EvidenceId { get; set; } = string.Empty;
}

public sealed class GameplayProjectionContent
{
    public string SchemaVersion { get; set; } = GameplayProjectionVersions.Content;
    public string PlanHash { get; set; } = string.Empty;
    public CaseProjectionContent Case { get; set; } = new();
    public Dictionary<string, StageProjectionContent> Stages { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, SceneProjectionContent> Scenes { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, CharacterProjectionContent> Characters { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ItemProjectionContent> Items { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ClueProjectionContent> Clues { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, DialogueProjectionContent> Dialogues { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, TestimonyProjectionContent> TestimonyFragments { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ChallengeProjectionContent> EvidenceChallenges { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ConversationProjectionContent> ConversationNodes { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, PuzzleProjectionContent> Puzzles { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, InteractionProjectionContent> Interactions { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, DeductionProjectionContent> Deductions { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, TeamworkProjectionContent> RequiredTeamworkChains { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, HintProjectionContent> Hints { get; set; } = new(StringComparer.Ordinal);
    public FinalProjectionContent FinalLogic { get; set; } = new();
}

public sealed class V3CrackContent
{
    public string SchemaVersion { get; set; } = GameplayProjectionVersions.V3CrackContent;
    public string PlanHash { get; set; } = string.Empty;
    public Dictionary<string, ClueProjectionContent> Clues { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, DialogueProjectionContent> Dialogues { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, TestimonyProjectionContent> TestimonyFragments { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ChallengeProjectionContent> EvidenceChallenges { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ConversationProjectionContent> ConversationNodes { get; set; } = new(StringComparer.Ordinal);
}

public sealed class CaseProjectionContent
{
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
}

public sealed class StageProjectionContent
{
    public string StageId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
}

public sealed class SceneProjectionContent
{
    public string SceneId { get; set; } = string.Empty;
    public string TruthLocationId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
}

public sealed class CharacterProjectionContent
{
    public string CharacterId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
}

public sealed class ItemProjectionContent
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string InspectText { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
    public string InteractionReason { get; set; } = string.Empty;
}

public sealed class ClueProjectionContent
{
    public string ClueId { get; set; } = string.Empty;
    public string TraceId { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public string SourceActionId { get; set; } = string.Empty;
    public List<string> SupportsConclusionIds { get; set; } = new();
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string VisualDescription { get; set; } = string.Empty;
    public string InventoryDescription { get; set; } = string.Empty;
    public string NarrativeMeaning { get; set; } = string.Empty;
}

public sealed class DialogueProjectionContent
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public List<string> StatementIds { get; set; } = new();
    public string Question { get; set; } = string.Empty;
    public string Answer { get; set; } = string.Empty;
}

public sealed class TestimonyProjectionContent
{
    public string FragmentId { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

public sealed class ChallengeProjectionContent
{
    public string ChallengeId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string SuccessResponse { get; set; } = string.Empty;
    public string FailureResponse { get; set; } = string.Empty;
    public string RevealTitle { get; set; } = string.Empty;
}

public sealed class ConversationProjectionContent
{
    public string NodeId { get; set; } = string.Empty;
    public List<string> Lines { get; set; } = new();
    public Dictionary<string, string> ChoiceLabels { get; set; } = new(StringComparer.Ordinal);
}

public sealed class PuzzleProjectionContent
{
    public string PuzzleId { get; set; } = string.Empty;
    public List<string> BasedOnTruthIds { get; set; } = new();
    public List<string> RevealsConclusionIds { get; set; } = new();
    public string Prompt { get; set; } = string.Empty;
    public List<string> Options { get; set; } = new();
    public string CorrectCode { get; set; } = string.Empty;
    public List<string> CorrectSequence { get; set; } = new();
    public string InvestigationPurpose { get; set; } = string.Empty;
    public string SuccessMessage { get; set; } = string.Empty;
    public string FailureMessage { get; set; } = string.Empty;
}

public sealed class InteractionProjectionContent
{
    public string InteractionId { get; set; } = string.Empty;
    public string SuccessMessage { get; set; } = string.Empty;
    public string FailureMessage { get; set; } = string.Empty;
}

public sealed class DeductionProjectionContent
{
    public string DeductionId { get; set; } = string.Empty;
    public string ConclusionId { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public Dictionary<string, string> OptionLabels { get; set; } = new(StringComparer.Ordinal);
    public string SuccessResponse { get; set; } = string.Empty;
    public string FailureResponse { get; set; } = string.Empty;
}

public sealed class TeamworkProjectionContent
{
    public string ChainId { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

public sealed class HintProjectionContent
{
    public string HintId { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

public sealed class FinalProjectionContent
{
    public Dictionary<string, string> MotiveOptionLabels { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> MethodOptionLabels { get; set; } = new(StringComparer.Ordinal);
    public string WinEnding { get; set; } = string.Empty;
    public string FailEnding { get; set; } = string.Empty;
}

public sealed class ProjectionPlanningException : Exception
{
    public ProjectionPlanningException(IReadOnlyList<string> errors)
        : base(errors.Count == 0
            ? "Approved truth cannot be projected into the selected gameplay preset."
            : $"Approved truth cannot be projected into the selected gameplay preset. {string.Join(" | ", errors)}")
    {
        Errors = errors;
    }

    public IReadOnlyList<string> Errors { get; }
}

public sealed class ProjectionCompilationException : Exception
{
    public ProjectionCompilationException(IReadOnlyList<string> errors)
        : base("Projection content does not conform to the backend-owned plan.")
    {
        Errors = errors;
    }

    public IReadOnlyList<string> Errors { get; }
}
