using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/game/rooms/{roomId}/playtest-events")]
[Authorize]
public sealed class PlaytestEventsController : BaseApiController
{
    private readonly IGameplayContextLoader _contextLoader;
    private readonly IPlaytestEventSink _sink;
    private readonly GameplayV3Settings _settings;

    public PlaytestEventsController(
        IGameplayContextLoader contextLoader,
        IPlaytestEventSink sink,
        IOptions<GameplayV3Settings> settings)
    {
        _contextLoader = contextLoader;
        _sink = sink;
        _settings = settings.Value;
    }

    // Each accepted call is one persisted document, so the write side carries its own per-user window.
    [HttpPost]
    [EnableRateLimiting("playtest-events")]
    public async Task<ActionResult<ApiResponse<bool>>> Record(
        string roomId,
        [FromBody] RecordUiPlaytestEventRequest request,
        CancellationToken cancellationToken)
    {
        if (!_settings.Enabled || !_settings.PlaytestInstrumentationEnabled)
        {
            throw ApiException.Conflict(
                "Playtest instrumentation is not enabled.",
                PairedConfrontationCoordinator.V3NotEnabledCode,
                "game.confrontation.disabled");
        }
        if (request.AttemptId is not null && !Guid.TryParse(request.AttemptId, out _))
        {
            throw ApiException.BadRequest("attemptId must be a UUID.");
        }

        var context = await _contextLoader.LoadAsync(CallerId, roomId, requireInProgress: true, cancellationToken);
        if (context.Case.MechanicsVersion != CaseMechanicsVersions.InvestigationV3PairedConfrontation)
        {
            throw ApiException.Conflict(
                "Playtest instrumentation is not available.",
                PairedConfrontationRules.NotAvailableCode,
                "game.confrontation.notAvailable");
        }

        await _sink.RecordAsync(
            roomId,
            CallerId,
            context.Player.Role ?? string.Empty,
            Enum.Parse<PlaytestEventType>(request.EventType!.Value.ToString()),
            context.Room.GameplayState?.Version ?? 0,
            request.AttemptId,
            request.Revision,
            request.DurationMs,
            request.Count,
            cancellationToken);
        return Ok(true);
    }
}
