using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed partial class GameplayProjectionPlanner
{
    /// <summary>
    /// OPEN_COOP_1: the level's optional interactive puzzles. Each one sits on its own clickable item in a scene and
    /// is the only way to a clue that the accusation never needs: not a proof of the five claims, not a
    /// contradicting trace (the correct evidence of a confrontation), not a red herring's clearing trace, not a
    /// scene's completion. Built before the confrontations, so such a clue may be offered as a distractor there;
    /// deductions skip it. A team that skips every puzzle still solves the case. The kind and the words are written
    /// by the AI in the content step; the server completes the mechanics.
    /// </summary>
    private static void CreateOptionalPuzzles(GameCase skeleton, CaseTruthPackage truth, AiDifficultyProfile profile, string? leaning)
    {
        var count = AiDifficultyProfiles.PuzzleCount(profile, leaning);
        var protectedTraces = truth.StatementLedger.SelectMany(statement => statement.ContradictedByTraceIds)
            .Concat(truth.RedHerringLedger.SelectMany(redHerring => redHerring.ClearingTraceIds))
            .Select(traceId => $"clue-{traceId}");
        var needed = skeleton.FinalLogic.RequiredEvidenceIds
            .Concat(protectedTraces)
            .Concat(skeleton.Interactions.SelectMany(interaction => interaction.RequiredClueIds.Concat(interaction.UnlockClueIds)))
            .Concat(skeleton.Puzzles.SelectMany(puzzle => puzzle.RequiredClueIds.Concat(puzzle.UnlockClueIds)))
            .ToHashSet(StringComparer.Ordinal);
        var scenes = skeleton.Stages.SelectMany(stage => stage.Scenes).ToList();
        // Truth traces no clue uses yet come first: they give a puzzle its own finding without taking one away.
        var unused = truth.TraceLedger
            .Where(trace => !needed.Contains($"clue-{trace.TraceId}")
                            && skeleton.Clues.All(clue => clue.ClueId != $"clue-{trace.TraceId}")
                            && scenes.Any(scene => scene.SceneId == trace.LocationId))
            .OrderBy(trace => trace.TraceId, StringComparer.Ordinal)
            .Take(count)
            .Select(trace => CreateTraceClue(trace, $"clue-{trace.TraceId}"))
            .ToList();
        skeleton.Clues.AddRange(unused);
        var candidates = skeleton.Clues
            .Where(clue => !clue.IsCritical && !clue.IsRedHerring && !needed.Contains(clue.ClueId)
                           && scenes.Any(scene => scene.SceneId == clue.SceneId)
                           && (clue.SourceType == "camera" || clue.SourceType == EvidenceDiscoveryMethods.ItemInspect))
            .OrderBy(clue => unused.Contains(clue) ? 0 : clue.SourceType == EvidenceDiscoveryMethods.ItemInspect ? 1 : 2)
            .ThenBy(clue => clue.ClueId, StringComparer.Ordinal)
            .ToList();
        if (candidates.Count < count)
            throw new ProjectionPlanningException(
            [
                $"PROJECTABILITY puzzles: {profile.Difficulty} needs {count} optional puzzle rewards, but the approved truth has only "
                + $"{candidates.Count} traces that no proof, confrontation or deduction uses. Add independent corroborating traces."
            ]);

        // Spread the puzzles: each next puzzle goes to the scene that has the fewest so far.
        var perScene = scenes.ToDictionary(scene => scene.SceneId, _ => 0, StringComparer.Ordinal);
        for (var index = 0; index < count; index++)
        {
            var reward = candidates
                .OrderBy(clue => perScene[clue.SceneId])
                .ThenBy(clue => candidates.IndexOf(clue))
                .First();
            candidates.Remove(reward);
            perScene[reward.SceneId]++;
            RemovePreviousCarrier(skeleton, reward);
            var puzzleId = $"puzzle-{index + 1:00}";
            // Name, description and inspect text stay empty so the content step writes them for the story.
            var target = AddDossierItem(skeleton, $"item-puzzle-{index + 1:00}", reward.SceneId, false,
                string.Empty, string.Empty, []);
            var truthId = reward.ClueId.StartsWith("clue-", StringComparison.Ordinal) ? reward.ClueId["clue-".Length..] : reward.ClueId;
            skeleton.Puzzles.Add(new CasePuzzle
            {
                PuzzleId = puzzleId,
                Type = CasePuzzleTypes.InteractivePuzzle,
                Kind = string.Empty,
                Difficulty = profile.PuzzleDifficulty,
                ProgressionRole = PuzzleProgressionRoles.Optional,
                TargetId = target.ItemId,
                UnlockClueIds = [reward.ClueId],
                BasedOnTruthIds = [truthId],
                RevealsConclusionIds = reward.SupportsConclusionIds.ToList()
            });
            SetMechanicSource(reward, puzzleId, "puzzle", EvidenceAcquisitionMethods.PuzzleResult);
        }
    }
}
