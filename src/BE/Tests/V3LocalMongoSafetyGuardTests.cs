using SirLocked.Api.Configurations;
using Xunit;

namespace SirLocked.Tests;

public sealed class V3LocalMongoSafetyGuardTests
{
    [Theory]
    [InlineData("mongodb://127.0.0.1:27018", "sirlocked_v3_it_abc")]
    [InlineData("mongodb://localhost:27018", "sirlocked_v3_local")]
    [InlineData("mongodb://[::1]:27018", "sirlocked_v3_manual")]
    public void AcceptsOnlyExplicitLocalAuditTargets(string connectionString, string databaseName)
    {
        var settings = Settings(connectionString, databaseName, auditSafetyMode: true);

        V3LocalMongoSafetyGuard.EnsureSafe(settings);
    }

    [Theory]
    [InlineData("mongodb+srv://cluster.example.test", "sirlocked_v3_it_abc", true)]
    [InlineData("mongodb://db.example.test:27017", "sirlocked_v3_it_abc", true)]
    [InlineData("mongodb://127.0.0.1:27018", "production", true)]
    [InlineData("mongodb://127.0.0.1:27018", "sirlocked_v3_it_abc", false)]
    [InlineData("mongodb://127.0.0.1:27018,db.example.test:27017", "sirlocked_v3_it_abc", true)]
    public void RejectsAtlasRemoteWrongDatabaseAndMissingSafetyMode(
        string connectionString,
        string databaseName,
        bool auditSafetyMode)
    {
        var settings = Settings(connectionString, databaseName, auditSafetyMode);

        Assert.Throws<InvalidOperationException>(() => V3LocalMongoSafetyGuard.EnsureSafe(settings));
    }

    private static MongoDbSettings Settings(string connectionString, string databaseName, bool auditSafetyMode) => new()
    {
        AuditSafetyMode = auditSafetyMode,
        ConnectionString = connectionString,
        DatabaseName = databaseName
    };
}
