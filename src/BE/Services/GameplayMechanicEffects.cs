using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public partial class GameplayService
{
    private sealed record AppliedMechanicEffects(
        List<string> NewClueIds,
        List<string> NewItemIds,
        List<string> NewSceneIds);

    private static AppliedMechanicEffects ApplyMechanicEffects(
        GameplayState state,
        IEnumerable<string> unlockClueIds,
        IEnumerable<string> unlockItemIds,
        IEnumerable<string> unlockSceneIds,
        IEnumerable<string> consumeItemIds,
        string userId,
        string? role,
        string sourceAction)
    {
        var consumed = consumeItemIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToHashSet();
        if (consumed.Count > 0)
            state.CollectedItemIds.RemoveAll(consumed.Contains);

        var newItems = unlockItemIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .Where(id => !state.CollectedItemIds.Contains(id))
            .ToList();
        state.CollectedItemIds.AddRange(newItems);

        var newScenes = unlockSceneIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .Where(id => !state.UnlockedSceneIds.Contains(id) && !state.VisitedSceneIds.Contains(id))
            .ToList();
        state.UnlockedSceneIds.AddRange(newScenes);

        var newClues = unlockClueIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .Where(id => !state.UnlockedClueIds.Contains(id))
            .ToList();
        state.UnlockedClueIds.AddRange(newClues);
        RecordClueDiscoveries(state, newClues, userId, role, sourceAction);

        return new AppliedMechanicEffects(newClues, newItems, newScenes);
    }

    private static bool IsPuzzleAnswerCorrect(CasePuzzle puzzle, SolvePuzzleRequest request)
    {
        if (puzzle.Type.Equals(CasePuzzleTypes.CodePuzzle, StringComparison.OrdinalIgnoreCase))
        {
            return NormalizePuzzleText(request.Answer)
                .Equals(NormalizePuzzleText(puzzle.CorrectCode), StringComparison.OrdinalIgnoreCase);
        }

        var submitted = (request.AnswerSequence ?? new List<string>())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToList();
        if (submitted.Count == 0 && !string.IsNullOrWhiteSpace(request.Answer))
        {
            submitted = request.Answer
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();
        }

        return submitted.Count == puzzle.CorrectSequence.Count
            && submitted.Zip(puzzle.CorrectSequence)
                .All(pair => pair.First.Equals(pair.Second, StringComparison.OrdinalIgnoreCase));
    }

    private static string NormalizePuzzleText(string? value) =>
        string.Join("", (value ?? string.Empty).Where(c => !char.IsWhiteSpace(c))).Trim();
}
