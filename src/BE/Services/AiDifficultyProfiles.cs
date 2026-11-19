using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>Which pipeline a draft follows. Drafts without a version keep the preset-and-stages pipeline.</summary>
public static class AiPipelineVersions
{
    public const string OpenCoop1 = "OPEN_COOP_1";

    public static bool IsOpenCoop(AiDraftSettings? settings) =>
        string.Equals(settings?.PipelineVersion, OpenCoop1, StringComparison.Ordinal);
}

/// <summary>"Thiên về" on the order form: leans a level's counts without leaving its ranges.</summary>
public static class AiCaseLeanings
{
    public const string Balanced = "BALANCED";
    public const string Puzzle = "PUZZLE";
    public const string Dialogue = "DIALOGUE";
    public static readonly IReadOnlyList<string> All = [Balanced, Puzzle, Dialogue];

    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return Balanced;
        var normalized = value.Trim().ToUpperInvariant();
        return All.Contains(normalized)
            ? normalized
            : throw ApiException.BadRequest($"leaning '{value}' is not supported.",
                new ApiErrorDetails("AI_ORDER_INVALID", "ai.order.invalid") { Field = "leaning" });
    }
}

public sealed record IntRange(int Min, int Max);

/// <summary>Every size of a case at one difficulty level. Read from <see cref="AiDifficultyProfiles"/> only.</summary>
public sealed record AiDifficultyProfile(
    string Difficulty,
    IntRange PlayMinutes,
    int EstimatedMinutes,
    IntRange Scenes,
    int Suspects,
    IntRange Characters,
    IntRange Clues,
    IntRange Dialogues,
    int Cracks,
    int Deductions,
    int TeamworkChains,
    IntRange Puzzles,
    IntRange Interactions,
    IntRange RedHerrings,
    int RequiredEvidence,
    int HintLevels,
    string PuzzleDifficulty,
    IntRange TimelineEvents,
    int MinConversationCharacters,
    IntRange PixelLabNewWorld,
    IntRange PixelLabLibraryWorld);

/// <summary>
/// The single source of the three difficulty levels of a new (OPEN_COOP_1) case. The order form, the truth budget,
/// the generation contract, the projection and the level check all read these numbers; nothing else sets them.
/// </summary>
public static class AiDifficultyProfiles
{
    public const string Easy = "easy";
    public const string Medium = "medium";
    public const string Hard = "hard";

    private static IntRange R(int min, int max) => new(min, max);

    public static readonly IReadOnlyList<AiDifficultyProfile> All =
    [
        new(Easy, R(10, 15), 12, R(2, 3), 3, R(3, 5), R(6, 12), R(4, 8), 1, 0, 0, R(1, 2), R(0, 1), R(0, 1), 2, 3,
            "EASY", R(0, 0), 1, R(60, 120), R(10, 40)),
        new(Medium, R(20, 30), 25, R(4, 5), 4, R(4, 6), R(10, 17), R(8, 12), 2, 1, 1, R(2, 3), R(0, 1), R(1, 2), 3, 3,
            "NORMAL", R(5, 6), 2, R(150, 220), R(30, 80)),
        new(Hard, R(40, 60), 50, R(6, 8), 5, R(5, 7), R(15, 28), R(12, 18), 3, 2, 1, R(4, 6), R(0, 1), R(2, 3), 4, 3,
            "HARD", R(7, 9), 3, R(300, 450), R(60, 150))
    ];

    /// <summary>Case-insensitive; empty means medium; anything else is a 400 on <c>order.difficulty</c>.</summary>
    public static AiDifficultyProfile For(string? difficulty)
    {
        var key = string.IsNullOrWhiteSpace(difficulty) ? Medium : difficulty.Trim().ToLowerInvariant();
        return All.FirstOrDefault(profile => profile.Difficulty == key)
               ?? throw ApiException.BadRequest($"difficulty '{difficulty}' is not supported. Use easy, medium or hard.",
                   new ApiErrorDetails("AI_ORDER_INVALID", "ai.order.invalid") { Field = "order.difficulty" });
    }

    /// <summary>BALANCED / PUZZLE / DIALOGUE: easy 1/2/1, medium 2/3/2, hard 5/6/4 (always inside the level's range).</summary>
    public static int PuzzleCount(AiDifficultyProfile profile, string? leaning)
    {
        var lean = AiCaseLeanings.Normalize(leaning);
        if (lean == AiCaseLeanings.Puzzle) return profile.Puzzles.Max;
        if (lean == AiCaseLeanings.Dialogue) return profile.Puzzles.Min;
        // Balanced, as approved: easy 1, medium 2, hard 5.
        return profile.Difficulty == Hard ? profile.Puzzles.Min + 1 : profile.Puzzles.Min;
    }

    public static int ConversationCharacters(AiDifficultyProfile profile, string? leaning) =>
        profile.MinConversationCharacters + (AiCaseLeanings.Normalize(leaning) == AiCaseLeanings.Dialogue ? 1 : 0);

    /// <summary>The generation contract of a new draft: one stage holding every scene, exact cracks and puzzles.</summary>
    public static AiGenerationContract Contract(AiDifficultyProfile profile, string? leaning)
    {
        var puzzles = PuzzleCount(profile, leaning);
        return new AiGenerationContract(
            MinStages: 1,
            MaxStages: 1,
            MinScenes: profile.Scenes.Min,
            MaxScenes: profile.Scenes.Max,
            MinCharacters: profile.Characters.Min,
            MaxCharacters: profile.Characters.Max,
            MinClues: profile.Clues.Min,
            MaxClues: profile.Clues.Max,
            MinDialogues: profile.Dialogues.Min,
            MaxDialogues: profile.Dialogues.Max,
            EvidenceChallenges: profile.Cracks,
            Deductions: profile.Deductions,
            TeamworkChains: profile.TeamworkChains,
            MinPuzzles: puzzles,
            MaxPuzzles: puzzles,
            MinInteractions: profile.Interactions.Min,
            MaxInteractions: profile.Interactions.Max,
            MinConversationCharacters: ConversationCharacters(profile, leaning),
            MaxEvidenceChallenges: profile.Cracks);
    }
}
