using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class CaseValidationServiceTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly CaseValidationService _validator = new();

    private static GameCase LoadSampleCase()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "sample-case.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<GameCase>(json, JsonOptions)!;
    }

    private static GameCase LoadRepoCase(string[] relativePath, [System.Runtime.CompilerServices.CallerFilePath] string sourcePath = "")
    {
        var sourceDirectory = Path.GetDirectoryName(sourcePath) ?? string.Empty;
        var starts = new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory(), sourceDirectory }
            .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var start in starts)
        {
            var directory = new DirectoryInfo(start);
            while (directory is not null)
            {
                var path = Path.Combine(new[] { directory.FullName }.Concat(relativePath).ToArray());
                if (File.Exists(path))
                {
                    var json = File.ReadAllText(path);
                    return JsonSerializer.Deserialize<GameCase>(json, JsonOptions)!;
                }
                directory = directory.Parent;
            }
        }

        throw new FileNotFoundException($"Could not find repo file '{Path.Combine(relativePath)}'.");
    }

    [Fact]
    public void SampleCase_IsValid()
    {
        var result = _validator.Validate(LoadSampleCase());
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void DemoLumiereCase_IsValid()
    {
        var result = _validator.Validate(LoadRepoCase(new[] { "ai-game-docs", "demo-case", "case.json" }));
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void ClockworkConservatoryShortDemo_IsPublishable()
    {
        var gameCase = LoadRepoCase(new[]
        {
            "ai-game-docs", "generated-cases", "clockwork-conservatory-short-demo.json"
        });

        var result = _validator.Validate(gameCase);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
        Assert.Equal(2, gameCase.Stages.Count);
        Assert.Equal(2, gameCase.Stages.Sum(stage => stage.Scenes.Count));
        Assert.Equal(CaseGenerationModes.CameraEmbedded, gameCase.GenerationMode);
        Assert.Equal(CaseMechanicsVersions.InvestigationV2, gameCase.MechanicsVersion);
    }

    [Fact]
    public void BlackglassV5Vietnamese_HasStableLogicAndExpectedTwentyAssets()
    {
        var gameCase = LoadRepoCase(new[]
        {
            "ai-game-docs", "generated-cases", "blackglass-v5-vi.json"
        });

        // The checked-in localized artifact is the deterministic logic source. Hydrate a minimal
        // publish/runtime layout so the same Vietnamese graph is exercised by full validation.
        AddPlayableRuntime(gameCase);
        var result = _validator.Validate(gameCase);
        var generationResult = AiGenerationContract.For(AiGenerationPresets.FullFeature, 6)
            .Validate(gameCase, new AiDraftSettings
            {
                StageCount = 6,
                GenerationPreset = AiGenerationPresets.FullFeature,
                Language = CaseLanguages.Vietnamese
            });

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
        Assert.True(generationResult.IsValid, string.Join("\n", generationResult.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
        Assert.Equal("case-bell-beneath-blackglass", gameCase.CaseId);
        Assert.Equal("char-wren", gameCase.FinalLogic.CulpritId);
        Assert.Equal(CaseLanguages.Vietnamese, gameCase.Language);
        Assert.Equal(
            ["stage-1", "stage-2", "stage-3", "stage-4", "stage-5", "stage-6"],
            gameCase.Stages.Select(stage => stage.StageId));
        Assert.Equal(
            ["scene-1", "scene-2", "scene-3", "scene-4", "scene-5", "scene-6"],
            gameCase.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId));
        Assert.Equal(
            ["char-rook", "char-mara", "char-flint", "char-quill", "char-wren"],
            gameCase.Characters.Select(character => character.CharacterId));
        Assert.Equal(
            [
                "clue-clock-brake", "clue-tide-authorization", "clue-vale-model",
                "clue-undercroft-hush-draft", "clue-service-shaft", "clue-calibrated-optic",
                "clue-corrected-time", "clue-transit-sequence", "clue-illusion-overlay",
                "clue-flint-override", "clue-mara-plan", "clue-wren-access"
            ],
            gameCase.Clues.Select(clue => clue.ClueId));
        Assert.All(gameCase.FinalLogic.RequiredEvidenceLinks, link =>
            Assert.Contains(gameCase.Clues, clue => clue.ClueId == link.EvidenceId));
        Assert.Equal(20, AiCaseService.ExpectedFinalAssetCount(gameCase));
        Assert.Equal(3, gameCase.Items.Count(item => item.RenderMode == CaseItemRenderModes.Cutout));
        Assert.Single(gameCase.Items, item => item.ItemId == "item-service-console"
            && item.RenderMode == CaseItemRenderModes.Embedded
            && string.IsNullOrEmpty(item.ImageUrl));
    }

    [Fact]
    public void SampleCase_HasExpectedShape()
    {
        var c = LoadSampleCase();
        Assert.InRange(c.Stages.Count, 3, 4);
        Assert.InRange(c.Stages.Sum(s => s.Scenes.Count), 4, 6);
        Assert.InRange(c.Characters.Count, 4, 5);
        Assert.InRange(c.Items.Count, 8, 10);
        Assert.InRange(c.Clues.Count, 10, 12);
        Assert.InRange(c.Dialogues.Count, 10, 16);
        Assert.Contains(c.Clues, clue => clue.IsRedHerring);
        Assert.NotEmpty(c.FinalLogic.WinEnding);
        Assert.NotEmpty(c.FinalLogic.FailEnding);
    }

    [Fact]
    public void DuplicateItemId_IsRejected()
    {
        var c = LoadSampleCase();
        c.Items.Add(new CaseItem { ItemId = c.Items[0].ItemId, Name = "Copy" });
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "DuplicateId" && e.RefId == c.Items[0].ItemId);
    }

    [Fact]
    public void MissingSceneItemReference_IsRejected()
    {
        var c = LoadSampleCase();
        c.Stages[0].Scenes[0].ItemIds.Add("item-does-not-exist");
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "MissingReference" && e.RefId == "item-does-not-exist");
    }

    [Fact]
    public void UnknownInteractionType_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages[0].Scenes[0];
        c.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-invalid-type",
            Type = "SCRIPTED_LOCK",
            TargetId = scene.ItemIds[0],
            RequiredItemIds = new List<string> { scene.ItemIds[0] }
        });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue" && e.Path.Contains("interactions") && e.RefId == "SCRIPTED_LOCK");
    }

    [Fact]
    public void InspectEnvironmentInteraction_UsesDedicatedEnvironmentHotspot()
    {
        var c = LoadSampleCase();
        var scene = c.Stages[0].Scenes[0];
        const string interactionId = "interaction-inspect-scratches";
        c.Interactions.Add(new CaseInteraction
        {
            InteractionId = interactionId,
            Type = CaseInteractionTypes.InspectEnvironment,
            TargetId = interactionId,
            SuccessMessage = "The scratches reveal a recently moved cabinet.",
            SingleUse = true
        });
        scene.Hotspots.Add(new SceneHotspot
        {
            HotspotId = "hotspot-inspect-scratches",
            Type = "ENVIRONMENT",
            TargetId = interactionId,
            X = 40,
            Y = 50,
            Width = 8,
            Height = 8,
            Label = "Floor scratches"
        });

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void PuzzleWithMissingTarget_IsRejected()
    {
        var c = LoadSampleCase();
        c.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-missing-target",
            Type = CasePuzzleTypes.SequencePuzzle,
            TargetId = "item-does-not-exist",
            Prompt = "Press the symbols in order.",
            Options = new List<string> { "sun", "moon" },
            CorrectSequence = new List<string> { "sun" }
        });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "MissingReference" && e.Path.Contains("puzzles") && e.RefId == "item-does-not-exist");
    }

    [Fact]
    public void FinalEvidenceUsingItemId_IsRejected()
    {
        var c = LoadSampleCase();
        c.FinalLogic.RequiredEvidenceIds.Add(c.Items[0].ItemId);
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "InvalidEvidenceReference"
            && e.Message.Contains("not an item ID"));
    }

    [Fact]
    public void FinalEvidenceWithoutIsEvidenceFlag_IsRejected()
    {
        var c = LoadSampleCase();
        var evidenceClue = c.Clues.First(cl => cl.ClueId == c.FinalLogic.RequiredEvidenceIds[0]);
        evidenceClue.IsEvidence = false;
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "InvalidEvidenceFlag" && e.RefId == evidenceClue.ClueId);
    }

    [Fact]
    public void UnlockCycle_BlockingRequiredProgress_IsRejected()
    {
        var c = LoadSampleCase();
        var firstScene = c.Stages[0].Scenes[0];
        var requiredDialogueId = firstScene.CompleteCondition.RequiredDialogueIds[0];
        var dialogue = c.Dialogues.First(d => d.DialogueId == requiredDialogueId);
        var circularClue = new CaseClue
        {
            ClueId = "clue-dialogue-cycle",
            Title = "Circular disclosure",
            Content = "This clue is disclosed only after it is already known.",
            Source = dialogue.DialogueId,
            SourceType = "dialogue",
            DiscoverMethod = "dialogue"
        };
        c.Clues.Add(circularClue);
        dialogue.RequiredClueIds.Add(circularClue.ClueId);
        dialogue.UnlockClueIds.Add(circularClue.ClueId);

        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "UnreachableScene" && e.RefId == firstScene.SceneId);
    }

    [Fact]
    public void UndiscoverableFinalEvidence_IsRejected()
    {
        var c = LoadSampleCase();
        c.Clues.Add(new CaseClue
        {
            ClueId = "clue-never-unlocked",
            Title = "Ghost clue",
            Content = "Nothing unlocks this.",
            IsEvidence = true,
            Source = c.Items[0].ItemId,
            SourceType = "item"
        });
        c.FinalLogic.RequiredEvidenceIds.Add("clue-never-unlocked");
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code is "UndiscoverableEvidence" or "OrphanClue");
    }

    [Fact]
    public void SceneUnlockedOnlyFromInsideIt_IsRejected()
    {
        var c = LoadSampleCase();
        var scenes = c.Stages.OrderBy(stage => stage.Order).SelectMany(stage => stage.Scenes).ToList();
        var entryScene = scenes[0];
        var targetScene = scenes[1];
        var keyItemId = entryScene.ItemIds[0];
        c.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-self-unlock-scene",
            Type = CaseInteractionTypes.UseItemOnTarget,
            TargetId = targetScene.ItemIds[0],
            RequiredItemIds = { keyItemId },
            UnlockSceneIds = { targetScene.SceneId }
        });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, error =>
            error.Code == "UnreachableScene" && error.RefId == targetScene.SceneId);
    }

    [Fact]
    public void SceneUnlockedFromReachableEarlierScene_IsAccepted()
    {
        var c = LoadSampleCase();
        var scenes = c.Stages.OrderBy(stage => stage.Order).SelectMany(stage => stage.Scenes).ToList();
        var entryScene = scenes[0];
        var targetScene = scenes[^1];
        var keyItemId = entryScene.ItemIds[0];
        c.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-earlier-scene-unlock",
            Type = CaseInteractionTypes.UseItemOnTarget,
            TargetId = entryScene.ItemIds[1],
            RequiredItemIds = { keyItemId },
            UnlockSceneIds = { targetScene.SceneId }
        });

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error =>
            $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void ConversationChoiceRequiresClueItUnlocks_IsRejected()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        var topic = c.ConversationNodes.Single(node => node.NodeId == root.Choices[0].NextNodeId);
        var clue = AddConversationClue(c, topic, "clue-conversation-cycle", isEvidence: true);
        root.Choices[0].RequiredClueIds.Add(clue.ClueId);
        topic.UnlockClueIds.Add(clue.ClueId);
        c.FinalLogic.RequiredEvidenceIds.Add(clue.ClueId);

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, error =>
            error.Code == "UndiscoverableEvidence" && error.RefId == clue.ClueId);
    }

    [Fact]
    public void ConversationNodeReachedThroughAvailableChoice_IsAccepted()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        var topic = c.ConversationNodes.Single(node => node.NodeId == root.Choices[0].NextNodeId);
        var clue = AddConversationClue(c, topic, "clue-reachable-conversation", isEvidence: true);
        topic.UnlockClueIds.Add(clue.ClueId);
        c.FinalLogic.RequiredEvidenceIds.Add(clue.ClueId);

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error =>
            $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void ConversationNodeChallengeWithoutAskedDialogue_IsAccepted()
    {
        var c = LoadSampleCase();
        var challenge = c.EvidenceChallenges.Single(item => item.ChallengeId == "challenge-edgar-debt");
        var challengeDialogue = c.Dialogues.Single(dialogue => dialogue.DialogueId == challenge.DialogueId);
        var root = AddValidConversationTree(c, challengeDialogue.CharacterId);
        var topic = c.ConversationNodes.Single(node => node.NodeId == root.Choices[0].NextNodeId);
        var challengeClue = AddConversationClue(c, topic, "clue-tree-only-challenge", isEvidence: true);

        topic.ChallengeId = challenge.ChallengeId;
        challenge.UnlockClueIds = new List<string> { challengeClue.ClueId };
        challengeDialogue.RequiredClueIds = new List<string> { challengeClue.ClueId };
        c.FinalLogic.RequiredEvidenceIds.Add(challengeClue.ClueId);

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error =>
            $"{error.Code} {error.Path}: {error.Message}")));
    }

    [Fact]
    public void DirectlyReachableNodeRequirementWithoutGraphPath_IsRejected()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        var topic = c.ConversationNodes.Single(node => node.NodeId == root.Choices[0].NextNodeId);
        var unlockedInEntryScene = c.Items
            .Where(item => c.Stages.OrderBy(stage => stage.Order).First().Scenes[0].ItemIds.Contains(item.ItemId))
            .SelectMany(item => item.UnlockClueIds)
            .First();
        var gateClue = AddConversationClue(c, topic, "clue-untraversable-choice");
        topic.RequiredClueIds.Add(unlockedInEntryScene);
        topic.UnlockClueIds.Add(gateClue.ClueId);
        root.Choices[0].RequiredClueIds.Add(gateClue.ClueId);

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, error =>
            error.Code == "UnreachableConversationNode" && error.RefId == topic.NodeId);
    }

    [Fact]
    public void InvalidCompleteConditionLogic_IsRejected()
    {
        var c = LoadSampleCase();
        c.Stages[0].Scenes[0].CompleteCondition.Logic = "MAYBE";
        var result = _validator.Validate(c);
        Assert.Contains(result.Errors, e => e.Code == "InvalidValue" && e.Path.Contains("completeCondition.logic"));
    }

    [Fact]
    public void RuntimeLayout_WithValidReferences_IsAccepted()
    {
        var c = LoadSampleCase();
        var scenes = c.Stages.SelectMany(s => s.Scenes).ToList();
        var scene = scenes[0];
        var itemId = scene.ItemIds[0];
        scene.Runtime = new SceneRuntime
        {
            Width = 1600,
            Height = 900,
            FloorY = 720,
            WalkableArea = new RuntimeBox { X = 0, Y = 630, Width = 1600, Height = 135 },
            SpawnPoints =
            {
                ["default"] = new SpawnPoint { X = 240, Y = 720, Direction = "right" }
            },
            ItemPlacements =
            {
                new ItemPlacement
                {
                    ItemId = itemId,
                    Position = new RuntimePoint { X = 240, Y = 520 },
                    Size = new RuntimeSize { Width = 120, Height = 80 },
                    Hotspot = new RuntimeBox { X = 180, Y = 440, Width = 120, Height = 80 },
                    ReservedSlot = new RuntimeBox { X = 180, Y = 440, Width = 120, Height = 80 }
                }
            },
            Transitions =
            {
                new TransitionZone
                {
                    TransitionId = "exit-next",
                    TargetSceneId = scenes[1].SceneId,
                    Label = "Next",
                    Hotspot = new RuntimeBox { X = 1360, Y = 640, Width = 180, Height = 54 }
                }
            }
        };

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void CameraClue_WithValidZone_IsAccepted()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-valid");
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 220, Y = 260, Width = 110, Height = 80 });

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void CameraEmbedded_FullLogicWithoutClueZones_IsAccepted()
    {
        var c = CreateMinimalCameraEmbeddedCase();

        var result = _validator.ValidateFullLogic(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void CameraEmbedded_PublishWithoutClueZones_IsRejected()
    {
        var c = CreateMinimalCameraEmbeddedCase();

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.RefId == "clue-camera-final" && e.Path.Contains("clueZone"));
    }

    [Fact]
    public void CameraEmbedded_FinalItemEvidenceWithoutPuzzleIntent_IsRejected()
    {
        var c = CreateMinimalCameraEmbeddedCase();
        ConvertFinalCameraClueToItem(c, isPuzzle: false);

        var result = _validator.ValidateFullLogic(c);

        Assert.Contains(result.Errors, e => e.Code is "InvalidCameraEmbeddedItem" or "InvalidCameraEvidenceSource");
    }

    [Fact]
    public void CameraEmbedded_FinalItemEvidenceWithPuzzleIntent_IsAccepted()
    {
        var c = CreateMinimalCameraEmbeddedCase();
        ConvertFinalCameraClueToItem(c, isPuzzle: true);

        var result = _validator.ValidateFullLogic(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void CameraEmbeddedRepair_ConvertsFinalItemEvidenceToCameraAndKeepsClueId()
    {
        var c = CreateMinimalCameraEmbeddedCase();
        ConvertFinalCameraClueToItem(c, isPuzzle: false);

        var fixes = CameraEmbeddedCaseRepair.RepairFinalItemEvidenceToCamera(c);
        var clue = c.Clues.Single(cl => cl.ClueId == "clue-camera-final");
        var result = _validator.ValidateFullLogic(c);

        Assert.NotEmpty(fixes);
        Assert.Equal("clue-camera-final", clue.ClueId);
        Assert.Equal("camera", clue.SourceType);
        Assert.Equal("camera", clue.DiscoverMethod);
        Assert.Equal("scene-workshop", clue.SceneId);
        Assert.DoesNotContain(c.Items, item => item.ItemId == "item-hatch-key");
        Assert.DoesNotContain("item-hatch-key", c.Stages[0].Scenes[0].ItemIds);
        Assert.DoesNotContain(c.Stages[0].Scenes[0].Hotspots, h => h.TargetId == "item-hatch-key");
        Assert.Contains("clue-camera-final", c.FinalLogic.RequiredEvidenceIds);
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void RequiredCameraEvidence_WithoutZone_WhenLayoutExists_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var missingZoneClue = AddCameraClue(c, scene, "clue-photo-missing-zone", isEvidence: true);
        var validZoneClue = AddCameraClue(c, scene, "clue-photo-layout-anchor");
        scene.Runtime = RuntimeWithClueZone(validZoneClue.ClueId, new RuntimeBox { X = 220, Y = 260, Width = 110, Height = 80 });
        c.FinalLogic.RequiredEvidenceIds.Add(missingZoneClue.ClueId);

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue"
            && e.RefId == missingZoneClue.ClueId
            && e.Path.Contains("clueZone"));
    }

    [Fact]
    public void CameraClueZone_OutOfBounds_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-out-of-bounds");
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 1560, Y = 840, Width = 120, Height = 90 });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue"
            && e.RefId == clue.ClueId
            && e.Path.Contains("clueZones[0].bounds"));
    }

    [Fact]
    public void CameraClueZone_TooSmall_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-too-small");
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 220, Y = 260, Width = 12, Height = 12 });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue"
            && e.RefId == clue.ClueId
            && e.Message.Contains("at least 16x16"));
    }

    [Fact]
    public void CameraClueZone_MuchLargerThanCapture_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-oversized");
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 100, Y = 100, Width = 600, Height = 300 });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "OversizedClueZone" && e.RefId == clue.ClueId);
    }

    [Fact]
    public void CutoutRuntimeSize_Over160Pixels_IsRejected()
    {
        var c = LoadSampleCase();
        EnableV5VisualContract(c);
        var scene = c.Stages.SelectMany(stage => stage.Scenes).First();
        var item = c.Items.Single(candidate => candidate.ItemId == scene.ItemIds.First());
        scene.Runtime = new SceneRuntime
        {
            Width = 1600,
            Height = 900,
            ItemPlacements =
            {
                new ItemPlacement
                {
                    ItemId = item.ItemId,
                    Asset = "/assets/item.png",
                    Position = new RuntimePoint { X = 240, Y = 520 },
                    Size = new RuntimeSize { Width = 161, Height = 100 },
                    Hotspot = new RuntimeBox { X = 180, Y = 440, Width = 161, Height = 100 }
                }
            }
        };

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, error => error.Code == "OversizedCutout" && error.RefId == item.ItemId);
    }

    [Fact]
    public void EmbeddedMechanism_KeepsHotspotAndPuzzleWithoutOverlayAsset()
    {
        var c = LoadSampleCase();
        EnableV5VisualContract(c);
        var scene = c.Stages.SelectMany(stage => stage.Scenes).First();
        var item = c.Items.Single(candidate => candidate.ItemId == scene.ItemIds.First());
        item.IsCollectible = false;
        item.IsInteractivePuzzleObject = true;
        item.InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism;
        item.RenderMode = CaseItemRenderModes.Embedded;
        item.ImageUrl = string.Empty;
        scene.Runtime = new SceneRuntime
        {
            Width = 1600,
            Height = 900,
            ItemPlacements =
            {
                new ItemPlacement
                {
                    ItemId = item.ItemId,
                    Asset = string.Empty,
                    Position = new RuntimePoint { X = 500, Y = 450 },
                    Size = new RuntimeSize { Width = 320, Height = 220 },
                    Hotspot = new RuntimeBox { X = 340, Y = 230, Width = 320, Height = 220 }
                }
            }
        };
        c.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-embedded-mechanism",
            Type = CasePuzzleTypes.SequencePuzzle,
            TargetId = item.ItemId,
            Prompt = "Operate the mechanism.",
            Options = { "left", "right" },
            CorrectSequence = { "left", "right" }
        });

        var result = _validator.Validate(c);

        Assert.DoesNotContain(result.Errors, error => error.RefId == item.ItemId
            && (error.Code == "OversizedCutout" || error.Path.EndsWith(".asset") || error.Path.EndsWith(".renderMode")));
        Assert.Contains(scene.Runtime.ItemPlacements, placement => placement.ItemId == item.ItemId
            && string.IsNullOrEmpty(placement.Asset)
            && placement.Hotspot.Width > 0);
        Assert.Contains(c.Puzzles, puzzle => puzzle.TargetId == item.ItemId);
    }

    [Fact]
    public void EmbeddedCollectibleItem_IsRejected()
    {
        var c = LoadSampleCase();
        EnableV5VisualContract(c);
        var item = c.Items[0];
        item.RenderMode = CaseItemRenderModes.Embedded;
        item.IsCollectible = true;

        var result = _validator.ValidateFullLogic(c);

        Assert.Contains(result.Errors, error => error.RefId == item.ItemId && error.Path.EndsWith(".renderMode"));
    }

    [Fact]
    public void V5CharacterWithoutVisualDescription_IsRejected()
    {
        var c = LoadSampleCase();
        EnableV5VisualContract(c);
        var character = c.Characters[0];
        character.VisualDescription = string.Empty;

        var result = _validator.ValidateFullLogic(c);

        Assert.Contains(result.Errors, error => error.RefId == character.CharacterId
            && error.Path.EndsWith(".visualDescription"));
    }

    [Fact]
    public void RequiredCameraEvidence_WithFallbackZone_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-fallback-zone", isEvidence: true);
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 220, Y = 260, Width = 110, Height = 80 });
        scene.Runtime.ClueZones[0].IsFallback = true;
        scene.Runtime.ClueZones[0].Source = "fallback";
        scene.Runtime.ClueZones[0].DetectionStatus = "NOT_FOUND";
        scene.Runtime.ClueZones[0].Confidence = 0;
        c.FinalLogic.RequiredEvidenceIds.Add(clue.ClueId);

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue"
            && e.RefId == clue.ClueId
            && e.Message.Contains("fallback"));
    }

    [Fact]
    public void RequiredCameraEvidence_WithLowConfidenceZone_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-low-confidence", isEvidence: true);
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 220, Y = 260, Width = 110, Height = 80 });
        scene.Runtime.ClueZones[0].Confidence = 0.4;
        c.FinalLogic.RequiredEvidenceIds.Add(clue.ClueId);

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue"
            && e.RefId == clue.ClueId
            && e.Path.Contains("confidence"));
    }

    [Fact]
    public void RequiredCameraEvidence_WithNonFoundDetectionStatus_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        var clue = AddCameraClue(c, scene, "clue-photo-ambiguous", isEvidence: true);
        scene.Runtime = RuntimeWithClueZone(clue.ClueId, new RuntimeBox { X = 220, Y = 260, Width = 110, Height = 80 });
        scene.Runtime.ClueZones[0].DetectionStatus = "AMBIGUOUS";
        c.FinalLogic.RequiredEvidenceIds.Add(clue.ClueId);

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue"
            && e.RefId == clue.ClueId
            && e.Path.Contains("detectionStatus"));
    }

    [Fact]
    public void RuntimeTransition_ToMissingScene_IsRejected()
    {
        var c = LoadSampleCase();
        var scene = c.Stages.SelectMany(s => s.Scenes).First();
        scene.Runtime = new SceneRuntime
        {
            Width = 1600,
            Height = 900,
            Transitions =
            {
                new TransitionZone
                {
                    TransitionId = "exit-missing",
                    TargetSceneId = "scene-does-not-exist",
                    Label = "Missing",
                    Hotspot = new RuntimeBox { X = 1360, Y = 640, Width = 180, Height = 54 }
                }
            }
        };

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "MissingReference" && e.RefId == "scene-does-not-exist");
    }

    [Fact]
    public void ConversationTree_WithValidShape_IsAccepted()
    {
        var c = LoadSampleCase();
        AddValidConversationTree(c);

        var result = _validator.Validate(c);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    [Fact]
    public void ConversationTree_DuplicateChoiceId_IsRejected()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        root.Choices.Add(new ConversationChoice
        {
            ChoiceId = root.Choices[0].ChoiceId,
            Label = "Repeat topic",
            NextNodeId = "node-phase-c-topic"
        });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "DuplicateId" && e.Path.Contains("choices"));
    }

    [Fact]
    public void ConversationTree_MissingRoot_IsRejected()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        root.IsRoot = false;

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue" && e.Message.Contains("exactly one root"));
    }

    [Fact]
    public void ConversationTree_DepthGreaterThanTwo_IsRejected()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        c.ConversationNodes.First(node => node.NodeId == "node-phase-c-follow-up").Choices[0].NextNodeId = "node-phase-c-too-deep";
        c.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "node-phase-c-too-deep",
            CharacterId = root.CharacterId,
            Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "That goes too far." } },
            Choices = { new ConversationChoice { ChoiceId = "choice-return", Label = "Return" } }
        });

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidConversationDepth" && e.RefId == "node-phase-c-too-deep");
    }

    [Fact]
    public void ConversationTree_ChallengeForAnotherCharacter_IsRejected()
    {
        var c = LoadSampleCase();
        var root = AddValidConversationTree(c);
        var challenge = c.EvidenceChallenges.First();
        var challengeDialogue = c.Dialogues.First(dialogue => dialogue.DialogueId == challenge.DialogueId);
        var otherCharacter = c.Characters.First(character => character.CharacterId != challengeDialogue.CharacterId);
        foreach (var node in c.ConversationNodes)
        {
            node.CharacterId = otherCharacter.CharacterId;
        }
        c.ConversationNodes.First(node => node.NodeId == root.Choices[0].NextNodeId).ChallengeId = challenge.ChallengeId;

        var result = _validator.Validate(c);

        Assert.Contains(result.Errors, e => e.Code == "InvalidValue" && e.Path.Contains("challengeId"));
    }

    [Fact]
    public void SampleCase_ConversationTree_RoundTripsAndValidates()
    {
        var c = LoadSampleCase();

        Assert.NotEmpty(c.ConversationNodes);
        var root = c.ConversationNodes.Single(node => node.IsRoot && node.CharacterId == "char-mira");
        Assert.NotEmpty(root.Choices);
        Assert.Contains(root.Choices, choice => string.IsNullOrEmpty(choice.NextNodeId)); // a way back / end exists
        Assert.True(_validator.Validate(c).IsValid);
    }

    [Fact]
    public void MockCaseFactory_ProducesValidCase()
    {
        for (var stages = 2; stages <= 5; stages++)
        {
            var mock = MockCaseFactory.Create("A locked-room manor mystery with a poisoned drink", stages, "medium");
            var result = _validator.Validate(mock);
            Assert.True(result.IsValid,
                $"stages={stages}: " + string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
        }
    }

    [Fact]
    public void AutoRepair_ConvertsAiTargetHotspotToInteractiveItemTarget()
    {
        var c = LoadSampleCase();
        var scene = c.Stages[0].Scenes[0];
        var requiredItemId = c.Items[0].ItemId;

        scene.Hotspots.Add(new SceneHotspot
        {
            HotspotId = "hotspot-tunnel-hatch",
            Type = "TARGET",
            TargetId = "hotspot-tunnel-hatch",
            X = 59,
            Y = 65,
            Width = 12,
            Height = 10,
            Label = "Tunnel Hatch"
        });
        c.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-open-tunnel-hatch",
            Type = CaseInteractionTypes.UseItemOnTarget,
            TargetId = "hotspot-tunnel-hatch",
            RequiredItemIds = { requiredItemId },
            SuccessMessage = "The hatch opens.",
            FailureMessage = "That does not fit here."
        });
        c.Puzzles.Add(new CasePuzzle
        {
            PuzzleId = "puzzle-tunnel-hatch",
            Type = CasePuzzleTypes.SequencePuzzle,
            TargetId = "hotspot-tunnel-hatch",
            Prompt = "Set the hatch tumblers in order.",
            Options = { "one", "two", "three" },
            CorrectSequence = { "one", "two" },
            SuccessMessage = "The tumblers align.",
            FailureMessage = "The hatch stays shut."
        });

        var fixes = CaseAutoRepair.Repair(c);
        var repairedItem = c.Items.Single(item => item.ItemId == "item-tunnel-hatch");

        Assert.Contains(fixes, fix => fix.Contains("Converted unsupported hotspot target", StringComparison.Ordinal));
        Assert.False(repairedItem.IsCollectible);
        Assert.True(repairedItem.IsInteractivePuzzleObject);
        Assert.Equal(CaseItemInteractionPurposes.OperateMechanism, repairedItem.InteractionPurpose);
        Assert.Equal(CaseItemRenderModes.Embedded, repairedItem.RenderMode);
        Assert.False(string.IsNullOrWhiteSpace(repairedItem.VisualDescription));
        Assert.Equal(string.Empty, repairedItem.ImageUrl);
        Assert.Contains("item-tunnel-hatch", scene.ItemIds);
        Assert.Contains(scene.Hotspots, hotspot =>
            hotspot.HotspotId == "hotspot-tunnel-hatch"
            && hotspot.Type == "ITEM"
            && hotspot.TargetId == "item-tunnel-hatch");
        Assert.Equal("item-tunnel-hatch", c.Interactions.Single(i => i.InteractionId == "interaction-open-tunnel-hatch").TargetId);
        Assert.Equal("item-tunnel-hatch", c.Puzzles.Single(p => p.PuzzleId == "puzzle-tunnel-hatch").TargetId);

        var result = _validator.Validate(c);
        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(e => $"{e.Code} {e.Path}: {e.Message}")));
    }

    private static CaseClue AddCameraClue(GameCase c, CaseScene scene, string clueId, bool isEvidence = false)
    {
        var clue = new CaseClue
        {
            ClueId = clueId,
            Title = "Photo clue",
            Content = "A photographed clue embedded in the scene.",
            Source = scene.SceneId,
            SourceType = "camera",
            DiscoverMethod = "camera",
            SceneId = scene.SceneId,
            VisualDescription = "A small brass token tucked under the chair leg.",
            InventoryDescription = "The photo shows a brass token under the chair leg.",
            NarrativeMeaning = "The token links the suspect to the scene.",
            HintLevel = 2,
            Tags = { "camera", "evidence" },
            IsCritical = isEvidence,
            IsEvidence = isEvidence
        };
        c.Clues.Add(clue);
        return clue;
    }

    private static void AddPlayableRuntime(GameCase gameCase)
    {
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            scene.Runtime = new SceneRuntime
            {
                Width = 1600,
                Height = 900,
                FloorY = 720,
                WalkableArea = new RuntimeBox { X = 80, Y = 620, Width = 1440, Height = 180 },
                SpawnPoints = new Dictionary<string, SpawnPoint>
                {
                    ["default"] = new() { X = 600, Y = 720, Direction = "right" }
                },
                CameraRules = new CameraRules
                {
                    CaptureRectWidth = 180,
                    CaptureRectHeight = 140,
                    MinClueCoverage = 0.45,
                    NearMissCoverage = 0.22,
                    RequireCaptureCenterInside = true
                }
            };

            foreach (var clue in gameCase.Clues.Where(clue =>
                         clue.SceneId == scene.SceneId
                         && clue.DiscoverMethod.Equals("camera", StringComparison.OrdinalIgnoreCase)))
            {
                scene.Runtime.ClueZones.Add(new ClueZone
                {
                    ClueId = clue.ClueId,
                    Label = clue.Title,
                    Bounds = new RuntimeBox { X = 700, Y = 260, Width = 160, Height = 120 },
                    DetectionStatus = "FOUND",
                    Confidence = 0.95,
                    Source = "regression-fixture",
                    IsFallback = false
                });
            }
        }
    }

    private static void EnableV5VisualContract(GameCase c)
    {
        c.Language = CaseLanguages.Vietnamese;
        c.ArtStyle = AiVisualStyleDefaults.ArtStyle;
        c.SubStyle = AiVisualStyleDefaults.SubStyle;
        c.CharacterStyle = AiVisualStyleDefaults.CharacterStyle;
        foreach (var character in c.Characters)
            character.VisualDescription = $"Distinct pixel character identity for {character.Name}.";
        foreach (var item in c.Items)
        {
            item.VisualDescription = $"Small portable pixel-art object: {item.Name}.";
            item.RenderMode = CaseItemRenderModes.Cutout;
        }
    }

    private static ConversationNode AddValidConversationTree(GameCase c, string? characterId = null)
    {
        characterId ??= c.Stages[0].Scenes[0].CharacterIds[0];
        var root = new ConversationNode
        {
            NodeId = "node-phase-c-root",
            CharacterId = characterId,
            IsRoot = true,
            Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "What do you need?" } },
            Choices =
            {
                new ConversationChoice
                {
                    ChoiceId = "choice-topic",
                    Label = "Ask about the timeline",
                    NextNodeId = "node-phase-c-topic"
                }
            }
        };
        c.ConversationNodes.Add(root);
        c.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "node-phase-c-topic",
            CharacterId = characterId,
            Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "The clock stopped before supper." } },
            Choices =
            {
                new ConversationChoice
                {
                    ChoiceId = "choice-follow-up",
                    Label = "Press on the clock",
                    NextNodeId = "node-phase-c-follow-up"
                }
            }
        });
        c.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "node-phase-c-follow-up",
            CharacterId = characterId,
            Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "I heard the chime twice." } },
            Choices = { new ConversationChoice { ChoiceId = "choice-return", Label = "Return" } }
        });
        return root;
    }

    private static CaseClue AddConversationClue(
        GameCase c,
        ConversationNode sourceNode,
        string clueId,
        bool isEvidence = false)
    {
        var clue = new CaseClue
        {
            ClueId = clueId,
            Title = "Conversation clue",
            Content = "A fact disclosed along a reachable conversation branch.",
            Source = sourceNode.NodeId,
            SourceType = "conversation",
            DiscoverMethod = "conversation",
            IsCritical = isEvidence,
            IsEvidence = isEvidence
        };
        c.Clues.Add(clue);
        return clue;
    }

    private static SceneRuntime RuntimeWithClueZone(string clueId, RuntimeBox bounds) => new()
    {
        Width = 1600,
        Height = 900,
        FloorY = 720,
        WalkableArea = new RuntimeBox { X = 0, Y = 630, Width = 1600, Height = 135 },
        CameraRules = new CameraRules
        {
            CaptureRectWidth = 180,
            CaptureRectHeight = 140,
            MinClueCoverage = 0.45,
            NearMissCoverage = 0.22,
            RequireCaptureCenterInside = true
        },
        ClueZones =
        {
            new ClueZone
            {
                ClueId = clueId,
                Label = "Photo clue",
                Bounds = bounds,
                Visibility = "medium",
                DetectionDifficulty = "medium",
                DetectionStatus = "FOUND",
                Confidence = 0.8,
                Source = "vision",
                IsFallback = false
            }
        }
    };

    private static GameCase CreateMinimalCameraEmbeddedCase()
    {
        var c = new GameCase
        {
            CaseId = "case-camera-minimal",
            Title = "Camera Minimal",
            Summary = "A compact camera-first validation case.",
            Status = "DRAFT",
            GenerationMode = CaseGenerationModes.CameraEmbedded,
            EstimatedMinutes = 20,
            Characters =
            {
                new CaseCharacter
                {
                    CharacterId = "char-culprit",
                    Name = "Culprit",
                    Role = "Suspect",
                    Description = "A suspect with a broken alibi."
                }
            },
            Clues =
            {
                new CaseClue
                {
                    ClueId = "clue-camera-final",
                    Title = "Photographed Hatch Mark",
                    Content = "The hatch mark proves who opened the hidden route.",
                    IsCritical = true,
                    IsEvidence = true,
                    Source = "scene-workshop",
                    SourceType = "camera",
                    DiscoverMethod = "camera",
                    SceneId = "scene-workshop",
                    VisualDescription = "A fresh brass scrape across the upper hatch latch.",
                    InventoryDescription = "The photo shows the hatch latch scraped by a brass key.",
                    NarrativeMeaning = "Only the culprit had the key that leaves this scrape.",
                    HintLevel = 2,
                    Tags = { "camera", "final" },
                    RelatedCharacterIds = { "char-culprit" }
                }
            },
            FinalLogic = new FinalLogic
            {
                CulpritId = "char-culprit",
                Motive = "Debt.",
                Method = "Hidden access through the hatch.",
                RequiredEvidenceIds = { "clue-camera-final" },
                WinEnding = "The camera evidence proves the route.",
                FailEnding = "The accusation lacks the decisive photo."
            }
        };

        c.Stages.Add(new CaseStage
        {
            StageId = "stage-workshop",
            Title = "Workshop",
            Order = 1,
            Scenes =
            {
                new CaseScene
                {
                    SceneId = "scene-workshop",
                    Title = "Workshop",
                    Description = "A room with a visible hatch mark.",
                    CharacterIds = { "char-culprit" },
                    CompleteCondition = new CompleteCondition
                    {
                        Logic = "AND",
                        RequiredClueIds = { "clue-camera-final" }
                    }
                }
            }
        });

        return c;
    }

    private static void ConvertFinalCameraClueToItem(GameCase c, bool isPuzzle)
    {
        var scene = c.Stages[0].Scenes[0];
        var item = new CaseItem
        {
            ItemId = "item-hatch-key",
            Name = "Hatch Key",
            Description = "A key that can open the service hatch.",
            InspectText = "Its brass teeth match the hatch scrape.",
            UnlockClueIds = { "clue-camera-final" },
            IsInteractivePuzzleObject = isPuzzle,
            InteractionPurpose = isPuzzle ? CaseItemInteractionPurposes.UnlockDoor : string.Empty,
            InteractionReason = isPuzzle ? "The player must physically use the key to unlock the service hatch." : string.Empty
        };
        c.Items.Add(item);
        scene.ItemIds.Add(item.ItemId);
        scene.Hotspots.Add(new SceneHotspot
        {
            HotspotId = "hotspot-hatch-key",
            Type = "ITEM",
            TargetId = item.ItemId,
            X = 40,
            Y = 55,
            Width = 8,
            Height = 10,
            Label = item.Name
        });
        scene.CompleteCondition.RequiredClueIds.Clear();
        scene.CompleteCondition.RequiredItemIds.Add(item.ItemId);

        var clue = c.Clues[0];
        clue.Source = item.ItemId;
        clue.SourceType = "item";
        clue.DiscoverMethod = "item";
        clue.SceneId = string.Empty;
    }
}
