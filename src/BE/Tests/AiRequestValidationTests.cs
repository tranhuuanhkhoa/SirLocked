using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class AiRequestValidationTests
{
    [Fact]
    public void EmptyPrompt_IsAllowed()
    {
        var request = new GenerateAiCaseRequest
        {
            Prompt = string.Empty,
            StageCount = 4,
            Difficulty = "medium"
        };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.True(valid, string.Join(Environment.NewLine, results.Select(result => result.ErrorMessage)));
    }

    [Fact]
    public void VisualStyle_DefaultsToFixedSirLockedTheme()
    {
        var request = new GenerateAiCaseRequest();
        var settings = new AiDraftSettings();

        Assert.Equal(AiVisualStyleDefaults.PixelDetectiveTheme, request.VisualStyle);
        Assert.Equal(AiVisualStyleDefaults.PixelDetectiveTheme, settings.VisualStyle);
        Assert.Contains("pixel-art", AiVisualStyleDefaults.PixelArtContract, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void GenerationPreset_DefaultsAndNormalizes()
    {
        var request = new GenerateAiCaseRequest();
        var settings = new AiDraftSettings();

        Assert.Equal(AiGenerationPresets.NormalRandom, request.GenerationPreset);
        Assert.Equal(AiGenerationPresets.NormalRandom, settings.GenerationPreset);
        Assert.Equal(AiGenerationPresets.FullFeature, AiGenerationPresets.Normalize("full_feature"));
        Assert.Equal(AiGenerationPresets.NormalRandom, AiGenerationPresets.Normalize("unknown"));
        Assert.Equal(CaseGenerationModes.CameraEmbedded, settings.GenerationMode);
    }

    [Theory]
    [InlineData("en", "en")]
    [InlineData("EN", "en")]
    [InlineData("vi", "vi")]
    [InlineData("VI", "vi")]
    [InlineData("unknown", "en")]
    [InlineData(null, "en")]
    public void Language_NormalizesWithEnglishFallback(string? input, string expected)
    {
        Assert.Equal(expected, CaseLanguages.Normalize(input));
    }

    [Fact]
    public void GenerateRequest_RejectsUnsupportedLanguage()
    {
        var request = new GenerateAiCaseRequest { Language = "fr" };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.False(valid);
        Assert.Contains(results, result => result.MemberNames.Contains(nameof(GenerateAiCaseRequest.Language)));
    }

    [Fact]
    public void GameCase_JsonUsesExactSnakeCasePixelProfile()
    {
        var json = JsonSerializer.Serialize(new GameCase(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.Equal("en", root.GetProperty("language").GetString());
        Assert.Equal("pixel_art", root.GetProperty("art_style").GetString());
        Assert.Equal("high_detail_pixel", root.GetProperty("sub_style").GetString());
        Assert.Equal("chibi", root.GetProperty("character_style").GetString());
        Assert.False(root.TryGetProperty("artStyle", out _));
        Assert.False(root.TryGetProperty("subStyle", out _));
        Assert.False(root.TryGetProperty("characterStyle", out _));
    }

    [Fact]
    public void CharacterPrompt_UsesUnifiedPixelChibiContract()
    {
        var prompt = AiCaseService.BuildCharacterMasterSpritePrompt(new CaseCharacter
        {
            CharacterId = "char-test",
            Name = "Test",
            Role = "Witness",
            VisualDescription = "A short middle-aged witness with silver hair and a navy coat."
        });

        Assert.Contains("pixel_art", prompt, StringComparison.Ordinal);
        Assert.Contains("high_detail_pixel", prompt, StringComparison.Ordinal);
        Assert.Contains("chibi", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("storybook", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("painterly", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SharedImagePrompt_ContainsExactPixelProfileWithoutLegacyKeywords()
    {
        var prompt = AiCaseService.FixedVisualStylePrompt;

        Assert.Contains("art_style=pixel_art", prompt, StringComparison.Ordinal);
        Assert.Contains("sub_style=high_detail_pixel", prompt, StringComparison.Ordinal);
        Assert.Contains("character_style=chibi", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("storybook", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("painterly", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void StrictCaseSchema_ExcludesServerOwnedRuntimeAndAssetFields()
    {
        var schema = AiStrictSchemaProvider.CaseLogicSchema();
        var json = schema.ToJsonString();

        Assert.False(schema["additionalProperties"]!.GetValue<bool>());
        Assert.DoesNotContain("coverImageUrl", json, StringComparison.Ordinal);
        Assert.DoesNotContain("backgroundUrl", json, StringComparison.Ordinal);
        Assert.DoesNotContain("imageUrl", json, StringComparison.Ordinal);
        Assert.DoesNotContain("placementPlan", json, StringComparison.Ordinal);
        Assert.DoesNotContain("runtime", json, StringComparison.Ordinal);
        Assert.Contains("visualDescription", json, StringComparison.Ordinal);
        Assert.Contains("visualTextPolicy", json, StringComparison.Ordinal);
    }

    [Fact]
    public void ShortDemoContract_IsCompactAndInternallyConsistent()
    {
        var contract = AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2);
        var prompt = contract.PromptRequirements();

        Assert.Equal(6, contract.MinClues);
        Assert.Equal(8, contract.MaxClues);
        Assert.Equal(2, contract.EvidenceChallenges);
        Assert.Contains("clues 6-8", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("10-12", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(AiGenerationPresets.ShortDemo, 2, 2, 2, 2, 3, 4, 6, 8, 6, 8, 2, 1, 1)]
    [InlineData(AiGenerationPresets.NormalRandom, 4, 4, 4, 4, 6, 4, 8, 10, 8, 12, 2, 1, 1)]
    [InlineData(AiGenerationPresets.PuzzleHeavy, 5, 5, 6, 5, 6, 4, 9, 12, 6, 10, 2, 1, 1)]
    [InlineData(AiGenerationPresets.DialogueHeavy, 5, 5, 6, 5, 6, 5, 10, 12, 12, 16, 3, 2, 1)]
    [InlineData(AiGenerationPresets.FullFeature, 6, 6, 6, 6, 6, 5, 10, 12, 12, 16, 3, 2, 2)]
    public void GenerationContracts_MatchPresetBudgets(
        string preset, int requestedStages, int minStages, int maxStages, int minScenes, int maxScenes,
        int minCharacters, int minClues, int maxClues, int minDialogues, int maxDialogues,
        int challenges, int deductions, int chains)
    {
        var contract = AiGenerationContract.For(preset, requestedStages);

        Assert.Equal(minStages, contract.MinStages);
        Assert.Equal(maxStages, contract.MaxStages);
        Assert.Equal(minScenes, contract.MinScenes);
        Assert.Equal(maxScenes, contract.MaxScenes);
        Assert.Equal(minCharacters, contract.MinCharacters);
        Assert.Equal(minClues, contract.MinClues);
        Assert.Equal(maxClues, contract.MaxClues);
        Assert.Equal(minDialogues, contract.MinDialogues);
        Assert.Equal(maxDialogues, contract.MaxDialogues);
        Assert.Equal(challenges, contract.EvidenceChallenges);
        Assert.Equal(deductions, contract.Deductions);
        Assert.Equal(chains, contract.TeamworkChains);
    }

    [Fact]
    public void RepairPrompt_ContainsTheActualPreviousCheckpoint()
    {
        var draft = new AiCaseDraft
        {
            Prompt = "A station mystery",
            Settings = new AiDraftSettings { GenerationPreset = AiGenerationPresets.ShortDemo, StageCount = 2 },
            StoryPreview = new AiStoryPreview { Title = "Last Bell", Summary = "A bell rings after closing." }
        };

        var prompt = AiCaseService.BuildFullCasePrompt(draft, "Fix missing references.", "{\"caseId\":\"case-checkpoint\"}");

        Assert.Contains("case-checkpoint", prompt, StringComparison.Ordinal);
        Assert.Contains("Fix missing references", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("10 to 12 clues", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"coverImageUrl\":", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("\"backgroundUrl\":", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("generationMode must", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("mechanicsVersion must", prompt, StringComparison.Ordinal);
        Assert.Contains("Glass Meridian v3 composition", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("naturally embedded camera clues", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Never use composition words", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("zero camera clues", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundPrompt_HasOneUnambiguousNoTextPolicy()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-platform",
            Title = "Main Platform",
            Description = "A rainy station platform.",
            VisualDescription = "Rainy Victorian platform with blank dark fixtures, brass lamps and wet stone."
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.PlacementFirst,
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-leaked-detail",
                    SceneId = scene.SceneId,
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    VisualDescription = "Macro view of a brass keyway shown inside a framed close-up panel."
                }
            },
            Stages = { new CaseStage { StageId = "stage-1", Order = 1, Scenes = { scene } } }
        };

        var prompt = AiCaseService.BuildBackgroundImagePrompt(new AiCaseDraft(), gameCase, scene);

        Assert.DoesNotContain("Documents may use abstract", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("no readable words", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("colored selection boxes", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("EMPTY ROOM / PLACEMENT-FIRST", prompt, StringComparison.Ordinal);
        Assert.Contains("composited later", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Macro view of a brass keyway", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Embedded camera evidence", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CameraContract_RejectsCloseUpCompositionButKeepsCameraClue()
    {
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-camera",
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    SceneId = "scene-one",
                    VisualDescription = "Macro close-up photograph of a crescent scratch in a framed detail panel."
                }
            }
        };

        var result = AiGenerationContract.For(AiGenerationPresets.ShortDemo, 2)
            .Validate(gameCase, new AiDraftSettings
            {
                StageCount = 2,
                GenerationPreset = AiGenerationPresets.ShortDemo
            });

        Assert.Contains(result.Errors, error => error.Code == "CameraComposition" && error.RefId == "clue-camera");
        Assert.DoesNotContain(result.Errors, error => error.Code == "PlacementFirstCameraClue");
    }

    [Fact]
    public void CameraBackgroundPrompt_EmbedsEvidenceWithoutInsetPanelsOrNpcs()
    {
        var scene = new CaseScene
        {
            SceneId = "scene-gallery",
            Title = "Meridian Gallery",
            Description = "A brass observatory gallery.",
            VisualDescription = "Wide brass observatory architecture with marble floor and open playable space."
        };
        var gameCase = new GameCase
        {
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            Stages = { new CaseStage { StageId = "stage-1", Scenes = { scene } } },
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-bolt",
                    SceneId = scene.SceneId,
                    Source = scene.SceneId,
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    VisualDescription = "A bright crescent gouge beneath the tarnished edge of the brass floor bolt."
                }
            }
        };

        var prompt = AiCaseService.BuildBackgroundImagePrompt(new AiCaseDraft(), gameCase, scene);

        Assert.Contains("bright crescent gouge", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ordinary scene-scale size", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("one continuous full-room composition", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not render NPCs or CUTOUT items", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Never enlarge a clue", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackgroundReuse_RequiresMatchingPromptHashAndQaMarker()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"sirlocked-background-reuse-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        try
        {
            const string prompt = "Canonical safe background prompt";
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(prompt))).ToLowerInvariant();
            var path = Path.Combine(folder, "scene.png");
            File.WriteAllBytes(path, [1, 2, 3]);
            File.WriteAllText($"{path}.prompt.sha256", hash);
            File.WriteAllText($"{path}.qa-passed", hash);

            Assert.True(AiCaseService.CanReusePassedBackground(path, prompt));

            File.WriteAllText($"{path}.qa-passed", "stale-hash");
            Assert.False(AiCaseService.CanReusePassedBackground(path, prompt));
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public void ResponsesEnvelope_ParsesStatusRefusalAndUsageWithoutDuplicatingOutputText()
    {
        const string json = """
        {
          "id":"resp_1","status":"completed","output_text":"{\"ok\":true}",
          "output":[{"content":[{"type":"output_text","text":"{\"ok\":true}"},{"type":"refusal","refusal":""}]}],
          "usage":{"input_tokens":12,"output_tokens":7}
        }
        """;

        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(json);

        Assert.Equal("completed", envelope.Status);
        Assert.Equal("{\"ok\":true}", envelope.Content);
        Assert.Equal(12, envelope.InputTokens);
        Assert.Equal(7, envelope.OutputTokens);
    }

    [Fact]
    public void ResponsesEnvelope_ParsesIncompleteReason()
    {
        const string json = """
        {
          "id":"resp_incomplete","status":"incomplete",
          "incomplete_details":{"reason":"max_output_tokens"},
          "output":[],"usage":{"input_tokens":31,"output_tokens":2048}
        }
        """;

        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(json);

        Assert.Equal("incomplete", envelope.Status);
        Assert.Equal("max_output_tokens", envelope.IncompleteReason);
        Assert.Equal(string.Empty, envelope.Content);
        Assert.Equal(2048, envelope.OutputTokens);
    }

    [Fact]
    public void ResponsesEnvelope_ParsesRefusalContent()
    {
        const string json = """
        {
          "id":"resp_refusal","status":"completed",
          "output":[{"content":[{"type":"refusal","refusal":"Request cannot be completed."}]}]
        }
        """;

        var envelope = AiCaseService.ExtractOpenAiTextEnvelope(json);

        Assert.Equal("Request cannot be completed.", envelope.Refusal);
        Assert.Equal(string.Empty, envelope.Content);
    }

    [Fact]
    public void VisualSafety_RejectsTextBearingCameraEvidenceBeforeAssets()
    {
        var gameCase = MockCaseFactory.Create("test", 4, "medium");
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
            scene.VisualDescription = "Victorian interior using material wear, strong silhouettes and clear physical evidence.";
        var clue = gameCase.Clues[0];
        clue.SourceType = "camera";
        clue.DiscoverMethod = "camera";
        clue.SceneId = gameCase.Stages[0].Scenes[0].SceneId;
        clue.VisualDescription = "A duty board with readable numbers and handwritten labels.";
        clue.VisualTextPolicy = ClueVisualTextPolicies.NoText;

        var result = AiGenerationContract.For(AiGenerationPresets.NormalRandom, 4)
            .Validate(gameCase, new AiDraftSettings { StageCount = 4, GenerationPreset = AiGenerationPresets.NormalRandom });

        Assert.Contains(result.Errors, error => error.Code == "VisualSafety" && error.RefId == clue.ClueId);
    }

    [Fact]
    public void AbstractSymbols_RequiresCameraClueReferencedBySymbolMatchPuzzle()
    {
        var gameCase = MockCaseFactory.Create("test", 4, "medium");
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
            scene.VisualDescription = "Victorian interior with worn brass mechanisms and strong physical silhouettes.";
        var clue = gameCase.Clues[0];
        clue.SourceType = "camera";
        clue.DiscoverMethod = "camera";
        clue.SceneId = gameCase.Stages[0].Scenes[0].SceneId;
        clue.VisualDescription = "Three simple geometric shapes cut into a small brass plate.";
        clue.VisualTextPolicy = ClueVisualTextPolicies.AbstractSymbols;

        var settings = new AiDraftSettings
        {
            StageCount = 4,
            GenerationPreset = AiGenerationPresets.NormalRandom
        };
        var contract = AiGenerationContract.For(settings.GenerationPreset, settings.StageCount);

        var rejected = contract.Validate(gameCase, settings);
        Assert.Contains(rejected.Errors, error => error.Code == "InvalidVisualTextPolicy" && error.RefId == clue.ClueId);

        gameCase.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-symbols",
            Type = CasePuzzleTypes.SymbolMatchPuzzle,
            TargetId = gameCase.Items[0].ItemId,
            RequiredClueIds = { clue.ClueId },
            Options = { "circle", "triangle", "diamond" },
            CorrectSequence = { "circle", "diamond" },
            SuccessMessage = "The mechanism releases.",
            FailureMessage = "The mechanism remains locked."
        });

        var accepted = contract.Validate(gameCase, settings);
        Assert.DoesNotContain(accepted.Errors, error => error.Code == "InvalidVisualTextPolicy" && error.RefId == clue.ClueId);

        clue.SourceType = "item";
        clue.DiscoverMethod = "inspect";
        var nonCamera = contract.Validate(gameCase, settings);
        Assert.Contains(nonCamera.Errors, error => error.Code == "InvalidVisualTextPolicy" && error.RefId == clue.ClueId);
    }
}
