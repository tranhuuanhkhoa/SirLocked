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
        // First scene's required dialogue now requires a clue that only its own asking unlocks elsewhere:
        // make the first item's unlock depend on a clue that is unlocked by a dialogue requiring that same clue.
        var firstScene = c.Stages[0].Scenes[0];
        var requiredDialogueId = firstScene.CompleteCondition.RequiredDialogueIds[0];
        var dialogue = c.Dialogues.First(d => d.DialogueId == requiredDialogueId);
        var lateClue = c.FinalLogic.RequiredEvidenceIds.Last(); // discoverable only in a later stage
        dialogue.RequiredClueIds.Add(lateClue);

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

    private static ConversationNode AddValidConversationTree(GameCase c)
    {
        var characterId = c.Stages[0].Scenes[0].CharacterIds[0];
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
