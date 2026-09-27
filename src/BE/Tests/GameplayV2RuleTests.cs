using System.Text.Json;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class GameplayV2RuleTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static GameCase LoadSampleCase()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "sample-case.json");
        return JsonSerializer.Deserialize<GameCase>(File.ReadAllText(path), JsonOptions)!;
    }

    [Fact]
    public void InvestigationV2Sample_IsValid()
    {
        var result = new CaseValidationService().Validate(LoadSampleCase());
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void V2Validation_RejectsDuplicateChallengeAndInvalidDeductionHintTarget()
    {
        var gameCase = LoadSampleCase();
        gameCase.EvidenceChallenges[1].ChallengeId = gameCase.EvidenceChallenges[0].ChallengeId;
        gameCase.Hints.Add(new CaseHint
        {
            HintId = "hint-deduction",
            ContextType = HintContextTypes.Deduction,
            TargetId = "deduction-future",
            Order = 1,
            Text = "Future hint"
        });

        var result = new CaseValidationService().Validate(gameCase);

        Assert.Contains(result.Errors, error => error.Code == "DuplicateId" && error.Path == "evidenceChallenges");
        Assert.Contains(result.Errors, error => error.Code == "MissingReference" && error.Path == "hints.targetId");
    }

    [Fact]
    public void V2Validation_RejectsDuplicateFinalEvidenceAcrossClaims()
    {
        var gameCase = LoadSampleCase();
        gameCase.FinalLogic.RequiredEvidenceLinks[1].EvidenceId = gameCase.FinalLogic.RequiredEvidenceLinks[0].EvidenceId;

        var result = new CaseValidationService().Validate(gameCase);

        Assert.Contains(result.Errors, error => error.Code == "InvalidValue"
            && error.Path == "finalLogic.requiredEvidenceLinks"
            && error.Message.Contains("different evidence"));
    }

    [Fact]
    public void PresentEvidence_WrongDuplicateCorrectAndResolvedAreDeterministic()
    {
        var state = new GameplayState { UnlockedClueIds = { "clue-wrong", "clue-correct" } };
        var challenge = new EvidenceChallenge
        {
            ChallengeId = "challenge-1",
            CorrectEvidenceId = "clue-correct",
            UnlockClueIds = { "clue-result" }
        };
        var now = new DateTime(2026, 6, 18, 10, 0, 0, DateTimeKind.Utc);

        var wrong = GameplayV2Rules.ApplyEvidence(state, challenge, "clue-wrong", "user-int", "INTERROGATOR", now);
        var duplicate = GameplayV2Rules.ApplyEvidence(state, challenge, "clue-wrong", "user-int", "INTERROGATOR", now);
        var correct = GameplayV2Rules.ApplyEvidence(state, challenge, "clue-correct", "user-int", "INTERROGATOR", now);
        var afterResolved = GameplayV2Rules.ApplyEvidence(state, challenge, "clue-other", "user-int", "INTERROGATOR", now);

        Assert.Equal(ConfrontationOutcome.Rejected, wrong.Outcome);
        Assert.Equal(1, state.WrongEvidencePresentationCount);
        Assert.Equal(ConfrontationOutcome.DuplicateRejected, duplicate.Outcome);
        Assert.Equal(ConfrontationOutcome.Resolved, correct.Outcome);
        Assert.Contains("clue-result", state.UnlockedClueIds);
        Assert.Equal(ConfrontationOutcome.AlreadyResolved, afterResolved.Outcome);
        Assert.Single(state.ResolvedConfrontationRecords);
    }

    [Fact]
    public void AccusationValidation_SeparatesInvalidInputFromWrongAnswer()
    {
        var gameCase = LoadSampleCase();
        var state = new GameplayState();
        PrimeFullV2State(gameCase, state);
        var request = CorrectAccusation(gameCase);

        Assert.Null(GameplayV2Rules.ValidateAccusation(gameCase, state, request));
        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, request));

        request.CulpritId = gameCase.Characters.First(character => character.CharacterId != gameCase.FinalLogic.CulpritId).CharacterId;
        Assert.Null(GameplayV2Rules.ValidateAccusation(gameCase, state, request));
        Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase, request));

        request = CorrectAccusation(gameCase);
        request.EvidenceLinks[1].EvidenceId = request.EvidenceLinks[0].EvidenceId;
        Assert.Equal("Each accusation claim must use different evidence.", GameplayV2Rules.ValidateAccusation(gameCase, state, request));
    }

    [Fact]
    public void DeductionAndScoreRules_AreDeterministic()
    {
        var gameCase = LoadSampleCase();
        var state = new GameplayState();
        PrimeFullV2State(gameCase, state, solveDeduction: false);
        var deduction = gameCase.Deductions[0];
        var now = new DateTime(2026, 6, 18, 10, 0, 0, DateTimeKind.Utc);

        var wrong = GameplayV2Rules.ApplyDeduction(state, deduction, deduction.Options[1].Id, "user-inv", "INVESTIGATOR", now);
        var duplicate = GameplayV2Rules.ApplyDeduction(state, deduction, deduction.Options[1].Id, "user-inv", "INVESTIGATOR", now);
        var correct = GameplayV2Rules.ApplyDeduction(state, deduction, deduction.CorrectOptionId, "user-inv", "INVESTIGATOR", now);
        var score = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);

        Assert.Equal(DeductionOutcome.Rejected, wrong.Outcome);
        Assert.Equal(DeductionOutcome.DuplicateRejected, duplicate.Outcome);
        Assert.Equal(DeductionOutcome.Solved, correct.Outcome);
        // 3 of 5 evidence clues unlocked => 40*3/5 = 24.
        Assert.Equal(24, score.EvidenceCoverageScore);
        // 1 of 2 challenges resolved => round(25*0.5) = 13.
        Assert.Equal(13, score.ContradictionCoverageScore);
        // 1 of 1 deduction solved => 20.
        Assert.Equal(20, score.DeductionCoverageScore);
        // Only the interrogator confrontation is primed => 5.
        Assert.Equal(5, score.TeamworkScore);
        Assert.Equal(2, score.WrongDeductionPenalty);
        // 24 + 13 + 20 + 5 - 2 = 60.
        Assert.Equal(60, score.TotalScore);
        Assert.Equal("B", score.Rank);
    }

    [Fact]
    public void Hints_DoNotReduceScore()
    {
        var gameCase = MinimalScoringCase();
        var baseline = GameplayV2Rules.BuildScoreSummary(gameCase, new GameplayState(), accusationSucceeded: true);
        var withHints = new GameplayState { UsedHintIds = { "hint-a", "hint-b", "hint-c" } };

        var hinted = GameplayV2Rules.BuildScoreSummary(gameCase, withHints, accusationSucceeded: true);

        Assert.Equal(baseline.TotalScore, hinted.TotalScore);
    }

    [Fact]
    public void CameraMisses_CostOnePointEach()
    {
        var gameCase = MinimalScoringCase();
        var state = new GameplayState { CameraMissCount = 3 };

        var score = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);

        Assert.Equal(3, score.CameraMissPenalty);
    }

    [Fact]
    public void FailedAccusation_AlwaysRanksD()
    {
        var gameCase = MinimalScoringCase();
        // Fully solved state would otherwise rank S.
        var state = new GameplayState
        {
            UnlockedClueIds = { "ev1", "ev2" },
            ResolvedConfrontationRecords = { new ResolvedConfrontationRecord { ChallengeId = "ch1", EvidenceId = "ev2", ResolvedByRole = "INTERROGATOR" } },
            SolvedDeductionRecords = { new SolvedDeductionRecord { DeductionId = "d1" } },
            ClueDiscoveries = { new ClueDiscoveryRecord { ClueId = "ev2", DiscoveredByRole = "INVESTIGATOR", SourceAction = ClueDiscoverySources.Inspect } }
        };

        var won = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);
        var lost = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: false);

        Assert.Equal(100, won.TotalScore);
        Assert.Equal("S", won.Rank);
        Assert.Equal(100, lost.TotalScore);
        Assert.Equal("D", lost.Rank);
    }

    [Theory]
    [InlineData(false, false, false, 0)]
    [InlineData(false, true, false, 5)]
    [InlineData(true, true, false, 10)]
    [InlineData(true, true, true, 15)]
    public void TeamworkScore_CountsEachConditionOnce(bool investigator, bool interrogator, bool handoff, int expected)
    {
        var gameCase = MinimalScoringCase();
        var state = new GameplayState();

        if (investigator)
            state.ClueDiscoveries.Add(new ClueDiscoveryRecord { ClueId = "ev2", DiscoveredByRole = "INVESTIGATOR", SourceAction = ClueDiscoverySources.Inspect });
        if (interrogator)
        {
            // When handoff is required, the resolved evidence must be one the investigator discovered.
            var evidenceId = handoff ? "ev2" : "ev1";
            if (handoff && state.ClueDiscoveries.All(d => d.ClueId != "ev2"))
                state.ClueDiscoveries.Add(new ClueDiscoveryRecord { ClueId = "ev2", DiscoveredByRole = "INVESTIGATOR", SourceAction = ClueDiscoverySources.Camera });
            state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord { ChallengeId = "ch1", EvidenceId = evidenceId, ResolvedByRole = "INTERROGATOR" });
        }

        var score = GameplayV2Rules.BuildScoreSummary(gameCase, state, accusationSucceeded: true);

        Assert.Equal(expected, score.TeamworkScore);
        Assert.Equal(investigator, score.InvestigatorContribution);
        Assert.Equal(interrogator, score.InterrogatorContribution);
        Assert.Equal(handoff, score.CrossRoleHandoff);
    }

    private static GameCase MinimalScoringCase() => new()
    {
        MechanicsVersion = CaseMechanicsVersions.InvestigationV2,
        Clues =
        {
            new CaseClue { ClueId = "ev1", IsEvidence = true },
            new CaseClue { ClueId = "ev2", IsEvidence = true }
        },
        EvidenceChallenges = { new EvidenceChallenge { ChallengeId = "ch1", CorrectEvidenceId = "ev1" } },
        Deductions = { new DeductionChallenge { DeductionId = "d1", CorrectOptionId = "o1" } }
    };

    [Fact]
    public void PlayerDtos_DoNotExposeSecretV2Answers()
    {
        var propertyNames = typeof(EvidenceChallengeDto).GetProperties().Select(property => property.Name).ToHashSet();
        Assert.DoesNotContain("CorrectEvidenceId", propertyNames);
        Assert.DoesNotContain("FailureResponse", propertyNames);
        var deductionPropertyNames = typeof(DeductionDto).GetProperties().Select(property => property.Name).ToHashSet();
        Assert.DoesNotContain("CorrectOptionId", deductionPropertyNames);

        var conversationChoicePropertyNames = typeof(ConversationChoiceDto).GetProperties().Select(property => property.Name).ToHashSet();
        Assert.DoesNotContain("RequiredClueIds", conversationChoicePropertyNames);
        Assert.DoesNotContain("NextNodeId", conversationChoicePropertyNames);
        var lockedChoice = ConversationChoiceDto.From(new ConversationChoice
        {
            ChoiceId = "choice-locked",
            Label = "Secret branch",
            RequiredClueIds = { "clue-hidden" },
            NextNodeId = "node-secret"
        }, new HashSet<string>());
        Assert.True(lockedChoice.IsLocked);
        Assert.Null(lockedChoice.Label);
    }

    private static void PrimeFullV2State(GameCase gameCase, GameplayState state, bool solveDeduction = true)
    {
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
        if (!solveDeduction) return;
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
    }

    private static AccuseRequest CorrectAccusation(GameCase gameCase) => new()
    {
        CulpritId = gameCase.FinalLogic.CulpritId,
        MotiveId = gameCase.FinalLogic.CorrectMotiveId,
        MethodId = gameCase.FinalLogic.CorrectMethodId,
        EvidenceLinks = gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => new EvidenceLinkRequest
        {
            ClaimType = link.ClaimType,
            EvidenceId = link.EvidenceId
        }).ToList()
    };
}
