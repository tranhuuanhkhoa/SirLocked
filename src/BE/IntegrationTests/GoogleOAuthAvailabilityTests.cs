using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using Xunit;

namespace SirLocked.IntegrationTests;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class GoogleOAuthAvailabilityCollection
{
    public const string Name = "Google OAuth availability";
}

[Collection(GoogleOAuthAvailabilityCollection.Name)]
public sealed class GoogleOAuthAvailabilityTests
{
    private static bool MongoIntegrationTestsEnabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task MissingGoogleCredentials_KeepHealthAvailableAndReturnUnavailableRedirect()
    {
        if (!MongoIntegrationTestsEnabled) return;

        using var credentials = new GoogleCredentialsEnvironment(string.Empty, string.Empty);
        await using var factory = new GoogleOAuthFactory(string.Empty, string.Empty);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var live = await client.GetAsync("/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);

        var response = await client.GetAsync("/api/auth/google");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Contains("google_unavailable", response.Headers.Location?.ToString() ?? string.Empty);
    }

    [Fact]
    public async Task ConfiguredGoogleCredentials_StartGoogleChallenge()
    {
        if (!MongoIntegrationTestsEnabled) return;

        using var credentials = new GoogleCredentialsEnvironment("integration-test-google-client", "integration-test-google-secret");
        await using var factory = new GoogleOAuthFactory("integration-test-google-client", "integration-test-google-secret");
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.GetAsync("/api/auth/google");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var location = response.Headers.Location?.ToString() ?? string.Empty;
        Assert.True(location.Contains("accounts.google.com", StringComparison.Ordinal), $"Unexpected redirect: {location}");
    }

    private sealed class GoogleCredentialsEnvironment : IDisposable
    {
        private readonly string? _previousClientId = Environment.GetEnvironmentVariable("GOOGLE__CLIENTID");
        private readonly string? _previousClientSecret = Environment.GetEnvironmentVariable("GOOGLE__CLIENTSECRET");

        public GoogleCredentialsEnvironment(string clientId, string clientSecret)
        {
            Environment.SetEnvironmentVariable("GOOGLE__CLIENTID", clientId);
            Environment.SetEnvironmentVariable("GOOGLE__CLIENTSECRET", clientSecret);
        }

        public void Dispose()
        {
            Environment.SetEnvironmentVariable("GOOGLE__CLIENTID", _previousClientId);
            Environment.SetEnvironmentVariable("GOOGLE__CLIENTSECRET", _previousClientSecret);
        }
    }

    private sealed class GoogleOAuthFactory(string clientId, string clientSecret) : WebApplicationFactory<Program>
    {
        private readonly string _connectionString =
            Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
            ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";
        private readonly string _databaseName = $"sirlocked_it_{Guid.NewGuid():N}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            var settings = new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName };
            TestMongoSafetyGuard.EnsureSafe(settings);

            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.ClearProviders());
            builder.ConfigureAppConfiguration((_, configuration) =>
            {
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["MongoDb:ConnectionString"] = _connectionString,
                    ["MongoDb:DatabaseName"] = _databaseName,
                    ["Jwt:Secret"] = "integration-test-secret-with-at-least-32-characters",
                    ["Google:ClientId"] = clientId,
                    ["Google:ClientSecret"] = clientSecret,
                    ["Email:SmtpHost"] = "127.0.0.1",
                    ["Email:SmtpPort"] = "1",
                    ["Email:SenderEmail"] = "integration@example.invalid",
                    ["Email:Username"] = "integration-only",
                    ["Email:Password"] = "unused-integration-placeholder",
                    ["Email:FrontendUrl"] = "http://127.0.0.1:5173",
                    ["Bridge:Key"] = "integration-test-bridge-key-with-at-least-32-characters",
                    ["Bridge:AllowLocalAssetStorage"] = "true",
                    ["CaseCatalog:SeedPixelOnStartup"] = "false",
                    ["MOCK_AI_RESPONSES"] = "true",
                    ["SKIP_ASSET_GENERATION"] = "true",
                    ["Anthropic:ApiKey"] = string.Empty,
                    ["PayOS:ClientId"] = string.Empty,
                    ["PayOS:ApiKey"] = string.Empty,
                    ["PayOS:ChecksumKey"] = string.Empty,
                    ["Cloudinary:CloudName"] = string.Empty,
                    ["Cloudinary:ApiKey"] = string.Empty,
                    ["Cloudinary:ApiSecret"] = string.Empty,
                    ["Voice:ApiKey"] = string.Empty
                });
            });
        }

        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync();
            TestMongoSafetyGuard.EnsureSafe(new MongoDbSettings { ConnectionString = _connectionString, DatabaseName = _databaseName });
            await new MongoClient(_connectionString).DropDatabaseAsync(_databaseName);
        }
    }
}
