using System.Text.Json;
using System.Net;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;

const string requiredPrefix = "sirlocked_it_";
var command = args.ElementAtOrDefault(0)?.ToLowerInvariant()
    ?? throw new InvalidOperationException("Expected command: seed or drop.");
var connectionString = args.ElementAtOrDefault(1)
    ?? throw new InvalidOperationException("Expected a MongoDB connection string.");
var databaseName = args.ElementAtOrDefault(2)
    ?? throw new InvalidOperationException("Expected a temporary database name.");

EnsureSafe(connectionString, databaseName);
var settings = new MongoDbSettings { ConnectionString = connectionString, DatabaseName = databaseName };
var client = new MongoClient(connectionString);
if (command == "drop")
{
    await client.DropDatabaseAsync(databaseName);
    Console.WriteLine($"Dropped temporary database {databaseName}.");
    return;
}
if (command != "seed") throw new InvalidOperationException("Expected command: seed or drop.");

var password = args.ElementAtOrDefault(3);
var repoRoot = args.ElementAtOrDefault(4);
if (string.IsNullOrWhiteSpace(password) || password.Length < 12)
    throw new InvalidOperationException("Test password must contain at least 12 characters.");
if (string.IsNullOrWhiteSpace(repoRoot))
    throw new InvalidOperationException("Expected the repository root path.");
repoRoot = Path.GetFullPath(repoRoot);

var db = new MongoDbContext(Options.Create(settings));
await db.PingAsync();
await db.EnsureIndexesAsync();
await SeedUserAsync(db, "it_investigator", "it_investigator@tests.invalid", password);
await SeedUserAsync(db, "it_interrogator", "it_interrogator@tests.invalid", password);

var fixturePath = Path.Combine(repoRoot, "src", "BE", "SeedData", "V3", "case-v3-broken-seal-en.json");
var gameCase = JsonSerializer.Deserialize<GameCase>(
        await File.ReadAllTextAsync(fixturePath),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))
    ?? throw new InvalidOperationException("Could not deserialize the Crack integration fixture.");
var validation = new CaseValidationService().Validate(gameCase);
if (!validation.IsValid)
{
    throw new InvalidOperationException(
        "Crack integration fixture failed validation: "
        + string.Join("; ", validation.Errors.Select(error => $"{error.Code}:{error.Path}")));
}
gameCase.Id = ObjectId.GenerateNewId().ToString();
gameCase.Status = CaseStatus.Published;
gameCase.CreatedAt = DateTime.UtcNow;
gameCase.UpdatedAt = gameCase.CreatedAt;
await db.Cases.ReplaceOneAsync(
    candidate => candidate.CaseId == gameCase.CaseId,
    gameCase,
    new ReplaceOptions { IsUpsert = true });
Console.WriteLine($"Seeded Crack full-stack data into temporary database {databaseName}.");

static async Task SeedUserAsync(MongoDbContext db, string name, string email, string password)
{
    var user = new User
    {
        Id = ObjectId.GenerateNewId().ToString(),
        FullName = name,
        Email = email,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        Role = UserRole.Player,
        Status = UserStatus.Active,
        IsEmailVerified = true,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };
    await db.Users.ReplaceOneAsync(
        candidate => candidate.Email == email,
        user,
        new ReplaceOptions { IsUpsert = true });
}

static void EnsureSafe(string connectionString, string databaseName)
{
    if (!databaseName.StartsWith(requiredPrefix, StringComparison.Ordinal))
        throw new InvalidOperationException($"Temporary database must start with '{requiredPrefix}'.");
    if (connectionString.StartsWith("mongodb+srv", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("MongoDB SRV connections are forbidden for full-stack tests.");
    var url = new MongoUrl(connectionString);
    if (!url.Servers.Any() || url.Servers.Any(server => !IsLoopback(server.Host)))
        throw new InvalidOperationException("Full-stack tests require a loopback-only MongoDB connection.");
}

static bool IsLoopback(string host)
{
    if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
    return IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address);
}
