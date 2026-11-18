using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Vip;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// VUAN-7 part G: hint prices and Google H5 Games Ads (Ad Placement API) for rewarded hints. A ticket is issued before
/// the ad shows, confirmed when the ad SDK reports it watched, and spent once on a level-2 hint.
/// </summary>
[Route("api/game")]
[Authorize]
public class HintAdsController(HintPaymentService hints, VipSettingsStore settings, IOptions<AdsSettings> ads, MongoDbContext db)
    : BaseApiController
{
    public sealed record HintEconomyDto(
        bool AdsEnabled, string PublisherId, bool AdsTestMode,
        long Level2Xu, long Level3Xu, int Level2PenaltyPercent, int Level3PenaltyPercent, bool VipFreeLevel2);

    /// <summary>What hints cost, and whether (and with which publisher id) the page may load the H5 Games Ads script.</summary>
    [HttpGet("hint-economy")]
    public async Task<ActionResult<ApiResponse<HintEconomyDto>>> Economy(CancellationToken ct)
    {
        var prices = await settings.GetHintsAsync(ct);
        var on = ads.Value.IsActive;
        return Ok(new HintEconomyDto(on, on ? ads.Value.PublisherId : string.Empty, on && ads.Value.TestMode,
            prices.Level2Xu, prices.Level3Xu, prices.Level2PenaltyPercent, prices.Level3PenaltyPercent, prices.VipFreeLevel2));
    }

    [HttpPost("rooms/{roomId}/hint-ad")]
    public async Task<ActionResult<ApiResponse<AdTicket>>> IssueTicket(string roomId, CancellationToken ct) =>
        Ok(await hints.IssueAdTicketAsync(Caller, await MemberRoomAsync(roomId, ct), ct));

    [HttpPost("rooms/{roomId}/hint-ad/{ticketId}/viewed")]
    public async Task<ActionResult<ApiResponse<AdTicket>>> Viewed(string roomId, string ticketId, CancellationToken ct)
    {
        await MemberRoomAsync(roomId, ct);
        return Ok(await hints.MarkViewedAsync(Caller, roomId, ticketId, ct));
    }

    private async Task<GameRoom> MemberRoomAsync(string roomId, CancellationToken ct)
    {
        var room = await db.Rooms.Find(item => item.Id == roomId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Room not found.");
        if (room.Players.All(player => player.UserId != CallerId))
            throw ApiException.Forbidden("You are not a detective of this room.");
        return room;
    }
}
