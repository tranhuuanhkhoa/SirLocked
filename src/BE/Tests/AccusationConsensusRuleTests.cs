using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.Tests;

public class AccusationConsensusRuleTests
{
    private static readonly DateTime Now = new(2026, 7, 27, 9, 0, 0, DateTimeKind.Utc);
    private static readonly string[] Pair = { "inv", "int" };

    [Fact]
    public void Propose_IsRefusedUntilTheCaseIsActuallyReadyForAnAccusation()
    {
        var gameCase = BuildCase();
        var tooEarly = new GameplayState { CurrentSceneId = "scene-1" };

        var failure = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Propose(
            gameCase, tooEarly, "attempt-1", "inv", PlayerRole.Investigator, "scene-1", Content(), Pair, Now));

        Assert.Equal(AccusationConsensusRules.NotActiveCode, failure.Code);
        Assert.Null(tooEarly.ActiveAccusation);
    }

    [Fact]
    public void Propose_OpensOneRevisionThatCountsItsAuthorAsConfirmed()
    {
        var state = ReadyState();

        var transition = Propose(state);

        Assert.True(transition.Changed);
        Assert.False(transition.ShouldResolve);
        var active = state.ActiveAccusation!;
        Assert.Equal(AccusationProposalStatus.AwaitingConfirmation, active.Status);
        Assert.Equal(1, active.Revision);
        var confirmation = Assert.Single(active.Confirmations);
        Assert.Equal("inv", confirmation.UserId);
        Assert.Equal(1, confirmation.Revision);
        Assert.Equal("char-1", active.CulpritId);
    }

    [Fact]
    public void PartnerConfirmation_IsWhatResolvesTheCase()
    {
        var state = ReadyState();
        Propose(state);

        var transition = AccusationConsensusRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 1, Pair, Now.AddMinutes(1));

        Assert.True(transition.ShouldResolve);
        Assert.Null(state.ActiveAccusation);
        var terminal = Assert.Single(state.AccusationAttempts);
        Assert.Equal(AccusationProposalStatus.Resolved, terminal.Status);
        Assert.Equal(2, terminal.Confirmations.Count);
        Assert.Same(terminal, transition.Terminal);
    }

    [Fact]
    public void ProposerConfirmingAgain_IsAnIdempotentRetryAndNeverResolves()
    {
        var state = ReadyState();
        Propose(state);

        var transition = AccusationConsensusRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 1, Pair, Now.AddMinutes(1));

        Assert.False(transition.Changed);
        Assert.False(transition.ShouldResolve);
        Assert.Single(state.ActiveAccusation!.Confirmations);
        Assert.Empty(state.AccusationAttempts);
    }

    [Fact]
    public void Amend_StartsANewRevisionOwnedOnlyByWhoeverChangedIt()
    {
        var state = ReadyState();
        Propose(state);

        var transition = AccusationConsensusRules.Amend(
            state,
            "attempt-1",
            "int",
            PlayerRole.Interrogator,
            Content("char-2"),
            1,
            Pair,
            Now.AddMinutes(1));

        Assert.True(transition.Changed);
        Assert.False(transition.ShouldResolve);
        var active = state.ActiveAccusation!;
        Assert.Equal(2, active.Revision);
        Assert.Equal("char-2", active.CulpritId);
        var confirmation = Assert.Single(active.Confirmations);
        Assert.Equal("int", confirmation.UserId);
        Assert.Equal(2, confirmation.Revision);
    }

    [Fact]
    public void ConfirmingTheRevisionYouReviewed_IsRejectedOnceItHasBeenAmended()
    {
        var state = ReadyState();
        Propose(state);
        AccusationConsensusRules.Amend(
            state, "attempt-1", "int", PlayerRole.Interrogator, Content("char-2"), 1, Pair, Now.AddMinutes(1));

        var stale = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Confirm(
            state, "attempt-1", "inv", PlayerRole.Investigator, 1, Pair, Now.AddMinutes(2)));

        Assert.Equal(AccusationConsensusRules.StaleRevisionCode, stale.Code);
        Assert.Empty(state.AccusationAttempts);
        Assert.Single(state.ActiveAccusation!.Confirmations);
    }

    [Fact]
    public void SecondProposal_IsRefusedWhileOneIsOpenButAnIdenticalRetryIsNot()
    {
        var state = ReadyState();
        Propose(state);

        var retry = Propose(state, attemptId: "attempt-2");
        var rival = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Propose(
            BuildCase(), state, "attempt-3", "int", PlayerRole.Interrogator, "scene-1", Content("char-2"), Pair, Now));

        Assert.False(retry.Changed);
        Assert.Equal("attempt-1", state.ActiveAccusation!.AttemptId);
        Assert.Equal(AccusationConsensusRules.NotActiveCode, rival.Code);
    }

    [Fact]
    public void Cancel_ArchivesTheProposalAndReopensProposing()
    {
        var state = ReadyState();
        Propose(state);

        var cancelled = AccusationConsensusRules.Cancel(
            state, "attempt-1", "int", PlayerRole.Interrogator, 1, Now.AddMinutes(1));
        var reproposed = Propose(state, attemptId: "attempt-2", culpritId: "char-2");

        Assert.Equal(AccusationProposalStatus.Cancelled, cancelled.Terminal!.Status);
        Assert.Equal(AccusationProposalStatus.Cancelled, Assert.Single(state.AccusationAttempts).Status);
        Assert.True(reproposed.Changed);
        Assert.Equal("attempt-2", state.ActiveAccusation!.AttemptId);
        Assert.Equal(1, state.ActiveAccusation.Revision);
    }

    [Fact]
    public void CommandsForAnUnknownAttempt_AreRefusedRatherThanRetargeted()
    {
        var state = ReadyState();
        Propose(state);

        var confirm = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Confirm(
            state, "attempt-other", "int", PlayerRole.Interrogator, 1, Pair, Now.AddMinutes(1)));
        var cancel = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Cancel(
            state, "attempt-other", "int", PlayerRole.Interrogator, 1, Now.AddMinutes(1)));

        Assert.Equal(AccusationConsensusRules.NotActiveCode, confirm.Code);
        Assert.Equal(AccusationConsensusRules.NotActiveCode, cancel.Code);
        Assert.Equal(AccusationProposalStatus.AwaitingConfirmation, state.ActiveAccusation!.Status);
    }

    [Fact]
    public void AResolvedAccusation_CannotBeAmendedOrCancelledAfterTheFact()
    {
        var state = ReadyState();
        Propose(state);
        AccusationConsensusRules.Confirm(
            state, "attempt-1", "int", PlayerRole.Interrogator, 1, Pair, Now.AddMinutes(1));

        var amend = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Amend(
            state, "attempt-1", "inv", PlayerRole.Investigator, Content("char-2"), 1, Pair, Now.AddMinutes(2)));
        var cancel = Assert.Throws<AccusationRuleException>(() => AccusationConsensusRules.Cancel(
            state, "attempt-1", "inv", PlayerRole.Investigator, 1, Now.AddMinutes(2)));

        Assert.Equal(AccusationConsensusRules.AlreadyConfirmedCode, amend.Code);
        Assert.Equal(AccusationConsensusRules.AlreadyConfirmedCode, cancel.Code);
        Assert.Single(state.AccusationAttempts);
    }

    [Fact]
    public void ASingleOccupantRoom_CanNeverReachConsensusOnItsOwn()
    {
        var state = ReadyState();

        var transition = AccusationConsensusRules.Propose(
            BuildCase(), state, "attempt-1", "inv", PlayerRole.Investigator, "scene-1", Content(), new[] { "inv" }, Now);

        Assert.False(transition.ShouldResolve);
        Assert.Empty(state.AccusationAttempts);
        Assert.Equal(AccusationProposalStatus.AwaitingConfirmation, state.ActiveAccusation!.Status);
    }

    [Fact]
    public void ConsensusGate_FollowsTheMechanicsVersionUnlessConfigurationOverridesIt()
    {
        var v2 = new GameCase { MechanicsVersion = CaseMechanicsVersions.InvestigationV2 };
        var v3 = new GameCase { MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation };

        Assert.False(AccusationConsensusRules.RequiresConsensus(v2, null));
        Assert.True(AccusationConsensusRules.RequiresConsensus(v3, null));
        Assert.True(AccusationConsensusRules.RequiresConsensus(v2, true));
        Assert.False(AccusationConsensusRules.RequiresConsensus(v3, false));
    }

    [Fact]
    public void PersistenceContract_SerializesStatusAsStringAndLegacyRoomsStillDeserialize()
    {
        var state = ReadyState();
        Propose(state);

        var bson = state.ToBsonDocument();
        var roundTrip = BsonSerializer.Deserialize<GameplayState>(bson);
        // A room written before this feature simply has neither field.
        var legacy = BsonSerializer.Deserialize<GameplayState>(new BsonDocument
        {
            { "currentStageId", "stage-1" },
            { "currentSceneId", "scene-1" },
            { "version", 7L }
        });

        var activeDocument = bson.Contains("activeAccusation")
            ? bson["activeAccusation"].AsBsonDocument
            : bson["ActiveAccusation"].AsBsonDocument;
        var statusValue = activeDocument.Contains("status") ? activeDocument["status"] : activeDocument["Status"];
        Assert.Equal(BsonType.String, statusValue.BsonType);
        Assert.Equal(AccusationProposalStatus.AwaitingConfirmation, roundTrip.ActiveAccusation!.Status);
        Assert.Equal(1, roundTrip.ActiveAccusation.Revision);
        Assert.Null(legacy.ActiveAccusation);
        Assert.Empty(legacy.AccusationAttempts);
        Assert.Equal(7, legacy.Version);
    }

    [Fact]
    public void ConsensusRoutes_KeepTheAgreedShapeUnderTheRoomPrefix()
    {
        var route = typeof(AccusationsController).GetCustomAttribute<RouteAttribute>()!.Template;
        string Template(string method) => typeof(AccusationsController).GetMethod(method)!
            .GetCustomAttributes()
            .OfType<IRouteTemplateProvider>()
            .Single()
            .Template ?? string.Empty;

        Assert.Equal("api/game/rooms/{roomId}/accusation", route);
        Assert.Equal(string.Empty, Template(nameof(AccusationsController.Propose)));
        Assert.Equal("{attemptId}", Template(nameof(AccusationsController.Amend)));
        Assert.Equal("{attemptId}/confirm", Template(nameof(AccusationsController.Confirm)));
        Assert.Equal("{attemptId}/cancel", Template(nameof(AccusationsController.Cancel)));
    }

    private static AccusationTransition Propose(
        GameplayState state,
        string attemptId = "attempt-1",
        string culpritId = "char-1") =>
        AccusationConsensusRules.Propose(
            BuildCase(),
            state,
            attemptId,
            "inv",
            PlayerRole.Investigator,
            "scene-1",
            Content(culpritId),
            Pair,
            Now);

    private static AccusationProposalContent Content(string culpritId = "char-1") => new(
        culpritId,
        "motive-1",
        "method-1",
        new[] { "clue-1" },
        new[] { new SelectedEvidenceLink { ClaimType = "MOTIVE", EvidenceId = "clue-1" } });

    private static GameplayState ReadyState() => new()
    {
        CurrentStageId = "stage-1",
        CurrentSceneId = "scene-1",
        CompletedSceneIds = { "scene-1" },
        Version = 1
    };

    private static GameCase BuildCase() => new()
    {
        CaseId = "case-consensus",
        MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation,
        Stages = new List<CaseStage>
        {
            new()
            {
                StageId = "stage-1",
                Order = 1,
                Scenes = new List<CaseScene> { new() { SceneId = "scene-1" } }
            }
        }
    };
}
