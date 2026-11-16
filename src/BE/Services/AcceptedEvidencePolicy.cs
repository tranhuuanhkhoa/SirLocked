using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// VUAN-6B part B: when the server lays out the accusation claims of an AI case (the projection compile), every claim
/// also accepts the other evidence that proves the same conclusion (<c>acceptedEvidenceIds</c>, VUAN-6 A2). The bot
/// cannot write this field (the claims are server-owned), so the server fills it; the bot still lists its proposals in
/// report.md and ADMIN can edit the case on the review page.
/// </summary>
public static class AcceptedEvidencePolicy
{
    public const int MaxAlternatives = 8;

    /// <summary>
    /// Other <c>isEvidence</c> clues supporting the claim's <c>conclusionId</c>, in case order: not the claim's own
    /// evidence, not the evidence of another claim, not a red herring. Claims without a conclusionId (hand-made cases)
    /// get nothing.
    /// </summary>
    public static Dictionary<int, List<string>> Propose(GameCase gameCase)
    {
        var links = gameCase.FinalLogic.RequiredEvidenceLinks;
        var primary = links.Select(link => link.EvidenceId).ToHashSet(StringComparer.Ordinal);
        var result = new Dictionary<int, List<string>>();
        for (var index = 0; index < links.Count; index++)
        {
            var link = links[index];
            if (string.IsNullOrWhiteSpace(link.ConclusionId)) continue;
            var existing = link.AcceptedEvidenceIds ?? new List<string>();
            var candidates = gameCase.Clues
                .Where(clue => clue.IsEvidence && !clue.IsRedHerring
                               && clue.SupportsConclusionIds.Contains(link.ConclusionId, StringComparer.Ordinal)
                               && !primary.Contains(clue.ClueId) && !existing.Contains(clue.ClueId, StringComparer.Ordinal))
                .Select(clue => clue.ClueId)
                .Distinct(StringComparer.Ordinal)
                .Take(Math.Max(0, MaxAlternatives - existing.Count))
                .ToList();
            if (candidates.Count > 0) result[index] = candidates;
        }
        return result;
    }

    /// <summary>
    /// Adds the proposals, then drops every one the validator rejects (for example a clue that is never found before
    /// the accusation). Never removes ids that were already there. Returns the ids added per claim type.
    /// </summary>
    public static Dictionary<string, List<string>> Fill(GameCase gameCase, Func<GameCase, CaseValidationResult>? verify = null)
    {
        var proposals = Propose(gameCase);
        var added = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        if (proposals.Count == 0) return added;
        var links = gameCase.FinalLogic.RequiredEvidenceLinks;
        var before = links.Select(link => link.AcceptedEvidenceIds?.ToList()).ToList();
        foreach (var (index, ids) in proposals)
            links[index].AcceptedEvidenceIds = (links[index].AcceptedEvidenceIds ?? new List<string>()).Concat(ids).ToList();

        if (verify is not null)
        {
            for (var round = 0; round < 3; round++)
            {
                var rejected = verify(gameCase).Errors
                    .Where(error => error.Path.Contains("acceptedEvidenceIds", StringComparison.Ordinal) && error.RefId is not null)
                    .Select(error => error.RefId!)
                    .ToHashSet(StringComparer.Ordinal);
                var removable = proposals.Values.SelectMany(ids => ids).Where(rejected.Contains).ToHashSet(StringComparer.Ordinal);
                if (removable.Count == 0) break;
                foreach (var (index, ids) in proposals)
                {
                    ids.RemoveAll(removable.Contains);
                    var kept = (before[index] ?? new List<string>()).Concat(ids).ToList();
                    links[index].AcceptedEvidenceIds = kept.Count == 0 ? before[index] : kept;
                }
            }
        }
        foreach (var (index, ids) in proposals.Where(pair => pair.Value.Count > 0))
            added[links[index].ClaimType] = ids.ToList();
        return added;
    }
}
