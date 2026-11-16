# Màn tân thủ "Nhập môn: Ấm men lam"

Vụ pixel cực dễ để dạy cách chơi. Thượng Hải 1930, chơi một mình, khoảng 10 phút. Cảnh và vật lấy lại từ thư viện Đợt 0 (0 lượt). 4 NPC vẽ mới theo chuẩn PixelLab (56 lượt, 17/11/2026).

## Cốt truyện

Chiếc ấm men lam đời Minh của trà lâu Vọng Nguyệt biến mất khỏi khay trà trên quầy trong mười phút ông Lưu vào kho. Thủ phạm là ngài Hamilton, nhà sưu tầm người Anh: hôm qua trả 500 đồng mà không mua được.

| Cảnh | Ảnh gốc (thư viện) | Có gì |
| --- | --- | --- |
| Trà lâu Vọng Nguyệt (trong nhà, isometric, không mưa) | `c-room-tra-lau` | Ông Lưu, cô Tô Mỹ Lan, sổ khách, thư xé (giải đố `torn_paper`), khay trà (chụp ảnh) |
| Ngõ Thạch Khố Môn (ngoài trời, mưa phùn) | `c-map-ngo-thach-kho-mon` | A Phúc phu xe kéo, ngài Hamilton, hòm gỗ trên xe kéo |

Nhân vật: 4 NPC PixelLab vẽ theo quy trình chuẩn `ai-game-docs/visual-style-templates/pixellab` (mặt trước có ảnh Sherlock làm mẫu → `create_character` v3 → idle thở v3 9 khung), cùng phong cách với Sherlock, Watson và NPC vụ Lò thuốc. ID PixelLab ghi trong `build_assets.py`. Bản đầu dùng NPC chibi của thư viện Đợt 0 (to và bè hơn Sherlock) nên đã thay. Chân dung 288×288 là hướng south 96×96 phóng ×3. Icon ấm men lam vẽ bằng code (`draw_teapot.py`).

Nhạc: `thuong-hai-tra-lau` (trong nhà), `thuong-hai-ngo-thach-kho-mon` (ngoài ngõ). Mỗi nhân vật một tiếng bíp riêng. Đủ gợi ý 3 mức cho 2 cảnh, lần đối chất, và 3 gợi ý trong câu đố.

## Dạy những gì (theo thứ tự hướng dẫn)

Hai vai và nút Đổi nhân vật (phím Q, chỉ màn tân thủ có) → đi lại → Sherlock hỏi ông Lưu → hỏi thêm → đổi sang Watson, khám sổ khách → chụp ảnh khay trà → ghép thư xé (vai nào cũng được) → mở Hồ sơ vụ án (dùng chung) → đổi lại Sherlock, hỏi cô Mỹ Lan → bấm Gợi ý → ra ngõ (mưa) → hỏi A Phúc → Watson mở hòm gỗ → xem Túi đồ (chỉ Watson) → Sherlock hỏi ngài Hamilton → vạch lời nói dối bằng sổ khách → lập cáo buộc.

Các bước nằm ở `src/FE/Client/js/game/tutorialSteps.ts`; thẻ hướng dẫn và mũi tên vàng ở `tutorialCoach.ts`.

## Dựng lại

```bash
python3 ai-game-docs/pixel-case-tan-thu/build_assets.py <thư mục files của thư viện Đợt 0> <thư mục 4 zip NPC: ong-luu.zip, co-lan.zip, hamilton.zip, a-phuc.zip> src/FE/public/assets/pixel/tan-thu
python3 ai-game-docs/pixel-case-tan-thu/build_case.py
```

`build_case.py` ghi `src/BE/SeedData/V3/case-pixel-tan-thu-vi.json` và `src/BE/SeedData/Cutscenes/case-pixel-tan-thu-vi.intro.json`. Vùng đi được của hai cảnh ở `walk.py` (tọa độ native 512).
