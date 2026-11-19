using System.Text.Json;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// VUAN-6B part B: the server lays out the accusation claims of an AI case, so it also fills acceptedEvidenceIds with the
/// other evidence of the same conclusion (TONG-KET decision B). Old cases grade as before.
/// </summary>
public sealed class AcceptedEvidencePolicyTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private const string Tram = "case-pixel-tram-hong-ngoc-vi.json";
    private const string LoThuoc = "case-pixel-lo-thuoc-thu-nam-vi.json";

    private static GameCase LoadSeed(string name) =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", name)), Web)!;
    private static GameCase LoadFixture(string name) =>
        JsonSerializer.Deserialize<GameCase>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name)), Web)!;

    /// <summary>An AI case as the projection compile makes it, with the server's claims filled.</summary>
    private static (AiCaseDraft Draft, GameCase Case, Dictionary<string, AiBridgeAssetUpload> Uploads) MockAiCase(string preset)
    {
        var draft = AiPromptBenchmark.Fixture(preset, CaseLanguages.Vietnamese);
        var content = ProjectionContentMockFactory.Build(draft.ProjectionPlan!);
        var gameCase = new GameCaseProjectionCompiler().Compile(draft.ProjectionPlan!, content, draft.Settings);
        gameCase.CaseId = "case-ai-mock-vi";
        AiV3GenerationProfile.ApplyServerOwnedFields(draft, gameCase, resetGeneratedAssets: true);
        AcceptedEvidencePolicy.Fill(gameCase, candidate => new CaseValidationService().ValidateFullLogic(candidate));
        return (draft, gameCase, new Dictionary<string, AiBridgeAssetUpload>());
    }

    [Fact]
    public void AcceptedEvidence_IsFilledFromTheSameConclusion_AndGradesCorrectly()
    {
        var (_, gameCase, _) = MockAiCase(AiGenerationPresets.NormalRandom);
        var links = gameCase.FinalLogic.RequiredEvidenceLinks;
        var withAlternatives = links.Where(link => link.AcceptedEvidenceIds is { Count: > 0 }).ToList();
        Assert.NotEmpty(withAlternatives);
        var primary = links.Select(link => link.EvidenceId).ToHashSet();
        foreach (var link in withAlternatives)
        foreach (var alternative in link.AcceptedEvidenceIds!)
        {
            var clue = gameCase.Clues.Single(entry => entry.ClueId == alternative);
            Assert.True(clue.IsEvidence);
            Assert.Contains(link.ConclusionId, clue.SupportsConclusionIds);
            Assert.DoesNotContain(alternative, primary);
        }
        var validation = new CaseValidationService().Validate(gameCase);
        Assert.DoesNotContain(validation.Errors, error => error.Path.Contains("acceptedEvidenceIds"));

        var request = new AccuseRequest
        {
            CulpritId = gameCase.FinalLogic.CulpritId, MotiveId = gameCase.FinalLogic.CorrectMotiveId, MethodId = gameCase.FinalLogic.CorrectMethodId,
            EvidenceLinks = links.Select(link => new EvidenceLinkRequest { ClaimType = link.ClaimType, EvidenceId = link.EvidenceId }).ToList()
        };
        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, request));
        var swapped = withAlternatives[0];
        request.EvidenceLinks.Single(link => link.ClaimType == swapped.ClaimType).EvidenceId = swapped.AcceptedEvidenceIds![0];
        Assert.True(GameplayV2Rules.IsAccusationCorrect(gameCase, request));
    }

    [Fact]
    public void AcceptedEvidence_DropsWhatTheValidatorRejects_AndLeavesHandMadeCasesAlone()
    {
        var (_, gameCase, _) = MockAiCase(AiGenerationPresets.NormalRandom);
        foreach (var link in gameCase.FinalLogic.RequiredEvidenceLinks) link.AcceptedEvidenceIds = null;
        var proposed = AcceptedEvidencePolicy.Propose(gameCase).SelectMany(pair => pair.Value).ToList();
        Assert.NotEmpty(proposed);
        var rejected = proposed[0];
        var added = AcceptedEvidencePolicy.Fill(gameCase, _ => new CaseValidationResult
        {
            Errors = [new CaseValidationError { Code = "UndiscoverableEvidence", Path = "finalLogic.requiredEvidenceLinks.acceptedEvidenceIds", RefId = rejected }]
        });
        Assert.DoesNotContain(rejected, added.Values.SelectMany(ids => ids));
        Assert.DoesNotContain(gameCase.FinalLogic.RequiredEvidenceLinks, link => link.AcceptedEvidenceIds?.Contains(rejected) == true);

        // Bundled cases have no conclusionId: nothing is added, the sample keeps its hand-written alternative.
        foreach (var name in new[] { Tram, LoThuoc })
        {
            var seed = LoadSeed(name);
            var before = JsonSerializer.Serialize(seed.FinalLogic, Web);
            Assert.Empty(AcceptedEvidencePolicy.Fill(seed));
            Assert.Equal(before, JsonSerializer.Serialize(seed.FinalLogic, Web));
        }
        var sample = LoadFixture("case-pixel-dong-ho-dem-mua-vi.json");
        AcceptedEvidencePolicy.Fill(sample);
        Assert.Equal(["evidence-dh-van-tay"], sample.FinalLogic.RequiredEvidenceLinks.Single(link => link.ClaimType == "OPPORTUNITY").AcceptedEvidenceIds!);
    }
}
