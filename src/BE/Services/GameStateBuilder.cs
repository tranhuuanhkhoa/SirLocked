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

public class GameStateBuilder : IGameStateBuilder
{
    private const int ActionLogLimit = 40;

    private readonly MongoDbContext _db;

    public GameStateBuilder(MongoDbContext db) => _db = db;

    internal static GameStateResponse? BuildCompletedReadState(GameRoom room, string userId)
    {
        if (room.Status != RoomStatus.Completed || room.GameplayState is not { } state
            || state.FinalAccusationSnapshot?.CaseDefinitionSnapshot is not { } definition)
            return null;

        // Completed gameplay reads only need to redirect to the result. They must
        // not resolve a saved scene against a definition that may have been replaced.
        var sceneId = state.PlayerSceneIds.GetValueOrDefault(userId, state.CurrentSceneId);
        return new GameStateResponse
        {
            RoomId = room.Id,
            RoomCode = room.RoomCode,
            HostUserId = room.HostUserId,
            CaseId = room.CaseId,
            CaseTitle = definition.Title,
            Language = definition.Language,
            MechanicsVersion = definition.MechanicsVersion,
            RoomStatus = room.Status,
            CurrentStageId = state.CurrentStageId,
            CurrentSceneId = sceneId,
            Version = state.Version,
            Players = room.Players.Select(RoomPlayerDto.From).ToList(),
            GameStatus = state.GameStatus,
            IsCaseComplete = true,
            VisibleScene = new VisibleSceneDto { SceneId = sceneId }
        };
    }

    internal static List<SceneDialogueDto> BuildSceneDialogues(GameCase gameCase, GameplayState state, CaseScene scene)
    {
        var unlocked = state.UnlockedClueIds.ToHashSet();
        return gameCase.Dialogues
            .Where(dialogue => scene.CharacterIds.Contains(dialogue.CharacterId))
            .Where(dialogue => gameCase.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim
                || dialogue.AvailableSceneIds.Contains(scene.SceneId))
            .Where(dialogue => GameplayConversationRules.IsSourceDialogueAvailable(
                gameCase, state.VisitedConversationNodeIds, dialogue.DialogueId))
            .Select(dialogue => SceneDialogueDto.From(dialogue, unlocked, state.AskedDialogueIds.Contains(dialogue.DialogueId)))
            .ToList();
    }

    public async Task<GameStateResponse> BuildStateAsync(GameRoom room, GameCase gameCase, string userId)
    {
        var state = room.GameplayState!;
        var unlocked = state.UnlockedClueIds.ToHashSet();
        var scene = CurrentScene(gameCase, state, userId);
        var stage = StageForScene(gameCase, scene.SceneId);
        var inspected = state.InspectedItemIds.ToHashSet();
        var collected = state.CollectedItemIds.ToHashSet();
        var solvedPuzzles = state.SolvedPuzzleIds.ToHashSet();
        var asked = state.AskedDialogueIds.ToHashSet();
        var currentSceneProgress = CompleteConditionProgress.Evaluate(
            scene.CompleteCondition,
            inspected,
            unlocked,
            asked);
        var canCompleteScene = CanCompleteScene(state, scene.SceneId, currentSceneProgress);
        var missingRequirements = BuildMissingRequirements(currentSceneProgress);

        var sceneDialogues = BuildSceneDialogues(gameCase, state, scene);
        var conversationTreeCharacterIds = gameCase.ConversationNodes
            .Where(node => scene.CharacterIds.Contains(node.CharacterId))
            .Where(node => gameCase.LogicContractVersion < CaseLogicContractVersions.CausalFiveClaim
                || node.AvailableSceneIds.Contains(scene.SceneId))
            .Select(node => node.CharacterId)
            .Distinct()
            .ToList();

        if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
        {
            foreach (var dialogueDto in sceneDialogues.Where(d => d.IsAsked))
            {
                dialogueDto.EvidenceChallenges = gameCase.EvidenceChallenges
                    .Where(c => c.DialogueId == dialogueDto.DialogueId)
                    .Select(challenge => GameplayConversationRules.BuildChallengeDto(gameCase, state, challenge.ChallengeId)!)
                    .ToList();
            }
        }

        // Authoritative transcript of visited conversation nodes for tree NPCs in this scene.
        var conversationTranscript = GameplayConversationRules.BuildTranscript(gameCase, state, scene.CharacterIds);

        var visibleScene = new VisibleSceneDto
        {
            SceneId = scene.SceneId,
            Title = scene.Title,
            Description = scene.Description,
            BackgroundUrl = scene.BackgroundUrl,
            Runtime = scene.Runtime,
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
            AvailableDialogues = sceneDialogues,
            ConversationTreeCharacterIds = conversationTreeCharacterIds,
            ConversationTranscript = conversationTranscript,
            Puzzles = gameCase.Puzzles
                .Where(puzzle => IsTargetAvailableInScene(scene, puzzle.TargetId))
                .Select(puzzle => ScenePuzzleDto.From(puzzle, collected, unlocked, solvedPuzzles))
                .ToList()
        };

        var sceneMap = BuildSceneMap(gameCase, state, scene.SceneId, inspected, unlocked, asked);

        var unlockedClues = gameCase.Clues
            .Where(c => unlocked.Contains(c.ClueId))
            .Select(ClueDto.From)
            .ToList();
        var resolvedChallengeIds = state.ResolvedConfrontationRecords.Select(record => record.ChallengeId).ToHashSet();

        var visiblePhotoClueIds = EvidenceCapturePersistenceCoordinator.VisiblePhotoClueIds(state);
        var photographedClueIds = await _db.EvidencePhotos
            .Find(photo => photo.RoomId == room.Id && visiblePhotoClueIds.Contains(photo.ClueId))
            .Project(photo => photo.ClueId)
            .ToListAsync();
        foreach (var clue in unlockedClues.Where(clue => photographedClueIds.Contains(clue.ClueId)))
        {
            clue.PhotoUrl = $"/api/game/rooms/{Uri.EscapeDataString(room.Id)}/clues/{Uri.EscapeDataString(clue.ClueId)}/photo";
        }

        var logs = await _db.ActionLogs.Find(l => l.RoomId == room.Id)
            .SortByDescending(l => l.CreatedAt).Limit(ActionLogLimit).ToListAsync();
        logs.Reverse();

        var response = new GameStateResponse
        {
            RoomId = room.Id,
            RoomCode = room.RoomCode,
            HostUserId = room.HostUserId,
            CaseId = gameCase.CaseId,
            CaseTitle = gameCase.Title,
            CaseSummary = gameCase.Summary,
            Language = gameCase.Language,
            MechanicsVersion = gameCase.MechanicsVersion,
            RoomStatus = room.Status,
            CurrentStageId = stage.StageId,
            CurrentSceneId = scene.SceneId,
            Version = state.Version,
            Players = room.Players.Select(player => RoomPlayerDto.From(player,
                room.Status == RoomStatus.InProgress ? room.GameplayState?.StartedAt : null)).ToList(),
            VisitedSceneIds = state.VisitedSceneIds,
            UnlockedSceneIds = state.UnlockedSceneIds,
            InspectedItemIds = state.InspectedItemIds,
            CollectedItemIds = state.CollectedItemIds,
            CapturedClueIds = state.CapturedClueIds,
            CollectedItems = state.CollectedItemIds
                .Select(id => gameCase.Items.FirstOrDefault(i => i.ItemId == id))
                .Where(i => i is not null)
                .Select(i => SceneItemDto.From(i!, state.InspectedItemIds.Contains(i!.ItemId)))
                .ToList(),
            UnlockedClueIds = state.UnlockedClueIds,
            UsedInteractionIds = state.UsedInteractionIds,
            SolvedPuzzleIds = state.SolvedPuzzleIds,
            AskedDialogueIds = state.AskedDialogueIds,
            VisitedConversationNodeIds = state.VisitedConversationNodeIds,
            CompletedSceneIds = state.CompletedSceneIds,
            CompletedStageIds = state.CompletedStageIds,
            SelectedEvidenceIds = state.SelectedEvidenceIds,
            WrongPuzzleCount = state.WrongPuzzleCount,
            GameStatus = state.GameStatus,
            AvailableForAccusation = GameRules.IsAccusationAvailable(gameCase, state, scene.SceneId),
            ActiveAccusation = AccusationProposalDto.From(state.ActiveAccusation),
            CurrentSceneCanComplete = canCompleteScene,
            CurrentSceneMissingRequirements = missingRequirements,
            CurrentObjective = BuildObjective(gameCase, state, scene, currentSceneProgress, unlocked),
            VisibleScene = visibleScene,
            SceneMap = sceneMap,
            UnlockedClues = unlockedClues,
            EvidenceClues = unlockedClues.Where(c => c.IsEvidence).ToList(),
            ResolvedConfrontations = state.ResolvedConfrontationRecords.Select(record =>
            {
                var challenge = gameCase.EvidenceChallenges.First(c => c.ChallengeId == record.ChallengeId);
                var evidence = gameCase.Clues.First(c => c.ClueId == record.EvidenceId);
                return new ResolvedConfrontationDto
                {
                    ChallengeId = record.ChallengeId,
                    EvidenceId = record.EvidenceId,
                    EvidenceTitle = evidence.Title,
                    Prompt = challenge.Prompt,
                    Resolution = challenge.SuccessResponse,
                    ResolvedByUserId = record.ResolvedByUserId,
                    ResolvedAt = record.ResolvedAt
                };
            }).ToList(),
            Deductions = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2
                ? gameCase.Deductions.Select(deduction =>
                {
                    var missingClues = deduction.RequiredClueIds.Where(id => !unlocked.Contains(id)).ToList();
                    var missingChallenges = deduction.RequiredChallengeIds.Where(id => !resolvedChallengeIds.Contains(id)).ToList();
                    var solved = state.SolvedDeductionRecords.FirstOrDefault(record => record.DeductionId == deduction.DeductionId);
                    return new DeductionDto
                    {
                        DeductionId = deduction.DeductionId,
                        Prompt = deduction.Prompt,
                        RequiredClueIds = deduction.RequiredClueIds,
                        RequiredChallengeIds = deduction.RequiredChallengeIds,
                        MissingClueIds = missingClues,
                        MissingChallengeIds = missingChallenges,
                        Options = deduction.Options.Select(option => new DeductionOptionDto { Id = option.Id, Label = option.Label }).ToList(),
                        IsAvailable = missingClues.Count == 0 && missingChallenges.Count == 0,
                        IsSolved = solved is not null,
                        Resolution = solved is null ? null : deduction.SuccessResponse
                    };
                }).ToList()
                : new List<DeductionDto>(),
            SolvedDeductions = state.SolvedDeductionRecords.Select(record => new SolvedDeductionDto
            {
                DeductionId = record.DeductionId,
                SelectedOptionId = record.SelectedOptionId,
                SolvedByUserId = record.SolvedByUserId,
                SolvedAt = record.SolvedAt
            }).ToList(),
            Testimonies = gameCase.Dialogues.Where(dialogue => state.AskedDialogueIds.Contains(dialogue.DialogueId))
                .Select(dialogue => new TestimonyDto
                {
                    DialogueId = dialogue.DialogueId,
                    CharacterName = gameCase.Characters.First(character => character.CharacterId == dialogue.CharacterId).Name,
                    Question = dialogue.Question,
                    Answer = dialogue.Answer
                }).ToList(),
            AccusationConfig = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2
                ? new AccusationConfigDto
                {
                    MotiveOptions = gameCase.FinalLogic.MotiveOptions
                        .Select(option => new AccusationOptionDto { Id = option.Id, Label = option.Label }).ToList(),
                    MethodOptions = gameCase.FinalLogic.MethodOptions
                        .Select(option => new AccusationOptionDto { Id = option.Id, Label = option.Label }).ToList(),
                    ClaimTypes = EvidenceClaimTypes.OrderedForContract(gameCase.LogicContractVersion).ToList()
                }
                : null,
            Suspects = gameCase.Characters.Select(CaseCharacterDto.From).ToList(),
            ActionLog = logs.Select(l => new ActionLogEntryDto
            {
                ActionType = l.ActionType,
                Message = l.Message,
                UserId = l.UserId,
                CreatedAt = l.CreatedAt
            }).ToList()
        };
        V3KnowledgeProjector.Apply(response, room, gameCase, userId);
        PresentationPolicy.Apply(response, room, gameCase, userId);
        return response;
    }

    private static CaseScene CurrentScene(GameCase gameCase, GameplayState state, string userId)
    {
        var sceneId = state.PlayerSceneIds.TryGetValue(userId, out var playerSceneId)
            ? playerSceneId
            : state.CurrentSceneId;

        return gameCase.Stages.SelectMany(s => s.Scenes).FirstOrDefault(s => s.SceneId == sceneId)
            ?? throw ApiException.BadRequest("The current scene no longer exists in the case definition.");
    }

    private static CaseStage StageForScene(GameCase gameCase, string sceneId) =>
        gameCase.Stages.FirstOrDefault(s => s.Scenes.Any(scene => scene.SceneId == sceneId))
            ?? throw ApiException.BadRequest("The current stage no longer exists in the case definition.");

    private static bool IsTargetAvailableInScene(CaseScene scene, string targetId) =>
        scene.ItemIds.Contains(targetId)
        || scene.CharacterIds.Contains(targetId)
        || scene.Hotspots.Any(h => h.TargetId == targetId);

    internal static MissingRequirementsDto BuildMissingRequirements(CompleteConditionProgressResult progress) => new()
    {
        RequiredItemIds = progress.MissingItemIds.ToList(),
        RequiredClueIds = progress.MissingClueIds.ToList(),
        RequiredDialogueIds = progress.MissingDialogueIds.ToList()
    };

    internal static bool CanCompleteScene(
        GameplayState state,
        string sceneId,
        CompleteConditionProgressResult progress) =>
        GameRules.IsSceneAlreadyCompleted(state, sceneId) || progress.IsSatisfied;

    internal static List<SceneMapEntryDto> BuildSceneMap(
        GameCase gameCase,
        GameplayState state,
        string currentSceneId,
        IReadOnlySet<string> inspected,
        IReadOnlySet<string> unlocked,
        IReadOnlySet<string> asked) =>
        gameCase.Stages.OrderBy(stage => stage.Order)
            .SelectMany(stage => stage.Scenes)
            .Select(scene =>
            {
                var canEnter = GameRules.CanEnterScene(gameCase, state, scene.SceneId);
                var isCompleted = state.CompletedSceneIds.Contains(scene.SceneId);
                var progress = CompleteConditionProgress.Evaluate(
                    scene.CompleteCondition,
                    inspected,
                    unlocked,
                    asked);
                return new SceneMapEntryDto
                {
                    SceneId = scene.SceneId,
                    Title = canEnter ? scene.Title : "Unknown location",
                    IsCurrent = scene.SceneId == currentSceneId,
                    IsVisited = state.VisitedSceneIds.Contains(scene.SceneId),
                    IsUnlocked = canEnter,
                    IsCompleted = isCompleted,
                    PendingRequirementCount = isCompleted ? 0 : progress.PendingCount
                };
            })
            .ToList();

    internal static string BuildObjective(
        GameCase gameCase,
        GameplayState state,
        CaseScene scene,
        CompleteConditionProgressResult progress,
        IReadOnlySet<string> unlocked)
    {
        string T(string english, string vietnamese) => gameCase.Language == CaseLanguages.Vietnamese ? vietnamese : english;
        if (state.GameStatus != GameStatus.InProgress)
        {
            return state.GameStatus == GameStatus.Won
                ? T("Case closed - the culprit was exposed.", "Vụ án đã khép lại — thủ phạm đã bị vạch trần.")
                : T("Case closed - the culprit escaped.", "Vụ án đã khép lại — thủ phạm đã thoát tội.");
        }

        if (GameRules.IsAccusationAvailable(gameCase, state, scene.SceneId))
        {
            return T("All the evidence is on the table. Confront the suspects and make the final accusation.",
                "Đã có đủ chứng cứ. Hãy cùng đồng đội thống nhất lời buộc tội cuối cùng.");
        }

        if (GameRules.AllScenesCompleted(gameCase, state))
        {
            var requiredEvidenceIds = (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2
                    ? gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId)
                    : gameCase.FinalLogic.RequiredEvidenceIds)
                .Distinct().ToList();
            var missingEvidence = requiredEvidenceIds.Count(id => !unlocked.Contains(id));
            var missingDeductions = gameCase.FinalLogic.RequiredDeductionIds
                .Count(id => state.SolvedDeductionRecords.All(record => record.DeductionId != id));
            var missingChains = gameCase.FinalLogic.RequiredTeamworkChainIds
                .Count(id => !GameRules.IsTeamworkChainComplete(gameCase, state, id));
            var missingCracks = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation
                ? gameCase.EvidenceChallenges.Count(challenge => state.ResolvedConfrontationRecords.All(record =>
                    record.ChallengeId != challenge.ChallengeId))
                : 0;

            var finalParts = new List<string>();
            if (missingEvidence > 0) finalParts.Add(T($"secure {missingEvidence} more piece(s) of key evidence", $"thu thập thêm {missingEvidence} chứng cứ then chốt"));
            if (missingCracks > 0) finalParts.Add(T($"crack {missingCracks} more contradiction(s) with your partner", $"cùng đồng đội vạch trần thêm {missingCracks} mâu thuẫn"));
            if (missingChains > 0) finalParts.Add(T($"resolve {missingChains} more confrontation chain(s) with your partner", $"hoàn thành thêm {missingChains} chuỗi phối hợp"));
            if (missingDeductions > 0) finalParts.Add(T($"solve {missingDeductions} more deduction(s)", $"giải thêm {missingDeductions} suy luận"));

            var lastScene = gameCase.Stages.OrderBy(s => s.Order).Last().Scenes.Last();
            return finalParts.Count == 0
                ? T($"Head to {lastScene.Title} to make the final accusation.", $"Đến {lastScene.Title} để đưa ra lời buộc tội cuối cùng.")
                : T($"Every location is fully investigated. Before accusing: {string.Join(", ", finalParts)}.",
                    $"Đã điều tra xong mọi địa điểm. Trước khi buộc tội: {string.Join(", ", finalParts)}.");
        }

        if (progress.IsSatisfied)
        {
            return T($"You have found everything that matters in {scene.Title}. Continue the investigation when both of you are ready.",
                $"Đã tìm đủ thông tin quan trọng tại {scene.Title}. Tiếp tục điều tra khi cả hai đã sẵn sàng.");
        }

        if (string.Equals(scene.CompleteCondition.Logic, "OR", StringComparison.OrdinalIgnoreCase))
        {
            var alternatives = progress.Alternatives.Select(alternative => alternative.Type switch
            {
                CompleteConditionAlternativeType.Items =>
                    T($"examine {alternative.MissingIds.Count} physical evidence item(s)", $"khám xét {alternative.MissingIds.Count} vật chứng"),
                CompleteConditionAlternativeType.Dialogues =>
                    T($"ask {alternative.MissingIds.Count} question(s)", $"hỏi {alternative.MissingIds.Count} câu"),
                CompleteConditionAlternativeType.Clues =>
                    T($"uncover {alternative.MissingIds.Count} clue(s)", $"tìm {alternative.MissingIds.Count} manh mối"),
                _ => throw new ArgumentOutOfRangeException()
            }).ToList();

            return alternatives.Count == 0
                ? T($"Investigate {scene.Title}.", $"Điều tra {scene.Title}.")
                : T($"Investigate {scene.Title}: choose one \u2014 {string.Join("; or ", alternatives)}.",
                    $"Điều tra {scene.Title}: chọn một hướng — {string.Join("; hoặc ", alternatives)}.");
        }

        var parts = new List<string>();
        var missingItems = progress.MissingItemIds.Count;
        var missingClues = progress.MissingClueIds.Count;
        var missingDialogues = progress.MissingDialogueIds.Count;
        if (missingItems > 0) parts.Add(T($"examine {missingItems} more piece(s) of physical evidence", $"khám xét thêm {missingItems} vật chứng"));
        if (missingDialogues > 0) parts.Add(T($"ask {missingDialogues} more question(s)", $"hỏi thêm {missingDialogues} câu"));
        if (missingClues > 0) parts.Add(T($"uncover {missingClues} more clue(s)", $"tìm thêm {missingClues} manh mối"));

        return parts.Count == 0
            ? T($"Investigate {scene.Title}.", $"Điều tra {scene.Title}.")
            : T($"Investigate {scene.Title}: {string.Join(", ", parts)}.", $"Điều tra {scene.Title}: {string.Join(", ", parts)}.");
    }
}
