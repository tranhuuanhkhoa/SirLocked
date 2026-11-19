using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Market;

/// <summary>
/// Puts on or takes off a detective outfit ("skin") from the lobby. It is the same slot the inventory's "Dùng" button
/// sets, so the outfit stays on for later games; the room is told at once (as RolesUpdated, the lobby's "redraw the
/// room" event) so the partner sees the new look on the player's card. Only while the room is still a lobby: a game in
/// progress keeps the look it started with.
/// </summary>
public sealed class LobbyOutfitService
{
    public const string WrongOutfitCode = "LOBBY_OUTFIT_WRONG_DETECTIVE";

    private readonly MarketStore _store;
    private readonly MarketService _market;
    private readonly IRoomService _rooms;
    private readonly IGameNotifier _notifier;
    private readonly ICatalogProvider _catalog;

    public LobbyOutfitService(MarketStore store, MarketService market, IRoomService rooms, IGameNotifier notifier, ICatalogProvider? catalog = null)
    {
        _store = store;
        _market = market;
        _rooms = rooms;
        _notifier = notifier;
        _catalog = catalog ?? FixedCatalogProvider.Default;
    }

    /// <param name="category">SKIN_SHERLOCK or SKIN_WATSON.</param>
    /// <param name="itemId">The player's own outfit of that detective, or null for the normal look.</param>
    public async Task<RoomResponse> WearAsync(CurrentUser user, string roomId, string category, string? itemId, CancellationToken ct = default)
    {
        if (!SkinCatalog.IsSkin(category))
            throw ApiException.BadRequest("Chỉ đổi được trang phục của Sherlock hoặc Watson.");

        var room = await _rooms.GetAsync(user.Id, roomId); // 404 for no room, 403 for someone outside it
        if (!RoomLifecycle.AllowsLobbyMutation(room.Status))
            throw RoomService.NotLobbyConflict(room.Status);

        if (string.IsNullOrWhiteSpace(itemId))
        {
            await _market.UnequipAsync(user.Id, category, ct);
        }
        else
        {
            var item = await _store.Items.Find(i => i.Id == itemId && i.OwnerId == user.Id).FirstOrDefaultAsync(ct)
                ?? throw MarketService.Error(404, MarketErrors.ItemNotFound, "This item is not in your inventory.");
            if (_catalog.Current.Find(item.DefId)?.Category != category)
                throw MarketService.Error(409, WrongOutfitCode, "Món này không phải trang phục của thám tử này.");
            await _market.EquipAsync(user.Id, item.Id, ct); // refuses an outfit for sale or in a trade
        }

        var updated = await _rooms.GetAsync(user.Id, roomId);
        await _notifier.RolesUpdated(roomId, user.Id, updated);
        return updated;
    }
}
