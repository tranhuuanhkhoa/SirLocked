using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class CompleteConditionTests
{
    private static readonly HashSet<string> Empty = new();

    private static HashSet<string> Set(params string[] values) => new(values);

    [Fact]
    public void And_RequiresEverything()
    {
        var condition = new CompleteCondition
        {
            Logic = "AND",
            RequiredItemIds = new() { "item-1" },
            RequiredClueIds = new() { "clue-1" },
            RequiredDialogueIds = new() { "dlg-1" }
        };

        Assert.False(CaseValidationService.IsConditionSatisfied(condition, Set("item-1"), Set("clue-1"), Empty));
        Assert.True(CaseValidationService.IsConditionSatisfied(condition, Set("item-1"), Set("clue-1"), Set("dlg-1")));
    }

    [Fact]
    public void Or_RequiresOneNonEmptySatisfiedGroup()
    {
        var condition = new CompleteCondition
        {
            Logic = "OR",
            RequiredItemIds = new() { "item-1" },
            RequiredClueIds = new() { "clue-1" }
        };

        Assert.False(CaseValidationService.IsConditionSatisfied(condition, Empty, Empty, Empty));
        Assert.True(CaseValidationService.IsConditionSatisfied(condition, Set("item-1"), Empty, Empty));
        Assert.True(CaseValidationService.IsConditionSatisfied(condition, Empty, Set("clue-1"), Empty));
    }

    [Fact]
    public void Or_WithOnlyEmptyGroups_IsNeverSatisfied()
    {
        var condition = new CompleteCondition { Logic = "OR" };
        Assert.False(CaseValidationService.IsConditionSatisfied(condition, Empty, Empty, Empty));
    }

    [Fact]
    public void EmptyAndCondition_IsAlwaysSatisfied()
    {
        var condition = new CompleteCondition { Logic = "AND" };
        Assert.True(CaseValidationService.IsConditionSatisfied(condition, Empty, Empty, Empty));
    }
}
