using Microsoft.AspNetCore.SignalR;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.WebAPI.Hubs;

namespace SirLocked.Api.Services.TeamComms;

/// <summary>The chat between the two detectives of a match: stored, then pushed to the room as "TeamChatMessage".</summary>
public sealed class TeamChatService
{
    public const string ChatEvent = "TeamChatMessage";

    private readonly MongoDbContext _db;
    private readonly IHubContext<GameHub> _hub;
    private readonly SlidingWindowLimiter _limiter;
    private readonly TimeProvider _time;

    public TeamChatService(MongoDbContext db, IHubContext<GameHub> hub, TeamChatLimiter limiter, TimeProvider time)
    {
        _db = db;
        _hub = hub;
        _limiter = limiter.Limiter;
        _time = time;
    }

    /// <summary>The room, when the caller is one of the two detectives of its running match; otherwise the reason it is not.</summary>
    public async Task<GameRoom> RequireTeamRoomAsync(string userId, string roomId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(roomId, out _)) throw ApiException.NotFound("Room not found.");
        var room = await _db.Rooms.Find(candidate => candidate.Id == roomId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Room not found.");
        if (TeamCommsRules.MemberOf(room, userId) is null) throw ApiException.Forbidden("You are not a member of this room.");
        if (!TeamCommsRules.CanTalk(room, userId)) throw ApiException.Conflict("Chat and voice are open only during a two-player match.");
        return room;
    }

    public async Task<IReadOnlyList<TeamChatMessageDto>> HistoryAsync(string userId, string roomId, CancellationToken ct)
    {
        await RequireTeamRoomAsync(userId, roomId, ct);
        var latest = await _db.TeamChatMessages
            .Find(message => message.RoomId == roomId)
            // Two lines sent in the same millisecond keep the order they were written in: ids grow with each insert.
            .SortByDescending(message => message.SentAt).ThenByDescending(message => message.Id)
            .Limit(TeamCommsRules.HistoryLimit)
            .ToListAsync(ct);
        latest.Reverse();
        return latest.Select(TeamChatMessageDto.From).ToList();
    }

    public async Task<TeamChatMessageDto> SendAsync(string userId, string roomId, string? text, CancellationToken ct)
    {
        var normalized = TeamCommsRules.NormalizeText(text) ?? throw ApiException.BadRequest("Write something first.");
        if (TeamCommsRules.VisibleLength(normalized) > TeamCommsRules.MaxChatLength)
            throw ApiException.BadRequest($"A message holds at most {TeamCommsRules.MaxChatLength} characters.");
        var room = await RequireTeamRoomAsync(userId, roomId, ct);
        var now = _time.GetUtcNow().UtcDateTime;
        if (!_limiter.TryAcquire($"{roomId}:{userId}", now))
            throw new ApiException(429, "You are sending messages too fast. Wait a moment.");

        var player = TeamCommsRules.MemberOf(room, userId)!;
        var message = new TeamChatMessage
        {
            Id = ObjectId.GenerateNewId().ToString(),
            RoomId = roomId,
            UserId = userId,
            Username = player.Username,
            Role = player.Role,
            Text = normalized,
            // Mongo keeps milliseconds; the answer and the broadcast carry the same value as a later history read.
            SentAt = new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc),
        };
        await _db.TeamChatMessages.InsertOneAsync(message, cancellationToken: ct);
        var dto = TeamChatMessageDto.From(message);
        // Both detectives get it, the sender too: a second tab of theirs shows it, and their own tab replaces its draft line.
        await _hub.Clients.Group(GameHub.RoomGroup(roomId)).SendAsync(ChatEvent, dto, ct);
        return dto;
    }
}

/// <summary>The chat limiter as one shared instance for every request.</summary>
public sealed class TeamChatLimiter
{
    public SlidingWindowLimiter Limiter { get; } = SlidingWindowLimiter.ForChat();
}
