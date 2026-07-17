using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

internal sealed record ProgressCompletion(IReadOnlyList<string> NewSceneIds, IReadOnlyList<string> NewStageIds);

internal static class GameRules
{
    public static bool IsSceneAlreadyCompleted(GameplayState state, string sceneId) =>
        state.CompletedSceneIds.Contains(sceneId);

    /// <summary>
    /// A scene is gated only when some interaction or puzzle explicitly unlocks it
    /// (e.g. a hidden passage). Every other scene is freely reachable from the map.
    /// </summary>
    public static bool SceneRequiresUnlock(GameCase gameCase, string sceneId) =>
        gameCase.Interactions.Any(i => i.UnlockSceneIds.Contains(sceneId))
        || gameCase.Puzzles.Any(p => p.UnlockSceneIds.Contains(sceneId));

    public static bool CanEnterScene(GameCase gameCase, GameplayState state, string sceneId) =>
        state.VisitedSceneIds.Contains(sceneId)
        || state.UnlockedSceneIds.Contains(sceneId)
        || !SceneRequiresUnlock(gameCase, sceneId);

    /// <summary>
    /// Marks every visited scene whose complete-condition is satisfied as completed, and every
    /// stage whose scenes are all completed as completed. With free scene movement players no
    /// longer confirm completion manually, so progression is derived from the evidence state.
    /// Idempotent; returns only the ids that changed in this pass.
    /// </summary>
    public static ProgressCompletion AutoCompleteProgress(GameCase gameCase, GameplayState state)
    {
        var inspected = state.InspectedItemIds.ToHashSet();
        var unlocked = state.UnlockedClueIds.ToHashSet();
        var asked = state.AskedDialogueIds.ToHashSet();

        var newSceneIds = new List<string>();
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            if (state.CompletedSceneIds.Contains(scene.SceneId)) continue;
            if (!state.VisitedSceneIds.Contains(scene.SceneId)) continue;
            if (!CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspected, unlocked, asked)) continue;
            state.CompletedSceneIds.Add(scene.SceneId);
            newSceneIds.Add(scene.SceneId);
        }

        var newStageIds = new List<string>();
        foreach (var stage in gameCase.Stages)
        {
            if (state.CompletedStageIds.Contains(stage.StageId)) continue;
            if (!stage.Scenes.All(scene => state.CompletedSceneIds.Contains(scene.SceneId))) continue;
            state.CompletedStageIds.Add(stage.StageId);
            newStageIds.Add(stage.StageId);
        }

        return new ProgressCompletion(newSceneIds, newStageIds);
    }

    public static bool AllScenesCompleted(GameCase gameCase, GameplayState state) =>
        gameCase.Stages.All(stage => stage.Scenes.All(scene => state.CompletedSceneIds.Contains(scene.SceneId)));

    public static bool IsStageComplete(CaseStage stage, GameplayState state) =>
        !MissingSceneIds(stage, state).Any();

    public static IEnumerable<string> MissingSceneIds(CaseStage stage, GameplayState state) =>
        stage.Scenes
            .Where(s => !state.CompletedSceneIds.Contains(s.SceneId))
            .Select(s => s.SceneId);

    public static bool IsAccusationAvailable(GameCase gameCase, GameplayState state, string? currentSceneId = null)
    {
        var lastStage = gameCase.Stages.OrderBy(s => s.Order).Last();
        var lastScene = lastStage.Scenes.Last();
        var requiredEvidenceIds = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2
            ? gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId)
            : gameCase.FinalLogic.RequiredEvidenceIds;
        var requiredDeductions = gameCase.FinalLogic.RequiredDeductionIds;
        var requiredChains = gameCase.FinalLogic.RequiredTeamworkChainIds;
        return state.GameStatus == GameStatus.InProgress
            && (currentSceneId ?? state.CurrentSceneId) == lastScene.SceneId
            && AllScenesCompleted(gameCase, state)
            && requiredEvidenceIds.All(state.UnlockedClueIds.Contains)
            && requiredDeductions.All(id => state.SolvedDeductionRecords.Any(record => record.DeductionId == id))
            && requiredChains.All(id => IsTeamworkChainComplete(gameCase, state, id));
    }

    public static bool IsTeamworkChainComplete(GameCase gameCase, GameplayState state, string chainId)
    {
        var chain = gameCase.RequiredTeamworkChains.FirstOrDefault(c => c.ChainId == chainId);
        if (chain is null) return false;

        return state.UnlockedClueIds.Contains(chain.InvestigatorClueId)
            && state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == chain.InterrogatorChallengeId)
            && state.SolvedDeductionRecords.Any(record => record.DeductionId == chain.DeductionId);
    }
}
