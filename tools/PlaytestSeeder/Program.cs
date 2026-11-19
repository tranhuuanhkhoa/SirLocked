using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;

// Dedicated loopback database only. This tool has no reset/drop/overwrite command.
var connection = Environment.GetEnvironmentVariable("SIRLOCKED_PLAYTEST_MONGO") ?? "";
var database = Environment.GetEnvironmentVariable("SIRLOCKED_PLAYTEST_DATABASE") ?? "";
var url = MongoUrl.Create(connection);
if (url.Servers.Count() != 1 || url.Server.Host != "127.0.0.1" || url.Server.Port < 1024
    || !Regex.IsMatch(database, "^SirLockedPlaytest_[a-z0-9_-]{1,48}$"))
    throw new InvalidOperationException("Refusing to seed: expected a loopback playtest database.");
var root = Path.GetFullPath(args.Single());
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var manifest = JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(Path.Combine(root, "manifest.json")), json)
    ?? throw new InvalidOperationException("Manifest missing.");
var credentials = JsonSerializer.Deserialize<Credentials>(await File.ReadAllTextAsync(Path.Combine(root, "private", "credentials.json")), json)
    ?? throw new InvalidOperationException("Credentials missing.");
if (manifest.Database != database || credentials.Accounts.Count != 7
    || credentials.Accounts.Count(a => a.Role == UserRole.Admin) != 1
    || credentials.Accounts.Select(a => a.Email).Distinct().Count() != 7
    || credentials.Accounts.Any(a => a.Password.Length < 20 || !a.Email.EndsWith("@playtest.invalid", StringComparison.Ordinal)
        || a.Role is not (UserRole.Admin or UserRole.Player)))
    throw new InvalidOperationException("Invalid playtest account manifest.");

var settings = new MongoDbSettings { ConnectionString = connection, DatabaseName = database };
var db = new MongoDbContext(Options.Create(settings), Options.Create(new PlaytestSettings { RetentionDays = 30 }));
await db.PingAsync();
await db.EnsureIndexesAsync();
var buildCollection = db.Database.GetCollection<BsonDocument>("playtestBuilds");
var prior = await buildCollection.Find(Builders<BsonDocument>.Filter.Empty).FirstOrDefaultAsync();
if (prior is not null && prior["bundleHash"].AsString != manifest.BundleHash)
    throw new InvalidOperationException("The existing playtest database belongs to a different frozen build.");
if (prior is null && (await db.Cases.CountDocumentsAsync(Builders<GameCase>.Filter.Empty) != 0
    || await db.Users.CountDocumentsAsync(Builders<User>.Filter.Empty) != 0))
    throw new InvalidOperationException("Refusing to adopt an existing database without matching build provenance.");

// Validate all content before writing anything. A locale has its own hash; the batch has a combined hash.
var cases = new List<GameCase>();
foreach (var fixture in manifest.Cases)
{
    var path = Path.GetFullPath(Path.Combine(root, fixture.Path));
    if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Case path escapes the frozen bundle.");
    var bytes = await File.ReadAllBytesAsync(path);
    if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(fixture.Sha256, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Frozen case checksum changed.");
    var gameCase = JsonSerializer.Deserialize<GameCase>(bytes, json) ?? throw new InvalidOperationException("Case missing.");
    var result = new CaseValidationService().Validate(gameCase);
    if (!result.IsValid) throw new InvalidOperationException("Case validation failed: " + string.Join(";", result.Errors.Select(e => e.Code)));
    gameCase.Id = ObjectId.GenerateNewId().ToString();
    gameCase.Status = CaseStatus.Published;
    gameCase.CreatedAt = gameCase.UpdatedAt = DateTime.UtcNow;
    cases.Add(gameCase);
}
if (prior is null)
    await buildCollection.InsertOneAsync(new BsonDocument { ["bundleHash"] = manifest.BundleHash, ["createdAt"] = DateTime.UtcNow });
foreach (var account in credentials.Accounts)
{
    var existing = await db.Users.Find(u => u.Email == account.Email).FirstOrDefaultAsync();
    if (existing is not null)
    {
        if (existing.Role != account.Role || !BCrypt.Net.BCrypt.Verify(account.Password, existing.PasswordHash))
            throw new InvalidOperationException("Existing playtest credentials changed; create a new batch instead.");
        continue;
    }
    await db.Users.InsertOneAsync(new User {
        Id = ObjectId.GenerateNewId().ToString(), FullName = account.Name, Email = account.Email,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(account.Password), Role = account.Role,
        Status = UserStatus.Active, IsEmailVerified = true
    });
}
foreach (var gameCase in cases)
{
    var existing = await db.Cases.Find(c => c.CaseId == gameCase.CaseId).FirstOrDefaultAsync();
    if (existing is not null)
    {
        if (ContentJson(existing) != ContentJson(gameCase))
            throw new InvalidOperationException("Seeded case content changed; create a new playtest batch.");
        continue;
    }
    await db.Cases.InsertOneAsync(gameCase);
}
Console.WriteLine($"Playtest database ready: seven dedicated verified accounts and {cases.Count} frozen cases; no AI calls.");

string ContentJson(GameCase gameCase)
{
    gameCase.Id = "";
    gameCase.CreatedAt = gameCase.UpdatedAt = default;
    return JsonSerializer.Serialize(gameCase, json);
}

sealed record Manifest(string Database, string BundleHash, List<Fixture> Cases);
sealed record Fixture(string Path, string Sha256);
sealed record Credentials(List<Account> Accounts);
sealed record Account(string Name, string Email, string Password, string Role);
