namespace SirLocked.Api.Services.TeamComms;

/// <summary>
/// Who has the voice channel of a match open, from which connection, and whether their microphone is on. Kept in memory:
/// a voice channel only lives as long as the players' connections, and the server runs as one process.
/// One entry per player and match: opening voice in a second tab takes it over from the first.
/// </summary>
public sealed class VoiceRoomRegistry
{
    public sealed record Member(string UserId, string ConnectionId, bool MicOn);

    private readonly Dictionary<string, Dictionary<string, Member>> _rooms = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    /// <summary>Opens voice for the player. Returns the others already in the channel, and the tab it was taken from, if any.</summary>
    public (IReadOnlyList<Member> Others, Member? Replaced) Join(string roomId, string userId, string connectionId, bool micOn)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(roomId, out var members)) _rooms[roomId] = members = new Dictionary<string, Member>(StringComparer.Ordinal);
            members.TryGetValue(userId, out var previous);
            members[userId] = new Member(userId, connectionId, micOn);
            var replaced = previous is not null && previous.ConnectionId != connectionId ? previous : null;
            return (members.Values.Where(member => member.UserId != userId).ToList(), replaced);
        }
    }

    /// <summary>The player's microphone changed. Null when this connection does not hold the player's voice channel.</summary>
    public Member? SetMic(string roomId, string userId, string connectionId, bool micOn)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(roomId, out var members) || !members.TryGetValue(userId, out var member) || member.ConnectionId != connectionId)
                return null;
            return members[userId] = member with { MicOn = micOn };
        }
    }

    /// <summary>Closes the player's voice channel, but only from the connection that holds it (an old tab cannot close a new one).</summary>
    public bool Leave(string roomId, string userId, string connectionId)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(roomId, out var members) || !members.TryGetValue(userId, out var member) || member.ConnectionId != connectionId)
                return false;
            members.Remove(userId);
            if (members.Count == 0) _rooms.Remove(roomId);
            return true;
        }
    }

    /// <summary>Everything a closed connection held: the rooms and players whose voice it ends.</summary>
    public IReadOnlyList<(string RoomId, string UserId)> LeaveAll(string connectionId)
    {
        lock (_gate)
        {
            var left = new List<(string RoomId, string UserId)>();
            foreach (var (roomId, members) in _rooms.ToList())
            {
                foreach (var member in members.Values.Where(member => member.ConnectionId == connectionId).ToList())
                {
                    members.Remove(member.UserId);
                    left.Add((roomId, member.UserId));
                }
                if (members.Count == 0) _rooms.Remove(roomId);
            }
            return left;
        }
    }

    public Member? Find(string roomId, string userId)
    {
        lock (_gate)
        {
            return _rooms.TryGetValue(roomId, out var members) && members.TryGetValue(userId, out var member) ? member : null;
        }
    }
}
