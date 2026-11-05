using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Market;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Catalog;
using SirLocked.Api.Services.Market;
using Xunit;

namespace SirLocked.IntegrationTests;

/// <summary>
/// The chests and items admin against a real (standalone) MongoDB, read back through the same services players use.
/// Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAdminChestsTests
{
    private const string Seal = "chest_np";
    private const string SealKey = "key_np";
    private const string Bank = "chest_nb";
    private const string MysteryTicket = "9999";
    private static readonly CurrentUser Yen = new("admin-1", "Yến", UserRole.Admin);

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static string NewKey() => Guid.NewGuid().ToString();

    private static AdminItemCreateRequest Curio(string name = "Bùa may mắn", string rarity = MarketRarities.Mystery, long price = 900) => new()
    {
        Name = name,
        NameEn = "Lucky charm",
        Description = "Một lá bùa cũ.",
        DescriptionEn = "An old charm.",
        Rarity = rarity,
        ReferencePrice = price,
        Tradable = true,
        IconKey = "lantern",
    };

    // ------------------------------------------------------------------ items

    [Fact]
    public async Task ANewCurioPutInAChestDropsFromIt()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(player.Id, Seal, 1, 1);

        var curio = await env.Items.CreateAsync(Yen, Curio());
        var draft = await env.DraftOfAsync(Seal);
        draft.Pool.Add(curio.Id);
        draft.Reason = "Thêm món mới";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var mystery = env.Provider.Current.FindChest(Seal)!.Pools[MarketRarities.Mystery];
        env.Random.Next(int.Parse(MysteryTicket), mystery.Select(def => def.Id).ToList().IndexOf(curio.Id));
        var opened = await env.Chests.OpenAsync(player, Seal, NewKey());

        Assert.Equal(curio.Id, opened.Item.Id);
        var owned = await env.Market.GetInventoryAsync(player.Id);
        Assert.Contains(owned.Items, item => item.ItemId == opened.ItemId && item.Def.Name == "Bùa may mắn");
        var listed = (await env.Chests.ListAsync(player.Id)).Chests.Single(chest => chest.Id == Seal);
        Assert.Contains(listed.Contents, def => def.Id == curio.Id);
    }

    [Fact]
    public async Task GeneratedCurioIdsFollowOnAndTheListSaysWhichComesNext()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();

        Assert.Equal("CU-0001", (await env.Items.ListAsync()).NextCurioId);
        var first = await env.Items.CreateAsync(Yen, Curio("Món một"));
        var second = await env.Items.CreateAsync(Yen, Curio("Món hai"));
        var listed = await env.Items.ListAsync();

        Assert.Equal("CU-0001", first.Id);
        Assert.Equal("CU-0002", second.Id);
        Assert.Equal("CU-0003", listed.NextCurioId);
        Assert.Equal(MarketCategories.Curio, listed.Items.Single(item => item.Id == first.Id).Category);
    }

    [Fact]
    public async Task AnUploadedPictureReachesPlayers()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        const string url = "https://res.cloudinary.com/demo/image/upload/sirlocked/admin/bua.webp";
        var request = Curio();
        request.IconKey = null;
        request.ImageUrl = url;

        var curio = await env.Items.CreateAsync(Yen, request);
        var draft = await env.DraftOfAsync(Seal);
        draft.Pool.Add(curio.Id);
        draft.Reason = "Thêm";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var def = (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal).Contents.Single(d => d.Id == curio.Id);
        Assert.Equal(url, def.Visual?.ImageUrl);
    }

    [Fact]
    public async Task AnInvalidItemIsRefusedAndNothingIsStored()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var before = await env.Catalog.Items.CountDocumentsAsync(FilterDefinition<CatalogItem>.Empty);
        var request = Curio();
        request.Name = "  ";
        request.IconKey = null;

        var error = await Throws(() => env.Items.CreateAsync(Yen, request));

        Assert.Equal(400, error.StatusCode);
        Assert.Contains(AdminChestsRules.TextInvalid, ViolationCodes(error));
        Assert.Contains(AdminChestsRules.ItemIconRequired, ViolationCodes(error));
        Assert.Equal(before, await env.Catalog.Items.CountDocumentsAsync(FilterDefinition<CatalogItem>.Empty));
    }

    [Fact]
    public async Task TheListCountsCopiesInCirculationAndNamesTheChests()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        await env.Market.AdminGrantAsync(player.Id, "VC-0217", 0);
        await env.Market.AdminGrantAsync(player.Id, "VC-0217", 0);

        var row = (await env.Items.ListAsync()).Items.Single(item => item.Id == "VC-0217");

        Assert.Equal(2, row.Circulating);
        Assert.Equal(new[] { Seal }, row.Chests.Select(chest => chest.Id));
    }

    [Fact]
    public async Task ARetiredItemStopsDropping_ButWhoeverHasOneCanStillSellIt()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var owner = await env.AddUserAsync("Người có");
        await env.Market.AdminGrantAsync(owner.Id, "VC-0388", 0);
        var ownedCopy = (await env.Market.GetInventoryAsync(owner.Id)).Items.Single(item => item.Def.Id == "VC-0388");

        await env.Items.SetRetiredAsync(Yen, "VC-0388", true, "Hết mùa");

        var chest = env.Provider.Current.FindChest(Seal)!;
        Assert.DoesNotContain(chest.Items, def => def.Id == "VC-0388");
        Assert.DoesNotContain((await env.Chests.ListAsync(owner.Id)).Chests.Single(c => c.Id == Seal).Contents, def => def.Id == "VC-0388");
        var listing = await env.Market.CreateListingAsync(owner, ownedCopy.ItemId, 100);
        Assert.Equal("VC-0388", listing.Listing.Def.Id);
    }

    [Fact]
    public async Task RetiringNeedsAReason()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();

        var error = await Throws(() => env.Items.SetRetiredAsync(Yen, "VC-0388", true, "  "));

        Assert.Equal(AdminChestsErrors.ReasonRequired, Code(error));
        Assert.False(await env.StoredRetiredAsync("VC-0388"));
    }

    [Fact]
    public async Task RetiringTheLastItemOfARarityAChestStillRollsIsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var lastMystery = await env.KeepOneMysteryAsync(Seal);

        var error = await Throws(() => env.Items.SetRetiredAsync(Yen, lastMystery, true, "Thử"));

        Assert.Contains(CatalogRuleCodes.RarityEmpty, ViolationCodes(error));
        Assert.False(await env.StoredRetiredAsync(lastMystery));
    }

    [Fact]
    public async Task AnItemCanBeBroughtBackFromRetirement()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        await env.Items.SetRetiredAsync(Yen, "VC-0388", true, "Hết mùa");

        await env.Items.SetRetiredAsync(Yen, "VC-0388", false, null);

        Assert.Contains(env.Provider.Current.FindChest(Seal)!.Items, def => def.Id == "VC-0388");
    }

    [Fact]
    public async Task AnItemInCirculationCannotBeDeleted()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var curio = await env.Items.CreateAsync(Yen, Curio());
        await env.Market.AdminGrantAsync(player.Id, curio.Id, 0);

        var error = await Throws(() => env.Items.DeleteAsync(Yen, curio.Id, "Dọn"));

        Assert.Contains(CatalogRuleCodes.DefinitionOwned, ViolationCodes(error));
        Assert.NotNull(env.Provider.Current.Find(curio.Id));
    }

    [Fact]
    public async Task AnItemThatOnceDroppedCannotBeDeletedEvenWhenNoCopyIsLeft()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var curio = await env.Items.CreateAsync(Yen, Curio());
        await env.Store.ChestOpenings.InsertOneAsync(new ChestOpening
        {
            Id = "u:old", UserId = "u", ChestDefId = Seal, KeyDefId = SealKey, RewardDefId = curio.Id,
            State = ChestOpeningStates.Done, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });

        var error = await Throws(() => env.Items.DeleteAsync(Yen, curio.Id, "Dọn"));

        Assert.Contains(CatalogRuleCodes.DefinitionInUse, ViolationCodes(error));
    }

    [Fact]
    public async Task AnItemStillInAChestCannotBeDeleted()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();

        var error = await Throws(() => env.Items.DeleteAsync(Yen, "VC-0388", "Dọn"));

        Assert.Contains(CatalogRuleCodes.DefinitionInUse, ViolationCodes(error));
    }

    [Fact]
    public async Task AnItemNobodyHasCanBeDeleted()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var curio = await env.Items.CreateAsync(Yen, Curio());

        await env.Items.DeleteAsync(Yen, curio.Id, "Tạo nhầm");

        Assert.Null(env.Provider.Current.Find(curio.Id));
        Assert.Equal(0, await env.Catalog.Items.CountDocumentsAsync(i => i.Id == curio.Id));
    }

    [Fact]
    public async Task ChangingTheRarityOfAnOwnedItemNeedsAReason_AndThenApplies()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var curio = await env.Items.CreateAsync(Yen, Curio(rarity: MarketRarities.Rare, price: 500));
        await env.Market.AdminGrantAsync(player.Id, curio.Id, 0);
        var request = UpdateOf(curio);
        request.Rarity = MarketRarities.Epic;

        var error = await Throws(() => env.Items.UpdateAsync(Yen, curio.Id, request));
        Assert.Equal(AdminChestsErrors.ReasonRequired, Code(error));
        Assert.Equal(MarketRarities.Rare, env.Provider.Current.Find(curio.Id)!.Rarity);

        request.Reason = "Món này hiếm hơn dự kiến";
        var saved = await env.Items.UpdateAsync(Yen, curio.Id, request);

        Assert.Equal(MarketRarities.Epic, saved.Rarity);
        Assert.Equal(2, saved.Version);
    }

    [Fact]
    public async Task ARarityChangeThatEmptiesAChestsTableIsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var lastMystery = await env.KeepOneMysteryAsync(Seal);
        var row = (await env.Items.ListAsync()).Items.Single(item => item.Id == lastMystery);
        var request = UpdateOf(row);
        request.Rarity = MarketRarities.Common;

        var error = await Throws(() => env.Items.UpdateAsync(Yen, lastMystery, request));

        Assert.Contains(CatalogRuleCodes.RarityEmpty, ViolationCodes(error));
        Assert.Equal(MarketRarities.Mystery, env.Provider.Current.Find(lastMystery)!.Rarity);
    }

    [Fact]
    public async Task APriceThatMakesAChestPayOutTooMuchIsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var row = (await env.Items.ListAsync()).Items.Single(item => item.Id == "VC-0388");
        var request = UpdateOf(row);
        request.ReferencePrice = 1_000_000;

        var error = await Throws(() => env.Items.UpdateAsync(Yen, "VC-0388", request));

        Assert.Contains(CatalogRuleCodes.ExpectedValueTooHigh, ViolationCodes(error));
        Assert.Equal(row.ReferencePrice, env.Provider.Current.Find("VC-0388")!.ReferencePrice);
    }

    [Theory]
    [InlineData("frame_dong")]
    [InlineData("title_tan-binh")]
    [InlineData(Seal)]
    [InlineData(SealKey)]
    public async Task CosmeticsChestsAndKeysAreNotManagedOnTheItemsPage(string defId)
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var row = (await env.Items.ListAsync()).Items.Single(item => item.Id == defId);

        Assert.False(row.Editable);
        var request = UpdateOf(row);
        request.Name = "Tên khác";
        Assert.Equal(AdminChestsErrors.ManagedElsewhere, Code(await Throws(() => env.Items.UpdateAsync(Yen, defId, request))));
        Assert.Equal(AdminChestsErrors.ManagedElsewhere, Code(await Throws(() => env.Items.SetRetiredAsync(Yen, defId, true, "Thử"))));
        Assert.Equal(AdminChestsErrors.ManagedElsewhere, Code(await Throws(() => env.Items.DeleteAsync(Yen, defId, "Thử"))));
    }

    [Fact]
    public async Task SavingOverSomeoneElsesEditIsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var curio = await env.Items.CreateAsync(Yen, Curio());
        var first = UpdateOf(curio);
        first.Name = "Của người thứ nhất";
        await env.Items.UpdateAsync(Yen, curio.Id, first);
        var stale = UpdateOf(curio);
        stale.Name = "Của người thứ hai";

        var error = await Throws(() => env.Items.UpdateAsync(Yen, curio.Id, stale));

        Assert.Equal(409, error.StatusCode);
        Assert.Equal(AdminChestsErrors.VersionConflict, Code(error));
        Assert.Equal("Của người thứ nhất", env.Provider.Current.Find(curio.Id)!.Name);
    }

    // ------------------------------------------------------------------ chests

    [Fact]
    public async Task WrongPercentagesAreRefusedAndNothingChanges()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var draft = await env.DraftOfAsync(Seal);
        draft.DropWeights[MarketRarities.Common] -= 1;
        draft.Reason = "Thử";

        var error = await Throws(() => env.Admin.UpdateAsync(Yen, Seal, draft));

        Assert.Equal(400, error.StatusCode);
        Assert.Contains(CatalogRuleCodes.WeightsTotal, ViolationCodes(error));
        var stored = await env.Admin.GetAsync(Seal);
        Assert.Equal(1, stored.Version);
        Assert.Equal(7992, stored.DropWeights[MarketRarities.Common]);
        Assert.Equal(0, await env.Catalog.Audit.CountDocumentsAsync(a => a.Action == "chest.update"));
    }

    [Fact]
    public async Task ACheckReportsWhatASaveWouldDoWithoutDoingIt()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var draft = await env.DraftOfAsync(Seal);
        draft.ChestPrice += 10;
        draft.Pool.Remove("VC-0388");
        draft.DropWeights[MarketRarities.Common] -= 1;

        var check = await env.Admin.CheckAsync(Seal, draft);

        Assert.Contains(check.Violations, violation => violation.Code == CatalogRuleCodes.WeightsTotal);
        Assert.Equal(new[] { "VC-0388" }, check.Diff.Removed);
        Assert.Contains(check.Diff.Fields, field => field.Field == "prices.chest");
        Assert.Equal(1, (await env.Admin.GetAsync(Seal)).Version);
        Assert.Contains("VC-0388", (await env.Catalog.Chests.Find(c => c.Id == Seal).SingleAsync()).Pool);
    }

    [Fact]
    public async Task AChestNeedsAReasonToChange()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var draft = await env.DraftOfAsync(Seal);
        draft.ChestPrice += 10;

        Assert.Equal(AdminChestsErrors.ReasonRequired, Code(await Throws(() => env.Admin.UpdateAsync(Yen, Seal, draft))));
    }

    [Fact]
    public async Task SavingAChestWithNoChangesIsRefused()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var draft = await env.DraftOfAsync(Seal);
        draft.Reason = "Thử";

        Assert.Equal(AdminChestsErrors.NoChange, Code(await Throws(() => env.Admin.UpdateAsync(Yen, Seal, draft))));
    }

    [Fact]
    public async Task EachChestPublishesItsOwnOdds()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var draft = await env.DraftOfAsync(Seal);
        draft.DropWeights[MarketRarities.Common] -= 100;
        draft.DropWeights[MarketRarities.Rare] += 100;
        draft.Reason = "Tăng Hiếm";

        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var list = await env.Chests.ListAsync(player.Id);
        Assert.Equal(78.92m, list.Chests.Single(c => c.Id == Seal).Odds.Single(o => o.Rarity == MarketRarities.Common).Percent);
        Assert.Equal(79.92m, list.Chests.Single(c => c.Id == Bank).Odds.Single(o => o.Rarity == MarketRarities.Common).Percent);
    }

    [Fact]
    public async Task ANewDrawingAndLightReachPlayersAndTheItemIcon()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var draft = await env.DraftOfAsync(Seal);
        draft.Look = new AdminChestLookRequest { Template = "lacquer", Light = "1,2,3", Hi = "4,5,6", Core = "7,8,9" };
        draft.Reason = "Đổi hình";

        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var dto = (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal);
        Assert.Equal("lacquer", dto.Look?.Template);
        Assert.Equal("1,2,3", dto.Look?.Light);
        Assert.Equal("chest_lacquer", dto.IconKey);
        Assert.Equal("key_jade", dto.KeyIconKey);
        Assert.Equal("chest_lacquer", env.Provider.Current.Find(Seal)!.IconKey);
        Assert.Equal("key_jade", env.Provider.Current.Find(SealKey)!.IconKey);
    }

    [Fact]
    public async Task RenamingAChestAndRepricingItAlsoUpdatesItsItemTypes()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var draft = await env.DraftOfAsync(Seal);
        draft.Name = "Hòm Mới";
        draft.KeyName = "chìa mới";
        draft.ChestPrice = 200;
        draft.KeyPrice = 300;
        draft.Reason = "Đổi tên";

        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var chest = env.Provider.Current.Find(Seal)!;
        var key = env.Provider.Current.Find(SealKey)!;
        Assert.Equal("Hòm Mới", chest.Name);
        Assert.Equal(200, chest.ReferencePrice);
        Assert.Equal("Chìa mới", key.Name); // An item's own name starts with a capital, as the seed's do.
        Assert.Equal(300, key.ReferencePrice);
    }

    [Fact]
    public async Task AChestSwitchedOffCannotBeBought_ButACopyAlreadyHeldStillOpens()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var holder = await env.AddUserAsync("Người giữ hòm");
        var other = await env.AddUserAsync("Người khác");
        await env.GrantAsync(holder.Id, Seal, 1, 1);

        var draft = await env.DraftOfAsync(Seal);
        draft.Active = false;
        draft.Reason = "Tạm ngừng bán";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        Assert.Equal(ChestErrors.NotForSale, Code(await Throws(() => env.Chests.BuyKeyAsync(holder, Seal, NewKey()))));
        Assert.Equal(ChestErrors.NotForSale, Code(await Throws(() => env.Chests.BuyChestAsync(holder, Seal, NewKey()))));

        Assert.DoesNotContain((await env.Chests.ListAsync(other.Id)).OffSale, chest => chest.Id == Seal);
        var held = await env.Chests.ListAsync(holder.Id);
        Assert.DoesNotContain(held.Chests, chest => chest.Id == Seal);
        var mine = held.OffSale.Single(chest => chest.Id == Seal);
        Assert.False(mine.Active);
        Assert.Equal(1, mine.ChestCount);
        Assert.Equal(1, mine.KeyCount);

        var opened = await env.Chests.OpenAsync(holder, Seal, NewKey());
        Assert.Equal(Seal, opened.ChestId);
        Assert.DoesNotContain((await env.Chests.ListAsync(holder.Id)).OffSale, chest => chest.Id == Seal);
    }

    [Fact]
    public async Task APurchaseRetriedAfterAChestIsSwitchedOffReturnsItsOriginalResult()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var key = NewKey();
        var bought = await env.Chests.BuyKeyAsync(player, Seal, key);

        var draft = await env.DraftOfAsync(Seal);
        draft.Active = false;
        draft.Reason = "Tạm ngừng bán";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        Assert.Equal(bought.ItemId, (await env.Chests.BuyKeyAsync(player, Seal, key)).ItemId);
    }

    [Fact]
    public async Task AChestSwitchedOffLeavesTheMarketCatalogWithItsKey_UntilSwitchedBackOn()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var draft = await env.DraftOfAsync(Seal);
        draft.Active = false;
        draft.Reason = "Tạm ngừng bán";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var catalog = env.Market.GetCatalog().Select(def => def.Id).ToList();
        Assert.DoesNotContain(Seal, catalog);
        Assert.DoesNotContain(SealKey, catalog);

        var back = await env.DraftOfAsync(Seal);
        back.Active = true;
        back.Reason = "Bán lại";
        await env.Admin.UpdateAsync(Yen, Seal, back);

        var restored = env.Market.GetCatalog().Select(def => def.Id).ToList();
        Assert.Contains(Seal, restored);
        Assert.Contains(SealKey, restored);
    }

    [Fact]
    public async Task APriceTheBuyerDidNotSeeIsNotCharged()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var coins = (await env.Market.GetWalletAsync(player.Id)).Balance;
        var seen = (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal).KeyPrice;

        var draft = await env.DraftOfAsync(Seal);
        draft.KeyPrice = seen + 50;
        draft.Reason = "Tăng giá";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var error = await Throws(() => env.Chests.BuyKeyAsync(player, Seal, NewKey(), expectedPrice: seen));
        Assert.Equal(ChestErrors.PriceChanged, Code(error));
        Assert.Equal(coins, (await env.Market.GetWalletAsync(player.Id)).Balance);

        await env.Chests.BuyKeyAsync(player, Seal, NewKey(), expectedPrice: seen + 50);
        Assert.Equal(coins - seen - 50, (await env.Market.GetWalletAsync(player.Id)).Balance);
    }

    [Fact]
    public async Task ACloneIsANewChestWithItsOwnItemTypes_SwitchedOffUntilAnAdminIsReady()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var source = await env.Admin.GetAsync(Bank);

        var clone = await env.Admin.CloneAsync(Yen, Bank, new AdminChestCloneRequest { Name = "Két Mùa Đông", NameEn = "Winter Safe", Reason = "Sự kiện" });

        Assert.Equal("chest_001", clone.Id);
        Assert.Equal("key_001", clone.KeyDefId);
        Assert.False(clone.Active);
        Assert.Equal("Két Mùa Đông", clone.Name);
        Assert.Equal(source.ChestPrice, clone.ChestPrice);
        Assert.Equal(source.Pool.Select(item => item.Def.Id), clone.Pool.Select(item => item.Def.Id));
        Assert.Equal(source.DropWeights, clone.DropWeights);
        Assert.Equal(1, clone.Version);

        var chestDef = env.Provider.Current.Find(clone.Id)!;
        var keyDef = env.Provider.Current.Find(clone.KeyDefId)!;
        Assert.Equal(MarketCategories.Chest, chestDef.Category);
        Assert.Equal(MarketCategories.Key, keyDef.Category);
        Assert.Equal("chest_bank", chestDef.IconKey);

        // Off: nobody sees it and nobody can buy it.
        Assert.DoesNotContain((await env.Chests.ListAsync(player.Id)).Chests, chest => chest.Id == clone.Id);
        Assert.Equal(ChestErrors.NotForSale, Code(await Throws(() => env.Chests.BuyKeyAsync(player, clone.Id, NewKey()))));

        var draft = await env.DraftOfAsync(clone.Id);
        draft.Active = true;
        draft.Reason = "Mở bán";
        await env.Admin.UpdateAsync(Yen, clone.Id, draft);

        Assert.Contains((await env.Chests.ListAsync(player.Id)).Chests, chest => chest.Id == clone.Id);
        await env.Chests.BuyKeyAsync(player, clone.Id, NewKey());
        await env.Chests.BuyChestAsync(player, clone.Id, NewKey());
        var opened = await env.Chests.OpenAsync(player, clone.Id, NewKey());
        Assert.Equal(clone.Id, opened.ChestId);
        Assert.Contains(source.Pool, item => item.Def.Id == opened.Item.Id);
    }

    [Fact]
    public async Task ClonesNeverShareAnId()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();

        var first = await env.Admin.CloneAsync(Yen, Seal, new AdminChestCloneRequest { Name = "Một", NameEn = "One", Reason = "Thử" });
        var second = await env.Admin.CloneAsync(Yen, first.Id, new AdminChestCloneRequest { Name = "Hai", NameEn = "Two", Reason = "Thử" });

        Assert.NotEqual(first.Id, second.Id);
        Assert.NotEqual(first.KeyDefId, second.KeyDefId);
    }

    [Fact]
    public async Task EverySaveIsAVersionAndAnOlderOneCanBeRestored_KeepingTheOnOffSwitch()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var original = await env.Admin.GetAsync(Seal);

        var raise = await env.DraftOfAsync(Seal);
        raise.ChestPrice += 100;
        raise.Pool.Remove("VC-0388");
        raise.Reason = "Tăng giá";
        await env.Admin.UpdateAsync(Yen, Seal, raise);

        var off = await env.DraftOfAsync(Seal);
        off.Active = false;
        off.Reason = "Tạm tắt";
        await env.Admin.UpdateAsync(Yen, Seal, off);

        var versions = await env.Admin.VersionsAsync(Seal);
        Assert.Equal(new[] { 3, 2, 1 }, versions.Select(version => version.Version));
        Assert.Equal("Tăng giá", versions.Single(version => version.Version == 2).Reason);
        Assert.Contains("VC-0388", versions.Single(version => version.Version == 2).Diff.Removed);

        var restored = await env.Admin.RestoreAsync(Yen, Seal, 1, new AdminChestRestoreRequest { ExpectedVersion = 3, Reason = "Giá cũ tốt hơn" });

        Assert.Equal(4, restored.Version);
        Assert.Equal(original.ChestPrice, restored.ChestPrice);
        Assert.Contains(restored.Pool, item => item.Def.Id == "VC-0388");
        Assert.False(restored.Active);
        Assert.Equal(4, (await env.Admin.VersionsAsync(Seal)).Count);
    }

    [Fact]
    public async Task AVersionThatNoLongerPassesIsNotRestored()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var curio = await env.Items.CreateAsync(Yen, Curio());
        var add = await env.DraftOfAsync(Seal);
        add.Pool.Add(curio.Id);
        add.Reason = "Thêm";
        await env.Admin.UpdateAsync(Yen, Seal, add);
        var remove = await env.DraftOfAsync(Seal);
        remove.Pool.Remove(curio.Id);
        remove.Reason = "Bỏ";
        await env.Admin.UpdateAsync(Yen, Seal, remove);
        await env.Items.DeleteAsync(Yen, curio.Id, "Tạo nhầm");

        var error = await Throws(() => env.Admin.RestoreAsync(Yen, Seal, 2, new AdminChestRestoreRequest { ExpectedVersion = 3, Reason = "Thử" }));

        Assert.Contains(CatalogRuleCodes.PoolUnknownItem, ViolationCodes(error));
        Assert.Equal(3, (await env.Admin.GetAsync(Seal)).Version);
    }

    [Fact]
    public async Task AnOpeningInProgressKeepsItsRewardWhenThePoolChanges()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        await env.GrantAsync(player.Id, Seal, 1, 1);
        var at = DateTime.UtcNow.AddMinutes(-5);
        var opening = new ChestOpening
        {
            Id = $"{player.Id}:{Guid.NewGuid():N}", UserId = player.Id, ChestDefId = Seal, KeyDefId = SealKey,
            RewardDefId = "VC-0388", RewardItemId = MarketStore.NewId(), CreatedAt = at, UpdatedAt = at,
        };
        await env.Store.ChestOpenings.InsertOneAsync(opening);

        var draft = await env.DraftOfAsync(Seal);
        draft.Pool.Remove("VC-0388");
        draft.Reason = "Bỏ khỏi hòm";
        await env.Admin.UpdateAsync(Yen, Seal, draft);
        await env.Items.SetRetiredAsync(Yen, "VC-0388", true, "Hết mùa");

        await env.Chests.RecoverAsync(TimeSpan.FromSeconds(30));

        var reward = await env.Store.Items.Find(i => i.Id == opening.RewardItemId).SingleAsync();
        Assert.Equal("VC-0388", reward.DefId);
        Assert.Equal(player.Id, reward.OwnerId);
    }

    [Fact]
    public async Task TryingAChestOutCreatesNothingAndSpendsNothing_AndWorksWhileItIsOff()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var clone = await env.Admin.CloneAsync(Yen, Seal, new AdminChestCloneRequest { Name = "Thử", NameEn = "Try", Reason = "Thử" });
        var items = await env.Store.Items.CountDocumentsAsync(FilterDefinition<MarketItem>.Empty);

        var preview = await env.Admin.PreviewAsync(clone.Id);
        env.Random.Next(int.Parse(MysteryTicket), 0);
        var result = await env.Admin.PreviewOpenAsync(clone.Id);

        var chest = Assert.Single(preview.Chests);
        Assert.Equal(clone.Id, chest.Id);
        Assert.True(chest.ChestCount > 0);
        Assert.True(chest.KeyCount > 0);
        Assert.Equal(MarketRarities.Mystery, result.Item.Rarity);
        Assert.Contains(chest.Contents, def => def.Id == result.Item.Id);
        Assert.Equal(items, await env.Store.Items.CountDocumentsAsync(FilterDefinition<MarketItem>.Empty));
        Assert.Equal(0, await env.Store.ChestOpenings.CountDocumentsAsync(FilterDefinition<ChestOpening>.Empty));
    }

    // ------------------------------------------------------------------ statistics and tools

    [Fact]
    public async Task StatsCountOpeningsCoinsAndRealRatesInTheWindow()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Ai Đó");
        var now = DateTime.UtcNow;
        await env.AddOpeningAsync(player.Id, Seal, "VC-0388", now.AddDays(-1));
        await env.AddOpeningAsync(player.Id, Seal, "VC-0388", now.AddDays(-2));
        await env.AddOpeningAsync(player.Id, Seal, "VC-0217", now.AddDays(-3));
        await env.AddOpeningAsync(player.Id, Seal, "VC-0391", now.AddDays(-20)); // Outside 7 days, inside 30.
        await env.AddOpeningAsync(player.Id, Bank, "VC-0388", now.AddDays(-1)); // Another chest.
        await env.AddOpeningAsync(player.Id, Seal, "VC-0217", now.AddDays(-1), ChestOpeningStates.Failed); // Never happened.
        await env.AddPurchaseAsync(player.Id, Seal, Seal, 120, now.AddDays(-1));
        await env.AddPurchaseAsync(player.Id, Seal, SealKey, 180, now.AddDays(-1));
        await env.AddPurchaseAsync(player.Id, Seal, SealKey, 180, now.AddDays(-2));
        await env.AddPurchaseAsync(player.Id, Seal, SealKey, 180, now.AddDays(-20));
        await env.AddPurchaseAsync(player.Id, Seal, SealKey, 180, now.AddDays(-1), ChestOpeningStates.Failed);

        var week = await env.Stats.StatsAsync(Seal, 7);

        Assert.Equal(3, week.Opens);
        Assert.Equal(120, week.CoinsFromChests);
        Assert.Equal(360, week.CoinsFromKeys);
        var common = week.Rates.Single(rate => rate.Rarity == MarketRarities.Common);
        Assert.Equal(2, common.Count);
        Assert.Equal(66.67m, Math.Round(common.ActualPercent, 2));
        Assert.Equal(79.92m, common.ConfiguredPercent);
        Assert.Equal("VC-0388", week.TopItems[0].Def.Id);
        Assert.Equal(2, week.TopItems[0].Count);
        var rare = Assert.Single(week.RareDrops);
        Assert.Equal("VC-0217", rare.Def.Id);
        Assert.Equal("Ai Đó", rare.PlayerName);

        var month = await env.Stats.StatsAsync(Seal, 30);
        Assert.Equal(4, month.Opens);
        Assert.Equal(540, month.CoinsFromKeys);
    }

    [Fact]
    public async Task TheLogFiltersByPlayerChestDateAndRarity_AndPages()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var an = await env.AddUserAsync("Thám tử An");
        var binh = await env.AddUserAsync("Thám tử Bình");
        var now = DateTime.UtcNow;
        await env.AddOpeningAsync(an.Id, Seal, "VC-0388", now.AddHours(-1));
        await env.AddOpeningAsync(an.Id, Bank, "VC-0217", now.AddHours(-2));
        await env.AddOpeningAsync(binh.Id, Seal, "VC-0217", now.AddDays(-10));

        var all = await env.Stats.OpeningsAsync(new AdminOpeningQuery());
        Assert.Equal(3, all.Total);
        Assert.Equal(new[] { "VC-0388", "VC-0217", "VC-0217" }, all.Items.Select(row => row.Item.Id));
        Assert.Equal("Thám tử An", all.Items[0].PlayerName);
        Assert.Equal("Hòm Niêm Phong", all.Items[0].ChestName);

        Assert.Equal(2, (await env.Stats.OpeningsAsync(new AdminOpeningQuery(Player: "tử an"))).Total);
        Assert.Equal(1, (await env.Stats.OpeningsAsync(new AdminOpeningQuery(ChestId: Bank))).Total);
        Assert.Equal(2, (await env.Stats.OpeningsAsync(new AdminOpeningQuery(Rarity: MarketRarities.Mystery))).Total);
        Assert.Equal(2, (await env.Stats.OpeningsAsync(new AdminOpeningQuery(From: now.AddDays(-1)))).Total);
        Assert.Equal(1, (await env.Stats.OpeningsAsync(new AdminOpeningQuery(To: now.AddDays(-1)))).Total);
        Assert.Equal(0, (await env.Stats.OpeningsAsync(new AdminOpeningQuery(Player: ".*không ai"))).Total);

        var second = await env.Stats.OpeningsAsync(new AdminOpeningQuery(Page: 2, PageSize: 2));
        Assert.Equal(3, second.Total);
        Assert.Equal(2, second.Page);
        Assert.Single(second.Items);
    }

    [Fact]
    public async Task APlayerIsFoundByNameOrEmailAndARegexIsJustText()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var an = await env.AddUserAsync("Thám tử An");
        var email = (await env.Db.Users.Find(u => u.Id == an.Id).SingleAsync()).Email;

        Assert.Equal(an.Id, Assert.Single(await env.Stats.FindPlayersAsync("TỬ AN")).Id);
        Assert.Equal(an.Id, Assert.Single(await env.Stats.FindPlayersAsync(email)).Id);
        Assert.Empty(await env.Stats.FindPlayersAsync(".*"));
        Assert.Empty(await env.Stats.FindPlayersAsync("  "));
    }

    [Fact]
    public async Task GrantingGivesTheItemsAndRecordsWhoAndWhy()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");

        var before = await env.Market.GetWalletAsync(player.Id);

        var wallet = await env.Stats.GrantAsync(Yen, new AdminChestGrantRequest { UserId = player.Id, ChestId = Seal, Chests = 2, Keys = 1, Reason = "Đền bù lỗi" });

        Assert.Equal(before.ItemCount + 3, wallet.ItemCount);
        var dto = (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal);
        Assert.Equal(2, dto.ChestCount);
        Assert.Equal(1, dto.KeyCount);
        var entry = await env.Catalog.Audit.Find(a => a.Action == "chest.grant").SingleAsync();
        Assert.Equal(player.Id, entry.TargetId);
        Assert.Equal("Đền bù lỗi", entry.Reason);
        Assert.Equal(Yen.Id, entry.AdminId);
    }

    [Fact]
    public async Task GrantingNeedsAReason()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");

        var error = await Throws(() => env.Stats.GrantAsync(Yen, new AdminChestGrantRequest { UserId = player.Id, ChestId = Seal, Chests = 1, Keys = 0, Reason = "" }));

        Assert.Equal(AdminChestsErrors.ReasonRequired, Code(error));
        Assert.Equal(0, (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal).ChestCount);
    }

    [Fact]
    public async Task EveryWriteLeavesAnAuditEntryWithBeforeAndAfter()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");

        var curio = await env.Items.CreateAsync(Yen, Curio());
        var update = UpdateOf(curio);
        update.Name = "Tên mới";
        var edited = await env.Items.UpdateAsync(Yen, curio.Id, update);
        await env.Items.SetRetiredAsync(Yen, curio.Id, true, "Hết mùa");
        await env.Items.SetRetiredAsync(Yen, curio.Id, false, null);
        await env.Items.DeleteAsync(Yen, curio.Id, "Tạo nhầm");
        var clone = await env.Admin.CloneAsync(Yen, Seal, new AdminChestCloneRequest { Name = "Bản sao", NameEn = "Copy", Reason = "Thử" });
        var draft = await env.DraftOfAsync(clone.Id);
        draft.ChestPrice += 1;
        draft.Reason = "Sửa giá";
        await env.Admin.UpdateAsync(Yen, clone.Id, draft);
        await env.Admin.RestoreAsync(Yen, clone.Id, 1, new AdminChestRestoreRequest { ExpectedVersion = 2, Reason = "Trả lại" });
        await env.Stats.GrantAsync(Yen, new AdminChestGrantRequest { UserId = player.Id, ChestId = Seal, Chests = 1, Keys = 0, Reason = "Tặng" });

        var entries = await env.Catalog.Audit.Find(FilterDefinition<AdminAuditEntry>.Empty).ToListAsync();
        Assert.Equal(
            new[] { "chest.clone", "chest.grant", "chest.restore", "chest.update", "item.create", "item.delete", "item.retire", "item.unretire", "item.update" },
            entries.Select(entry => entry.Action).Distinct().OrderBy(action => action, StringComparer.Ordinal));
        var renamed = entries.Single(entry => entry.Action == "item.update");
        Assert.Contains("Bùa may mắn", renamed.Before);
        Assert.Contains("Tên mới", renamed.After);
        Assert.Equal(curio.Id, renamed.TargetId);
        Assert.Equal("catalogItem", renamed.TargetType);
        Assert.Equal(Yen.FullName, renamed.AdminName);
        Assert.Equal("Sửa giá", entries.Single(entry => entry.Action == "chest.update").Reason);
        Assert.Null(entries.Single(entry => entry.Action == "item.delete").After);
        Assert.Equal(2, edited.Version);
    }

    [Fact]
    public async Task IndexesForTheHistoryAndTheStatisticsExist()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();

        var names = async (string collection) =>
            (await (await env.Db.Database.GetCollection<BsonDocument>(collection).Indexes.ListAsync()).ToListAsync()).Select(index => index["name"].AsString).ToList();

        Assert.Contains("ix_chestVersions_chest_version", await names("chestVersions"));
        Assert.Contains("ix_chestOpenings_chest_state_createdAt", await names("chestOpenings"));
        Assert.Contains("ix_chestOpenings_createdAt", await names("chestOpenings"));
        Assert.Contains("ix_chestPurchases_chest_state_createdAt", await names("chestPurchases"));
    }

    [Fact]
    public async Task StoppingTheSaleOfAnOwnedItemNeedsAReason_BecauseItsCopiesCanNoLongerBeSold()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var curio = await env.Items.CreateAsync(Yen, Curio(rarity: MarketRarities.Rare, price: 500));
        await env.Market.AdminGrantAsync(player.Id, curio.Id, 0);
        var request = UpdateOf(curio);
        request.Tradable = false;

        Assert.Equal(AdminChestsErrors.ReasonRequired, Code(await Throws(() => env.Items.UpdateAsync(Yen, curio.Id, request))));
        Assert.True(env.Provider.Current.Find(curio.Id)!.Tradable);

        request.Reason = "Món sự kiện, không cho bán";
        await env.Items.UpdateAsync(Yen, curio.Id, request);
        Assert.False(env.Provider.Current.Find(curio.Id)!.Tradable);
    }

    [Fact]
    public async Task StoppingTheSaleOfAnItemNobodyHasNeedsNoReason()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var curio = await env.Items.CreateAsync(Yen, Curio(rarity: MarketRarities.Rare, price: 500));
        var request = UpdateOf(curio);
        request.Tradable = false;

        await env.Items.UpdateAsync(Yen, curio.Id, request);

        Assert.False(env.Provider.Current.Find(curio.Id)!.Tradable);
    }

    [Fact]
    public async Task AGrantResentWithTheSameRequestIdGivesOnce()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var request = new AdminChestGrantRequest { UserId = player.Id, ChestId = Seal, Chests = 2, Keys = 1, Reason = "Đền bù", RequestId = NewKey() };

        await env.Stats.GrantAsync(Yen, request);
        await env.Stats.GrantAsync(Yen, request);

        var dto = (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal);
        Assert.Equal(2, dto.ChestCount);
        Assert.Equal(1, dto.KeyCount);
        Assert.Equal(1, await env.Catalog.Audit.CountDocumentsAsync(a => a.Action == "chest.grant"));
    }

    [Fact]
    public async Task ARarityWithNoChanceIsNotAdvertisedToPlayers()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var draft = await env.DraftOfAsync(Seal);
        draft.DropWeights[MarketRarities.Common] += draft.DropWeights[MarketRarities.Mystery];
        draft.DropWeights[MarketRarities.Mystery] = 0;
        draft.Reason = "Tắt Bí ẩn";

        await env.Admin.UpdateAsync(Yen, Seal, draft);

        var chest = (await env.Chests.ListAsync(player.Id)).Chests.Single(c => c.Id == Seal);
        Assert.DoesNotContain(chest.Contents, def => def.Rarity == MarketRarities.Mystery);
        Assert.Contains(chest.Contents, def => def.Rarity == MarketRarities.Common);
        // It stays listed for the admin, who sees its chance is nil.
        Assert.Contains(await env.Admin.GetAsync(Seal) is var detail ? detail.Pool : null!, item => item.Def.Id == "VC-0217" && item.RatePercent == 0m);
    }

    [Fact]
    public async Task AChestThatBrokeCanStillBeSwitchedOff_ButNotOtherwiseChanged()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        // A hand edit: the table no longer adds up. Stopping the sale is exactly what such a chest needs.
        await env.Catalog.Chests.UpdateOneAsync(c => c.Id == Seal, Builders<CatalogChest>.Update.Set("dropWeights.COMMON", 1));
        env.Provider.Invalidate();

        var other = await env.DraftOfAsync(Seal);
        other.ChestPrice += 1;
        other.Reason = "Thử";
        Assert.Contains(CatalogRuleCodes.WeightsTotal, ViolationCodes(await Throws(() => env.Admin.UpdateAsync(Yen, Seal, other))));

        var off = await env.DraftOfAsync(Seal);
        off.Active = false;
        off.Reason = "Dừng bán khẩn cấp";
        Assert.Empty((await env.Admin.CheckAsync(Seal, off)).Violations);
        await env.Admin.UpdateAsync(Yen, Seal, off);

        Assert.DoesNotContain((await env.Chests.ListAsync(player.Id)).Chests, chest => chest.Id == Seal);
    }

    [Fact]
    public async Task OnceAWriteHasHappenedTheCallerLeavingCannotStopTheRest()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var player = await env.AddUserAsync("Thám tử");
        var spy = new AuditSpy();
        var items = new AdminChestsItemService(env.Catalog, env.Store, env.AdminStore, env.Provider, spy);
        var chests = new AdminChestsChestService(env.Catalog, env.Store, env.AdminStore, env.Provider, spy, env.Random);
        var stats = new AdminChestsStatsService(env.Db, env.Store, env.Provider, env.Chests, spy, env.Market);
        using var caller = new CancellationTokenSource();

        var curio = await items.CreateAsync(Yen, Curio(), caller.Token);
        var update = UpdateOf(curio);
        update.Name = "Tên mới";
        await items.UpdateAsync(Yen, curio.Id, update, caller.Token);
        await items.SetRetiredAsync(Yen, curio.Id, true, "Hết mùa", caller.Token);
        await items.DeleteAsync(Yen, curio.Id, "Tạo nhầm", caller.Token);
        var draft = await env.DraftOfAsync(Seal);
        draft.ChestPrice += 1;
        draft.Reason = "Sửa giá";
        await chests.UpdateAsync(Yen, Seal, draft, caller.Token);
        await chests.CloneAsync(Yen, Seal, new AdminChestCloneRequest { Name = "Sao", NameEn = "Copy" }, caller.Token);
        await chests.RestoreAsync(Yen, Seal, 1, new AdminChestRestoreRequest { ExpectedVersion = 2, Reason = "Trả lại" }, caller.Token);
        await stats.GrantAsync(Yen, new AdminChestGrantRequest { UserId = player.Id, ChestId = Seal, Chests = 1, Reason = "Tặng" }, caller.Token);

        Assert.Equal(8, spy.Tokens.Count);
        Assert.All(spy.Tokens, token => Assert.False(token.CanBeCanceled));
    }

    [Fact]
    public async Task AnIdListedInAnOldVersionIsNotGivenToANewItem_BecauseRestoringThatVersionWouldBringItIn()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        var curio = await env.Items.CreateAsync(Yen, Curio("Món cũ"));
        var add = await env.DraftOfAsync(Seal);
        add.Pool.Add(curio.Id);
        add.Reason = "Thêm";
        await env.Admin.UpdateAsync(Yen, Seal, add);
        var remove = await env.DraftOfAsync(Seal);
        remove.Pool.Remove(curio.Id);
        remove.Reason = "Bỏ";
        await env.Admin.UpdateAsync(Yen, Seal, remove);
        await env.Items.DeleteAsync(Yen, curio.Id, "Tạo nhầm");

        var next = await env.Items.CreateAsync(Yen, Curio("Món mới"));

        Assert.NotEqual(curio.Id, next.Id);
        Assert.Equal("CU-0002", next.Id);
        Assert.Equal("CU-0003", (await env.Items.ListAsync()).NextCurioId);
    }

    [Theory]
    [InlineData("")]
    [InlineData("khong-phai-id")]
    public async Task GrantingToAnIdThatCannotExistIsNotFound_NotAServerError(string userId)
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();

        var error = await Throws(() => env.Stats.GrantAsync(Yen, new AdminChestGrantRequest { UserId = userId, ChestId = Seal, Chests = 1, Keys = 0, Reason = "Thử" }));

        Assert.Equal(404, error.StatusCode);
        Assert.Equal(MarketErrors.UserNotFound, Code(error));
    }

    [Fact]
    public async Task AChestStoredWithEmptyFieldsStillOpensInTheAdmin_SoItCanBeRepaired()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        await env.Db.Database.GetCollection<BsonDocument>("chests").UpdateOneAsync(
            new BsonDocument("_id", Bank),
            new BsonDocument("$set", new BsonDocument { { "pool", BsonNull.Value }, { "dropWeights", BsonNull.Value }, { "prices", BsonNull.Value }, { "look", BsonNull.Value } }));
        env.Provider.Invalidate();

        var row = (await env.Admin.ListAsync()).Chests.Single(chest => chest.Id == Bank);
        var detail = await env.Admin.GetAsync(Bank);
        var items = await env.Items.ListAsync();

        Assert.Equal(0, row.PoolCount);
        Assert.Empty(detail.Pool);
        Assert.Empty(detail.DropWeights);
        Assert.NotEmpty(items.Items);
    }

    [Fact]
    public async Task RenamingAChestWhoseKeyHasNoNameYetDoesNotFail()
    {
        if (!Enabled) return;
        await using var env = await AdminEnv.CreateAsync();
        await env.Catalog.Chests.UpdateOneAsync(c => c.Id == Seal, Builders<CatalogChest>.Update.Set(c => c.KeyName, string.Empty).Set(c => c.KeyNameEn, string.Empty));
        env.Provider.Invalidate();

        var draft = await env.DraftOfAsync(Seal);
        draft.KeyName = "chìa mới";
        draft.KeyNameEn = "new key";
        draft.Reason = "Đặt tên chìa";
        await env.Admin.UpdateAsync(Yen, Seal, draft);

        Assert.Equal("Chìa mới", env.Provider.Current.Find(SealKey)!.Name);
    }

    // ------------------------------------------------------------------ helpers

    private static AdminItemUpdateRequest UpdateOf(AdminItemDto item) => new()
    {
        Name = item.Name,
        NameEn = item.NameEn,
        Description = item.Description,
        DescriptionEn = item.DescriptionEn,
        Rarity = item.Rarity,
        ReferencePrice = item.ReferencePrice,
        Tradable = item.Tradable,
        IconKey = item.Visual.IconKey,
        ImageUrl = item.Visual.ImageUrl,
        ExpectedVersion = item.Version,
    };

    private static string? Code(ApiException exception) =>
        (exception.Errors as AdminChestsErrorDetails)?.Code ?? (exception.Errors as ApiErrorDetails)?.Code;

    private static IEnumerable<string> ViolationCodes(ApiException exception) =>
        (exception.Errors as AdminChestsErrorDetails)?.Violations.Select(violation => violation.Code) ?? Array.Empty<string>();

    private static async Task<ApiException> Throws(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (ApiException exception)
        {
            return exception;
        }
        throw new Xunit.Sdk.XunitException("Expected an ApiException.");
    }

    /// <summary>Notes the token each audit entry was written under, and writes nothing.</summary>
    private sealed class AuditSpy : IAdminAudit
    {
        public List<CancellationToken> Tokens { get; } = new();

        public Task LogAsync(CurrentUser admin, string action, string targetType, string targetId, object? before, object? after, string? reason = null, CancellationToken ct = default)
        {
            Tokens.Add(ct);
            return Task.CompletedTask;
        }

        public Task<AdminAuditPageDto> QueryAsync(AdminAuditQuery query, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class SettableRandom : IChestRandom
    {
        private readonly Queue<int> _values = new();

        public void Next(params int[] values)
        {
            foreach (var value in values) _values.Enqueue(value);
        }

        public int NextInt(int exclusiveMax) => _values.Count > 0 ? _values.Dequeue() : 0;
    }

    private sealed class AdminEnv : IAsyncDisposable
    {
        private readonly MongoClient _client;
        private readonly string _database;

        private AdminEnv(MongoDbSettings settings)
        {
            _database = settings.DatabaseName;
            _client = new MongoClient(settings.ConnectionString);
            Db = new MongoDbContext(Options.Create(settings));
            Store = new MarketStore(Db);
            Catalog = new CatalogStore(Db);
            Provider = new CatalogProvider(Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogProvider>.Instance);
            Audit = new AdminAuditService(Catalog);
            Random = new SettableRandom();
            Market = new MarketService(Store, NullLogger<MarketService>.Instance, Provider);
            Chests = new ChestService(Store, Market, Random, Options.Create(new ChestSettings()), NullLogger<ChestService>.Instance, Provider);
            AdminStore = new AdminChestsStore(Db);
            Items = new AdminChestsItemService(Catalog, Store, AdminStore, Provider, Audit);
            Admin = new AdminChestsChestService(Catalog, Store, AdminStore, Provider, Audit, Random);
            Stats = new AdminChestsStatsService(Db, Store, Provider, Chests, Audit, Market);
        }

        public MongoDbContext Db { get; }
        public MarketStore Store { get; }
        public CatalogStore Catalog { get; }
        public CatalogProvider Provider { get; }
        public AdminAuditService Audit { get; }
        public SettableRandom Random { get; }
        public MarketService Market { get; }
        public ChestService Chests { get; }
        public AdminChestsStore AdminStore { get; }
        public AdminChestsItemService Items { get; }
        public AdminChestsChestService Admin { get; }
        public AdminChestsStatsService Stats { get; }

        public static async Task<AdminEnv> CreateAsync()
        {
            var settings = new MongoDbSettings
            {
                ConnectionString = Environment.GetEnvironmentVariable("SIRLOCKED_TEST_MONGO") ?? "mongodb://127.0.0.1:27017",
                DatabaseName = $"sirlocked_it_adminchests_{Guid.NewGuid():N}"
            };
            TestMongoSafetyGuard.EnsureSafe(settings);
            var env = new AdminEnv(settings);
            await env.Db.PingAsync();
            await env.Store.EnsureIndexesAsync();
            await env.Catalog.EnsureIndexesAsync();
            await env.AdminStore.EnsureIndexesAsync();
            await new CatalogSeeder(env.Catalog, Options.Create(new ChestSettings()), NullLogger<CatalogSeeder>.Instance).SeedAsync();
            await env.Provider.RefreshAsync();
            return env;
        }

        public async Task<AdminChestDraftRequest> DraftOfAsync(string chestId)
        {
            var chest = await Admin.GetAsync(chestId);
            return new AdminChestDraftRequest
            {
                Name = chest.Name,
                NameEn = chest.NameEn,
                Subtitle = chest.Subtitle,
                SubtitleEn = chest.SubtitleEn,
                KeyName = chest.KeyName,
                KeyNameEn = chest.KeyNameEn,
                ChestPrice = chest.ChestPrice,
                KeyPrice = chest.KeyPrice,
                Active = chest.Active,
                SortOrder = chest.SortOrder,
                Look = new AdminChestLookRequest { Template = chest.Look.Template, Light = chest.Look.Light, Hi = chest.Look.Hi, Core = chest.Look.Core },
                DropWeights = new Dictionary<string, int>(chest.DropWeights),
                Pool = chest.Pool.Select(item => item.Def.Id).ToList(),
                ExpectedVersion = chest.Version,
            };
        }

        public async Task<bool> StoredRetiredAsync(string defId) =>
            (await Catalog.Items.Find(i => i.Id == defId).SingleAsync()).Retired;

        /// <summary>Leaves a chest with a single Mystery item, directly in the database, and answers which one.</summary>
        public async Task<string> KeepOneMysteryAsync(string chestId)
        {
            var chest = await Catalog.Chests.Find(c => c.Id == chestId).SingleAsync();
            var items = await Catalog.Items.Find(FilterDefinition<CatalogItem>.Empty).ToListAsync();
            var byId = items.ToDictionary(item => item.Id);
            var mystery = chest.Pool.Where(id => byId[id].Rarity == MarketRarities.Mystery).ToList();
            var kept = mystery[0];
            var pool = chest.Pool.Where(id => id == kept || !mystery.Contains(id)).ToList();
            await Catalog.Chests.UpdateOneAsync(c => c.Id == chestId, Builders<CatalogChest>.Update.Set(c => c.Pool, pool));
            Provider.Invalidate();
            return kept;
        }

        public Task AddOpeningAsync(string userId, string chestId, string rewardDefId, DateTime at, string state = ChestOpeningStates.Done) =>
            Store.ChestOpenings.InsertOneAsync(new ChestOpening
            {
                Id = $"{userId}:{Guid.NewGuid():N}", UserId = userId, ChestDefId = chestId, KeyDefId = "key",
                RewardDefId = rewardDefId, RewardItemId = MarketStore.NewId(), State = state, CreatedAt = at, UpdatedAt = at,
            });

        public Task AddPurchaseAsync(string userId, string chestId, string defId, long price, DateTime at, string state = ChestOpeningStates.Done) =>
            Store.ChestPurchases.InsertOneAsync(new ChestPurchase
            {
                Id = $"{userId}:{Guid.NewGuid():N}", UserId = userId, ChestDefId = chestId, DefId = defId, Price = price,
                ItemId = MarketStore.NewId(), State = state, CreatedAt = at, UpdatedAt = at,
            });

        public async Task<CurrentUser> AddUserAsync(string name)
        {
            var user = new User
            {
                Id = ObjectId.GenerateNewId().ToString(),
                FullName = name,
                Email = $"{Guid.NewGuid():N}@tests.invalid",
                Status = UserStatus.Active,
                IsEmailVerified = true,
            };
            await Db.Users.InsertOneAsync(user);
            await Market.EnsureAccountAsync(user.Id);
            return new CurrentUser(user.Id, name, UserRole.Player);
        }

        public async Task GrantAsync(string userId, string chestId, int chests, int keys)
        {
            var chest = Provider.Current.FindChest(chestId)!;
            for (var i = 0; i < chests; i++) await Market.AdminGrantAsync(userId, chest.Id, 0);
            for (var i = 0; i < keys; i++) await Market.AdminGrantAsync(userId, chest.KeyDefId, 0);
        }

        public async ValueTask DisposeAsync() => await _client.DropDatabaseAsync(_database);
    }
}
