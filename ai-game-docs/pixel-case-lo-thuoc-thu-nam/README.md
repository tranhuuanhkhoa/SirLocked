# Lọ thuốc thứ Năm — case pixel PixelLab đầu tiên

Case tiếng Việt cho hai người, thiết kế khoảng 30 phút, ID `case-pixel-lo-thuoc-thu-nam-vi`. Đây là case đầu tiên chạy ở **pixel render mode**: một bản đồ ngoài trời nhìn từ trên xuống, năm phòng isometric 2:1, nhân vật 8 hướng. Toàn bộ hình ảnh gốc làm bằng PixelLab theo quy trình 8 bước trong [visual-style-templates/pixellab](../visual-style-templates/pixellab/README.md). Case được soạn tay, không qua endpoint sinh case.

| Tệp | Nội dung |
| --- | --- |
| `src/BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json` | JSON case (V3, `PLACEMENT_FIRST`, DRAFT khi import) |
| [pixellab-requests.json](pixellab-requests.json) | Mọi request PixelLab đã gửi, theo thứ tự quy trình: tham số, prompt đầy đủ, ảnh tham chiếu, seed, job/character/animation ID, chi phí, tệp kết quả |
| `src/FE/public/assets/pixel/lo-thuoc-thu-nam/` | Ảnh game đọc: `scenes/`, `fg/`, `characters/`, `items/`, `cover.png` |
| `src/FE/public/assets/pixel/players/` | Sprite sheet người chơi `holmes96-*.png`, `watson96.png` |
| `src/BE/Tests/PixelCaseTests.cs` | Test validator và hợp đồng `runtime.render` |
| `src/FE/tests/pixel-case-full-stack.spec.ts` | Playwright: hai thám tử chơi hết case qua cửa, cảnh cuộn và mọi cơ chế |

Bản gốc PixelLab nằm ở [`source/art/`](source/art/) và script dựng case ở [`source/build/`](source/build/) (`scenes_spec.py`, `build_assets.py`, `build_case.py`); cách dựng lại xem [`source/README.md`](source/README.md). Đường dẫn `art/...` trong `pixellab-requests.json` tính từ thư mục `source/`.

## Vụ án (có spoiler)

06:40 sáng thứ Sáu, bà Lý Hạnh thấy ông Lâm Thế Vinh bất động trên ghế bành ở nhà số 7 phố Hàng Đường, sau một liều thuốc tim đặc bất thường. Hộp nữ trang mở toang, tờ di chúc có dấu bị sửa.

Lời giải: cháu ruột **Lâm Thế Bảo** nợ tiệm cầm đồ, hạn chót thứ Hai, và đã sửa di chúc để hưởng 80% kèm căn nhà. Chiều thứ Hai Bảo nhận hộp thuốc tuần lúc 17:05 nhưng 18:10 mới giao cho bà Hạnh. Trong một giờ đó anh mượn buồng tối hiệu ảnh, rạch tem lọ "Thứ Năm", pha đặc thuốc rồi dán lại bằng keo ép ảnh. Lời hẹn 21:00 ở bến đò Hàn là ngoại phạm dựng sẵn. **Trịnh Lực** lấy trộm nhẫn ngọc bích lúc 22:15, khi ông Vinh đã bất động, rồi đem cầm sáng thứ Sáu. Lực là kẻ trộm, không phải hung thủ.

Cáo buộc cuối cần ba chứng cứ: di chúc bị sửa (MOTIVE), lớp keo lạ dưới tem (METHOD), phiếu nhận thuốc 17:05 (OPPORTUNITY). Cần hai suy luận (Lực bị loại; nguồn keo) và hai chuỗi phối hợp.

## Cảnh, NPC và cơ chế

Hồi 1 "Sáng thứ Sáu": phố và nhà số 7. Hồi 2 "Lần theo hộp thuốc": bốn cửa hiệu còn lại.

| Cảnh | Chiếu | NPC | Cơ chế | Điều kiện xong cảnh |
| --- | --- | --- | --- | --- |
| `scene-px-pho` Phố Hàng Đường | topdown | Lý Hạnh | Hỏi 3 câu; câu về tủ kính cho manh mối mã. Đồng hồ quảng trường mở `SEQUENCE_PUZZLE` xếp hành trình hộp thuốc khi đủ ba mốc giờ. Năm cửa vào nội thất. 8 cut-out che người chơi. | Hỏi bà Hạnh chuyện sáng nay |
| `scene-px-nha-so-7` Nhà số 7, phòng trưng bày | isometric | Lâm Thế Bảo | Hội thoại phân nhánh, đối chất chính "giờ nhận thuốc". Lọ "Thứ Năm"; máy ảnh chụp tem niêm; kính lúp (nhặt) dùng lên lọ → keo lạ. Hộp nữ trang. Tủ kính `CODE_PUZZLE` 2100 → sổ tay. Ngăn kéo (khám xét) → di chúc. | Lọ thuốc, hộp nữ trang, di chúc, sổ tay, hỏi Bảo chiều thứ Hai |
| `scene-px-hieu-thuoc` Hiệu thuốc Hưng Long | isometric | Phạm Tùng | Sổ giao nhận (17:05, ký tay trái), khay tem và hồ bột gạo, lời khai của Tùng | Hai vật trên quầy, hỏi Tùng người nhận thuốc |
| `scene-px-nha-xe` Nhà xe và phòng Trịnh Lực | isometric | Trịnh Lực | Hội thoại, đối chất "kẻ trộm nhẫn". Sổ xe (nhặt). Rương (khám xét) → chìa khóa cửa sau, hướng nghi ngờ sai. | Sổ xe, hỏi Lực tối thứ Năm |
| `scene-px-cam-do` Tiệm cầm đồ Đặng Bửu | isometric | Đặng Bửu | Sổ nợ, phiếu cầm nhẫn (nhặt), máy ảnh chụp nhẫn trong tủ kính | Sổ nợ, phiếu cầm, hỏi Bửu khoản nợ |
| `scene-px-hieu-anh` Hiệu ảnh Tô Khánh | isometric | Tô Khánh | Ghép lá thư trắng + thuốc hiện ảnh → thư hẹn 21:00. Hũ keo ép ảnh. Lời khai buồng tối mở sau reveal "một giờ". | Ba vật, thư hẹn, sự kiện ngoại phạm, hỏi Khánh chuyện bến đò |

Vật phẩm được vẽ thẳng vào ảnh nền (cột đồng hồ, lọ thuốc trên bàn nước...). Hotspot đặt lên đúng chỗ vật trong ảnh, `itemPlacements[].asset` để rỗng. Icon túi đồ cắt từ tấm icon (bước 7).

## Tài nguyên được tạo thế nào

Tổng cộng **36 lượt gọi PixelLab, 297 generations**, mỗi tài nguyên tạo một lần, không có receipt nào cho lượt tạo lại. Chi tiết từng request, kể cả prompt đầy đủ, ở [pixellab-requests.json](pixellab-requests.json).

| Bước | Tool | Kích thước | Request | Generations |
| --- | --- | --- | --- | --- |
| 1 Bản đồ ngoài trời | `create_image_pro` | 512×512, seed 707 | 1 | 25 |
| 2 Sprite mặt trước | `create_image_pro` + tham chiếu Sherlock | 96×96, 4 ứng viên | 7 | 70 |
| 2 Xoay 8 hướng | `create_character` v3 | 96×96, low top-down | 7 | 14 |
| 3 Watson đi bộ | `animate_character` v3 | 8 khung × 4 hướng | 4 | 8 |
| 3 Watson idle | `animate_character` v3 | 8 khung × 4 hướng | 4 | 8 |
| 3 NPC idle | `animate_character` v3 | 8 khung, chỉ south | 6 | 12 |
| 4 Chuyển động môi trường | — | không dùng | 0 | 0 |
| 5 Mask vật thể | `edit_image` (Edit Image Pro) | 512×512 | 1 | 25 |
| 6 Xử lý cục bộ | `build_assets.py` | — | 0 | 0 |
| 7 Nội thất | `create_image_pro` + ngoại thất | 512×512, seed 707 | 5 | 125 |
| 7 Tấm icon | `create_image_pro` + style image | 256×256, lưới 4×4 | 1 | 10 |

### 1. Bản đồ ngoài trời

`create_image_pro` 512×512, `no_background: false`, seed 707, không khóa bảng màu. Job `42741c32-149d-4c36-aaa9-e77e592b4899`, asset `de40caf4-5451-5fe2-9de7-34a016d39c29`, 25 generations. Prompt mở bằng "Top-down, front-facing pixel art map, not isometric.", tả khu phố bờ sông buổi sáng, quảng trường có cột đồng hồ và bốn tòa nhà có cửa trước rõ ràng. Nhà xe gắn vào hông nam nhà số 7, nên 5 nội thất chỉ cần 4 tòa nhà. Không người, không chữ.

Kết quả `map-512.png`. Bản phóng `map-2048-nearest-x4.png` và năm crop ngoại thất được làm cục bộ.

### 2. Nhân vật

Mỗi nhân vật mới qua hai request:

1. `create_image_pro` 96×96, `no_background: true`, seed 707: sprite mặt trước nhìn thẳng hướng south. Ảnh tham chiếu là sprite Sherlock V3 96 hướng south, kèm usage "art style reference only ... do NOT copy his face, hat, coat or identity". Mỗi job trả 4 ứng viên, 10 generations.
2. `create_character` mode v3 (receipt ghi `v3 reference`), 8 hướng, tham chiếu là ứng viên nhìn thẳng đã chọn. 2 generations. Kết quả 96×96, low top-down.

| Key | Nhân vật | Job mặt trước | Ứng viên chọn | `character_id` | Job idle south |
| --- | --- | --- | --- | --- | --- |
| watson | Dr. John Watson (người chơi INTERROGATOR) | `e4aab0ce-60f0-4d79-a9db-f3e9419b1776` | front-0 | `1d31d2ec-5be3-4d26-995e-3d4a6946e682` | 4 hướng, xem bước 3 |
| lam-the-bao | Lâm Thế Bảo | `135f4c3c-0716-4a76-b8e0-21036c365255` | front-0 | `88c1a125-b78c-45ca-992a-19b227679aee` | `7e68c441-e505-42c1-b5fe-c164f946186c` |
| ly-hanh | Lý Hạnh | `fc73c310-cd11-4cce-9398-294d5a6cfa8e` | front-2 | `a312e82f-946b-43d0-997f-e2f4bee4c670` | `496fbb90-0948-4931-bb42-b609d9834cc7` |
| trinh-luc | Trịnh Lực | `9ae58b2f-f673-4d8e-976e-9045c444ca90` | front-0 | `628a9ad5-fbd3-492d-afa8-1165185dd083` | `bc2c3b57-60bb-4241-b11d-e4ebbbeca033` |
| to-khanh | Tô Khánh | `c283618a-0553-4194-b7f5-42799fcfc18f` | front-0 | `678085c3-9d51-404b-8c5f-bf02ccdccf27` | `1038c292-fa9c-42a3-935e-86c244ea536a` |
| dang-buu | Đặng Bửu | `23f9f9a6-825f-4edd-b28d-85627ba113d2` | front-0 | `e18fac38-bc69-465c-ac58-d189de0f94ea` | `e30fb539-a88f-42a9-a6cc-7a41f2cb4889` |
| hoc-viec | Phạm Tùng | `3dcbc68c-5c8c-4071-9031-83c610749be5` | front-2 | `c965e3bd-e07d-4743-86ae-1bb7356ecb37` | `53964587-ce3b-45d3-820b-c9682ba27f90` |

Sherlock V3 96 đã có sẵn nên không tạo. Watson V3 96 được tạo cho case này và từ nay là sprite người chơi chung.

### 3. Animation

Tất cả dùng `animate_character` mode v3, 8 khung, cùng câu action với animation của Sherlock V3 96.

- Watson đi bộ: action `walking`, `keep_first_frame: false`, nhóm `27924b56-976f-4081-bd5e-4194a6efe104`. Job south `1b8e032f-0b50-4fb7-ac45-4b6ba26e50ed`, east `8a1eb31b-048c-4e8c-90a0-72ad26b4067c`, north `b54cd097-a258-4ecd-9cb0-a551702a476b`, west `8bfc5dc4-9f89-4097-9294-1c0884f75a86`. 8 generations.
- Watson idle: action thở ("Inhale slowly to expand the chest subtly while dropping the shoulders slightly, then exhale to settle the torso back to the starting resting posture."), `keep_first_frame: true`, nhóm `f3a67e38-2979-4f2d-b981-676c12fa79b7`. Job south `0f9eaf74-9b52-4cb6-9ead-a08d4242ae3a`, east `786895be-8904-4eda-b384-027471fa4253`, north `3fae2a01-a548-4f74-bd13-ec2e3e839365`, west `84d3c6b3-be51-406f-9cc5-365d4fb6165b`. 8 generations.
- Sáu NPC: cùng action thở, chỉ hướng south (`npc_idle_south`), 2 generations mỗi NPC. Job ở bảng trên, nhóm animation ở `pixellab-requests.json`.

Sheet export: hàng 0 là 8 rotations, hàng animation idle có 9 khung (khung đầu + 8 khung mới). `build_assets.py` chép lại vào ô 128 px. Strip idle NPC ở `characters/<key>-idle.png`. Chân dung hội thoại là rotation south phóng ×3 (288 px), không phải ảnh AI riêng.

### 4. Chuyển động môi trường

Không dùng trong case này.

### 5. Mask vật thể

`edit_image` (Edit Image Pro) trên đúng bản đồ native 512 (`.../images/42741c32-.../download?index=0`), không phóng to, không nhân vật. Prompt: vật thể rắn TRẮNG, nền trống (kể cả mặt sông) ĐEN, chỉ đen/trắng. Job `3a12d723-f6b6-4e61-9ef0-100a8f9c7177`, 25 generations. Kết quả `mask-raw.png` có 28 mức xám nên được lấy ngưỡng 128.

### 6. Xử lý cục bộ (không AI)

`build_assets.py` đọc `scenes_spec.py` (toạ độ native) và sinh ảnh public cùng dữ liệu runtime. Cách tính ở mục [Bố cục runtime](#bố-cục-runtime-được-suy-ra-thế-nào). Ảnh nội thất `-cut.png` là ảnh gốc với vùng ngoài khối phòng làm trong suốt. Chỉ các pixel ngoài phòng bị đổi.

### 7. Nội thất và icon

Mỗi nội thất: crop tòa nhà từ `map-512.png` native, upload, rồi `create_image_pro` 512×512 seed 707 kèm `reference_images` usage "exterior of the same building: use only for its identity, materials, colours and pixel-art style; do not copy the outdoor camera". Prompt cố định: isometric 2:1, một sàn và hai tường sau, mặt trước mở, ngưỡng cửa trống, không người, không chữ. 25 generations mỗi phòng.

| Ảnh | Cảnh | Crop native (x0,y0)–(x1,y1) | Upload | Job |
| --- | --- | --- | --- | --- |
| nha-so-7 | `scene-px-nha-so-7` | (0,82)–(196,300) | `8b9e002b-f73a-4b6c-9dd8-654d85d788e6` | `39282314-ff6f-40fd-86a0-4e2734f19952` |
| hieu-thuoc | `scene-px-hieu-thuoc` | (364,54)–(512,300) | `4470f586-9a1e-414c-a22f-5992d9ce090e` | `5d9b85ec-39d6-4202-8061-755cb119d9d5` |
| nha-xe | `scene-px-nha-xe` | (0,310)–(100,512) | `fcd2f820-a950-41ca-a75b-34e9f626376d` | `d9b98098-bb52-48f6-ab94-b48002a40c69` |
| tiem-cam-do | `scene-px-cam-do` | (96,328)–(248,500) | `5b2f3fa5-d64b-48e8-9861-ed83edaf4ec7` | `73225d87-3de6-4aa6-b856-f517c68683cb` |
| hieu-anh | `scene-px-hieu-anh` | (332,322)–(512,512) | `66f2c504-d009-4ee6-a0a8-b0a1ab299fb0` | `37fe2bb0-f628-4151-b7e4-e742c82f0e2d` |

Toạ độ crop xác định lại bằng so khớp pixel giữa `crop-<key>.png` và `map-512.png`.

Tấm icon: `create_image_pro` 256×256, `no_background: true`, seed 707, `style_image_url` là nội thất nhà số 7 (job `39282314-...`). Prompt xếp 16 vật vào lưới 4×4 ô 64 px. Job `d851e5d7-038d-4271-8335-9581275a5e88`, 10 generations. Thứ tự ô (trái sang phải, trên xuống dưới) đã đối chiếu pixel với 16 icon cắt ra:

| Hàng | Ô 1 | Ô 2 | Ô 3 | Ô 4 |
| --- | --- | --- | --- | --- |
| 1 | kinh-lup | lo-thu-nam | phieu-nhan-thuoc | so-xe |
| 2 | so-no | phieu-cam | la-thu-trang | thuoc-hien-anh |
| 3 | la-thu-hien-chu | keo-ep-anh | hop-nu-trang | so-tay |
| 4 | nhan-ngoc-bich | di-chuc | hop-thuoc-tuan | chia-khoa |

### 8. Đưa vào game

`build_case.py` ghép cốt truyện với `scene-runtime.json` thành case JSON. Phaser vẽ nền bằng nearest-neighbour. Cửa là `runtime.transitions`, điểm xuất hiện sau khi qua cửa là `spawnPoints["from:<sceneId>"]`. Ảnh bìa là dải y 96–384 của bản đồ, phóng ×2 thành 1024×576.

## Bố cục runtime được suy ra thế nào

Đơn vị runtime = pixel native × `pixelScale` 4. Ảnh 512 thành khung runtime 2048×2048. Lưới đi có 128×128 ô, mỗi ô 4 px native = 16 đơn vị runtime. Định dạng từng trường xem [SCENE_RUNTIME_SCHEMA.md](../SCENE_RUNTIME_SCHEMA.md#pixel-render-mode-runtimerender).

| Cảnh | projection | cameraZoom | actorScale | walkSpeed | interactRadius | backdropColor | foreground |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pho | topdown | 1.0 | 1.5 | 300 | 120 (30 px native) | `#3c4a55` | 8 |
| 5 nội thất | isometric | 0.5 | 4 | 520 | 104 (26 px native) | `#11100e` | 0 |

**Lưới đi ngoài trời** (`pho`), theo thứ tự:

1. Ô đi được ban đầu là vùng đen của mask, ngưỡng 128.
2. Chặn dải sông và lan can ở mép bắc, y < 84 px native.
3. Với 8 vật che (4 cột đèn, cột đồng hồ, cây, xe đẩy, xe ngựa): mở silhouette của vật để người chơi đi được phía sau. Phần chân vật bị chặn lại sau bước co lưới.
4. Gộp thành ô 4×4 px. Ô đi được khi có ít nhất 12/16 px đi được. Co lưới 2 ô ngang, 1 ô dọc.
5. Khoét lại 8 vùng: sàn cầu tàu, bậc cửa nhà số 7, ngưỡng cửa ba cửa hiệu, lối trước cửa nhà xe, vỉa hè dưới tán cây.
6. Chặn chân vật che, chặn quanh bàn chân NPC (14×8 px).
7. Chỉ giữ thành phần liên thông chứa spawn `default`, để người chơi không rơi vào "đảo".

**Lưới đi trong nhà:** chưa có mask PixelLab cho nội thất. Sàn là đa giác thoi 4 điểm vẽ theo ảnh. Trừ đi 6–9 khối đồ đạc (rect hoặc poly) đặt tay, ví dụ lò sưởi, tủ kính, bàn viết, ghế bành. Ô cần đủ 16/16 px, co lưới 1×1, chặn chân NPC, giữ thành phần chính.

**Vật che (foreground):** mỗi vật có `box` (vùng cắt) và `foot` (vùng chạm đất). Cut-out lấy RGB từ bản đồ và alpha từ mask trong `box`. Riêng cây được cắt bỏ phần mép tòa nhà bên trái. `baseY` = cạnh dưới của `foot` × 4. Khi bàn chân người chơi có y < `baseY`, cut-out được vẽ đè lên người chơi.

**Điểm tiếp cận:** là ô đi được gần nhất với trung điểm cạnh dưới của hotspot (vật, khám xét, cửa). FE tính lại bằng `gridApproachPoint`. Với NPC, điểm tiếp cận là ô gần nhất ngay dưới chân. Khi build có kiểm tra: mọi spawn nằm trong thành phần chính, mọi điểm tiếp cận tồn tại và cách hotspot không quá 240 px native (khoảng cách Manhattan), NPC với tới được trong 60 px.

**Cửa và spawn:**

- Bản đồ có 5 vùng cửa trước 5 tòa nhà. Mỗi nội thất có một vùng cửa ở ngưỡng phía trước, dẫn ra `scene-px-pho`.
- Ngoài trời, `spawnPoints["from:scene-px-<phòng>"]` đặt ngay trước cửa phòng vừa ra. Trong nhà, `from:scene-px-pho` trùng spawn `default` ở ngưỡng cửa.
- `INVESTIGATOR`/`INTERROGATOR` lệch ±18 px native ngoài trời, ±14 px trong nhà.

**NPC:** đặt theo điểm chân. Kích thước 128 × actorScale (192 ngoài trời, 512 trong nhà). Hotspot thân 36×86 px sprite × actorScale. `presentation.spriteSheet` là strip idle 9 khung, ô 128 px, `anchorY` = đường chạm đất / 128.

**Camera:** hai vùng ảnh chụp là tem niêm trên lọ (nhà số 7) và nhẫn trong tủ kính (tiệm cầm đồ). Khung chụp 200×156 ngoài trời, 360×280 trong nhà.

## Seed vào game

1. Chạy backend và frontend như bình thường, đăng nhập tài khoản admin.
2. Mở Admin dashboard, bấm **"Tạo vụ án pixel"** (tiếng Anh: "Seed pixel case").
3. Nút gọi `POST /api/admin/cases/seed-pixel-demo`. Backend đọc `SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json`, validate, ghi đè ở trạng thái DRAFT rồi publish. Toast báo "1 pixel case(s) seeded and published."

Gọi API trực tiếp (cần token admin):

```bash
curl -X POST -H "Authorization: Bearer <admin-token>" http://localhost:<api-port>/api/admin/cases/seed-pixel-demo
```

Test tự động:

```powershell
dotnet test SirLocked.sln --filter FullyQualifiedName~PixelCaseTests
cd src/FE
# cần API loopback đã seed bằng tools/FullStackTestSeeder
$env:SIRLOCKED_RUN_PIXEL_FULL_STACK='true'; $env:SIRLOCKED_TEST_API_URL='http://localhost:5215'
$env:SIRLOCKED_TEST_PASSWORD='...'; $env:SIRLOCKED_TEST_CASE_PATH='../BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json'
$env:SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER='1'; npx playwright test tests/pixel-case-full-stack.spec.ts
```

### Kiểm tra thủ công

1. Seed như trên. Mở danh sách case, thấy "Lọ thuốc thứ Năm" đã publish.
2. Hai tài khoản vào cùng phòng, chọn hai vai khác nhau, bắt đầu. Cả hai xuất hiện ở quảng trường, cạnh nhau, không chồng lên nhau.
3. Đi quanh quảng trường bằng phím. Camera bám theo người chơi, ảnh nét (không mờ). Không đi được xuống sông, chỉ ra được sàn cầu tàu.
4. Đi ra sau cột đèn hoặc cột đồng hồ: thân cột phải che người chơi. Đi ra trước: người chơi đè lên cột. Không đi xuyên qua chân cột.
5. Thẩm vấn viên (Watson) lại gần bà Hạnh cạnh cổng nhà số 7, hỏi chuyện sáng nay. Cửa nhà số 7 mở.
6. Vào nhà số 7: người chơi xuất hiện ở ngưỡng cửa phòng. Đi quanh, không đi xuyên lò sưởi, tủ kính, bàn, ghế bành.
7. Ra lại phố: người chơi đứng ngay trước cửa nhà số 7, không về giữa quảng trường.
8. Lặp lại bước 6–7 với bốn cửa hiệu khi lần lượt được mở. Mỗi NPC đứng yên, thở nhẹ, quay mặt về phía nam.
9. Mở túi đồ: icon kính lúp, sổ xe, phiếu cầm... hiện đúng hình.
10. Chơi đến cáo buộc cuối (Lâm Thế Bảo; động cơ di chúc; phương thức keo ép ảnh) và thấy kết thúc thắng.

## Dựng lại kế hoạch request từ case JSON

```bash
node scripts/build_pixellab_requests.mjs src/BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json tmp/pixellab-plan.json
```

Kết quả: 26 request, ước tính 269 generations. Không có Watson vì người chơi đã có sẵn; thêm `--players` thì có đi bộ + idle cho cả hai người chơi, cộng 32. Case này chưa có `visualDescription` tiếng Anh nên kế hoạch còn 31 chỗ `{{...}}` cần điền. Đây là chủ ý: builder không tự dịch tên hay mô tả tiếng Việt vào prompt.

## Hạn chế đã biết

- Watson đi về hướng west: vài khung mất túi bác sĩ.
- NPC chỉ có idle hướng south, nên luôn quay mặt về phía nam. Người chơi tự quay mặt về phía NPC/đồ vật khi tương tác và đứng cạnh NPC (không đè lên). `characterPlacements[].direction` (`left`) không có tác dụng ở pixel mode.
- Mật độ pixel ngoài trời không đồng đều: bản đồ ×4, nhân vật ×1.5, giống prototype SceneTest. Trong nhà đồng đều: phòng ×4, nhân vật ×4, `cameraZoom` 0.5.
- Nội thất chưa có vật che. Người chơi luôn được vẽ đè lên đồ đạc khi đứng sát phía sau. Lưới đi trong nhà là khối đặt tay, chỉ gần đúng mép đồ đạc.
- Mask không thuần đen trắng và có ngoại lệ. Phải chặn tay vùng sông và khoét tay các ngưỡng cửa.
- Năm prompt mặt trước NPC có tên tiếng Việt có dấu, không phải ASCII. Kết quả vẫn dùng được, nhưng builder mới để tên ngoài prompt.
- Ref upload ngoại thất (`upload:<id>`) hết hạn sau 3 ngày. Muốn tạo lại nội thất thì upload lại từ `crop-<key>.png`.
- URL tham chiếu Sherlock có tham số `?t=`. Bản sao cục bộ ở `art/chars/sherlock-south.png`.
- Tấm icon có 3 icon chưa vật phẩm nào dùng: `nhan-ngoc-bich`, `di-chuc`, `chia-khoa`. Ảnh vẫn nằm trong `items/`.
