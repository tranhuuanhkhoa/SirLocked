using MongoDB.Driver;
using SirLocked.Api.DTOs.Market;
using SirLocked.Api.Models.Market;

namespace SirLocked.Api.Services.Market;

/// <summary>What the player admin needs from the market. Nothing here changes how a player's request behaves.</summary>
public sealed partial class MarketService
{
    /// <summary>Item lock held while an admin revokes the item. Released by the player admin's journal, never by the market sweep.</summary>
    internal const string AdminLockPrefix = "admin:";

    internal static string AdminGrantOpKey(string itemId) => $"grant:{itemId}";

    /// <summary>
    /// <see cref="AdminGrantAsync"/> for one item whose id the caller chose, so a journal can replay it: the slot is taken
    /// under an operation key and a second insert is a duplicate key. False when the bag is full.
    /// </summary>
    internal async Task<bool> AdminGrantItemAsync(string userId, string defId, string itemId, CancellationToken ct)
    {
        if (await _store.ApplyWalletAsync(userId, AdminGrantOpKey(itemId), 0, slotDelta: 1, ct: ct) == WalletWrite.Rejected) return false;
        try
        {
            await _store.Items.InsertOneAsync(new MarketItem
            {
                Id = itemId, OwnerId = userId, DefId = defId, Source = MarketItemSources.Grant, AcquiredAt = Now
            }, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // A replay: the item already exists.
        }
        return true;
    }

    /// <summary>Everything a detective owns, earned cosmetics included, without creating an account for someone who has none.</summary>
    internal async Task<IReadOnlyList<InventoryItemDto>> AdminInventoryAsync(string userId, MarketAccount? account, CancellationToken ct) =>
        await LoadInventoryItemsAsync(userId, account?.Equipped ?? new Dictionary<string, string>(), ct);

    internal Task<WalletDto> AdminWalletAsync(MarketAccount account, CancellationToken ct) => WalletAsync(account, ct);
}
