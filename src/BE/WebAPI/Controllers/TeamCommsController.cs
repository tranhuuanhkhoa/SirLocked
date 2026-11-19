using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services.TeamComms;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>Chat and voice between the two detectives of a match. The voice itself goes browser to browser (WebRTC).</summary>
[Route("api/game/rooms/{roomId}")]
[Authorize]
public sealed class TeamCommsController : BaseApiController
{
    private readonly TeamChatService _chat;
    private readonly IceServerProvider _iceServers;

    public TeamCommsController(TeamChatService chat, IceServerProvider iceServers)
    {
        _chat = chat;
        _iceServers = iceServers;
    }

    [HttpGet("chat")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<TeamChatMessageDto>>>> History(string roomId, CancellationToken ct) =>
        Ok(await _chat.HistoryAsync(CallerId, roomId, ct));

    [HttpPost("chat")]
    public async Task<ActionResult<ApiResponse<TeamChatMessageDto>>> Send(string roomId, [FromBody] SendTeamChatRequest request, CancellationToken ct) =>
        Ok(await _chat.SendAsync(CallerId, roomId, request.Text, ct));

    /// <summary>The STUN/TURN servers for the voice connection. Only the match's players get them, so relay credentials stay ours.</summary>
    [HttpGet("voice")]
    public async Task<ActionResult<ApiResponse<VoiceConfigDto>>> Voice(string roomId, CancellationToken ct)
    {
        await _chat.RequireTeamRoomAsync(CallerId, roomId, ct);
        return Ok(await _iceServers.ForUserAsync(CallerId, ct));
    }
}
