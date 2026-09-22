using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

internal sealed record ProgressCompletion(IReadOnlyList<string> NewSceneIds, IReadOnlyList<string> NewStageIds);

internal sealed record SceneContinuationResult(
    string SceneId,
    string CurrentStageId,
    string? SuccessorSceneId,
    string? SuccessorStageId,
    bool CompletedNow,
    bool SuccessorUnlockedNow,
    bool SuccessorVisitedNow,
    bool CallerMoved)
{
    public bool CrossesStage => CallerMoved && SuccessorStageId != CurrentStageId;
    public bool IsContinuation => CallerMoved && !CompletedNow;
    public bool HasChanges => CompletedNow || SuccessorUnlockedNow || SuccessorVisitedNow || CallerMoved;
}

internal static class GameRules
{
    public static bool IsSceneAlreadyCompleted(GameplayState state, string sceneId) =>
        state.CompletedSceneIds.Contains(sceneId);

    public static bool CanEnterScene(GameCase _, GameplayState state, string sceneId) =>
        state.VisitedSceneIds.Contains(sceneId)
        || state.UnlockedSceneIds.Contains(sceneId);

    public static IReadOnlyList<CaseScene> GetAuthoredScenes(GameCase gameCase) =>
        gameCase.Stages
            .OrderBy(stage => stage.Order)
            .SelectMany(stage => stage.Scenes)
            .ToList();

    public static CaseScene? GetNextAuthoredScene(GameCase gameCase, string sceneId)
    {
        var scenes = GetAuthoredScenes(gameCase);
        for (var index = 0; index < scenes.Count - 1; index++)
        {
            if (scenes[index].SceneId == sceneId) return scenes[index + 1];
        }

        return null;
    }

    public static bool UnlockAuthoredSuccessor(GameCase gameCase, GameplayState state, string completedSceneId)
    {
        var nextScene = GetNextAuthoredScene(gameCase, completedSceneId);
        if (nextScene is null || state.UnlockedSceneIds.Contains(nextScene.SceneId)) return false;

        state.UnlockedSceneIds.Add(nextScene.SceneId);
        return true;
    }

    /// <summary>
    /// Applies the state mutation behind Continue. The caller is moved only when still standing in
    /// the supplied scene; replaying the same decision is therefore safe and produces no duplicate
    /// completion, unlock, or visit ids.
    /// </summary>
    public static SceneContinuationResult ApplySceneContinuation(
        GameCase gameCase,
        GameplayState state,
        string userId,
        string sceneId)
    {
        var currentStage = gameCase.Stages.First(stage =>
            stage.Scenes.Any(scene => scene.SceneId == sceneId));
        var completedNow = false;
        if (!state.CompletedSceneIds.Contains(sceneId))
        {
            state.CompletedSceneIds.Add(sceneId);
            completedNow = true;
        }

        var successor = GetNextAuthoredScene(gameCase, sceneId);
        if (successor is null)
        {
            return new SceneContinuationResult(
                sceneId,
                currentStage.StageId,
                null,
                null,
                completedNow,
                false,
                false,
                false);
        }

        var successorStage = gameCase.Stages.First(stage =>
            stage.Scenes.Any(scene => scene.SceneId == successor.SceneId));
        var successorUnlockedNow = UnlockAuthoredSuccessor(gameCase, state, sceneId);
        var callerSceneId = state.PlayerSceneIds.GetValueOrDefault(userId, state.CurrentSceneId);
        var callerMoved = callerSceneId == sceneId;
        var successorVisitedNow = false;
        if (callerMoved)
        {
            state.PlayerSceneIds[userId] = successor.SceneId;
            state.CurrentStageId = successorStage.StageId;
            state.CurrentSceneId = successor.SceneId;
            if (!state.VisitedSceneIds.Contains(successor.SceneId))
            {
                state.VisitedSceneIds.Add(successor.SceneId);
                successorVisitedNow = true;
            }
        }

        return new SceneContinuationResult(
            sceneId,
            currentStage.StageId,
            successor.SceneId,
            successorStage.StageId,
            completedNow,
            successorUnlockedNow,
            successorVisitedNow,
            callerMoved);
    }

    /// <summary>
    /// Marks every visited scene whose complete-condition is satisfied as completed, unlocks its
    /// immediate authored successor, and marks every fully completed stage. This never visits a
    /// successor or moves a player. Idempotent; returns only the ids that changed in this pass.
    /// </summary>
    public static ProgressCompletion AutoCompleteProgress(GameCase gameCase, GameplayState state)
    {
        var inspected = state.InspectedItemIds.ToHashSet();
        var unlocked = state.UnlockedClueIds.ToHashSet();
        var asked = state.AskedDialogueIds.ToHashSet();

        var newSceneIds = new List<string>();
        foreach (var scene in GetAuthoredScenes(gameCase))
        {
            if (state.CompletedSceneIds.Contains(scene.SceneId)) continue;
            if (!state.VisitedSceneIds.Contains(scene.SceneId)) continue;
            if (!CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspected, unlocked, asked)) continue;
            state.CompletedSceneIds.Add(scene.SceneId);
            newSceneIds.Add(scene.SceneId);
            UnlockAuthoredSuccessor(gameCase, state, scene.SceneId);
        }

        var newStageIds = new List<string>();
        foreach (var stage in gameCase.Stages.OrderBy(stage => stage.Order))
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
        var everyV3CrackResolved = gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation
            || gameCase.EvidenceChallenges.All(challenge =>
                state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == challenge.ChallengeId));
        return state.GameStatus == GameStatus.InProgress
            && (currentSceneId ?? state.CurrentSceneId) == lastScene.SceneId
            && AllScenesCompleted(gameCase, state)
            && requiredEvidenceIds.All(state.UnlockedClueIds.Contains)
            && requiredDeductions.All(id => state.SolvedDeductionRecords.Any(record => record.DeductionId == id))
            && requiredChains.All(id => IsTeamworkChainComplete(gameCase, state, id))
            && everyV3CrackResolved;
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
