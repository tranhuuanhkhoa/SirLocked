using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

internal enum CompleteConditionAlternativeType
{
    Items,
    Clues,
    Dialogues
}

internal sealed record CompleteConditionAlternative(
    CompleteConditionAlternativeType Type,
    IReadOnlyList<string> MissingIds);

internal sealed record CompleteConditionProgressResult(
    bool IsSatisfied,
    IReadOnlyList<string> MissingItemIds,
    IReadOnlyList<string> MissingClueIds,
    IReadOnlyList<string> MissingDialogueIds,
    IReadOnlyList<CompleteConditionAlternative> Alternatives,
    int PendingCount);

internal static class CompleteConditionProgress
{
    public static CompleteConditionProgressResult Evaluate(
        CompleteCondition condition,
        IReadOnlySet<string> inspectedItems,
        IReadOnlySet<string> unlockedClues,
        IReadOnlySet<string> askedDialogues)
    {
        var missingItems = condition.RequiredItemIds.Where(id => !inspectedItems.Contains(id)).ToList();
        var missingClues = condition.RequiredClueIds.Where(id => !unlockedClues.Contains(id)).ToList();
        var missingDialogues = condition.RequiredDialogueIds.Where(id => !askedDialogues.Contains(id)).ToList();

        if (!string.Equals(condition.Logic, "OR", StringComparison.OrdinalIgnoreCase))
        {
            var isSatisfied = missingItems.Count == 0
                && missingClues.Count == 0
                && missingDialogues.Count == 0;
            return new CompleteConditionProgressResult(
                isSatisfied,
                missingItems,
                missingClues,
                missingDialogues,
                Array.Empty<CompleteConditionAlternative>(),
                missingItems.Count + missingClues.Count + missingDialogues.Count);
        }

        var alternatives = new List<CompleteConditionAlternative>(3);
        AddAlternative(alternatives, CompleteConditionAlternativeType.Items, condition.RequiredItemIds, missingItems);
        AddAlternative(alternatives, CompleteConditionAlternativeType.Dialogues, condition.RequiredDialogueIds, missingDialogues);
        AddAlternative(alternatives, CompleteConditionAlternativeType.Clues, condition.RequiredClueIds, missingClues);

        var isOrSatisfied = alternatives.Any(alternative => alternative.MissingIds.Count == 0);
        if (isOrSatisfied)
        {
            return new CompleteConditionProgressResult(
                true,
                Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<CompleteConditionAlternative>(),
                0);
        }

        return new CompleteConditionProgressResult(
            false,
            missingItems,
            missingClues,
            missingDialogues,
            alternatives,
            alternatives.Count == 0 ? 0 : alternatives.Min(alternative => alternative.MissingIds.Count));
    }

    private static void AddAlternative(
        ICollection<CompleteConditionAlternative> alternatives,
        CompleteConditionAlternativeType type,
        IReadOnlyCollection<string> requiredIds,
        IReadOnlyList<string> missingIds)
    {
        if (requiredIds.Count > 0)
        {
            alternatives.Add(new CompleteConditionAlternative(type, missingIds));
        }
    }
}
