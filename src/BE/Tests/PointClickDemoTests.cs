using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class PointClickDemoTests
{
    private static GameCase Load(string language = "en") =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,
            "SeedData", "V3", $"case-point-click-night-ledger-{language}.json")), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    [Theory]
    [InlineData("en")]
    [InlineData("vi")]
    public void AuthoredPair_IsPublishValidIncludingReachability(string language)
    {
        var gameCase = Load(language);
        var validation = new CaseValidationService().Validate(gameCase);
        Assert.True(validation.IsValid, string.Join(Environment.NewLine,
            validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));
        Assert.Equal(language, gameCase.Language);
        Assert.Equal(3, gameCase.MechanicsVersion);
        Assert.Equal(2, Assert.Single(gameCase.Stages).Scenes.Count);
        Assert.Empty(gameCase.SourceAiDraftId);
        Assert.Single(gameCase.Interactions, interaction => interaction.Type == "COMBINE_ITEMS");
        Assert.Single(gameCase.Interactions, interaction => interaction.Type == "USE_ITEM_ON_TARGET");
        var puzzle = Assert.Single(gameCase.Puzzles);
        Assert.Equal("2142", puzzle.CorrectCode);
        Assert.DoesNotContain(gameCase.Stages.SelectMany(stage => stage.Scenes).SelectMany(scene => scene.ItemIds),
            id => id == puzzle.RequiredItemIds.Single());
        Assert.Single(gameCase.EvidenceChallenges);
        Assert.Single(gameCase.Deductions);
        Assert.Single(gameCase.RequiredTeamworkChains);
        Assert.Equal(3, gameCase.FinalLogic.RequiredEvidenceLinks.Count);
        Assert.All(gameCase.Stages.SelectMany(stage => stage.Scenes), scene =>
        {
            Assert.NotNull(scene.Runtime!.NavigationObstacles);
            Assert.StartsWith("/assets/audio/point-click/ambience-", scene.Runtime.Audio!.AmbienceUrl);
            Assert.Equal(7, scene.Runtime.Audio.Cues.Count);
        });
    }

    [Fact]
    public void AuthoredPair_UsesTheSameGeometryAndMedia()
    {
        var english = Load();
        var vietnamese = Load("vi");
        var en = english.Stages.SelectMany(stage => stage.Scenes).ToArray();
        var vi = vietnamese.Stages.SelectMany(stage => stage.Scenes).ToArray();
        for (var i = 0; i < en.Length; i++)
        {
            var enRuntime = en[i].Runtime!;
            var viRuntime = vi[i].Runtime!;
            Assert.Equal(en[i].BackgroundUrl, vi[i].BackgroundUrl);
            Assert.Equal(JsonSerializer.Serialize(enRuntime.NavigationObstacles), JsonSerializer.Serialize(viRuntime.NavigationObstacles));
            Assert.Equal(JsonSerializer.Serialize(enRuntime.Audio), JsonSerializer.Serialize(viRuntime.Audio));
            Assert.Equal(enRuntime.ItemPlacements.Select(item => item.Asset), viRuntime.ItemPlacements.Select(item => item.Asset));
        }
    }

    [Theory]
    [InlineData("COMBINE_ITEMS")]
    [InlineData("USE_ITEM_ON_TARGET")]
    [InlineData("CODE_PUZZLE")]
    public void MandatoryMechanics_CannotBeRemovedWithoutBreakingReachability(string type)
    {
        var gameCase = Load();
        if (type == "CODE_PUZZLE") gameCase.Puzzles.Clear();
        else gameCase.Interactions.RemoveAll(interaction => interaction.Type == type);
        var validation = new CaseValidationService().Validate(gameCase);
        Assert.False(validation.IsValid);
        Assert.Contains(validation.Errors, error => error.Code.Contains("Reach", StringComparison.OrdinalIgnoreCase)
            || error.Code.Contains("Missing", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RuntimeProjection_DeepCopiesPublicAudioAndObstaclesForEitherRole()
    {
        var gameCase = Load();
        var runtime = gameCase.Stages[0].Scenes[0].Runtime!;
        foreach (var role in new[] { PlayerRole.Investigator, PlayerRole.Interrogator })
        {
            var response = new GameStateResponse { VisibleScene = new VisibleSceneDto { Runtime = runtime } };
            V3SceneProjectionPolicy.Apply(response, gameCase, new RoomPlayer { Role = role });
            var projected = response.VisibleScene.Runtime!;
            Assert.NotSame(runtime.Audio, projected.Audio);
            Assert.NotSame(runtime.NavigationObstacles, projected.NavigationObstacles);
            projected.Audio!.Cues["discovery"] = "changed";
            projected.NavigationObstacles![0].X = 1;
            Assert.NotEqual("changed", runtime.Audio!.Cues["discovery"]);
            Assert.Equal(465, runtime.NavigationObstacles![0].X);
        }
    }

    [Fact]
    public void RuntimeBson_RetainsNewFieldsAndDistinguishesLegacyFromExplicitEmptyObstacles()
    {
        var runtime = Load().Stages[0].Scenes[0].Runtime!;
        var roundTrip = BsonSerializer.Deserialize<SceneRuntime>(runtime.ToBson());
        Assert.Equal(runtime.Audio!.AmbienceUrl, roundTrip.Audio!.AmbienceUrl);
        Assert.Equal(runtime.Audio.Cues.Count, roundTrip.Audio.Cues.Count);
        Assert.Single(roundTrip.NavigationObstacles!);
        var legacy = BsonSerializer.Deserialize<SceneRuntime>(new BsonDocument { { "Width", 1600 }, { "Height", 900 } });
        Assert.Null(legacy.Audio);
        Assert.Null(legacy.NavigationObstacles);
        runtime.NavigationObstacles = new();
        Assert.Empty(BsonSerializer.Deserialize<SceneRuntime>(runtime.ToBson()).NavigationObstacles!);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("/api/admin/private.wav")]
    [InlineData("/assets/%2e%2e/private.wav")]
    [InlineData("/assets/audio/%00secret.wav")]
    [InlineData("https://username:secret@example.org/sound.wav")]
    public void RuntimeValidator_RejectsUnsafeAudio(string url)
    {
        var gameCase = Load();
        gameCase.Stages[0].Scenes[0].Runtime!.Audio!.AmbienceUrl = url;
        var result = new CaseValidationService().Validate(gameCase);
        Assert.Contains(result.Errors, error => error.Path.EndsWith(".audio.ambienceUrl"));
    }

    [Theory]
    [InlineData("/assets/audio/sound.wav")]
    [InlineData("https://example.org/sound.wav")]
    [InlineData("http://localhost/sound.wav")]
    public void RuntimeValidator_AllowsSafeAudio(string url)
    {
        var gameCase = Load();
        gameCase.Stages[0].Scenes[0].Runtime!.Audio!.AmbienceUrl = url;
        var result = new CaseValidationService().Validate(gameCase);
        Assert.DoesNotContain(result.Errors, error => error.Path.Contains(".audio."));
    }

    [Fact]
    public void RuntimeValidator_RejectsBlockedSpawnAndNonFiniteOrOutOfBoundsNavigation()
    {
        var gameCase = Load();
        var runtime = gameCase.Stages[0].Scenes[0].Runtime!;
        runtime.SpawnPoints["default"] = new SpawnPoint { X = 500, Y = 700 };
        runtime.NavigationObstacles!.Add(new RuntimeBox { X = double.NaN, Y = 1, Width = 2, Height = 2 });
        runtime.NavigationObstacles.Add(new RuntimeBox { X = 1595, Y = 600, Width = 50, Height = 20 });
        runtime.Audio!.Cues["private"] = "/assets/audio/secret.wav";
        var result = new CaseValidationService().Validate(gameCase);
        Assert.Contains(result.Errors, error => error.Code == "BlockedNavigation");
        Assert.Contains(result.Errors, error => error.Path.EndsWith("navigationObstacles[1]") && error.Code == "InvalidValue");
        Assert.Contains(result.Errors, error => error.Path.EndsWith("navigationObstacles[2]") && error.Code == "InvalidValue");
        Assert.Contains(result.Errors, error => error.Path.EndsWith("audio.cues.private"));
    }

    [Fact]
    public void AuthoredProgress_RequiresTheCraftRevealDeductionAndTwoDetectiveConsensus()
    {
        var gameCase = Load();
        var scenes = gameCase.Stages[0].Scenes;
        var state = new GameplayState { CurrentSceneId = scenes[0].SceneId };
        state.VisitedSceneIds.Add(scenes[0].SceneId);
        state.UnlockedSceneIds.Add(scenes[0].SceneId);
        state.InspectedItemIds.AddRange(scenes[0].ItemIds);
        state.AskedDialogueIds.Add("dlg-mara-account-en");
        state.UnlockedClueIds.AddRange(gameCase.Items.SelectMany(item => item.UnlockClueIds));
        GameRules.AutoCompleteProgress(gameCase, state);
        Assert.DoesNotContain(scenes[1].SceneId, state.UnlockedSceneIds);

        var combine = gameCase.Interactions.Single(interaction => interaction.Type == "COMBINE_ITEMS");
        state.UnlockedClueIds.AddRange(combine.UnlockClueIds);
        state.CollectedItemIds.AddRange(combine.UnlockItemIds);
        GameRules.AutoCompleteProgress(gameCase, state);
        Assert.Contains(scenes[1].SceneId, state.UnlockedSceneIds);
        state.CurrentSceneId = scenes[1].SceneId;
        state.VisitedSceneIds.Add(scenes[1].SceneId);
        state.UnlockedClueIds.AddRange(gameCase.Interactions.Single(interaction => interaction.Type == "USE_ITEM_ON_TARGET").UnlockClueIds);
        var puzzle = Assert.Single(gameCase.Puzzles);
        state.SolvedPuzzleIds.Add(puzzle.PuzzleId);
        state.UnlockedClueIds.AddRange(puzzle.UnlockClueIds);
        state.AskedDialogueIds.Add("dlg-samuel-watch-en");
        GameRules.AutoCompleteProgress(gameCase, state);
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state));

        var crack = Assert.Single(gameCase.EvidenceChallenges);
        var now = new DateTime(2026, 9, 30, 0, 0, 0, DateTimeKind.Utc);
        PairedConfrontationRules.Start(state, "crack", crack.ChallengeId, crack.TestimonyFragmentId, "int", PlayerRole.Interrogator, now);
        PairedConfrontationRules.ProposeEvidence(state, "crack", crack.CorrectEvidenceId, "inv", PlayerRole.Investigator, 1, now);
        PairedConfrontationRules.Confirm(state, "crack", "inv", PlayerRole.Investigator, 2, true, crack.UnlockClueIds, now);
        Assert.Empty(state.ResolvedConfrontationRecords);
        Assert.DoesNotContain(crack.UnlockClueIds.Single(), state.UnlockedClueIds);
        PairedConfrontationRules.Confirm(state, "crack", "int", PlayerRole.Interrogator, 2, true, crack.UnlockClueIds, now);
        GameRules.AutoCompleteProgress(gameCase, state);
        Assert.True(GameRules.AllScenesCompleted(gameCase, state));
        Assert.False(GameRules.IsAccusationAvailable(gameCase, state));
        var deduction = Assert.Single(gameCase.Deductions);
        state.SolvedDeductionRecords.Add(new SolvedDeductionRecord { DeductionId = deduction.DeductionId, SelectedOptionId = deduction.CorrectOptionId });
        Assert.True(GameRules.IsAccusationAvailable(gameCase, state));
        Assert.True(AccusationConsensusRules.RequiresConsensus(gameCase, null));
        var content = new AccusationProposalContent(gameCase.FinalLogic.CulpritId, gameCase.FinalLogic.CorrectMotiveId,
            gameCase.FinalLogic.CorrectMethodId, Array.Empty<string>(), gameCase.FinalLogic.RequiredEvidenceLinks
                .Select(link => new SelectedEvidenceLink { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId }).ToArray());
        var proposed = AccusationConsensusRules.Propose(gameCase, state, "final", "inv", PlayerRole.Investigator,
            scenes[1].SceneId, content, new[] { "inv", "int" }, now);
        Assert.False(proposed.ShouldResolve);
        var confirmed = AccusationConsensusRules.Confirm(state, "final", "int", PlayerRole.Interrogator, 1, new[] { "inv", "int" }, now);
        Assert.True(confirmed.ShouldResolve);
    }

    [Theory]
    [InlineData("en")]
    [InlineData("vi")]
    public void AuthoredObjectives_KeepInvestigationCompletionAndFinalGatesInTheCaseLanguage(string language)
    {
        var gameCase = Load(language);
        var scenes = gameCase.Stages[0].Scenes;
        var state = new GameplayState { CurrentSceneId = scenes[0].SceneId };
        var unlocked = new HashSet<string>();
        var missing = CompleteConditionProgress.Evaluate(scenes[0].CompleteCondition, new HashSet<string>(), unlocked, new HashSet<string>());
        var objective = GameStateBuilder.BuildObjective(gameCase, state, scenes[0], missing, unlocked);
        Assert.Contains(language == "vi" ? "khám xét thêm 4 vật chứng" : "examine 4 more piece(s) of physical evidence", objective);

        var complete = CompleteConditionProgress.Evaluate(scenes[0].CompleteCondition,
            scenes[0].ItemIds.ToHashSet(), scenes[0].CompleteCondition.RequiredClueIds.ToHashSet(),
            scenes[0].CompleteCondition.RequiredDialogueIds.ToHashSet());
        objective = GameStateBuilder.BuildObjective(gameCase, state, scenes[0], complete, unlocked);
        Assert.Contains(language == "vi" ? "Tiếp tục điều tra khi cả hai đã sẵn sàng." : "Continue the investigation when both of you are ready.", objective);
        Assert.Contains(scenes[0].Title, objective);

        state.CompletedSceneIds.AddRange(scenes.Select(scene => scene.SceneId));
        state.CurrentSceneId = scenes[1].SceneId;
        state.UnlockedClueIds.AddRange(gameCase.Clues.Select(clue => clue.ClueId));
        unlocked = state.UnlockedClueIds.ToHashSet();
        objective = GameStateBuilder.BuildObjective(gameCase, state, scenes[1], complete, unlocked);
        Assert.Contains(language == "vi" ? "cùng đồng đội vạch trần thêm 1 mâu thuẫn" : "crack 1 more contradiction(s) with your partner", objective);
        Assert.Contains(language == "vi" ? "giải thêm 1 suy luận" : "solve 1 more deduction(s)", objective);

        state.ResolvedConfrontationRecords.Add(new ResolvedConfrontationRecord { ChallengeId = gameCase.EvidenceChallenges[0].ChallengeId });
        state.SolvedDeductionRecords.Add(new SolvedDeductionRecord { DeductionId = gameCase.Deductions[0].DeductionId });
        objective = GameStateBuilder.BuildObjective(gameCase, state, scenes[1], complete, unlocked);
        Assert.Equal(language == "vi" ? "Đã có đủ chứng cứ. Hãy cùng đồng đội thống nhất lời buộc tội cuối cùng."
            : "All the evidence is on the table. Confront the suspects and make the final accusation.", objective);
    }
}
