using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.IntegrationTests;

public sealed class MongoAuthRefreshTests
{
    // Synthetic test input, never a configured account credential.
    private const string OriginalToken = "integration-refresh-token-only";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task ConcurrentRefreshSnapshots_AllowExactlyOneRotation(bool legacy) => WithDatabase(async db =>
    {
        var user = await InsertSessionAsync(db, legacy);
        var first = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        var second = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        var service = Service(db);

        // Both requests have already read the same valid token before either writes.
        var outcomes = await Task.WhenAll(
            TryRefreshAsync(service, first),
            TryRefreshAsync(service, second));

        var winner = Assert.Single(outcomes, result => result.Response is not null);
        Assert.Equal(401, Assert.Single(outcomes, result => result.Error is not null).Error!.StatusCode);
        var saved = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        Assert.Null(saved.RefreshToken);
        Assert.Equal(Hash(winner.Response!.RefreshToken), saved.RefreshTokenHash);

        var replay = await Assert.ThrowsAsync<ApiException>(() => service.RefreshTokenAsync(
            new RefreshTokenRequest { RefreshToken = OriginalToken }));
        Assert.Equal(401, replay.StatusCode);
        var next = await service.RefreshTokenAsync(new RefreshTokenRequest { RefreshToken = winner.Response.RefreshToken });
        Assert.NotEqual(winner.Response.RefreshToken, next.RefreshToken);
    });

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task LogoutAfterRefreshRead_PreventsThePendingRotation(bool legacy) => WithDatabase(async db =>
    {
        var user = await InsertSessionAsync(db, legacy);
        var snapshot = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        var service = Service(db);

        await service.LogoutAsync(user.Id);
        var error = await Assert.ThrowsAsync<ApiException>(() => service.CompleteRefreshAsync(snapshot, Hash(OriginalToken)));

        Assert.Equal(401, error.StatusCode);
        var saved = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        Assert.Null(saved.RefreshToken);
        Assert.Null(saved.RefreshTokenHash);
        Assert.Null(saved.RefreshTokenExpiry);
    });

    [Theory]
    [InlineData(false, "status")]
    [InlineData(true, "status")]
    [InlineData(false, "authorization-version")]
    [InlineData(true, "authorization-version")]
    [InlineData(false, "expiry")]
    [InlineData(true, "expiry")]
    public Task SessionChangedAfterRefreshRead_PreventsThePendingRotation(bool legacy, string change) => WithDatabase(async db =>
    {
        var user = await InsertSessionAsync(db, legacy);
        var snapshot = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        var updates = Builders<User>.Update;
        var update = change switch
        {
            "status" => updates.Set(candidate => candidate.Status, UserStatus.Locked),
            "authorization-version" => updates.Inc(candidate => candidate.AuthorizationVersion, 1),
            "expiry" => updates.Set(candidate => candidate.RefreshTokenExpiry, DateTime.UtcNow.AddMinutes(-1)),
            _ => throw new InvalidOperationException("Unknown test mutation.")
        };
        await db.Users.UpdateOneAsync(candidate => candidate.Id == user.Id, update);

        var error = await Assert.ThrowsAsync<ApiException>(() => Service(db).CompleteRefreshAsync(snapshot, Hash(OriginalToken)));

        Assert.Equal(401, error.StatusCode);
        var saved = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        Assert.Equal(user.RefreshToken, saved.RefreshToken);
        Assert.Equal(user.RefreshTokenHash, saved.RefreshTokenHash);
    });

    [Fact]
    public Task LegacyDocumentWithoutHashOrAuthorizationVersion_MigratesOnce() => WithDatabase(async db =>
    {
        var id = ObjectId.GenerateNewId();
        await db.Database.GetCollection<BsonDocument>(db.Settings.UsersCollectionName).InsertOneAsync(new BsonDocument
        {
            { "_id", id },
            { "fullName", "Legacy Integration User" },
            { "email", $"{id}@example.invalid" },
            { "role", UserRole.Player },
            { "status", UserStatus.Active },
            { "refreshToken", OriginalToken },
            { "refreshTokenExpiry", DateTime.UtcNow.AddHours(1) }
        });
        var service = Service(db);

        var response = await service.RefreshTokenAsync(new RefreshTokenRequest { RefreshToken = OriginalToken });

        var saved = await db.Users.Find(candidate => candidate.Id == id.ToString()).FirstAsync();
        Assert.Null(saved.RefreshToken);
        Assert.Equal(Hash(response.RefreshToken), saved.RefreshTokenHash);
        Assert.Equal(0, saved.AuthorizationVersion);
        var replay = await Assert.ThrowsAsync<ApiException>(() => service.RefreshTokenAsync(
            new RefreshTokenRequest { RefreshToken = OriginalToken }));
        Assert.Equal(401, replay.StatusCode);
    });

    private static async Task<User> InsertSessionAsync(MongoDbContext db, bool legacy)
    {
        var user = new User
        {
            Id = ObjectId.GenerateNewId().ToString(),
            FullName = "Refresh Integration User",
            Email = $"{Guid.NewGuid():N}@example.invalid",
            RefreshToken = legacy ? OriginalToken : null,
            RefreshTokenHash = legacy ? null : Hash(OriginalToken),
            RefreshTokenExpiry = DateTime.UtcNow.AddHours(1),
            AuthorizationVersion = 3
        };
        await db.Users.InsertOneAsync(user);
        return user;
    }

    private static async Task<RefreshOutcome> TryRefreshAsync(AuthService service, User snapshot)
    {
        try { return new(await service.CompleteRefreshAsync(snapshot, Hash(OriginalToken)), null); }
        catch (ApiException error) { return new(null, error); }
    }

    private static AuthService Service(MongoDbContext db) => new(
        db,
        Options.Create(new JwtSettings { Secret = new string('t', 48), Issuer = "integration", Audience = "integration" }),
        NullLogger<AuthService>.Instance,
        new UnexpectedEmailService(),
        Options.Create(new AuthSettings()));

    private static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static async Task WithDatabase(Func<MongoDbContext, Task> test)
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase))
            return;
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO_CONNECTION_STRING")
                ?? "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000",
            DatabaseName = $"sirlocked_it_{Guid.NewGuid():N}"
        };
        TestMongoSafetyGuard.EnsureSafe(settings);
        var db = new MongoDbContext(Options.Create(settings));
        try
        {
            await db.PingAsync();
            await test(db);
        }
        finally
        {
            TestMongoSafetyGuard.EnsureSafe(settings);
            await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
        }
    }

    private sealed record RefreshOutcome(AuthResponse? Response, ApiException? Error);

    private sealed class UnexpectedEmailService : IEmailService
    {
        public Task SendVerificationEmailAsync(string toEmail, string fullName, string token) =>
            throw new InvalidOperationException("Refresh tests must not send email.");
        public Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token) =>
            throw new InvalidOperationException("Refresh tests must not send email.");
    }
}
