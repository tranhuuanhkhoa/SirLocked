using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public sealed class AiCaseBlueprint
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string CulpritId { get; set; } = string.Empty;
    public string SolutionOutline { get; set; } = string.Empty;
    public List<AiBlueprintCharacter> Characters { get; set; } = new();
    public List<AiBlueprintScene> Scenes { get; set; } = new();
    public List<string> ProgressionSceneIds { get; set; } = new();
    public List<AiCrackBlueprint> Cracks { get; set; } = new();
}

public sealed class AiBlueprintCharacter
{
    public string CharacterId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public bool IsSuspect { get; set; }
}

public sealed class AiBlueprintScene
{
    public string StageId { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public int StageOrder { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Purpose { get; set; } = string.Empty;
}

public sealed class AiCrackBlueprint
{
    public string ChallengeId { get; set; } = string.Empty;
    public int Order { get; set; }
    public bool IsSignature { get; set; }
    public string DialogueId { get; set; } = string.Empty;
    public string DialogueAnswer { get; set; } = string.Empty;
    public List<AiBlueprintTestimony> Testimonies { get; set; } = new();
    public List<AiBlueprintEvidence> Evidences { get; set; } = new();
    public string TestimonyFragmentId { get; set; } = string.Empty;
    public string CorrectEvidenceId { get; set; } = string.Empty;
    public List<string> StartRequiredTestimonyFragmentIds { get; set; } = new();
    public List<string> StartRequiredEvidenceIds { get; set; } = new();
    public string Prompt { get; set; } = string.Empty;
    public string SuccessResponse { get; set; } = string.Empty;
    public string FailureResponse { get; set; } = string.Empty;
    public string RevealTitle { get; set; } = string.Empty;
    public string RevealClueId { get; set; } = string.Empty;
    public string RevealContent { get; set; } = string.Empty;
}

public sealed class AiBlueprintTestimony
{
    public string Id { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public AiSemanticProposition Semantics { get; set; } = new();
}

public sealed class AiBlueprintEvidence
{
    public string ClueId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string NarrativeMeaning { get; set; } = string.Empty;
    public string AcquisitionMethod { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string SourceId { get; set; } = string.Empty;
    public string SceneId { get; set; } = string.Empty;
    public AiSemanticProposition Semantics { get; set; } = new();
}

public sealed class AiSemanticProposition
{
    public string SubjectKind { get; set; } = string.Empty;
    public string SubjectRef { get; set; } = string.Empty;
    public string Predicate { get; set; } = string.Empty;
    public string ObjectRef { get; set; } = string.Empty;
    public string PlaceRef { get; set; } = string.Empty;
    public string TimeScope { get; set; } = string.Empty;
    public string Polarity { get; set; } = string.Empty;
}

public static class AiCaseBlueprintPolicy
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string BuildPrompt(AiCaseDraft draft, string? correction = null, string? previousJson = null)
    {
        var budget = CrackGenerationBudgets.For(draft.Settings.GenerationPreset);
        var preview = JsonSerializer.Serialize(draft.StoryPreview, JsonOptions);
        var language = CaseLanguages.Normalize(draft.Settings.Language) == CaseLanguages.Vietnamese
            ? "Write all player-facing text in natural Vietnamese with full diacritics; keep IDs, enums, acquisition methods, source types, and semantic annotations in English/ASCII."
            : "Write all player-facing text in English; keep IDs and semantic annotations in English/ASCII.";
        return $"""
        Create a compact, spoiler-bearing case blueprint for SirLocked. Return JSON only.

        Approved preview:
        {preview}

        Creator direction:
        {(string.IsNullOrWhiteSpace(draft.Prompt) ? "Use the approved preview as the source of truth." : draft.Prompt)}

        Preset: {draft.Settings.GenerationPreset}; stages: {draft.Settings.StageCount}; difficulty: {draft.Settings.Difficulty}.
        {language}

        Dynamic Crack budget:
        - {budget.MinCracks}-{budget.MaxCracks} Cracks; exactly one isSignature=true.
        - Each Crack: {budget.MinTestimonies}-{budget.MaxTestimonies} testimony fragments and {budget.MinEvidence}-{budget.MaxEvidence} evidence candidates.
        - Target {budget.TargetTestimonies} testimony x {budget.TargetEvidence} evidence, maximum {budget.MaxPairsPerCrack} pairs per Crack and {budget.MaxPairsPerCase} pairs for the complete case.
        - Use fewer candidates than the target if another choice would be filler. Evidence must also matter to the base mystery.
        - Every Crack dialogueAnswer must contain 45-100 whitespace-delimited words. Every testimony fragment must contain 5-25 words and occur verbatim inside that answer.
        - Every Crack must use at least two distinct acquisitionMethod values.
        - The signature Crack must contain a CAMERA_CAPTURE candidate. If there is one Crack, it is the one camera-containing Crack. Otherwise at least one and no more than half rounded up may contain camera evidence; prefer the minimum.

        Author every Crack backward from exactly one atomic contradiction. The correct evidence must establish the literal logical negation of the selected testimony with matching subject/actor, predicate/state, object, place, and time. Object movement, ownership, proximity, opportunity, contact, or timing does not identify an actor.

        For each testimony and evidence, declare semantics with subjectKind, subjectRef, predicate, objectRef, placeRef, timeScope, and polarity POSITIVE or NEGATIVE. Exactly one evidence/testimony semantic pair may match on every scope field with opposite polarity, and it must equal correctEvidenceId + testimonyFragmentId. Semantic annotations must accurately describe the literal text.

        The dialogueAnswer must contain every testimony text verbatim. Set startRequired lists to candidate subsets containing the authored correct IDs and at least two choices for each role. Optional candidates must not block starting. Use stable case-, stage-, scene-, challenge-, dlg-, fragment-, clue-, item-, puzzle-, or interaction- IDs.

        Evidence source topology is a runtime contract, not free-form semantic metadata. Use exactly these mappings:
        - CAMERA_CAPTURE: sourceType "camera" and sourceId exactly equal to sceneId. The evidence must be a static scene-scale environmental detail, never an NPC, worn/held item, movable character prop, text, or close-up.
        - ITEM_INSPECT: sourceType "item" and sourceId is the item- ID that full generation will create and place in the evidence scene.
        - PUZZLE_RESULT: sourceType "puzzle" and sourceId is the puzzle- ID that unlocks the clue.
        - ENVIRONMENT_INTERACTION, ITEM_USE, ITEM_COMBINATION: sourceType "interaction" and sourceId is the interaction- ID that unlocks the clue.
        Never output descriptive source types such as CHARACTER_ITEM, CHARACTER_WORN_ITEM, ELECTRICAL_PANEL, DEVICE, OBJECT, or LOCATION. Acquisition methods: CAMERA_CAPTURE, ITEM_INSPECT, PUZZLE_RESULT, ENVIRONMENT_INTERACTION, ITEM_USE, ITEM_COMBINATION.

        Plan the requested number of stages/scenes, cast, culprit, solution, downstream reveal, and progressionSceneIds in playable order. The culpritId must reference characters[].characterId and every progressionSceneId must reference scenes[].sceneId. Do not generate full hotspots, assets, dialogue trees, puzzles, or final GameCase JSON yet.

        {correction ?? string.Empty}
        {(string.IsNullOrWhiteSpace(previousJson) ? string.Empty : $"Previous blueprint to repair:\n{previousJson}")}
        """;
    }

    public static CaseValidationResult Validate(AiCaseBlueprint blueprint, AiDraftSettings settings)
    {
        var result = new CaseValidationResult();
        var budget = CrackGenerationBudgets.For(settings.GenerationPreset);
        if (string.IsNullOrWhiteSpace(blueprint.CaseId) || string.IsNullOrWhiteSpace(blueprint.Title)
            || string.IsNullOrWhiteSpace(blueprint.CulpritId) || blueprint.Scenes.Count == 0
            || blueprint.Characters.Count == 0)
            result.Add("BlueprintContract", "blueprint", "Blueprint requires caseId, title, cast, culpritId, and at least one scene.");
        ValidateUnique(blueprint.Characters.Select(item => item.CharacterId).ToList(), "blueprint.characters", result);
        ValidateUnique(blueprint.Scenes.Select(item => item.SceneId).ToList(), "blueprint.scenes", result);
        if (!blueprint.Characters.Any(item => item.CharacterId == blueprint.CulpritId))
            result.Add("BlueprintReference", "blueprint.culpritId", "Culprit must reference a blueprint character.");
        var sceneIds = blueprint.Scenes.Select(item => item.SceneId).ToHashSet(StringComparer.Ordinal);
        if (blueprint.ProgressionSceneIds.Count == 0
            || blueprint.ProgressionSceneIds.Distinct(StringComparer.Ordinal).Count() != blueprint.ProgressionSceneIds.Count
            || blueprint.ProgressionSceneIds.Any(id => !sceneIds.Contains(id)))
            result.Add("BlueprintReference", "blueprint.progressionSceneIds", "Progression must contain unique references to blueprint scenes.");
        if (blueprint.Cracks.Count < budget.MinCracks || blueprint.Cracks.Count > budget.MaxCracks)
            result.Add("SemanticBudget", "blueprint.cracks",
                $"{settings.GenerationPreset} requires {budget.MinCracks}-{budget.MaxCracks} Cracks; received {blueprint.Cracks.Count}.");
        if (blueprint.Cracks.Count(crack => crack.IsSignature) != 1)
            result.Add("BlueprintContract", "blueprint.cracks[].isSignature", "Exactly one Crack must be the signature Crack.");
        var orders = blueprint.Cracks.Select(crack => crack.Order).ToList();
        if (!orders.OrderBy(order => order).SequenceEqual(Enumerable.Range(1, orders.Count)))
            result.Add("BlueprintContract", "blueprint.cracks[].order", "Crack order must be contiguous and unique from 1 through the Crack count.");

        var pairTotal = 0;
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var usedTestimonyIds = new HashSet<string>(StringComparer.Ordinal);
        var cameraCrackCount = 0;
        foreach (var (crack, index) in blueprint.Cracks.Select((value, index) => (value, index)))
        {
            var path = $"blueprint.cracks[{index}]";
            if (!ids.Add(crack.ChallengeId)) result.Add("DuplicateId", $"{path}.challengeId", "Challenge IDs must be unique.");
            if (WordCount(crack.DialogueAnswer) is < 45 or > 100)
                result.Add("BlueprintContract", $"{path}.dialogueAnswer",
                    "A Crack source dialogue answer must contain 45-100 words.", crack.DialogueId);
            ValidateRange(crack.Testimonies.Count, budget.MinTestimonies, budget.MaxTestimonies, $"{path}.testimonies", result);
            ValidateRange(crack.Evidences.Count, budget.MinEvidence, budget.MaxEvidence, $"{path}.evidences", result);
            var pairCount = crack.Testimonies.Count * crack.Evidences.Count;
            pairTotal += pairCount;
            if (pairCount > budget.MaxPairsPerCrack)
                result.Add("SemanticBudget", path, $"Crack has {pairCount} pairs; maximum is {budget.MaxPairsPerCrack}.");

            var testimonyIds = crack.Testimonies.Select(item => item.Id).ToList();
            var evidenceIds = crack.Evidences.Select(item => item.ClueId).ToList();
            ValidateUnique(testimonyIds, $"{path}.testimonies", result);
            ValidateUnique(evidenceIds, $"{path}.evidences", result);
            if (!testimonyIds.Contains(crack.TestimonyFragmentId, StringComparer.Ordinal))
                result.Add("BlueprintContract", $"{path}.testimonyFragmentId", "Authored testimony must be a candidate.");
            if (!evidenceIds.Contains(crack.CorrectEvidenceId, StringComparer.Ordinal))
                result.Add("BlueprintContract", $"{path}.correctEvidenceId", "Authored evidence must be a candidate.");
            ValidateRequired(crack.StartRequiredTestimonyFragmentIds, testimonyIds, crack.TestimonyFragmentId,
                $"{path}.startRequiredTestimonyFragmentIds", result);
            ValidateRequired(crack.StartRequiredEvidenceIds, evidenceIds, crack.CorrectEvidenceId,
                $"{path}.startRequiredEvidenceIds", result);
            foreach (var testimony in crack.Testimonies)
            {
                ValidateSemantics(testimony.Semantics, $"{path}.testimonies[{testimony.Id}].semantics", result);
                if (!usedTestimonyIds.Add(testimony.Id))
                    result.Add("DuplicateId", $"{path}.testimonies[{testimony.Id}]",
                        "A testimony fragment cannot belong to more than one Crack.", testimony.Id);
                if (WordCount(testimony.Text) is < 5 or > 25)
                    result.Add("BlueprintContract", $"{path}.testimonies[{testimony.Id}].text",
                        "A testimony fragment must contain 5-25 words.", testimony.Id);
                if (!Normalize(crack.DialogueAnswer).Contains(Normalize(testimony.Text), StringComparison.Ordinal))
                    result.Add("BlueprintContract", $"{path}.dialogueAnswer", "Every testimony fragment must occur verbatim in the dialogue answer.", testimony.Id);
            }
            var acquisitionMethods = new HashSet<string>(StringComparer.Ordinal);
            foreach (var evidence in crack.Evidences)
            {
                ValidateSemantics(evidence.Semantics, $"{path}.evidences[{evidence.ClueId}].semantics", result);
                if (string.IsNullOrWhiteSpace(evidence.SourceType) || string.IsNullOrWhiteSpace(evidence.SourceId)
                    || string.IsNullOrWhiteSpace(evidence.AcquisitionMethod) || !sceneIds.Contains(evidence.SceneId))
                    result.Add("BlueprintReference", $"{path}.evidences[{evidence.ClueId}]",
                        "Evidence requires sourceType, sourceId, acquisitionMethod, and a valid sceneId.");
                ValidateRuntimeSource(evidence, $"{path}.evidences[{evidence.ClueId}]", result);
                var acquisitionMethod = EvidenceAcquisitionMethods.Normalize(evidence.AcquisitionMethod);
                if (!string.IsNullOrWhiteSpace(acquisitionMethod)) acquisitionMethods.Add(acquisitionMethod);
            }
            if (acquisitionMethods.Count < 2)
                result.Add("BlueprintContract", $"{path}.evidences",
                    "Each Crack must use at least two distinct evidence acquisition methods.", crack.ChallengeId);
            var hasCamera = acquisitionMethods.Contains(EvidenceAcquisitionMethods.CameraCapture);
            if (hasCamera) cameraCrackCount++;
            if (crack.IsSignature && !hasCamera)
                result.Add("BlueprintContract", $"{path}.isSignature",
                    "The signature Crack must contain at least one CAMERA_CAPTURE candidate.", crack.ChallengeId);

            var annotatedNegations = crack.Evidences.SelectMany(evidence => crack.Testimonies
                .Where(testimony => IsDirectNegation(evidence.Semantics, testimony.Semantics))
                .Select(testimony => (evidence.ClueId, testimony.Id))).ToList();
            if (annotatedNegations.Count != 1)
                result.Add("BlueprintSemantics", path,
                    $"Structured semantics must declare exactly one direct negation; received {annotatedNegations.Count}.");
            else if (annotatedNegations[0].ClueId != crack.CorrectEvidenceId
                     || annotatedNegations[0].Id != crack.TestimonyFragmentId)
                result.Add("BlueprintSemantics", path, "Structured semantic pair does not match the authored answer.");
        }
        if (pairTotal > budget.MaxPairsPerCase)
            result.Add("SemanticBudget", "blueprint.cracks",
                $"Case has {pairTotal} semantic pairs; maximum is {budget.MaxPairsPerCase}.");
        if (blueprint.Cracks.Count > 0)
        {
            var (minimumCameraCracks, maximumCameraCracks) = AiV3GenerationProfile.CameraCrackRange(blueprint.Cracks.Count);
            if (cameraCrackCount < minimumCameraCracks || cameraCrackCount > maximumCameraCracks)
                result.Add("BlueprintContract", "blueprint.cracks",
                    $"This case requires {minimumCameraCracks}-{maximumCameraCracks} camera-containing Cracks; received {cameraCrackCount}.");
        }
        return result;
    }

    public static GameCase ToReviewCase(AiCaseBlueprint blueprint, AiDraftSettings settings)
    {
        var gameCase = new GameCase
        {
            CaseId = blueprint.CaseId,
            Title = blueprint.Title,
            Summary = blueprint.Summary,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
            GenerationPreset = settings.GenerationPreset
        };
        foreach (var crack in blueprint.Cracks)
        {
            gameCase.Dialogues.Add(new CaseDialogue { DialogueId = crack.DialogueId, Answer = crack.DialogueAnswer });
            gameCase.TestimonyFragments.AddRange(crack.Testimonies.Select(item => new TestimonyFragment
            {
                Id = item.Id, DialogueId = crack.DialogueId, Text = item.Text
            }));
            gameCase.Clues.AddRange(crack.Evidences.Select(item => new CaseClue
            {
                ClueId = item.ClueId, Title = item.Title, Content = item.Content,
                NarrativeMeaning = item.NarrativeMeaning, AcquisitionMethod = item.AcquisitionMethod,
                SourceType = item.SourceType, DiscoverMethod = item.SourceType, Source = item.SourceId,
                SceneId = item.SceneId, IsEvidence = true
            }));
            gameCase.EvidenceChallenges.Add(new EvidenceChallenge
            {
                ChallengeId = crack.ChallengeId, Order = crack.Order, IsSignature = crack.IsSignature,
                DialogueId = crack.DialogueId, TestimonyFragmentId = crack.TestimonyFragmentId,
                CandidateTestimonyFragmentIds = crack.Testimonies.Select(item => item.Id).ToList(),
                StartRequiredTestimonyFragmentIds = crack.StartRequiredTestimonyFragmentIds,
                CorrectEvidenceId = crack.CorrectEvidenceId,
                CandidateEvidenceIds = crack.Evidences.Select(item => item.ClueId).ToList(),
                StartRequiredEvidenceIds = crack.StartRequiredEvidenceIds,
                Prompt = crack.Prompt, SuccessResponse = crack.SuccessResponse,
                FailureResponse = crack.FailureResponse, RevealTitle = crack.RevealTitle,
                UnlockClueIds = [crack.RevealClueId]
            });
        }
        return gameCase;
    }

    public static CaseValidationResult ValidateConformance(AiCaseBlueprint blueprint, GameCase gameCase)
    {
        var result = new CaseValidationResult();
        var expected = CrackContractHash(blueprint);
        var actual = CrackContractHash(gameCase, blueprint);
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
            result.Add("BlueprintDrift", "evidenceChallenges", "Generated full logic changed the reviewed Crack contract.");
        return result;
    }

    public static string BlueprintHash(AiCaseBlueprint blueprint) => Hash(JsonSerializer.Serialize(blueprint, JsonOptions));

    public static AiCaseBlueprint CanonicalizeForFullGeneration(AiCaseBlueprint blueprint)
    {
        var clone = JsonSerializer.Deserialize<AiCaseBlueprint>(JsonSerializer.Serialize(blueprint, JsonOptions), JsonOptions)
                    ?? throw new InvalidOperationException("Blueprint clone failed.");
        foreach (var evidence in clone.Cracks.SelectMany(crack => crack.Evidences))
        {
            var acquisitionMethod = EvidenceAcquisitionMethods.Normalize(evidence.AcquisitionMethod);
            var sourceType = RuntimeSourceType(acquisitionMethod);
            if (string.IsNullOrWhiteSpace(sourceType)) continue;
            evidence.AcquisitionMethod = acquisitionMethod;
            evidence.SourceType = sourceType;
            evidence.SourceId = RuntimeSourceId(evidence);
        }
        return clone;
    }

    public static void ApplyLockedCrackContract(AiCaseBlueprint blueprint, GameCase gameCase)
    {
        var locked = CanonicalizeForFullGeneration(blueprint);
        foreach (var expected in locked.Cracks)
        {
            var challenge = gameCase.EvidenceChallenges.FirstOrDefault(item => item.ChallengeId == expected.ChallengeId);
            if (challenge is null) continue;

            challenge.Order = expected.Order;
            challenge.IsSignature = expected.IsSignature;
            challenge.DialogueId = expected.DialogueId;
            challenge.TestimonyFragmentId = expected.TestimonyFragmentId;
            challenge.CandidateTestimonyFragmentIds = expected.Testimonies.Select(item => item.Id).ToList();
            challenge.StartRequiredTestimonyFragmentIds = expected.StartRequiredTestimonyFragmentIds.ToList();
            challenge.CorrectEvidenceId = expected.CorrectEvidenceId;
            challenge.CandidateEvidenceIds = expected.Evidences.Select(item => item.ClueId).ToList();
            challenge.StartRequiredEvidenceIds = expected.StartRequiredEvidenceIds.ToList();
            challenge.Prompt = expected.Prompt;
            challenge.SuccessResponse = expected.SuccessResponse;
            challenge.FailureResponse = expected.FailureResponse;
            challenge.RevealTitle = expected.RevealTitle;
            challenge.UnlockClueIds = [expected.RevealClueId];

            var dialogue = gameCase.Dialogues.FirstOrDefault(item => item.DialogueId == expected.DialogueId);
            if (dialogue is not null) dialogue.Answer = expected.DialogueAnswer;

            foreach (var testimony in expected.Testimonies)
            {
                var actual = gameCase.TestimonyFragments.FirstOrDefault(item => item.Id == testimony.Id);
                if (actual is null) continue;
                actual.DialogueId = expected.DialogueId;
                actual.Text = testimony.Text;
            }

            foreach (var evidence in expected.Evidences)
            {
                var actual = gameCase.Clues.FirstOrDefault(item => item.ClueId == evidence.ClueId);
                if (actual is null) continue;
                actual.Title = evidence.Title;
                actual.Content = evidence.Content;
                actual.NarrativeMeaning = evidence.NarrativeMeaning;
                actual.AcquisitionMethod = evidence.AcquisitionMethod;
                actual.SourceType = evidence.SourceType;
                actual.DiscoverMethod = evidence.SourceType;
                actual.Source = evidence.SourceId;
                actual.SceneId = evidence.SceneId;
                actual.IsEvidence = true;
            }

            var reveal = gameCase.Clues.FirstOrDefault(item => item.ClueId == expected.RevealClueId);
            if (reveal is not null)
            {
                reveal.Content = expected.RevealContent;
                reveal.SourceType = "dialogue";
                reveal.DiscoverMethod = "dialogue";
                reveal.Source = expected.DialogueId;
            }
        }
    }

    public static string CrackContractHash(AiCaseBlueprint blueprint) => Hash(JsonSerializer.Serialize(
        CanonicalizeForFullGeneration(blueprint).Cracks.OrderBy(crack => crack.Order).Select(crack => new
        {
            crack.ChallengeId,
            crack.Order,
            crack.IsSignature,
            crack.DialogueId,
            crack.DialogueAnswer,
            testimonies = crack.Testimonies.OrderBy(item => item.Id),
            evidences = crack.Evidences.OrderBy(item => item.ClueId),
            crack.TestimonyFragmentId,
            crack.CorrectEvidenceId,
            startRequiredTestimonyFragmentIds = crack.StartRequiredTestimonyFragmentIds.OrderBy(id => id),
            startRequiredEvidenceIds = crack.StartRequiredEvidenceIds.OrderBy(id => id),
            crack.Prompt,
            crack.SuccessResponse,
            crack.FailureResponse,
            crack.RevealTitle,
            crack.RevealClueId,
            crack.RevealContent
        }), JsonOptions));

    private static string CrackContractHash(GameCase gameCase, AiCaseBlueprint blueprint)
    {
        var projected = new List<AiCrackBlueprint>();
        foreach (var expected in blueprint.Cracks.OrderBy(crack => crack.Order))
        {
            var challenge = gameCase.EvidenceChallenges.SingleOrDefault(item => item.ChallengeId == expected.ChallengeId);
            if (challenge is null) return string.Empty;
            var dialogue = gameCase.Dialogues.SingleOrDefault(item => item.DialogueId == challenge.DialogueId);
            projected.Add(new AiCrackBlueprint
            {
                ChallengeId = challenge.ChallengeId, Order = challenge.Order, IsSignature = challenge.IsSignature,
                DialogueId = challenge.DialogueId, DialogueAnswer = dialogue?.Answer ?? string.Empty,
                Testimonies = challenge.CandidateTestimonyFragmentIds.Select(id =>
                {
                    var actual = gameCase.TestimonyFragments.SingleOrDefault(item => item.Id == id);
                    var source = expected.Testimonies.SingleOrDefault(item => item.Id == id);
                    return new AiBlueprintTestimony { Id = id, Text = actual?.Text ?? string.Empty, Semantics = source?.Semantics ?? new() };
                }).ToList(),
                Evidences = challenge.CandidateEvidenceIds.Select(id =>
                {
                    var actual = gameCase.Clues.SingleOrDefault(item => item.ClueId == id);
                    var source = expected.Evidences.SingleOrDefault(item => item.ClueId == id);
                    return new AiBlueprintEvidence
                    {
                        ClueId = id, Title = actual?.Title ?? string.Empty, Content = actual?.Content ?? string.Empty,
                        NarrativeMeaning = actual?.NarrativeMeaning ?? string.Empty,
                        AcquisitionMethod = actual?.AcquisitionMethod ?? string.Empty,
                        SourceType = actual?.SourceType ?? string.Empty, SourceId = actual?.Source ?? string.Empty,
                        SceneId = actual?.SceneId ?? string.Empty, Semantics = source?.Semantics ?? new()
                    };
                }).ToList(),
                TestimonyFragmentId = challenge.TestimonyFragmentId, CorrectEvidenceId = challenge.CorrectEvidenceId,
                StartRequiredTestimonyFragmentIds = challenge.StartRequiredTestimonyFragmentIds,
                StartRequiredEvidenceIds = challenge.StartRequiredEvidenceIds,
                Prompt = challenge.Prompt, SuccessResponse = challenge.SuccessResponse,
                FailureResponse = challenge.FailureResponse, RevealTitle = challenge.RevealTitle,
                RevealClueId = challenge.UnlockClueIds.SingleOrDefault() ?? string.Empty,
                RevealContent = gameCase.Clues.SingleOrDefault(item => challenge.UnlockClueIds.Contains(item.ClueId))?.Content ?? string.Empty
            });
        }
        return CrackContractHash(new AiCaseBlueprint { Cracks = projected });
    }

    private static void ValidateRuntimeSource(
        AiBlueprintEvidence evidence,
        string path,
        CaseValidationResult result)
    {
        var expectedSourceType = RuntimeSourceType(evidence.AcquisitionMethod);
        if (string.IsNullOrWhiteSpace(expectedSourceType))
        {
            result.Add("BlueprintSourceTopology", $"{path}.acquisitionMethod",
                "Evidence acquisitionMethod must be one of the supported Investigator acquisition methods.", evidence.ClueId);
            return;
        }

        if (!string.Equals(evidence.SourceType, expectedSourceType, StringComparison.Ordinal))
            result.Add("BlueprintSourceTopology", $"{path}.sourceType",
                $"{evidence.AcquisitionMethod} requires sourceType '{expectedSourceType}'.", evidence.ClueId);

        var expectedSourceId = RuntimeSourceId(evidence);
        if (!string.Equals(evidence.SourceId, expectedSourceId, StringComparison.Ordinal))
            result.Add("BlueprintSourceTopology", $"{path}.sourceId",
                $"{evidence.AcquisitionMethod} requires sourceId '{expectedSourceId}'.", evidence.ClueId);

        var requiredPrefix = EvidenceAcquisitionMethods.Normalize(evidence.AcquisitionMethod) switch
        {
            EvidenceAcquisitionMethods.ItemInspect => "item-",
            EvidenceAcquisitionMethods.PuzzleResult => "puzzle-",
            EvidenceAcquisitionMethods.EnvironmentInteraction
                or EvidenceAcquisitionMethods.ItemUse
                or EvidenceAcquisitionMethods.ItemCombination => "interaction-",
            _ => string.Empty
        };
        if (!string.IsNullOrWhiteSpace(requiredPrefix)
            && !evidence.SourceId.StartsWith(requiredPrefix, StringComparison.Ordinal))
            result.Add("BlueprintSourceTopology", $"{path}.sourceId",
                $"{evidence.AcquisitionMethod} sourceId must use the '{requiredPrefix}' prefix.", evidence.ClueId);
    }

    private static string RuntimeSourceType(string? acquisitionMethod) =>
        EvidenceAcquisitionMethods.Normalize(acquisitionMethod) switch
        {
            EvidenceAcquisitionMethods.CameraCapture => "camera",
            EvidenceAcquisitionMethods.ItemInspect => "item",
            EvidenceAcquisitionMethods.PuzzleResult => "puzzle",
            EvidenceAcquisitionMethods.EnvironmentInteraction
                or EvidenceAcquisitionMethods.ItemUse
                or EvidenceAcquisitionMethods.ItemCombination => "interaction",
            _ => string.Empty
        };

    private static string RuntimeSourceId(AiBlueprintEvidence evidence) =>
        EvidenceAcquisitionMethods.Normalize(evidence.AcquisitionMethod) == EvidenceAcquisitionMethods.CameraCapture
            ? evidence.SceneId
            : evidence.SourceId;

    private static int WordCount(string value) =>
        value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length;

    private static bool IsDirectNegation(AiSemanticProposition evidence, AiSemanticProposition testimony) =>
        Same(evidence.SubjectKind, testimony.SubjectKind)
        && Same(evidence.SubjectRef, testimony.SubjectRef)
        && Same(evidence.Predicate, testimony.Predicate)
        && Same(evidence.ObjectRef, testimony.ObjectRef)
        && Same(evidence.PlaceRef, testimony.PlaceRef)
        && Same(evidence.TimeScope, testimony.TimeScope)
        && ((Same(evidence.Polarity, "POSITIVE") && Same(testimony.Polarity, "NEGATIVE"))
            || (Same(evidence.Polarity, "NEGATIVE") && Same(testimony.Polarity, "POSITIVE")));

    private static void ValidateRange(int value, int min, int max, string path, CaseValidationResult result)
    {
        if (value < min || value > max) result.Add("SemanticBudget", path, $"Expected {min}-{max}; received {value}.");
    }

    private static void ValidateUnique(List<string> ids, string path, CaseValidationResult result)
    {
        if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct(StringComparer.Ordinal).Count() != ids.Count)
            result.Add("DuplicateId", path, "Candidate IDs must be non-empty and unique.");
    }

    private static void ValidateRequired(List<string> required, List<string> candidates, string correct, string path, CaseValidationResult result)
    {
        if (required.Count < 2 || required.Distinct(StringComparer.Ordinal).Count() != required.Count)
            result.Add("BlueprintContract", path, "Readiness requires at least two unique choices.");
        if (required.Any(id => !candidates.Contains(id, StringComparer.Ordinal)) || !required.Contains(correct, StringComparer.Ordinal))
            result.Add("BlueprintContract", path, "Readiness IDs must be candidates and include the authored correct choice.");
    }

    private static void ValidateSemantics(AiSemanticProposition semantics, string path, CaseValidationResult result)
    {
        if (string.IsNullOrWhiteSpace(semantics.SubjectKind)
            || string.IsNullOrWhiteSpace(semantics.SubjectRef)
            || string.IsNullOrWhiteSpace(semantics.Predicate)
            || string.IsNullOrWhiteSpace(semantics.ObjectRef)
            || string.IsNullOrWhiteSpace(semantics.PlaceRef)
            || string.IsNullOrWhiteSpace(semantics.TimeScope)
            || (!Same(semantics.Polarity, "POSITIVE") && !Same(semantics.Polarity, "NEGATIVE")))
            result.Add("BlueprintSemantics", path,
                "Semantic annotations require subject, predicate, object, place, time scope, and POSITIVE/NEGATIVE polarity.");
    }

    private static bool Same(string left, string right) =>
        string.Equals(Normalize(left), Normalize(right), StringComparison.Ordinal);
    private static string Normalize(string value) => string.Join(' ', value.Trim().ToLowerInvariant()
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
