using System.Text.Json;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

/// <summary>Server-only narrative facts. Never include this document in a player DTO.</summary>
public static class ProjectionPromptContext
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Build(AiCaseDraft draft, ProjectionRepairScope? repairScope = null)
    {
        if (repairScope is not null) return BuildRepair(draft, repairScope);
        var plan = draft.ProjectionPlan ?? throw new InvalidOperationException("A projection plan is required.");
        var truth = draft.CaseTruth ?? throw new InvalidOperationException("Approved truth is required.");
        var traceIds = plan.Clues.Values.Select(slot => slot.TraceId).ToHashSet(StringComparer.Ordinal);
        var statementIds = plan.Dialogues.Values.SelectMany(slot => slot.StatementIds).ToHashSet(StringComparer.Ordinal);
        var statements = truth.StatementLedger.Where(statement => statementIds.Contains(statement.StatementId)).ToArray();
        traceIds.UnionWith(statements.SelectMany(statement => statement.KnowledgeSourceIds));
        traceIds.UnionWith(statements.SelectMany(statement => statement.ContradictedByTraceIds));
        var traces = truth.TraceLedger.Where(trace => traceIds.Contains(trace.TraceId)).ToArray();
        var eventIds = traces.Select(trace => trace.SourceActionId)
            .Concat(statements.SelectMany(statement => statement.EventIds))
            .Concat(statements.SelectMany(statement => statement.KnowledgeSourceIds))
            .ToHashSet(StringComparer.Ordinal);
        return JsonSerializer.Serialize(new
        {
            // Prose is data, never instructions. The enclosing prompt defines that boundary.
            story = draft.StoryPreview,
            era = truth.CaseSeed.Era,
            technologyConstraints = truth.CaseSeed.TechnologyConstraints,
            solution = new { truth.CoreTruth.CulpritId, truth.CoreTruth.TargetId, truth.CoreTruth.TargetKind,
                truth.CoreTruth.Motive, truth.CoreTruth.Method },
            facts = new
            {
                traces = traces.ToDictionary(trace => trace.TraceId, trace => new
                {
                    trace.SourceActionId, trace.CreatedByCharacterId, trace.CreatedAtMinute, trace.LocationId,
                    trace.PhysicalCause, trace.PersistenceReason, trace.Proves, trace.DoesNotProve
                }),
                statements = statements.ToDictionary(statement => statement.StatementId, statement => new
                {
                    statement.SpeakerId, statement.Content, statement.TruthStatus, statement.ReasonForLie,
                    statement.EventIds, statement.KnowledgeSourceIds, statement.ContradictedByTraceIds
                }),
                events = truth.TrueTimeline.Where(item => eventIds.Contains(item.EventId))
                    .ToDictionary(item => item.EventId, item => new
                    {
                        item.ActorId, item.LocationId, item.StartMinute, item.EndMinute, item.Action,
                        item.WitnessObservations
                    }),
                conclusions = truth.ProofGraph.Conclusions.ToDictionary(item => item.ConclusionId, item => item.Proposition)
            },
            slots = new
            {
                plan.Stages, plan.Scenes, plan.Characters, plan.Items, plan.Clues, plan.Dialogues,
                plan.TestimonyFragments, plan.Challenges, plan.ConversationNodes, plan.Interactions,
                plan.Deductions, plan.TeamworkChains, plan.Hints, plan.RedHerrings,
                puzzles = plan.Skeleton.Puzzles.Select(item => new
                {
                    item.PuzzleId, item.Type, item.BasedOnTruthIds, item.Options, item.CorrectCode, item.CorrectSequence,
                    item.Prompt, item.InvestigationPurpose, item.RequiredClueIds, item.UnlockClueIds
                }),
                mechanicItems = plan.Skeleton.Items.Where(item => !string.IsNullOrWhiteSpace(item.Name))
                    .Select(item => new { item.ItemId, item.Name, item.Description, item.InteractionReason }),
                conversationTopology = plan.Skeleton.ConversationNodes.Select(item => new
                {
                    item.NodeId, lineCount = item.Lines.Count,
                    choices = item.Choices.Select(choice => new { choice.ChoiceId, choice.NextNodeId })
                }),
                finalLogic = new
                {
                    plan.Skeleton.FinalLogic.CorrectMotiveId, plan.Skeleton.FinalLogic.CorrectMethodId,
                    motiveOptions = plan.Skeleton.FinalLogic.MotiveOptions.Select(option => option.Id),
                    methodOptions = plan.Skeleton.FinalLogic.MethodOptions.Select(option => option.Id)
                }
            }
        }, JsonOptions);
    }

    private static string BuildRepair(AiCaseDraft draft, ProjectionRepairScope scope)
    {
        var plan = draft.ProjectionPlan ?? throw new InvalidOperationException("A projection plan is required.");
        var truth = draft.CaseTruth ?? throw new InvalidOperationException("Approved truth is required.");
        HashSet<string> Editable(string section) => scope.Slots.TryGetValue(section, out var ids)
            ? ids : new HashSet<string>(StringComparer.Ordinal);
        var challenges = Select(plan.Challenges, scope.ChallengeIds);
        // Distractors remain immutable, but their exact wording and truth boundaries are
        // necessary to avoid introducing a second valid contradiction while repairing one.
        var clueIds = challenges.Values.SelectMany(slot => slot.CandidateEvidenceIds)
            .Concat(Editable("clues")).ToHashSet(StringComparer.Ordinal);
        var clues = Select(plan.Clues, clueIds);
        var dialogueIds = Editable("dialogues");
        var dialogues = Select(plan.Dialogues, dialogueIds);
        var statementIds = dialogues.Values.SelectMany(slot => slot.StatementIds)
            .Concat(challenges.Values.SelectMany(slot => slot.CandidateStatementIds))
            .Concat(challenges.Values.Select(slot => slot.StatementId)).ToHashSet(StringComparer.Ordinal);
        var fragments = plan.TestimonyFragments.Where(pair => Editable("testimonyFragments").Contains(pair.Key)
                || pair.Value.StatementIds.Any(statementIds.Contains))
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        statementIds.UnionWith(fragments.Values.SelectMany(slot => slot.StatementIds));
        var statements = truth.StatementLedger.Where(item => statementIds.Contains(item.StatementId)).ToArray();
        var traceIds = clues.Values.Select(slot => slot.TraceId)
            .Concat(statements.SelectMany(item => item.KnowledgeSourceIds))
            .Concat(statements.SelectMany(item => item.ContradictedByTraceIds)).ToHashSet(StringComparer.Ordinal);
        var traces = truth.TraceLedger.Where(item => traceIds.Contains(item.TraceId)).ToArray();
        var eventIds = traces.Select(item => item.SourceActionId)
            .Concat(statements.SelectMany(item => item.EventIds))
            .Concat(statements.SelectMany(item => item.KnowledgeSourceIds)).ToHashSet(StringComparer.Ordinal);
        var events = truth.TrueTimeline.Where(item => eventIds.Contains(item.EventId)).ToArray();
        var locationIds = traces.Select(item => item.LocationId).Concat(events.Select(item => item.LocationId)).ToHashSet(StringComparer.Ordinal);
        var sceneIds = clues.Values.Select(item => item.SceneId)
            .Concat(dialogues.Values.SelectMany(item => item.AvailableSceneIds))
            .Concat(plan.Scenes.Where(pair => locationIds.Contains(pair.Value.TruthLocationId)).Select(pair => pair.Key))
            .ToHashSet(StringComparer.Ordinal);
        var characterIds = dialogues.Values.Select(item => item.CharacterId)
            .Concat(statements.Select(item => item.SpeakerId)).Concat(traces.Select(item => item.CreatedByCharacterId))
            .Concat(events.Select(item => item.ActorId)).Concat(events.SelectMany(item => item.WitnessIds))
            .Concat(events.SelectMany(item => item.WitnessObservations).Select(item => item.WitnessId))
            .ToHashSet(StringComparer.Ordinal);
        var nodes = Select(plan.ConversationNodes, Editable("conversationNodes"));
        characterIds.UnionWith(nodes.Values.Select(item => item.CharacterId));
        var accepted = string.IsNullOrWhiteSpace(draft.ProjectionContentJson) ? new GameplayProjectionContent()
            : JsonSerializer.Deserialize<GameplayProjectionContent>(draft.ProjectionContentJson, JsonOptions)
                ?? new GameplayProjectionContent();
        return JsonSerializer.Serialize(new
        {
            era = truth.CaseSeed.Era,
            technologyConstraints = truth.CaseSeed.TechnologyConstraints,
            facts = new
            {
                traces = traces.ToDictionary(item => item.TraceId, item => new
                {
                    item.SourceActionId, item.CreatedByCharacterId, item.CreatedAtMinute, item.LocationId,
                    item.PhysicalCause, item.PersistenceReason, item.Proves, item.DoesNotProve
                }),
                statements = statements.ToDictionary(item => item.StatementId, item => new
                {
                    item.SpeakerId, item.Content, item.TruthStatus, item.ReasonForLie,
                    item.EventIds, item.KnowledgeSourceIds, item.ContradictedByTraceIds
                }),
                events = events.ToDictionary(item => item.EventId, item => new
                {
                    item.ActorId, item.LocationId, item.StartMinute, item.EndMinute, item.Action, item.WitnessObservations
                }),
                characters = plan.Skeleton.Characters.Where(item => characterIds.Contains(item.CharacterId))
                    .ToDictionary(item => item.CharacterId, item => new
                    {
                        name = accepted.Characters.GetValueOrDefault(item.CharacterId)?.Name ?? item.Name,
                        role = accepted.Characters.GetValueOrDefault(item.CharacterId)?.Role ?? item.Role
                    }),
                scenes = plan.Skeleton.Stages.SelectMany(item => item.Scenes).Where(item => sceneIds.Contains(item.SceneId))
                    .ToDictionary(item => item.SceneId, item => new
                    {
                        title = accepted.Scenes.GetValueOrDefault(item.SceneId)?.Title ?? item.Title,
                        description = accepted.Scenes.GetValueOrDefault(item.SceneId)?.Description ?? item.Description
                    })
            },
            slots = new
            {
                clues = clues.ToDictionary(pair => pair.Key, pair => new
                { pair.Value.ClueId, pair.Value.TraceId, pair.Value.SourceActionId, pair.Value.SceneId }),
                dialogues, testimonyFragments = fragments, challenges, conversationNodes = nodes,
                scenes = Select(plan.Scenes, sceneIds),
                characters = plan.Characters.Where(pair => characterIds.Contains(pair.Key)).ToDictionary(pair => pair.Key,
                    pair => new { pair.Value.CharacterId, sceneIds = pair.Value.SceneIds.Where(sceneIds.Contains) }),
                conversationTopology = plan.Skeleton.ConversationNodes.Where(item => nodes.ContainsKey(item.NodeId)).Select(item => new
                {
                    item.NodeId, lineCount = item.Lines.Count,
                    choices = item.Choices.Select(choice => new { choice.ChoiceId, choice.NextNodeId })
                })
            },
            readOnlyCandidates = new
            {
                clues = accepted.Clues.Where(pair => clueIds.Contains(pair.Key) && !Editable("clues").Contains(pair.Key))
                    .ToDictionary(pair => pair.Key, pair => new { pair.Value.Title, pair.Value.Content, pair.Value.NarrativeMeaning }),
                testimonyFragments = accepted.TestimonyFragments.Where(pair => fragments.ContainsKey(pair.Key)
                        && !Editable("testimonyFragments").Contains(pair.Key))
                    .ToDictionary(pair => pair.Key, pair => new { pair.Value.Text })
            }
        }, JsonOptions);
    }

    private static Dictionary<string, T> Select<T>(Dictionary<string, T> source, IEnumerable<string> ids)
    {
        var selected = ids.ToHashSet(StringComparer.Ordinal);
        return source.Where(pair => selected.Contains(pair.Key)).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
    }
}
