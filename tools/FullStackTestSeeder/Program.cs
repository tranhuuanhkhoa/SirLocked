using System.Text.Json;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
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
if (command == "age-disconnect")
{
    // Browser tests first disconnect a real SignalR client; only then move its persisted
    // deadline into the past in a loopback-only throwaway database. No production test hook.
    var roomId = args.ElementAtOrDefault(3) ?? throw new InvalidOperationException("Expected a room ID.");
    var userId = args.ElementAtOrDefault(4) ?? throw new InvalidOperationException("Expected a user ID.");
    var testDb = new MongoDbContext(Options.Create(settings));
    var cutoff = DateTime.UtcNow.AddMinutes(-6);
    var filters = Builders<GameRoom>.Filter;
    var filter = filters.Eq(room => room.Id, roomId)
        & filters.Eq(room => room.Status, RoomStatus.InProgress)
        & filters.ElemMatch(room => room.Players, player => player.UserId == userId && !player.IsConnected);
    var update = Builders<GameRoom>.Update.Set(room => room.GameplayState!.StartedAt, cutoff)
        .Set("Players.$.DisconnectedAt", cutoff);
    var result = await testDb.Rooms.UpdateOneAsync(filter, update);
    if (result.ModifiedCount != 1) throw new InvalidOperationException("The expected test player is not disconnected.");
    Console.WriteLine("Moved the disconnected test player's deadline into the past.");
    return;
}
if (command != "seed") throw new InvalidOperationException("Expected command: seed, drop or age-disconnect.");

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

var fixturePath = args.ElementAtOrDefault(5);
var isSuppliedCase = !string.IsNullOrWhiteSpace(fixturePath);
var useAuthoredLayout = string.Equals(args.ElementAtOrDefault(7), "authored", StringComparison.OrdinalIgnoreCase);
if (useAuthoredLayout && !isSuppliedCase)
    throw new InvalidOperationException("Authored layout mode requires a supplied case.");
if (string.IsNullOrWhiteSpace(fixturePath))
    fixturePath = Path.Combine(repoRoot, "src", "BE", "SeedData", "V3", "case-v3-broken-seal-en.json");
var gameCase = JsonSerializer.Deserialize<GameCase>(
        await File.ReadAllTextAsync(fixturePath),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))
    ?? throw new InvalidOperationException("Could not deserialize the Crack integration fixture.");
var validation = isSuppliedCase
    ? new CaseValidationService().ValidateFullLogic(gameCase)
    : new CaseValidationService().Validate(gameCase);
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
if (isSuppliedCase)
{
    var outputPath = Path.GetFullPath(args.ElementAtOrDefault(6)
        ?? throw new InvalidOperationException("Supplied cases require a derived test-fixture output path."));
    var allowedOutputRoot = Path.GetFullPath(Path.Combine(repoRoot, "tmp")) + Path.DirectorySeparatorChar;
    if (!outputPath.StartsWith(allowedOutputRoot, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Derived test fixtures must be saved under the repository tmp directory.");
    // JSON-only generation intentionally precedes image/layout generation. Exercise
    // the production deterministic no-provider layout, keeping the original JSON
    // immutable and preserving every clue, dialogue, puzzle and final-logic fact.
    if (!useAuthoredLayout)
    {
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
            if (string.IsNullOrEmpty(scene.BackgroundUrl)) scene.BackgroundUrl = "/assets/scenes/owners-office.png";
        foreach (var item in gameCase.Items)
            if (string.IsNullOrEmpty(item.ImageUrl) && item.RenderMode != CaseItemRenderModes.Embedded)
                item.ImageUrl = "/assets/items/letter.png";
        var layoutMethod = typeof(AiCaseService).GetMethod("ApplyDeterministicMockSceneLayout", BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new InvalidOperationException("The production deterministic layout method is unavailable.");
        layoutMethod.Invoke(null, [gameCase]);
    }
    var playableValidation = new CaseValidationService().Validate(gameCase);
    if (!playableValidation.IsValid)
        throw new InvalidOperationException("Derived playable fixture failed validation: "
            + string.Join("; ", playableValidation.Errors.Select(error => $"{error.Code}:{error.Path}")));
    var outputOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
    await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(gameCase, outputOptions));
    await File.WriteAllTextAsync(Path.ChangeExtension(outputPath, "provenance.json"), JsonSerializer.Serialize(new
    {
        sourcePath = Path.GetFullPath(fixturePath!),
        sourceSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(fixturePath!))).ToLowerInvariant(),
        derivedCasePath = outputPath,
        transformation = useAuthoredLayout
            ? "Original authored art and layout preserved; test-only ID, timestamps and published status in loopback temporary DB."
            : "Production ApplyDeterministicMockSceneLayout plus existing local placeholder art; test-only ID, timestamps and published status in loopback temporary DB.",
        contentRewritten = false,
        providerCalls = 0,
        databaseName,
        validationPassed = true
    }, outputOptions));
}
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
