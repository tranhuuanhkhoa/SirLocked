using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>The three difficulty levels are the single source of every size of a new (OPEN_COOP_1) case.</summary>
public sealed class AiDifficultyProfilesTests
{
    [Theory]
    [InlineData("easy", 2, 3, 3, 1, 12)]
    [InlineData("MEDIUM", 4, 5, 4, 2, 25)]
    [InlineData("hard", 6, 8, 5, 3, 50)]
    public void For_ReturnsApprovedNumbers(string level, int minScenes, int maxScenes, int suspects, int cracks, int minutes)
    {
        var p = AiDifficultyProfiles.For(level);
        Assert.Equal(new IntRange(minScenes, maxScenes), p.Scenes);
        Assert.Equal(suspects, p.Suspects);
        Assert.Equal(cracks, p.Cracks);
        Assert.Equal(minutes, p.EstimatedMinutes);
    }

    [Fact]
    public void For_EmptyMeansMedium() => Assert.Equal("medium", AiDifficultyProfiles.For("").Difficulty);

    [Fact]
    public void For_UnknownLevel_Throws()
    {
        var error = Assert.Throws<ApiException>(() => AiDifficultyProfiles.For("insane"));
        Assert.Equal("order.difficulty", Assert.IsType<ApiErrorDetails>(error.Errors).Field);
    }

    [Theory]
    [InlineData("easy", "BALANCED", 1)]
    [InlineData("easy", "PUZZLE", 2)]
    [InlineData("medium", "DIALOGUE", 2)]
    [InlineData("hard", "PUZZLE", 6)]
    [InlineData("hard", "DIALOGUE", 4)]
    public void PuzzleCount_StaysInsideTheLevel(string level, string leaning, int expected)
    {
        var p = AiDifficultyProfiles.For(level);
        var count = AiDifficultyProfiles.PuzzleCount(p, leaning);
        Assert.Equal(expected, count);
        Assert.InRange(count, p.Puzzles.Min, p.Puzzles.Max);
    }

    [Fact]
    public void Leaning_UnknownValue_Throws()
    {
        var error = Assert.Throws<ApiException>(() => AiCaseLeanings.Normalize("RANDOM"));
        Assert.Equal("leaning", Assert.IsType<ApiErrorDetails>(error.Errors).Field);
        Assert.Equal(AiCaseLeanings.Balanced, AiCaseLeanings.Normalize(null));
    }

    [Fact]
    public void Contract_IsOneStageWithExactCracks()
    {
        var c = AiDifficultyProfiles.Contract(AiDifficultyProfiles.For("hard"), AiCaseLeanings.Balanced);
        Assert.Equal((1, 1), (c.MinStages, c.MaxStages));
        Assert.Equal((6, 8), (c.MinScenes, c.MaxScenes));
        Assert.Equal((3, 3), (c.EvidenceChallenges, c.MaxEvidenceChallenges));
        Assert.Equal((5, 5), (c.MinPuzzles, c.MaxPuzzles));
    }

    [Fact]
    public void ConversationCharacters_DialogueAddsOne()
    {
        var p = AiDifficultyProfiles.For("medium");
        Assert.Equal(2, AiDifficultyProfiles.ConversationCharacters(p, AiCaseLeanings.Balanced));
        Assert.Equal(3, AiDifficultyProfiles.ConversationCharacters(p, AiCaseLeanings.Dialogue));
    }

    [Fact]
    public void IsOpenCoop_OnlyForTheNewPipeline()
    {
        Assert.False(AiPipelineVersions.IsOpenCoop(new AiDraftSettings()));
        Assert.True(AiPipelineVersions.IsOpenCoop(new AiDraftSettings { PipelineVersion = "OPEN_COOP_1" }));
    }
}
