using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiGenerationLanguageTests
{
    private const string EnglishMotive = "He abducted the witness to protect his disputed inheritance.";
    private const string EnglishMethod = "He closed the steam valve and carried the witness through the hidden hatch.";
    private const string VietnameseMotive = "Ông ta bắt cóc nhân chứng để bảo vệ phần thừa kế đang bị đe dọa.";
    private const string VietnameseMethod = "Ông ta đóng van hơi rồi đưa nhân chứng qua cửa sập của lối phục vụ.";

    [Fact]
    public void VietnameseDisplayLabels_AcceptOriginalEnglishTruthWithoutMutatingIt()
    {
        var gameCase = CaseWithDisplayLabels();

        var result = LanguageContract.Validate(gameCase, VietnameseSettings);

        Assert.True(result.IsValid, string.Join("\n", result.Errors.Select(error => error.Message)));
        Assert.Equal(EnglishMotive, gameCase.FinalLogic.Motive);
        Assert.Equal(EnglishMethod, gameCase.FinalLogic.Method);
    }

    [Theory]
    [InlineData("motive")]
    [InlineData("method")]
    public void EnglishDisplayLabel_IsRejectedEvenWhenCanonicalTruthIsVietnamese(string field)
    {
        var gameCase = CaseWithDisplayLabels();
        if (field == "motive")
        {
            gameCase.FinalLogic.Motive = VietnameseMotive;
            gameCase.FinalLogic.MotiveOptions.Single().Label = EnglishMotive;
        }
        else
        {
            gameCase.FinalLogic.Method = VietnameseMethod;
            gameCase.FinalLogic.MethodOptions.Single().Label = EnglishMethod;
        }

        var result = LanguageContract.Validate(gameCase, VietnameseSettings);

        var error = Assert.Single(result.Errors);
        Assert.Equal("LanguageMismatch", error.Code);
        Assert.Equal($"finalLogic.{field}", error.Path);
    }

    [Theory]
    [InlineData("no-options")]
    [InlineData("unknown-correct-id")]
    [InlineData("blank-label")]
    public void MissingCorrectDisplayLabel_FallsBackToEnglishCanonicalTruthAndRejectsIt(string missing)
    {
        var gameCase = CaseWithDisplayLabels();
        if (missing == "no-options")
        {
            gameCase.FinalLogic.MotiveOptions.Clear();
            gameCase.FinalLogic.MethodOptions.Clear();
        }
        else if (missing == "unknown-correct-id")
        {
            gameCase.FinalLogic.CorrectMotiveId = "unmatched-motive";
            gameCase.FinalLogic.CorrectMethodId = "unmatched-method";
        }
        else
        {
            gameCase.FinalLogic.MotiveOptions.Single().Label = "   ";
            gameCase.FinalLogic.MethodOptions.Single().Label = string.Empty;
        }

        var result = LanguageContract.Validate(gameCase, VietnameseSettings);

        Assert.Equal(new[] { "finalLogic.method", "finalLogic.motive" }, result.Errors.Select(error => error.Path).Order(StringComparer.Ordinal));
        Assert.All(result.Errors, error => Assert.Equal("LanguageMismatch", error.Code));
        Assert.Equal(EnglishMotive, gameCase.FinalLogic.Motive);
        Assert.Equal(EnglishMethod, gameCase.FinalLogic.Method);
    }

    [Fact]
    public void LegacyVietnameseTruth_WithoutOptionsStillPassesLanguageCheck()
    {
        var gameCase = new GameCase();
        gameCase.FinalLogic.Motive = VietnameseMotive;
        gameCase.FinalLogic.Method = VietnameseMethod;

        var result = LanguageContract.Validate(gameCase, VietnameseSettings);

        Assert.True(result.IsValid);
    }

    private static GameCase CaseWithDisplayLabels() => new()
    {
        FinalLogic = new FinalLogic
        {
            Motive = EnglishMotive, Method = EnglishMethod,
            CorrectMotiveId = "motive-correct", CorrectMethodId = "method-correct",
            MotiveOptions = [new AccusationOption { Id = "motive-correct", Label = VietnameseMotive }],
            MethodOptions = [new AccusationOption { Id = "method-correct", Label = VietnameseMethod }]
        }
    };

    // Keep structural budgets empty so this suite isolates presentation language
    // instead of depending on case generation, content fixtures or providers.
    private static readonly AiGenerationContract LanguageContract = new(
        MinStages: 0, MaxStages: 0, MinScenes: 0, MaxScenes: 0,
        MinCharacters: 0, MaxCharacters: 0, MinClues: 0, MaxClues: 0,
        MinDialogues: 0, MaxDialogues: 0, EvidenceChallenges: 0, Deductions: 0,
        TeamworkChains: 0, MinPuzzles: 0, MaxPuzzles: 0, MinInteractions: 0, MaxInteractions: 0);

    private static readonly AiDraftSettings VietnameseSettings = new() { Language = CaseLanguages.Vietnamese };
}
