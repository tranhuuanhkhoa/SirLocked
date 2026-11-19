# Template PixelLab cho case pixel

[templates.json](templates.json) gom câu chữ prompt, tham số cố định, cách dùng ảnh tham chiếu và chi phí cho từng bước của quy trình pixel. Câu chữ lấy từ các request đã chạy tốt ở case [Lọ thuốc thứ Năm](../../pixel-case-lo-thuoc-thu-nam/README.md). Mỗi template có `example`: điền `example.values` vào template phải ra **đúng nguyên văn** prompt đã gửi trong [pixellab-requests.json](../../pixel-case-lo-thuoc-thu-nam/pixellab-requests.json). Test `scripts/build_pixellab_requests.test.mjs` kiểm tra điều này.

`scripts/build_pixellab_requests.mjs` đọc tệp này để dựng kế hoạch request cho một case. Sửa câu chữ ở `templates.json` thì builder đổi theo.

Server cũng đọc đúng tệp này (nhúng vào API lúc build, `PixelLabPlanBuilder`) để dựng kế hoạch request cho bản nháp AI pixel (VUAN-6B, `PUT /api/bridge/drafts/{id}/asset-plan`): chỉ chủ thể bot khai là mới (`PIXELLAB`) mới ra request; hình thư viện và biến thể 0 lượt. Cảnh thư viện hoặc biến thể có `inpaintItems` thì mỗi vật thành một request `item-inpaint`. Mục `glossaries` (từ khóa tiếng Việt → bản nháp tiếng Anh) dùng chung cho cả hai. File golden `src/BE/Tests/Fixtures/pixellab-plan-dong-ho.golden.json` giữ hai builder ra cùng prompt: sửa câu chữ có chủ ý thì chạy `UPDATE_PIXELLAB_GOLDEN=1 node --test scripts/build_pixellab_requests.test.mjs` rồi chạy test C#.

## Quy trình và template

Làm theo đúng thứ tự. Bước sau dùng kết quả của bước trước: ID nhân vật, URL ảnh, crop ngoại thất.

| Bước | Template | Tool | Dùng khi | Chi phí (generations) |
| --- | --- | --- | --- | --- |
| 1 | `outdoor-map` | `create_image_pro` 512×512 | Luôn làm đầu tiên: một ảnh cho cả khu ngoài trời | 25 |
| 2 | `character-front` | `create_image_pro` 96×96 | Nhân vật **mới**: vẽ sprite mặt trước nhìn thẳng hướng south, 4 ứng viên | 10 |
| 2 | `character-rotate` | `create_character` v3, 8 hướng | Sau khi chọn ứng viên nhìn thẳng | 2 |
| 3 | `character-walk` | `animate_character` v3, 8 khung | Chỉ cho nhân vật người chơi, 4 hướng chính | 2/hướng (8) |
| 3 | `character-idle` | `animate_character` v3, 8 khung | NPC: một hướng đang đứng. Người chơi: 4 hướng | 2/hướng |
| 4 | `ambient-animation` | `animate_image` | Tùy chọn: nước, đài phun, cờ. **Chưa có lần chạy đối chứng** | chưa đo |
| 5 | `object-mask` | `edit_image` (Edit Image Pro) 512×512 | Sau khi bản đồ đã chốt | 25 |
| 6 | `local-layers` | không AI | Sửa mask, cắt vật che, `baseY`, lưới đi | 0 |
| 7 | `interior` | `create_image_pro` 512×512 + `reference_images` | Mỗi cảnh isometric một ảnh | 25 |
| 7 | `item-inpaint` | `inpaint_image` (Inpaint Pro v3) khung ≤256 + `mask_image` tự do | Cảnh thư viện/biến thể chưa có vật điều tra: vẽ thêm vật vào cảnh, mask rộng theo cả mặt vật nằm lên, một lần cho cả cảnh | 10 (mặt rộng hơn 208 px: khung 512, 25) |
| 7 | `icon-sheet` | `create_image_pro` 256×256 + `style_image_url` | Icon túi đồ, tối đa 16 vật mỗi tấm | 10 |
| 8 | `integrate` | không AI | Ghi `runtime.render`, cửa và spawn vào case JSON | 0 |

Ước tính cho một case gồm 1 bản đồ, N NPC mới, R phòng, S tấm icon, V vật vẽ thêm vào cảnh có sẵn:
25 + 14×N + 25 + 25×R + 10×S + 10×V (V: số cảnh cần vẽ thêm vật). Case mẫu có N = 6, R = 5, S = 1, tổng 269. Thêm Watson mới (front + rotate + đi bộ + idle 4 hướng) thì cộng 28.

## Quy tắc bắt buộc

- **Bản đồ và phòng không có người, động vật hay chữ.** Câu "No people, no animals, no readable text" luôn nằm trong prompt. NPC là sprite riêng. Biển hiệu không chữ.
- **Prompt là tiếng Anh ASCII, không có tên nhân vật.** Tên, chức danh, mô tả tiếng Việt chỉ nằm ở metadata. Mô tả hình ảnh tiếng Anh lấy từ các trường `visualDescription` của case.
- **Câu camera bản đồ giữ ngắn:** `Top-down, front-facing pixel art map, not isometric.` Không khóa bảng màu.
- **Nhân vật mới: vẽ mặt trước nhìn thẳng hướng south trước, rồi mới xoay.** Tham chiếu là sprite Sherlock V3 96 hướng south, usage chỉ lấy phong cách: "art style reference only ... do NOT copy his face, hat, coat or identity". Chọn ứng viên nhìn thẳng. Ứng viên nghiêng làm 8 hướng lệch.
- **Không tạo lại Sherlock và Watson.** Hai nhân vật người chơi đã có sẵn ở PixelLab và trong `/assets/pixel/players/`.
- **Idle dùng đúng câu action thở của Sherlock.** NPC chỉ cần idle theo hướng đang đứng.
- **NPC thư viện chung cũng đi đúng ba bước trên** (`character-front` → `character-rotate` → `character-idle`, 14 lượt mỗi NPC).
  - Không tạo thẳng bằng `create_character` từ chữ.
  - Không ghi "chibi", "large head" hay kiểu viền vào prompt.
  - Đi đúng quy trình thì ảnh tự ra đúng phong cách: tỉ lệ người thật như Sherlock, Watson và NPC vụ Lò thuốc. Người cao, người thấp, trẻ em là tùy nhân vật, đều trong khung 96×96. Khung 96×96 là trần, cùng khung với Sherlock và Watson V3 96, nên NPC không bao giờ to hơn hai nhân vật chính. Không khóa chiều cao theo pixel. Studio chỉ chặn hai thứ: sprite không phải 96×96 (`NPC_FORMAT`) và nhân vật PixelLab có prompt chibi/đầu to (`NPC_STYLE`).
  - Bộ mẫu phong cách Yen đã chốt (PixelLab, 96×96, 8 hướng): Sherlock V3 96, Watson V3 96, 6 NPC vụ Lò thuốc (Hoc Viec, Dang Buu, To Khanh, Trinh Luc, Ly Hanh, Lam The Bao), 4 NPC màn tân thủ (Tan Thu A Phuc, Tan Thu Hamilton, Tan Thu Co Lan, Tan Thu Ong Luu).
  - Đợt 0 (16/11) làm tắt (3 lượt mỗi NPC) nên ra kiểu chibi đầu to, mắt to. 39 NPC đó đã khóa (`retired`) trong `tools/studio-mcp/library/index.json`, chờ vẽ lại.
- **Mask và ảnh tham chiếu ngoại thất lấy từ bản đồ NATIVE 512**, không dùng bản phóng to. Ghép animation môi trường lại đúng toạ độ crop.
- **Nội thất:** isometric 2:1, một sàn + hai tường sau, mặt trước và ngưỡng cửa để trống, không NPC. Vật phẩm điều tra của cảnh phải có trong mô tả vì pixel mode vẽ vật vào nền.
- **Vật điều tra không bao giờ dán ảnh lên cảnh** (Yen chốt 17/11/2026). Dán icon hay ảnh vật lên bản đồ thì lệch phối cảnh và ánh sáng, nhìn rất xấu. Làm như vụ Lò thuốc thứ Năm và Trâm hồng ngọc:
  - **Vật nên tạo trước.** Cảnh vẽ mới: ghi mọi vật vào `visualDescription` của cảnh để PixelLab vẽ luôn (`outdoor-map`, `interior`).
  - Cảnh đã vẽ xong (thư viện, biến thể, hay cần thêm vật sau): `item-inpaint`, **inpaint cho chuẩn** theo tài liệu Inpaint Pro (`inpaint_image`, REST `POST /v2/inpaint-v3`; `mask_image` cùng cỡ ảnh, trắng = vẽ lại, đen = giữ, hình gì cũng được).
    - Mask tô **rộng theo cả mặt vật nằm lên** (cả mặt quầy, mặt bàn, ghế, kệ), không ôm sát vật.
    - `description` kể mọi vật phải có trên mặt đó, kể cả vật cũ muốn giữ, vì trong mask PixelLab vẽ lại hết.
    - Một request cho cả cảnh. Nhiều mặt thì dùng nhiều polygon, vẫn một mask nếu lọt một khung.
  - `asset_process inpaint_prep { scene, polygon | polygons | maskImage | rect, description }`:
    - cắt khung 128/256 (512 khi mặt quá rộng) từ cảnh NATIVE 512, làm `mask.png` tự do và context;
    - báo `MASK_TIGHT` khi mask nhỏ hơn 40×24.
  - Gửi PixelLab. `asset_process inpaint_merge { plan, result, boxes }` chỉ chép pixel trong mask vào cảnh, pixel ngoài mask giữ nguyên từng byte, rồi trả ô bấm từng vật.
  - Vật cũ trong mask có thể đổi chỗ hay mất: đo lại ô bấm và `clueZones`. Mẩu vật cũ sót ngoài mask thì xóa.
  - Trong case JSON: `itemPlacements[].asset` rỗng, ô bấm phủ đúng vật, `position` là giữa cạnh dưới ô bấm. `items[].imageUrl` chỉ là icon 64×64 cho túi đồ.
  - Mẫu đối chứng: màn tân thủ (`ai-game-docs/pixel-case-tan-thu/inpaint/recipe.json`).
    - Lần đầu tô ô nhỏ 26×17 quanh cuốn sổ: ra cuốn sổ bé xíu, Pro Flash còn ra vệt nhòe.
    - Làm lại bằng một mask đa giác phủ cả mặt quầy (`inpaint_image` khung 256, 10 lượt): ra đủ thư xé, sổ khách đang mở, khay trà, khớp phối cảnh.
    - Hòm gỗ trên xe kéo: mask phủ cả mặt ghế.
- **Lần tạo đầu theo yêu cầu thì chạy. Tạo lại hoặc reroll bằng AI phải hỏi chủ dự án trước.** Kể cả khi kết quả chưa đẹp: báo vấn đề, đề xuất sửa prompt, chờ đồng ý.
- **Giữ mọi thứ:** PNG gốc (cả 4 ứng viên), request đã gửi, receipt có job ID, character ID, animation group, chi phí. Bản gốc để ngoài `src/FE/public`.

## Placeholder

| Placeholder | Lấy từ đâu |
| --- | --- |
| `{{areaDescription}}` | `--map-description`, hoặc bản nháp từ tiêu đề/mô tả cảnh topdown (cần duyệt) |
| `{{layoutDetails}}` | `visualDescription` của cảnh topdown. Bắt buộc khi cảnh ngoài trời có vật phẩm |
| `{{buildingList}}` | Builder dựng từ các cảnh isometric. Loại tòa nhà đoán từ tiêu đề tiếng Việt (cần duyệt) |
| `{{characterAppearance}}`, `{{characterShortDescription}}` | `characters[].visualDescription` |
| `{{roomSubject}}` | Đoán từ tiêu đề cảnh, hoặc tiêu đề nếu là ASCII |
| `{{roomContents}}` | `visualDescription` của cảnh isometric |
| `{{itemVisual:<icon>}}` | `items[].visualDescription` |
| `{{styleReferenceUrl}}` | `--style-ref`, mặc định URL Sherlock V3 96 south trong `templates.json` |
| `{{frontCandidateUrl}}`, `{{characterId}}`, `{{mapImageUrl}}`, `{{exteriorCropRef}}`, `{{interiorImageUrl}}` | Kết quả của request trước (`inputsFromDependencies` trong kế hoạch) |

URL ảnh PixelLab có dạng `https://api.pixellab.ai/mcp/images/<job_id>/download?index=<n>`. Crop ngoại thất phải upload trước rồi dùng ref `upload:<id>`. Ref upload hết hạn sau vài ngày.

## Dựng kế hoạch cho một case

```bash
node scripts/build_pixellab_requests.mjs <case.json> <out.json> [--style-ref <url>] [--map-description <text>] [--players]
```

- Script không gọi PixelLab hay API nào, chỉ ghi kế hoạch. Chạy lại cùng đầu vào cho ra tệp giống hệt.
- `requests[]` theo thứ tự quy trình. Mỗi request có `id`, `step`, `tool`, `params`, `promptParam`, `prompt`, `references` (kèm `param` và `usage`), `dependsOn`, `estimatedGenerations`, `outputs`.
- `missingInputs` là chữ người viết phải điền. Cách tốt nhất là điền `visualDescription` tiếng Anh vào case JSON rồi chạy lại. `inputsFromDependencies` là ID/URL có được sau khi chạy request trước.
- `needsReview: true` khi builder dùng bản nháp đoán từ tiếng Việt.
- `localSteps` ghi bước 4 (tùy chọn), bước 6 và bước 8.
- Màn hình in tóm tắt: số request, số lượt gọi, số bản đồ, phòng, NPC, tấm icon và tổng generations ước tính.
- `--players` thêm đi bộ + idle 4 hướng cho Sherlock và Watson. Chỉ dùng khi thật sự cần làm lại animation người chơi.

Chạy test:

```bash
node --test scripts/build_pixellab_requests.test.mjs
```

## Trước khi gửi request

1. Không còn `{{...}}` trong `prompt`, `params`, `references`.
2. Prompt không có tên nhân vật, không có ký tự ngoài ASCII.
3. Tham số khớp `fixedParams`: kích thước, `no_background`, seed 707.
4. Ảnh tham chiếu đúng loại: Sherlock south cho mặt trước, ứng viên đã chọn cho xoay, crop native cho nội thất, một nội thất đã xong cho icon.
5. Đây là lần tạo đầu. Nếu là tạo lại, đã hỏi chủ dự án.
6. Có chỗ lưu request, receipt và PNG gốc ngay khi job xong.
