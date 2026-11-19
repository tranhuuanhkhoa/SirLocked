using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// The three hand-written sample cases (easy, medium, hard), built from library rooms and maps no case used yet and
/// from the sprites already in the repo. They must pass what a new AI case passes: the validator with the strict hint
/// rule, the pixel layout gate, the size of their level, and every picture and sound they name must exist.
/// </summary>
public sealed class SampleCaseTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static readonly TheoryData<string, string> Levels = new()
    {
        { "case-pixel-chuoi-ngoc-vi.json", AiDifficultyProfiles.Easy },
        { "case-pixel-chen-tra-vi.json", AiDifficultyProfiles.Medium },
        { "case-pixel-dem-tuyet-vi.json", AiDifficultyProfiles.Hard }
    };

    /// <summary>True for the three sample cases (new cases: every hint level, alternatives allowed).</summary>
    public static bool IsSampleCase(string caseId) =>
        Levels.Any(row => Path.GetFileNameWithoutExtension((string)row[0]) == caseId);

    private static GameCase Load(string file) =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", file)), JsonOptions)!;

    private static IEnumerable<CaseScene> Scenes(GameCase gameCase) => gameCase.Stages.SelectMany(stage => stage.Scenes);

    private static string Describe(IEnumerable<CaseValidationError> errors) =>
        string.Join(Environment.NewLine, errors.Select(error => $"{error.Code} {error.Path}: {error.Message}"));

    [Theory]
    [MemberData(nameof(Levels))]
    public void SampleCase_PassesTheValidatorWithTheStrictHintRule(string file, string level)
    {
        var gameCase = Load(file);
        PuzzleKindRegistry.FillMissing(gameCase);
        var validation = new CaseValidationService().Validate(gameCase).RequireHints();

        Assert.True(validation.IsValid, $"{level}: {Describe(validation.Errors)}");
        Assert.True(validation.Warnings.Count == 0, $"{level}: {Describe(validation.Warnings)}");
        Assert.Equal(Path.GetFileNameWithoutExtension(file), gameCase.CaseId);
        Assert.True(CaseRuleSets.IsOpenCoop(gameCase));
        Assert.Equal(3, gameCase.MechanicsVersion);
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void SampleCase_PassesThePixelLayoutGateOfNewAiCases(string file, string level)
    {
        var gameCase = Load(file);
        var result = new CaseValidationResult();
        PixelDraftRules.ValidateLayout(gameCase, result);
        Assert.True(result.IsValid, $"{level}: {Describe(result.Errors)}");
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void SampleCase_HasTheSizeOfItsLevel(string file, string level)
    {
        var gameCase = Load(file);
        var profile = AiDifficultyProfiles.For(level);
        Assert.InRange(Scenes(gameCase).Count(), profile.Scenes.Min, profile.Scenes.Max);
        Assert.InRange(gameCase.Characters.Count, profile.Characters.Min, profile.Characters.Max);
        Assert.InRange(gameCase.Clues.Count, profile.Clues.Min, profile.Clues.Max);
        Assert.InRange(gameCase.Dialogues.Count, profile.Dialogues.Min, profile.Dialogues.Max);
        Assert.Equal(profile.Cracks, gameCase.EvidenceChallenges.Count);
        Assert.Single(gameCase.EvidenceChallenges, challenge => challenge.IsSignature);
        Assert.Equal(profile.Deductions, gameCase.Deductions.Count);
        Assert.Equal(profile.TeamworkChains, gameCase.RequiredTeamworkChains.Count);
        Assert.InRange(gameCase.Puzzles.Count, profile.Puzzles.Min, profile.Puzzles.Max);
        Assert.InRange(gameCase.Interactions.Count, profile.Interactions.Min, profile.Interactions.Max);
        Assert.InRange(gameCase.Clues.Count(clue => clue.IsRedHerring), profile.RedHerrings.Min, profile.RedHerrings.Max);
        Assert.True(gameCase.ConversationNodes.Select(node => node.CharacterId).Distinct().Count() >= profile.MinConversationCharacters - 1);
        Assert.Equal(profile.EstimatedMinutes, gameCase.EstimatedMinutes);
        // Every case is complete like the tutorial: a timeline, a board and the three claims of the accusation.
        Assert.NotNull(gameCase.Timeline);
        Assert.NotNull(gameCase.Board);
        Assert.Equal(["MOTIVE", "METHOD", "OPPORTUNITY"],
            gameCase.FinalLogic.RequiredEvidenceLinks.Select(link => link.ClaimType).Distinct().OrderByDescending(type => type == "MOTIVE")
                .ThenByDescending(type => type == "METHOD").ToArray());
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void SampleCase_EveryScene_HasMusicWeatherAndAConsistentPixelRuntime(string file, string level)
    {
        var gameCase = Load(file);
        var ids = Scenes(gameCase).Select(scene => scene.SceneId).ToHashSet();
        foreach (var scene in Scenes(gameCase))
        {
            var runtime = scene.Runtime!;
            var render = runtime.Render!;
            Assert.Equal(SceneRenderModes.Pixel, render.Mode);
            Assert.NotNull(runtime.Audio?.Music);
            Assert.NotNull(runtime.Weather);
            Assert.Equal(runtime.Indoor == true, render.Projection == "isometric");
            if (runtime.Indoor == true) Assert.Equal("NONE", runtime.Weather!.Type);
            var grid = render.WalkGrid!;
            foreach (var (name, spawn) in runtime.SpawnPoints)
                Assert.True(grid.IsWalkable(spawn.X, spawn.Y), $"{level} {scene.SceneId} spawn {name} is blocked.");
            foreach (var placement in runtime.CharacterPlacements)
                Assert.True(grid.IsWalkable(placement.Position.X, placement.Position.Y), $"{level} {scene.SceneId} {placement.CharacterId} stands off the floor.");
            foreach (var transition in runtime.Transitions)
            {
                Assert.Contains(transition.TargetSceneId, ids);
                Assert.True(runtime.SpawnPoints.ContainsKey($"from:{transition.TargetSceneId}"), $"{level} {scene.SceneId} has no arrival from {transition.TargetSceneId}.");
                var back = Scenes(gameCase).Single(other => other.SceneId == transition.TargetSceneId);
                Assert.Contains(back.Runtime!.Transitions, other => other.TargetSceneId == scene.SceneId);
            }
        }
        Assert.Contains(Scenes(gameCase), scene => scene.Runtime!.Weather!.Type != "NONE");
        Assert.True(gameCase.Characters.All(character => character.Voice?.Blip is not null), $"{level}: every character has a voice.");
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void SampleCase_NamesOnlyPicturesAndSoundsThatExist(string file, string level)
    {
        var raw = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", file));
        var publicRoot = Path.Combine(RepoRoot(), "src", "FE", "public");
        var urls = Regex.Matches(raw, "\"(/assets/[^\"?]+)").Select(match => match.Groups[1].Value).Distinct().ToList();
        Assert.NotEmpty(urls);
        foreach (var url in urls)
            Assert.True(File.Exists(Path.Combine(publicRoot, url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar))), $"{level}: {url} is missing.");
    }

    [Theory]
    [MemberData(nameof(Levels))]
    public void SampleCase_IsWonByTheAuthoredAnswer_AndEachAcceptedAlternative(string file, string level)
    {
        var gameCase = Load(file);
        AccuseRequest Accuse(Func<RequiredEvidenceLink, string> pick) => new()
        {
            CulpritId = gameCase.FinalLogic.CulpritId,
            MotiveId = gameCase.FinalLogic.CorrectMotiveId,
            MethodId = gameCase.FinalLogic.CorrectMethodId,
            EvidenceLinks = gameCase.FinalLogic.RequiredEvidenceLinks
                .Select(link => new EvidenceLinkRequest { ClaimType = link.ClaimType, EvidenceId = pick(link) }).ToList()
        };
        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, Accuse(link => link.EvidenceId)), level);
        foreach (var slot in gameCase.FinalLogic.RequiredEvidenceLinks)
        {
            foreach (var alternative in slot.AcceptedEvidenceIds ?? [])
            {
                Assert.Contains(gameCase.Clues, clue => clue.ClueId == alternative && clue.IsEvidence);
                Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase,
                    Accuse(link => link == slot ? alternative : link.EvidenceId)), $"{level}: {alternative} for {slot.ClaimType}");
            }
            // A red herring never proves a claim.
            foreach (var herring in gameCase.Clues.Where(clue => clue.IsRedHerring))
                Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase,
                    Accuse(link => link == slot ? herring.ClueId : link.EvidenceId)), $"{level}: {herring.ClueId} for {slot.ClaimType}");
        }
        // A wrong culprit loses even with the right evidence.
        var wrong = Accuse(link => link.EvidenceId);
        wrong.CulpritId = gameCase.Characters.First(character => character.CharacterId != gameCase.FinalLogic.CulpritId).CharacterId;
        Assert.False(GameplayV2Rules.IsAccusationCorrect(gameCase, wrong), level);
    }

    [Fact]
    public void SampleCases_AreSeededWithThePixelDemos()
    {
        var files = (string[])typeof(CaseService).GetField("PixelDemoFiles", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
        foreach (var file in Levels.Select(row => (string)row[0]))
            Assert.Contains(file, files);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src", "FE", "public"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("Repository root not found.");
    }
}
