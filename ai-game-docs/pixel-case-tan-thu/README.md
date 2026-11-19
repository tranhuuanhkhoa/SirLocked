# Màn tân thủ "Nhập môn: Ấm men lam"

Vụ pixel cực dễ để dạy cách chơi. Thượng Hải 1930, chơi một mình, khoảng 10 phút. Cảnh lấy lại từ thư viện Đợt 0. 4 NPC vẽ mới theo chuẩn PixelLab (56 lượt, 17/11/2026). Mặt quầy trà lâu và hòm gỗ vẽ thêm vào cảnh bằng inpaint PixelLab (hai bản được chọn: 16 lượt).

## Cốt truyện

Chiếc ấm men lam đời Minh của trà lâu Vọng Nguyệt biến mất khỏi khay trà trên quầy trong mười phút ông Lưu vào kho. Thủ phạm là ngài Hamilton, nhà sưu tầm người Anh: hôm qua trả 500 đồng mà không mua được.

| Cảnh | Ảnh gốc (thư viện) | Có gì |
| --- | --- | --- |
| Trà lâu Vọng Nguyệt (trong nhà, isometric, không mưa) | `c-room-tra-lau` | Ông Lưu, cô Tô Mỹ Lan, trên mặt quầy: thư xé (giải đố `torn_paper`), sổ khách bìa đỏ đang mở, khay trà (chụp ảnh) |
| Ngõ Thạch Khố Môn (ngoài trời, mưa phùn) | `c-map-ngo-thach-kho-mon` | A Phúc phu xe kéo, ngài Hamilton, hòm gỗ trên xe kéo |

Nhân vật: 4 NPC PixelLab vẽ theo quy trình chuẩn `ai-game-docs/visual-style-templates/pixellab` (mặt trước có ảnh Sherlock làm mẫu → `create_character` v3 → idle thở v3 9 khung), cùng phong cách với Sherlock, Watson và NPC vụ Lò thuốc. ID PixelLab ghi trong `build_assets.py`. Bản đầu dùng NPC chibi của thư viện Đợt 0 (to và bè hơn Sherlock) nên đã thay. Chân dung 288×288 là hướng south 96×96 phóng ×3. Icon ấm men lam vẽ bằng code (`draw_teapot.py`).

Nhạc: `thuong-hai-tra-lau` (trong nhà), `thuong-hai-ngo-thach-kho-mon` (ngoài ngõ). Mỗi nhân vật một tiếng bíp riêng. Đủ gợi ý 3 mức cho 2 cảnh, lần đối chất, và 3 gợi ý trong câu đố.

## Đồ vật trong cảnh

Giống vụ Lò thuốc thứ Năm và Trâm hồng ngọc: vật điều tra nằm sẵn trong ảnh cảnh, không dán sprite lên.

**Mẫu chuẩn cho Claude MCP và bot.** Vật nên tạo trước, tức là ghi trong mô tả cảnh khi PixelLab vẽ cảnh. Cảnh đã có mà muốn thêm vật thì inpaint cho chuẩn:
- tô mask tự do **rộng theo cả mặt vật nằm lên** (cả mặt quầy), không ôm sát một vật;
- description kể **mọi** vật phải có trên mặt đó;
- chỉ chép lại đúng pixel trong mask.

Lần đầu tô một ô nhỏ 26×17 quanh cuốn sổ thì PixelLab chỉ vẽ được cuốn sổ bé xíu (bản 17/11 sáng, đã thay).

| Vật | Trong ảnh | Ô bấm (runtime) |
| --- | --- | --- |
| Mặt quầy trà lâu: thư xé, sổ khách, khay trà | Một lần `inpaint_image` (Inpaint Pro v3) trên crop 256 của trà lâu, mask đa giác phủ cả mặt quầy (`inpaint/tra-lau-quay-mask.png`). Cái cân cũ nằm trong mask nên được vẽ lại thành mặt quầy mới; đỉnh cân sót ngoài mask được xóa ở bước `cleanup` | thư xé `448, 1264, 116×100`; sổ khách `564, 1224, 292×180`; khay trà (vùng chụp ảnh) `804, 1176, 176×132` |
| Hòm gỗ (chứa ấm men lam) | `inpaint_image_pro_flash` trên crop 128 của ngõ, mask phủ cả mặt ghế xe kéo: hòm gỗ đai sắt | `1280, 828, 96×84` |

- Ô bấm lấy từ `inpaint/recipe.json` (`items`, `clueZones`, pixel native x 4). `build_case.py` đọc thẳng file này.
- `runtime.itemPlacements[].asset` để rỗng. Ô bấm phủ đúng chỗ vật trong ảnh, `position` là giữa cạnh dưới ô bấm.
- `items[].imageUrl` chỉ là icon cho túi đồ và thẻ vật.
- Ảnh PixelLab trả về, mask và công thức (crop, đa giác, description, job ID, số lượt) ở `inpaint/`. `scene_patches.py` chỉ chép đúng pixel trong mask vào cảnh thư viện vừa chép, pixel ngoài mask giữ nguyên (trừ `cleanup` ghi rõ).
- Hòm gỗ nằm lại trên xe sau khi nhặt: vật nhặt được là chiếc ấm bên trong.

## Dạy những gì (theo thứ tự hướng dẫn)

Hai vai và nút Đổi nhân vật (phím Q, chỉ màn tân thủ có) → đi lại → Sherlock hỏi ông Lưu → hỏi thêm → đổi sang Watson, khám sổ khách → chụp ảnh khay trà → ghép thư xé (vai nào cũng được) → mở Hồ sơ vụ án (dùng chung) → đổi lại Sherlock, hỏi cô Mỹ Lan → bấm Gợi ý → ra ngõ (mưa) → hỏi A Phúc → Watson mở hòm gỗ → xem Túi đồ (chỉ Watson) → Sherlock hỏi ngài Hamilton → vạch lời nói dối bằng sổ khách → lập cáo buộc.

Các bước nằm ở `src/FE/Client/js/game/tutorialSteps.ts`; thẻ hướng dẫn và mũi tên vàng ở `tutorialCoach.ts`.

## Dựng lại

```bash
python3 ai-game-docs/pixel-case-tan-thu/build_assets.py <thư mục files của thư viện Đợt 0> <thư mục 4 zip NPC: ong-luu.zip, co-lan.zip, hamilton.zip, a-phuc.zip> src/FE/public/assets/pixel/tan-thu
python3 ai-game-docs/pixel-case-tan-thu/build_case.py
```

`build_assets.py` chép cảnh thư viện rồi gọi `scene_patches.py` để vẽ lại mặt quầy và hòm gỗ vào cảnh. Chỉ cần vẽ lại vật và bìa thì chép lại hai cảnh thư viện (`c-room-tra-lau`, `c-map-ngo-thach-kho-mon`) vào `scenes/` rồi chạy `python3 ai-game-docs/pixel-case-tan-thu/scene_patches.py src/FE/public/assets/pixel/tan-thu`. Chạy trên cảnh đã vá vẫn ra cùng kết quả.

`build_case.py` ghi `src/BE/SeedData/V3/case-pixel-tan-thu-vi.json` và `src/BE/SeedData/Cutscenes/case-pixel-tan-thu-vi.intro.json`. Vùng đi được của hai cảnh ở `walk.py` (tọa độ native 512).
