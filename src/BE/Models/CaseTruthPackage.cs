using System.Text.Json.Serialization;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

public static class CaseLogicContractVersions
{
    public const int LegacyThreeClaim = 1;
    public const int CausalFiveClaim = 2;
}

public static class CaseLogicVerificationStatuses
{
    public const string LegacyUnverified = "LEGACY_UNVERIFIED";
    public const string CausalVerified = "CAUSAL_VERIFIED";
}

public static class CaseTruthSchemaVersions
{
    public const string V1 = "case-truth-v1";
    public const string V2 = "case-truth-v2";
    public const string FeasibilityReviewV1 = "case-truth-feasibility-review-v1";
    public const string FeasibilityReviewV2 = "case-truth-feasibility-review-v2";
    public const string BlindReviewV1 = "case-blind-solvability-review-v1";
    public const string BlindReviewV2 = "case-blind-solvability-review-v2";
}

public static class CaseTargetKinds
{
    public const string Character = "CHARACTER";
    public const string Asset = "ASSET";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        Character, Asset
    };

    public static bool IsAsset(CoreCaseTruth truth) =>
        truth.TargetKind == Asset;
}

public static class CaseTruthReviewStatuses
{
    public const string NotRun = "NOT_RUN";
    public const string Passed = "PASSED";
    public const string Failed = "FAILED";
    public const string Ambiguous = "AMBIGUOUS";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        NotRun, Passed, Failed, Ambiguous
    };
}

public static class CaseTruthReviewFindingCodes
{
    public const string TimelineFeasibility = "TIMELINE_FEASIBILITY";
    public const string TravelFeasibility = "TRAVEL_FEASIBILITY";
    public const string PhysicalCausality = "PHYSICAL_CAUSALITY";
    public const string WitnessObservability = "WITNESS_OBSERVABILITY";
    public const string AlibiSupport = "ALIBI_SUPPORT";
    public const string OpportunityConsistency = "OPPORTUNITY_CONSISTENCY";
    public const string TracePersistence = "TRACE_PERSISTENCE";
    public const string MissingCausalAntecedent = "MISSING_CAUSAL_ANTECEDENT";
    public const string ProofScope = "PROOF_SCOPE";
    public const string SolutionAmbiguity = "SOLUTION_AMBIGUITY";
    public const string Other = "OTHER";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        TimelineFeasibility, TravelFeasibility, PhysicalCausality, WitnessObservability,
        AlibiSupport, OpportunityConsistency, TracePersistence, MissingCausalAntecedent,
        ProofScope, SolutionAmbiguity, Other
    };
}

public static class CaseTruthScopeLimits
{
    public const int MaxTraceEntries = 18;
}

public static class StatementTruthStatuses
{
    public const string True = "TRUE";
    public const string False = "FALSE";
    public const string Misleading = "MISLEADING";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        True, False, Misleading
    };
}

public static class ProofConclusionCategories
{
    public const string Motive = "MOTIVE";
    public const string Method = "METHOD";
    public const string Opportunity = "OPPORTUNITY";
    public const string Identity = "IDENTITY";
    public const string Timeline = "TIMELINE";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        Motive, Method, Opportunity, Identity, Timeline
    };
}

/// <summary>
/// Stable IDs shared by evidence, statement, and proof-graph stages. These IDs are known before
/// the proof graph is generated, so no stage invents a forward reference independently.
/// </summary>
public static class ProofConclusionIds
{
    public const string Motive = "conclusion-motive";
    public const string Method = "conclusion-method";
    public const string Opportunity = "conclusion-opportunity";
    public const string Identity = "conclusion-identity";
    public const string Timeline = "conclusion-timeline";

    public static readonly IReadOnlyDictionary<string, string> ByCategory =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [ProofConclusionCategories.Motive] = Motive,
            [ProofConclusionCategories.Method] = Method,
            [ProofConclusionCategories.Opportunity] = Opportunity,
            [ProofConclusionCategories.Identity] = Identity,
            [ProofConclusionCategories.Timeline] = Timeline
        };

    public static readonly IReadOnlySet<string> All = ByCategory.Values.ToHashSet(StringComparer.Ordinal);

    public static string ForCategory(string category) =>
        ByCategory.TryGetValue(category, out var id) ? id : string.Empty;
}

[BsonIgnoreExtraElements]
public sealed class CaseTruthPackage
{
    public string SchemaVersion { get; set; } = CaseTruthSchemaVersions.V1;
    public CaseSeed CaseSeed { get; set; } = new();
    public CoreCaseTruth CoreTruth { get; set; } = new();
    public List<TrueTimelineEvent> TrueTimeline { get; set; } = new();
    public List<CharacterOpportunity> OpportunityMatrix { get; set; } = new();
    public List<TraceLedgerEntry> TraceLedger { get; set; } = new();
    public List<StatementLedgerEntry> StatementLedger { get; set; } = new();
    public ProofGraph ProofGraph { get; set; } = new();
    public List<RedHerringLedgerEntry> RedHerringLedger { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class CaseSeed
{
    public string CrimeType { get; set; } = string.Empty;
    public string Era { get; set; } = string.Empty;
    public List<string> TechnologyConstraints { get; set; } = new();
    public string Difficulty { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public List<string> SuspectIds { get; set; } = new();
    public List<string> LocationIds { get; set; } = new();
    public List<LocationTravelEdge> LocationGraph { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class LocationTravelEdge
{
    public string FromLocationId { get; set; } = string.Empty;
    public string ToLocationId { get; set; } = string.Empty;
    public int TravelMinutes { get; set; }
}

[BsonIgnoreExtraElements]
public sealed class CoreCaseTruth
{
    public string CulpritId { get; set; } = string.Empty;
    public string TargetId { get; set; } = string.Empty;
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    [BsonIgnoreIfDefault]
    public string TargetKind { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public List<string> PreparationActionIds { get; set; } = new();
    public List<string> CrimeActionIds { get; set; } = new();
    public List<string> ConcealmentActionIds { get; set; } = new();
    public List<string> CulpritMistakeActionIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class TrueTimelineEvent
{
    public string EventId { get; set; } = string.Empty;
    public string ActorId { get; set; } = string.Empty;
    public string LocationId { get; set; } = string.Empty;
    public int StartMinute { get; set; }
    public int EndMinute { get; set; }
    public int TravelFromPreviousMinutes { get; set; }
    public string Action { get; set; } = string.Empty;
    public List<string> WitnessIds { get; set; } = new();
    public List<WitnessObservation> WitnessObservations { get; set; } = new();
    public List<string> TraceIds { get; set; } = new();
    public List<string> RequiredAccessIds { get; set; } = new();
    public List<string> RequiredToolIds { get; set; } = new();
    public List<string> RequiredKnowledgeIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class WitnessObservation
{
    public string WitnessId { get; set; } = string.Empty;
    public string Mode { get; set; } = string.Empty;
    public bool LineOfSightOrHearingClear { get; set; }
    public string ObservableDetail { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public sealed class CharacterOpportunity
{
    public string CharacterId { get; set; } = string.Empty;
    public bool HasMotive { get; set; }
    public List<string> AccessIds { get; set; } = new();
    public List<string> ToolIds { get; set; } = new();
    public List<string> KnowledgeIds { get; set; } = new();
    public int AvailableFromMinute { get; set; }
    public int AvailableToMinute { get; set; }
    public List<string> AlibiEventIds { get; set; } = new();
    public bool AlibiVerified { get; set; }
    public bool IdentityLinkedToCrime { get; set; }
    public string EliminationReason { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public sealed class TraceLedgerEntry
{
    public string TraceId { get; set; } = string.Empty;
    public string SourceActionId { get; set; } = string.Empty;
    public string CreatedByCharacterId { get; set; } = string.Empty;
    public int CreatedAtMinute { get; set; }
    public string LocationId { get; set; } = string.Empty;
    public string PhysicalCause { get; set; } = string.Empty;
    public string PersistenceReason { get; set; } = string.Empty;
    public string Proves { get; set; } = string.Empty;
    public string DoesNotProve { get; set; } = string.Empty;
    public string IndependentSourceGroup { get; set; } = string.Empty;
    public List<string> SupportsConclusionIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class StatementLedgerEntry
{
    public string StatementId { get; set; } = string.Empty;
    public string SpeakerId { get; set; } = string.Empty;
    public string TruthStatus { get; set; } = StatementTruthStatuses.True;
    public string Content { get; set; } = string.Empty;
    public List<string> EventIds { get; set; } = new();
    public List<string> KnowledgeSourceIds { get; set; } = new();
    public string ReasonForLie { get; set; } = string.Empty;
    public List<string> ContradictedByTraceIds { get; set; } = new();
    public string IndependentSourceGroup { get; set; } = string.Empty;
    public List<string> SupportsConclusionIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class ProofGraph
{
    public List<ProofConclusion> Conclusions { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class ProofConclusion
{
    public string ConclusionId { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Proposition { get; set; } = string.Empty;
    public List<string> SupportingTraceIds { get; set; } = new();
    public List<string> SupportingStatementIds { get; set; } = new();
    public List<string> ExcludesSuspectIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class RedHerringLedgerEntry
{
    public string RedHerringId { get; set; } = string.Empty;
    public string SuspectId { get; set; } = string.Empty;
    public string SuspiciousReason { get; set; } = string.Empty;
    public string InnocentExplanation { get; set; } = string.Empty;
    public List<string> ClearingTraceIds { get; set; } = new();
    public List<string> ClearingStatementIds { get; set; } = new();
}

[BsonIgnoreExtraElements]
public sealed class CaseTruthReviewFinding
{
    public string FindingId { get; set; } = string.Empty;
    public string Code { get; set; } = CaseTruthReviewFindingCodes.Other;
    public List<string> RelatedIds { get; set; } = new();
    public string Message { get; set; } = string.Empty;
}

[BsonIgnoreExtraElements]
public sealed class CaseTruthFeasibilityReview
{
    public string Status { get; set; } = CaseTruthReviewStatuses.NotRun;
    public string SchemaVersion { get; set; } = CaseTruthSchemaVersions.FeasibilityReviewV1;
    public double Confidence { get; set; }
    public bool TimelineFeasible { get; set; }
    public bool PhysicalCausalityFeasible { get; set; }
    public bool UniqueSolution { get; set; }
    /// <summary>Legacy V1 reviewer messages. New reviewer calls return Findings instead.</summary>
    public List<string> Issues { get; set; } = new();
    public List<CaseTruthReviewFinding> Findings { get; set; } = new();
    public DateTime? ReviewedAt { get; set; }
}

[BsonIgnoreExtraElements]
public sealed class BlindSolvabilityReview
{
    public string Status { get; set; } = CaseTruthReviewStatuses.NotRun;
    public string SchemaVersion { get; set; } = CaseTruthSchemaVersions.BlindReviewV1;
    public string CulpritId { get; set; } = string.Empty;
    public string Motive { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public string TimelineSummary { get; set; } = string.Empty;
    public List<string> EvidenceChainIds { get; set; } = new();
    public bool UniqueSolution { get; set; }
    public double Confidence { get; set; }
    /// <summary>Legacy V1 reviewer messages. New reviewer calls return Findings instead.</summary>
    public List<string> Issues { get; set; } = new();
    public List<CaseTruthReviewFinding> Findings { get; set; } = new();
    public DateTime? ReviewedAt { get; set; }
}

[BsonIgnoreExtraElements]
public sealed class AiArtifactProvenance
{
    public string Artifact { get; set; } = string.Empty;
    public string InputHash { get; set; } = string.Empty;
    public string OutputHash { get; set; } = string.Empty;
    public bool IsStale { get; set; }
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
}
