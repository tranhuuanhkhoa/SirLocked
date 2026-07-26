using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public interface IProjectionReadinessAnalyzer
{
    ProjectionCapacity AnalyzeCapacity(AiDraftSettings settings);
    FinalEvidenceAllocation MatchFinalEvidence(CaseTruthPackage truth);
    DialogueAllocation AllocateDialogues(CaseTruthPackage truth, AiGenerationContract contract);
}

public sealed class FinalEvidenceAllocation
{
    public Dictionary<string, TraceLedgerEntry> EvidenceByCategory { get; } =
        new(StringComparer.Ordinal);

    public CaseValidationResult Validation { get; } = new();
}

public sealed class DialogueAllocation
{
    public List<DialogueAllocationSlot> Slots { get; } = new();
    public CaseValidationResult Validation { get; } = new();
}

public sealed class DialogueAllocationSlot
{
    public string DialogueId { get; set; } = string.Empty;
    public string CharacterId { get; set; } = string.Empty;
    public List<string> StatementIds { get; set; } = new();
    public List<string> AvailableSceneIds { get; set; } = new();
}

public sealed class ProjectionReadinessAnalyzer : IProjectionReadinessAnalyzer
{
    public ProjectionCapacity AnalyzeCapacity(AiDraftSettings settings) =>
        ProjectionCapacityPolicy.For(settings);

    public FinalEvidenceAllocation MatchFinalEvidence(CaseTruthPackage truth)
    {
        var result = new FinalEvidenceAllocation();
        var categories = EvidenceClaimTypes
            .OrderedForContract(CaseLogicContractVersions.CausalFiveClaim)
            .ToList();
        var traceCandidates = new Dictionary<string, List<TraceLedgerEntry>>(StringComparer.Ordinal);

        foreach (var category in categories)
        {
            var conclusionId = ProofConclusionIds.ForCategory(category);
            var candidates = truth.TraceLedger
                .Where(trace => trace.SupportsConclusionIds.Contains(conclusionId, StringComparer.Ordinal))
                .ToList();
            traceCandidates[category] = candidates;
            if (candidates.Count == 0)
            {
                result.Validation.Add(
                    "ProjectionMissingConclusionTrace",
                    "traceLedger",
                    $"Conclusion {category} needs at least one supporting causal trace.",
                    conclusionId);
            }
        }

        if (!result.Validation.IsValid)
            return result;

        var traceToCategory = new Dictionary<string, string>(StringComparer.Ordinal);
        bool Assign(string category, HashSet<string> seen)
        {
            foreach (var trace in traceCandidates[category])
            {
                if (!seen.Add(trace.TraceId))
                    continue;
                if (!traceToCategory.TryGetValue(trace.TraceId, out var occupied)
                    || Assign(occupied, seen))
                {
                    traceToCategory[trace.TraceId] = category;
                    return true;
                }
            }
            return false;
        }

        foreach (var category in categories)
        {
            if (Assign(category, new HashSet<string>(StringComparer.Ordinal)))
                continue;
            result.Validation.Add(
                "ProjectionFinalEvidenceDiversity",
                "traceLedger",
                "The five final claim categories need five distinct supporting traces.");
            return result;
        }

        foreach (var (traceId, category) in traceToCategory)
            result.EvidenceByCategory[category] =
                truth.TraceLedger.First(trace => trace.TraceId == traceId);
        return result;
    }

    public DialogueAllocation AllocateDialogues(
        CaseTruthPackage truth,
        AiGenerationContract contract)
    {
        var result = new DialogueAllocation();
        var timelineById = truth.TrueTimeline
            .Where(item => !string.IsNullOrWhiteSpace(item.EventId))
            .GroupBy(item => item.EventId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var sceneOrder = truth.TrueTimeline
            .OrderBy(item => item.StartMinute)
            .ThenBy(item => item.EndMinute)
            .Select(item => item.LocationId)
            .Concat(truth.TraceLedger.Select(item => item.LocationId))
            .Concat(truth.CaseSeed.LocationIds)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var sceneIndexes = sceneOrder
            .Select((sceneId, index) => (sceneId, index))
            .ToDictionary(item => item.sceneId, item => item.index, StringComparer.Ordinal);
        var statementById = truth.StatementLedger
            .Where(item => !string.IsNullOrWhiteSpace(item.StatementId))
            .GroupBy(item => item.StatementId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var mandatoryIds = truth.StatementLedger
            .Where(item => item.ContradictedByTraceIds.Count > 0)
            .Select(item => item.StatementId)
            .Concat(truth.RedHerringLedger.SelectMany(item => item.ClearingStatementIds))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var groups = new List<MutableDialogueGroup>();
        foreach (var statementId in mandatoryIds)
        {
            if (!statementById.TryGetValue(statementId, out var statement))
                continue;
            var group = CreateGroup(statement, timelineById, sceneIndexes);
            if (group.AvailableSceneIds.Count == 0)
            {
                result.Validation.Add(
                    "ProjectionStatementSceneUnavailable",
                    "statementLedger",
                    "A required statement has no referenced truth event at a projectable scene.",
                    statement.StatementId);
                continue;
            }
            groups.Add(group);
        }

        foreach (var statement in truth.StatementLedger)
        {
            if (groups.Count >= contract.MinDialogues)
                break;
            if (groups.Any(group => group.StatementIds.Contains(statement.StatementId, StringComparer.Ordinal)))
                continue;
            var group = CreateGroup(statement, timelineById, sceneIndexes);
            if (group.AvailableSceneIds.Count > 0)
                groups.Add(group);
        }

        while (groups.Count > contract.MaxDialogues)
        {
            var merged = false;
            for (var left = 0; left < groups.Count && !merged; left++)
            {
                for (var right = left + 1; right < groups.Count; right++)
                {
                    if (groups[left].CharacterId != groups[right].CharacterId)
                        continue;
                    var available = groups[left].AvailableSceneIds
                        .Intersect(groups[right].AvailableSceneIds, StringComparer.Ordinal)
                        .OrderBy(sceneId => sceneIndexes.GetValueOrDefault(sceneId, int.MaxValue))
                        .ToList();
                    if (available.Count == 0)
                        continue;
                    groups[left].StatementIds.AddRange(groups[right].StatementIds);
                    groups[left].AvailableSceneIds = available;
                    groups.RemoveAt(right);
                    merged = true;
                    break;
                }
            }
            if (!merged)
                break;
        }

        if (groups.Count > contract.MaxDialogues)
        {
            result.Validation.Add(
                "ProjectionDialogueBudget",
                "statementLedger",
                $"Truth closure needs {groups.Count} compatible dialogue groups but the preset allows {contract.MaxDialogues}.");
        }

        if (groups.Count == 0 && contract.MinDialogues > 0)
        {
            result.Validation.Add(
                "ProjectionDialogueBudget",
                "statementLedger",
                $"The preset requires at least {contract.MinDialogues} projectable dialogue slots, but no statement has an available speaker scene.");
        }

        var cloneIndex = 0;
        while (groups.Count > 0 && groups.Count < contract.MinDialogues)
        {
            var source = groups[cloneIndex % groups.Count];
            groups.Add(new MutableDialogueGroup
            {
                CharacterId = source.CharacterId,
                StatementIds = source.StatementIds.ToList(),
                AvailableSceneIds = source.AvailableSceneIds.ToList()
            });
            cloneIndex++;
        }

        var baseIdCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var group in groups)
        {
            var baseId = $"dialogue-{group.StatementIds[0]}";
            var occurrence = baseIdCounts.GetValueOrDefault(baseId) + 1;
            baseIdCounts[baseId] = occurrence;
            result.Slots.Add(new DialogueAllocationSlot
            {
                DialogueId = occurrence == 1 ? baseId : $"{baseId}-{occurrence:00}",
                CharacterId = group.CharacterId,
                StatementIds = group.StatementIds.ToList(),
                AvailableSceneIds = group.AvailableSceneIds.ToList()
            });
        }

        result.Validation.Deduplicate();
        return result;
    }

    private static MutableDialogueGroup CreateGroup(
        StatementLedgerEntry statement,
        IReadOnlyDictionary<string, TrueTimelineEvent> timelineById,
        IReadOnlyDictionary<string, int> sceneIndexes)
    {
        var scenes = statement.EventIds
            .Where(timelineById.ContainsKey)
            .Select(eventId => timelineById[eventId])
            .Where(item => item.ActorId == statement.SpeakerId
                           || item.WitnessIds.Contains(statement.SpeakerId, StringComparer.Ordinal))
            .Select(item => item.LocationId)
            .Where(sceneIndexes.ContainsKey)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(sceneId => sceneIndexes[sceneId])
            .ToList();
        return new MutableDialogueGroup
        {
            CharacterId = statement.SpeakerId,
            StatementIds = { statement.StatementId },
            AvailableSceneIds = scenes
        };
    }

    private sealed class MutableDialogueGroup
    {
        public string CharacterId { get; set; } = string.Empty;
        public List<string> StatementIds { get; set; } = new();
        public List<string> AvailableSceneIds { get; set; } = new();
    }
}
