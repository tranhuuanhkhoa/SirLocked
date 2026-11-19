using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// Truth-bound puzzle kinds take their answer from the approved truth, read from its structured fields only.
/// <list type="bullet">
/// <item><c>fingerprint</c>: the cards are the case's suspects and the answer is the suspect who left the puzzle's
/// own reward trace (<see cref="TraceLedgerEntry.CreatedByCharacterId"/>). Not offered when that is the culprit, so
/// an optional puzzle never hands out the identification the five-claim accusation has to earn.</item>
/// <item><c>doc_forgery</c> and <c>parallax_code</c>: the truth has no structured altered-document or code fact,
/// so they are never offered (the AI cannot invent their answers).</item>
/// </list>
/// </summary>
public static class TruthBoundPuzzleAnswers
{
    public const string Fingerprint = "fingerprint";

    public static bool CanOffer(string kind, CaseTruthPackage truth, string? rewardTraceId) =>
        kind == Fingerprint && PrintOwner(truth, rewardTraceId) is not null;

    /// <summary>The innocent suspect who left the trace, or null when the trace cannot carry a fingerprint answer.</summary>
    public static string? PrintOwner(CaseTruthPackage truth, string? rewardTraceId)
    {
        var owner = truth.TraceLedger.FirstOrDefault(trace => trace.TraceId == rewardTraceId)?.CreatedByCharacterId;
        return !string.IsNullOrWhiteSpace(owner)
               && truth.CaseSeed.SuspectIds.Count >= 2
               && truth.CaseSeed.SuspectIds.Contains(owner, StringComparer.Ordinal)
               && !string.Equals(owner, truth.CoreTruth.CulpritId, StringComparison.Ordinal)
            ? owner
            : null;
    }

    /// <summary>
    /// The reference cards: the print owner and up to three other suspects, in the truth's order (the fingerprint
    /// kind takes 2-4 cards, and a Hard case has five suspects).
    /// </summary>
    public static List<string> PrintCards(CaseTruthPackage truth, string ownerId)
    {
        var others = truth.CaseSeed.SuspectIds.Where(id => id != ownerId).Take(3).ToHashSet(StringComparer.Ordinal);
        return truth.CaseSeed.SuspectIds.Where(id => id == ownerId || others.Contains(id)).ToList();
    }

    /// <summary>Sets a fingerprint puzzle's cards (the suspects, by name) and its answer before the kind fills the rest.</summary>
    public static void ApplyFingerprint(CasePuzzle puzzle, string ownerId, GameCase gameCase, IReadOnlyList<string> suspectIds)
    {
        var vietnamese = gameCase.Language == CaseLanguages.Vietnamese;
        var parameters = PuzzleKindAuthoring.Parse(puzzle.ParamsJson);
        parameters["cards"] = new JsonArray(suspectIds.Select(id =>
        {
            var name = gameCase.Characters.FirstOrDefault(character => character.CharacterId == id)?.Name;
            name = string.IsNullOrWhiteSpace(name) ? id : name;
            var initials = string.Concat(name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(word => char.ToUpperInvariant(word[0]))).PadRight(2, '·');
            return (JsonNode)new JsonObject
            {
                ["id"] = id,
                ["mono"] = initials[..Math.Min(2, initials.Length)],
                ["name"] = name,
                ["role"] = vietnamese ? "Nghi phạm" : "Suspect"
            };
        }).ToArray());
        puzzle.ParamsJson = parameters.ToJsonString();
        var solution = PuzzleKindAuthoring.Parse(puzzle.SolutionJson);
        solution["card"] = ownerId;
        puzzle.SolutionJson = solution.ToJsonString();
    }
}
