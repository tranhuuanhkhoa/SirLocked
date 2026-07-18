using System.Text.Json;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class V3LocalAuditSeeder
{
    public const string InvestigatorEmail = "audit_investigator@audit.invalid";
    public const string InterrogatorEmail = "audit_interrogator@audit.invalid";

    private static readonly string[] FixtureFiles =
    {
        "case-v3-broken-seal-en.json",
        "case-v3-broken-seal-vi.json"
    };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly MongoDbContext _db;
    private readonly MongoDbSettings _mongoSettings;
    private readonly V3LocalAuditSettings _settings;
    private readonly ICaseValidationService _validator;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<V3LocalAuditSeeder> _logger;

    public V3LocalAuditSeeder(
        MongoDbContext db,
        IOptions<MongoDbSettings> mongoSettings,
        IOptions<V3LocalAuditSettings> settings,
        ICaseValidationService validator,
        IWebHostEnvironment environment,
        ILogger<V3LocalAuditSeeder> logger)
    {
        _db = db;
        _mongoSettings = mongoSettings.Value;
        _settings = settings.Value;
        _validator = validator;
        _environment = environment;
        _logger = logger;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_settings.SeedEnabled) return;
        V3LocalMongoSafetyGuard.EnsureSafe(_mongoSettings);
        if (string.IsNullOrWhiteSpace(_settings.TestPassword) || _settings.TestPassword.Length < 12)
        {
            throw new InvalidOperationException(
                "V3LocalAudit__TestPassword must be supplied at runtime and contain at least 12 characters.");
        }

        await SeedUserAsync("audit_investigator", InvestigatorEmail, cancellationToken);
        await SeedUserAsync("audit_interrogator", InterrogatorEmail, cancellationToken);

        foreach (var fixtureFile in FixtureFiles)
        {
            var path = Path.Combine(_environment.ContentRootPath, "SeedData", "V3", fixtureFile);
            var gameCase = JsonSerializer.Deserialize<GameCase>(await File.ReadAllTextAsync(path, cancellationToken), JsonOptions)
                ?? throw new InvalidOperationException($"Could not deserialize V3 fixture '{fixtureFile}'.");
            var validation = _validator.Validate(gameCase);
            if (!validation.IsValid)
            {
                var details = string.Join("; ", validation.Errors.Select(error => $"{error.Code}:{error.Path}"));
                throw new InvalidOperationException($"V3 fixture '{fixtureFile}' failed validation: {details}");
            }

            var existing = await _db.Cases.Find(candidate => candidate.CaseId == gameCase.CaseId)
                .FirstOrDefaultAsync(cancellationToken);
            gameCase.Id = existing?.Id ?? ObjectId.GenerateNewId().ToString();
            gameCase.Status = CaseStatus.Published;
            gameCase.CreatedAt = existing?.CreatedAt ?? DateTime.UtcNow;
            gameCase.UpdatedAt = DateTime.UtcNow;
            await _db.Cases.ReplaceOneAsync(
                candidate => candidate.CaseId == gameCase.CaseId,
                gameCase,
                new ReplaceOptions { IsUpsert = true },
                cancellationToken);
        }

        _logger.LogInformation(
            "Seeded two isolated V3 users and {CaseCount} bilingual sandbox cases into {DatabaseName}.",
            FixtureFiles.Length,
            _mongoSettings.DatabaseName);
    }

    private async Task SeedUserAsync(string username, string email, CancellationToken cancellationToken)
    {
        var existing = await _db.Users.Find(candidate => candidate.Email == email)
            .FirstOrDefaultAsync(cancellationToken);
        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = existing?.Id ?? ObjectId.GenerateNewId().ToString(),
            FullName = username,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(_settings.TestPassword),
            Role = UserRole.Player,
            Status = UserStatus.Active,
            IsEmailVerified = true,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now
        };
        await _db.Users.ReplaceOneAsync(
            candidate => candidate.Email == email,
            user,
            new ReplaceOptions { IsUpsert = true },
            cancellationToken);
    }
}
