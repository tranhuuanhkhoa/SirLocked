using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.Services;

/// <summary>Admin-editable AI case settings, stored as the <c>aiCases</c> document of <c>gameSettings</c>.</summary>
[BsonIgnoreExtraElements]
public class AiCaseSettingsDocument
{
    public const string DocumentId = "aiCases";

    [BsonId]
    public string Id { get; set; } = DocumentId;
    /// <summary>How many orders one VIP may place per week (Monday to Sunday, Vietnam time).</summary>
    public int VipWeeklyOrderLimit { get; set; } = AiCaseSettingsStore.DefaultVipWeeklyOrderLimit;
    public DateTime? UpdatedAt { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
}

public sealed class AiCaseSettingsStore(MongoDbContext db)
{
    public const int DefaultVipWeeklyOrderLimit = 2;
    public const int MaxVipWeeklyOrderLimit = 50;

    private IMongoCollection<AiCaseSettingsDocument> Collection =>
        db.Database.GetCollection<AiCaseSettingsDocument>("gameSettings");

    public async Task<AiCaseSettingsDocument> GetAsync(CancellationToken ct = default) =>
        await Collection.Find(item => item.Id == AiCaseSettingsDocument.DocumentId).FirstOrDefaultAsync(ct)
        ?? new AiCaseSettingsDocument();

    public async Task<AiCaseSettingsDocument> SaveAsync(int vipWeeklyOrderLimit, string userId, CancellationToken ct = default)
    {
        if (vipWeeklyOrderLimit is < 0 or > MaxVipWeeklyOrderLimit)
            throw ApiException.BadRequest(
                $"vipWeeklyOrderLimit must be between 0 and {MaxVipWeeklyOrderLimit}.",
                new ApiErrorDetails("AI_SETTINGS_INVALID", "ai.settings.invalid"));
        var document = new AiCaseSettingsDocument
        {
            VipWeeklyOrderLimit = vipWeeklyOrderLimit,
            UpdatedAt = DateTime.UtcNow,
            UpdatedByUserId = userId
        };
        await Collection.ReplaceOneAsync(
            item => item.Id == AiCaseSettingsDocument.DocumentId,
            document,
            new ReplaceOptions { IsUpsert = true },
            ct);
        return document;
    }
}
