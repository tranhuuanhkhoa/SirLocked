using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class GameplayRuleTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static GameCase LoadSampleCase()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "sample-case.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<GameCase>(json, JsonOptions)!;
    }

    [Fact]
    public void Accusation_IsNotAvailable_UntilLastSceneIsCompleted()
    {
        var gameCase = LoadSampleCase();
        var lastScene = gameCase.Stages.OrderBy(s => s.Order).Last().Scenes.Last();
        var state = new GameplayState
        {
            CurrentSceneId = lastScene.SceneId,
            GameStatus = GameStatus.InProgress,
            UnlockedClueIds = gameCase.FinalLogic.RequiredEvidenceIds.ToList()
        };

        Assert.False(GameRules.IsAccusationAvailable(gameCase, state));
    }

    [Fact]
    public void Accusation_IsAvailable_WhenFinalSceneAndEvidenceAreComplete()
    {
        var gameCase = LoadSampleCase();
        var lastScene = gameCase.Stages.OrderBy(s => s.Order).Last().Scenes.Last();
        var state = new GameplayState
        {
            CurrentSceneId = lastScene.SceneId,
            GameStatus = GameStatus.InProgress,
            // The accusation now requires the whole case investigated, not just the final scene.
            CompletedSceneIds = gameCase.Stages.SelectMany(s => s.Scenes).Select(s => s.SceneId).ToList(),
            UnlockedClueIds = gameCase.FinalLogic.RequiredEvidenceIds.ToList()
        };
        state.UnlockedClueIds.AddRange(gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => link.EvidenceId));
        foreach (var chain in gameCase.RequiredTeamworkChains)
        {
            if (!state.UnlockedClueIds.Contains(chain.InvestigatorClueId)) state.UnlockedClueIds.Add(chain.InvestigatorClueId);
            state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord
            {
                ChallengeId = chain.InterrogatorChallengeId,
                EvidenceId = gameCase.EvidenceChallenges.First(challenge => challenge.ChallengeId == chain.InterrogatorChallengeId).CorrectEvidenceId,
                ResolvedByUserId = "user-int",
                ResolvedByRole = "INTERROGATOR"
            });
        }
        foreach (var deductionId in gameCase.FinalLogic.RequiredDeductionIds)
        {
            state.SolvedDeductionRecords.Add(new SolvedDeductionRecord
            {
                DeductionId = deductionId,
                SelectedOptionId = gameCase.Deductions.First(deduction => deduction.DeductionId == deductionId).CorrectOptionId,
                SolvedByUserId = "user-inv",
                SolvedByRole = "INVESTIGATOR"
            });
        }

        Assert.True(GameRules.IsAccusationAvailable(gameCase, state));
    }

    [Fact]
    public void V3Accusation_RequiresEveryCrackToResolve()
    {
        var gameCase = new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            Stages =
            {
                new CaseStage
                {
                    StageId = "stage-final",
                    Order = 1,
                    Scenes = { new CaseScene { SceneId = "scene-final", Title = "Final office" } }
                }
            },
            EvidenceChallenges =
            {
                new EvidenceChallenge { ChallengeId = "crack-1" },
                new EvidenceChallenge { ChallengeId = "crack-2" }
            }
        };
        var state = new GameplayState
        {
            CurrentSceneId = "scene-final",
            GameStatus = GameStatus.InProgress,
            CompletedSceneIds = { "scene-final" },
            ResolvedConfrontationRecords =
            {
                new ResolvedConfrontationRecord { ChallengeId = "crack-1", EvidenceId = "evidence-1" }
            }
        };

        Assert.False(GameRules.IsAccusationAvailable(gameCase, state));

        state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord
        {
            ChallengeId = "crack-2",
            EvidenceId = "evidence-2"
        });

        Assert.True(GameRules.IsAccusationAvailable(gameCase, state));
    }

    [Fact]
    public void CompletedScene_IsTreatedAsIdempotent()
    {
        var state = new GameplayState { CompletedSceneIds = new List<string> { "scene-study" } };
        Assert.True(GameRules.IsSceneAlreadyCompleted(state, "scene-study"));
        Assert.False(GameRules.IsSceneAlreadyCompleted(state, "scene-other"));
    }

    [Fact]
    public void StageCompletion_RequiresEverySceneInStage()
    {
        var stage = new CaseStage
        {
            StageId = "stage-1",
            Scenes = new List<CaseScene>
            {
                new() { SceneId = "scene-1" },
                new() { SceneId = "scene-2" }
            }
        };

        Assert.False(GameRules.IsStageComplete(stage, new GameplayState
        {
            CompletedSceneIds = new List<string> { "scene-1" }
        }));
        Assert.True(GameRules.IsStageComplete(stage, new GameplayState
        {
            CompletedSceneIds = new List<string> { "scene-1", "scene-2" }
        }));
    }

    [Fact]
    public void AccuseRequest_RejectsNullEvidenceIds()
    {
        var request = new AccuseRequest
        {
            CulpritId = "char-edgar",
            EvidenceIds = null
        };

        var results = new List<ValidationResult>();
        var isValid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.False(isValid);
        Assert.Contains(results, r => r.MemberNames.Contains(nameof(AccuseRequest.EvidenceIds)));
    }
}
