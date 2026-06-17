using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class GameplayService : IGameplayService
{
    private readonly MongoDbContext _db;
    private readonly ICaseService _caseService;
    private readonly IGameNotifier _notifier;
    private readonly IGameStateBuilder _stateBuilder;

    public GameplayService(
        MongoDbContext db,
        ICaseService caseService,
        IGameNotifier notifier,
        IGameStateBuilder stateBuilder)
    {
        _db = db;
        _caseService = caseService;
        _notifier = notifier;
        _stateBuilder = stateBuilder;
    }

    // ----- Read -----

    public async Task<GameStateResponse> GetStateAsync(string userId, string roomId)
    {
        var (room, gameCase, _) = await LoadContextAsync(userId, roomId, requireInProgress: false);
        if (room.GameplayState is null)
        {
            throw ApiException.BadRequest("The game has not started yet.");
        }
        return await _stateBuilder.BuildStateAsync(room, gameCase, userId);
    }

    public async Task<GameResultResponse> GetResultAsync(string userId, string roomId)
    {
        var (room, gameCase, _) = await LoadContextAsync(userId, roomId, requireInProgress: false);
        var result = await _db.GameResults.Find(r => r.RoomId == roomId)
            .SortByDescending(r => r.CreatedAt).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("No result for this room yet.");
        return ToResultResponse(result, gameCase);
    }

    // ----- Investigator: inspect item -----

    public async Task<GameActionResponse> InspectItemAsync(CurrentUser user, string roomId, string itemId)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Investigator, "Only the investigator can inspect items.");

            var item = gameCase.Items.FirstOrDefault(i => i.ItemId == itemId)
                ?? throw ApiException.NotFound("This item does not exist in the case.");
            var scene = CurrentScene(gameCase, state, user.Id);

            if (!scene.ItemIds.Contains(itemId))
            {
                throw ApiException.BadRequest("This item is not in the current scene.");
            }

            var hotspot = scene.Hotspots.FirstOrDefault(h =>
                h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase) && h.TargetId == itemId);
            var missingClues = hotspot?.RequiredClueIds.Where(c => !state.UnlockedClueIds.Contains(c)).ToList() ?? new List<string>();
            if (missingClues.Count > 0)
            {
                throw ApiException.BadRequest("You cannot examine this yet. Something else must be discovered first.",
                    new { missingRequiredClueIds = missingClues });
            }

            if (state.InspectedItemIds.Contains(itemId))
            {
                // Idempotent: no new clues, no duplicate logs.
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = $"{item.Name} was already inspected.",
                    Detail = item.InspectText
                };
            }

            state.InspectedItemIds.Add(itemId);
            if (item.IsCollectible && !state.CollectedItemIds.Contains(itemId))
            {
                state.CollectedItemIds.Add(itemId);
            }
            var newClues = item.UnlockClueIds.Where(c => !state.UnlockedClueIds.Contains(c)).ToList();
            state.UnlockedClueIds.AddRange(newClues);

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "INSPECT_ITEM", $"{user.FullName} inspected {item.Name}.", new { itemId });
            foreach (var clueId in newClues)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, itemId });
            }

            await _notifier.ItemFound(roomId, itemId, user.Id, state.Version);
            foreach (var clueId in newClues)
            {
                await _notifier.ClueUnlocked(roomId, clueId, itemId, user.Id, state.Version);
            }
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                UnlockedClueIds = newClues,
                Message = newClues.Count > 0 ? "New clue discovered." : $"{item.Name} inspected.",
                Detail = item.InspectText
            };
        }
    }

    // ----- Investigator: capture embedded clue with camera -----

    public async Task<GameActionResponse> CaptureClueAsync(CurrentUser user, string roomId, CaptureClueRequest request)
    {
        if (request.CaptureRect.Width <= 0 || request.CaptureRect.Height <= 0)
        {
            throw ApiException.BadRequest("Capture rectangle width and height must be positive.");
        }

        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Investigator, "Only the investigator can capture clue photos.");

            var scene = CurrentScene(gameCase, state, user.Id);
            if (scene.SceneId != request.SceneId)
            {
                throw ApiException.BadRequest("You can only capture clues in your current scene.");
            }

            var runtime = scene.Runtime;
            if (runtime is null || runtime.ClueZones.Count == 0)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    CaptureResult = "MISS",
                    Message = "No important detail was detected."
                };
            }

            var clueById = gameCase.Clues.ToDictionary(c => c.ClueId);
            var availableZones = runtime.ClueZones
                .Where(z => clueById.ContainsKey(z.ClueId))
                .Where(z => !state.CapturedClueIds.Contains(z.ClueId))
                .Where(z => z.RequiredClueIds.All(state.UnlockedClueIds.Contains))
                .ToList();

            var rules = NormalizeCameraRules(runtime.CameraRules);
            var best = availableZones
                .Select(zone => new
                {
                    Zone = zone,
                    Coverage = ClueCoverage(request.CaptureRect, zone.Bounds),
                    CenterInside = CaptureCenterInside(request.CaptureRect, zone.Bounds)
                })
                .OrderByDescending(x => x.Coverage)
                .ThenByDescending(x => x.CenterInside)
                .FirstOrDefault();

            if (best is null || best.Coverage < rules.NearMissCoverage)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    CaptureResult = "MISS",
                    Message = "No important detail was detected."
                };
            }

            var isHit = best.Coverage >= rules.MinClueCoverage
                        && (!rules.RequireCaptureCenterInside || best.CenterInside);
            if (!isHit)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    CaptureResult = "NEAR_MISS",
                    MatchedClueId = best.Zone.ClueId,
                    Message = "There is something notable here. Frame it more carefully."
                };
            }

            var clue = clueById[best.Zone.ClueId];
            state.CapturedClueIds.Add(clue.ClueId);
            var newClues = state.UnlockedClueIds.Contains(clue.ClueId)
                ? new List<string>()
                : new List<string> { clue.ClueId };
            state.UnlockedClueIds.AddRange(newClues);

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "CAPTURE_CLUE", $"{user.FullName} photographed {clue.Title}.",
                new { clueId = clue.ClueId, sceneId = scene.SceneId, request.CaptureRect });
            foreach (var clueId in newClues)
            {
                await LogAsync(roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, source = "camera" });
                await _notifier.ClueUnlocked(roomId, clueId, "camera", user.Id, state.Version);
            }

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                CaptureResult = "HIT",
                MatchedClueId = clue.ClueId,
                UnlockedClueIds = newClues,
                Message = newClues.Count > 0 ? "Evidence photo captured." : "Evidence photo already linked to the case.",
                Detail = string.IsNullOrWhiteSpace(clue.InventoryDescription) ? clue.Content : clue.InventoryDescription
            };
        }
    }

    // ----- Interrogator: ask dialogue -----

    public async Task<GameActionResponse> AskDialogueAsync(CurrentUser user, string roomId, string dialogueId)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Interrogator, "Only the interrogator can question characters.");

            var dialogue = gameCase.Dialogues.FirstOrDefault(d => d.DialogueId == dialogueId)
                ?? throw ApiException.NotFound("This dialogue does not exist in the case.");
            var scene = CurrentScene(gameCase, state, user.Id);

            if (!scene.CharacterIds.Contains(dialogue.CharacterId))
            {
                throw ApiException.BadRequest("This character is not in the current scene.");
            }

            var missingClues = dialogue.RequiredClueIds.Where(c => !state.UnlockedClueIds.Contains(c)).ToList();
            if (missingClues.Count > 0)
            {
                throw ApiException.BadRequest("You do not have enough information to ask this yet.",
                    new { missingRequiredClueIds = missingClues });
            }

            var character = gameCase.Characters.First(c => c.CharacterId == dialogue.CharacterId);

            if (state.AskedDialogueIds.Contains(dialogueId))
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = $"You already asked {character.Name} this.",
                    Detail = dialogue.Answer
                };
            }

            state.AskedDialogueIds.Add(dialogueId);
            var newClues = dialogue.UnlockClueIds.Where(c => !state.UnlockedClueIds.Contains(c)).ToList();
            state.UnlockedClueIds.AddRange(newClues);

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "ASK_DIALOGUE",
                $"{user.FullName} asked {character.Name}: \"{dialogue.Question}\"", new { dialogueId });
            foreach (var clueId in newClues)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, dialogueId });
            }

            await _notifier.DialogueAnswered(roomId, dialogueId, user.Id, state.Version);
            foreach (var clueId in newClues)
            {
                await _notifier.ClueUnlocked(roomId, clueId, dialogueId, user.Id, state.Version);
            }
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                UnlockedClueIds = newClues,
                Message = newClues.Count > 0 ? "The answer reveals a new clue." : $"{character.Name} answered.",
                Detail = dialogue.Answer
            };
        }
    }

    // ----- Present evidence (optional MVP) -----

    public async Task<GameActionResponse> PresentEvidenceAsync(CurrentUser user, string roomId, string dialogueId, string evidenceId)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;

        var dialogue = gameCase.Dialogues.FirstOrDefault(d => d.DialogueId == dialogueId)
            ?? throw ApiException.NotFound("This dialogue does not exist in the case.");
        var clue = gameCase.Clues.FirstOrDefault(c => c.ClueId == evidenceId)
            ?? throw ApiException.NotFound("This clue does not exist in the case.");

        if (!state.UnlockedClueIds.Contains(evidenceId))
        {
            throw ApiException.BadRequest("You have not unlocked this clue yet.");
        }

        var character = gameCase.Characters.First(c => c.CharacterId == dialogue.CharacterId);
        await LogAsync(roomId, user.Id, "PRESENT_EVIDENCE",
            $"{user.FullName} presented \"{clue.Title}\" to {character.Name}.", new { dialogueId, evidenceId });
        await _notifier.EvidencePresented(roomId, dialogueId, evidenceId, user.Id, state.Version);

        return new GameActionResponse
        {
            State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
            Changed = false,
            Message = $"You presented \"{clue.Title}\" to {character.Name}.",
            Detail = dialogue.Answer
        };
    }

    // ----- Scene / stage progression -----

    public async Task<GameActionResponse> CompleteSceneAsync(CurrentUser user, string roomId)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            var scene = CurrentScene(gameCase, state, user.Id);

            if (GameRules.IsSceneAlreadyCompleted(state, scene.SceneId))
            {
                var nextOpened = NextOpenedScene(gameCase, state, scene.SceneId);
                if (nextOpened is not null)
                {
                    var completedStageId = StageForScene(gameCase, scene.SceneId).StageId;
                    var nextStage = StageForScene(gameCase, nextOpened.SceneId);
                    SetPlayerScene(state, user.Id, nextStage.StageId, nextOpened.SceneId);

                    if (!await TrySaveStateAsync(room))
                    {
                        if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                        continue;
                    }

                    var moveMessage = $"Moved to {nextOpened.Title}.";
                    await LogAsync(roomId, user.Id, "GO_TO_SCENE", $"{user.FullName} moved to {nextOpened.Title}.", new { nextOpened.SceneId });
                    if (completedStageId != nextStage.StageId)
                    {
                        await _notifier.StageChanged(roomId, completedStageId, nextStage.StageId,
                            scene.SceneId, nextOpened.SceneId, false, user.Id, state.Version);
                    }
                    else
                    {
                        await _notifier.SceneChanged(roomId, scene.SceneId, nextOpened.SceneId, user.Id, state.Version);
                    }

                    var movedState = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
                    await _notifier.GameStateUpdated(roomId, movedState);
                    return new GameActionResponse { State = movedState, Changed = true, Message = moveMessage };
                }

                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = $"{scene.Title} is already complete."
                };
            }

            var inspected = state.InspectedItemIds.ToHashSet();
            var unlocked = state.UnlockedClueIds.ToHashSet();
            var asked = state.AskedDialogueIds.ToHashSet();

            if (!CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspected, unlocked, asked))
            {
                throw ApiException.BadRequest("Scene requirements are not complete.", new
                {
                    missing = new MissingRequirementsDto
                    {
                        RequiredItemIds = scene.CompleteCondition.RequiredItemIds.Where(i => !inspected.Contains(i)).ToList(),
                        RequiredClueIds = scene.CompleteCondition.RequiredClueIds.Where(c => !unlocked.Contains(c)).ToList(),
                        RequiredDialogueIds = scene.CompleteCondition.RequiredDialogueIds.Where(d => !asked.Contains(d)).ToList()
                    }
                });
            }

            if (!state.CompletedSceneIds.Contains(scene.SceneId))
            {
                state.CompletedSceneIds.Add(scene.SceneId);
            }

            var (previousStageId, previousSceneId) = (StageForScene(gameCase, scene.SceneId).StageId, scene.SceneId);
            var orderedStages = gameCase.Stages.OrderBy(s => s.Order).ToList();
            var stage = orderedStages.First(s => s.Scenes.Any(s => s.SceneId == scene.SceneId));
            var sceneIndex = stage.Scenes.FindIndex(s => s.SceneId == scene.SceneId);

            string message;
            var stageChanged = false;
            var isFinalStageCompleted = false;

            if (sceneIndex + 1 < stage.Scenes.Count)
            {
                // Next scene in the same stage.
                var next = stage.Scenes[sceneIndex + 1];
                SetPlayerScene(state, user.Id, stage.StageId, next.SceneId);
                if (!state.VisitedSceneIds.Contains(next.SceneId)) state.VisitedSceneIds.Add(next.SceneId);
                message = $"A new location opened: {next.Title}.";
            }
            else
            {
                // Stage finished.
                if (!state.CompletedStageIds.Contains(stage.StageId))
                {
                    state.CompletedStageIds.Add(stage.StageId);
                }

                var stageIndex = orderedStages.FindIndex(s => s.StageId == stage.StageId);
                if (stageIndex + 1 < orderedStages.Count)
                {
                    var nextStage = orderedStages[stageIndex + 1];
                    var nextScene = nextStage.Scenes.First();
                    SetPlayerScene(state, user.Id, nextStage.StageId, nextScene.SceneId);
                    if (!state.VisitedSceneIds.Contains(nextScene.SceneId)) state.VisitedSceneIds.Add(nextScene.SceneId);
                    stageChanged = true;
                    message = $"The investigation moves on: {nextScene.Title}.";
                }
                else
                {
                    // Last scene of last stage: stay here; the accusation becomes available.
                    stageChanged = true;
                    isFinalStageCompleted = true;
                    SetPlayerScene(state, user.Id, stage.StageId, scene.SceneId);
                    message = "Every lead has been followed. It is time for the final accusation.";
                }
            }

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "COMPLETE_SCENE", message, new { sceneId = scene.SceneId });

            if (stageChanged)
            {
                await _notifier.StageChanged(roomId, previousStageId, state.CurrentStageId,
                    previousSceneId, state.PlayerSceneIds.GetValueOrDefault(user.Id, state.CurrentSceneId), isFinalStageCompleted, user.Id, state.Version);
            }
            else
            {
                await _notifier.SceneChanged(roomId, previousSceneId, state.PlayerSceneIds.GetValueOrDefault(user.Id, state.CurrentSceneId), user.Id, state.Version);
            }

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse { State = stateResponse, Changed = true, Message = message };
        }
    }

    public async Task<GameActionResponse> CompleteStageAsync(CurrentUser user, string roomId)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;
        var orderedStages = gameCase.Stages.OrderBy(s => s.Order).ToList();
        var playerScene = CurrentScene(gameCase, state, user.Id);
        var currentStageIndex = orderedStages.FindIndex(s => s.Scenes.Any(scene => scene.SceneId == playerScene.SceneId));
        if (currentStageIndex < 0)
        {
            throw ApiException.BadRequest("The current stage no longer exists in the case definition.");
        }
        var stage = orderedStages[currentStageIndex];

        var incomplete = GameRules.MissingSceneIds(stage, state).ToList();
        if (incomplete.Count > 0)
        {
            var previousStage = currentStageIndex > 0 ? orderedStages[currentStageIndex - 1] : null;
            if (previousStage is not null && GameRules.IsStageComplete(previousStage, state))
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "Previous stage is complete. Current stage is still in progress."
                };
            }

            throw ApiException.BadRequest("Not every scene in this stage is complete.",
                new { incompleteSceneIds = incomplete });
        }

        return new GameActionResponse
        {
            State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
            Changed = false,
            Message = "Stage is complete."
        };
    }

    public async Task<GameActionResponse> GoToSceneAsync(CurrentUser user, string roomId, string sceneId)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;

            var target = gameCase.Stages.SelectMany(st => st.Scenes.Select(sc => (Stage: st, Scene: sc)))
                .FirstOrDefault(x => x.Scene.SceneId == sceneId);
            if (target.Scene is null)
            {
                throw ApiException.NotFound("This scene does not exist in the case.");
            }

            if (!state.VisitedSceneIds.Contains(sceneId))
            {
                throw ApiException.BadRequest("You can only revisit places the investigation has already opened.");
            }

            var currentPlayerSceneId = state.PlayerSceneIds.GetValueOrDefault(user.Id, state.CurrentSceneId);
            if (currentPlayerSceneId == sceneId)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "You are already here."
                };
            }

            var previousSceneId = state.PlayerSceneIds.GetValueOrDefault(user.Id, state.CurrentSceneId);
            SetPlayerScene(state, user.Id, target.Stage.StageId, sceneId);

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "GO_TO_SCENE", $"{user.FullName} moved to {target.Scene.Title}.", new { sceneId });
            await _notifier.SceneChanged(roomId, previousSceneId, sceneId, user.Id, state.Version);
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse { State = stateResponse, Changed = true, Message = $"Moved to {target.Scene.Title}." };
        }
    }

    // ----- Final accusation -----

    public async Task<GameResultResponse> AccuseAsync(CurrentUser user, string roomId, AccuseRequest request)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;

        var playerSceneId = state.PlayerSceneIds.GetValueOrDefault(user.Id, state.CurrentSceneId);
        if (!GameRules.IsAccusationAvailable(gameCase, state, playerSceneId))
        {
            throw ApiException.BadRequest("The final accusation is not available yet. Reach the final scene and gather all required evidence first.");
        }

        if (gameCase.Characters.All(c => c.CharacterId != request.CulpritId))
        {
            throw ApiException.BadRequest("The accused person is not part of this case.");
        }

        var submittedEvidenceIds = request.EvidenceIds ?? new List<string>();
        var unknownEvidence = submittedEvidenceIds.Where(e => !state.UnlockedClueIds.Contains(e)).ToList();
        if (unknownEvidence.Count > 0)
        {
            throw ApiException.BadRequest("You can only present clues your team has unlocked.",
                new { unknownEvidenceIds = unknownEvidence });
        }

        var success = request.CulpritId == gameCase.FinalLogic.CulpritId
            && gameCase.FinalLogic.RequiredEvidenceIds.All(submittedEvidenceIds.Contains);

        state.SelectedEvidenceIds = submittedEvidenceIds.Distinct().ToList();
        state.GameStatus = success ? GameStatus.Won : GameStatus.Failed;
        state.CompletedAt = DateTime.UtcNow;
        room.Status = RoomStatus.Completed;

        if (!await TrySaveStateAsync(room))
        {
            throw ApiException.Conflict("The game state changed; please retry.");
        }

        var result = new GameResult
        {
            RoomId = roomId,
            CaseId = gameCase.CaseId,
            Players = room.Players.Select(p => p.UserId).ToList(),
            SelectedCulpritId = request.CulpritId,
            SelectedEvidenceIds = state.SelectedEvidenceIds,
            Success = success,
            Ending = success ? gameCase.FinalLogic.WinEnding : gameCase.FinalLogic.FailEnding
        };
        await _db.GameResults.InsertOneAsync(result);

        var accusedName = gameCase.Characters.First(c => c.CharacterId == request.CulpritId).Name;
        await LogAsync(roomId, user.Id, "ACCUSE",
            success ? $"{user.FullName} accused {accusedName} — the case is solved!" : $"{user.FullName} accused {accusedName} — the accusation failed.",
            new { request.CulpritId, EvidenceIds = submittedEvidenceIds });

        var resultResponse = ToResultResponse(result, gameCase);
        await _notifier.GameCompleted(roomId, resultResponse);
        await _notifier.GameStateUpdated(roomId, await _stateBuilder.BuildStateAsync(room, gameCase, user.Id));
        return resultResponse;
    }

    // ----- Helpers -----

    private async Task<(GameRoom Room, GameCase Case, RoomPlayer Player)> LoadContextAsync(string userId, string roomId, bool requireInProgress)
    {
        var room = await _db.Rooms.Find(r => r.Id == roomId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("Room not found.");

        var player = room.Players.FirstOrDefault(p => p.UserId == userId)
            ?? throw ApiException.Forbidden("You are not a member of this room.");

        if (requireInProgress)
        {
            if (room.Status == RoomStatus.Completed)
            {
                throw ApiException.BadRequest("This game is already finished.");
            }
            if (room.Status != RoomStatus.InProgress || room.GameplayState is null)
            {
                throw ApiException.BadRequest("The game has not started yet.");
            }
        }

        var gameCase = await _caseService.GetCaseAsync(room.CaseId);
        return (room, gameCase, player);
    }

    private static void RequireRole(RoomPlayer player, string role, string message)
    {
        if (player.Role != role)
        {
            throw ApiException.Forbidden(message);
        }
    }

    private static CaseScene CurrentScene(GameCase gameCase, GameplayState state, string userId)
    {
        var sceneId = state.PlayerSceneIds.GetValueOrDefault(userId, state.CurrentSceneId);
        return gameCase.Stages.SelectMany(s => s.Scenes).FirstOrDefault(s => s.SceneId == sceneId)
            ?? throw ApiException.BadRequest("The current scene no longer exists in the case definition.");
    }

    private static CaseStage StageForScene(GameCase gameCase, string sceneId) =>
        gameCase.Stages.FirstOrDefault(s => s.Scenes.Any(scene => scene.SceneId == sceneId))
            ?? throw ApiException.BadRequest("The current stage no longer exists in the case definition.");

    private static CaseScene? NextOpenedScene(GameCase gameCase, GameplayState state, string sceneId)
    {
        var scenes = gameCase.Stages
            .OrderBy(s => s.Order)
            .SelectMany(s => s.Scenes)
            .ToList();
        var index = scenes.FindIndex(scene => scene.SceneId == sceneId);
        if (index < 0 || index + 1 >= scenes.Count) return null;

        var next = scenes[index + 1];
        return state.VisitedSceneIds.Contains(next.SceneId) ? next : null;
    }

    private static void SetPlayerScene(GameplayState state, string userId, string stageId, string sceneId)
    {
        state.PlayerSceneIds[userId] = sceneId;
        state.CurrentStageId = stageId;
        state.CurrentSceneId = sceneId;
    }

    /// <summary>Optimistic concurrency: persists the room only if the stored version still matches.</summary>
    private async Task<bool> TrySaveStateAsync(GameRoom room)
    {
        var state = room.GameplayState!;
        var expectedVersion = state.Version;
        state.Version = expectedVersion + 1;
        state.UpdatedAt = DateTime.UtcNow;
        room.UpdatedAt = DateTime.UtcNow;

        var filter = Builders<GameRoom>.Filter.And(
            Builders<GameRoom>.Filter.Eq(r => r.Id, room.Id),
            Builders<GameRoom>.Filter.Eq("gameplayState.version", expectedVersion));
        var result = await _db.Rooms.ReplaceOneAsync(filter, room);
        if (result.ModifiedCount == 0)
        {
            state.Version = expectedVersion;
            return false;
        }
        return true;
    }

    private async Task LogAsync(string roomId, string userId, string actionType, string message, object payload)
    {
        await _db.ActionLogs.InsertOneAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = actionType,
            Message = message,
            PayloadJson = System.Text.Json.JsonSerializer.Serialize(payload)
        });
    }

    private static CameraRules NormalizeCameraRules(CameraRules? rules) => new()
    {
        CaptureRectWidth = rules?.CaptureRectWidth is > 0 ? rules.CaptureRectWidth : 180,
        CaptureRectHeight = rules?.CaptureRectHeight is > 0 ? rules.CaptureRectHeight : 140,
        MinClueCoverage = ClampRatio(rules?.MinClueCoverage, 0.45),
        NearMissCoverage = Math.Min(ClampRatio(rules?.NearMissCoverage, 0.22), ClampRatio(rules?.MinClueCoverage, 0.45)),
        RequireCaptureCenterInside = rules?.RequireCaptureCenterInside ?? true
    };

    private static double ClampRatio(double? value, double fallback)
    {
        var v = value is > 0 ? value.Value : fallback;
        return Math.Clamp(v, 0.01, 1);
    }

    private static double ClueCoverage(CaptureRectDto capture, RuntimeBox clue)
    {
        var left = Math.Max(capture.X, clue.X);
        var top = Math.Max(capture.Y, clue.Y);
        var right = Math.Min(capture.X + capture.Width, clue.X + clue.Width);
        var bottom = Math.Min(capture.Y + capture.Height, clue.Y + clue.Height);
        if (right <= left || bottom <= top || clue.Width <= 0 || clue.Height <= 0) return 0;

        var intersection = (right - left) * (bottom - top);
        return intersection / (clue.Width * clue.Height);
    }

    private static bool CaptureCenterInside(CaptureRectDto capture, RuntimeBox clue)
    {
        var centerX = capture.X + capture.Width / 2;
        var centerY = capture.Y + capture.Height / 2;
        return centerX >= clue.X && centerX <= clue.X + clue.Width
               && centerY >= clue.Y && centerY <= clue.Y + clue.Height;
    }

    private static GameResultResponse ToResultResponse(GameResult result, GameCase gameCase)
    {
        string NameOf(string characterId) =>
            gameCase.Characters.FirstOrDefault(c => c.CharacterId == characterId)?.Name ?? characterId;

        return new GameResultResponse
        {
            RoomId = result.RoomId,
            CaseId = result.CaseId,
            CaseTitle = gameCase.Title,
            SelectedCulpritId = result.SelectedCulpritId,
            SelectedCulpritName = NameOf(result.SelectedCulpritId),
            SelectedEvidenceIds = result.SelectedEvidenceIds,
            Success = result.Success,
            Ending = result.Ending,
            CorrectCulpritId = gameCase.FinalLogic.CulpritId,
            CorrectCulpritName = NameOf(gameCase.FinalLogic.CulpritId),
            Motive = gameCase.FinalLogic.Motive,
            Method = gameCase.FinalLogic.Method,
            RequiredEvidenceIds = gameCase.FinalLogic.RequiredEvidenceIds,
            CompletedAt = result.CreatedAt
        };
    }
}
