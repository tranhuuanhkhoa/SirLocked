using System.Text.Json;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public static class AiV3SemanticReviewPolicy
{
    private static readonly JsonSerializerOptions PrettyJson = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static string BuildPrompt(GameCase gameCase, IReadOnlyCollection<string>? challengeIds = null)
    {
        var selectedIds = challengeIds?.ToHashSet(StringComparer.Ordinal);
        var cracks = gameCase.EvidenceChallenges
            .Where(challenge => selectedIds is null || selectedIds.Contains(challenge.ChallengeId))
            .OrderBy(challenge => challenge.Order).Select(challenge =>
        {
            var evidence = challenge.CandidateEvidenceIds.Select(id =>
            {
                var clue = gameCase.Clues.Single(item => item.ClueId == id);
                var sourceItem = gameCase.Items.FirstOrDefault(item => item.ItemId == clue.Source);
                return new
                {
                    evidenceId = id,
                    acquisition = AiV3GenerationProfile.ResolveAcquisitionMethod(gameCase, clue),
                    clue.Title,
                    clue.Content,
                    clue.NarrativeMeaning,
                    inspectText = sourceItem?.InspectText,
                    cameraTarget = EvidenceDiscoveryMethods.IsCamera(clue) ? clue.VisualDescription : null
                };
            });
            var testimony = challenge.CandidateTestimonyFragmentIds.Select(id =>
            {
                var fragment = gameCase.TestimonyFragments.Single(item => item.Id == id);
                return new { testimonyFragmentId = id, fragment.Text };
            });
            return new
            {
                challengeId = challenge.ChallengeId,
                expectedPairCount = challenge.CandidateEvidenceIds.Count * challenge.CandidateTestimonyFragmentIds.Count,
                expectedPairKeys = challenge.CandidateEvidenceIds.SelectMany(evidenceId =>
                    challenge.CandidateTestimonyFragmentIds.Select(fragmentId => $"{evidenceId}\u001f{fragmentId}")),
                dialogueAnswer = gameCase.Dialogues.Single(item => item.DialogueId == challenge.DialogueId).Answer,
                evidence,
                testimony
            };
        });
        return $"""
        Independently review each detective-game contradiction matrix. Candidate counts are dynamic and you are not told the authored answer.
        For every challenge, evaluate every Cartesian-product pair exactly once.

        A pair is a valid direct contradiction only when all of these tests pass:
        1. Atomic negation: the evidence establishes the logical negation of the selected claim, not merely a related fact.
        2. Entity alignment: subject/actor, action or state, object, place, and time scope match wherever the claim specifies them.
        3. No missing inference: the contradiction follows from the supplied physical observation alone without guessing identity, intent, custody, causation, or an unseen action.

        Apply these conservative examples:
        - Evidence that an object moved does NOT disprove "I did not move it" unless the evidence independently identifies that witness as the mover.
        - Ownership, assignment, proximity, opportunity, timing, or association do NOT prove that a person performed an action.
        - A timestamp discrepancy does NOT identify who caused it.
        - Tracks, wear, damage, residue, or an opened seal can directly disprove a claim that the object never moved, was unused, was undamaged, left no residue, or stayed sealed.
        - If either side still allows the testimony to be true, mark the pair invalid.

        Relevance, suspicion, likelihood, or useful timeline context alone is never enough. Be strict but not adversarial: use the literal player-facing meaning of the evidence content and narrativeMeaning. Confidence measures confidence in your valid/invalid classification, not confidence that a suspicious person is guilty.

        Source material:
        {JsonSerializer.Serialize(cracks, PrettyJson)}

        Return one cracks entry for every supplied challengeId. Set expectedPairCount to the supplied value and return exactly that many pairEvaluations. Preserve every supplied ID and cover every expectedPairKey exactly once. For each pair return isValidContradiction, confidence from 0 to 1, a concise reason, and one reasonCode: DIRECT_NEGATION, RELATED_ONLY, ACTOR_NOT_IDENTIFIED, SCOPE_MISMATCH, INFERENCE_REQUIRED, or AMBIGUOUS. DIRECT_NEGATION is the only reasonCode allowed when isValidContradiction is true. Return pairEvaluations as [] at the root for backward compatibility. Do not choose or rewrite an answer and do not omit ambiguous pairs.
        """;
    }

    public static string BuildMockResponse(GameCase gameCase, IReadOnlyCollection<string>? challengeIds = null)
    {
        var selectedIds = challengeIds?.ToHashSet(StringComparer.Ordinal);
        var cracks = gameCase.EvidenceChallenges
            .Where(challenge => selectedIds is null || selectedIds.Contains(challenge.ChallengeId))
            .Select(challenge => new AiV3CrackReview
        {
            ChallengeId = challenge.ChallengeId,
            ExpectedPairCount = challenge.CandidateEvidenceIds.Count * challenge.CandidateTestimonyFragmentIds.Count,
            PairEvaluations = challenge.CandidateEvidenceIds.SelectMany(evidenceId =>
                challenge.CandidateTestimonyFragmentIds.Select(fragmentId => new AiV3PairEvaluation
                {
                    EvidenceId = evidenceId,
                    TestimonyFragmentId = fragmentId,
                    IsValidContradiction = evidenceId == challenge.CorrectEvidenceId
                        && fragmentId == challenge.TestimonyFragmentId,
                    ReasonCode = evidenceId == challenge.CorrectEvidenceId
                                 && fragmentId == challenge.TestimonyFragmentId
                        ? AiV3SemanticReasonCodes.DirectNegation
                        : AiV3SemanticReasonCodes.RelatedOnly,
                    Reason = evidenceId == challenge.CorrectEvidenceId
                             && fragmentId == challenge.TestimonyFragmentId
                        ? "The physical trace directly disproves the selected claim."
                        : "This evidence does not directly disprove this claim.",
                    Confidence = 0.95
                })).ToList()
        }).ToList();
        return JsonSerializer.Serialize(new GeneratedV3SemanticReview
        {
            Cracks = cracks,
            PairEvaluations = cracks.Count == 1
                ? cracks[0].PairEvaluations
                : new List<AiV3PairEvaluation>()
        }, PrettyJson);
    }

    public static List<string> Errors(GameCase gameCase, AiV3SemanticReview review)
    {
        if (review.Status == AiV3SemanticReviewStatuses.Ambiguous)
            return ["AI_V3_SEMANTIC_REVIEW_INCOMPLETE: The dynamic Cartesian review was incomplete or below the 0.70 confidence gate."];

        var errors = new List<string>();
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            var crack = review.Cracks.SingleOrDefault(item => item.ChallengeId == challenge.ChallengeId);
            if (crack is null) continue;
            var valid = crack.PairEvaluations.Where(item => item.IsValidContradiction).ToList();
            var authored = crack.PairEvaluations.SingleOrDefault(item =>
                item.EvidenceId == challenge.CorrectEvidenceId
                && item.TestimonyFragmentId == challenge.TestimonyFragmentId);
            if (valid.Count == 0)
            {
                errors.Add($"AI_V3_NO_VALID_PAIR [{challenge.ChallengeId}]: The authored pair was rejected: {authored?.Reason ?? "no reviewer reason"}");
            }
            else if (authored is null || !authored.IsValidContradiction)
            {
                errors.Add($"AI_V3_AUTHORED_PAIR_MISMATCH [{challenge.ChallengeId}]: The reviewer accepted "
                           + $"{string.Join(", ", valid.Select(item => $"{item.EvidenceId} + {item.TestimonyFragmentId}"))} "
                           + $"but not the authored pair; authored pair reason: {authored?.Reason ?? "no reviewer reason"}");
            }
        }
        return errors.Count > 0
            ? errors
            : ["AI_V3_SEMANTIC_REVIEW_REQUIRED: The declared pair was not accepted as a real contradiction."];
    }

    public static string BuildRepairFeedback(GameCase gameCase, AiV3SemanticReview review)
    {
        var sections = new List<string>();
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            var crack = review.Cracks.SingleOrDefault(item => item.ChallengeId == challenge.ChallengeId);
            if (crack is null) continue;
            var authored = crack.PairEvaluations.SingleOrDefault(item =>
                item.EvidenceId == challenge.CorrectEvidenceId
                && item.TestimonyFragmentId == challenge.TestimonyFragmentId);
            var otherValid = crack.PairEvaluations.Where(item => item.IsValidContradiction
                    && (item.EvidenceId != challenge.CorrectEvidenceId
                        || item.TestimonyFragmentId != challenge.TestimonyFragmentId))
                .Select(item => $"{item.EvidenceId} + {item.TestimonyFragmentId}: {item.Reason}")
                .ToList();
            sections.Add($"""
                Challenge {challenge.ChallengeId}:
                - Authored pair: {challenge.CorrectEvidenceId} + {challenge.TestimonyFragmentId}
                - Reviewer verdict on authored pair: {(authored?.IsValidContradiction == true ? "VALID" : "INVALID")} ({authored?.Confidence:0.00}) — {authored?.Reason ?? "no reviewer reason"}
                - Other pairs judged valid: {(otherValid.Count == 0 ? "none" : string.Join(" | ", otherValid))}
                """);
        }

        return $"""
            Repair the Crack-the-Lie matrices using this independent semantic-review feedback:
            {string.Join("\n", sections)}

            Re-author each failed matrix backward from one atomic contradiction:
            - Prefer a subject-neutral physical claim about an observable object state or event, such as "the trolley never left the room" or "the seal remained intact".
            - If a claim names an actor (for example "I did not move it"), the evidence must independently identify that exact actor performing the action. Movement, ownership, assignment, proximity, opportunity, or timing is not actor identification.
            - Make the correct evidence content and narrativeMeaning explicitly establish the negation of the exact fragment with matching object, place, and time scope.
            - Prefer distractor pairs that stay compatible: the evidence and selected claim should both still be able to be true together.
            - Internally audit the complete dynamic Cartesian product before returning JSON. The authored pair must pass; other pairs may also contradict when the story genuinely implies it. Do not output the audit table.
            Preserve unrelated valid case structure and IDs where possible, but change fragment/evidence wording and the authored pair IDs when needed for logical correctness.
            """;
    }
}
