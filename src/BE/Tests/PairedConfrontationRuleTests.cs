using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public class PairedConfrontationRuleTests
{
    private static readonly DateTime Now = new(2026, 7, 19, 8, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Start_IsInterrogatorOnlyAndIdempotentForSameAttempt()
    {
        var state = new GameplayState();

        var wrongRole = Assert.Throws<PairedConfrontationRuleException>(() =>
            PairedConfrontationRules.Start(
                state, "attempt-1", "challenge-1", "fragment-1", "inv", PlayerRole.Investigator, Now));
        Assert.Equal(PairedConfrontationRules.WrongRoleCode, wrongRole.Code);

        var first = PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-1", "int", PlayerRole.Interrogator, Now);
        var retry = PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-1", "int", PlayerRole.Interrogator, Now.AddSeconds(1));

        Assert.True(first.Changed);
        Assert.False(retry.Changed);
        Assert.Equal(PairedConfrontationStatus.CollectingProposals, state.ActiveConfrontation!.Status);
        Assert.Equal(1, state.ActiveConfrontation.Revision);
    }

    [Fact]
    public void PairingAndEdit_DiscloseEveryReviewedRevisionAndClearConfirmations()
    {
        var state = PairedState();
        var paired = PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-old", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));

        Assert.Equal(PairedConfrontationStatus.ReadyForReview, paired.Status);
        Assert.Equal(2, state.ActiveConfrontation!.Revision);
        var oldDisclosure = Assert.Single(state.ActiveConfrontation.Disclosures);
        Assert.Equal("evidence-old", oldDisclosure.EvidenceId);

        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, false, Array.Empty<string>(), Now.AddMinutes(2));
        Assert.Single(state.ActiveConfrontation.Confirmations);

        var edited = PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-new", "inv", PlayerRole.Investigator, 2, Now.AddMinutes(3));

        Assert.Equal(PairedConfrontationStatus.ReadyForReview, edited.Status);
        Assert.Equal(3, state.ActiveConfrontation.Revision);
        Assert.Empty(state.ActiveConfrontation.Confirmations);
        Assert.Equal(2, state.ActiveConfrontation.Disclosures.Count);
        Assert.Contains(state.ActiveConfrontation.Disclosures, disclosure =>
            disclosure.Revision == 2 && disclosure.EvidenceId == "evidence-old");
        Assert.Contains(state.ActiveConfrontation.Disclosures, disclosure =>
            disclosure.Revision == 3 && disclosure.EvidenceId == "evidence-new");
    }

    [Fact]
    public void ProposalLostResponseRetry_IsIdempotentEvenWithPreviousRevision()
    {
        var state = PairedState();
        var first = PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-1", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        var retry = PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", "evidence-1", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(2));

        Assert.True(first.Changed);
        Assert.False(retry.Changed);
        Assert.Equal(2, state.ActiveConfrontation!.Revision);
        Assert.Single(state.ActiveConfrontation.Disclosures);
    }

    [Fact]
    public void ConfirmCorrect_ResolvesExactlyOnceAndBindsConfirmationsToRevision()
    {
        var state = ReadyState("evidence-correct");

        var first = PairedConfrontationRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(2));
        var second = PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, true, new[] { "reveal-1" }, Now.AddMinutes(3));
        var retry = PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, false, new[] { "reveal-1" }, Now.AddMinutes(4));

        Assert.Equal(PairedConfrontationStatus.AwaitingSecondConfirmation, first.Status);
        Assert.Equal(PairedConfrontationStatus.ResolvedCorrect, second.Status);
        Assert.False(retry.Changed);
        Assert.Null(state.ActiveConfrontation);
        var terminal = Assert.Single(state.PairedConfrontationAttempts);
        Assert.Equal(PairedConfrontationStatus.ResolvedCorrect, terminal.Status);
        Assert.All(terminal.Confirmations, confirmation => Assert.Equal(2, confirmation.Revision));
        Assert.Equal(new[] { "reveal-1" }, state.UnlockedClueIds);
        Assert.Single(state.ResolvedConfrontationRecords);
        Assert.Equal(0, state.WrongEvidencePresentationCount);
    }

    [Fact]
    public void IncorrectRetry_DoesNotDoubleCountAndDoesNotUnlock()
    {
        var state = ReadyState("evidence-wrong");

        PairedConfrontationRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 2, false, new[] { "must-not-unlock" }, Now.AddMinutes(2));
        PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, false, new[] { "must-not-unlock" }, Now.AddMinutes(3));
        var retry = PairedConfrontationRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 2, false, new[] { "must-not-unlock" }, Now.AddMinutes(4));

        Assert.False(retry.Changed);
        Assert.Equal(1, state.WrongEvidencePresentationCount);
        Assert.Empty(state.UnlockedClueIds);
        Assert.Equal(PairedConfrontationStatus.ResolvedIncorrect, Assert.Single(state.PairedConfrontationAttempts).Status);
    }

    [Fact]
    public void StaleMutation_IsExplicitAndCancelHasNoPenalty()
    {
        var state = ReadyState("evidence-1");

        var stale = Assert.Throws<PairedConfrontationRuleException>(() =>
            PairedConfrontationRules.ProposeEvidence(
                state, "attempt-1", "evidence-2", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(2)));
        Assert.Equal(PairedConfrontationRules.StaleCode, stale.Code);

        var cancelled = PairedConfrontationRules.Cancel(
            state, "attempt-1", "inv", PlayerRole.Investigator, 2, Now.AddMinutes(3));

        Assert.Equal(PairedConfrontationStatus.Cancelled, cancelled.Status);
        Assert.Null(state.ActiveConfrontation);
        Assert.Equal(0, state.WrongEvidencePresentationCount);
        Assert.Empty(state.UnlockedClueIds);
        Assert.Single(cancelled.Terminal!.Disclosures);
    }

    [Fact]
    public void PersistenceContract_SerializesStatusAsStringAndLegacyDefaultsAreSafe()
    {
        var state = ReadyState("evidence-1");

        var json = JsonSerializer.Serialize(state);
        var bson = state.ToBsonDocument();
        var roundTrip = BsonSerializer.Deserialize<GameplayState>(bson);
        var legacy = BsonSerializer.Deserialize<GameplayState>(new BsonDocument
        {
            { "currentStageId", "stage-1" },
            { "currentSceneId", "scene-1" }
        });

        Assert.Contains("\"Status\":\"ReadyForReview\"", json, StringComparison.Ordinal);
        var activeDocument = bson.Contains("activeConfrontation")
            ? bson["activeConfrontation"].AsBsonDocument
            : bson["ActiveConfrontation"].AsBsonDocument;
        var statusValue = activeDocument.Contains("status")
            ? activeDocument["status"]
            : activeDocument["Status"];
        Assert.Equal(BsonType.String, statusValue.BsonType);
        Assert.Equal(PairedConfrontationStatus.ReadyForReview, roundTrip.ActiveConfrontation!.Status);
        Assert.Null(legacy.ActiveConfrontation);
        Assert.Empty(legacy.TestimonyDiscoveries);
        Assert.Empty(legacy.PairedConfrontationAttempts);
    }

    private static GameplayState PairedState()
    {
        var state = new GameplayState();
        PairedConfrontationRules.Start(
            state, "attempt-1", "challenge-1", "fragment-1", "int", PlayerRole.Interrogator, Now);
        return state;
    }

    private static GameplayState ReadyState(string evidenceId)
    {
        var state = PairedState();
        PairedConfrontationRules.ProposeEvidence(
            state, "attempt-1", evidenceId, "inv", PlayerRole.Investigator, 1, Now.AddMinutes(1));
        return state;
    }
}
