# Mỹ phẩm do admin quản lý

Tài liệu cho người sửa code và các agent sau. Hợp đồng chung của khu admin ở `docs/admin-contracts.md`. Mọi điều dưới đây đã có trong code ở nhánh `feat/admin-my-pham`.

## 1. Vẽ theo dữ liệu

Mỗi mỹ phẩm có `visual` trong `catalogItems`. Trang người chơi đọc nó qua `GET /api/cosmetics/catalog`, rồi `cosmetics/catalog.js` đưa vào các bảng vẽ `FR`, `T`, `EN`.

- `visual.builtinId` có giá trị: dùng mã vẽ có sẵn. Hình và chuyển động không đổi; chỉ tên, độ hiếm và cách nhận lấy từ máy chủ.
- `visual.template`: dựng từ mẫu, tham số trong `visual.params`.

Máy chủ (`AdminCosmeticRules.ValidateVisual`) kiểm tra rồi **chép lại đúng những gì nó hiểu** vào document mới, nên khóa lạ bị bỏ. Trang người chơi kiểm tra lại một lần nữa, vì một màu sai trong canvas sẽ làm dừng cả lượt vẽ.

Màu luôn có dạng `"r,g,b"`. Ảnh phải là `https://...` hoặc `/assets/...`.

### Viền, `template = "painted"`

Ảnh vẽ tay nền trong suốt ở `visual.imageUrl`, đi qua đúng đường vẽ của 13 viền vẽ tay trong `frames.js`.

| Tham số | Bắt buộc | Giá trị |
|---|---|---|
| `hole` | có | `{ x, y, r }`, vị trí lỗ avatar theo pixel ảnh gốc. `x`, `y` không âm, `r` > 0 |
| `scale` | | 0,5 đến 1,5. Nhân thêm vào tỉ lệ tự tính |
| `live` | | Xem bảng dưới |
| `sheen` | | `{ rgb, a, period, conic }`: `a` 0 đến 1, `period` 2 đến 20 giây, `conic` là `true`/`false` |
| `glowUrl` | | Lớp phát sáng, vẽ chồng theo kiểu `lighter` và thở nhẹ |

Vị trí ảnh trong khung 200×200 tính theo cùng quy tắc đã đặt các viền có sẵn (`fitPicture`): lỗ nằm giữa theo chiều ngang, bán kính 57 đơn vị, trừ khi làm vậy thì ảnh tràn khung.

`live` cùng dạng bảng `LIVE` trong `frames.js`:

| Khóa | Giá trị | Giới hạn |
|---|---|---|
| `aura` | `[rgb, mạnh]` | mạnh 0 đến 0,6 |
| `rays` | `[rgb, mạnh]` | mạnh 0 đến 0,4 |
| `comet` | `[rgb, tốc độ, số vệt]` | tốc độ 0,02 đến 0,6; 1 đến 4 vệt |
| `spark` | `[rgb, số]` | 1 đến 10 |
| `fall` | `["snow"\|"petal"\|"rose"\|"feather", số]` | 1 đến 16 |
| `embers` | `[rgb, số]` | 1 đến 16 |
| `flame` | `1` | |
| `breathe` | `độ` | 0 đến 0,03 |

### Viền, `template = "builtin-clone"`

Dùng lại hình của viền có sẵn: `params.base` là builtinId (`dong`, `bac`, `ngoc`, `vang`, `truong`, `thach`, `mac`, `bang`, `sonmai`, `ulinh`, `vankiem`, `hacduc`, `kimlong`, `phuong`, `tinhkhong`, `lua`).

Có `live` hoặc `sheen` thì thay hẳn của viền gốc, không có thì giữ của viền gốc. Tắt ánh kim của viền gốc bằng `sheen.a = 0`. Màu hào quang chính là màu trong `live.aura`. Các lớp hình đã dựng được dùng chung với viền gốc, nên biến thể không tốn thêm bộ nhớ.

### Danh hiệu, `template = "style"`

Chữ hiển thị là tên def.

| Tham số | Bắt buộc | Giá trị |
|---|---|---|
| `style` | có | Khóa trong bảng `STY` của `titles.js`: `thuong`, `ngan`, `nguyet`, `truc`, `ngoc`, `bang`, `anhdao`, `mac`, `tinhkhong`, `kiem`, `thanh`, `thantham`, `hoa`, `hacduc`, `longphung`, `kimlong`, `phuong`, `thienmenh` |
| `glow` | | Màu phát sáng thay cho màu của kiểu |
| `parts` | | Hạt bay thay cho hạt của kiểu. Tối đa 4 dòng `[loại, số, rgb]`. Loại: `tw`, `rise`, `leaf`, `snow`, `petal`, `smoke`, `ember`, `feather`, `wfeather`. Số 1 đến 12 |

### Danh hiệu, `template = "painted"`

Bảng tên do họa sĩ vẽ, tải lên như ảnh viền (`imageUrl`, https hoặc `/assets/`). Tên def (tiếng Việt hoặc tiếng Anh) được viết vào khung chữ, nên đổi tên không cần vẽ lại ảnh. Tên dài hơn khung thì được ép vừa khung.

| Tham số | Bắt buộc | Giá trị |
|---|---|---|
| `size` | có | `{ w, h }` cỡ ảnh gốc, số nguyên 8 đến 4096 px. Trang dàn bảng tên theo cỡ này trước khi ảnh tải xong |
| `box` | có, trừ khi `textBaked` | `{ x, y, w, h }` khung chữ, tính theo phần của ảnh (0 đến 1). `w`, `h` từ 0,02; không vượt mép ảnh |
| `textBaked` | | `true`: ảnh đã có chữ, không viết tên lên. Khi đó không lưu `box` |
| `color` | | Màu chữ `"r,g,b"`, mặc định `255,240,200` |
| `scale` | | Cỡ bảng tên 0,5 đến 2 |
| `glow`, `parts` | | Như danh hiệu `style` |

### Hiệu ứng vào sảnh, `template = "flipbook"`

Hiệu ứng do họa sĩ vẽ thành sprite sheet: các khung cùng cỡ xếp lưới `cols` × `rows`, đọc từ trái sang phải, từ trên xuống. Chạy trên sân khấu toàn màn hình như các hiệu ứng khác.

| Tham số | Bắt buộc | Giá trị |
|---|---|---|
| `sheetUrl` | có | Ảnh sprite sheet, https hoặc `/assets/` |
| `cols`, `rows` | có | 1 đến 16 |
| `frames` | | Số khung chạy, 1 đến `cols × rows`. Mặc định mọi ô |
| `fps` | | 1 đến 60, mặc định 12 |
| `loop` | | Mặc định `true`. `false`: chạy một lần rồi giữ khung cuối |
| `place` | | `hero` (quanh người chơi, sau ảnh đại diện, mặc định), `screen` (phủ màn), `across` (bay ngang), `drop` (sà xuống) |
| `size` | | 0,3 đến 3, mặc định 1 |
| `blend` | | `normal` (ảnh nền trong suốt, mặc định) hoặc `add` (cộng sáng, cho ảnh vẽ trên nền đen) |
| `tint`, `duration` | | Như các mẫu khác. Mặc định 6 giây |

Không nhận `imageUrl` hay `swordUrl`.

### Hiệu ứng vào sảnh, `template` là một trong 10 hiệu ứng

`lang-le`, `anh-trang`, `mac-vu`, `truc-lam`, `van-kiem`, `huyet-nguyet`, `hac-duc`, `than-tham`, `kim-long`, `phuong-hoang`. Hiệu ứng mới mượn sân khấu của mẫu trong `stage.js`.

| Tham số | Mẫu | Giá trị |
|---|---|---|
| `tint` | mọi mẫu | Màu chủ đạo. Đổi sắc của ánh sáng, khói, hạt; giữ độ sáng từng màu. **Ảnh vẽ tay giữ nguyên màu của ảnh** |
| `duration` | mọi mẫu | 4 đến 12 giây |
| `imageUrl` | `kim-long`, `phuong-hoang` | Ảnh sinh vật. `kim-long`: đầu quay sang phải, bay ngang, thân uốn. `phuong-hoang`: nhìn thẳng, sà xuống, vỗ cánh |
| `swordUrl` | `van-kiem` | Ảnh kiếm, mũi quay sang phải |

### Yêu cầu chung của phần vẽ

- Mỗi ảnh chỉ nạp một lần, kể cả khi nhiều món dùng chung (`uploadedPic`).
- Ảnh lỗi tải: viền quay về vòng sắt của viền `none`, hiệu ứng quay về ảnh của mẫu. Không có lỗi console.
- Mép ảnh sinh vật làm mờ bằng `softImg`. Ảnh quá lớn được thu về cạnh dài 1400 px trên sân khấu.
- Ảnh sinh vật tải lên vẽ bằng `drawWarpSoft`: các lát nằm trên pixel nguyên và không chồng nhau, nên phần mờ của ảnh không bị sọc. Đồ có sẵn vẫn dùng `drawWarp`.
- `prefers-reduced-motion` và giới hạn DPR 2 đi theo đường vẽ cũ.

## 2. Cách nhận

Mỗi món có đúng một chế độ, lưu bằng `PUT /api/admin/cosmetics/{id}/acquisition`:

| `mode` | Lưu ở | Ghi chú |
|---|---|---|
| `level` | `levelRewards` | Tự thành không giao dịch được. Người đã vượt cấp đó nhận bù khi mở hồ sơ lần tới (`GrantLevelRewardsAsync`, idempotent nhờ id cố định theo người chơi và món) |
| `achievement` | `achievements` | `metric` thuộc `AchievementMetrics.All`. Tự thành không giao dịch được |
| `default` | `gameSettings/cosmeticDefaults` | Xem dưới. Tự thành không giao dịch được |
| `admin` | Không lưu gì | Chỉ admin cấp |

Mọi lần đổi cách nhận đều cần lý do. Các bước ghi không nằm trong một transaction (MongoDB chạy standalone), nên **thứ tự mới là thứ giữ an toàn**: tắt giao dịch trước, rồi mới ghi phần thưởng. Vì vậy một lỗi giữa chừng không bao giờ để lộ phần thưởng còn giao dịch được, và lưu lại lần nữa là xong.

Món phát miễn phí và phát lại được thì không được có giá trị, nếu không người chơi đem bán hoặc đổi KN rồi nhận lại. Vì vậy:

- `COSMETIC_EARNED_NOT_TRADABLE`: không bật giao dịch cho món đang theo cấp, thành tích hoặc mặc định.
- `COSMETIC_HAS_OPEN_ORDERS`: không tắt giao dịch khi còn lệnh trên chợ hoặc trong trao đổi, vì các lệnh đó sẽ biến khỏi chợ mà vẫn giữ tiền hoặc đồ.
- `COSMETIC_EARNED_COPIES_EXIST`: đã có bản nhận miễn phí thì không bật giao dịch được nữa.
- Bật hoặc tắt giao dịch cần lý do, vì nó đổi quyền của mọi người đang giữ món đó.

"Ra từ hòm" chỉ hiển thị ở trang này; sửa ở `/admin/chests` (ADMIN-1).

### Mặc định

Document `gameSettings/cosmeticDefaults`: `{ _id, frame, title, entrance }`. **Mỗi nhóm một trường, nên "tối đa 1 món mỗi nhóm" đúng theo hình dạng dữ liệu**, không cần index hay kiểm tra thêm.

- Đọc qua `ICosmeticDefaults`, cache 30 giây, lưu xong xóa cache. Database lỗi thì giữ câu trả lời tốt gần nhất, không ném lỗi.
- Nhóm chưa chọn thì dùng hằng số trong code: không viền, Tân Binh, Bước Vào Lặng Lẽ.
- Món mặc định không cần sở hữu. `ProgressService.Wear` trả về nó khi người chơi không đeo gì.
- Đặt món khác làm mặc định: món cũ về `admin`. Danh hiệu và hiệu ứng luôn phải có mặc định, nên không bỏ được chế độ của món mặc định trong code (`COSMETIC_DEFAULT_REQUIRED`).
- Có viền mặc định thì ô "Không viền" biến mất khỏi hồ sơ, vì không còn cách quay về không viền.
- Món mặc định không retire và không xóa được (`COSMETIC_DEFAULT_RETIRE`). Tân Binh và Bước Vào Lặng Lẽ cũng vậy, kể cả khi đang có món khác làm mặc định, vì chúng thay vào ngay khi món đó thôi làm mặc định.

## 3. Retire và xóa

- Retire cần lý do. Món hết rơi, rời cửa hàng, và không còn được phát theo cấp hay thành tích. Người đang đeo vẫn giữ nguyên, và `GET /api/cosmetics/catalog` vẫn trả nó để sảnh vẽ được.
- Retire, bỏ retire, hoặc đổi độ hiếm, giá mà làm hỏng một hòm đang tốt thì bị từ chối (`CHEST_RARITY_EMPTY`, `CHEST_EXPECTED_VALUE_TOO_HIGH`). Hòm vốn đã lỗi từ trước không chặn.
- Chỉ xóa được món do admin tạo, chưa ai sở hữu, không còn được tham chiếu và không còn lệnh mua.

## 4. API

Tất cả cần `[Authorize(Roles = UserRole.Admin)]`, trừ dòng cuối. Mọi thao tác ghi có audit.

| Phương thức | Đường dẫn | Audit |
|---|---|---|
| GET | `/api/admin/cosmetics` | |
| GET | `/api/admin/cosmetics/{id}` | |
| GET | `/api/admin/cosmetics/players?q=` | |
| POST | `/api/admin/cosmetics` | `item.create` |
| PUT | `/api/admin/cosmetics/{id}` (có `expectedVersion`) | `item.update` |
| PUT | `/api/admin/cosmetics/{id}/acquisition` | `item.acquisition` |
| PUT | `/api/admin/cosmetics/{id}/retired` (lý do bắt buộc) | `item.retire`, `item.unretire` |
| DELETE | `/api/admin/cosmetics/{id}?reason=` (lý do bắt buộc) | `item.delete` |
| POST | `/api/admin/cosmetics/{id}/grant` (lý do bắt buộc) | `player.grant` |
| PUT | `/api/admin/cosmetics/settings/xp` (lý do bắt buộc) | `gameSettings.update` |
| GET | `/api/cosmetics/catalog` (người chơi đã đăng nhập) | |

defId do máy chủ tạo từ tên (`frame_hac-long`), trùng thì thêm số (`frame_hac-long-2`), và không bao giờ đổi.

Cấp cho người chơi:

- Món giao dịch được: dùng lại `MarketService.AdminGrantAsync`, chiếm một ô trong túi; túi đầy thì báo lỗi.
- Món không giao dịch được: không chiếm ô, vì nó không bao giờ rời túi nên sẽ giữ ô đó mãi. Nguồn ghi là `LEVEL`, cùng loại với đồ nhận miễn phí.
- Người đã có món đó thì từ chối (`COSMETIC_ALREADY_OWNED`).

## 5. Thêm vào đâu khi đổi code

- Thêm viền, kiểu danh hiệu hay sân khấu mới vào mã vẽ: thêm vào bảng tương ứng trong `AdminCosmeticRules` và `cosmetics/catalog.js`, nếu không admin sẽ không chọn được.
- Đo hình đồ có sẵn: `tests/admin-cosmetics-look.spec.ts` chụp 138 hình ở các thời điểm cố định và so từng điểm ảnh giữa hai phiên bản code. Cách chạy ở đầu file.
