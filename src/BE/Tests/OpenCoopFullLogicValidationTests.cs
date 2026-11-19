using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// The whole logic step of an OPEN_COOP_1 draft at every level: a compiled case must pass the same full-logic
/// validation (hint rule applied strictly) that the server runs before the LOGIC gate.
/// </summary>
public sealed class OpenCoopFullLogicValidationTests
{
    public static TheoryData<string, string> Levels() => new()
    {
        { "easy", AiCaseLeanings.Balanced }, { "easy", AiCaseLeanings.Puzzle }, { "easy", AiCaseLeanings.Dialogue },
        { "medium", AiCaseLeanings.Balanced }, { "medium", AiCaseLeanings.Puzzle },
        { "hard", AiCaseLeanings.Balanced }, { "hard", AiCaseLeanings.Puzzle }
    };

    private static GameCase Compile(string level, string leaning)
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft(level, leaning);
        var plan = OptionalPuzzleProjectionTests.Plan(draft);
        return new GameCaseProjectionCompiler().Compile(plan, ProjectionContentMockFactory.Build(plan), draft.Settings);
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void CompiledCase_PassesTheServersFullLogicValidation(string level, string leaning)
    {
        var validation = new CaseValidationService().ValidateFullLogic(Compile(level, leaning)).RequireHints();
        Assert.Empty(validation.Errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));
    }

    [Fact]
    public void EasyCase_HasNoDeductionOrTeamworkChain_AndIsStillValid()
    {
        var gameCase = Compile("easy", AiCaseLeanings.Balanced);
        Assert.Empty(gameCase.Deductions);
        Assert.DoesNotContain(new CaseValidationService().ValidateFullLogic(gameCase).Errors,
            error => error.Path is "deductions" or "requiredTeamworkChains" or "finalLogic.requiredDeductionIds" or "finalLogic.requiredTeamworkChainIds");
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void EveryOptionalPuzzle_HasThreeHints_FromGeneralToSpecific(string level, string leaning)
    {
        foreach (var puzzle in Compile(level, leaning).Puzzles)
        {
            var hints = System.Text.Json.Nodes.JsonNode.Parse(puzzle.SolutionJson)!["hints"]!.AsArray();
            Assert.True(hints.Count >= CaseHintRules.MinPuzzleHints, $"{puzzle.PuzzleId} ({puzzle.Kind}) has {hints.Count} hints");
            Assert.All(hints, hint => Assert.False(string.IsNullOrWhiteSpace(hint!.GetValue<string>())));
        }
    }
}
