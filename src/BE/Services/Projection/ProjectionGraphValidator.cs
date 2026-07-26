using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Projection;

public sealed class ProjectionGraphValidator : IProjectionGraphValidator
{
    private readonly ICaseTruthService _truthService;

    public ProjectionGraphValidator(ICaseTruthService truthService)
    {
        _truthService = truthService;
    }

    public CaseValidationResult Validate(
        CaseTruthPackage truth,
        GameplayProjectionPlan plan,
        GameCase gameCase)
    {
        var result = new CaseValidationResult();
        if (plan.SchemaVersion != GameplayProjectionVersions.Plan)
            result.Add("ProjectionSchemaMismatch", "projectionPlan.schemaVersion", "Unsupported projection plan schema.");
        if (plan.TruthHash != _truthService.ComputeHash(truth))
            result.Add("ProjectionTruthHashMismatch", "projectionPlan.truthHash", "Projection plan does not reference the approved truth.");
        if (plan.PlanHash != ProjectionCanonicalizer.ComputePlanHash(plan))
            result.Add("ProjectionPlanHashMismatch", "projectionPlan.planHash", "Projection plan changed after it was hashed.");
        if (gameCase.ProjectionPlanHash != plan.PlanHash
            || gameCase.ProjectionSchemaVersion != plan.SchemaVersion
            || gameCase.ProjectionCompilerVersion != plan.CompilerVersion)
            result.Add("ProjectionCompileMetadataMismatch", "projectionPlanHash", "Compiled case does not reference its exact plan and compiler.");

        var locations = truth.CaseSeed.LocationIds.ToHashSet(StringComparer.Ordinal);
        var events = truth.TrueTimeline.ToDictionary(item => item.EventId, StringComparer.Ordinal);
        var traces = truth.TraceLedger.ToDictionary(item => item.TraceId, StringComparer.Ordinal);
        var statements = truth.StatementLedger.ToDictionary(item => item.StatementId, StringComparer.Ordinal);
        var conclusions = truth.ProofGraph.Conclusions.ToDictionary(item => item.ConclusionId, StringComparer.Ordinal);
        Duplicate(result, "stages", gameCase.Stages.Select(item => item.StageId));
        Duplicate(result, "stages[].scenes", gameCase.Stages.SelectMany(stage => stage.Scenes).Select(item => item.SceneId));
        Duplicate(result, "characters", gameCase.Characters.Select(item => item.CharacterId));
        Duplicate(result, "items", gameCase.Items.Select(item => item.ItemId));
        Duplicate(result, "clues", gameCase.Clues.Select(item => item.ClueId));
        Duplicate(result, "dialogues", gameCase.Dialogues.Select(item => item.DialogueId));
        Duplicate(result, "testimonyFragments", gameCase.TestimonyFragments.Select(item => item.Id));
        Duplicate(result, "puzzles", gameCase.Puzzles.Select(item => item.PuzzleId));
        Duplicate(result, "deductions", gameCase.Deductions.Select(item => item.DeductionId));
        Duplicate(result, "evidenceChallenges", gameCase.EvidenceChallenges.Select(item => item.ChallengeId));
        Duplicate(result, "conversationNodes", gameCase.ConversationNodes.Select(item => item.NodeId));
        Duplicate(result, "interactions", gameCase.Interactions.Select(item => item.InteractionId));
        Duplicate(result, "requiredTeamworkChains", gameCase.RequiredTeamworkChains.Select(item => item.ChainId));
        Duplicate(result, "hints", gameCase.Hints.Select(item => item.HintId));

        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes)
            .GroupBy(item => item.SceneId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var clues = gameCase.Clues.GroupBy(item => item.ClueId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var dialogues = gameCase.Dialogues.GroupBy(item => item.DialogueId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        Exact(result, "stages", plan.Stages.Keys, gameCase.Stages.Select(item => item.StageId));
        Exact(result, "stages[].scenes", plan.Scenes.Keys, scenes.Keys);
        Exact(result, "characters", plan.Characters.Keys, gameCase.Characters.Select(item => item.CharacterId));
        Exact(result, "items", plan.Items.Keys, gameCase.Items.Select(item => item.ItemId));
        Exact(result, "clues", plan.Clues.Keys, clues.Keys);
        Exact(result, "dialogues", plan.Dialogues.Keys, dialogues.Keys);
        Exact(result, "testimonyFragments", plan.TestimonyFragments.Keys, gameCase.TestimonyFragments.Select(item => item.Id));
        Exact(result, "puzzles", plan.Puzzles.Keys, gameCase.Puzzles.Select(item => item.PuzzleId));
        Exact(result, "deductions", plan.Deductions.Keys, gameCase.Deductions.Select(item => item.DeductionId));
        Exact(result, "evidenceChallenges", plan.Challenges.Keys, gameCase.EvidenceChallenges.Select(item => item.ChallengeId));
        Exact(result, "conversationNodes", plan.ConversationNodes.Keys, gameCase.ConversationNodes.Select(item => item.NodeId));
        Exact(result, "interactions", plan.Interactions.Keys, gameCase.Interactions.Select(item => item.InteractionId));
        Exact(result, "requiredTeamworkChains", plan.TeamworkChains.Keys, gameCase.RequiredTeamworkChains.Select(item => item.ChainId));
        Exact(result, "hints", plan.Hints.Keys, gameCase.Hints.Select(item => item.HintId));

        foreach (var (id, slot) in plan.Scenes)
        {
            if (!locations.Contains(slot.TruthLocationId))
                result.Add("ProjectionSceneOrphan", $"projectionPlan.scenes.{id}", "Scene has no approved truth location.", id);
            if (!scenes.TryGetValue(id, out var scene)) continue;
            if (scene.SceneId != slot.TruthLocationId)
                result.Add("ProjectionSceneMismatch", $"scenes.{id}", "Compiled scene changed its truth location.", id);
        }
        foreach (var (id, slot) in plan.Stages)
        {
            var stage = gameCase.Stages.FirstOrDefault(item => item.StageId == id);
            if (stage is null) continue;
            if (stage.Order != slot.Order
                || !stage.Scenes.Select(item => item.SceneId)
                    .SequenceEqual(slot.SceneIds, StringComparer.Ordinal))
                result.Add("ProjectionStageTopologyMismatch", $"stages.{id}", "Compiled stage order or scene topology differs from its plan.", id);
        }
        foreach (var (id, slot) in plan.Characters)
        {
            var actualScenes = gameCase.Stages.SelectMany(stage => stage.Scenes)
                .Where(scene => scene.CharacterIds.Contains(id, StringComparer.Ordinal))
                .Select(scene => scene.SceneId).ToList();
            if (!actualScenes.SequenceEqual(slot.SceneIds, StringComparer.Ordinal))
                result.Add("ProjectionCharacterSceneMismatch", $"characters.{id}", "Compiled character availability differs from its plan.", id);
        }
        foreach (var (id, slot) in plan.Items)
        {
            var item = gameCase.Items.FirstOrDefault(candidate => candidate.ItemId == id);
            var actualScenes = gameCase.Stages.SelectMany(stage => stage.Scenes)
                .Where(scene => scene.ItemIds.Contains(id, StringComparer.Ordinal))
                .Select(scene => scene.SceneId).ToList();
            if (!actualScenes.SequenceEqual(slot.SceneIds, StringComparer.Ordinal))
                result.Add("ProjectionItemSceneMismatch", $"items.{id}", "Compiled item placement differs from its plan.", id);
            if (item is not null
                && !item.UnlockClueIds.SequenceEqual(slot.UnlockClueIds, StringComparer.Ordinal))
                result.Add("ProjectionDependencyMismatch", $"items.{id}.unlockClueIds", "Compiled item evidence rewards differ from the plan.", id);
        }

        foreach (var (id, slot) in plan.Clues)
        {
            if (!traces.TryGetValue(slot.TraceId, out var trace))
            {
                result.Add("ProjectionClueOrphan", $"projectionPlan.clues.{id}.traceId", "Clue trace does not exist.", slot.TraceId);
                continue;
            }
            if (!events.TryGetValue(trace.SourceActionId, out var source))
                result.Add("ProjectionClueOrphan", $"projectionPlan.clues.{id}.sourceActionId", "Clue source action does not exist.", trace.SourceActionId);
            if (slot.SourceActionId != trace.SourceActionId
                || slot.SceneId != trace.LocationId
                || slot.IndependentSourceGroup != trace.IndependentSourceGroup)
                result.Add("ProjectionClueSourceMismatch", $"projectionPlan.clues.{id}", "Clue changed trace action, location, or source group.", id);
            foreach (var conclusionId in slot.SupportsConclusionIds)
            {
                if (!conclusions.TryGetValue(conclusionId, out var conclusion)
                    || !trace.SupportsConclusionIds.Contains(conclusionId, StringComparer.Ordinal)
                    || !conclusion.SupportingTraceIds.Contains(trace.TraceId, StringComparer.Ordinal))
                    result.Add("ProjectionClaimOverreach", $"projectionPlan.clues.{id}.supportsConclusionIds", "Clue claims a conclusion its trace does not support.", conclusionId);
            }
            if (source is not null && source.LocationId != trace.LocationId)
                result.Add("ProjectionTraceLocationMismatch", $"projectionPlan.clues.{id}", "Trace location differs from its source action.", id);
            if (source is not null && source.ActorId != trace.CreatedByCharacterId)
                result.Add("ProjectionTraceActorMismatch", $"projectionPlan.clues.{id}", "Trace creator differs from the actor of its source action.", id);
            if (!clues.TryGetValue(id, out var clue)) continue;
            if (clue.SourceActionId != slot.SourceActionId
                || clue.SceneId != slot.SceneId
                || clue.IndependentSourceGroup != slot.IndependentSourceGroup
                || clue.SourceType != slot.AcquisitionSourceType
                || clue.Source != slot.AcquisitionSourceId
                || clue.AcquisitionMethod != slot.AcquisitionMethod
                || !clue.SupportsConclusionIds.SequenceEqual(slot.SupportsConclusionIds, StringComparer.Ordinal))
                result.Add("ProjectionCompiledClueMismatch", $"clues.{id}", "Compiled clue no longer matches its plan.", id);
            if (clue.IsEvidence && slot.SupportsConclusionIds.Count == 0)
                result.Add("ProjectionEvidenceOrphan", $"clues.{id}", "Gameplay evidence has no path to a proof conclusion.", id);
        }

        foreach (var (id, slot) in plan.Dialogues)
        {
            foreach (var statementId in slot.StatementIds)
            {
                if (!statements.TryGetValue(statementId, out var statement))
                {
                    result.Add("ProjectionDialogueOrphan", $"projectionPlan.dialogues.{id}.statementIds", "Dialogue statement does not exist.", statementId);
                    continue;
                }
                if (statement.SpeakerId != slot.CharacterId)
                    result.Add("ProjectionSpeakerMismatch", $"projectionPlan.dialogues.{id}", "Dialogue speaker differs from approved statement speaker.", statementId);
            }
            if (!dialogues.TryGetValue(id, out var dialogue)) continue;
            if (dialogue.CharacterId != slot.CharacterId
                || !dialogue.StatementIds.SequenceEqual(slot.StatementIds, StringComparer.Ordinal)
                || !dialogue.AvailableSceneIds.SequenceEqual(slot.AvailableSceneIds, StringComparer.Ordinal))
                result.Add("ProjectionCompiledDialogueMismatch", $"dialogues.{id}", "Compiled dialogue no longer matches its plan.", id);
            foreach (var sceneId in slot.AvailableSceneIds)
            {
                if (!scenes.TryGetValue(sceneId, out var scene) || !scene.CharacterIds.Contains(slot.CharacterId))
                    result.Add("ProjectionDialogueSceneMismatch", $"dialogues.{id}.availableSceneIds", "Dialogue speaker is absent from its planned scene.", sceneId);
                }
        }
        foreach (var (id, slot) in plan.TestimonyFragments)
        {
            var fragment = gameCase.TestimonyFragments.FirstOrDefault(item => item.Id == id);
            if (fragment is null) continue;
            if (fragment.DialogueId != slot.DialogueId
                || !dialogues.TryGetValue(slot.DialogueId, out var dialogue)
                || !dialogue.StatementIds.SequenceEqual(slot.StatementIds, StringComparer.Ordinal))
                result.Add("ProjectionTestimonyMismatch", $"testimonyFragments.{id}", "Compiled testimony no longer maps to its approved dialogue statements.", id);
        }

        foreach (var (id, slot) in plan.Challenges)
        {
            if (!traces.ContainsKey(slot.CorrectTraceId)
                || !statements.TryGetValue(slot.StatementId, out var statement)
                || !statement.ContradictedByTraceIds.Contains(slot.CorrectTraceId, StringComparer.Ordinal))
                result.Add("ProjectionChallengeMismatch", $"projectionPlan.challenges.{id}", "Challenge correct pair is not an approved contradiction.", id);
            if (!plan.Clues.ContainsKey(slot.CorrectEvidenceId)
                || slot.CandidateEvidenceIds.Any(candidate => !plan.Clues.ContainsKey(candidate)))
                result.Add("ProjectionChallengeOrphan", $"projectionPlan.challenges.{id}", "Challenge references evidence outside the plan.", id);
            var challenge = gameCase.EvidenceChallenges.FirstOrDefault(item => item.ChallengeId == id);
            if (challenge is not null
                && (challenge.DialogueId != slot.DialogueId
                    || challenge.CorrectEvidenceId != slot.CorrectEvidenceId
                    || !challenge.CandidateEvidenceIds.SequenceEqual(slot.CandidateEvidenceIds, StringComparer.Ordinal)))
                result.Add("ProjectionCompiledChallengeMismatch", $"evidenceChallenges.{id}", "Compiled challenge changed its locked contradiction pair or candidates.", id);
        }

        foreach (var (id, slot) in plan.Interactions)
        {
            var interaction = gameCase.Interactions.FirstOrDefault(item => item.InteractionId == id);
            if (interaction is null) continue;
            if (interaction.TargetId != slot.TargetId
                || !interaction.RequiredItemIds.SequenceEqual(slot.RequiredItemIds, StringComparer.Ordinal)
                || !interaction.RequiredClueIds.SequenceEqual(slot.RequiredClueIds, StringComparer.Ordinal)
                || !interaction.UnlockItemIds.SequenceEqual(slot.UnlockItemIds, StringComparer.Ordinal)
                || !interaction.UnlockClueIds.SequenceEqual(slot.UnlockClueIds, StringComparer.Ordinal)
                || !interaction.UnlockSceneIds.SequenceEqual(slot.UnlockSceneIds, StringComparer.Ordinal))
                result.Add("ProjectionDependencyMismatch", $"interactions.{id}", "Compiled interaction dependencies differ from the plan.", id);
        }
        foreach (var (id, slot) in plan.TeamworkChains)
        {
            var chain = gameCase.RequiredTeamworkChains.FirstOrDefault(item => item.ChainId == id);
            if (chain is null) continue;
            if (chain.InvestigatorClueId != slot.InvestigatorClueId
                || chain.InterrogatorChallengeId != slot.InterrogatorChallengeId
                || chain.DeductionId != slot.DeductionId)
                result.Add("ProjectionDependencyMismatch", $"requiredTeamworkChains.{id}", "Compiled teamwork dependencies differ from the plan.", id);
        }
        foreach (var (id, slot) in plan.ConversationNodes)
        {
            var node = gameCase.ConversationNodes.FirstOrDefault(item => item.NodeId == id);
            if (node is null) continue;
            var nextIds = node.Choices.Select(item => item.NextNodeId)
                .Where(nextId => !string.IsNullOrWhiteSpace(nextId))
                .Distinct(StringComparer.Ordinal).ToList();
            if (node.CharacterId != slot.CharacterId
                || (node.ChallengeId ?? string.Empty) != slot.ChallengeId
                || !nextIds.SequenceEqual(slot.NextNodeIds, StringComparer.Ordinal))
                result.Add("ProjectionDependencyMismatch", $"conversationNodes.{id}", "Compiled conversation topology differs from the plan.", id);
        }
        foreach (var (id, slot) in plan.Hints)
        {
            var hint = gameCase.Hints.FirstOrDefault(item => item.HintId == id);
            if (hint is null) continue;
            if (hint.ContextType != slot.ContextType || hint.TargetId != slot.TargetId || hint.Order != slot.Order)
                result.Add("ProjectionDependencyMismatch", $"hints.{id}", "Compiled hint target or order differs from the plan.", id);
        }

        foreach (var (id, slot) in plan.Puzzles)
        {
            foreach (var truthId in slot.BasedOnTruthIds.Where(truthId =>
                         !events.ContainsKey(truthId) && !traces.ContainsKey(truthId)
                         && !statements.ContainsKey(truthId) && !conclusions.ContainsKey(truthId)))
                result.Add("ProjectionPuzzleOrphan", $"projectionPlan.puzzles.{id}.basedOnTruthIds", "Puzzle basis does not exist in truth.", truthId);
            foreach (var conclusionId in slot.RevealsConclusionIds.Where(id => !conclusions.ContainsKey(id)))
                result.Add("ProjectionPuzzleConclusionMismatch", $"projectionPlan.puzzles.{id}.revealsConclusionIds", "Puzzle conclusion does not exist.", conclusionId);
            foreach (var conclusionId in slot.RevealsConclusionIds.Where(conclusionId =>
                         !slot.BasedOnTruthIds.Contains(conclusionId, StringComparer.Ordinal)
                         && !slot.BasedOnTruthIds.Any(basisId =>
                             traces.TryGetValue(basisId, out var trace)
                             && trace.SupportsConclusionIds.Contains(conclusionId, StringComparer.Ordinal))
                         && !slot.BasedOnTruthIds.Any(basisId =>
                             statements.TryGetValue(basisId, out var statement)
                             && statement.SupportsConclusionIds.Contains(conclusionId, StringComparer.Ordinal))))
                result.Add("ProjectionPuzzleConclusionMismatch", $"projectionPlan.puzzles.{id}", "Puzzle reveal is not supported by its truth basis.", conclusionId);
        }

        foreach (var (id, slot) in plan.Deductions)
        {
            if (!conclusions.ContainsKey(slot.ConclusionId))
                result.Add("ProjectionDeductionOrphan", $"projectionPlan.deductions.{id}.conclusionId", "Deduction conclusion does not exist.", slot.ConclusionId);
            foreach (var clueId in slot.RequiredClueIds)
            {
                if (!plan.Clues.TryGetValue(clueId, out var clue)
                    || !clue.SupportsConclusionIds.Contains(slot.ConclusionId, StringComparer.Ordinal))
                    result.Add("ProjectionDeductionEvidenceMismatch", $"projectionPlan.deductions.{id}.requiredClueIds", "Deduction evidence does not support its conclusion.", clueId);
            }
        }

        foreach (var (id, slot) in plan.RedHerrings)
        {
            var truthEntry = truth.RedHerringLedger.FirstOrDefault(item => item.RedHerringId == id);
            if (truthEntry is null)
                result.Add("ProjectionRedHerringOrphan", $"projectionPlan.redHerrings.{id}", "Red herring does not exist in approved truth.", id);
            if (slot.ClearingClueIds.Count == 0 && slot.ClearingDialogueIds.Count == 0)
                result.Add("ProjectionRedHerringUncleared", $"projectionPlan.redHerrings.{id}", "Red herring has no projected clearing evidence.", id);
            if (!string.IsNullOrWhiteSpace(slot.ClueId)
                && (!clues.TryGetValue(slot.ClueId, out var redClue) || !redClue.IsRedHerring))
                result.Add("ProjectionRedHerringMismatch", $"projectionPlan.redHerrings.{id}.clueId", "Red-herring presentation clue is missing or no longer marked.", slot.ClueId);
            foreach (var clueId in slot.ClearingClueIds.Where(clueId => !clues.ContainsKey(clueId)))
                result.Add("ProjectionRedHerringUnreachable", $"projectionPlan.redHerrings.{id}.clearingClueIds", "Clearing clue is absent from the compiled case.", clueId);
            if (truthEntry is not null)
            {
                foreach (var traceId in truthEntry.ClearingTraceIds.Where(traceId =>
                             slot.ClearingClueIds.All(clueId =>
                                 !plan.Clues.TryGetValue(clueId, out var clue)
                                 || clue.TraceId != traceId)))
                    result.Add("ProjectionTruthClosure", $"projectionPlan.redHerrings.{id}.clearingClueIds", "A truth clearing trace is not projected as clearing evidence.", traceId);
                foreach (var statementId in truthEntry.ClearingStatementIds.Where(statementId =>
                             slot.ClearingDialogueIds.All(dialogueId =>
                                 !plan.Dialogues.TryGetValue(dialogueId, out var dialogue)
                                 || !dialogue.StatementIds.Contains(statementId, StringComparer.Ordinal))))
                    result.Add("ProjectionTruthClosure", $"projectionPlan.redHerrings.{id}.clearingDialogueIds", "A truth clearing statement is not projected as clearing evidence.", statementId);
            }
        }

        if (gameCase.FinalLogic.CulpritId != truth.CoreTruth.CulpritId
            || gameCase.FinalLogic.Motive != truth.CoreTruth.Motive
            || gameCase.FinalLogic.Method != truth.CoreTruth.Method)
            result.Add("ProjectionFinalTruthMismatch", "finalLogic", "Compiled final truth differs from the approved core truth.");
        foreach (var expected in plan.FinalLogic.EvidenceLinks)
        {
            var actual = gameCase.FinalLogic.RequiredEvidenceLinks.FirstOrDefault(link =>
                link.ClaimType == expected.ClaimType);
            if (actual is null || actual.EvidenceId != expected.EvidenceId
                || actual.ConclusionId != expected.ConclusionId)
            {
                result.Add("ProjectionFinalEvidenceMismatch", "finalLogic.requiredEvidenceLinks", "Final evidence link differs from its plan.", expected.ClaimType);
                continue;
            }
            if (!plan.Clues.TryGetValue(actual.EvidenceId, out var clue)
                || !clue.SupportsConclusionIds.Contains(actual.ConclusionId, StringComparer.Ordinal)
                || !conclusions.TryGetValue(actual.ConclusionId, out var conclusion)
                || conclusion.Category != actual.ClaimType)
                result.Add("ProjectionFinalClaimOverreach", "finalLogic.requiredEvidenceLinks", "Final evidence is not on the planned causal path for its claim.", actual.EvidenceId);
        }

        var usedLocations = truth.TrueTimeline.Select(item => item.LocationId)
            .Concat(truth.TraceLedger.Select(item => item.LocationId))
            .Distinct(StringComparer.Ordinal);
        foreach (var locationId in usedLocations.Where(id => !plan.Scenes.ContainsKey(id)))
            result.Add("ProjectionTruthClosure", "projectionPlan.scenes", "A used truth location was not projected.", locationId);
        foreach (var conclusionId in conclusions.Keys.Where(id =>
                     plan.FinalLogic.EvidenceLinks.All(link => link.ConclusionId != id)
                     && plan.Deductions.Values.All(deduction => deduction.ConclusionId != id)))
            result.Add("ProjectionTruthClosure", "projectionPlan.finalLogic", "A proof conclusion was not projected.", conclusionId);
        var projectedTraceIds = plan.Clues.Values.Select(item => item.TraceId)
            .ToHashSet(StringComparer.Ordinal);
        var requiredTraceIds = truth.StatementLedger.SelectMany(item => item.ContradictedByTraceIds)
            .Concat(truth.RedHerringLedger.SelectMany(item => item.ClearingTraceIds))
            .Concat(plan.FinalLogic.EvidenceLinks
                .Where(link => plan.Clues.ContainsKey(link.EvidenceId))
                .Select(link => plan.Clues[link.EvidenceId].TraceId))
            .Distinct(StringComparer.Ordinal);
        foreach (var traceId in requiredTraceIds.Where(id => !projectedTraceIds.Contains(id)))
            result.Add("ProjectionTruthClosure", "projectionPlan.clues", "A required proof, contradiction, or clearing trace was not projected.", traceId);
        var projectedStatementIds = plan.Dialogues.Values.SelectMany(item => item.StatementIds)
            .ToHashSet(StringComparer.Ordinal);
        var requiredStatementIds = truth.StatementLedger
            .Where(item => item.ContradictedByTraceIds.Count > 0)
            .Select(item => item.StatementId)
            .Concat(truth.RedHerringLedger.SelectMany(item => item.ClearingStatementIds))
            .Distinct(StringComparer.Ordinal);
        foreach (var statementId in requiredStatementIds.Where(id => !projectedStatementIds.Contains(id)))
            result.Add("ProjectionTruthClosure", "projectionPlan.dialogues", "A contradiction or clearing statement was not projected.", statementId);

        result.Errors.AddRange(CausalStateGraphValidator.Validate(gameCase).Errors);
        result.Deduplicate();
        return result;
    }

    private static void Exact(
        CaseValidationResult result,
        string path,
        IEnumerable<string> expected,
        IEnumerable<string> actual)
    {
        var expectedSet = expected.ToHashSet(StringComparer.Ordinal);
        var actualSet = actual.ToHashSet(StringComparer.Ordinal);
        foreach (var missing in expectedSet.Except(actualSet))
            result.Add("ProjectionMissingSlot", path, "Planned gameplay slot is missing from compiled case.", missing);
        foreach (var extra in actualSet.Except(expectedSet))
            result.Add("ProjectionOrphanSlot", path, "Compiled case contains an unplanned gameplay object.", extra);
    }

    private static void Duplicate(
        CaseValidationResult result,
        string path,
        IEnumerable<string> ids)
    {
        foreach (var id in ids.GroupBy(value => value, StringComparer.Ordinal)
                     .Where(group => group.Count() > 1)
                     .Select(group => group.Key))
            result.Add("ProjectionDuplicateSlot", path, "Compiled case contains a duplicate gameplay slot ID.", id);
    }
}
