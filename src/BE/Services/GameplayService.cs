using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class GameplayService : IGameplayService
{
    private const int ActionLogLimit = 40;

    private readonly MongoDbContext _db;
    private readonly ICaseService _caseService;
    private readonly IGameNotifier _notifier;

    public GameplayService(MongoDbContext db, ICaseService caseService, IGameNotifier notifier)
    {
        _db = db;
        _caseService = caseService;
        _notifier = notifier;
    }

    // ----- Read -----

    public async Task<GameStateResponse> GetStateAsync(string userId, string roomId)
    {
        var (room, gameCase, _) = await LoadContextAsync(userId, roomId, requireInProgress: false);
        if (room.GameplayState is null)
        {
            throw ApiException.BadRequest("The game has not started yet.");
        }
        return await BuildStateAsync(room, gameCase);
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
            var scene = CurrentScene(gameCase, state);

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
                    State = await BuildStateAsync(room, gameCase),
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
            var stateResponse = await BuildStateAsync(room, gameCase);
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
            var scene = CurrentScene(gameCase, state);

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
                    State = await BuildStateAsync(room, gameCase),
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
            var stateResponse = await BuildStateAsync(room, gameCase);
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
            State = await BuildStateAsync(room, gameCase),
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
            var scene = CurrentScene(gameCase, state);

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

            var (previousStageId, previousSceneId) = (state.CurrentStageId, state.CurrentSceneId);
            var orderedStages = gameCase.Stages.OrderBy(s => s.Order).ToList();
            var stage = orderedStages.First(s => s.StageId == state.CurrentStageId);
            var sceneIndex = stage.Scenes.FindIndex(s => s.SceneId == scene.SceneId);

            string message;
            var stageChanged = false;
            var isFinalStageCompleted = false;

            if (sceneIndex + 1 < stage.Scenes.Count)
            {
                // Next scene in the same stage.
                var next = stage.Scenes[sceneIndex + 1];
                state.CurrentSceneId = next.SceneId;
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
                    state.CurrentStageId = nextStage.StageId;
                    state.CurrentSceneId = nextScene.SceneId;
                    if (!state.VisitedSceneIds.Contains(nextScene.SceneId)) state.VisitedSceneIds.Add(nextScene.SceneId);
                    stageChanged = true;
                    message = $"The investigation moves on: {nextScene.Title}.";
                }
                else
                {
                    // Last scene of last stage: stay here; the accusation becomes available.
                    stageChanged = true;
                    isFinalStageCompleted = true;
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
                    previousSceneId, state.CurrentSceneId, isFinalStageCompleted, user.Id, state.Version);
            }
            else
            {
                await _notifier.SceneChanged(roomId, previousSceneId, state.CurrentSceneId, user.Id, state.Version);
            }

            var stateResponse = await BuildStateAsync(room, gameCase);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse { State = stateResponse, Changed = true, Message = message };
        }
    }

    public async Task<GameActionResponse> CompleteStageAsync(CurrentUser user, string roomId)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;
        var stage = gameCase.Stages.OrderBy(s => s.Order).First(s => s.StageId == state.CurrentStageId);

        var incomplete = stage.Scenes.Where(s => !state.CompletedSceneIds.Contains(s.SceneId))
            .Select(s => s.SceneId).ToList();
        if (incomplete.Count > 0)
        {
            throw ApiException.BadRequest("Not every scene in this stage is complete.",
                new { incompleteSceneIds = incomplete });
        }

        // All scenes complete means complete-scene already advanced the stage pointer;
        // this endpoint is an idempotent confirmation.
        return new GameActionResponse
        {
            State = await BuildStateAsync(room, gameCase),
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

            if (state.CurrentSceneId == sceneId)
            {
                return new GameActionResponse
                {
                    State = await BuildStateAsync(room, gameCase),
                    Changed = false,
                    Message = "You are already here."
                };
            }

            var previousSceneId = state.CurrentSceneId;
            state.CurrentSceneId = sceneId;
            state.CurrentStageId = target.Stage.StageId;

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "GO_TO_SCENE", $"{user.FullName} moved to {target.Scene.Title}.", new { sceneId });
            await _notifier.SceneChanged(roomId, previousSceneId, sceneId, user.Id, state.Version);
            var stateResponse = await BuildStateAsync(room, gameCase);
            await _notifier.GameStateUpdated(roomId, stateResponse);

            return new GameActionResponse { State = stateResponse, Changed = true, Message = $"Moved to {target.Scene.Title}." };
        }
    }

    // ----- Final accusation -----

    public async Task<GameResultResponse> AccuseAsync(CurrentUser user, string roomId, AccuseRequest request)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;

        if (!IsAccusationAvailable(gameCase, state))
        {
            throw ApiException.BadRequest("The final accusation is not available yet. Reach the final scene and gather all required evidence first.");
        }

        if (gameCase.Characters.All(c => c.CharacterId != request.CulpritId))
        {
            throw ApiException.BadRequest("The accused person is not part of this case.");
        }

        var unknownEvidence = request.EvidenceIds.Where(e => !state.UnlockedClueIds.Contains(e)).ToList();
        if (unknownEvidence.Count > 0)
        {
            throw ApiException.BadRequest("You can only present clues your team has unlocked.",
                new { unknownEvidenceIds = unknownEvidence });
        }

        var success = request.CulpritId == gameCase.FinalLogic.CulpritId
            && gameCase.FinalLogic.RequiredEvidenceIds.All(request.EvidenceIds.Contains);

        state.SelectedEvidenceIds = request.EvidenceIds.Distinct().ToList();
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
            new { request.CulpritId, request.EvidenceIds });

        var resultResponse = ToResultResponse(result, gameCase);
        await _notifier.GameCompleted(roomId, resultResponse);
        await _notifier.GameStateUpdated(roomId, await BuildStateAsync(room, gameCase));
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

    private static CaseScene CurrentScene(GameCase gameCase, GameplayState state) =>
        gameCase.Stages.SelectMany(s => s.Scenes).FirstOrDefault(s => s.SceneId == state.CurrentSceneId)
            ?? throw ApiException.BadRequest("The current scene no longer exists in the case definition.");

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

    private static bool IsAccusationAvailable(GameCase gameCase, GameplayState state)
    {
        var lastStage = gameCase.Stages.OrderBy(s => s.Order).Last();
        var lastScene = lastStage.Scenes.Last();
        return state.GameStatus == GameStatus.InProgress
            && state.CurrentSceneId == lastScene.SceneId
            && gameCase.FinalLogic.RequiredEvidenceIds.All(state.UnlockedClueIds.Contains);
    }

    private async Task<GameStateResponse> BuildStateAsync(GameRoom room, GameCase gameCase)
    {
        var state = room.GameplayState!;
        var unlocked = state.UnlockedClueIds.ToHashSet();
        var scene = CurrentScene(gameCase, state);

        var sceneDialogues = gameCase.Dialogues
            .Where(d => scene.CharacterIds.Contains(d.CharacterId))
            .Select(d => SceneDialogueDto.From(d, unlocked, state.AskedDialogueIds.Contains(d.DialogueId)))
            .ToList();

        var visibleScene = new VisibleSceneDto
        {
            SceneId = scene.SceneId,
            Title = scene.Title,
            Description = scene.Description,
            BackgroundUrl = scene.BackgroundUrl,
            Hotspots = scene.Hotspots.OrderBy(h => h.ZIndex).Select(h => HotspotDto.From(h, unlocked)).ToList(),
            Items = scene.ItemIds
                .Select(id => gameCase.Items.FirstOrDefault(i => i.ItemId == id))
                .Where(i => i is not null)
                .Select(i => SceneItemDto.From(i!, state.InspectedItemIds.Contains(i!.ItemId)))
                .ToList(),
            Characters = scene.CharacterIds
                .Select(id => gameCase.Characters.FirstOrDefault(c => c.CharacterId == id))
                .Where(c => c is not null)
                .Select(c => CaseCharacterDto.From(c!))
                .ToList(),
            AvailableDialogues = sceneDialogues
        };

        var sceneMap = gameCase.Stages.OrderBy(s => s.Order)
            .SelectMany(s => s.Scenes)
            .Select(s => new SceneMapEntryDto
            {
                SceneId = s.SceneId,
                Title = s.Title,
                IsCurrent = s.SceneId == state.CurrentSceneId,
                IsVisited = state.VisitedSceneIds.Contains(s.SceneId),
                IsCompleted = state.CompletedSceneIds.Contains(s.SceneId)
            })
            .ToList();

        var unlockedClues = gameCase.Clues
            .Where(c => unlocked.Contains(c.ClueId))
            .Select(ClueDto.From)
            .ToList();

        var logs = await _db.ActionLogs.Find(l => l.RoomId == room.Id)
            .SortByDescending(l => l.CreatedAt).Limit(ActionLogLimit).ToListAsync();
        logs.Reverse();

        return new GameStateResponse
        {
            RoomId = room.Id,
            RoomCode = room.RoomCode,
            CaseId = gameCase.CaseId,
            CaseTitle = gameCase.Title,
            CaseSummary = gameCase.Summary,
            RoomStatus = room.Status,
            CurrentStageId = state.CurrentStageId,
            CurrentSceneId = state.CurrentSceneId,
            Version = state.Version,
            Players = room.Players.Select(RoomPlayerDto.From).ToList(),
            VisitedSceneIds = state.VisitedSceneIds,
            InspectedItemIds = state.InspectedItemIds,
            CollectedItemIds = state.CollectedItemIds,
            CollectedItems = state.CollectedItemIds
                .Select(id => gameCase.Items.FirstOrDefault(i => i.ItemId == id))
                .Where(i => i is not null)
                .Select(i => SceneItemDto.From(i!, state.InspectedItemIds.Contains(i!.ItemId)))
                .ToList(),
            UnlockedClueIds = state.UnlockedClueIds,
            AskedDialogueIds = state.AskedDialogueIds,
            CompletedSceneIds = state.CompletedSceneIds,
            CompletedStageIds = state.CompletedStageIds,
            SelectedEvidenceIds = state.SelectedEvidenceIds,
            GameStatus = state.GameStatus,
            AvailableForAccusation = IsAccusationAvailable(gameCase, state),
            CurrentObjective = BuildObjective(gameCase, state, scene),
            VisibleScene = visibleScene,
            SceneMap = sceneMap,
            UnlockedClues = unlockedClues,
            EvidenceClues = unlockedClues.Where(c => c.IsEvidence).ToList(),
            Suspects = gameCase.Characters.Select(CaseCharacterDto.From).ToList(),
            ActionLog = logs.Select(l => new ActionLogEntryDto
            {
                ActionType = l.ActionType,
                Message = l.Message,
                UserId = l.UserId,
                CreatedAt = l.CreatedAt
            }).ToList()
        };
    }

    private static string BuildObjective(GameCase gameCase, GameplayState state, CaseScene scene)
    {
        if (state.GameStatus != GameStatus.InProgress)
        {
            return state.GameStatus == GameStatus.Won ? "Case closed — the culprit was exposed." : "Case closed — the culprit escaped.";
        }

        if (IsAccusationAvailable(gameCase, state))
        {
            return "All the evidence is on the table. Confront the suspects and make the final accusation.";
        }

        var inspected = state.InspectedItemIds.ToHashSet();
        var unlocked = state.UnlockedClueIds.ToHashSet();
        var asked = state.AskedDialogueIds.ToHashSet();

        if (CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspected, unlocked, asked))
        {
            return $"You have found everything that matters in {scene.Title}. Continue the investigation when both of you are ready.";
        }

        // Hint by category first; exact IDs stay hidden so deduction remains a game.
        var parts = new List<string>();
        var missingItems = scene.CompleteCondition.RequiredItemIds.Count(i => !inspected.Contains(i));
        var missingClues = scene.CompleteCondition.RequiredClueIds.Count(c => !unlocked.Contains(c));
        var missingDialogues = scene.CompleteCondition.RequiredDialogueIds.Count(d => !asked.Contains(d));
        if (missingItems > 0) parts.Add($"examine {missingItems} more piece(s) of physical evidence");
        if (missingDialogues > 0) parts.Add($"ask {missingDialogues} more question(s)");
        if (missingClues > 0) parts.Add($"uncover {missingClues} more clue(s)");

        return parts.Count == 0
            ? $"Investigate {scene.Title}."
            : $"Investigate {scene.Title}: {string.Join(", ", parts)}.";
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
