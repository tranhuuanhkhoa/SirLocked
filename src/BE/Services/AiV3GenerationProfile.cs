using System.Globalization;
using System.Text;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Server-owned AI authoring profile for mechanics V3. V3 is deliberately a
/// strict superset of V2: the selected V2 preset remains authoritative and the
/// Crack-the-Lie challenges are validated as an additive layer.
/// </summary>
public static class AiV3GenerationProfile
{
    public const int FixedStageCount = 1; // legacy CRACK_THE_LIE_V3 preset only
    private const double MinimumReviewConfidence = 0.70;

    private static readonly string[] FailureLeakPhrases =
    [
        "đáp án là", "bằng chứng đúng", "hãy dùng", "answer is", "correct evidence", "use the"
    ];

    public static bool IsV3Preset(string? preset) =>
        string.Equals(AiGenerationPresets.Normalize(preset), AiGenerationPresets.CrackTheLieV3, StringComparison.Ordinal);

    public static bool IsV3(AiDraftSettings? settings) =>
        settings is not null
        && (settings.IncludeCrackTheLie
            || settings.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation
            || IsV3Preset(settings.GenerationPreset));

    public static bool IsV3(AiCaseDraft? draft) => draft is not null && IsV3(draft.Settings);

    public static bool IsV3(GameCase? gameCase) =>
        gameCase?.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation;

    public static (int Minimum, int Maximum) CrackRange(string? preset)
    {
        var budget = CrackGenerationBudgets.For(preset);
        return (budget.MinCracks, budget.MaxCracks);
    }

    public static (int Minimum, int Maximum) CameraCrackRange(int crackCount) =>
        crackCount <= 1
            ? (1, 1)
            : (1, Math.Max(1, (crackCount + 1) / 2));

    public static void ApplyServerOwnedFields(
        AiCaseDraft draft,
        GameCase gameCase,
        bool includeReviewStatus = false,
        bool resetGeneratedAssets = false)
    {
        var isV3 = IsV3(draft);
        gameCase.Status = CaseStatus.Draft;
        gameCase.MechanicsVersion = isV3
            ? CaseMechanicsVersions.InvestigationV3PairedConfrontation
            : CaseMechanicsVersions.InvestigationV2;
        // V3 now uses the normal V2 content/layout pipeline; mechanicsVersion is
        // the privacy/state-machine boundary, not a separate runtime application.
        gameCase.GenerationMode = IsV3Preset(draft.Settings.GenerationPreset)
            ? CaseGenerationModes.PlacementFirst
            : CaseGenerationModes.CameraEmbedded;
        gameCase.GenerationPreset = AiGenerationPresets.Normalize(draft.Settings.GenerationPreset);
        gameCase.SourceAiDraftId = draft.Id;
        gameCase.AiSemanticReviewStatus = includeReviewStatus && isV3
            ? draft.V3SemanticReview.Status
            : string.Empty;
        if (!resetGeneratedAssets) return;

        gameCase.CoverImageUrl = string.Empty;
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            scene.BackgroundUrl = string.Empty;
            scene.PlacementPlan = null;
            scene.Runtime = null;
        }
        foreach (var character in gameCase.Characters) character.ImageUrl = string.Empty;
        foreach (var item in gameCase.Items) item.ImageUrl = string.Empty;
    }

    public static void NormalizePresentation(GameCase gameCase)
    {
        gameCase.Title = gameCase.Title.Trim();
        gameCase.Summary = gameCase.Summary.Trim();
        foreach (var clue in gameCase.Clues)
            clue.AcquisitionMethod = EvidenceAcquisitionMethods.Normalize(clue.AcquisitionMethod);
        foreach (var dialogue in gameCase.Dialogues)
        {
            dialogue.Question = dialogue.Question.Trim();
            dialogue.Answer = dialogue.Answer.Trim();
        }
        foreach (var fragment in gameCase.TestimonyFragments)
        {
            fragment.Id = fragment.Id.Trim();
            fragment.DialogueId = fragment.DialogueId.Trim();
            fragment.Text = fragment.Text.Trim();
        }
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            challenge.Prompt = challenge.Prompt.Trim();
            challenge.SuccessResponse = challenge.SuccessResponse.Trim();
            challenge.FailureResponse = challenge.FailureResponse.Trim();
            challenge.RevealTitle = challenge.RevealTitle.Trim();
            NormalizeCandidateIds(challenge.CandidateEvidenceIds);
            NormalizeCandidateIds(challenge.CandidateTestimonyFragmentIds);
            NormalizeCandidateIds(challenge.StartRequiredEvidenceIds);
            NormalizeCandidateIds(challenge.StartRequiredTestimonyFragmentIds);
        }
        if (IsV3Preset(gameCase.GenerationPreset) && gameCase.EvidenceChallenges.Count == 1)
        {
            // Compatibility normalization for saved drafts authored before the
            // additive order/signature metadata existed.
            gameCase.EvidenceChallenges[0].Order = Math.Max(1, gameCase.EvidenceChallenges[0].Order);
            gameCase.EvidenceChallenges[0].IsSignature = true;
        }
    }

    public static CaseValidationResult Validate(GameCase gameCase)
    {
        var result = new CaseValidationResult();
        if (!IsV3(gameCase)) return result;

        var budget = CrackGenerationBudgets.For(gameCase.GenerationPreset);
        var (minimumCracks, maximumCracks) = (budget.MinCracks, budget.MaxCracks);
        if (gameCase.EvidenceChallenges.Count < minimumCracks || gameCase.EvidenceChallenges.Count > maximumCracks)
            result.Add("PresetContract", "evidenceChallenges",
                $"{gameCase.GenerationPreset} with Crack the Lie requires {minimumCracks}-{maximumCracks} paired challenges.");

        var signatureCount = gameCase.EvidenceChallenges.Count(challenge => challenge.IsSignature);
        if (signatureCount != 1)
            result.Add("PresetContract", "evidenceChallenges[].isSignature", "Exactly one Crack challenge must be marked as the signature Crack.");

        var orders = gameCase.EvidenceChallenges.Select(challenge => challenge.Order).ToList();
        if (orders.OrderBy(order => order).SequenceEqual(Enumerable.Range(1, orders.Count)) == false)
            result.Add("PresetContract", "evidenceChallenges[].order", "Crack order must be contiguous and unique from 1 through the challenge count.");

        var usedFragments = new HashSet<string>(StringComparer.Ordinal);
        var cameraCrackCount = 0;
        var casePairCount = 0;
        for (var index = 0; index < gameCase.EvidenceChallenges.Count; index++)
        {
            var challenge = gameCase.EvidenceChallenges[index];
            ValidateChallenge(gameCase, challenge, index, usedFragments, budget, result);
            casePairCount += challenge.CandidateEvidenceIds.Count * challenge.CandidateTestimonyFragmentIds.Count;
            var methods = challenge.CandidateEvidenceIds
                .Select(id => gameCase.Clues.FirstOrDefault(clue => clue.ClueId == id))
                .Where(clue => clue is not null)
                .Select(clue => ResolveAcquisitionMethod(gameCase, clue!))
                .ToList();
            var hasCamera = methods.Contains(EvidenceAcquisitionMethods.CameraCapture, StringComparer.Ordinal);
            if (hasCamera) cameraCrackCount++;
            if (challenge.IsSignature && !hasCamera)
                result.Add("PresetContract", $"evidenceChallenges[{index}].isSignature",
                    "The signature Crack must contain at least one CAMERA_CAPTURE candidate.", challenge.ChallengeId);
        }

        if (casePairCount > budget.MaxPairsPerCase)
            result.Add("SemanticBudget", "evidenceChallenges",
                $"{gameCase.GenerationPreset} allows at most {budget.MaxPairsPerCase} semantic pairs per case; received {casePairCount}.");

        if (gameCase.EvidenceChallenges.Count > 0)
        {
            var (minimumCameraCracks, maximumCameraCracks) = CameraCrackRange(gameCase.EvidenceChallenges.Count);
            if (cameraCrackCount < minimumCameraCracks || cameraCrackCount > maximumCameraCracks)
                result.Add("PresetContract", "evidenceChallenges",
                    $"This case requires {minimumCameraCracks}-{maximumCameraCracks} camera-containing Crack challenges; received {cameraCrackCount}.");
        }

        if (IsV3Preset(gameCase.GenerationPreset))
            ValidateRetiredStandalonePreset(gameCase, result);

        return result;
    }

    private static void ValidateRetiredStandalonePreset(GameCase gameCase, CaseValidationResult result)
    {
        // Compatibility gate for drafts created by the former dedicated
        // CRACK_THE_LIE_V3 preset. The preset is hidden for new creation, but
        // saved drafts still need deterministic review and repair.
        var challenge = gameCase.EvidenceChallenges.SingleOrDefault();
        if (challenge is null) return;
        var candidates = challenge.CandidateEvidenceIds
            .Select(id => gameCase.Clues.FirstOrDefault(clue => clue.ClueId == id))
            .Where(clue => clue is not null)
            .Cast<CaseClue>()
            .ToList();
        var cameraCount = candidates.Count(clue => ResolveAcquisitionMethod(gameCase, clue)
            == EvidenceAcquisitionMethods.CameraCapture);
        var itemCount = candidates.Count(EvidenceDiscoveryMethods.IsItemInspect);
        if (cameraCount != 1)
            result.Add("PresetContract", "evidenceChallenges[0].candidateEvidenceIds",
                "The retired standalone preset requires exactly one CAMERA_CAPTURE candidate.");
        if (itemCount != 2)
            result.Add("PresetContract", "evidenceChallenges[0].candidateEvidenceIds",
                "The retired standalone preset requires exactly two ITEM_INSPECT candidates.");

        var itemEvidenceIds = candidates
            .Where(EvidenceDiscoveryMethods.IsItemInspect)
            .Select(clue => clue.ClueId)
            .ToHashSet(StringComparer.Ordinal);
        var mapped = gameCase.Items.SelectMany(item => item.UnlockClueIds
                .Where(itemEvidenceIds.Contains)
                .Select(clueId => (item.ItemId, clueId)))
            .ToList();
        if (itemEvidenceIds.Count == 2
            && (mapped.Count != 2
                || mapped.Select(pair => pair.ItemId).Distinct(StringComparer.Ordinal).Count() != 2
                || mapped.Select(pair => pair.clueId).Distinct(StringComparer.Ordinal).Count() != 2))
        {
            result.Add("PresetContract", "clue:item-evidence.source",
                "The retired preset requires a one-to-one item-to-evidence mapping.");
        }

        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes).Where(scene => scene.Runtime is not null))
        {
            var invalidZones = scene.Runtime!.ClueZones
                .Where(zone => candidates.Any(clue => clue.ClueId == zone.ClueId
                    && ResolveAcquisitionMethod(gameCase, clue) != EvidenceAcquisitionMethods.CameraCapture))
                .ToList();
            if (invalidZones.Count > 0)
                result.Add("PresetContract", $"scene:{scene.SceneId}.runtime.clueZones",
                    "Only the CAMERA_CAPTURE candidate may have a runtime clue zone in the retired preset.");
        }
    }

    public static AiV3SemanticReview EvaluateReview(GameCase gameCase, AiV3SemanticReview review)
    {
        review.SchemaVersion = AiGenerationSchemaVersions.V3SemanticReview;
        review.ReviewedAt = DateTime.UtcNow;

        // Legacy one-Crack drafts stored a flat matrix. Promote it in memory so
        // the same evaluator and UI can handle both document shapes.
        if (review.Cracks.Count == 0 && gameCase.EvidenceChallenges.Count == 1 && review.PairEvaluations.Count > 0)
        {
            review.Cracks.Add(new AiV3CrackReview
            {
                ChallengeId = gameCase.EvidenceChallenges[0].ChallengeId,
                PairEvaluations = review.PairEvaluations
            });
        }

        var incomplete = review.Cracks.Count != gameCase.EvidenceChallenges.Count;
        var failed = false;
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            var crack = review.Cracks.SingleOrDefault(candidate => candidate.ChallengeId == challenge.ChallengeId);
            if (crack is null)
            {
                incomplete = true;
                continue;
            }

            var expectedPairs = challenge.CandidateEvidenceIds
                .SelectMany(evidenceId => challenge.CandidateTestimonyFragmentIds
                    .Select(fragmentId => PairKey(evidenceId, fragmentId)))
                .ToHashSet(StringComparer.Ordinal);
            var actualPairs = crack.PairEvaluations.Select(item => PairKey(item.EvidenceId, item.TestimonyFragmentId)).ToList();
            foreach (var evaluation in crack.PairEvaluations)
            {
                if (string.IsNullOrWhiteSpace(evaluation.ReasonCode))
                    evaluation.ReasonCode = evaluation.IsValidContradiction
                        ? AiV3SemanticReasonCodes.DirectNegation
                        : AiV3SemanticReasonCodes.RelatedOnly;
            }
            var expectedPairCount = expectedPairs.Count;
            crack.ExpectedPairCount = expectedPairCount;
            if (crack.PairEvaluations.Count != expectedPairCount
                || actualPairs.Distinct(StringComparer.Ordinal).Count() != expectedPairCount
                || !actualPairs.ToHashSet(StringComparer.Ordinal).SetEquals(expectedPairs)
                || crack.PairEvaluations.Any(item => string.IsNullOrWhiteSpace(item.Reason)
                    || !AiV3SemanticReasonCodes.All.Contains(item.ReasonCode)
                    || item.Confidence is < MinimumReviewConfidence or > 1))
            {
                incomplete = true;
                continue;
            }

            // A real investigation can have several traces that refute the same lie, so extra valid
            // pairs are tolerated. The requirement is only that the authored answer is genuinely one
            // of them; a Crack whose declared pair does not contradict anything is still rejected.
            if (!crack.PairEvaluations.Any(item => item.IsValidContradiction
                    && item.EvidenceId == challenge.CorrectEvidenceId
                    && item.TestimonyFragmentId == challenge.TestimonyFragmentId))
                failed = true;
        }

        review.Status = incomplete
            ? AiV3SemanticReviewStatuses.Ambiguous
            : failed
                ? AiV3SemanticReviewStatuses.Failed
                : AiV3SemanticReviewStatuses.Passed;
        return review;
    }

    public static string ResolveAcquisitionMethod(GameCase gameCase, CaseClue clue)
    {
        var explicitMethod = EvidenceAcquisitionMethods.Normalize(clue.AcquisitionMethod);
        if (!string.IsNullOrWhiteSpace(explicitMethod)) return explicitMethod;
        if (EvidenceDiscoveryMethods.IsCamera(clue)) return EvidenceAcquisitionMethods.CameraCapture;
        if (EvidenceDiscoveryMethods.IsItemInspect(clue)
            && gameCase.Items.Any(item => item.ItemId == clue.Source && item.UnlockClueIds.Contains(clue.ClueId)))
            return EvidenceAcquisitionMethods.ItemInspect;
        if (gameCase.Puzzles.Any(puzzle => puzzle.PuzzleId == clue.Source && puzzle.UnlockClueIds.Contains(clue.ClueId)))
            return EvidenceAcquisitionMethods.PuzzleResult;

        var interaction = gameCase.Interactions.FirstOrDefault(candidate =>
            candidate.InteractionId == clue.Source && candidate.UnlockClueIds.Contains(clue.ClueId));
        return interaction?.Type.ToUpperInvariant() switch
        {
            CaseInteractionTypes.InspectEnvironment => EvidenceAcquisitionMethods.EnvironmentInteraction,
            CaseInteractionTypes.UseItemOnTarget => EvidenceAcquisitionMethods.ItemUse,
            CaseInteractionTypes.CombineItems => EvidenceAcquisitionMethods.ItemCombination,
            _ => string.Empty
        };
    }

    internal static string NormalizeClaimText(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormC).ToLowerInvariant();
        var builder = new StringBuilder(normalized.Length);
        var pendingSpace = false;
        foreach (var rune in normalized.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (category is UnicodeCategory.ConnectorPunctuation or UnicodeCategory.DashPunctuation
                or UnicodeCategory.OpenPunctuation or UnicodeCategory.ClosePunctuation
                or UnicodeCategory.InitialQuotePunctuation or UnicodeCategory.FinalQuotePunctuation
                or UnicodeCategory.OtherPunctuation || Rune.IsWhiteSpace(rune))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }
            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }
            builder.Append(rune.ToString());
        }
        return builder.ToString().Trim();
    }

    private static void ValidateChallenge(
        GameCase gameCase,
        EvidenceChallenge challenge,
        int index,
        HashSet<string> usedFragments,
        CrackGenerationBudget budget,
        CaseValidationResult result)
    {
        var path = $"evidenceChallenges[{index}]";
        ValidateCandidateSet(challenge.CandidateEvidenceIds, $"{path}.candidateEvidenceIds",
            budget.MinEvidence, budget.MaxEvidence, "evidence", result);
        ValidateCandidateSet(challenge.CandidateTestimonyFragmentIds, $"{path}.candidateTestimonyFragmentIds",
            budget.MinTestimonies, budget.MaxTestimonies, "testimony", result);
        var pairCount = challenge.CandidateEvidenceIds.Count * challenge.CandidateTestimonyFragmentIds.Count;
        if (pairCount > budget.MaxPairsPerCrack)
            result.Add("SemanticBudget", path,
                $"This Crack allows at most {budget.MaxPairsPerCrack} semantic pairs; received {pairCount}.", challenge.ChallengeId);
        if (!challenge.CandidateEvidenceIds.Contains(challenge.CorrectEvidenceId, StringComparer.Ordinal))
            result.Add("PresetContract", $"{path}.correctEvidenceId", "Correct evidence must belong to candidateEvidenceIds.", challenge.CorrectEvidenceId);
        if (!challenge.CandidateTestimonyFragmentIds.Contains(challenge.TestimonyFragmentId, StringComparer.Ordinal))
            result.Add("PresetContract", $"{path}.testimonyFragmentId", "Correct testimony must belong to candidateTestimonyFragmentIds.", challenge.TestimonyFragmentId);

        var dialogue = gameCase.Dialogues.FirstOrDefault(candidate => candidate.DialogueId == challenge.DialogueId);
        if (dialogue is not null && WordCount(dialogue.Answer) is < 45 or > 100)
            result.Add("PresetContract", $"dialogue:{dialogue.DialogueId}.answer",
                "A Crack source dialogue answer must contain 45-100 words.", dialogue.DialogueId);
        var methods = new HashSet<string>(StringComparer.Ordinal);
        var normalizedClaims = new HashSet<string>(StringComparer.Ordinal);
        foreach (var fragmentId in challenge.CandidateTestimonyFragmentIds)
        {
            if (!usedFragments.Add(fragmentId))
                result.Add("PresetContract", $"{path}.candidateTestimonyFragmentIds", "A testimony fragment cannot belong to more than one Crack.", fragmentId);
            var fragment = gameCase.TestimonyFragments.FirstOrDefault(candidate => candidate.Id == fragmentId);
            if (fragment is null || fragment.DialogueId != challenge.DialogueId)
            {
                result.Add("MissingReference", $"{path}.candidateTestimonyFragmentIds", "Every candidate fragment must belong to the challenge dialogue.", fragmentId);
                continue;
            }
            var normalizedFragment = NormalizeClaimText(fragment.Text);
            var normalizedAnswer = NormalizeClaimText(dialogue?.Answer ?? string.Empty);
            if (WordCount(fragment.Text) is < 5 or > 25)
                result.Add("PresetContract", $"testimony:{fragment.Id}.text",
                    "A testimony fragment must contain 5-25 words.", fragment.Id);
            if (!normalizedClaims.Add(normalizedFragment))
                result.Add("PresetContract", $"{path}.candidateTestimonyFragmentIds",
                    "Candidate testimony fragments must contain distinct claims.", fragment.Id);
            if (string.IsNullOrWhiteSpace(normalizedFragment) || !normalizedAnswer.Contains(normalizedFragment, StringComparison.Ordinal))
                result.Add("PresetContract", $"testimony:{fragment.Id}.text", "The fragment must be an exact claim from its dialogue answer.", fragment.Id);
        }

        foreach (var evidenceId in challenge.CandidateEvidenceIds)
        {
            var clue = gameCase.Clues.FirstOrDefault(candidate => candidate.ClueId == evidenceId);
            if (clue is null || !clue.IsEvidence)
            {
                result.Add("MissingReference", $"{path}.candidateEvidenceIds", "Every candidate must be an evidence clue.", evidenceId);
                continue;
            }
            var method = ResolveAcquisitionMethod(gameCase, clue);
            if (string.IsNullOrWhiteSpace(method) || !HasValidInvestigatorSource(gameCase, clue, method))
                result.Add("UndiscoverableEvidence", $"clue:{clue.ClueId}.acquisitionMethod",
                    "Candidate evidence needs a valid Investigator-controlled acquisition path.", clue.ClueId);
            else
                methods.Add(method);
            if (HasDirectCircularPrerequisite(gameCase, challenge, clue))
                result.Add("CircularDependency", $"clue:{clue.ClueId}.acquisitionMethod",
                    "Candidate evidence cannot depend on the reveal produced by its own Crack.", clue.ClueId);
            if (string.Equals(clue.SourceType, "dialogue", StringComparison.OrdinalIgnoreCase)
                || string.Equals(clue.DiscoverMethod, "dialogue", StringComparison.OrdinalIgnoreCase))
                result.Add("PresetContract", $"clue:{clue.ClueId}", "Dialogue-sourced clues cannot be physical evidence candidates.", clue.ClueId);
        }
        if (methods.Count < 2)
            result.Add("PresetContract", $"{path}.candidateEvidenceIds", "Each Crack must use at least two distinct evidence acquisition methods.", challenge.ChallengeId);

        ValidateReadinessSet(
            challenge.StartRequiredEvidenceIds,
            challenge.CandidateEvidenceIds,
            challenge.CorrectEvidenceId,
            $"{path}.startRequiredEvidenceIds",
            "evidence",
            result);
        ValidateReadinessSet(
            challenge.StartRequiredTestimonyFragmentIds,
            challenge.CandidateTestimonyFragmentIds,
            challenge.TestimonyFragmentId,
            $"{path}.startRequiredTestimonyFragmentIds",
            "testimony",
            result);

        var revealIds = challenge.UnlockClueIds.ToHashSet(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(challenge.Prompt)
            || string.IsNullOrWhiteSpace(challenge.SuccessResponse)
            || string.IsNullOrWhiteSpace(challenge.FailureResponse)
            || string.IsNullOrWhiteSpace(challenge.RevealTitle))
            result.Add("MissingField", path, "Every Crack needs prompt, successResponse, failureResponse, and revealTitle.", challenge.ChallengeId);
        if (revealIds.Count == 0 || revealIds.Overlaps(challenge.CandidateEvidenceIds))
            result.Add("PresetContract", $"{path}.unlockClueIds", "A Crack must unlock a downstream reveal that is not a candidate evidence clue.", challenge.ChallengeId);
        foreach (var revealId in revealIds)
        {
            var availableElsewhere = gameCase.Items.Any(item => item.UnlockClueIds.Contains(revealId))
                || gameCase.Dialogues.Any(item => item.UnlockClueIds.Contains(revealId))
                || gameCase.ConversationNodes.Any(item => item.UnlockClueIds.Contains(revealId))
                || gameCase.Interactions.Any(item => item.UnlockClueIds.Contains(revealId))
                || gameCase.Puzzles.Any(item => item.UnlockClueIds.Contains(revealId))
                || gameCase.Deductions.Any(item => item.UnlockClueIds.Contains(revealId))
                || gameCase.EvidenceChallenges.Any(other => other != challenge && other.UnlockClueIds.Contains(revealId));
            if (availableElsewhere)
                result.Add("PresetContract", $"{path}.unlockClueIds", "Reveal clues must only be unlocked by their correct Crack.", revealId);
        }

        ValidateFailureLeak(gameCase, challenge, path, result);
    }

    private static bool HasValidInvestigatorSource(GameCase gameCase, CaseClue clue, string method)
    {
        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes).ToList();
        return method switch
        {
            EvidenceAcquisitionMethods.CameraCapture =>
                EvidenceDiscoveryMethods.IsCamera(clue)
                && scenes.Any(scene => scene.SceneId == clue.SceneId && clue.Source == scene.SceneId),
            EvidenceAcquisitionMethods.ItemInspect =>
                gameCase.Items.Any(item => item.ItemId == clue.Source && item.UnlockClueIds.Contains(clue.ClueId))
                && scenes.Any(scene => scene.ItemIds.Contains(clue.Source)),
            EvidenceAcquisitionMethods.PuzzleResult =>
                HasSourceFields(clue, "puzzle")
                && gameCase.Puzzles.Any(puzzle => puzzle.PuzzleId == clue.Source && puzzle.UnlockClueIds.Contains(clue.ClueId)),
            EvidenceAcquisitionMethods.EnvironmentInteraction => HasInteractionSource(gameCase, clue, CaseInteractionTypes.InspectEnvironment),
            EvidenceAcquisitionMethods.ItemUse => HasInteractionSource(gameCase, clue, CaseInteractionTypes.UseItemOnTarget),
            EvidenceAcquisitionMethods.ItemCombination => HasInteractionSource(gameCase, clue, CaseInteractionTypes.CombineItems),
            _ => false
        };
    }

    private static bool HasInteractionSource(GameCase gameCase, CaseClue clue, string type) =>
        HasSourceFields(clue, "interaction")
        && gameCase.Interactions.Any(interaction => interaction.InteractionId == clue.Source
            && interaction.Type.Equals(type, StringComparison.OrdinalIgnoreCase)
            && interaction.UnlockClueIds.Contains(clue.ClueId));

    private static bool HasSourceFields(CaseClue clue, string expected) =>
        string.Equals(clue.SourceType, expected, StringComparison.OrdinalIgnoreCase)
        && string.Equals(clue.DiscoverMethod, expected, StringComparison.OrdinalIgnoreCase);

    private static bool HasDirectCircularPrerequisite(
        GameCase gameCase,
        EvidenceChallenge challenge,
        CaseClue clue)
    {
        var revealIds = challenge.UnlockClueIds.ToHashSet(StringComparer.Ordinal);
        if (revealIds.Contains(clue.ClueId)) return true;
        return ResolveAcquisitionMethod(gameCase, clue) switch
        {
            EvidenceAcquisitionMethods.ItemInspect => gameCase.Stages.SelectMany(stage => stage.Scenes)
                .SelectMany(scene => scene.Hotspots)
                .Any(hotspot => hotspot.TargetId == clue.Source && hotspot.RequiredClueIds.Any(revealIds.Contains)),
            EvidenceAcquisitionMethods.PuzzleResult => gameCase.Puzzles.Any(puzzle => puzzle.PuzzleId == clue.Source
                && puzzle.RequiredClueIds.Any(revealIds.Contains)),
            EvidenceAcquisitionMethods.EnvironmentInteraction
                or EvidenceAcquisitionMethods.ItemUse
                or EvidenceAcquisitionMethods.ItemCombination => gameCase.Interactions.Any(interaction =>
                    interaction.InteractionId == clue.Source && interaction.RequiredClueIds.Any(revealIds.Contains)),
            _ => false
        };
    }

    private static void ValidateFailureLeak(
        GameCase gameCase,
        EvidenceChallenge challenge,
        string path,
        CaseValidationResult result)
    {
        var failure = NormalizeClaimText(challenge.FailureResponse);
        var forbidden = new List<string>
        {
            challenge.CorrectEvidenceId,
            gameCase.Clues.FirstOrDefault(item => item.ClueId == challenge.CorrectEvidenceId)?.Title ?? string.Empty,
            challenge.TestimonyFragmentId,
            gameCase.TestimonyFragments.FirstOrDefault(item => item.Id == challenge.TestimonyFragmentId)?.Text ?? string.Empty
        };
        forbidden.AddRange(challenge.UnlockClueIds.SelectMany(id =>
        {
            var clue = gameCase.Clues.FirstOrDefault(item => item.ClueId == id);
            return new[] { id, clue?.Title ?? string.Empty };
        }));
        if (forbidden.Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(NormalizeClaimText).Any(secret => failure.Contains(secret, StringComparison.Ordinal))
            || FailureLeakPhrases.Any(phrase => failure.Contains(NormalizeClaimText(phrase), StringComparison.Ordinal)))
            result.Add("SecretLeak", $"{path}.failureResponse", "Failure feedback exposes or points toward the declared answer.", challenge.ChallengeId);
    }

    private static void ValidateCandidateSet(
        List<string> values,
        string path,
        int minimum,
        int maximum,
        string label,
        CaseValidationResult result)
    {
        if (values.Count < minimum || values.Count > maximum)
            result.Add("PresetContract", path,
                $"Every Crack must contain {minimum}-{maximum} {label} candidates; received {values.Count}.");
        if (values.Distinct(StringComparer.Ordinal).Count() != values.Count)
            result.Add("PresetContract", path, $"Every Crack {label} candidate ID must be unique.");
    }

    private static void ValidateReadinessSet(
        List<string> configured,
        List<string> candidates,
        string correctId,
        string path,
        string label,
        CaseValidationResult result)
    {
        var required = configured.Count == 0 ? candidates : configured;
        if (required.Count < 2)
            result.Add("PresetContract", path, $"At least two {label} choices must be available when a Crack starts.");
        if (required.Distinct(StringComparer.Ordinal).Count() != required.Count)
            result.Add("PresetContract", path, $"Start-required {label} IDs must be unique.");
        foreach (var id in required.Where(id => !candidates.Contains(id, StringComparer.Ordinal)))
            result.Add("PresetContract", path, $"Start-required {label} must belong to the candidate list.", id);
        if (!required.Contains(correctId, StringComparer.Ordinal))
            result.Add("PresetContract", path, $"Start-required {label} must contain the authored correct choice.", correctId);
    }

    public static IReadOnlyList<string> ResolveStartRequiredEvidenceIds(EvidenceChallenge challenge) =>
        challenge.StartRequiredEvidenceIds.Count == 0
            ? challenge.CandidateEvidenceIds
            : challenge.StartRequiredEvidenceIds;

    public static IReadOnlyList<string> ResolveStartRequiredTestimonyIds(EvidenceChallenge challenge) =>
        challenge.StartRequiredTestimonyFragmentIds.Count == 0
            ? challenge.CandidateTestimonyFragmentIds
            : challenge.StartRequiredTestimonyFragmentIds;

    private static string PairKey(string evidenceId, string fragmentId) => $"{evidenceId}\u001f{fragmentId}";

    private static int WordCount(string value) =>
        value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length;

    private static void NormalizeCandidateIds(List<string> values)
    {
        var normalized = values.Select(value => value.Trim()).Where(value => value.Length > 0)
            .OrderBy(value => value, StringComparer.Ordinal).ToList();
        values.Clear();
        values.AddRange(normalized);
    }
}
