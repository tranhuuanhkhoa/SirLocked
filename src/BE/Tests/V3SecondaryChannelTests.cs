using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.WebAPI.Middlewares;
using Xunit;

namespace SirLocked.Tests;

public class V3SecondaryChannelTests
{
    private const string InvSecret = "INV_SECRET_SENTINEL_7F91";
    private const string IntSecret = "INT_SECRET_SENTINEL_42AC";

    [Fact]
    public void PhotoPolicy_AllowsOwnerAndDisclosedPartnerButNotPrivatePartnerOrUnknownClue()
    {
        var gameCase = new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
        };
        var room = new GameRoom
        {
            GameplayState = new GameplayState
            {
                ClueDiscoveries =
                {
                    new ClueDiscoveryRecord
                    {
                        ClueId = "evidence-1",
                        DiscoveredByUserId = "inv",
                        DiscoveredByRole = PlayerRole.Investigator
                    }
                }
            }
        };

        Assert.True(V3KnowledgeProjector.CanViewEvidencePhoto(room, gameCase, "inv", "evidence-1"));
        Assert.False(V3KnowledgeProjector.CanViewEvidencePhoto(room, gameCase, "int", "evidence-1"));
        Assert.False(V3KnowledgeProjector.CanViewEvidencePhoto(room, gameCase, "int", "missing"));

        room.GameplayState.ActiveConfrontation = new PairedConfrontationState
        {
            AttemptId = "attempt-1",
            Disclosures =
            {
                new PairedConfrontationDisclosureRecord
                {
                    Revision = 2,
                    EvidenceId = "evidence-1",
                    TestimonyFragmentId = "fragment-1"
                }
            }
        };

        Assert.True(V3KnowledgeProjector.CanViewEvidencePhoto(room, gameCase, "int", "evidence-1"));
    }

    [Fact]
    public void LegacyPhotoPolicy_RemainsTeamVisible()
    {
        var gameCase = new GameCase { MechanicsVersion = CaseMechanicsVersions.InvestigationV2 };
        var room = new GameRoom
        {
            GameplayState = new GameplayState
            {
                UnlockedClueIds = { "evidence-1" },
                CapturedClueIds = { "evidence-1" }
            }
        };

        Assert.True(V3KnowledgeProjector.CanViewEvidencePhoto(room, gameCase, "either-player", "evidence-1"));
    }

    [Fact]
    public void SignalRStateInvalidationPayload_HasOnlyRoomAndVersion()
    {
        var payload = GameNotifier.BuildGameStateUpdatedPayload("room-1", 42);
        var properties = payload.GetType().GetProperties().Select(property => property.Name).OrderBy(name => name).ToArray();
        var json = JsonSerializer.Serialize(payload);

        Assert.Equal(new[] { "RoomId", "Version" }, properties);
        Assert.DoesNotContain(InvSecret, json);
        Assert.DoesNotContain(IntSecret, json);
        Assert.DoesNotContain("clue", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("evidence", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("dialogue", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void V3ActionLogPolicy_IsDisabledWhileV1V2RemainEnabled()
    {
        Assert.True(GameplayService.ShouldPersistActionLog(new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.Legacy
        }));
        Assert.True(GameplayService.ShouldPersistActionLog(new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV2
        }));
        Assert.False(GameplayService.ShouldPersistActionLog(new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
        }));

        Assert.True(GameplayService.ShouldBroadcastDetailedEvents(new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV2
        }));
        Assert.False(GameplayService.ShouldBroadcastDetailedEvents(new GameCase
        {
            MechanicsVersion = CaseMechanicsVersions.InvestigationV3PairedConfrontation
        }));
    }

    [Fact]
    public async Task CodedError_UsesStableGenericDetailsWithoutSecretContent()
    {
        var context = Context();
        var middleware = new ErrorHandlingMiddleware(
            _ => throw ApiException.NotFound(
                "This evidence photo is not available.",
                "EVIDENCE_NOT_AVAILABLE",
                "game.confrontation.evidenceUnavailable"),
            NullLogger<ErrorHandlingMiddleware>.Instance);

        await middleware.InvokeAsync(context);
        var body = await Body(context);
        using var document = JsonDocument.Parse(body);
        var errors = document.RootElement.GetProperty("errors");

        Assert.Equal(StatusCodes.Status404NotFound, context.Response.StatusCode);
        Assert.Equal("EVIDENCE_NOT_AVAILABLE", errors.GetProperty("code").GetString());
        Assert.Equal("game.confrontation.evidenceUnavailable", errors.GetProperty("messageKey").GetString());
        Assert.DoesNotContain(InvSecret, body);
        Assert.DoesNotContain(IntSecret, body);
    }

    [Fact]
    public async Task UnhandledError_DoesNotSerializeExceptionDetailsOrSentinels()
    {
        var context = Context();
        var middleware = new ErrorHandlingMiddleware(
            _ => throw new InvalidOperationException($"{InvSecret} {IntSecret}"),
            NullLogger<ErrorHandlingMiddleware>.Instance);

        await middleware.InvokeAsync(context);
        var body = await Body(context);

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
        Assert.Contains("unexpected server error", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(InvSecret, body);
        Assert.DoesNotContain(IntSecret, body);
        Assert.DoesNotContain("InvalidOperationException", body);
    }

    private static DefaultHttpContext Context()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static async Task<string> Body(HttpContext context)
    {
        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body, Encoding.UTF8, leaveOpen: true);
        return await reader.ReadToEndAsync();
    }
}
