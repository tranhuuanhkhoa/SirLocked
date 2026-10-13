using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
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

public sealed class MongoAuthTokenTests
{
    [Fact]
    public Task ConcurrentResetRequests_ConsumeTheTokenExactlyOnce() => WithDatabase(async db =>
    {
        const string token = "reset-token-used-once";
        var user = new User
        {
            Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
            FullName = "Reset Integration User",
            Email = $"{Guid.NewGuid():N}@example.invalid",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("old-password1"),
            ResetPasswordTokenHash = Hash(token),
            ResetPasswordTokenExpiry = DateTime.UtcNow.AddMinutes(30)
        };
        await db.Users.InsertOneAsync(user);
        var service = Service(db, new RecordingEmailService());

        var outcomes = await Task.WhenAll(
            TryResetAsync(service, token, "new-password1"),
            TryResetAsync(service, token, "other-password1"));

        Assert.Single(outcomes, outcome => outcome.Error is null);
        var failure = Assert.Single(outcomes, outcome => outcome.Error is not null).Error!;
        Assert.Equal(400, failure.StatusCode);

        var saved = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        Assert.Null(saved.ResetPasswordToken);
        Assert.Null(saved.ResetPasswordTokenHash);
        Assert.Null(saved.ResetPasswordTokenExpiry);
        Assert.True(
            BCrypt.Net.BCrypt.Verify("new-password1", saved.PasswordHash)
            || BCrypt.Net.BCrypt.Verify("other-password1", saved.PasswordHash));
    });

    [Fact]
    public Task ForgotPassword_PersistsOnlyTheTokenHash() => WithDatabase(async db =>
    {
        var user = new User
        {
            Id = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
            FullName = "Forgot Password User",
            Email = $"{Guid.NewGuid():N}@example.invalid",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("old-password1"),
            IsEmailVerified = true
        };
        await db.Users.InsertOneAsync(user);
        var email = new RecordingEmailService();
        var service = Service(db, email);

        await service.ForgotPasswordAsync(new ForgotPasswordRequest { Email = user.Email });

        var saved = await db.Users.Find(candidate => candidate.Id == user.Id).FirstAsync();
        Assert.NotNull(email.PasswordResetToken);
        Assert.Null(saved.ResetPasswordToken);
        Assert.Equal(Hash(email.PasswordResetToken!), saved.ResetPasswordTokenHash);
        Assert.True(saved.ResetPasswordTokenExpiry > DateTime.UtcNow);
    });

    [Fact]
    public Task RegistrationEmailFailure_RemovesThePartiallyCreatedUser() => WithDatabase(async db =>
    {
        var service = Service(db, new FailingEmailService());
        var request = new RegisterRequest
        {
            FullName = "Email Failure User",
            Email = $"{Guid.NewGuid():N}@example.invalid",
            Password = "valid-password1"
        };

        var error = await Assert.ThrowsAsync<ApiException>(() => service.RegisterAsync(request));

        Assert.Equal(502, error.StatusCode);
        Assert.Null(await db.Users.Find(user => user.Email == request.Email).FirstOrDefaultAsync());
    });

    private static AuthService Service(MongoDbContext db, IEmailService email) => new(
        db,
        Options.Create(new JwtSettings { Secret = new string('t', 48), Issuer = "integration", Audience = "integration" }),
        NullLogger<AuthService>.Instance,
        email,
        Options.Create(new AuthSettings()));

    private static async Task<ResetOutcome> TryResetAsync(AuthService service, string token, string password)
    {
        try
        {
            await service.ResetPasswordAsync(new ResetPasswordRequest { Token = token, NewPassword = password });
            return new ResetOutcome(null);
        }
        catch (ApiException error)
        {
            return new ResetOutcome(error);
        }
    }

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
        var connected = false;
        try
        {
            await db.PingAsync();
            connected = true;
            await test(db);
        }
        finally
        {
            if (connected)
            {
                TestMongoSafetyGuard.EnsureSafe(settings);
                await new MongoClient(settings.ConnectionString).DropDatabaseAsync(settings.DatabaseName);
            }
        }
    }

    private sealed record ResetOutcome(ApiException? Error);

    private sealed class RecordingEmailService : IEmailService
    {
        public string? PasswordResetToken { get; private set; }

        public Task SendVerificationEmailAsync(string toEmail, string fullName, string token) => Task.CompletedTask;

        public Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token)
        {
            PasswordResetToken = token;
            return Task.CompletedTask;
        }
    }

    private sealed class FailingEmailService : IEmailService
    {
        public Task SendVerificationEmailAsync(string toEmail, string fullName, string token) =>
            throw new InvalidOperationException("synthetic email failure");

        public Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token) => Task.CompletedTask;
    }
}
