using System.Text.Json;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.Helpers;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class GameplayService : IGameplayService
{
    private readonly IGameplayRepository _gameplayRepository;
    private readonly IRoomRepository _rooms;
    private readonly ICaseRepository _cases;

    public GameplayService(IGameplayRepository gameplayRepository, IRoomRepository rooms, ICaseRepository cases)
    {
        _gameplayRepository = gameplayRepository;
        _rooms = rooms;
        _cases = cases;
    }

    public async Task<GameStateResponse> GetStateAsync(string roomId, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        EnsureProgress(room, gameCase);
        return MapState(room, gameCase);
    }

    public async Task<GameStateResponse> InspectItemAsync(string roomId, string userId, InspectItemRequest request, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        EnsurePlayableByMember(room, userId, "inspecting items");

        EnsureProgress(room, gameCase);
        var scene = FindCurrentScene(room, gameCase);
        if (scene is null || !scene.ItemIds.Contains(request.ItemId))
        {
            throw new InvalidOperationException("Item is not available in the current scene.");
        }

        var item = gameCase.Items.FirstOrDefault(existing => existing.ItemId == request.ItemId)
            ?? throw new InvalidOperationException("Item not found in case.");

        if (!room.Progress.FoundItemIds.Contains(item.ItemId))
        {
            room.Progress.FoundItemIds.Add(item.ItemId);
        }

        foreach (var clueId in item.UnlockClueIds)
        {
            if (!room.Progress.FoundClueIds.Contains(clueId))
            {
                room.Progress.FoundClueIds.Add(clueId);
            }
        }

        await _rooms.UpdateAsync(room, cancellationToken);
        await _gameplayRepository.AddActionLogAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = "inspect_item",
            PayloadJson = JsonSerializer.Serialize(request)
        }, cancellationToken);

        return MapState(room, gameCase);
    }

    public async Task<GameStateResponse> AskDialogueAsync(string roomId, string userId, AskDialogueRequest request, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        EnsurePlayableByMember(room, userId, "asking dialogue");
        EnsureProgress(room, gameCase);

        var dialogue = FindAvailableDialogue(room, gameCase, request.DialogueId);
        EnsureDialogueRequirementsMet(room, dialogue);

        if (!room.Progress.AskedDialogueIds.Contains(dialogue.DialogueId))
        {
            room.Progress.AskedDialogueIds.Add(dialogue.DialogueId);
        }

        UnlockDialogueClues(room, dialogue);
        await _rooms.UpdateAsync(room, cancellationToken);
        await _gameplayRepository.AddActionLogAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = "ask_dialogue",
            PayloadJson = JsonSerializer.Serialize(request)
        }, cancellationToken);

        return MapState(room, gameCase);
    }

    public async Task<GameStateResponse> PresentEvidenceAsync(string roomId, string userId, PresentEvidenceRequest request, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        EnsurePlayableByMember(room, userId, "presenting evidence");
        EnsureProgress(room, gameCase);

        var dialogue = FindAvailableDialogue(room, gameCase, request.DialogueId);
        EnsureDialogueRequirementsMet(room, dialogue);

        var evidenceIsFound = room.Progress.FoundClueIds.Contains(request.EvidenceId)
            || room.Progress.FoundItemIds.Contains(request.EvidenceId);
        if (!evidenceIsFound)
        {
            throw new InvalidOperationException("Evidence must be discovered before it can be presented.");
        }

        var progressKey = $"{dialogue.DialogueId}:{request.EvidenceId}";
        if (!room.Progress.PresentedEvidenceIds.Contains(progressKey))
        {
            room.Progress.PresentedEvidenceIds.Add(progressKey);
        }

        UnlockDialogueClues(room, dialogue);
        await _rooms.UpdateAsync(room, cancellationToken);
        await _gameplayRepository.AddActionLogAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = "present_evidence",
            PayloadJson = JsonSerializer.Serialize(request)
        }, cancellationToken);

        return MapState(room, gameCase);
    }

    public async Task<GameStateResponse> CompleteSceneAsync(string roomId, string userId, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        EnsurePlayableByMember(room, userId, "completing a scene");
        EnsureProgress(room, gameCase);

        var stage = FindCurrentStage(room, gameCase)
            ?? throw new InvalidOperationException("Current stage not found.");
        var scene = stage.Scenes.FirstOrDefault(existing => existing.SceneId == room.Progress.CurrentSceneId)
            ?? throw new InvalidOperationException("Current scene not found.");
        var currentSceneIndex = stage.Scenes.FindIndex(existing => existing.SceneId == scene.SceneId);
        if (room.Progress.CompletedSceneIds.Contains(scene.SceneId) && currentSceneIndex == stage.Scenes.Count - 1)
        {
            throw new InvalidOperationException("Scene is already completed.");
        }

        EnsureSceneCanComplete(room, scene);
        if (!room.Progress.CompletedSceneIds.Contains(scene.SceneId))
        {
            room.Progress.CompletedSceneIds.Add(scene.SceneId);
        }

        if (currentSceneIndex < stage.Scenes.Count - 1)
        {
            room.Progress.CurrentSceneId = stage.Scenes[currentSceneIndex + 1].SceneId;
        }

        await _rooms.UpdateAsync(room, cancellationToken);
        await _gameplayRepository.AddActionLogAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = "complete_scene",
            PayloadJson = JsonSerializer.Serialize(new { sceneId = scene.SceneId })
        }, cancellationToken);

        return MapState(room, gameCase);
    }

    public async Task<GameStateResponse> CompleteStageAsync(string roomId, string userId, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        EnsurePlayableByMember(room, userId, "completing a stage");
        EnsureProgress(room, gameCase);

        var stage = FindCurrentStage(room, gameCase)
            ?? throw new InvalidOperationException("Current stage not found.");
        var currentScene = stage.Scenes.FirstOrDefault(existing => existing.SceneId == room.Progress.CurrentSceneId)
            ?? throw new InvalidOperationException("Current scene not found.");

        if (stage.Scenes.LastOrDefault()?.SceneId != currentScene.SceneId)
        {
            throw new InvalidOperationException("Complete all scenes in the stage before completing the stage.");
        }

        EnsureSceneCanComplete(room, currentScene);
        if (!room.Progress.CompletedSceneIds.Contains(currentScene.SceneId))
        {
            room.Progress.CompletedSceneIds.Add(currentScene.SceneId);
        }

        var missingSceneIds = stage.Scenes
            .Select(scene => scene.SceneId)
            .Where(sceneId => !room.Progress.CompletedSceneIds.Contains(sceneId))
            .ToList();
        if (missingSceneIds.Count > 0)
        {
            throw new InvalidOperationException($"Stage has incomplete scenes: {string.Join(", ", missingSceneIds)}.");
        }

        if (room.Progress.CompletedStageIds.Contains(stage.StageId))
        {
            throw new InvalidOperationException("Stage is already completed.");
        }

        room.Progress.CompletedStageIds.Add(stage.StageId);
        var orderedStages = gameCase.Stages.OrderBy(existing => existing.Order).ToList();
        var currentStageIndex = orderedStages.FindIndex(existing => existing.StageId == stage.StageId);
        if (currentStageIndex >= 0 && currentStageIndex < orderedStages.Count - 1)
        {
            var nextStage = orderedStages[currentStageIndex + 1];
            room.Progress.CurrentStageId = nextStage.StageId;
            room.Progress.CurrentSceneId = nextStage.Scenes.FirstOrDefault()?.SceneId ?? string.Empty;
        }

        await _rooms.UpdateAsync(room, cancellationToken);
        await _gameplayRepository.AddActionLogAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = "complete_stage",
            PayloadJson = JsonSerializer.Serialize(new { stageId = stage.StageId })
        }, cancellationToken);

        return MapState(room, gameCase);
    }

    public async Task<GameResultResponse> AccuseAsync(string roomId, string userId, AccuseRequest request, CancellationToken cancellationToken = default)
    {
        var (room, gameCase) = await LoadRoomCaseAsync(roomId, cancellationToken);
        if (room.Status != RoomStatuses.Playing)
        {
            throw new InvalidOperationException("Room must be playing before making an accusation.");
        }

        if (room.Players.All(player => player.UserId != userId))
        {
            throw new UnauthorizedAccessException("User is not a room player.");
        }

        var logic = gameCase.FinalLogic;
        var evidence = request.EvidenceIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missingEvidence = logic.RequiredEvidenceIds
            .Where(required => !evidence.Contains(required))
            .ToList();
        var foundEvidence = logic.RequiredEvidenceIds
            .Where(required => room.Progress.FoundClueIds.Contains(required) || room.Progress.FoundItemIds.Contains(required))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unearnedEvidence = logic.RequiredEvidenceIds
            .Where(required => !foundEvidence.Contains(required))
            .ToList();
        var success = Same(request.CulpritId, logic.CulpritId)
            && Same(request.Motive, logic.Motive)
            && Same(request.Method, logic.Method)
            && missingEvidence.Count == 0
            && unearnedEvidence.Count == 0;

        var result = new GameResult
        {
            RoomId = roomId,
            CaseId = gameCase.CaseId,
            SubmittedByUserId = userId,
            Success = success,
            Accusation = new FinalAccusation
            {
                CulpritId = request.CulpritId,
                Motive = request.Motive,
                Method = request.Method,
                EvidenceIds = request.EvidenceIds
            }
        };

        room.Status = RoomStatuses.Completed;
        await _rooms.UpdateAsync(room, cancellationToken);
        await _gameplayRepository.AddResultAsync(result, cancellationToken);
        return new GameResultResponse
        {
            ResultId = result.Id ?? string.Empty,
            RoomId = roomId,
            CaseId = gameCase.CaseId,
            SubmittedByUserId = userId,
            Success = success,
            Message = success
                ? "Case solved. The accusation matches the case logic and collected evidence."
                : "Accusation submitted, but the theory does not match all required facts.",
            MissingEvidenceIds = missingEvidence.Concat(unearnedEvidence).Distinct().ToList(),
            CorrectCulpritId = logic.CulpritId,
            CorrectMotive = logic.Motive,
            CorrectMethod = logic.Method,
            CompletedAt = result.CompletedAt
        };
    }

    private async Task<(GameRoom Room, GameCase Case)> LoadRoomCaseAsync(string roomId, CancellationToken cancellationToken)
    {
        var room = await _rooms.GetByIdAsync(roomId, cancellationToken)
            ?? throw new InvalidOperationException("Room not found.");
        var gameCase = await _cases.GetByIdAsync(room.CaseId, cancellationToken)
            ?? throw new InvalidOperationException("Case not found.");
        return (room, gameCase);
    }

    private static void EnsurePlayableByMember(GameRoom room, string userId, string actionName)
    {
        if (room.Status != RoomStatuses.Playing)
        {
            throw new InvalidOperationException($"Room must be playing before {actionName}.");
        }

        if (room.Players.All(player => player.UserId != userId))
        {
            throw new UnauthorizedAccessException("User is not a room player.");
        }
    }

    private static void EnsureProgress(GameRoom room, GameCase gameCase)
    {
        var firstStage = gameCase.Stages.OrderBy(stage => stage.Order).FirstOrDefault();
        var firstScene = firstStage?.Scenes.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(room.Progress.CurrentStageId))
        {
            room.Progress.CurrentStageId = firstStage?.StageId ?? string.Empty;
        }

        if (string.IsNullOrWhiteSpace(room.Progress.CurrentSceneId))
        {
            room.Progress.CurrentSceneId = firstScene?.SceneId ?? string.Empty;
        }
    }

    private static GameStateResponse MapState(GameRoom room, GameCase gameCase)
    {
        var stage = gameCase.Stages.FirstOrDefault(existing => existing.StageId == room.Progress.CurrentStageId)
            ?? gameCase.Stages.OrderBy(existing => existing.Order).FirstOrDefault();
        var scene = stage?.Scenes.FirstOrDefault(existing => existing.SceneId == room.Progress.CurrentSceneId)
            ?? stage?.Scenes.FirstOrDefault();
        var sceneItemIds = scene?.ItemIds.ToHashSet() ?? [];
        var sceneCharacterIds = scene?.CharacterIds.ToHashSet() ?? [];
        var orderedStages = gameCase.Stages.OrderBy(existing => existing.Order).ToList();
        var currentStageIndex = stage is null ? -1 : orderedStages.FindIndex(existing => existing.StageId == stage.StageId);
        var currentSceneIndex = scene is null || stage is null ? -1 : stage.Scenes.FindIndex(existing => existing.SceneId == scene.SceneId);

        return new GameStateResponse
        {
            RoomId = room.Id ?? string.Empty,
            RoomCode = room.RoomCode,
            CaseId = gameCase.CaseId,
            CaseTitle = gameCase.Title,
            CaseSummary = gameCase.Summary,
            Status = room.Status,
            CurrentStageId = stage?.StageId ?? string.Empty,
            CurrentSceneId = scene?.SceneId ?? string.Empty,
            CurrentStage = stage,
            CurrentScene = scene,
            Characters = gameCase.Characters.Where(character => sceneCharacterIds.Contains(character.CharacterId)).ToList(),
            SceneItems = gameCase.Items.Where(item => sceneItemIds.Contains(item.ItemId)).ToList(),
            AvailableDialogues = gameCase.Dialogues.Where(dialogue => sceneCharacterIds.Contains(dialogue.CharacterId)).ToList(),
            FoundClues = gameCase.Clues.Where(clue => room.Progress.FoundClueIds.Contains(clue.ClueId)).ToList(),
            FoundItemIds = room.Progress.FoundItemIds,
            FoundClueIds = room.Progress.FoundClueIds,
            AskedDialogueIds = room.Progress.AskedDialogueIds,
            PresentedEvidenceIds = room.Progress.PresentedEvidenceIds,
            CompletedSceneIds = room.Progress.CompletedSceneIds,
            CompletedStageIds = room.Progress.CompletedStageIds,
            CanCompleteScene = scene is not null && SceneItemsAreFound(room, scene) && !room.Progress.CompletedSceneIds.Contains(scene.SceneId),
            CanCompleteStage = stage is not null
                && scene is not null
                && stage.Scenes.LastOrDefault()?.SceneId == scene.SceneId
                && SceneItemsAreFound(room, scene)
                && stage.Scenes.All(existing => existing.SceneId == scene.SceneId || room.Progress.CompletedSceneIds.Contains(existing.SceneId)),
            HasNextScene = stage is not null && currentSceneIndex >= 0 && currentSceneIndex < stage.Scenes.Count - 1,
            HasNextStage = currentStageIndex >= 0 && currentStageIndex < orderedStages.Count - 1
        };
    }

    private static Stage? FindCurrentStage(GameRoom room, GameCase gameCase)
    {
        return gameCase.Stages.FirstOrDefault(stage => stage.StageId == room.Progress.CurrentStageId)
            ?? gameCase.Stages.OrderBy(stage => stage.Order).FirstOrDefault();
    }

    private static Scene? FindCurrentScene(GameRoom room, GameCase gameCase)
    {
        return gameCase.Stages
            .SelectMany(stage => stage.Scenes)
            .FirstOrDefault(scene => scene.SceneId == room.Progress.CurrentSceneId);
    }

    private static bool Same(string left, string right)
    {
        return string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static Dialogue FindAvailableDialogue(GameRoom room, GameCase gameCase, string dialogueId)
    {
        var scene = FindCurrentScene(room, gameCase)
            ?? throw new InvalidOperationException("Current scene not found.");
        var characterIds = scene.CharacterIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var dialogue = gameCase.Dialogues.FirstOrDefault(existing => Same(existing.DialogueId, dialogueId))
            ?? throw new InvalidOperationException("Dialogue not found.");

        if (!characterIds.Contains(dialogue.CharacterId))
        {
            throw new InvalidOperationException("Dialogue is not available in the current scene.");
        }

        return dialogue;
    }

    private static void EnsureDialogueRequirementsMet(GameRoom room, Dialogue dialogue)
    {
        var missing = dialogue.RequiredClueIds
            .Where(clueId => !room.Progress.FoundClueIds.Contains(clueId))
            .ToList();
        if (missing.Count > 0)
        {
            throw new InvalidOperationException($"Dialogue is locked. Missing clues: {string.Join(", ", missing)}.");
        }
    }

    private static void UnlockDialogueClues(GameRoom room, Dialogue dialogue)
    {
        foreach (var clueId in dialogue.UnlockClueIds)
        {
            if (!room.Progress.FoundClueIds.Contains(clueId))
            {
                room.Progress.FoundClueIds.Add(clueId);
            }
        }
    }

    private static void EnsureSceneCanComplete(GameRoom room, Scene scene)
    {
        var missingItemIds = scene.ItemIds
            .Where(itemId => !room.Progress.FoundItemIds.Contains(itemId))
            .ToList();
        if (missingItemIds.Count > 0)
        {
            throw new InvalidOperationException($"Scene has uninspected items: {string.Join(", ", missingItemIds)}.");
        }
    }

    private static bool SceneItemsAreFound(GameRoom room, Scene scene)
    {
        return scene.ItemIds.All(itemId => room.Progress.FoundItemIds.Contains(itemId));
    }
}
