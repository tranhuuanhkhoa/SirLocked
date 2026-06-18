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
    private readonly IEvidencePhotoService _evidencePhotos;

    public GameplayService(
        MongoDbContext db,
        ICaseService caseService,
        IGameNotifier notifier,
        IGameStateBuilder stateBuilder,
        IEvidencePhotoService evidencePhotos)
    {
        _db = db;
        _caseService = caseService;
        _notifier = notifier;
        _stateBuilder = stateBuilder;
        _evidencePhotos = evidencePhotos;
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
            RecordClueDiscoveries(state, newClues, user.Id, player.Role, ClueDiscoverySources.Inspect);

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
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, itemId);
            else
                foreach (var clueId in newClues) await _notifier.ClueUnlocked(roomId, clueId, itemId, user.Id, state.Version);
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

    public async Task<EvidencePhotoContent> GetEvidencePhotoAsync(string userId, string roomId, string clueId)
    {
        var (room, _, _) = await LoadContextAsync(userId, roomId, requireInProgress: false);
        if (room.GameplayState is null || !room.GameplayState.UnlockedClueIds.Contains(clueId))
        {
            throw ApiException.NotFound("This evidence photo is not available.");
        }

        var photo = await _evidencePhotos.GetAsync(roomId, clueId)
            ?? throw ApiException.NotFound("This evidence photo is not available.");
        return new EvidencePhotoContent(photo.ImageData, photo.ContentType);
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
                state.CameraMissCount++;
                if (!await TrySaveStateAsync(room))
                {
                    if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                    continue;
                }
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
                state.CameraMissCount++;
                if (!await TrySaveStateAsync(room))
                {
                    if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                    continue;
                }
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
            var normalizedPhoto = await _evidencePhotos.NormalizeAsync(request.Photo);
            await _evidencePhotos.UpsertAsync(
                roomId,
                clue.ClueId,
                scene.SceneId,
                user.Id,
                normalizedPhoto);
            state.CapturedClueIds.Add(clue.ClueId);
            var newClues = state.UnlockedClueIds.Contains(clue.ClueId)
                ? new List<string>()
                : new List<string> { clue.ClueId };
            state.UnlockedClueIds.AddRange(newClues);
            RecordClueDiscoveries(state, newClues, user.Id, player.Role, ClueDiscoverySources.Camera);

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
            }
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, "camera");
            else
                foreach (var clueId in newClues) await _notifier.ClueUnlocked(roomId, clueId, "camera", user.Id, state.Version);

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
            RecordClueDiscoveries(state, newClues, user.Id, player.Role, ClueDiscoverySources.Dialogue);

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
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, dialogueId);
            else
                foreach (var clueId in newClues) await _notifier.ClueUnlocked(roomId, clueId, dialogueId, user.Id, state.Version);
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

    // ----- Interrogator: conversation tree -----

    public async Task<ConverseResponse> ConverseAsync(CurrentUser user, string roomId, ConverseRequest request)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Interrogator, "Only the interrogator can question characters.");

            var scene = CurrentScene(gameCase, state, user.Id);
            var ruleResult = GameplayConversationRules.Apply(
                gameCase,
                state,
                scene,
                request,
                user.Id,
                player.Role ?? string.Empty,
                DateTime.UtcNow);

            if (ruleResult.Changed)
            {
                if (!await TrySaveStateAsync(room))
                {
                    if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                    continue;
                }
            }

            var character = gameCase.Characters.First(character => character.CharacterId == request.CharacterId);
            if (ruleResult.Changed || ruleResult.SelectedChoice is not null)
            {
                await LogAsync(roomId, user.Id, "CONVERSE",
                    $"{user.FullName} continued the conversation with {character.Name}.",
                    new
                    {
                        request.CharacterId,
                        NodeId = ruleResult.Node.NodeId,
                        ChoiceId = ruleResult.SelectedChoice?.ChoiceId
                    });
            }

            if (ruleResult.Changed)
            {
                foreach (var clueId in ruleResult.UnlockedClueIds)
                {
                    var clue = gameCase.Clues.First(clue => clue.ClueId == clueId);
                    await LogAsync(roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.",
                        new { clueId, conversationNodeId = ruleResult.Node.NodeId });
                }

                await NotifyNewCluesAndDialoguesAsync(
                    roomId,
                    gameCase,
                    state,
                    user,
                    player,
                    scene.SceneId,
                    ruleResult.UnlockedClueIds,
                    ruleResult.Node.NodeId);
            }

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            if (ruleResult.Changed)
                await _notifier.GameStateUpdated(roomId, stateResponse);

            var unlocked = state.UnlockedClueIds.ToHashSet();
            return new ConverseResponse
            {
                Node = ConversationNodeDto.From(ruleResult.Node),
                Choices = ruleResult.Node.Choices
                    .Select(choice => ConversationChoiceDto.From(choice, unlocked))
                    .ToList(),
                Challenge = GameplayConversationRules.BuildChallengeDto(gameCase, state, ruleResult.Node.ChallengeId),
                UnlockedClueIds = ruleResult.UnlockedClueIds.ToList(),
                State = stateResponse,
                Changed = ruleResult.Changed
            };
        }
    }

    // ----- Present evidence / confrontation -----

    public async Task<GameActionResponse> PresentEvidenceAsync(CurrentUser user, string roomId, PresentEvidenceRequest request)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            var clue = gameCase.Clues.FirstOrDefault(c => c.ClueId == request.EvidenceId)
                ?? throw ApiException.NotFound("This clue does not exist in the case.");
            if (!state.UnlockedClueIds.Contains(request.EvidenceId))
                throw ApiException.BadRequest("You have not unlocked this clue yet.");

            if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV2)
            {
                if (string.IsNullOrWhiteSpace(request.DialogueId))
                    throw ApiException.BadRequest("dialogueId is required for legacy cases.");
                var legacyDialogue = gameCase.Dialogues.FirstOrDefault(d => d.DialogueId == request.DialogueId)
                    ?? throw ApiException.NotFound("This dialogue does not exist in the case.");
                var legacyCharacter = gameCase.Characters.First(c => c.CharacterId == legacyDialogue.CharacterId);
                await LogAsync(roomId, user.Id, "PRESENT_EVIDENCE",
                    $"{user.FullName} presented \"{clue.Title}\" to {legacyCharacter.Name}.", new { request.DialogueId, request.EvidenceId });
                await _notifier.EvidencePresented(roomId, request.DialogueId, request.EvidenceId, user.Id, state.Version);
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = $"You presented \"{clue.Title}\" to {legacyCharacter.Name}.",
                    Detail = legacyDialogue.Answer
                };
            }

            if (string.IsNullOrWhiteSpace(request.ChallengeId))
                throw ApiException.BadRequest("challengeId is required for V2 cases.");
            RequireRole(player, PlayerRole.Interrogator, "Only the interrogator can confront characters with evidence.");

            var challenge = gameCase.EvidenceChallenges.FirstOrDefault(c => c.ChallengeId == request.ChallengeId)
                ?? throw ApiException.NotFound("This evidence challenge does not exist in the case.");
            var dialogue = gameCase.Dialogues.First(d => d.DialogueId == challenge.DialogueId);
            var scene = CurrentScene(gameCase, state, user.Id);
            if (!scene.CharacterIds.Contains(dialogue.CharacterId))
                throw ApiException.BadRequest("This character is not in the current scene.");
            if (!GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, challenge))
                throw ApiException.BadRequest("Ask the related question before presenting evidence.");

            var ruleResult = GameplayV2Rules.ApplyEvidence(
                state, challenge, request.EvidenceId, user.Id, player.Role ?? string.Empty, DateTime.UtcNow);
            if (ruleResult.Outcome == ConfrontationOutcome.AlreadyResolved)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "This contradiction has already been resolved.",
                    Detail = challenge.SuccessResponse
                };
            }

            if (ruleResult.Outcome == ConfrontationOutcome.DuplicateRejected)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "That evidence has already been tried here.",
                    Detail = challenge.FailureResponse
                };
            }

            var correct = ruleResult.Outcome == ConfrontationOutcome.Resolved;
            var newClues = ruleResult.UnlockedClueIds.ToList();

            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            var character = gameCase.Characters.First(c => c.CharacterId == dialogue.CharacterId);
            await LogAsync(roomId, user.Id, correct ? "CONTRADICTION_RESOLVED" : "PRESENT_EVIDENCE_FAILED",
                correct ? $"{user.FullName} exposed a contradiction in {character.Name}'s testimony."
                    : $"{user.FullName} presented unrelated evidence to {character.Name}.",
                new { challenge.ChallengeId, request.EvidenceId });
            await _notifier.EvidencePresented(roomId, dialogue.DialogueId, request.EvidenceId, user.Id, state.Version);
            if (correct)
            {
                await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
                {
                    Type = "CONTRADICTION_RESOLVED",
                    ActorUserId = user.Id,
                    ActorRole = player.Role ?? string.Empty,
                    SceneId = scene.SceneId,
                    TargetId = challenge.ChallengeId,
                    Message = "A contradiction has been exposed.",
                    Version = state.Version
                });
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, challenge.ChallengeId);
            }

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);
            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                UnlockedClueIds = newClues,
                Message = correct ? "The evidence breaks the testimony." : "The evidence does not support this confrontation.",
                Detail = correct ? challenge.SuccessResponse : challenge.FailureResponse
            };
        }
    }

    public async Task<HintResponse> RequestHintAsync(CurrentUser user, string roomId, HintRequest request)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            var scene = CurrentScene(gameCase, state, user.Id);
            var context = request.ContextType.Trim().ToUpperInvariant();

            if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV2)
            {
                if (context != HintContextTypes.Scene || request.TargetId != scene.SceneId)
                    throw ApiException.BadRequest("Legacy cases only support hints for the current scene.");
                return new HintResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    ContextType = context,
                    TargetId = scene.SceneId,
                    Message = BuildLegacyHint(scene, state),
                    IsNew = false
                };
            }

            if (context == HintContextTypes.Scene)
            {
                if (request.TargetId != scene.SceneId)
                    throw ApiException.BadRequest("Scene hints are only available for your current scene.");
            }
            else if (context == HintContextTypes.Confrontation)
            {
                var challenge = gameCase.EvidenceChallenges.FirstOrDefault(c => c.ChallengeId == request.TargetId)
                    ?? throw ApiException.NotFound("This evidence challenge does not exist in the case.");
                if (!GameplayConversationRules.IsChallengeAvailable(gameCase, state, scene, challenge))
                    throw ApiException.BadRequest("This confrontation is not available in the current scene.");
                if (state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == challenge.ChallengeId))
                    throw ApiException.BadRequest("This confrontation is already resolved.");
            }
            else if (context == HintContextTypes.Deduction)
            {
                var deduction = gameCase.Deductions.FirstOrDefault(d => d.DeductionId == request.TargetId)
                    ?? throw ApiException.NotFound("This deduction does not exist in the case.");
                var resolvedChallengeIds = state.ResolvedConfrontationRecords.Select(record => record.ChallengeId).ToHashSet();
                if (deduction.RequiredClueIds.Any(id => !state.UnlockedClueIds.Contains(id))
                    || deduction.RequiredChallengeIds.Any(id => !resolvedChallengeIds.Contains(id)))
                    throw ApiException.BadRequest("This deduction is not available yet.");
                if (state.SolvedDeductionRecords.Any(record => record.DeductionId == deduction.DeductionId))
                    throw ApiException.BadRequest("This deduction is already solved.");
            }
            else
            {
                throw ApiException.BadRequest("V2 hints only support SCENE, CONFRONTATION, and DEDUCTION.");
            }

            var hints = gameCase.Hints
                .Where(h => h.ContextType.Equals(context, StringComparison.OrdinalIgnoreCase) && h.TargetId == request.TargetId)
                .OrderBy(h => h.Order).ToList();
            if (hints.Count == 0) throw ApiException.NotFound("No hint is available for this target.");

            var selected = hints.FirstOrDefault(h => !state.UsedHintIds.Contains(h.HintId)) ?? hints[^1];
            var isNew = !state.UsedHintIds.Contains(selected.HintId);
            if (!isNew)
            {
                return new HintResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    HintId = selected.HintId,
                    ContextType = context,
                    TargetId = request.TargetId,
                    Message = selected.Text,
                    IsNew = false
                };
            }

            state.UsedHintIds.Add(selected.HintId);
            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, "HINT_USED", $"{user.FullName} requested an investigation hint.",
                new { selected.HintId, context, request.TargetId });
            await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
            {
                Type = "SCENE_HINT_USED",
                ActorUserId = user.Id,
                ActorRole = player.Role ?? string.Empty,
                SceneId = scene.SceneId,
                TargetId = request.TargetId,
                Message = "Your teammate requested an investigation hint.",
                Version = state.Version
            });
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);
            return new HintResponse
            {
                State = stateResponse,
                HintId = selected.HintId,
                ContextType = context,
                TargetId = request.TargetId,
                Message = selected.Text,
                IsNew = true
            };
        }
    }

    public async Task<GameActionResponse> SolveDeductionAsync(CurrentUser user, string roomId, SolveDeductionRequest request)
    {
        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            if (gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV2)
                throw ApiException.BadRequest("Deductions are only available in V2 cases.");

            var state = room.GameplayState!;
            var scene = CurrentScene(gameCase, state, user.Id);
            var deduction = gameCase.Deductions.FirstOrDefault(d => d.DeductionId == request.DeductionId)
                ?? throw ApiException.NotFound("This deduction does not exist in the case.");
            if (deduction.Options.All(option => option.Id != request.OptionId))
                throw ApiException.BadRequest("Select a valid deduction option.");

            var resolvedChallengeIds = state.ResolvedConfrontationRecords.Select(record => record.ChallengeId).ToHashSet();
            var missingClues = deduction.RequiredClueIds.Where(id => !state.UnlockedClueIds.Contains(id)).ToList();
            var missingChallenges = deduction.RequiredChallengeIds.Where(id => !resolvedChallengeIds.Contains(id)).ToList();
            if (missingClues.Count > 0 || missingChallenges.Count > 0)
                throw ApiException.BadRequest("This deduction is not available yet.", new { missingClues, missingChallenges });

            var ruleResult = GameplayV2Rules.ApplyDeduction(
                state, deduction, request.OptionId, user.Id, player.Role ?? string.Empty, DateTime.UtcNow);
            if (ruleResult.Outcome == DeductionOutcome.AlreadySolved)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "This deduction has already been solved.",
                    Detail = deduction.SuccessResponse
                };
            }

            if (ruleResult.Outcome == DeductionOutcome.DuplicateRejected)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "That deduction answer has already been tried.",
                    Detail = deduction.FailureResponse
                };
            }

            var solved = ruleResult.Outcome == DeductionOutcome.Solved;
            var newClues = ruleResult.UnlockedClueIds.ToList();
            if (!await TrySaveStateAsync(room))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(roomId, user.Id, solved ? "DEDUCTION_SOLVED" : "DEDUCTION_FAILED",
                solved ? $"{user.FullName} resolved a deduction." : $"{user.FullName} tested an incorrect deduction.",
                new { request.DeductionId, request.OptionId });
            if (solved)
            {
                await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
                {
                    Type = "DEDUCTION_SOLVED",
                    ActorUserId = user.Id,
                    ActorRole = player.Role ?? string.Empty,
                    SceneId = scene.SceneId,
                    TargetId = deduction.DeductionId,
                    Message = "A deduction has been resolved.",
                    Version = state.Version
                });
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, deduction.DeductionId);
            }

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse);
            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                UnlockedClueIds = newClues,
                Message = solved ? "The deduction fits the evidence." : "That deduction does not hold.",
                Detail = solved ? deduction.SuccessResponse : deduction.FailureResponse
            };
        }
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

        var isV2 = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2;
        List<string> submittedEvidenceIds;
        bool success;
        if (isV2)
        {
            var validationError = GameplayV2Rules.ValidateAccusation(gameCase, state, request);
            if (validationError is not null) throw ApiException.BadRequest(validationError);
            submittedEvidenceIds = request.EvidenceLinks.Select(link => link.EvidenceId).ToList();
            success = GameplayV2Rules.IsAccusationCorrect(gameCase, request);
        }
        else
        {
            submittedEvidenceIds = request.EvidenceIds ?? new List<string>();
            var unknownEvidence = submittedEvidenceIds.Where(e => !state.UnlockedClueIds.Contains(e)).ToList();
            if (unknownEvidence.Count > 0)
                throw ApiException.BadRequest("You can only present clues your team has unlocked.", new { unknownEvidenceIds = unknownEvidence });
            success = request.CulpritId == gameCase.FinalLogic.CulpritId
                && gameCase.FinalLogic.RequiredEvidenceIds.All(submittedEvidenceIds.Contains);
        }

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
            SelectedMotiveId = request.MotiveId,
            SelectedMethodId = request.MethodId,
            SelectedEvidenceLinks = request.EvidenceLinks.Select(link => new SelectedEvidenceLink
            {
                ClaimType = link.ClaimType.Trim().ToUpperInvariant(),
                EvidenceId = link.EvidenceId
            }).ToList(),
            ScoreSummary = isV2 ? GameplayV2Rules.BuildScoreSummary(gameCase, state, success) : null,
            Success = success,
            Ending = success ? gameCase.FinalLogic.WinEnding : gameCase.FinalLogic.FailEnding
        };
        await _db.GameResults.InsertOneAsync(result);

        var accusedName = gameCase.Characters.First(c => c.CharacterId == request.CulpritId).Name;
        await LogAsync(roomId, user.Id, "ACCUSE",
            success ? $"{user.FullName} accused {accusedName} — the case is solved!" : $"{user.FullName} accused {accusedName} — the accusation failed.",
            new { request.CulpritId, request.MotiveId, request.MethodId, EvidenceIds = submittedEvidenceIds });

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

    private async Task NotifyNewCluesAndDialoguesAsync(
        string roomId,
        GameCase gameCase,
        GameplayState state,
        CurrentUser user,
        RoomPlayer player,
        string sceneId,
        IReadOnlyCollection<string> newClueIds,
        string sourceId)
    {
        foreach (var clueId in newClueIds)
        {
            await _notifier.ClueUnlocked(roomId, clueId, sourceId, user.Id, state.Version);
            await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
            {
                Type = "CLUE_UNLOCKED",
                ActorUserId = user.Id,
                ActorRole = player.Role ?? string.Empty,
                SceneId = sceneId,
                TargetId = clueId,
                Message = "A new piece of evidence has been discovered.",
                Version = state.Version
            });
        }

        var newlyAvailableDialogues = gameCase.Dialogues
            .Where(dialogue => !state.AskedDialogueIds.Contains(dialogue.DialogueId))
            .Where(dialogue => dialogue.RequiredClueIds.Count > 0 && dialogue.RequiredClueIds.All(state.UnlockedClueIds.Contains))
            .Where(dialogue => dialogue.RequiredClueIds.Any(newClueIds.Contains))
            .ToList();
        foreach (var dialogue in newlyAvailableDialogues)
        {
            var dialogueScene = gameCase.Stages.SelectMany(stage => stage.Scenes)
                .FirstOrDefault(candidate => candidate.CharacterIds.Contains(dialogue.CharacterId));
            await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
            {
                Type = "DIALOGUE_UNLOCKED",
                ActorUserId = user.Id,
                ActorRole = player.Role ?? string.Empty,
                SceneId = dialogueScene?.SceneId ?? sceneId,
                TargetId = dialogue.DialogueId,
                CharacterId = dialogue.CharacterId,
                Message = "New testimony is now available.",
                Version = state.Version
            });
        }

        var newlyAvailableConversationNodes = gameCase.ConversationNodes
            .Where(node => !state.VisitedConversationNodeIds.Contains(node.NodeId))
            .Where(node => node.RequiredClueIds.Count > 0 && node.RequiredClueIds.All(state.UnlockedClueIds.Contains))
            .Where(node => node.RequiredClueIds.Any(newClueIds.Contains))
            .ToList();
        foreach (var node in newlyAvailableConversationNodes)
        {
            var nodeScene = gameCase.Stages.SelectMany(stage => stage.Scenes)
                .FirstOrDefault(candidate => candidate.CharacterIds.Contains(node.CharacterId));
            await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
            {
                Type = "CONVERSATION_NODE_UNLOCKED",
                ActorUserId = user.Id,
                ActorRole = player.Role ?? string.Empty,
                SceneId = nodeScene?.SceneId ?? sceneId,
                TargetId = node.NodeId,
                CharacterId = node.CharacterId,
                Message = "A new conversation topic is now available.",
                Version = state.Version
            });
        }

        // A choice on an already-visited node whose gate just became satisfied.
        foreach (var (node, choice) in GameplayConversationRules.NewlyUnlockedChoices(gameCase, state, newClueIds))
        {
            var choiceScene = gameCase.Stages.SelectMany(stage => stage.Scenes)
                .FirstOrDefault(candidate => candidate.CharacterIds.Contains(node.CharacterId));
            await _notifier.InvestigationUpdate(roomId, new InvestigationUpdateDto
            {
                Type = "CONVERSATION_CHOICE_UNLOCKED",
                ActorUserId = user.Id,
                ActorRole = player.Role ?? string.Empty,
                SceneId = choiceScene?.SceneId ?? sceneId,
                TargetId = choice.ChoiceId,
                CharacterId = node.CharacterId,
                Message = "A new conversation option is now available.",
                Version = state.Version
            });
        }
    }

    private static string BuildLegacyHint(CaseScene scene, GameplayState state)
    {
        if (scene.CompleteCondition.RequiredDialogueIds.Any(id => !state.AskedDialogueIds.Contains(id)))
            return "An important statement has not been verified yet.";
        if (scene.CompleteCondition.RequiredClueIds.Any(id => !state.UnlockedClueIds.Contains(id)))
            return "There is still a suspicious trace in this location.";
        if (scene.CompleteCondition.RequiredItemIds.Any(id => !state.InspectedItemIds.Contains(id)))
            return "An object in this location deserves closer inspection.";
        return "You have enough information to continue the investigation.";
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
        var clueArea = clue.Width * clue.Height;
        var captureArea = capture.Width * capture.Height;
        // Use the higher of two ratios so that large clue zones (bigger than the
        // capture rect) can still be captured by pointing the camera inside them.
        var clueCoverage = intersection / clueArea;
        var captureFill = captureArea > 0 ? intersection / captureArea : 0;
        return Math.Max(clueCoverage, captureFill);
    }

    private static bool CaptureCenterInside(CaptureRectDto capture, RuntimeBox clue)
    {
        var centerX = capture.X + capture.Width / 2;
        var centerY = capture.Y + capture.Height / 2;
        return centerX >= clue.X && centerX <= clue.X + clue.Width
               && centerY >= clue.Y && centerY <= clue.Y + clue.Height;
    }

    private static void RecordClueDiscoveries(GameplayState state, IEnumerable<string> clueIds, string userId, string? role, string sourceAction)
    {
        foreach (var clueId in clueIds)
        {
            if (state.ClueDiscoveries.Any(record => record.ClueId == clueId)) continue;
            state.ClueDiscoveries.Add(new ClueDiscoveryRecord
            {
                ClueId = clueId,
                DiscoveredByUserId = userId,
                DiscoveredByRole = role ?? string.Empty,
                SourceAction = sourceAction,
                DiscoveredAt = DateTime.UtcNow
            });
        }
    }

    private static GameResultResponse ToResultResponse(GameResult result, GameCase gameCase)
    {
        string NameOf(string characterId) =>
            gameCase.Characters.FirstOrDefault(c => c.CharacterId == characterId)?.Name ?? characterId;
        string ClueTitle(string clueId) => gameCase.Clues.FirstOrDefault(clue => clue.ClueId == clueId)?.Title ?? clueId;
        string OptionLabel(IEnumerable<AccusationOption> options, string optionId) =>
            options.FirstOrDefault(option => option.Id == optionId)?.Label ?? optionId;

        var isV2 = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2;
        var evidenceResults = isV2
            ? gameCase.FinalLogic.RequiredEvidenceLinks.Select(required =>
            {
                var selected = result.SelectedEvidenceLinks.FirstOrDefault(link =>
                    link.ClaimType.Equals(required.ClaimType, StringComparison.OrdinalIgnoreCase));
                return new EvidenceClaimResult
                {
                    ClaimType = required.ClaimType,
                    SelectedEvidenceId = selected?.EvidenceId ?? string.Empty,
                    SelectedEvidenceTitle = selected is null ? string.Empty : ClueTitle(selected.EvidenceId),
                    CorrectEvidenceId = required.EvidenceId,
                    CorrectEvidenceTitle = ClueTitle(required.EvidenceId),
                    IsCorrect = selected?.EvidenceId == required.EvidenceId
                };
            }).ToList()
            : new List<EvidenceClaimResult>();

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
            Motive = isV2 ? OptionLabel(gameCase.FinalLogic.MotiveOptions, gameCase.FinalLogic.CorrectMotiveId) : gameCase.FinalLogic.Motive,
            Method = isV2 ? OptionLabel(gameCase.FinalLogic.MethodOptions, gameCase.FinalLogic.CorrectMethodId) : gameCase.FinalLogic.Method,
            RequiredEvidenceIds = isV2
                ? gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId).ToList()
                : gameCase.FinalLogic.RequiredEvidenceIds,
            CulpritResult = isV2 ? new AccusationComponentResult
            {
                SelectedId = result.SelectedCulpritId,
                SelectedLabel = NameOf(result.SelectedCulpritId),
                CorrectId = gameCase.FinalLogic.CulpritId,
                CorrectLabel = NameOf(gameCase.FinalLogic.CulpritId),
                IsCorrect = result.SelectedCulpritId == gameCase.FinalLogic.CulpritId
            } : null,
            MotiveResult = isV2 ? new AccusationComponentResult
            {
                SelectedId = result.SelectedMotiveId,
                SelectedLabel = OptionLabel(gameCase.FinalLogic.MotiveOptions, result.SelectedMotiveId),
                CorrectId = gameCase.FinalLogic.CorrectMotiveId,
                CorrectLabel = OptionLabel(gameCase.FinalLogic.MotiveOptions, gameCase.FinalLogic.CorrectMotiveId),
                IsCorrect = result.SelectedMotiveId == gameCase.FinalLogic.CorrectMotiveId
            } : null,
            MethodResult = isV2 ? new AccusationComponentResult
            {
                SelectedId = result.SelectedMethodId,
                SelectedLabel = OptionLabel(gameCase.FinalLogic.MethodOptions, result.SelectedMethodId),
                CorrectId = gameCase.FinalLogic.CorrectMethodId,
                CorrectLabel = OptionLabel(gameCase.FinalLogic.MethodOptions, gameCase.FinalLogic.CorrectMethodId),
                IsCorrect = result.SelectedMethodId == gameCase.FinalLogic.CorrectMethodId
            } : null,
            EvidenceResults = evidenceResults,
            ScoreSummary = result.ScoreSummary,
            CompletedAt = result.CreatedAt
        };
    }
}
