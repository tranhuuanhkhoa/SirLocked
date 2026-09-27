using System.Text.Json;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class InvestigationV3CaseValidationTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Theory]
    [InlineData("case-v3-broken-seal-en.json", "en")]
    [InlineData("case-v3-broken-seal-vi.json", "vi")]
    public void BilingualSandbox_IsPublishValidAndHasRequiredChoiceTopology(string fileName, string language)
    {
        var gameCase = Load(fileName);

        var validation = new CaseValidationService().Validate(gameCase);

        Assert.True(validation.IsValid, string.Join(Environment.NewLine, validation.Errors.Select(error =>
            $"{error.Code} {error.Path}: {error.Message}")));
        Assert.Equal(language, gameCase.Language);
        Assert.Equal(3, gameCase.MechanicsVersion);
        Assert.Equal(3, gameCase.Clues.Count(clue => clue.IsEvidence));
        Assert.Equal(3, gameCase.TestimonyFragments.Count);
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        Assert.Equal(3, challenge.CandidateEvidenceIds.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(3, challenge.CandidateTestimonyFragmentIds.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains(challenge.CorrectEvidenceId, challenge.CandidateEvidenceIds);
        Assert.Contains(challenge.TestimonyFragmentId, challenge.CandidateTestimonyFragmentIds);
        Assert.Empty(gameCase.ConversationNodes);
        var deduction = Assert.Single(gameCase.Deductions);
        Assert.Contains(challenge.ChallengeId, deduction.RequiredChallengeIds);
        var chain = Assert.Single(gameCase.RequiredTeamworkChains);
        Assert.Equal(challenge.ChallengeId, chain.InterrogatorChallengeId);
        Assert.Contains(deduction.DeductionId, gameCase.FinalLogic.RequiredDeductionIds);
        Assert.Contains(chain.ChainId, gameCase.FinalLogic.RequiredTeamworkChainIds);
        Assert.Equal(3, gameCase.FinalLogic.RequiredEvidenceLinks.Count);
        Assert.Empty(gameCase.Puzzles);
    }

    [Fact]
    public void BilingualSandbox_UsesTheSameRuntimeAndAssetTopology()
    {
        var english = Load("case-v3-broken-seal-en.json");
        var vietnamese = Load("case-v3-broken-seal-vi.json");
        var englishScene = Assert.Single(Assert.Single(english.Stages).Scenes);
        var vietnameseScene = Assert.Single(Assert.Single(vietnamese.Stages).Scenes);

        Assert.Equal(englishScene.BackgroundUrl, vietnameseScene.BackgroundUrl);
        Assert.Equal(
            englishScene.Runtime!.ItemPlacements.Select(placement => placement.Asset),
            vietnameseScene.Runtime!.ItemPlacements.Select(placement => placement.Asset));
        Assert.Equal(
            englishScene.Runtime.CharacterPlacements.Select(placement => placement.Asset),
            vietnameseScene.Runtime.CharacterPlacements.Select(placement => placement.Asset));
        Assert.Equal(englishScene.Hotspots.Select(hotspot => hotspot.Type), vietnameseScene.Hotspots.Select(hotspot => hotspot.Type));
    }

    [Fact]
    public void V3Validator_RejectsSpoilerFeedbackAndCircularRevealWhileAllowingConversationTrees()
    {
        var gameCase = Load("case-v3-broken-seal-en.json");
        var challenge = Assert.Single(gameCase.EvidenceChallenges);
        challenge.FailureResponse = $"Try {challenge.CorrectEvidenceId}.";
        challenge.UnlockClueIds.Add(challenge.CorrectEvidenceId);
        gameCase.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "unsupported-node",
            CharacterId = gameCase.Characters[0].CharacterId,
            IsRoot = true
        });

        var validation = new CaseValidationService().Validate(gameCase);

        Assert.Contains(validation.Errors, error => error.Code == "SecretLeak");
        Assert.DoesNotContain(validation.Errors, error => error.Path == "conversationNodes"
            && error.Message.Contains("not support", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(validation.Errors, error =>
            error.Path.EndsWith("unlockClueIds", StringComparison.Ordinal)
            && error.Message.Contains("own confrontation", StringComparison.Ordinal));
    }

    [Fact]
    public void PublicInvestigationStateDtos_DoNotExposeAnswerOrCandidateIds()
    {
        var dtoProperties = typeof(GameStateResponse).Assembly.GetTypes()
            .Where(type => type.IsPublic
                && type.Namespace?.Equals("SirLocked.Api.DTOs.Investigation", StringComparison.Ordinal) == true)
            .SelectMany(type => type.GetProperties())
            .Select(property => property.Name)
            .ToList();

        Assert.DoesNotContain(dtoProperties, name =>
            name.Equals("CorrectEvidenceId", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(dtoProperties, name =>
            name.Equals("CandidateEvidenceIds", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(dtoProperties, name =>
            name.Equals("CandidateTestimonyFragmentIds", StringComparison.OrdinalIgnoreCase));
    }

    private static GameCase Load(string fileName)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", fileName);
        return JsonSerializer.Deserialize<GameCase>(File.ReadAllText(path), JsonOptions)
            ?? throw new InvalidOperationException($"Could not deserialize {fileName}.");
    }
}
