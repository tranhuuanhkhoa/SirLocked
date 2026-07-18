using MongoDB.Driver;

namespace SirLocked.Api.Configurations;

public static class V3LocalMongoSafetyGuard
{
    public const string RequiredDatabasePrefix = "sirlocked_v3_";

    public static void EnsureSafe(MongoDbSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (!settings.AuditSafetyMode)
        {
            throw new InvalidOperationException("V3 local database operations require MongoDb:AuditSafetyMode=true.");
        }
        if (settings.ConnectionString.StartsWith("mongodb+srv", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("MongoDB SRV/Atlas connections are forbidden for V3 local audit operations.");
        }
        if (string.IsNullOrWhiteSpace(settings.DatabaseName)
            || !settings.DatabaseName.StartsWith(RequiredDatabasePrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"V3 local database names must start with '{RequiredDatabasePrefix}'.");
        }

        MongoClientSettings clientSettings;
        try
        {
            clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
        }
        catch (Exception exception) when (exception is ArgumentException or FormatException)
        {
            throw new InvalidOperationException("The V3 local MongoDB connection string is invalid.", exception);
        }

        var servers = clientSettings.Servers.ToList();
        if (servers.Count == 0 || servers.Any(server => !IsLoopbackHost(server.Host)))
        {
            throw new InvalidOperationException("V3 local MongoDB must use only loopback hosts.");
        }
    }

    private static bool IsLoopbackHost(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
        || host.Equals("::1", StringComparison.OrdinalIgnoreCase)
        || host.Equals("[::1]", StringComparison.OrdinalIgnoreCase);
}
