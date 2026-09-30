using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class MongoAiDraftIndexTests
{
    [Theory]
    [InlineData("idempotencyKey", "ux_aiCaseDrafts_creator_idempotency")]
    [InlineData("activeQuotaKey", "ux_aiCaseDrafts_activeQuotaKey")]
    [InlineData("dailyQuotaKey", "ux_aiCaseDrafts_dailyQuotaKey")]
    public async Task OptionalDraftKeys_EnforceUniquenessOnlyForNonemptyStrings(string field, string indexName)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase)) return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        var client = new MongoClient(settings.ConnectionString);
        try
        {
            await db.EnsureIndexesAsync();
            await db.EnsureIndexesAsync(); // Repeated application startup must also succeed.
            var drafts = db.Database.GetCollection<BsonDocument>(settings.AiCaseDraftsCollectionName);
            BsonDocument Draft(string owner = "owner-a") => new()
            {
                ["_id"] = ObjectId.GenerateNewId(), ["createdByUserId"] = owner
            };
            for (var repeat = 0; repeat < 2; repeat++)
            {
                await drafts.InsertOneAsync(Draft());
                foreach (var empty in new BsonValue[] { BsonNull.Value, new BsonString(""), new BsonInt32(42) })
                {
                    var draft = Draft(); draft[field] = empty;
                    await drafts.InsertOneAsync(draft);
                }
            }
            var first = Draft(); first[field] = "reserved-key";
            await drafts.InsertOneAsync(first);
            var duplicate = Draft(); duplicate[field] = "reserved-key";
            var error = await Assert.ThrowsAsync<MongoWriteException>(() => drafts.InsertOneAsync(duplicate));
            Assert.Equal(ServerErrorCategory.DuplicateKey, error.WriteError.Category);
            Assert.Contains(indexName, error.Message, StringComparison.Ordinal);
            var otherOwner = Draft("owner-b"); otherOwner[field] = "reserved-key";
            if (field == "idempotencyKey") await drafts.InsertOneAsync(otherOwner);
            else await Assert.ThrowsAsync<MongoWriteException>(() => drafts.InsertOneAsync(otherOwner));
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await client.DropDatabaseAsync(settings.DatabaseName);
        }
    }
}
