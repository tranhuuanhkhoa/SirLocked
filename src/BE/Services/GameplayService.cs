using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public partial class GameplayService : IGameplayService, IAccusationResolver
{
    private readonly MongoDbContext _db;
    private readonly IGameplayContextLoader _contextLoader;
    private readonly IGameplayStatePersistence _statePersistence;
    private readonly IGameNotifier _notifier;
    private readonly IGameStateBuilder _stateBuilder;
    private readonly IEvidencePhotoService _evidencePhotos;
    private readonly IGameResultStore _gameResults;
    private readonly IPlaytestEventSink _playtestEvents;
    private readonly AccusationSettings _accusationSettings;
    private readonly ILogger<GameplayService> _logger;

    public GameplayService(
        MongoDbContext db,
        IGameplayContextLoader contextLoader,
        IGameplayStatePersistence statePersistence,
        IGameNotifier notifier,
        IGameStateBuilder stateBuilder,
        IEvidencePhotoService evidencePhotos,
        IGameResultStore gameResults,
        IPlaytestEventSink playtestEvents,
        IOptions<AccusationSettings> accusationSettings,
        ILogger<GameplayService> logger)
    {
        _db = db;
        _contextLoader = contextLoader;
        _statePersistence = statePersistence;
        _notifier = notifier;
        _stateBuilder = stateBuilder;
        _evidencePhotos = evidencePhotos;
        _gameResults = gameResults;
        _playtestEvents = playtestEvents;
        _accusationSettings = accusationSettings.Value;
        _logger = logger;
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
        var result = await _gameResults.FindByRoomIdAsync(roomId);
        if (result is null)
        {
            if (room.Status == RoomStatus.Completed && room.GameplayState?.FinalAccusationSnapshot is null)
            {
                _logger.LogWarning(
                    "Completed room {RoomId} for case {CaseId} has no final accusation snapshot; result recovery is impossible.",
                    room.Id,
                    room.CaseId);
            }
            result = await GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, _gameResults);
        }
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
                throw DependencyUnavailable(gameCase,
                    "You cannot examine this yet. Something else must be discovered first.",
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

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "INSPECT_ITEM", $"{user.FullName} inspected {item.Name}.", new { itemId });
            foreach (var clueId in newClues)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, itemId });
            }

            if (ShouldBroadcastDetailedEvents(gameCase))
                await _notifier.ItemFound(roomId, itemId, user.Id, state.Version);
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, itemId);
            else
                foreach (var clueId in newClues) await _notifier.ClueUnlocked(roomId, clueId, itemId, user.Id, state.Version);
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                var evidenceCount = newClues.Count(clueId =>
                    gameCase.Clues.Any(clue => clue.ClueId == clueId && clue.IsEvidence));
                if (evidenceCount > 0)
                {
                    await _playtestEvents.RecordAsync(
                        roomId, user.Id, player.Role ?? string.Empty,
                        PlaytestEventType.PrivateDiscoveryCount, stateResponse.Version,
                        count: evidenceCount);
                }
            }

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

    public async Task<GameActionResponse> UseItemAsync(CurrentUser user, string roomId, UseItemRequest request)
    {
        var itemId = request.ItemId.Trim();
        var targetId = request.TargetId.Trim();
        if (string.IsNullOrWhiteSpace(itemId) || string.IsNullOrWhiteSpace(targetId))
            throw ApiException.BadRequest("itemId and targetId are required.");

        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Investigator, "Only the investigator can use inventory items on scene objects.");

            var scene = CurrentScene(gameCase, state, user.Id);
            var item = gameCase.Items.FirstOrDefault(i => i.ItemId == itemId)
                ?? throw ApiException.NotFound("This inventory item does not exist in the case.");
            if (!state.CollectedItemIds.Contains(itemId))
                throw ApiException.BadRequest("You have not collected this item yet.");
            if (!IsTargetAvailableInScene(scene, targetId))
                throw ApiException.BadRequest("That target is not available in the current scene.");

            var candidates = gameCase.Interactions
                .Where(interaction => interaction.Type.Equals(CaseInteractionTypes.UseItemOnTarget, StringComparison.OrdinalIgnoreCase))
                .Where(interaction => interaction.TargetId == targetId)
                .Where(interaction => interaction.RequiredItemIds.Contains(itemId))
                .ToList();
            var interaction = candidates.FirstOrDefault(candidate =>
                candidate.RequiredItemIds.All(state.CollectedItemIds.Contains)
                && candidate.RequiredClueIds.All(state.UnlockedClueIds.Contains));

            if (interaction is null)
            {
                var message = candidates.FirstOrDefault()?.FailureMessage;
                throw ApiException.BadRequest(string.IsNullOrWhiteSpace(message) ? "That item does not work here." : message);
            }

            if (interaction.SingleUse && state.UsedInteractionIds.Contains(interaction.InteractionId))
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    InteractionId = interaction.InteractionId,
                    Message = string.IsNullOrWhiteSpace(interaction.SuccessMessage)
                        ? "This interaction has already been resolved."
                        : interaction.SuccessMessage
                };
            }

            var effects = ApplyMechanicEffects(
                state,
                interaction.UnlockClueIds,
                interaction.UnlockItemIds,
                interaction.UnlockSceneIds,
                interaction.ConsumeItemIds,
                user.Id,
                player.Role,
                ClueDiscoverySources.Interaction);
            if (!state.UsedInteractionIds.Contains(interaction.InteractionId))
                state.UsedInteractionIds.Add(interaction.InteractionId);

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "USE_ITEM",
                $"{user.FullName} used {item.Name} on {targetId}.",
                new { interaction.InteractionId, itemId, targetId });
            foreach (var clueId in effects.NewClueIds)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, interaction.InteractionId });
            }

            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, effects.NewClueIds, interaction.InteractionId);
            else
                foreach (var clueId in effects.NewClueIds) await _notifier.ClueUnlocked(roomId, clueId, interaction.InteractionId, user.Id, state.Version);

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                InteractionId = interaction.InteractionId,
                UnlockedClueIds = effects.NewClueIds,
                UnlockedItemIds = effects.NewItemIds,
                UnlockedSceneIds = effects.NewSceneIds,
                Message = string.IsNullOrWhiteSpace(interaction.SuccessMessage) ? "The item works." : interaction.SuccessMessage
            };
        }
    }

    public async Task<GameActionResponse> CombineItemsAsync(CurrentUser user, string roomId, CombineItemsRequest request)
    {
        var itemIds = (request.ItemIds ?? new List<string>())
            .Select(id => id.Trim())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (itemIds.Count < 2) throw ApiException.BadRequest("Select at least two items to combine.");

        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Investigator, "Only the investigator can combine inventory items.");

            var missingItems = itemIds.Where(id => !state.CollectedItemIds.Contains(id)).ToList();
            if (missingItems.Count > 0)
                throw DependencyUnavailable(gameCase,
                    "You can only combine items in your inventory.", new { missingItemIds = missingItems });

            var supplied = itemIds.ToHashSet();
            var interaction = gameCase.Interactions
                .Where(candidate => candidate.Type.Equals(CaseInteractionTypes.CombineItems, StringComparison.OrdinalIgnoreCase))
                .Where(candidate => candidate.RequiredItemIds.ToHashSet().SetEquals(supplied))
                .FirstOrDefault(candidate => candidate.RequiredClueIds.All(state.UnlockedClueIds.Contains));

            if (interaction is null)
                throw ApiException.BadRequest("Those items do not combine into anything useful.");

            if (interaction.SingleUse && state.UsedInteractionIds.Contains(interaction.InteractionId))
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    InteractionId = interaction.InteractionId,
                    Message = string.IsNullOrWhiteSpace(interaction.SuccessMessage)
                        ? "These items have already been combined."
                        : interaction.SuccessMessage
                };
            }

            var effects = ApplyMechanicEffects(
                state,
                interaction.UnlockClueIds,
                interaction.UnlockItemIds,
                interaction.UnlockSceneIds,
                interaction.ConsumeItemIds,
                user.Id,
                player.Role,
                ClueDiscoverySources.Interaction);
            if (!state.UsedInteractionIds.Contains(interaction.InteractionId))
                state.UsedInteractionIds.Add(interaction.InteractionId);

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "COMBINE_ITEMS",
                $"{user.FullName} combined inventory items.",
                new { interaction.InteractionId, itemIds });
            foreach (var clueId in effects.NewClueIds)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, interaction.InteractionId });
            }

            var scene = CurrentScene(gameCase, state, user.Id);
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, effects.NewClueIds, interaction.InteractionId);
            else
                foreach (var clueId in effects.NewClueIds) await _notifier.ClueUnlocked(roomId, clueId, interaction.InteractionId, user.Id, state.Version);

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                InteractionId = interaction.InteractionId,
                UnlockedClueIds = effects.NewClueIds,
                UnlockedItemIds = effects.NewItemIds,
                UnlockedSceneIds = effects.NewSceneIds,
                Message = string.IsNullOrWhiteSpace(interaction.SuccessMessage) ? "The items fit together." : interaction.SuccessMessage
            };
        }
    }

    public async Task<GameActionResponse> ActivateEnvironmentInteractionAsync(
        CurrentUser user,
        string roomId,
        string interactionId)
    {
        interactionId = interactionId.Trim();
        if (string.IsNullOrWhiteSpace(interactionId))
            throw ApiException.BadRequest("interactionId is required.");

        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Investigator, "Only the investigator can inspect the environment.");

            var interaction = gameCase.Interactions.FirstOrDefault(candidate =>
                    candidate.InteractionId == interactionId
                    && candidate.Type.Equals(CaseInteractionTypes.InspectEnvironment, StringComparison.OrdinalIgnoreCase))
                ?? throw ApiException.NotFound("This environment interaction does not exist in the case.");
            var scene = CurrentScene(gameCase, state, user.Id);
            if (!IsTargetAvailableInScene(scene, interaction.TargetId))
                throw ApiException.BadRequest("That environment target is not available in the current scene.");
            if (interaction.RequiredItemIds.Count > 0)
                throw ApiException.BadRequest("Environment inspection cannot require inventory items.");

            var missingClues = interaction.RequiredClueIds.Where(id => !state.UnlockedClueIds.Contains(id)).ToList();
            if (missingClues.Count > 0)
                throw ApiException.BadRequest("This detail cannot be interpreted yet.");

            if (state.UsedInteractionIds.Contains(interaction.InteractionId))
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    InteractionId = interaction.InteractionId,
                    Message = string.IsNullOrWhiteSpace(interaction.SuccessMessage)
                        ? "This part of the environment was already inspected."
                        : interaction.SuccessMessage
                };
            }

            var effects = ApplyMechanicEffects(
                state,
                interaction.UnlockClueIds,
                interaction.UnlockItemIds,
                interaction.UnlockSceneIds,
                Enumerable.Empty<string>(),
                user.Id,
                player.Role,
                ClueDiscoverySources.Interaction);
            if (!state.UsedInteractionIds.Contains(interaction.InteractionId))
                state.UsedInteractionIds.Add(interaction.InteractionId);

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "INSPECT_ENVIRONMENT",
                $"{user.FullName} inspected an environmental detail.",
                new { interaction.InteractionId, interaction.TargetId });
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(
                    roomId, gameCase, state, user, player, scene.SceneId, effects.NewClueIds, interaction.InteractionId);

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                InteractionId = interaction.InteractionId,
                UnlockedClueIds = effects.NewClueIds,
                UnlockedItemIds = effects.NewItemIds,
                UnlockedSceneIds = effects.NewSceneIds,
                Message = string.IsNullOrWhiteSpace(interaction.SuccessMessage)
                    ? "A useful environmental detail was uncovered."
                    : interaction.SuccessMessage
            };
        }
    }

    public async Task<GameActionResponse> SolvePuzzleAsync(CurrentUser user, string roomId, SolvePuzzleRequest request)
    {
        var puzzleId = request.PuzzleId.Trim();
        if (string.IsNullOrWhiteSpace(puzzleId)) throw ApiException.BadRequest("puzzleId is required.");

        for (var attempt = 0; ; attempt++)
        {
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireRole(player, PlayerRole.Investigator, "Only the investigator can operate scene puzzles.");

            var scene = CurrentScene(gameCase, state, user.Id);
            var puzzle = gameCase.Puzzles.FirstOrDefault(p => p.PuzzleId == puzzleId)
                ?? throw ApiException.NotFound("This puzzle does not exist in the case.");
            if (!IsTargetAvailableInScene(scene, puzzle.TargetId))
                throw ApiException.BadRequest("This puzzle target is not available in the current scene.");

            var missingItems = puzzle.RequiredItemIds.Where(id => !state.CollectedItemIds.Contains(id)).ToList();
            var missingClues = puzzle.RequiredClueIds.Where(id => !state.UnlockedClueIds.Contains(id)).ToList();
            if (missingItems.Count > 0 || missingClues.Count > 0)
                throw DependencyUnavailable(gameCase,
                    "This puzzle is not available yet.", new { missingItemIds = missingItems, missingClueIds = missingClues });

            if (state.SolvedPuzzleIds.Contains(puzzle.PuzzleId))
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    PuzzleId = puzzle.PuzzleId,
                    Message = string.IsNullOrWhiteSpace(puzzle.SuccessMessage)
                        ? "This puzzle has already been solved."
                        : puzzle.SuccessMessage,
                    Detail = puzzle.SuccessMessage
                };
            }

            if (!IsPuzzleAnswerCorrect(puzzle, request))
            {
                state.WrongPuzzleCount++;
                if (!await TrySaveStateAsync(room, gameCase))
                {
                    if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                    continue;
                }

                await LogAsync(gameCase, roomId, user.Id, "PUZZLE_FAILED",
                    $"{user.FullName} tried an incorrect puzzle answer.",
                    new { puzzle.PuzzleId, puzzle.TargetId });
                var failedState = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
                await _notifier.GameStateUpdated(roomId, failedState.Version);
                return new GameActionResponse
                {
                    State = failedState,
                    Changed = true,
                    PuzzleId = puzzle.PuzzleId,
                    Message = string.IsNullOrWhiteSpace(puzzle.FailureMessage) ? "That answer does not work." : puzzle.FailureMessage,
                    Detail = puzzle.FailureMessage
                };
            }

            state.SolvedPuzzleIds.Add(puzzle.PuzzleId);
            var effects = ApplyMechanicEffects(
                state,
                puzzle.UnlockClueIds,
                puzzle.UnlockItemIds,
                puzzle.UnlockSceneIds,
                Enumerable.Empty<string>(),
                user.Id,
                player.Role,
                ClueDiscoverySources.Puzzle);

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "PUZZLE_SOLVED",
                $"{user.FullName} solved a puzzle.",
                new { puzzle.PuzzleId, puzzle.TargetId });
            foreach (var clueId in effects.NewClueIds)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, puzzle.PuzzleId });
            }

            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, effects.NewClueIds, puzzle.PuzzleId);
            else
                foreach (var clueId in effects.NewClueIds) await _notifier.ClueUnlocked(roomId, clueId, puzzle.PuzzleId, user.Id, state.Version);

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            return new GameActionResponse
            {
                State = stateResponse,
                Changed = true,
                PuzzleId = puzzle.PuzzleId,
                UnlockedClueIds = effects.NewClueIds,
                UnlockedItemIds = effects.NewItemIds,
                UnlockedSceneIds = effects.NewSceneIds,
                Message = string.IsNullOrWhiteSpace(puzzle.SuccessMessage) ? "Puzzle solved." : puzzle.SuccessMessage,
                Detail = puzzle.SuccessMessage
            };
        }
    }

    public async Task<EvidencePhotoContent> GetEvidencePhotoAsync(string userId, string roomId, string clueId)
    {
        var (room, gameCase, _) = await LoadContextAsync(userId, roomId, requireInProgress: false);
        if (!V3KnowledgeProjector.CanViewEvidencePhoto(room, gameCase, userId, clueId))
        {
            throw ApiException.NotFound(
                "This evidence photo is not available.",
                "EVIDENCE_NOT_AVAILABLE",
                "game.confrontation.evidenceUnavailable");
        }

        var photo = await _evidencePhotos.GetAsync(roomId, clueId)
            ?? throw ApiException.NotFound(
                "This evidence photo is not available.",
                "EVIDENCE_NOT_AVAILABLE",
                "game.confrontation.evidenceUnavailable");
        return new EvidencePhotoContent(photo.ImageData, photo.ContentType);
    }

    // ----- Investigator: capture embedded clue with camera -----

    public async Task<GameActionResponse> CaptureClueAsync(CurrentUser user, string roomId, CaptureClueRequest request)
    {
        if (request.CaptureRect.Width <= 0 || request.CaptureRect.Height <= 0)
        {
            throw ApiException.BadRequest("Capture rectangle width and height must be positive.");
        }

        NormalizedEvidencePhoto? normalizedPhoto = null;
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
                if (!await TrySaveStateAsync(room, gameCase))
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
                if (!await TrySaveStateAsync(room, gameCase))
                {
                    if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                    continue;
                }

                var missMessage = "No important detail was detected.";
                if (state.CameraMissCount >= 3 && availableZones.Count > 0)
                {
                    var nudgeZone = availableZones
                        .OrderBy(z => CaptureDistance(request.CaptureRect, z.Bounds))
                        .First();
                    if (!string.IsNullOrWhiteSpace(nudgeZone.Label))
                    {
                        missMessage = $"No important detail was detected. Perhaps \"{nudgeZone.Label}\" deserves a closer look.";
                    }
                }

                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    CaptureResult = "MISS",
                    Message = missMessage
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
            normalizedPhoto ??= await _evidencePhotos.NormalizeAsync(request.Photo);
            var newClues = new List<string>();
            var committed = await EvidenceCapturePersistenceCoordinator.PersistAsync(
                () => _evidencePhotos.UpsertAsync(
                    roomId,
                    clue.ClueId,
                    scene.SceneId,
                    user.Id,
                    normalizedPhoto),
                async () =>
                {
                    state.CapturedClueIds.Add(clue.ClueId);
                    newClues = state.UnlockedClueIds.Contains(clue.ClueId)
                        ? new List<string>()
                        : new List<string> { clue.ClueId };
                    state.UnlockedClueIds.AddRange(newClues);
                    RecordClueDiscoveries(state, newClues, user.Id, player.Role, ClueDiscoverySources.Camera);
                    return await TrySaveStateAsync(room, gameCase);
                });

            if (!committed)
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "CAPTURE_CLUE", $"{user.FullName} photographed {clue.Title}.",
                new { clueId = clue.ClueId, sceneId = scene.SceneId, request.CaptureRect });
            foreach (var clueId in newClues)
            {
                await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, source = "camera" });
            }
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, "camera");
            else
                foreach (var clueId in newClues) await _notifier.ClueUnlocked(roomId, clueId, "camera", user.Id, state.Version);

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                var evidenceCount = newClues.Count(clueId =>
                    gameCase.Clues.Any(candidate => candidate.ClueId == clueId && candidate.IsEvidence));
                if (evidenceCount > 0)
                {
                    await _playtestEvents.RecordAsync(
                        roomId, user.Id, player.Role ?? string.Empty,
                        PlaytestEventType.PrivateDiscoveryCount, stateResponse.Version,
                        count: evidenceCount);
                }
            }

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
            if (gameCase.LogicContractVersion >= CaseLogicContractVersions.CausalFiveClaim
                && !dialogue.AvailableSceneIds.Contains(scene.SceneId))
                throw ApiException.BadRequest("This testimony is not available in the current scene.");

            var missingClues = dialogue.RequiredClueIds.Where(c => !state.UnlockedClueIds.Contains(c)).ToList();
            if (missingClues.Count > 0)
            {
                throw DependencyUnavailable(gameCase,
                    "You do not have enough information to ask this yet.",
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
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                RecordTestimonyDiscoveries(gameCase, state, dialogueId, user.Id, player.Role);
            }

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "ASK_DIALOGUE",
                $"{user.FullName} asked {character.Name}: \"{dialogue.Question}\"", new { dialogueId });
            foreach (var clueId in newClues)
            {
                var clue = gameCase.Clues.First(c => c.ClueId == clueId);
                await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.", new { clueId, dialogueId });
            }

            if (ShouldBroadcastDetailedEvents(gameCase))
                await _notifier.DialogueAnswered(roomId, dialogueId, user.Id, state.Version);
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
                await NotifyNewCluesAndDialoguesAsync(roomId, gameCase, state, user, player, scene.SceneId, newClues, dialogueId);
            else
                foreach (var clueId in newClues) await _notifier.ClueUnlocked(roomId, clueId, dialogueId, user.Id, state.Version);
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                var fragmentCount = gameCase.TestimonyFragments.Count(fragment => fragment.DialogueId == dialogueId);
                if (fragmentCount > 0)
                {
                    await _playtestEvents.RecordAsync(
                        roomId, user.Id, player.Role ?? string.Empty,
                        PlaytestEventType.PrivateDiscoveryCount, stateResponse.Version,
                        count: fragmentCount);
                }
            }

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
                if (!await TrySaveStateAsync(room, gameCase))
                {
                    if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                    continue;
                }
            }

            var character = gameCase.Characters.First(character => character.CharacterId == request.CharacterId);
            if (ruleResult.Changed || ruleResult.SelectedChoice is not null)
            {
                await LogAsync(gameCase, roomId, user.Id, "CONVERSE",
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
                    await LogAsync(gameCase, roomId, user.Id, "CLUE_UNLOCKED", $"New clue: {clue.Title}.",
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
                await _notifier.GameStateUpdated(roomId, stateResponse.Version);

            var unlocked = state.UnlockedClueIds.ToHashSet();
            var nodeDto = ConversationNodeDto.From(ruleResult.Node);
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation)
                nodeDto.ChallengeId = null;
            return new ConverseResponse
            {
                Node = nodeDto,
                Choices = GameplayConversationRules.VisibleChoices(ruleResult.Node, state)
                    .Select(choice => ConversationChoiceDto.From(choice, unlocked))
                    .ToList(),
                Challenge = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
                    ? null
                    : GameplayConversationRules.BuildChallengeDto(gameCase, state, ruleResult.Node.ChallengeId),
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
            if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                throw ApiException.Conflict(
                    "Use the paired confrontation flow for this case.",
                    "CONFRONTATION_NOT_AVAILABLE",
                    "game.confrontation.notAvailable");
            }
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
                await LogAsync(gameCase, roomId, user.Id, "PRESENT_EVIDENCE",
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

            if (ruleResult.Outcome == ConfrontationOutcome.NotYetPossible)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = "Nothing in your evidence folder fits this confrontation yet. Keep investigating and come back.",
                    Detail = challenge.FailureResponse
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

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            var character = gameCase.Characters.First(c => c.CharacterId == dialogue.CharacterId);
            await LogAsync(gameCase, roomId, user.Id, correct ? "CONTRADICTION_RESOLVED" : "PRESENT_EVIDENCE_FAILED",
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
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
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
            // Tier is the 1-based escalation step within the ordered hint chain, never a hint id.
            var hintTier = hints.IndexOf(selected) + 1;
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
            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "HINT_USED", $"{user.FullName} requested an investigation hint.",
                new { selected.HintId, context, request.TargetId });
            if (ShouldBroadcastDetailedEvents(gameCase))
            {
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
            }
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                await _playtestEvents.RecordAsync(
                    roomId, user.Id, player.Role ?? string.Empty,
                    PlaytestEventType.HintUsed, stateResponse.Version,
                    count: hintTier);
            }
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
                throw DependencyUnavailable(gameCase,
                    "This deduction is not available yet.", new { missingClues, missingChallenges });

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
            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, solved ? "DEDUCTION_SOLVED" : "DEDUCTION_FAILED",
                solved ? $"{user.FullName} resolved a deduction." : $"{user.FullName} tested an incorrect deduction.",
                new { request.DeductionId, request.OptionId });
            if (solved && ShouldBroadcastDetailedEvents(gameCase))
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
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
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
            var (room, gameCase, player) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
            var state = room.GameplayState!;
            RequireNoActiveConfrontation(state);
            var scene = CurrentScene(gameCase, state, user.Id);
            var wasCompleted = GameRules.IsSceneAlreadyCompleted(state, scene.SceneId);

            if (!wasCompleted)
            {
                var inspected = state.InspectedItemIds.ToHashSet();
                var unlocked = state.UnlockedClueIds.ToHashSet();
                var asked = state.AskedDialogueIds.ToHashSet();

                if (!CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspected, unlocked, asked))
                {
                    throw DependencyUnavailable(gameCase, "Scene requirements are not complete.", new
                    {
                        missing = new MissingRequirementsDto
                        {
                            RequiredItemIds = scene.CompleteCondition.RequiredItemIds.Where(i => !inspected.Contains(i)).ToList(),
                            RequiredClueIds = scene.CompleteCondition.RequiredClueIds.Where(c => !unlocked.Contains(c)).ToList(),
                            RequiredDialogueIds = scene.CompleteCondition.RequiredDialogueIds.Where(d => !asked.Contains(d)).ToList()
                        }
                    });
                }
            }

            var transition = GameRules.ApplySceneContinuation(gameCase, state, user.Id, scene.SceneId);
            var nextScene = GameRules.GetNextAuthoredScene(gameCase, scene.SceneId);
            if (!transition.HasChanges)
            {
                return new GameActionResponse
                {
                    State = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id),
                    Changed = false,
                    Message = nextScene is null
                        ? $"{scene.Title} is the final location. The final confrontation is ready when every requirement is complete."
                        : $"You already continued from {scene.Title}."
                };
            }

            // The completion, successor unlock, visit, and caller-only movement are persisted in
            // one optimistic update. TrySave also repairs derived completion for older rooms.
            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            if (transition.CompletedNow)
            {
                await LogAsync(gameCase, roomId, user.Id, "COMPLETE_SCENE", $"{scene.Title} is fully investigated.", new { sceneId = scene.SceneId });
            }
            else if (transition.IsContinuation && nextScene is not null)
            {
                await LogAsync(gameCase, roomId, user.Id, "CONTINUE_SCENE", $"{user.FullName} continued to {nextScene.Title}.", new
                {
                    previousSceneId = scene.SceneId,
                    currentSceneId = nextScene.SceneId
                });
            }

            if (transition.CallerMoved && nextScene is not null && ShouldBroadcastDetailedEvents(gameCase))
            {
                await _notifier.SceneChanged(roomId, scene.SceneId, nextScene.SceneId, user.Id, state.Version);
                if (transition.CrossesStage)
                {
                    await _notifier.StageChanged(
                        roomId,
                        transition.CurrentStageId,
                        transition.SuccessorStageId!,
                        scene.SceneId,
                        nextScene.SceneId,
                        GameRules.AllScenesCompleted(gameCase, state),
                        user.Id,
                        state.Version);
                }
            }

            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);
            if (transition.CompletedNow
                && gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation)
            {
                await _playtestEvents.RecordAsync(
                    roomId, user.Id, player.Role ?? string.Empty,
                    PlaytestEventType.SceneCompleted, stateResponse.Version,
                    count: state.CompletedSceneIds.Count);
                // A stage ends exactly once per room: on the first completion of its last scene.
                // Gating on CompletedNow keeps the partner's own crossing from doubling the event and
                // collapsing the median gap between stages to zero.
                if (transition.CrossesStage)
                {
                    await _playtestEvents.RecordAsync(
                        roomId, user.Id, player.Role ?? string.Empty,
                        PlaytestEventType.StageCompleted, stateResponse.Version,
                        count: StageIndex(gameCase, transition.CurrentStageId));
                }
            }
            var message = nextScene is null
                ? $"{scene.Title} is the final location. The final confrontation is ready when every requirement is complete."
                : $"Continued to {nextScene.Title}.";
            return new GameActionResponse { State = stateResponse, Changed = true, Message = message };
        }
    }

    private static int StageIndex(GameCase gameCase, string stageId) =>
        gameCase.Stages.OrderBy(stage => stage.Order).ToList().FindIndex(stage => stage.StageId == stageId);

    public async Task<GameActionResponse> CompleteStageAsync(CurrentUser user, string roomId)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;
        RequireNoActiveConfrontation(state);
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

        // This endpoint only confirms; it mutates nothing and either player may call it any number of
        // times. StageCompleted is emitted from the scene transition that actually closes the stage.
        var completedState = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
        return new GameActionResponse
        {
            State = completedState,
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
            RequireNoActiveConfrontation(state);

            var target = gameCase.Stages.SelectMany(st => st.Scenes.Select(sc => (Stage: st, Scene: sc)))
                .FirstOrDefault(x => x.Scene.SceneId == sceneId);
            if (target.Scene is null)
            {
                throw ApiException.NotFound("This scene does not exist in the case.");
            }

            if (!GameRules.CanEnterScene(gameCase, state, sceneId))
            {
                throw ApiException.BadRequest("This place is still sealed. Something in the investigation must open it first.");
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
            if (!state.VisitedSceneIds.Contains(sceneId)) state.VisitedSceneIds.Add(sceneId);

            if (!await TrySaveStateAsync(room, gameCase))
            {
                if (attempt >= 1) throw ApiException.Conflict("The game state changed; please retry.");
                continue;
            }

            await LogAsync(gameCase, roomId, user.Id, "GO_TO_SCENE", $"{user.FullName} moved to {target.Scene.Title}.", new { sceneId });
            if (ShouldBroadcastDetailedEvents(gameCase))
                await _notifier.SceneChanged(roomId, previousSceneId, sceneId, user.Id, state.Version);
            var stateResponse = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
            await _notifier.GameStateUpdated(roomId, stateResponse.Version);

            return new GameActionResponse { State = stateResponse, Changed = true, Message = $"Moved to {target.Scene.Title}." };
        }
    }

    // ----- Final accusation -----

    public async Task<GameResultResponse> AccuseAsync(CurrentUser user, string roomId, AccuseRequest request)
    {
        var (room, gameCase, _) = await LoadContextAsync(user.Id, roomId, requireInProgress: true);
        var state = room.GameplayState!;
        RequireNoActiveConfrontation(state);

        // Where the team decides together, one detective may not end the case for both.
        if (AccusationConsensusRules.RequiresConsensus(gameCase, _accusationSettings.RequireConsensus))
        {
            throw ApiException.Conflict(
                "This case needs both detectives to agree. Propose the accusation at /accusation and let your partner confirm it.",
                AccusationConsensusRules.ConsensusRequiredCode,
                "game.accusation.consensusRequired");
        }

        var playerSceneId = state.PlayerSceneIds.GetValueOrDefault(user.Id, state.CurrentSceneId);
        if (!GameRules.IsAccusationAvailable(gameCase, state, playerSceneId))
        {
            throw ApiException.BadRequest("The final accusation is not available yet. Reach the final scene and gather all required evidence first.");
        }

        return await ResolveAccusationCoreAsync(room, gameCase, user, request);
    }

    /// <summary>
    /// Closes the case for an accusation whose right to be made has already been established, and is
    /// the only place that does so: the unilateral route and the two-player consensus route share it
    /// verbatim, so both produce byte-identical results and exactly one persisted <see cref="GameResult"/>.
    /// </summary>
    public Task<GameResultResponse> ResolveAccusationAsync(
        GameRoom room,
        GameCase gameCase,
        CurrentUser actor,
        AccuseRequest request) =>
        ResolveAccusationCoreAsync(room, gameCase, actor, request);

    private async Task<GameResultResponse> ResolveAccusationCoreAsync(
        GameRoom room,
        GameCase gameCase,
        CurrentUser user,
        AccuseRequest request)
    {
        var state = room.GameplayState!;
        var roomId = room.Id;

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

        var completedAt = DateTime.UtcNow;
        var snapshot = GameResultFactory.CreateSnapshot(
            room,
            gameCase,
            request,
            submittedEvidenceIds,
            success,
            completedAt);
        state.SelectedEvidenceIds = snapshot.SelectedEvidenceIds.ToList();
        state.GameStatus = success ? GameStatus.Won : GameStatus.Failed;
        state.CompletedAt = completedAt;
        state.FinalAccusationSnapshot = snapshot;
        room.Status = RoomStatus.Completed;

        if (!await TrySaveStateAsync(room, gameCase))
        {
            throw ApiException.Conflict("The game state changed; please retry.");
        }

        var result = await GameResultPersistenceCoordinator.MaterializeAsync(roomId, snapshot, _gameResults);

        var accusedName = gameCase.Characters.First(c => c.CharacterId == request.CulpritId).Name;
        await LogAsync(gameCase, roomId, user.Id, "ACCUSE",
            success ? $"{user.FullName} accused {accusedName} — the case is solved!" : $"{user.FullName} accused {accusedName} — the accusation failed.",
            new { request.CulpritId, request.MotiveId, request.MethodId, EvidenceIds = submittedEvidenceIds });

        var resultResponse = ToResultResponse(result, gameCase);
        if (ShouldBroadcastDetailedEvents(gameCase))
            await _notifier.GameCompleted(roomId, resultResponse);
        var completedState = await _stateBuilder.BuildStateAsync(room, gameCase, user.Id);
        await _notifier.GameStateUpdated(roomId, completedState.Version);
        return resultResponse;
    }

    // ----- Helpers -----

    private async Task<(GameRoom Room, GameCase Case, RoomPlayer Player)> LoadContextAsync(string userId, string roomId, bool requireInProgress)
    {
        var context = await _contextLoader.LoadAsync(userId, roomId, requireInProgress);
        return (context.Room, context.Case, context.Player);
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

    private static bool IsTargetAvailableInScene(CaseScene scene, string targetId) =>
        scene.ItemIds.Contains(targetId)
        || scene.CharacterIds.Contains(targetId)
        || scene.Hotspots.Any(h => h.TargetId == targetId)
        || (scene.Runtime?.Transitions.Any(t => t.TransitionId == targetId || t.TargetSceneId == targetId) == true);

    private static void SetPlayerScene(GameplayState state, string userId, string stageId, string sceneId)
    {
        state.PlayerSceneIds[userId] = sceneId;
        state.CurrentStageId = stageId;
        state.CurrentSceneId = sceneId;
    }

    /// <summary>
    /// Optimistic concurrency: persists the room only if the stored version still matches.
    /// When the case is supplied, derives scene/stage completion from the evidence state first,
    /// so progression never depends on a manual "complete scene" confirmation.
    /// </summary>
    private async Task<bool> TrySaveStateAsync(GameRoom room, GameCase? gameCase = null)
        => await _statePersistence.TrySaveAsync(room, gameCase);

    private async Task LogAsync(GameCase gameCase, string roomId, string userId, string actionType, string message, object payload)
    {
        // Gate 1 deliberately disables the shared legacy action-log channel for V3.
        // Private semantic IDs/content must never be persisted there without an audience model.
        if (!ShouldPersistActionLog(gameCase)) return;

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
        if (!ShouldBroadcastDetailedEvents(gameCase)) return;

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
            .Where(dialogue => gameCase.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim
                || dialogue.AvailableSceneIds.Contains(sceneId))
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
            .Where(node => gameCase.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim
                || node.AvailableSceneIds.Contains(sceneId))
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

    private static double CaptureDistance(CaptureRectDto capture, RuntimeBox clue)
    {
        var dx = (capture.X + capture.Width / 2.0) - (clue.X + clue.Width / 2.0);
        var dy = (capture.Y + capture.Height / 2.0) - (clue.Y + clue.Height / 2.0);
        return Math.Sqrt(dx * dx + dy * dy);
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

    internal static bool ShouldBroadcastDetailedEvents(GameCase gameCase) =>
        gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation;

    internal static bool ShouldPersistActionLog(GameCase gameCase) =>
        gameCase.MechanicsVersion < CaseMechanicsVersions.InvestigationV3PairedConfrontation;

    private static void RecordTestimonyDiscoveries(
        GameCase gameCase,
        GameplayState state,
        string dialogueId,
        string userId,
        string? role)
    {
        foreach (var fragment in gameCase.TestimonyFragments.Where(candidate => candidate.DialogueId == dialogueId))
        {
            if (state.TestimonyDiscoveries.Any(record => record.TestimonyFragmentId == fragment.Id)) continue;
            state.TestimonyDiscoveries.Add(new TestimonyDiscoveryRecord
            {
                TestimonyFragmentId = fragment.Id,
                DialogueId = dialogueId,
                DiscoveredByUserId = userId,
                DiscoveredByRole = role ?? string.Empty,
                DiscoveredAt = DateTime.UtcNow
            });
        }
    }

    private static void RequireNoActiveConfrontation(GameplayState state)
    {
        if (!PairedConfrontationRules.BlocksProgression(state)) return;
        throw ApiException.Conflict(
            "Finish or cancel the active confrontation before continuing.",
            "ACTION_BLOCKED_BY_CONFRONTATION",
            "game.confrontation.actionBlocked");
    }

    private static ApiException DependencyUnavailable(GameCase gameCase, string message, object details) =>
        gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
            ? ApiException.BadRequest(message)
            : ApiException.BadRequest(message, details);

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
