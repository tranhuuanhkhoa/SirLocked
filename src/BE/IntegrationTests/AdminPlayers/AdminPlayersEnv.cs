using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Market;

namespace SirLocked.IntegrationTests.AdminPlayers;

/// <summary>Records every push a room would receive. Each method of the notifier returns a completed task.</summary>
public class RecordingNotifier : DispatchProxy
{
    public List<(string Method, object?[] Args)> Calls { get; } = new();

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        lock (Calls) Calls.Add((targetMethod!.Name, args ?? Array.Empty<object?>()));
        return Task.CompletedTask;
    }
}

public sealed class FakeAvatarFileRemover : IAvatarFileRemover
{
    public bool Succeeds { get; set; } = true;
    public List<string> Removed { get; } = new();

    public Task<bool> TryRemoveAsync(string userId, CancellationToken ct = default)
    {
        Removed.Add(userId);
        return Task.FromResult(Succeeds);
    }
}

/// <summary>Everything an admin test needs over a temporary database. Opt-in: SIRLOCKED_RUN_MONGO_IT=true.</summary>
public sealed class AdminPlayersEnv : IAsyncDisposable
{
    public static readonly CurrentUser Admin = new(ObjectId.GenerateNewId().ToString(), "Yến", UserRole.Admin);

    private readonly MongoClient _client;
    private readonly string _database;

    private AdminPlayersEnv(MongoDbSettings settings)
    {
        _database = settings.DatabaseName;
        _client = new MongoClient(settings.ConnectionString);
        Db = new MongoDbContext(Options.Create(settings));
        Store = new MarketStore(Db);
        Market = new MarketService(Store, NullLogger<MarketService>.Instance);
        Chests = new ChestService(Store, Market, new CryptoChestRandom(), Options.Create(new ChestSettings()), NullLogger<ChestService>.Instance);
        Progress = new ProgressService(Store, Market, NullLogger<ProgressService>.Instance);
        CatalogStore = new CatalogStore(Db);
        Audit = new AdminAuditService(CatalogStore);
        AdminStore = new AdminPlayersStore(Db);
        Remover = new FakeAvatarFileRemover();
        var proxy = DispatchProxy.Create<IGameNotifier, RecordingNotifier>();
        Notifications = (RecordingNotifier)(object)proxy;
        var catalog = FixedCatalogProvider.Default;
        Operations = new AdminPlayerOperations(AdminStore, Store, Market, Progress, Audit, Remover, NullLogger<AdminPlayerOperations>.Instance, catalog);
        Players = new AdminPlayersService(AdminStore, Store, CatalogStore, Market, Progress, catalog);
        Moderation = new AdminAvatarModeration(AdminStore, Store, Audit);
        Economy = new AdminEconomyService(AdminStore, Store, Market, Chests, Progress, Operations, Moderation, Audit, catalog);
        Rooms = new AdminRoomsService(Db, proxy, new RoomDisconnectTimeoutService(Db, proxy, TimeProvider.System), Audit);
        Reviews = new AdminReviewsService(Db, Audit);
        ReviewsForPlayers = new ReviewService(Db);
    }

    public MongoDbContext Db { get; }
    public MarketStore Store { get; }
    public MarketService Market { get; }
    public ChestService Chests { get; }
    public ProgressService Progress { get; }
    public CatalogStore CatalogStore { get; }
    public AdminAuditService Audit { get; }
    public AdminPlayersStore AdminStore { get; }
    public FakeAvatarFileRemover Remover { get; }
    public RecordingNotifier Notifications { get; }
    public AdminPlayerOperations Operations { get; }
    public AdminPlayersService Players { get; }
    public AdminAvatarModeration Moderation { get; }
    public AdminEconomyService Economy { get; }
    public AdminRoomsService Rooms { get; }
    public AdminReviewsService Reviews { get; }
    public ReviewService ReviewsForPlayers { get; }

    public static string Key() => Guid.NewGuid().ToString();

    public static async Task<AdminPlayersEnv> CreateAsync()
    {
        var settings = new MongoDbSettings
        {
            ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
            DatabaseName = $"sirlocked_it_admin_{Guid.NewGuid():N}"
        };
        if (!settings.DatabaseName.StartsWith("sirlocked_it_", StringComparison.Ordinal)
            || !new MongoUrl(settings.ConnectionString).Servers.All(server =>
                server.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]"))
            throw new InvalidOperationException("Admin integration tests need a loopback MongoDB and a temporary database.");
        var env = new AdminPlayersEnv(settings);
        await env.Db.PingAsync();
        await env.Store.EnsureIndexesAsync();
        await env.AdminStore.EnsureIndexesAsync();
        return env;
    }

    public async Task<CurrentUser> AddUserAsync(
        string name = "Thám tử", string? email = null, bool verified = true, string role = UserRole.Player,
        string status = UserStatus.Active, DateTime? createdAt = null, bool withAccount = true)
    {
        var user = new User
        {
            Id = ObjectId.GenerateNewId().ToString(),
            FullName = name,
            Email = email ?? $"{Guid.NewGuid():N}@tests.invalid",
            PasswordHash = "SECRET-password-hash",
            RefreshTokenHash = "SECRET-refresh-hash",
            RefreshTokenExpiry = DateTime.UtcNow.AddDays(7),
            ResetPasswordTokenHash = "SECRET-reset-hash",
            EmailVerificationTokenHash = "SECRET-verify-hash",
            Role = role,
            Status = status,
            IsEmailVerified = verified,
            CreatedAt = createdAt ?? DateTime.UtcNow,
        };
        await Db.Users.InsertOneAsync(user);
        if (withAccount) await Market.EnsureAccountAsync(user.Id);
        return new CurrentUser(user.Id, name, role);
    }

    public async Task<MarketAccount> AccountAsync(string userId) => await Store.Accounts.Find(a => a.Id == userId).FirstAsync();

    public Task<List<AdminAuditEntry>> AuditEntriesAsync(string action) =>
        CatalogStore.Audit.Find(entry => entry.Action == action).ToListAsync();

    /// <summary>Slots must always equal the bag's contents plus one per open buy order.</summary>
    public async Task AssertSlotsMatchItemsAsync()
    {
        foreach (var account in await Store.Accounts.Find(FilterDefinition<MarketAccount>.Empty).ToListAsync())
        {
            var items = await Store.Items.CountDocumentsAsync(i => i.OwnerId == account.Id
                && i.Source != MarketItemSources.Level && i.Source != MarketItemSources.Achievement);
            var reserved = await Store.Orders.CountDocumentsAsync(o => o.BuyerId == account.Id && o.Status == MarketOrderStatus.Active);
            Xunit.Assert.Equal(items + reserved, account.Slots);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _client.DropDatabaseAsync(_database);
        _client.Dispose();
    }
}
