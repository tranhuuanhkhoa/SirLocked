# Màn tân thủ "Nhập môn: Ấm men lam"

Vụ pixel cực dễ để dạy cách chơi. Thượng Hải 1930, chơi một mình, khoảng 10 phút. Không tốn lượt PixelLab nào: mọi hình lấy lại từ thư viện Đợt 0.

## Cốt truyện

Chiếc ấm men lam đời Minh của trà lâu Vọng Nguyệt biến mất khỏi khay trà trên quầy trong mười phút ông Lưu vào kho. Thủ phạm là ngài Hamilton, nhà sưu tầm người Anh: hôm qua trả 500 đồng mà không mua được.

| Cảnh | Ảnh gốc (thư viện) | Có gì |
| --- | --- | --- |
| Trà lâu Vọng Nguyệt (trong nhà, isometric, không mưa) | `c-room-tra-lau` | Ông Lưu, cô Tô Mỹ Lan, sổ khách, thư xé (giải đố `torn_paper`), khay trà (chụp ảnh) |
| Ngõ Thạch Khố Môn (ngoài trời, mưa phùn) | `c-map-ngo-thach-kho-mon` | A Phúc phu xe kéo, ngài Hamilton, hòm gỗ trên xe kéo |

Nhân vật: `c-npc-02-chu-tra-lau` (ông Lưu), `c-npc-01-ca-si` (Mỹ Lan), `j-npc-02-phu-xe-keo` (A Phúc), `v-npc-15-quy-ong` (Hamilton). Thư viện chưa có hoạt ảnh đứng cho họ nên ảnh thở làm bằng code; chân dung 288×288 là hướng south 96×96 phóng ×3. Icon ấm men lam vẽ bằng code (`draw_teapot.py`).

Nhạc: `thuong-hai-tra-lau` (trong nhà), `thuong-hai-ngo-thach-kho-mon` (ngoài ngõ). Mỗi nhân vật một tiếng bíp riêng. Đủ gợi ý 3 mức cho 2 cảnh, lần đối chất, và 3 gợi ý trong câu đố.

## Dạy những gì (theo thứ tự hướng dẫn)

Đi lại → hỏi ông Lưu → hỏi thêm → khám sổ khách (tự đổi sang Watson) → chụp ảnh khay trà → ghép thư xé → mở Hồ sơ vụ án → hỏi cô Mỹ Lan → bấm Gợi ý → ra ngõ (mưa) → hỏi A Phúc → mở hòm gỗ → xem Túi đồ → hỏi ngài Hamilton → vạch lời nói dối bằng sổ khách → lập cáo buộc.

Các bước nằm ở `src/FE/Client/js/game/tutorialSteps.ts`; thẻ hướng dẫn và mũi tên vàng ở `tutorialCoach.ts`.

## Dựng lại

```bash
python3 ai-game-docs/pixel-case-tan-thu/build_assets.py <thư mục files của thư viện Đợt 0> src/FE/public/assets/pixel/tan-thu
python3 ai-game-docs/pixel-case-tan-thu/build_case.py
```

`build_case.py` ghi `src/BE/SeedData/V3/case-pixel-tan-thu-vi.json` và `src/BE/SeedData/Cutscenes/case-pixel-tan-thu-vi.intro.json`. Vùng đi được của hai cảnh ở `walk.py` (tọa độ native 512).
