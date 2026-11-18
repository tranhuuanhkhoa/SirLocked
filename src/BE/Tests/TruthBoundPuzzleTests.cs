using System.Text.Json.Nodes;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using SirLocked.Api.Services.PuzzleKinds;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Truth-bound puzzle kinds take their answer from the approved truth, or are not offered at all.</summary>
public sealed class TruthBoundPuzzleTests
{
    private static CaseTruthPackage Truth() => new()
    {
        CaseSeed = new CaseSeed { SuspectIds = ["char-a", "char-b", "char-c"] },
        CoreTruth = new CoreCaseTruth { CulpritId = "char-a" },
        TraceLedger =
        [
            new TraceLedgerEntry { TraceId = "trace-by-culprit", CreatedByCharacterId = "char-a" },
            new TraceLedgerEntry { TraceId = "trace-by-b", CreatedByCharacterId = "char-b" },
            new TraceLedgerEntry { TraceId = "trace-by-nobody", CreatedByCharacterId = "" }
        ]
    };

    [Fact]
    public void Fingerprint_IsOfferedOnlyForATraceAnInnocentSuspectLeft()
    {
        Assert.True(TruthBoundPuzzleAnswers.CanOffer("fingerprint", Truth(), "trace-by-b"));
        Assert.False(TruthBoundPuzzleAnswers.CanOffer("fingerprint", Truth(), "trace-by-culprit")); // never a free identification
        Assert.False(TruthBoundPuzzleAnswers.CanOffer("fingerprint", Truth(), "trace-by-nobody"));
        Assert.Equal("char-b", TruthBoundPuzzleAnswers.PrintOwner(Truth(), "trace-by-b"));
    }

    [Fact]
    public void FingerprintCards_AreTheOwnerAndAtMostThreeOtherSuspects()
    {
        var truth = Truth();
        truth.CaseSeed.SuspectIds = ["char-a", "char-b", "char-c", "char-d", "char-e"]; // a Hard case: five suspects
        var cards = TruthBoundPuzzleAnswers.PrintCards(truth, "char-e");
        Assert.Equal(4, cards.Count); // the fingerprint kind takes 2-4 reference cards
        Assert.Contains("char-e", cards);
        Assert.Equal(cards, TruthBoundPuzzleAnswers.PrintCards(truth, "char-e")); // deterministic
        Assert.Equal(["char-a", "char-b", "char-c"], TruthBoundPuzzleAnswers.PrintCards(Truth(), "char-b"));
    }

    [Theory]
    [InlineData("doc_forgery")]
    [InlineData("parallax_code")]
    public void KindsTheTruthCannotAnswer_AreNeverOffered(string kind)
    {
        Assert.False(TruthBoundPuzzleAnswers.CanOffer(kind, Truth(), "trace-by-b"));
        Assert.DoesNotContain(kind, PuzzleKindAuthoring.OfferedKinds(Truth(), "trace-by-b"));
    }

    [Fact]
    public void Fingerprint_CompilesWithTheSuspectsAsCardsAndTheTruthsOwnerAsTheAnswer()
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft("medium", AiCaseLeanings.Puzzle);
        var plan = OptionalPuzzleProjectionTests.Plan(draft);
        var suspects = draft.CaseTruth!.CaseSeed.SuspectIds;
        var slot = plan.Puzzles["puzzle-01"];
        slot.OfferedKinds = [.. slot.OfferedKinds!, "fingerprint"];
        slot.PrintOwnerId = suspects[1];
        slot.PrintCardIds = suspects.ToList();
        plan.PlanHash = ProjectionCanonicalizer.ComputePlanHash(plan); // the slot was edited by hand above
        var content = ProjectionContentMockFactory.Build(plan);
        content.Puzzles["puzzle-01"].Kind = "fingerprint";
        content.Puzzles["puzzle-01"].Authored = """{"surface":"mặt kính tủ thuốc"}""";

        GameCase compiled;
        try { compiled = new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings); }
        catch (ProjectionCompilationException exception) { throw new Xunit.Sdk.XunitException(string.Join(" | ", exception.Errors)); }
        var puzzle = compiled.Puzzles.Single(item => item.PuzzleId == "puzzle-01");

        var cards = JsonNode.Parse(puzzle.ParamsJson)!["cards"]!.AsArray().Select(card => card!["id"]!.GetValue<string>()).ToArray();
        Assert.Equal(suspects, cards);
        Assert.Equal(suspects[1], JsonNode.Parse(puzzle.SolutionJson)!["card"]!.GetValue<string>());
        var errors = new List<string>();
        PuzzleKindRegistry.Validate(puzzle, "puzzle", (field, message, _) => errors.Add($"{field}: {message}"));
        Assert.Empty(errors);
    }

    [Fact]
    public void AKindTheTruthCannotAnswer_IsRejectedWhenPickedAnyway()
    {
        var draft = OpenCoopProjectionTests.OpenCoopDraft("medium", AiCaseLeanings.Puzzle);
        var plan = OptionalPuzzleProjectionTests.Plan(draft);
        var content = ProjectionContentMockFactory.Build(plan);
        content.Puzzles["puzzle-01"].Kind = "doc_forgery";
        var error = Assert.Throws<ProjectionCompilationException>(() => new GameCaseProjectionCompiler().Compile(plan, content, draft.Settings));
        Assert.Contains(error.Errors, line => line.Contains("PuzzleKindNotSupportedByTruth") && line.Contains("puzzles.puzzle-01.kind"));
    }
}
