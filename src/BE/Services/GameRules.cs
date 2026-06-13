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
        return state.GameStatus == GameStatus.InProgress
            && (currentSceneId ?? state.CurrentSceneId) == lastScene.SceneId
            && IsSceneAlreadyCompleted(state, lastScene.SceneId)
            && gameCase.FinalLogic.RequiredEvidenceIds.All(state.UnlockedClueIds.Contains);
    }
}
