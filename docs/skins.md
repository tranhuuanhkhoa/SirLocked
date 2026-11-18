# Trang phục (skin) của Sherlock và Watson

Skin là một vật phẩm bình thường trong kho đồ. Nó rơi từ hòm, bán và trao đổi trên chợ, và được bật bằng nút **"Dùng vật phẩm này"** ở tab Bán của chợ.

Mỗi thám tử có một ô riêng:

| Ô (category) | Ai mặc | Nhãn |
|---|---|---|
| `SKIN_SHERLOCK` | người chơi vai Thẩm vấn viên (`INTERROGATOR`) | Trang phục Sherlock |
| `SKIN_WATSON` | người chơi vai Điều tra viên (`INVESTIGATOR`) | Trang phục Watson |

Một người có thể mặc cả hai cùng lúc. Vào phòng chơi vai nào thì game vẽ skin của vai đó.

## Bộ đầu tiên: Đêm Whitechapel 1888 (Huyền thoại)

| defId | Tên | Chiêu riêng |
|---|---|---|
| `skin_sherlock_whitechapel` | Sherlock · Kẻ Săn Bóng Đêm | Đứng yên 10 giây thì giơ kính lúp soi; 6 dấu chân phát sáng hiện ra rồi mờ dần. |
| `skin_watson_whitechapel` | Watson · Bác Sĩ Mỏ Quạ | Đứng yên 10 giây thì lắc lọ thuốc; khói thảo dược xanh tỏa ra từ mỏ. |

**Cây đèn của Sherlock:** chỉ có ở cảnh `timeOfDay = NIGHT`, kèm quầng sáng ấm. Cảnh `DAY`, `DUSK` và cảnh chưa đặt giờ dùng bản không đèn. Đổi cảnh thì đổi bản ngay.

## Code nằm đâu

- **Backend**
  - `src/BE/Services/Market/SkinCatalog.cs`: hai vật phẩm, icon ở `/assets/pixel/skins/whitechapel/`.
  - `CatalogSeedData` phiên bản 2: thêm hai vật phẩm vào database đang ở phiên bản 1.
    - Seed **không** thêm skin vào hòm nào.
    - Admin tự chọn hòm ở `/admin/chests/<id>` → "Nội dung hòm".
  - `AdminChestsRules.ValidateItem`: riêng skin được phép trỏ ảnh tới `/assets/...`; các vật phẩm khác vẫn phải dùng ảnh https đã tải lên.
- **Frontend**
  - `src/FE/Client/js/game/playerSkins.ts`:
    - danh sách skin game biết;
    - chọn sheet theo vai và giờ trong cảnh;
    - hỏi `GET /api/market/equipped/{userId}`.
  - `src/FE/Client/js/game/skinEffects.ts`: quầng sáng đèn, dấu chân, khói.
  - `src/FE/Client/js/game/pixelActors.ts`: thêm động tác `signature`. Chiêu chạy một lần mỗi lần đứng yên đủ lâu, rồi về đứng yên.
  - `src/FE/Client/js/pages/gamePage.ts`: hỏi skin của từng người khi vào trận, tải sheet ngầm, vẽ skin khi đã tải xong.
- **Sheet:** `src/FE/public/assets/pixel/skins/whitechapel/`, ô 128 px, 13 cột:
  - hàng 0: 8 hướng xoay;
  - hàng 1–4: đứng thở (nam, đông, bắc, tây; 9 khung);
  - hàng 5–8: đi bộ (8 khung);
  - hàng 9–12: chiêu riêng (13 khung).

## An toàn khi có lỗi

Những trường hợp sau đều giữ dáng thường, không bao giờ làm mất nhân vật:
- skin chưa tải xong;
- hỏi chợ bị lỗi;
- `defId` mà game không biết (ví dụ admin tạo vật phẩm skin mới nhưng chưa có code vẽ);
- mặc skin của vai kia.

## Thêm một bộ skin mới

1. **Vẽ nhân vật.** PixelLab `create_character` V3, 96×96, 8 hướng, cùng phong cách. Lấy mặt trước đã duyệt làm `reference_image`.
2. **Làm chuyển động** bằng `animate_character` v3, 4 hướng:
   - `template_action=walking`;
   - idle: `frame_count=8`, giữ khung đầu;
   - chiêu riêng: `frame_count=12`, giữ khung đầu.
3. **Ghép sheet** theo bố cục trên, mỗi khung đặt giữa ô 128. Pivot là chân: Sherlock (64,109), Watson (64,104).
4. **Thêm vào code:**
   - `PLAYER_SKINS` trong `playerSkins.ts`;
   - `SkinCatalog.ItemDefs`;
   - một phiên bản seed mới trong `CatalogSeedData`.
5. **Chạy test:**
   - `npm run test:skins`;
   - `npx playwright test tests/player-skins.spec.ts`;
   - `SkinCatalogTests`.
