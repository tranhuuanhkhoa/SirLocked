using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

internal static class GameRules
{
    public static bool IsSceneAlreadyCompleted(GameplayState state, string sceneId) =>
        state.CompletedSceneIds.Contains(sceneId);

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
            && IsSceneAlreadyCompleted(state, lastScene.SceneId)
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
