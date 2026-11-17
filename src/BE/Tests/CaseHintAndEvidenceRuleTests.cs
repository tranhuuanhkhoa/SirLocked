using System.Text.Json;
using System.Text.Json.Nodes;
using MongoDB.Bson;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// VUAN-6: a final evidence slot may accept several reasonable answers (<c>acceptedEvidenceIds</c>), and every
/// question of a new case carries three escalating hints. Old cases score and validate exactly as before.
/// </summary>
public sealed class CaseHintAndEvidenceRuleTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private const string Sample = "case-pixel-dong-ho-dem-mua-vi.json";
    private readonly CaseValidationService _validator = new();

    private static GameCase LoadFixture() => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", Sample)), Web)!;

    private static GameCase LoadSeed(string relative) => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", relative)), Web)!;

    public static IEnumerable<object[]> SeedFiles() =>
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "SeedData"), "*.json", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}Cutscenes{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(Path.Combine(AppContext.BaseDirectory, "SeedData"), path))
            .Order(StringComparer.Ordinal)
            .Select(path => new object[] { path });

    private static AccuseRequest CorrectAccusation(GameCase gameCase) => new()
    {
        CulpritId = gameCase.FinalLogic.CulpritId,
        MotiveId = gameCase.FinalLogic.CorrectMotiveId,
        MethodId = gameCase.FinalLogic.CorrectMethodId,
        EvidenceLinks = gameCase.FinalLogic.RequiredEvidenceLinks
            .Select(link => new EvidenceLinkRequest { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId })
            .ToList()
    };

    private static AccuseRequest With(AccuseRequest request, string claimType, string evidenceId)
    {
        request.EvidenceLinks = request.EvidenceLinks
            .Select(link => link.ClaimType == claimType ? new EvidenceLinkRequest { ClaimType = claimType, EvidenceId = evidenceId } : link)
            .ToList();
        return request;
    }

    // ---------------------------------------------------------------- A2: several accepted answers per slot

    [Theory]
    [MemberData(nameof(SeedFiles))]
    public void OldCases_HaveNoAlternatives_AndScoreExactlyAsBefore(string relative)
    {
        var gameCase = LoadSeed(relative);
        Assert.All(gameCase.FinalLogic.RequiredEvidenceLinks, link => Assert.Null(link.AcceptedEvidenceIds));
        if (gameCase.FinalLogic.RequiredEvidenceLinks.Count == 0) return;

        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, CorrectAccusation(gameCase)));
        // Any other evidence clue in any slot is still wrong: one answer per slot, as before.
        foreach (var link in gameCase.FinalLogic.RequiredEvidenceLinks)
            foreach (var other in gameCase.Clues.Where(clue => clue.IsEvidence && clue.ClueId != link.EvidenceId).Take(3))
                Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase, With(CorrectAccusation(gameCase), link.ClaimType, other.ClueId)));
    }

    [Fact]
    public void Sample_AcceptsTheFingerprintOnTheTray_AsOpportunity()
    {
        var gameCase = LoadFixture();
        var opportunity = gameCase.FinalLogic.RequiredEvidenceLinks.Single(link => link.ClaimType == EvidenceClaimTypes.Opportunity);
        Assert.Equal("evidence-dh-ve-tau", opportunity.EvidenceId);
        Assert.Equal(["evidence-dh-van-tay"], opportunity.AcceptedEvidenceIds);

        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, CorrectAccusation(gameCase)));
        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, With(CorrectAccusation(gameCase), "OPPORTUNITY", "evidence-dh-van-tay")));
        // The alternative belongs to OPPORTUNITY only, and an unrelated clue stays wrong.
        Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase, With(CorrectAccusation(gameCase), "OPPORTUNITY", "clue-dh-so-sua")));
        Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase, With(CorrectAccusation(gameCase), "MOTIVE", "evidence-dh-van-tay")));
        Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase, With(CorrectAccusation(gameCase), "METHOD", "evidence-dh-van-tay")));
    }

    [Fact]
    public void Sample_WithAlternatives_PassesTheValidator()
    {
        var result = _validator.Validate(LoadFixture()).RequireHints();
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error => $"{error.Code} {error.Path} {error.Message}")));
        Assert.Empty(result.Warnings);
    }

    [Theory]
    [InlineData("evidence-dh-khong-co", "MissingReference")]
    [InlineData("fact-dh-ai-ghe", "InvalidEvidenceFlag")]
    [InlineData("evidence-dh-ve-tau", "InvalidValue")] // the slot's own evidence
    [InlineData("evidence-dh-dong-ho", "InvalidValue")] // METHOD's evidence: would block that claim
    public void Validator_RejectsAnAlternativeThatCannotStandForTheClaim(string alternative, string code)
    {
        var gameCase = LoadFixture();
        var index = gameCase.FinalLogic.RequiredEvidenceLinks.FindIndex(link => link.ClaimType == EvidenceClaimTypes.Opportunity);
        gameCase.FinalLogic.RequiredEvidenceLinks[index].AcceptedEvidenceIds = [alternative];

        var result = _validator.Validate(gameCase);
        Assert.Contains(result.Errors, error => error.Code == code
            && error.Path == $"finalLogic.requiredEvidenceLinks[{index}].acceptedEvidenceIds[0]");
    }

    [Fact]
    public void Validator_RejectsRepeatedAlternatives()
    {
        var gameCase = LoadFixture();
        var link = gameCase.FinalLogic.RequiredEvidenceLinks.Single(item => item.ClaimType == EvidenceClaimTypes.Opportunity);
        link.AcceptedEvidenceIds = ["evidence-dh-van-tay", "evidence-dh-van-tay"];
        Assert.Contains(_validator.Validate(gameCase).Errors, error => error.Code == "InvalidValue"
            && error.Message.Contains("must not repeat", StringComparison.Ordinal));
    }

    [Fact]
    public void ResultScreen_ShowsTheAcceptedAlternativeAsTheTeamsCorrectEvidence()
    {
        var gameCase = LoadFixture();
        var request = With(CorrectAccusation(gameCase), "OPPORTUNITY", "evidence-dh-van-tay");
        var room = new GameRoom
        {
            Id = ObjectId.GenerateNewId().ToString(), CaseId = gameCase.CaseId, Status = RoomStatus.Completed,
            Players = [new RoomPlayer { UserId = "player-1" }, new RoomPlayer { UserId = "player-2" }],
            GameplayState = new GameplayState()
        };
        var snapshot = GameResultFactory.CreateSnapshot(room, gameCase, request,
            request.EvidenceLinks.Select(link => link.EvidenceId).ToList(), success: true, DateTime.UtcNow);
        // The stored definition keeps the alternatives, so a later edit of the case cannot rescore this result.
        Assert.Equal(["evidence-dh-van-tay"], snapshot.CaseDefinitionSnapshot!.FinalLogic.RequiredEvidenceLinks
            .Single(link => link.ClaimType == "OPPORTUNITY").AcceptedEvidenceIds);

        var response = GameplayService.ToResultResponse(GameResultFactory.CreateResult(room.Id, snapshot), gameCase);
        var opportunity = response.EvidenceResults.Single(entry => entry.ClaimType == "OPPORTUNITY");
        Assert.True(opportunity.IsCorrect);
        Assert.Equal("evidence-dh-van-tay", opportunity.CorrectEvidenceId);
        Assert.Equal("Dấu tay trên mép khay", opportunity.CorrectEvidenceTitle);
        Assert.All(response.EvidenceResults, entry => Assert.True(entry.IsCorrect));
    }

    [Fact]
    public void AbsentAlternatives_LeaveJsonAndBsonUnchanged_SoStoredHashesStayValid()
    {
        var link = new RequiredEvidenceLink { ClaimType = "MOTIVE", ConclusionId = "c", EvidenceId = "e" };
        Assert.False(JsonSerializer.SerializeToNode(link, Web)!.AsObject().ContainsKey("acceptedEvidenceIds"));
        Assert.False(link.ToBsonDocument().Contains("AcceptedEvidenceIds"));
        link.AcceptedEvidenceIds = ["x"];
        Assert.Equal("x", JsonSerializer.SerializeToNode(link, Web)!["acceptedEvidenceIds"]![0]!.GetValue<string>());
    }

    [Fact]
    public void AiCaseLogicSchema_OffersAlternativesAsAnOptionalField()
    {
        var schema = AiStrictSchemaProvider.CaseLogicSchema(CaseMechanicsVersions.InvestigationV3PairedConfrontation);
        Assert.Empty(AiStrictSchemaLinter.Validate(schema));
        var link = schema["properties"]!["finalLogic"]!["properties"]!["requiredEvidenceLinks"]!["items"]!.AsObject();
        Assert.True(link["properties"]!.AsObject().ContainsKey("acceptedEvidenceIds"));
        Assert.DoesNotContain(link["required"]!.AsArray(), name => name!.GetValue<string>() == "acceptedEvidenceIds");

        var linkSchema = link.ToJsonString();
        Assert.Empty(AiBridgeSchemaValidator.Validate(linkSchema, """{"claimType":"MOTIVE","conclusionId":"","evidenceId":"e"}"""));
        Assert.Empty(AiBridgeSchemaValidator.Validate(linkSchema, """{"claimType":"MOTIVE","conclusionId":"","evidenceId":"e","acceptedEvidenceIds":["f"]}"""));
        Assert.Empty(AiBridgeSchemaValidator.Validate(linkSchema, """{"claimType":"MOTIVE","conclusionId":"","evidenceId":"e","acceptedEvidenceIds":null}"""));
        Assert.NotEmpty(AiBridgeSchemaValidator.Validate(linkSchema, """{"claimType":"MOTIVE","conclusionId":"","evidenceId":"e","acceptedEvidenceIds":"f"}"""));
    }

    // ---------------------------------------------------------------- A3: three hint levels everywhere

    [Fact]
    public void Sample_HasEveryHintLevel_AndPassesTheStrictRule()
    {
        var gameCase = LoadFixture();
        var result = _validator.Validate(gameCase).RequireHints();
        Assert.DoesNotContain(result.Errors, error => CaseHintCodes.All.Contains(error.Code));
        Assert.Equal(9, gameCase.Hints.Count);
    }

    [Theory]
    [InlineData("hint-dh-ben-2", "hints[SCENE:scene-dh-ben-cang]", "scene-dh-ben-cang", "missing order 2")]
    [InlineData("hint-dh-tiem-1", "hints[SCENE:scene-dh-tiem-dong-ho]", "scene-dh-tiem-dong-ho", "missing order 1")]
    [InlineData("hint-dh-doi-chat-3", "hints[CONFRONTATION:challenge-dh-vao-tiem]", "challenge-dh-vao-tiem", "missing order 3")]
    public void CopyWithoutOneLevel_IsReportedAtThatTarget(string removedHintId, string path, string targetId, string message)
    {
        var gameCase = LoadFixture();
        gameCase.Hints.RemoveAll(hint => hint.HintId == removedHintId);

        // As a warning by default (a published case is never blocked) ...
        var lenient = _validator.Validate(gameCase);
        Assert.True(lenient.IsValid, string.Join("\n", lenient.Errors.Select(error => $"{error.Code} {error.Path}")));
        var warning = Assert.Single(lenient.Warnings);
        Assert.Equal(CaseHintCodes.MissingHintLevel, warning.Code);

        // ... and as an error for a new case or an AI draft, at exactly that target.
        var strict = _validator.Validate(gameCase).RequireHints();
        var error = Assert.Single(strict.Errors);
        Assert.Equal(CaseHintCodes.MissingHintLevel, error.Code);
        Assert.Equal(path, error.Path);
        Assert.Equal(targetId, error.RefId);
        Assert.Contains(message, error.Message, StringComparison.Ordinal);
        Assert.Empty(strict.Warnings);
    }

    [Fact]
    public void DuplicatedLevel_IsReported()
    {
        var gameCase = LoadFixture();
        var second = gameCase.Hints.Single(hint => hint.HintId == "hint-dh-ben-2");
        second.Order = 1;
        var errors = _validator.Validate(gameCase).RequireHints().Errors;
        Assert.Contains(errors, error => error.Code == CaseHintCodes.DuplicateHintLevel && error.RefId == "scene-dh-ben-cang");
        Assert.Contains(errors, error => error.Code == CaseHintCodes.MissingHintLevel && error.RefId == "scene-dh-ben-cang");
    }

    [Fact]
    public void PuzzleWithTwoSolutionHints_IsReportedAtItsSolution()
    {
        var gameCase = LoadFixture();
        var index = gameCase.Puzzles.FindIndex(puzzle => puzzle.PuzzleId == "puzzle-dh-van-tay");
        var solution = JsonNode.Parse(gameCase.Puzzles[index].SolutionJson)!.AsObject();
        solution["hints"]!.AsArray().RemoveAt(2);
        gameCase.Puzzles[index].SolutionJson = solution.ToJsonString();

        var error = Assert.Single(_validator.Validate(gameCase).RequireHints().Errors);
        Assert.Equal(CaseHintCodes.MissingPuzzleHints, error.Code);
        Assert.Equal($"puzzles[{index}].solution.hints", error.Path);
        Assert.Equal("puzzle-dh-van-tay", error.RefId);
    }

    [Theory]
    [MemberData(nameof(SeedFiles))]
    public void PublishedSeedCases_WithoutHints_OnlyWarn(string relative)
    {
        var gameCase = LoadSeed(relative);
        PuzzleKindsFill(gameCase);
        var before = _validator.Validate(gameCase);
        Assert.DoesNotContain(before.Errors, error => CaseHintCodes.All.Contains(error.Code));
        // The newcomer tutorial ships with every hint level (it is the model case); the older seeds still lack some.
        if (gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2 && !TutorialRules.IsTutorialCase(gameCase.CaseId))
            Assert.Contains(before.Warnings, warning => CaseHintCodes.All.Contains(warning.Code));
    }

    [Fact]
    public void ProjectionPlanner_CreatesThreeHintSlotsPerQuestion()
    {
        var truthService = new CaseTruthService();
        var draft = new AiCaseDraft
        {
            Id = "64b64c0f0f0f0f0f0f0f0f21", LogicContractVersion = CaseLogicContractVersions.CausalFiveClaim,
            PlannedTargetKind = CaseTargetKinds.Asset,
            Settings = new AiDraftSettings
            {
                GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2, ShortDemoProfileVersion = 1,
                MechanicsVersion = CaseMechanicsVersions.InvestigationV2
            }
        };
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(AiCaseMockFactory.BuildMockTruthPackageJson(draft), Web)!;
        draft.CaseTruth = truth;
        draft.TruthHash = truthService.ComputeHash(truth);
        var plan = new GameplayProjectionPlanner(truthService).Build(draft, truth);

        var skeleton = plan.Skeleton;
        var targets = skeleton.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId)
            .Concat(skeleton.EvidenceChallenges.Select(challenge => challenge.ChallengeId))
            .Concat(skeleton.Deductions.Select(deduction => deduction.DeductionId))
            .ToList();
        Assert.NotEmpty(targets);
        foreach (var target in targets)
            Assert.Equal([1, 2, 3], skeleton.Hints.Where(hint => hint.TargetId == target).Select(hint => hint.Order).Order());
        Assert.Equal(skeleton.Hints.Count, skeleton.Hints.Select(hint => hint.HintId).Distinct().Count());
        Assert.Equal(skeleton.Hints.Count, plan.Hints.Count);
        Assert.False(CaseHintRules.PlanPredatesRule(plan));

        // A plan persisted before the rule (one slot per question) is recognised, so its draft only warns.
        skeleton.Hints.RemoveAll(hint => hint.Order > 1);
        Assert.True(CaseHintRules.PlanPredatesRule(plan));
        Assert.False(CaseHintRules.PlanPredatesRule(null));

        // The writer is told what each level means.
        Assert.Contains("order 1, 2 and 3", AiCaseService.HintLevelRequirement, StringComparison.Ordinal);
    }

    [Fact]
    public void BlindDetectiveView_ShowsOnlyTheFirstHintOfEachQuestion_AndNoAlternatives()
    {
        var view = AiPlayerViewBuilder.Build(LoadFixture());
        var hints = view["hints"]!.AsArray();
        Assert.Equal(3, hints.Count);
        Assert.All(hints, hint => Assert.Equal(1, hint!["order"]!.GetValue<int>()));
        Assert.DoesNotContain("acceptedEvidenceIds", view.ToJsonString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MockAnswers_CarryEveryHintLevel()
    {
        var mock = MockCaseFactory.Create("Một vụ thử", stageCount: 3, difficulty: "easy", caseId: "case-mock-hints");
        var result = _validator.Validate(mock).RequireHints();
        Assert.DoesNotContain(result.Errors, error => CaseHintCodes.All.Contains(error.Code));
    }

    private static void PuzzleKindsFill(GameCase gameCase) =>
        SirLocked.Api.Services.PuzzleKinds.PuzzleKindRegistry.FillMissing(gameCase);
}
