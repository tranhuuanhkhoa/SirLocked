using SirLocked.Api.Configurations;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class TestMongoSafetyGuardTests
{
    [Theory]
    [InlineData("mongodb://127.0.0.1:27017", "sirlocked_it_abc")]
    [InlineData("mongodb://localhost:27017", "sirlocked_it_def")]
    [InlineData("mongodb://[::1]:27017", "sirlocked_it_ghi")]
    public void AcceptsLoopbackTemporaryDatabases(string connectionString, string databaseName)
    {
        TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings
        {
            ConnectionString = connectionString,
            DatabaseName = databaseName
        });
    }

    [Theory]
    [InlineData("mongodb+srv://cluster.example.test", "sirlocked_it_abc")]
    [InlineData("mongodb://db.example.test:27017", "sirlocked_it_abc")]
    [InlineData("mongodb://127.0.0.1:27017", "SirLockedDb")]
    [InlineData("mongodb://127.0.0.1:27017,db.example.test:27017", "sirlocked_it_abc")]
    public void RejectsRemoteOrNonTemporaryTargets(string connectionString, string databaseName)
    {
        var settings = new MongoDbSettings
        {
            ConnectionString = connectionString,
            DatabaseName = databaseName
        };

        Assert.Throws<InvalidOperationException>(() => TestMongoSafetyGuard.EnsureSafe(settings));
    }
}
