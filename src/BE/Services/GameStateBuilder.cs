using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class GameStateBuilder : IGameStateBuilder
{
    private const int ActionLogLimit = 40;

    private readonly MongoDbContext _db;

    public GameStateBuilder(MongoDbContext db) => _db = db;

    public async Task<GameStateResponse> BuildStateAsync(GameRoom room, GameCase gameCase, string userId)
    {
        var state = room.GameplayState!;
        var unlocked = state.UnlockedClueIds.ToHashSet();
        var scene = CurrentScene(gameCase, state, userId);
        var stage = StageForScene(gameCase, scene.SceneId);
        var inspected = state.InspectedItemIds.ToHashSet();
        var asked = state.AskedDialogueIds.ToHashSet();
        var canCompleteScene = GameRules.IsSceneAlreadyCompleted(state, scene.SceneId)
            || CaseValidationService.IsConditionSatisfied(scene.CompleteCondition, inspected, unlocked, asked);
        var missingRequirements = MissingRequirements(scene.CompleteCondition, inspected, unlocked, asked);

        var sceneDialogues = gameCase.Dialogues
            .Where(d => scene.CharacterIds.Contains(d.CharacterId))
            .Select(d => SceneDialogueDto.From(d, unlocked, state.AskedDialogueIds.Contains(d.DialogueId)))
            .ToList();

        if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
        {
            foreach (var dialogueDto in sceneDialogues.Where(d => d.IsAsked))
            {
                dialogueDto.EvidenceChallenges = gameCase.EvidenceChallenges
                    .Where(c => c.DialogueId == dialogueDto.DialogueId)
                    .Select(challenge =>
                    {
                        var resolved = state.ResolvedConfrontationRecords
                            .FirstOrDefault(record => record.ChallengeId == challenge.ChallengeId);
                        return new EvidenceChallengeDto
                        {
                            ChallengeId = challenge.ChallengeId,
                            DialogueId = challenge.DialogueId,
                            Prompt = challenge.Prompt,
                            IsResolved = resolved is not null,
                            Resolution = resolved is null ? null : challenge.SuccessResponse
                        };
                    })
                    .ToList();
            }
        }

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
            AvailableDialogues = sceneDialogues
        };

        var sceneMap = gameCase.Stages.OrderBy(s => s.Order)
            .SelectMany(s => s.Scenes)
            .Select(s => new SceneMapEntryDto
            {
                SceneId = s.SceneId,
                Title = s.Title,
                IsCurrent = s.SceneId == scene.SceneId,
                IsVisited = state.VisitedSceneIds.Contains(s.SceneId),
                IsCompleted = state.CompletedSceneIds.Contains(s.SceneId)
            })
            .ToList();

        var unlockedClues = gameCase.Clues
            .Where(c => unlocked.Contains(c.ClueId))
            .Select(ClueDto.From)
            .ToList();
        var resolvedChallengeIds = state.ResolvedConfrontationRecords.Select(record => record.ChallengeId).ToHashSet();

        var photographedClueIds = await _db.EvidencePhotos
            .Find(photo => photo.RoomId == room.Id && unlocked.Contains(photo.ClueId))
            .Project(photo => photo.ClueId)
            .ToListAsync();
        foreach (var clue in unlockedClues.Where(clue => photographedClueIds.Contains(clue.ClueId)))
        {
            clue.PhotoUrl = $"/api/game/rooms/{Uri.EscapeDataString(room.Id)}/clues/{Uri.EscapeDataString(clue.ClueId)}/photo";
        }

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
            MechanicsVersion = gameCase.MechanicsVersion,
            RoomStatus = room.Status,
            CurrentStageId = stage.StageId,
            CurrentSceneId = scene.SceneId,
            Version = state.Version,
            Players = room.Players.Select(RoomPlayerDto.From).ToList(),
            VisitedSceneIds = state.VisitedSceneIds,
            InspectedItemIds = state.InspectedItemIds,
            CollectedItemIds = state.CollectedItemIds,
            CapturedClueIds = state.CapturedClueIds,
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
            AvailableForAccusation = GameRules.IsAccusationAvailable(gameCase, state, scene.SceneId),
            CurrentSceneCanComplete = canCompleteScene,
            CurrentSceneMissingRequirements = missingRequirements,
            CurrentObjective = BuildObjective(gameCase, state, scene),
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
                    ClaimTypes = new List<string>
                    {
                        EvidenceClaimTypes.Motive,
                        EvidenceClaimTypes.Method,
                        EvidenceClaimTypes.Opportunity
                    }
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

    private static MissingRequirementsDto MissingRequirements(
        CompleteCondition condition,
        IReadOnlySet<string> inspected,
        IReadOnlySet<string> unlocked,
        IReadOnlySet<string> asked) => new()
        {
            RequiredItemIds = condition.RequiredItemIds.Where(i => !inspected.Contains(i)).ToList(),
            RequiredClueIds = condition.RequiredClueIds.Where(c => !unlocked.Contains(c)).ToList(),
            RequiredDialogueIds = condition.RequiredDialogueIds.Where(d => !asked.Contains(d)).ToList()
        };

    private static string BuildObjective(GameCase gameCase, GameplayState state, CaseScene scene)
    {
        if (state.GameStatus != GameStatus.InProgress)
        {
            return state.GameStatus == GameStatus.Won ? "Case closed - the culprit was exposed." : "Case closed - the culprit escaped.";
        }

        if (GameRules.IsAccusationAvailable(gameCase, state, scene.SceneId))
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
}
