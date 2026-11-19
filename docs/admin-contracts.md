# Hợp đồng chung cho trang quản trị

Tài liệu này dành cho người sửa code khu quản trị. Mọi điều dưới đây đã có trong code ở nhánh `feat/admin`, nơi đã gộp ADMIN-0 đến ADMIN-3. Mỹ phẩm có tài liệu riêng ở [admin-cosmetics.md](admin-cosmetics.md).

Quy tắc số một: **danh mục nằm trong MongoDB và chỉ đọc qua `ICatalogProvider`.** Các lớp `MarketCatalog`, `ChestCatalog`, `CosmeticCatalog`, `AchievementRules.Catalog`, `ProgressRules.RareXp/EpicXp` và `Chests:Prices` chỉ còn là **dữ liệu seed**. Test `CatalogSingleSourceTests` sẽ đỏ nếu code chạy thật đọc lại chúng.

## 1. Collection

Tên trường trong DB là camelCase. Lớp C# nằm ở `Models/Catalog/CatalogModels.cs`, truy cập qua `CatalogStore` (`Items`, `Chests`, `LevelRewards`, `Achievements`, `ProgressSettings`, `SeedState`, `Audit`).

### `catalogItems` (lớp `CatalogItem`)

| Trường | Ý nghĩa |
|---|---|
| `_id` | defId. Không bao giờ đổi. Giữ nguyên mọi id cũ. |
| `category` | `MAGNIFIER`, `STAMP`, `PINS`, `FOLDER`, `BADGE`, `BOARD`, `WATCH`, `CHEST`, `KEY`, `CURIO`, `FRAME`, `TITLE`, `ENTRANCE` |
| `rarity` | `COMMON`, `RARE`, `EPIC`, `LEGENDARY`, `MYSTERY` |
| `name`, `nameEn` | Tên hiển thị |
| `description`, `descriptionEn` | Mô tả. **Mỹ phẩm để rỗng thì mô tả tự tính từ `pool`** (xem mục 4). |
| `referencePrice` | Giá tham chiếu, dùng cả để tính giá trị kỳ vọng |
| `tradable` | Được bán và trao đổi hay không |
| `retired` | Ẩn khỏi bảng rơi và cửa hàng; món đã sở hữu vẫn dùng bình thường |
| `sortOrder` | Thứ tự hiển thị |
| `createdAt`, `updatedAt`, `updatedBy`, `version` | Theo dõi thay đổi. Mỗi lần sửa: tăng `version`, ghi `updatedAt`, `updatedBy` |
| `visual` | Xem mục 2 |

### `chests` (lớp `CatalogChest`)

| Trường | Ý nghĩa |
|---|---|
| `_id` | defId của hòm, cũng là một item trong `catalogItems` (category `CHEST`) |
| `keyDefId` | defId của chìa (category `KEY`). Có index duy nhất: mỗi chìa chỉ mở một loại hòm |
| `name`, `nameEn`, `subtitle`, `subtitleEn`, `keyName`, `keyNameEn` | Chữ hiển thị |
| `iconKey`, `keyIconKey` | Sprite của hòm và chìa (`chest_seal`, `key_loupe`...) |
| `look` | `{ template, light, hi, core }`. `template` là `seal`, `bank` hoặc `lacquer`. Ba màu còn lại ở dạng `"r,g,b"`, cùng ý nghĩa với `CHEST_LOOKS` trong `chestSprites.js` |
| `prices` | `{ chest, key }`, đơn vị xu. Seed từ cấu hình `Chests:Prices` đang chạy |
| `dropWeights` | `{ "COMMON": 7992, "RARE": 1598, ... }`. Mẫu số 10.000. Mỗi hòm một bảng riêng |
| `pool` | Danh sách defId, theo thứ tự hiển thị |
| `active` | Tắt thì ẩn khỏi danh sách cho người chơi |
| `sortOrder`, `version`, `updatedBy`, `createdAt`, `updatedAt` | Như trên |

### `levelRewards` (lớp `CatalogLevelReward`)

`{ _id, level, defId }`. `_id` tạo bằng `CatalogLevelReward.IdOf(level, defId)`, ví dụ `"10:frame_dong"`. Một cấp có thể có nhiều phần thưởng.

### `achievements` (lớp `CatalogAchievement`)

`{ _id: titleDefId, metric, target, sortOrder }`.

- `metric` là một tên trong `AchievementMetrics.All`: `Played`, `Won`, `MidnightWins`, `NoHintWins`, `CluesFound`, `TestimoniesRecorded`, `OwnsWatch217`. Hàm đếm ở trong code, DB chỉ lưu tên.
- `metric: null` nghĩa là chưa đếm được, người chơi thấy là chưa mở khóa được. `title_tho-khoa` đang như vậy vì hệ thống không ghi ai giải câu đố.
- Tên `metric` lạ (ví dụ sau khi quay lui phiên bản) không làm hỏng trang: thành tích đó không đạt được, và provider ghi cảnh báo vào log.

### `gameSettings`

Ba document, phân biệt bằng `_id`:

- `progress`: `{ rareXp: 150, epicXp: 600 }`, lớp `ProgressSettingsDocument`. Công thức cấp và cấp tối đa giữ trong code.
- `catalogSeed`: `{ seedVersion, updatedAt }`, lớp `CatalogSeedState`. Chỉ `CatalogSeeder` được ghi.
- `cosmeticDefaults`: `{ frame, title, entrance }`, lớp `CosmeticDefaultsDocument`. Món mặc định của từng nhóm, xem `admin-cosmetics.md`.

### `adminAudit` (lớp `AdminAuditEntry`)

`{ at, adminId, adminName, action, targetType, targetId, before, after, reason }`. `before` và `after` lưu dạng chuỗi JSON. Xem mục 6.

### `chestVersions` (lớp `ChestVersion`)

`{ _id: "<chestId>:<version>", chestId, version, action, at, adminId, adminName, reason, snapshot }`. `action` là `base` (trạng thái trước lần lưu đầu), `update`, `restore` hoặc `clone`. Tab Lịch sử ở `/admin/chests/:id` đọc và khôi phục từ đây.

### `adminPlayerOps` và `adminAvatarReviews`

`adminPlayerOps` (lớp `AdminPlayerOp`) là journal cho cộng trừ xu, cấp và thu hồi vật phẩm, đặt cấp. `_id` là `"<adminId>:<idempotencyKey>"`, nên gửi lại cùng khóa không chạy lần hai. Lượt dở dang được worker bảo trì chạy tiếp.

`adminAvatarReviews` (lớp `AdminAvatarReview`) ghi những ảnh đại diện admin đã duyệt.

## 2. Dạng `visual`

```
visual: {
  iconKey:   string|null   // sprite vẽ bằng code (icons.js, chestSprites.js)
  imageUrl:  string|null   // ảnh admin tải lên
  builtinId: string|null   // id mã vẽ sẵn trong src/FE/Client/js/cosmetics ("kimlong", "long-phung", "van-kiem")
  template:  string|null   // mẫu dựng cho mỹ phẩm do admin tạo (ADMIN-2 định nghĩa giá trị)
  params:    object        // tham số của mẫu (ADMIN-2 định nghĩa), document tự do
}
```

- Mỹ phẩm seed: `builtinId` là phần id sau tiền tố (`frame_kimlong` có `kimlong`). `iconKey` vẫn bằng defId như trước, vì trường `iconKey` của API phải giữ nguyên.
- Vật phẩm thường: `iconKey` như cũ, có thể `null` (đồ gear cũ được vẽ theo category).
- API gửi `visual` nguyên dạng trong mọi `ItemDefDto`. `iconKey` cũ ở cấp trên vẫn còn, luôn bằng `visual.iconKey`.
- `params` trong DB là `BsonDocument`; ra API là JSON thường. Trong C# đọc `def.Visual.Params` (kiểu `IReadOnlyDictionary<string, object?>`).

## 3. `ICatalogProvider`

Đăng ký singleton. Tiêm vào service hoặc controller.

```csharp
public interface ICatalogProvider
{
    CatalogSnapshot Current { get; }
    void Invalidate();
    Task RefreshAsync(CancellationToken ct = default);
}
```

**Đọc.** Lấy `Current` một lần cho mỗi thao tác để mọi thứ trong thao tác đó nhất quán:

```csharp
var catalog = _catalog.Current;
var def = catalog.Find(defId);            // MarketItemDef?, gồm cả món đã retired
var chest = catalog.FindChest(chestId);   // ChestDef?, gồm cả hòm đã tắt
```

| Thành viên của `CatalogSnapshot` | Ghi chú |
|---|---|
| `All` | Mọi def, gồm cả retired, theo `sortOrder` |
| `Find(id)` | Tìm def |
| `Chests` / `ActiveChests` | Mọi hòm / chỉ hòm đang bật |
| `FindChest(id)` | Tìm hòm |
| `LevelRewards` | Theo cấp tăng dần |
| `Achievements` | Theo `sortOrder` |
| `RareXp`, `EpicXp`, `XpValue(def)` | Tỉ lệ KN đang áp dụng |
| `Problems` | Những gì không khớp trong dữ liệu đã lưu: document sai kiểu, def không tồn tại, category hoặc rarity sai, metric lạ, giá ngoài giới hạn, độ hiếm rỗng. Provider ghi log. Trang admin nên hiện ra |

Trong `ChestDef`: `Items` và `Pools` đã **loại món retired**. `DropRates`, `Prices`, `Active`, `Roll(random)`, `ExpectedValue()` đều theo đúng hòm đó.

**Ghi.** Sau khi ghi bất kỳ collection danh mục nào, gọi `_catalog.Invalidate()`:

```csharp
await _store.Items.UpdateOneAsync(...);
_catalog.Invalidate();
await _audit.LogAsync(...);
```

- Lần đọc `Current` đầu tiên sau `Invalidate()` nạp lại từ DB rồi mới trả lời, nên người vừa ghi luôn đọc được dữ liệu mới. Thao tác đó chỉ chặn một lần nạp.
- Mỗi 60 giây `CatalogRefreshWorker` tự nạp lại, phòng khi có nhiều tiến trình.
- Mongo sập: bản tốt gần nhất vẫn phục vụ, log ghi lỗi, 5 giây sau thử lại. Việc đọc `Current` không ném lỗi đến người chơi. Riêng `RefreshAsync` có ném lỗi, để phía gọi biết.
- Một document sai kiểu (`referencePrice: "x"`): bị bỏ qua và ghi vào `Problems`, phần còn lại vẫn nạp bình thường. API vẫn khởi động được. Các trường lưu `null` (`pool`, `dropWeights`, `prices`) được coi là rỗng.
- Khi test không truyền provider vào service, service dùng `FixedCatalogProvider` (dữ liệu seed). Test mới cần DB thật thì truyền `CatalogProvider`; mẫu ở `IntegrationTests/MongoCatalogTests.cs`.

## 4. Các hành vi đã chốt

- **Retired:** hết rơi, không còn trong `GET /api/market/catalog`, không còn trong hòm. Người đã có vẫn thấy, trang bị, bán, đổi KN được. Trên Chợ đồ, món retired vẫn hiện **chừng nào còn người rao bán hoặc đặt mua**, để các lệnh đó không bị mắc kẹt.
- **Mô tả "Ra từ..." của mỹ phẩm:** khi `description` rỗng, provider tính từ `pool` của các hòm **đang bật**: `Viền avatar. Ra từ Hòm Niêm Phong, Két Nhà Băng.`; có ở mọi hòm thì `Bí ẩn, ra từ mọi hòm.`; không ở hòm nào thì chỉ còn `Viền avatar.`. Admin nhập `description` khác rỗng thì giữ nguyên chữ của admin. Trang admin nên đọc mô tả đã tính bằng `catalog.Find(id)`, không đọc thẳng document.
- **Lượt mở hòm dở dang:** `ChestOpening` lưu sẵn `rewardDefId`, nên sửa pool hay retire món không ảnh hưởng lượt đang chạy. Test: `AnOpeningInProgressKeepsItsRewardAfterThePoolChanges`.
- **Hòm tắt:** `ChestListDto.Chests` chỉ có hòm đang bật. Hòm đã tắt mà người chơi còn giữ hòm hoặc chìa nằm ở `ChestListDto.OffSale`, vẫn mở được. Cửa hàng từ chối bán với `CHEST_NOT_FOR_SALE` (409). Def `CHEST` và `KEY` của hòm tắt chuyển `retired = true` để rời catalog Chợ đồ.
- **Tỉ lệ và hình của từng hòm:** `ChestDto.Odds` là bảng riêng của hòm đó, `ChestDto.Look` chọn hình và màu, `ChestDto.Active` cho biết còn bán không. `ChestListDto.Odds` chỉ còn cho client cũ.
- **Giá đổi giữa chừng:** `ExpectedPrice` trong `ChestOperationRequest` là tùy chọn. Gửi lên mà sai giá hiện tại thì trả `CHEST_PRICE_CHANGED` (409), không trừ tiền.
- **Tham chiếu tới def không tồn tại:** bị bỏ khỏi snapshot và ghi vào `Problems`, nên không bao giờ cấp ra một món không có def.
- **Giá hòm hoặc chìa ngoài giới hạn:** cửa hàng từ chối bán (409), không thành hòm miễn phí.
- **Rơi vào độ hiếm rỗng:** `CatalogRules` chặn khi lưu. Nếu vẫn xảy ra (ví dụ retire món cuối của một độ hiếm), lượt mở trả món ở độ hiếm gần nhất (thấp hơn trước, rồi cao hơn) thay vì lỗi, và `Problems` có ghi.

**Còn để ngỏ:**

- `CosmeticCatalog.DefaultAvatar`, tiền tố id, `IsCosmetic` và `MarketCatalog.StarterItemIds` vẫn nằm trong code.
- `POST /api/chests/admin/grant` cũ không ghi nhật ký. Trang admin dùng `POST /api/admin/chests/grant`.
- Món không giao dịch được mà admin cấp ở `/admin/cosmetics` lưu `Source = LEVEL` để không chiếm ô túi, nên trang Người chơi coi nó như phần thưởng và không thu hồi được.

## 5. `CatalogRules`

`Services/Admin/CatalogRules.cs`. Hàm thuần, không I/O. Mọi lỗi có `Code` ổn định và `Message` tiếng Việt hiện thẳng cho admin được.

| Hàm | Kiểm tra | Mã lỗi |
|---|---|---|
| `ValidateDelete(defId, ownedCopies, references)` | Không xóa def đã có người sở hữu | `CATALOG_DEF_OWNED` |
| | Không xóa def còn được tham chiếu | `CATALOG_DEF_IN_USE` |
| `ReferencesTo(defId, chests, levelRewards, achievements)` | Liệt kê những gì đang dùng def, để truyền vào `ValidateDelete` | |
| `ValidateDefIdUnchanged(current, submitted)` | defId không đổi sau khi tạo | `CATALOG_DEF_ID_CHANGED` |
| `ValidatePrice(label, price)` | Giá trong giới hạn `MarketRules.ValidatePrice` (2 đến 1.000.000) | `CATALOG_PRICE_INVALID` |
| `ValidateChest(chest, items)` | Tất cả các dòng dưới | |
| | Tổng trọng số đúng 10.000 | `CHEST_WEIGHTS_TOTAL` |
| | Trọng số không âm, độ hiếm có thật | `CHEST_WEIGHT_INVALID` |
| | Độ hiếm có trọng số > 0 phải có ít nhất 1 món chưa retired | `CHEST_RARITY_EMPTY` |
| | Món trong pool phải tồn tại | `CHEST_POOL_UNKNOWN_ITEM` |
| | Không cho CHEST hoặc KEY vào pool | `CHEST_POOL_FORBIDDEN_ITEM` |
| | Giá trị kỳ vọng < giá hòm + giá chìa | `CHEST_EXPECTED_VALUE_TOO_HIGH` |
| `ExpectedValue(chest, items)` | Giá trị kỳ vọng mỗi lần mở, để hiện trên giao diện | |

`items` là `IReadOnlyDictionary<string, CatalogItem>`. `ValidateChest` trả về danh sách rỗng khi hợp lệ.

Kiểm tra lại ở máy chủ trước khi ghi, không tin giao diện.

## 6. `IAdminAudit`

**Mọi API admin mới có ghi dữ liệu đều phải ghi nhật ký.**

```csharp
await _audit.LogAsync(Caller, "chest.update", "chest", chestId, before, after, reason, ct);
```

- Gọi **sau khi** thao tác đã thành công. Ghi nhật ký lỗi thì ném exception, để phía gọi biết thao tác chưa được ghi lại.
- `before` và `after` nhận document, DTO, object ẩn danh hoặc `BsonDocument`, `null` nếu không có. **Không đưa bí mật hay token vào.**
- `action` đặt theo dạng `doiTuong.hanhDong`, chữ thường: `item.create`, `item.retire`, `chest.update`, `player.grant`, `asset.upload`.
- `targetType` theo collection hoặc khái niệm: `catalogItem`, `chest`, `levelReward`, `achievement`, `gameSettings`, `user`, `asset`.
- `reason` được cắt khoảng trắng hai đầu; rỗng thì lưu `null`.

**Đọc:** `GET /api/admin/audit?targetType=&targetId=&adminId=&action=&from=&to=&page=&pageSize=` (chỉ admin).

- Mới nhất trước. `page` từ 1, `pageSize` mặc định 50, tối đa 200. `from`, `to` theo UTC.
- Trả về `{ items, page, pageSize, total }`. Mỗi `item` có `before`, `after` đã là JSON.
- Frontend: `api/adminAuditApi.js`, gọi `adminAuditApi.list({ targetType, page })`.

## 7. Tải ảnh: `POST /api/admin/assets`

Chỉ admin. Multipart, trường tên `file`. Trả về `{ url, width, height }`. Frontend: `adminAssetsApi.upload(file)` trong `api/adminAssetsApi.js`.

- Nhận PNG, WebP, JPG, tối đa 5 MB và 8000 px mỗi cạnh. Định dạng đọc từ nội dung file, không xét đuôi file hay content type. **Không nhận SVG.**
- Luôn chuyển sang WebP, giữ kênh alpha, không đổi kích thước, bỏ metadata. Ảnh chụp điện thoại được xoay đúng chiều trước đó, nên `width`, `height` là kích thước sau khi xoay. Ảnh động chỉ giữ khung đầu.
- Lưu ở Cloudinary, thư mục `sirlocked/admin`, tên theo nội dung file: tải lại đúng ảnh đó không tốn thêm dung lượng.
- Mỗi lần tải thành công ghi audit `asset.upload`.

| Mã lỗi | HTTP | Khi nào |
|---|---|---|
| `ASSET_TOO_LARGE` | 400 | Từ trên 5 MB đến 6 MB |
| (không có mã) | 400 | Trên 6 MB: framework từ chối trước khi vào controller. Giao diện nên tự kiểm tra `file.size` trước khi gửi |
| `ASSET_BAD_IMAGE` | 400 | Không phải PNG, WebP, JPG; file hỏng; quá 8000 px; thiếu file |
| `ASSET_STORAGE_UNAVAILABLE` | 503 | Chưa cấu hình Cloudinary |

Mã lỗi nằm ở `errors.code` trong phản hồi. Ở máy local thường không có Cloudinary: test bằng `IAdminAssetStorage` giả (xem `Tests/AdminAssetTests.cs`).

## 8. Seed

`CatalogSeeder.SeedAsync()` chạy lúc khởi động, trước khi API nhận request, rồi provider nạp lần đầu.

- Chỉ chèn khi id chưa có, không bao giờ ghi đè chỉnh sửa của admin.
- Một phiên bản seed chỉ chạy một lần. Vì vậy thứ admin đã xóa (ví dụ một phần thưởng theo cấp) không tự quay lại sau khi khởi động lại.
- Chạy lại nhiều lần hoặc nhiều tiến trình cùng lúc đều an toàn.
- **Thêm seed mới:** tăng `CatalogSeedData.CurrentVersion`, thêm một nhánh trong `ForVersion` trả về **đúng những mục mới**.
- Sau lần seed đầu, sửa `Chests:Prices` hay các lớp static không còn tác dụng. Đổi giá ở trang admin.

## 9. Khung cho từng khu

**Đăng ký service:** không sửa `Program.cs`. Thêm vào đúng file của khu:

| Khu | File | Hàm |
|---|---|---|
| ADMIN-1 | `Services/Admin/AdminChestsRegistration.cs` | `AddAdminChests()` |
| ADMIN-2 | `Services/Admin/AdminCosmeticsRegistration.cs` | `AddAdminCosmetics()` |
| ADMIN-3 | `Services/Admin/AdminPlayersRegistration.cs` | `AddAdminPlayers()` |

Controller được nhận tự động.

**Thanh tab:** router tự gắn `adminNav` vào `#admin-nav-root` (nằm ngoài `#app`) cho mọi route `admin: true`. **Trang không tự chèn thanh tab.** Trang vẽ lại `app` thoải mái, thanh tab không mất.

**Route đã đăng ký sẵn** trong `main.js`. Hàm trang nhận `app`, rồi `:id` nếu route có (`undefined` khi không có), rồi `{ signal }`, tín hiệu hủy khi rời trang. Hàm trang có thể trả về một hàm dọn dẹp. Các route này nhận thêm chuỗi truy vấn (`/admin/players?page=2`, `/admin/players/u42?tab=kho`): `id` không bao gồm phần sau dấu `?`, còn trang tự đọc tham số từ `location.hash`:

| Route | Hàm trong file | Agent |
|---|---|---|
| `/admin/chests`, `/admin/chests/:id` | `renderAdminChestsPage(app, id, { signal })` trong `pages/adminChestsPage.js` | ADMIN-1 |
| `/admin/items` | `renderAdminItemsPage(app, { signal })` trong `pages/adminItemsPage.js` | ADMIN-1 |
| `/admin/cosmetics`, `/admin/cosmetics/:defId` | `renderAdminCosmeticsPage(app, defId, { signal })` trong `pages/adminCosmeticsPage.js` | ADMIN-2 |
| `/admin/players`, `/admin/players/:id` | `renderAdminPlayersPage(app, id, { signal })` trong `pages/adminPlayersPage.js` | ADMIN-3 |
| `/admin/economy` | `renderAdminEconomyPage(app, { signal })` trong `pages/adminEconomyPage.js` | ADMIN-3 |
| `/admin/audit` | `renderAdminAuditPage(app, { signal })` trong `pages/adminAuditPage.js` | ADMIN-3 |

Giữ nguyên tên hàm được export. `tests/admin-nav.spec.ts` không phụ thuộc nội dung trang. Đăng nhập giả cho test nằm ở `tests/helpers/adminSession.ts`.

## 10. File thuộc về ai

| Khu | Backend | Frontend | Test |
|---|---|---|---|
| **ADMIN-0** (nền tảng, đừng sửa) | `Models/Catalog/*`, `Services/Catalog/*`, `Services/Admin/CatalogRules.cs`, `AdminAudit.cs`, `AdminAssets.cs`, `AdminFoundationRegistration.cs`, `AdminAuditController.cs`, `AdminAssetsController.cs`, `DTOs/Admin/AdminDtos.cs` | `components/adminNav.js`, `api/adminAssetsApi.js`, `api/adminAuditApi.js`, `css/49-admin-shell.css`, `main.js`, `index.html` | `Catalog*Tests.cs`, `AdminAssetTests.cs`, `MongoCatalogTests.cs`, `admin-nav.spec.ts` |
| **ADMIN-1** Hòm & vật phẩm | `AdminChestsController.cs`, `Services/Admin/AdminChests*.cs`, `DTOs/Admin/AdminChestDtos.cs`. Được sửa `ChestService.cs`, `DTOs/Market/ChestDtos.cs` | `pages/adminChestsPage.js`, `pages/adminItemsPage.js`, `pages/admin/chests/`, `api/adminChestsApi.js`, `css/50-admin-chests.css`. Được sửa `pages/chestPage.js`, `pages/chest/*` | `Tests/AdminChests*Tests.cs` hoặc `Tests/AdminChests/`, `IntegrationTests/MongoAdminChests*Tests.cs` hoặc `IntegrationTests/AdminChests/`, `tests/admin-chests*.spec.ts` hoặc `tests/admin-chests/` |
| **ADMIN-2** Mỹ phẩm | `AdminCosmeticsController.cs`, `Services/Admin/AdminCosmetics*.cs`, `DTOs/Admin/AdminCosmeticDtos.cs`. Được sửa `ProgressService.cs`, `ProgressRules.cs` | toàn bộ `cosmetics/`, `pages/adminCosmeticsPage.js`, `pages/admin/cosmetics/`, `api/adminCosmeticsApi.js`, `css/51-admin-cosmetics.css`, `css/48-cosmetics.css`. Được sửa `pages/detective/cosmeticsPanel.js`, `lobbyPage.js` | Tương tự, tên `AdminCosmetics` / `admin-cosmetics` |
| **ADMIN-3** Người chơi & kinh tế | Xem file ADMIN-3; đăng ký ở `AdminPlayersRegistration.cs` | `pages/adminPlayersPage.js`, `pages/adminEconomyPage.js`, `pages/adminAuditPage.js`, `pages/admin/players/`, `api/adminPlayersApi.js`, `css/52-admin-players.css` | Tương tự, tên `AdminPlayers` / `admin-players` |

Thư mục test trống `AdminChests`, `AdminCosmetics`, `AdminPlayers` (BE) và `admin-chests`, `admin-cosmetics`, `admin-players` (FE) đã tạo sẵn. Có thể đặt test trong đó hoặc đặt phẳng theo tên ở file ADMIN của mình.
