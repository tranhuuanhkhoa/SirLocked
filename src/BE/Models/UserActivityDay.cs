using MongoDB.Bson;

namespace SirLocked.Api.Models;

public sealed class UserActivityDay
{
    public ObjectId Id { get; set; } = ObjectId.GenerateNewId();
    public string UserId { get; set; } = string.Empty;
    public string Day { get; set; } = string.Empty;
    public DateTime FirstSeenAt { get; set; }
}
