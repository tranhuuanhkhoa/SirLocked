using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.PuzzleKinds;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;
using Xunit.Abstractions;

namespace SirLocked.Tests;

public sealed class ClaudeBridgeTests(ITestOutputHelper output)
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private const string SampleFile = "case-pixel-dong-ho-dem-mua-vi.json";

    private static GameCase LoadFixture() => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", SampleFile)), Web)!;

    private static GameCase LoadSeed(string relative) => JsonSerializer.Deserialize<GameCase>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", relative)), Web)!;

    public static IEnumerable<object[]> SeedFiles() =>
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "SeedData"), "*.json", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}Cutscenes{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(Path.Combine(AppContext.BaseDirectory, "SeedData"), path))
            .Order(StringComparer.Ordinal)
            .Select(path => new object[] { path });

    // ---------------------------------------------------------------- schema check on submit

    private static readonly string Schema = new JsonObject
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["title"] = new JsonObject { ["type"] = "string", ["minLength"] = 1 },
            ["scenes"] = new JsonObject
            {
                ["type"] = "array",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject { ["count"] = new JsonObject { ["type"] = "integer" } },
                    ["required"] = new JsonArray("count"),
                    ["additionalProperties"] = false
                }
            }
        },
        ["required"] = new JsonArray("title", "scenes"),
        ["additionalProperties"] = false
    }.ToJsonString();

    [Fact]
    public void SchemaCheck_AcceptsAValidAnswer_IncludingOneWrappedInAMarkdownFence()
    {
        Assert.Empty(AiBridgeSchemaValidator.Validate(Schema, """{"title":"A","scenes":[{"count":2}]}"""));
        Assert.Empty(AiBridgeSchemaValidator.Validate(Schema, "```json\n{\"title\":\"A\",\"scenes\":[]}\n```"));
    }

    [Fact]
    public void SchemaCheck_RejectsWrongShapes_WithTheFieldPathAndReason()
    {
        var errors = AiBridgeSchemaValidator.Validate(Schema, """{"scenes":[{"count":"two","extra":1}],"unknown":true}""");
        Assert.Contains(errors, error => error.StartsWith("$.scenes[0].count:", StringComparison.Ordinal));
        Assert.Contains(errors, error => error.StartsWith("$:", StringComparison.Ordinal) && error.Contains("title"));
        Assert.All(errors, error => Assert.Contains(": ", error));
        Assert.Equal(["$: the answer is not valid JSON"], AiBridgeSchemaValidator.Validate(Schema, "{not json")
            .Select(error => error[..error.IndexOf(" (", StringComparison.Ordinal)]));
        Assert.Equal(["$: the answer must be exactly one JSON object"], AiBridgeSchemaValidator.Validate(Schema, "[1,2]"));
    }

    [Fact]
    public void SchemaCheck_UsesTheRealStepSchemas()
    {
        var schema = AiStrictSchemaProvider.StoryPreviewSchema().ToJsonString();
        var mock = AiCaseMockFactory.MockJsonResponse("CreateStoryPreview", AiGenerationSchemaVersions.StoryPreview);
        Assert.Empty(AiBridgeSchemaValidator.Validate(schema, mock));
        var broken = JsonNode.Parse(mock)!.AsObject();
        broken.Remove("title");
        broken["estimatedScenes"] = "four";
        var errors = AiBridgeSchemaValidator.Validate(schema, broken.ToJsonString());
        Assert.Contains(errors, error => error.Contains("title"));
        Assert.Contains(errors, error => error.StartsWith("$.estimatedScenes:", StringComparison.Ordinal));
    }

    [Fact]
    public void PromptHash_IgnoresVolatileTimestamps_ButNotContent()
    {
        var first = """{"title":"x","createdAt":"2026-11-16T10:00:00.1234567Z","updatedAt":"2026-11-16T10:00:00Z"}""";
        var replay = """{"title":"x","createdAt":"2026-11-16T10:05:09.9999999Z","updatedAt":"2026-11-16T10:05:09Z"}""";
        Assert.Equal(AiBridgeSchemaValidator.PromptSha256(first), AiBridgeSchemaValidator.PromptSha256(replay));
        Assert.NotEqual(AiBridgeSchemaValidator.PromptSha256(first), AiBridgeSchemaValidator.PromptSha256(first.Replace("\"x\"", "\"y\"")));
    }

    // ---------------------------------------------------------------- request keys and mock mode

    [Fact]
    public void RequestKey_IsDeterministic_AndSeparatesEveryPart()
    {
        var request = new AiTextRequest { OwnerId = "draft", GenerationRunId = "run", Step = "Step", AttemptNumber = 1 };
        var key = ClaudeBridgeTextProvider.BuildRequestKey(request, 0);
        Assert.Equal(key, ClaudeBridgeTextProvider.BuildRequestKey(request with { }, 0));
        Assert.NotEqual(key, ClaudeBridgeTextProvider.BuildRequestKey(request, 1));
        Assert.NotEqual(key, ClaudeBridgeTextProvider.BuildRequestKey(request with { AttemptNumber = 2 }, 0));
        Assert.NotEqual(key, ClaudeBridgeTextProvider.BuildRequestKey(request with { GenerationRunId = "other" }, 0));
        Assert.NotEqual(key, ClaudeBridgeTextProvider.BuildRequestKey(request with { OwnerType = AiBridgeOwnerTypes.Cutscene }, 0));
        Assert.Equal(64, key.Length);
    }

    [Fact]
    public async Task MockMode_AnswersWithTheMock_WithoutTouchingTheQueue()
    {
        // Null store and database: any queue access would throw.
        var provider = new ClaudeBridgeTextProvider(null!, null!, Options.Create(new AiGenerationSettings { MockAiResponses = true }),
            Options.Create(new BridgeSettings()), new TestHost(), NullLogger<ClaudeBridgeTextProvider>.Instance);
        Assert.Equal("{\"mock\":1}", await provider.GenerateJsonAsync(new AiTextRequest
        {
            OwnerId = "draft", GenerationRunId = "run", Step = "Anything", MockResponseFactory = () => "{\"mock\":1}"
        }));
        var preview = await provider.GenerateJsonAsync(new AiTextRequest
        {
            OwnerId = "draft", GenerationRunId = "run", Step = "CreateStoryPreview", SchemaVersion = AiGenerationSchemaVersions.StoryPreview
        });
        Assert.Contains("Mock Clocktower Case", preview);
    }

    private sealed class TestHost : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "SirLocked.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    // ---------------------------------------------------------------- bridge key

    [Fact]
    public void BridgeKey_ComparesWholeKeysOnly()
    {
        const string key = "bridge-key-0123456789abcdef0123456789abcdef";
        Assert.True(BridgeKeyAttribute.KeysMatch(key, key));
        Assert.True(BridgeKeyAttribute.KeysMatch($" {key} ", key));
        Assert.False(BridgeKeyAttribute.KeysMatch(key[..^1], key));
        Assert.False(BridgeKeyAttribute.KeysMatch(key + "x", key));
        Assert.False(BridgeKeyAttribute.KeysMatch(string.Empty, key));
        Assert.False(new BridgeSettings { Key = "too-short" }.IsConfigured);
        Assert.True(new BridgeSettings { Key = key }.IsConfigured);
    }

    [Fact]
    public void BridgeController_IsAnonymousForJwt_AndGuardedOnlyByTheKey()
    {
        var type = typeof(BridgeController);
        Assert.NotEmpty(type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true));
        Assert.NotEmpty(type.GetCustomAttributes(typeof(BridgeKeyAttribute), true));
        // There is no publish route on the bridge.
        Assert.DoesNotContain(type.GetMethods(), method => method.Name.Contains("Publish", StringComparison.OrdinalIgnoreCase));
    }

    // ---------------------------------------------------------------- player view

    public static IEnumerable<object[]> PixelCases() =>
        new[] { "V3/case-pixel-tram-hong-ngoc-vi.json", "V3/case-pixel-lo-thuoc-thu-nam-vi.json" }.Select(file => new object[] { file });

    [Theory, MemberData(nameof(PixelCases))]
    public void PlayerView_HasNoSolutionField_AnywhereInTheTree(string file)
    {
        var gameCase = LoadSeed(file);
        var view = AiPlayerViewBuilder.Build(gameCase);
        var names = new List<string>();
        var strings = new List<string>();
        Walk(view, names, strings);
        Assert.NotEmpty(names);
        foreach (var name in names)
            Assert.DoesNotContain(name, AiPlayerViewBuilder.ForbiddenPropertyNames);
        var text = string.Join("\n", strings);

        // Values only the solution holds never appear: motive/method statements, endings, puzzle solutions and reveals.
        var secrets = new List<string>
        {
            gameCase.FinalLogic.Motive, gameCase.FinalLogic.Method, gameCase.FinalLogic.WinEnding, gameCase.FinalLogic.FailEnding
        };
        secrets.AddRange(gameCase.EvidenceChallenges.SelectMany(challenge => new[] { challenge.SuccessResponse, challenge.RevealTitle }));
        secrets.AddRange(gameCase.Deductions.Select(deduction => deduction.SuccessResponse));
        secrets.AddRange(gameCase.Clues.Select(clue => clue.NarrativeMeaning));
        foreach (var secret in secrets.Where(value => !string.IsNullOrWhiteSpace(value) && value.Length >= 12))
            Assert.DoesNotContain(secret, text);
        foreach (var puzzle in gameCase.Puzzles)
        {
            foreach (var value in SolutionValues(puzzle))
                Assert.DoesNotContain(value, strings);
        }
        Assert.DoesNotContain(gameCase.FinalLogic.CorrectMotiveId, names);
        Assert.Equal(gameCase.Characters.Count, view["finalAccusationForm"]!["suspects"]!.AsArray().Count);
    }

    private static IEnumerable<string> SolutionValues(CasePuzzle puzzle)
    {
        if (!string.IsNullOrWhiteSpace(puzzle.CorrectCode) && puzzle.CorrectCode.Length >= 3) yield return puzzle.CorrectCode;
        if (string.IsNullOrWhiteSpace(puzzle.SolutionJson)) yield break;
        var strings = new List<string>();
        Walk(JsonNode.Parse(puzzle.SolutionJson), new List<string>(), strings);
        foreach (var value in strings.Where(value => value.Length >= 6)) yield return value;
    }

    private static void Walk(JsonNode? node, List<string> names, List<string> strings)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var (name, child) in obj)
                {
                    names.Add(name);
                    Walk(child, names, strings);
                }
                break;
            case JsonArray array:
                foreach (var child in array) Walk(child, names, strings);
                break;
            case JsonValue value when value.TryGetValue<string>(out var text):
                strings.Add(text);
                break;
        }
    }

    // ---------------------------------------------------------------- new optional fields (D4)

    [Fact]
    public void SampleCase_IsValid_AndKeepsEveryNewField()
    {
        var gameCase = LoadFixture();
        var validation = new CaseValidationService().Validate(gameCase);
        Assert.True(validation.IsValid, string.Join("\n", validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}")));

        Assert.All(gameCase.Characters, character => Assert.NotNull(character.Voice?.Blip));
        var harbor = gameCase.Stages.SelectMany(stage => stage.Scenes).Single(scene => scene.SceneId == "scene-dh-ben-cang");
        Assert.Equal(("RAIN", 0.7, false, "NIGHT"), (harbor.Runtime!.Weather!.Type, harbor.Runtime.Weather.Intensity, harbor.Runtime.Indoor, harbor.Runtime.TimeOfDay));
        Assert.Equal("/assets/audio/music/hang-duong/ben-cang-dem-mua.ogg", harbor.Runtime.Audio!.Music!.Url);
        Assert.Equal(50.526327, harbor.Runtime.Audio.Music.LoopEndSec);
    }

    [Fact]
    public void NewFields_SurviveMongoStorage_AndReachTheGameApis()
    {
        var gameCase = LoadFixture();
        gameCase.Id = ObjectId.GenerateNewId().ToString();
        // Mongo stores the case as BSON: the round trip must keep every nested field.
        var stored = BsonSerializer.Deserialize<GameCase>(gameCase.ToBsonDocument());
        var shop = stored.Stages.SelectMany(stage => stage.Scenes).Single(scene => scene.SceneId == "scene-dh-tiem-dong-ho");
        Assert.True(shop.Runtime!.Indoor);
        Assert.Equal("NONE", shop.Runtime.Weather!.Type);
        Assert.Equal("Music Box: Cute Tune", shop.Runtime.Audio!.Music!.Title);
        Assert.Equal(170, stored.Characters.Single(character => character.CharacterId == "char-dh-ong-tu").Voice!.Blip!.Pitch);

        // Case detail served to players (characters with their voice).
        var detail = CasePublicDetailResponse.FromCase(stored);
        var voiced = JsonSerializer.Serialize(detail, Web);
        Assert.Contains("\"voice\":{\"blip\":{\"pitch\":520", voiced);

        // The V3 scene projection the game receives clones the runtime through a whitelist.
        foreach (var scene in stored.Stages.SelectMany(stage => stage.Scenes))
        {
            foreach (var role in new[] { PlayerRole.Investigator, PlayerRole.Interrogator })
            {
                var response = new GameStateResponse { VisibleScene = new VisibleSceneDto { Runtime = scene.Runtime } };
                V3SceneProjectionPolicy.Apply(response, stored, new RoomPlayer { UserId = "p", Role = role });
                var runtime = response.VisibleScene.Runtime!;
                Assert.Equal(scene.Runtime!.Weather!.Type, runtime.Weather!.Type);
                Assert.Equal(scene.Runtime.Weather.Intensity, runtime.Weather.Intensity);
                Assert.Equal(scene.Runtime.Indoor, runtime.Indoor);
                Assert.Equal(scene.Runtime.TimeOfDay, runtime.TimeOfDay);
                Assert.Equal(scene.Runtime.Audio!.Music!.Url, runtime.Audio!.Music!.Url);
                Assert.Equal(scene.Runtime.Audio.Music.FallbackUrl, runtime.Audio.Music.FallbackUrl);
                Assert.Equal(scene.Runtime.Audio.Music.Volume, runtime.Audio.Music.Volume);
            }
        }
    }

    [Fact]
    public void IndoorSceneWithWeather_AndOutOfRangeValues_AreReported()
    {
        var gameCase = LoadFixture();
        var shop = gameCase.Stages.SelectMany(stage => stage.Scenes).Single(scene => scene.SceneId == "scene-dh-tiem-dong-ho");
        shop.Runtime!.Weather = new SceneWeather { Type = "RAIN", Intensity = 0.5 };
        var character = gameCase.Characters[0];
        character.Voice!.Blip!.Pitch = 50;
        character.Voice.Blip.Speed = 41;
        character.Voice.Blip.Wave = "noise";
        character.Voice.Blip.Variance = 1.5;
        var harbor = gameCase.Stages.SelectMany(stage => stage.Scenes).Single(scene => scene.SceneId == "scene-dh-ben-cang");
        harbor.Runtime!.Weather!.Intensity = 2;
        harbor.Runtime.TimeOfDay = "MIDNIGHT";
        harbor.Runtime.Audio!.Music!.Url = "http://example.com/a.ogg";
        harbor.Runtime.Audio.Music.FallbackUrl = "/assets/../secret.mp3";
        harbor.Runtime.Audio.Music.Volume = -0.1;

        var errors = new CaseValidationService().Validate(gameCase).Errors;
        Assert.Contains(errors, error => error.Code == "IndoorWeather");
        foreach (var path in new[] { "voice.blip.pitch", "voice.blip.speed", "voice.blip.wave", "voice.blip.variance",
                     "weather.intensity", "timeOfDay", "audio.music.url", "audio.music.fallbackUrl", "audio.music.volume" })
            Assert.Contains(errors, error => error.Path.EndsWith(path, StringComparison.Ordinal));

        shop.Runtime.Weather = new SceneWeather { Type = "NONE", Intensity = 0 };
        Assert.DoesNotContain(new CaseValidationService().Validate(gameCase).Errors, error => error.Code == "IndoorWeather");
        shop.Runtime.Weather = null;
        Assert.DoesNotContain(new CaseValidationService().Validate(gameCase).Errors, error => error.Code == "IndoorWeather");
    }

    [Theory, MemberData(nameof(SeedFiles))]
    public void SeedCases_WithoutTheNewFields_GetNoNewErrors(string file)
    {
        var errors = new CaseValidationService().Validate(LoadSeed(file)).Errors;
        Assert.DoesNotContain(errors, error => error.Code == "IndoorWeather"
            || error.Path.Contains(".voice.", StringComparison.Ordinal)
            || error.Path.Contains(".weather", StringComparison.Ordinal)
            || error.Path.Contains(".timeOfDay", StringComparison.Ordinal)
            || error.Path.Contains(".audio.music", StringComparison.Ordinal));
    }

    [Fact]
    public void AiContracts_OfferTheNewFieldsAsOptional_AndKeepTheRuntimeServerOwned()
    {
        var logic = AiStrictSchemaProvider.CaseLogicSchema();
        var character = logic["properties"]!["characters"]!["items"]!.AsObject();
        Assert.NotNull(character["properties"]!["voice"]);
        Assert.DoesNotContain("voice", character["required"]!.AsArray().Select(item => item!.GetValue<string>()));
        var scene = logic["properties"]!["stages"]!["items"]!["properties"]!["scenes"]!["items"]!.AsObject();
        Assert.NotNull(scene["properties"]!["atmosphere"]);
        Assert.Null(scene["properties"]!["runtime"]);
        Assert.Empty(AiStrictSchemaLinter.Validate(logic));

        // The writer's "atmosphere" lands in the scene runtime.
        var parsed = JsonSerializer.Deserialize<CaseScene>(
            """{"sceneId":"s","atmosphere":{"weather":{"type":"SNOW","intensity":0.4},"indoor":false,"timeOfDay":"DUSK","audio":{"music":{"url":"/assets/a.ogg","title":"t","source":"s","license":"CC0","volume":0.5}}}}""",
            Web)!;
        Assert.Equal(("SNOW", false, "DUSK", "/assets/a.ogg"),
            (parsed.Runtime!.Weather!.Type, parsed.Runtime.Indoor, parsed.Runtime.TimeOfDay, parsed.Runtime.Audio!.Music!.Url));
        Assert.DoesNotContain("atmosphere", JsonSerializer.Serialize(parsed, Web));
    }

    [Fact]
    public void LayoutReset_KeepsTheWritersAtmosphere()
    {
        var harbor = LoadFixture().Stages.SelectMany(stage => stage.Scenes).Single(scene => scene.SceneId == "scene-dh-ben-cang");
        var kept = CaseAtmosphere.KeepOnlyAtmosphere(harbor.Runtime)!;
        Assert.Equal("RAIN", kept.Weather!.Type);
        Assert.NotNull(kept.Audio!.Music);
        Assert.Empty(kept.ItemPlacements);
        Assert.Null(kept.Render);
        Assert.Null(CaseAtmosphere.KeepOnlyAtmosphere(new SceneRuntime()));
    }

    // ---------------------------------------------------------------- D5: validator never throws on seed data

    [Theory, MemberData(nameof(SeedFiles))]
    public void Validator_NeverThrows_OnAnySeedCase(string file)
    {
        var gameCase = LoadSeed(file);
        var exception = Record.Exception(() => new CaseValidationService().Validate(gameCase));
        Assert.Null(exception);
        var errors = new CaseValidationService().Validate(gameCase).Errors;
        output.WriteLine($"{file}: {errors.Count} error(s)");
        foreach (var error in errors.Take(40)) output.WriteLine($"  {error.Code} {error.Path}: {error.Message}");
    }

    [Fact]
    public void MusicBox_WithoutBeatsOrMelody_ReportsErrorsInsteadOfThrowing()
    {
        var puzzle = new CasePuzzle
        {
            PuzzleId = "puzzle-music", Type = CasePuzzleTypes.InteractivePuzzle, Kind = "music_box",
            ParamsJson = "{}", SolutionJson = "{}"
        };
        var errors = new List<string>();
        var exception = Record.Exception(() => PuzzleKindRegistry.Validate(puzzle, "puzzles[0]", (path, message, _) => errors.Add($"{path}: {message}")));
        Assert.Null(exception);
        Assert.Contains(errors, error => error.Contains("params.beats"));
    }

    [Fact]
    public void EveryPuzzleKind_WithEmptyParameters_ReportsErrorsInsteadOfThrowing()
    {
        foreach (var kind in PuzzleKindRegistry.KnownKinds)
        {
            var puzzle = new CasePuzzle
            {
                PuzzleId = "p", Type = CasePuzzleTypes.InteractivePuzzle, Kind = kind, ParamsJson = "{}", SolutionJson = "{}"
            };
            var exception = Record.Exception(() => PuzzleKindRegistry.Validate(puzzle, "puzzles[0]", (_, _, _) => { }));
            Assert.Null(exception);
        }
    }

    // ---------------------------------------------------------------- orders

    [Fact]
    public void Order_DefaultsAndNormalization_AndVipLimits()
    {
        var defaults = AiCaseOrderPolicy.Normalize(null, UserRole.Admin);
        Assert.Equal((AiCaseWorlds.HangDuongVictorian, 4, "AUTO", "AUTO", 30, "STANDARD", 60, "FULL"),
            (defaults.World, defaults.SuspectCount, defaults.Weather, defaults.TimeOfDay, defaults.PlayMinutes,
                defaults.ContentLevel, defaults.PixelLabCap, defaults.ReviewMode));

        var admin = AiCaseOrderPolicy.Normalize(new AiCaseOrder
        {
            World = "shanghai_1930", ReviewMode = "fast", PixelLabCap = 0, LocationIds = ["a", "a", " b "], Weather = "storm"
        }, UserRole.Admin);
        Assert.Equal((AiCaseWorlds.Shanghai1930, "FAST", 0, "STORM"), (admin.World, admin.ReviewMode, admin.PixelLabCap, admin.Weather));
        Assert.Equal(["a", "b"], admin.LocationIds);

        var vip = AiCaseOrderPolicy.Normalize(new AiCaseOrder { ReviewMode = "FAST", PixelLabCap = 100 }, UserRole.Vip);
        Assert.Equal(("FULL", 30), (vip.ReviewMode, vip.PixelLabCap));

        // Every refusal names the field at fault, so the order form can show it next to that field.
        foreach (var (invalid, field) in new (AiCaseOrder, string)[]
                 {
                     (new AiCaseOrder { SuspectCount = 2 }, "order.suspectCount"), (new AiCaseOrder { SuspectCount = 7 }, "order.suspectCount"),
                     (new AiCaseOrder { PlayMinutes = 25 }, "order.playMinutes"), (new AiCaseOrder { PixelLabCap = 50 }, "order.pixelLabCap"),
                     (new AiCaseOrder { World = "MARS" }, "order.world"), (new AiCaseOrder { Weather = "FOG" }, "order.weather"),
                     (new AiCaseOrder { CharacterNotes = new string('x', 601) }, "order.characterNotes"),
                     (new AiCaseOrder { LocationIds = ["has space"] }, "order.locationIds"),
                     (new AiCaseOrder { SuspectCount = 3, NpcIds = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"] }, "order.npcIds")
                 })
        {
            var error = Assert.Throws<ApiException>(() => AiCaseOrderPolicy.Normalize(invalid, UserRole.Admin));
            var details = Assert.IsType<ApiErrorDetails>(error.Errors);
            Assert.Equal(("AI_ORDER_INVALID", field), (details.Code, details.Field));
        }

        // Suspects plus three side characters is the most an order may name.
        var cast = AiCaseOrderPolicy.Normalize(new AiCaseOrder { SuspectCount = 3, NpcIds = ["n1", "n2", "n3", "n4", "n5", "n6"] }, UserRole.Admin);
        Assert.Equal(6, cast.NpcIds.Count);
    }

    [Fact]
    public void ErrorDetails_WriteTheFieldOnlyWhenAnErrorIsAboutOne()
    {
        var plain = System.Text.Json.JsonSerializer.Serialize<object>(new ApiErrorDetails("X", "x.key"),
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        Assert.Equal("{\"code\":\"X\",\"messageKey\":\"x.key\"}", plain);
        var withField = System.Text.Json.JsonSerializer.Serialize<object>(new ApiErrorDetails("X", "x.key") { Field = "order.world" },
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        Assert.Equal("{\"code\":\"X\",\"messageKey\":\"x.key\",\"field\":\"order.world\"}", withField);
    }

    [Fact]
    public void OrderPromptBlock_IsExplicit_AndAbsentForLegacyDrafts()
    {
        Assert.Equal(string.Empty, AiCaseOrderPolicy.BuildPromptBlock(null));
        var block = AiCaseOrderPolicy.BuildPromptBlock(new AiCaseOrder
        {
            World = AiCaseWorlds.TaishoJapan, LocationIds = ["map-pho-den-long"], SuspectCount = 5, Weather = "RAIN",
            TimeOfDay = "NIGHT", PlayMinutes = 45, ContentLevel = "LIGHT", PixelLabCap = 0
        });
        foreach (var expected in new[] { "CREATOR ORDER", "TAISHO_JAPAN", "map-pho-den-long", "exactly 5", "RAIN", "NIGHT", "45 minutes", "LIGHT", "library pictures" })
            Assert.Contains(expected, block);
    }

    [Theory]
    [InlineData(AiCaseWorlds.TaishoJapan)]
    [InlineData(AiCaseWorlds.Shanghai1930)]
    [InlineData(AiCaseWorlds.HangDuongVictorian)]
    public void StoryDiversity_OnlyDrawsSettingsOfTheChosenWorld(string world)
    {
        var allowed = AiStoryDiversityPolicy.WorldSettings[world];
        for (var seed = 0; seed < 60; seed++)
        {
            var profile = AiStoryDiversityPolicy.CreateDistinct(AiCaseTypes.Random, $"seed-{seed}", [], world);
            Assert.Contains(profile.SettingArchetype, allowed);
            Assert.Contains(profile.EraFlavor, AiStoryDiversityPolicy.WorldEras[world]);
        }
    }

    [Fact]
    public void OrderStatus_FollowsTheWorkflow()
    {
        var draft = new AiCaseDraft { Status = AiDraftStatus.GeneratingStory, QueueState = AiQueueStates.AwaitingClaude };
        Assert.Equal(AiOrderStatuses.QueuedForClaude, AiCaseOrderPolicy.Derive(draft, claudeHasRequestInHand: false));
        Assert.Equal(AiOrderStatuses.ClaudeWorking, AiCaseOrderPolicy.Derive(draft, claudeHasRequestInHand: true));
        draft.QueueState = AiQueueStates.None;
        draft.Status = AiDraftStatus.CaseTruthAwaitingApproval;
        Assert.Equal(AiOrderStatuses.AwaitingGate, AiCaseOrderPolicy.Derive(draft, false));
        draft.Status = AiDraftStatus.ReadyToPublish;
        Assert.Equal(AiOrderStatuses.Submitted, AiCaseOrderPolicy.Derive(draft, false));
        draft.OrderStatus = AiOrderStatuses.AwaitingOwnerApproval;
        Assert.Equal(AiOrderStatuses.AwaitingOwnerApproval, AiCaseOrderPolicy.Derive(draft, true));
    }

    // ---------------------------------------------------------------- uploads

    [Fact]
    public void ImageUpload_AcceptsRealPngAndWebp_KeepsAlpha_AndRejectsEverythingElse()
    {
        var png = Image(transparent: true, webp: false);
        var info = BridgeAssetStorage.Inspect(png, 5 * 1024 * 1024);
        Assert.Equal(("image/png", 32, 16, true), (info.ContentType, info.Width, info.Height, info.HasAlpha));
        var webp = Image(transparent: false, webp: true);
        Assert.Equal("image/webp", BridgeAssetStorage.Inspect(webp, 5 * 1024 * 1024).ContentType);

        Assert.Equal("ASSET_TOO_LARGE", Code(() => BridgeAssetStorage.Inspect(png, png.Length - 1)));
        Assert.Equal("ASSET_FORMAT_UNSUPPORTED", Code(() => BridgeAssetStorage.Inspect("GIF89a-not-allowed"u8.ToArray(), 1024)));
        var renamed = png.ToArray();
        renamed[20] ^= 0xFF; // a PNG signature on a broken body
        Assert.Equal("ASSET_INVALID_IMAGE", Code(() => BridgeAssetStorage.Inspect(renamed[..30], 1024)));
        Assert.Equal("ASSET_EMPTY", Code(() => BridgeAssetStorage.Inspect([], 1024)));
    }

    private static string Code(Action action) =>
        Assert.IsType<ApiErrorDetails>(Assert.Throws<ApiException>(action).Errors).Code;

    internal static byte[] Image(bool transparent, bool webp, int width = 32, int height = 16)
    {
        using var image = new SixLabors.ImageSharp.Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(width, height);
        image.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y++)
            {
                var row = rows.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                    row[x] = new SixLabors.ImageSharp.PixelFormats.Rgba32((byte)(x * 7), (byte)(y * 13), 90, transparent && x < 4 ? (byte)0 : (byte)255);
            }
        });
        using var stream = new MemoryStream();
        if (webp) SixLabors.ImageSharp.ImageExtensions.SaveAsWebp(image, stream);
        else SixLabors.ImageSharp.ImageExtensions.SaveAsPng(image, stream);
        return stream.ToArray();
    }
}
