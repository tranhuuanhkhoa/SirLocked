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

**Cây đèn của Sherlock:** có ở cảnh `timeOfDay = DUSK` (chạng vạng) và `NIGHT`, kèm quầng sáng ấm. Cảnh `DAY` và cảnh chưa đặt giờ dùng bản không đèn. Đổi cảnh thì đổi bản ngay.

**Hòm riêng của bộ:** `chest_wc` "Hòm Đêm Whitechapel" (phụ đề "Phố Whitechapel · Nº 1888"), mở bằng `key_wc` "chìa kính lúp bạc".

- Hai bộ trang phục **chỉ** rơi từ hòm này. Các hòm cũ không đổi.
- Có hình vẽ riêng `whitechapel` (icon `chest_whitechapel`), ánh sáng đỏ thẫm `190,52,58`:
  - thân gỗ mun, ô nhung đỏ viền bạc, khóa là một cây đèn bão, nắp có kính lúp bạc tròng đỏ, dấu sáp khi còn niêm;
  - vẽ bằng code trong `chestSprites.js` như các hòm khác, nên chợ, kho đồ, Kho rương và admin đều thấy cùng một hình;
  - ảnh to ở Kho rương: `public/assets/chests/hom-dem-whitechapel.png` (336×301, xuất từ hình code, ×7).
- **Ở Kho rương** hòm này có cảnh riêng: trăng máu, mái nhà, đèn khí, sương đỏ, tia lửa bay lên, tem "WHITECHAPEL 1888". Màn rộng có Sherlock và Watson đứng hai bên nút mở hòm.
- **Ở admin** (`/admin/chests`) hòm này là một thẻ đêm rộng hết hàng: phố đêm Whitechapel sau hòm, hai bộ trang phục đứng hai bên, dải "Bộ sưu tập Huyền thoại", tên mạ vàng. Đầu trang sửa hòm cũng vậy. Cảnh này đi theo hình vẽ (`look.template = whitechapel`), nên hòm nhân bản từ nó, hay hòm nào admin chọn hình này, cũng được cảnh đó; chọn hình khác thì về thẻ thường.
- Giá: hòm 180 xu, chìa 260 xu.
- Tỉ lệ rơi trên 10.000:

  | Độ hiếm | Trọng số | Gồm |
  |---|---|---|
  | Thường | 7.874 | đồ hồ sơ thường |
  | Hiếm | 1.600 | đồ hồ sơ hiếm |
  | Quý | 400 | đồ hồ sơ quý |
  | Huyền thoại | 100 | 2 bộ trang phục (mỗi bộ 0,5%) |
  | Bí ẩn | 26 | món "ra từ mọi hòm" của các hòm cũ |

  Giá trị kỳ vọng khoảng 260 xu, nhỏ hơn giá hòm cộng chìa (440 xu). Đạt luật kinh tế của admin.
- Admin sửa được mọi thứ ở `/admin/chests/chest_wc` như hòm khác.

## Code nằm đâu

- **Backend**
  - `src/BE/Services/Market/SkinCatalog.cs`: hai vật phẩm, icon ở `/assets/pixel/skins/whitechapel/`.
  - `CatalogSeedData`:
    - phiên bản 2 thêm hai bộ trang phục;
    - phiên bản 3 thêm Hòm Đêm Whitechapel và chìa của nó;
    - phiên bản 4 chuyển hòm đó sang hình riêng `whitechapel`. Chỉ đổi khi hòm vẫn đang dùng hình cũ `seal`/`chest_seal`; admin đã chọn hình khác thì giữ nguyên.
    - Seed chỉ thêm cái chưa có, không sửa hòm cũ và không đè chỗ admin đã sửa.
  - `AdminChestsRules.ValidateItem`: riêng skin được phép trỏ ảnh tới `/assets/...`; các vật phẩm khác vẫn phải dùng ảnh https đã tải lên.
  - `AdminChestsRules.Drawings`: thêm hình `whitechapel` (icon hòm `chest_whitechapel`, chìa `key_loupe`), admin chọn được ở ô "Kiểu hòm".
- **Frontend**
  - `src/FE/Client/js/game/playerSkins.ts`:
    - danh sách skin game biết;
    - chọn sheet theo vai và giờ trong cảnh;
    - hỏi `GET /api/market/equipped/{userId}`.
  - `src/FE/Client/js/game/skinEffects.ts`: quầng sáng đèn, dấu chân, khói.
  - `src/FE/Client/js/game/pixelActors.ts`: thêm động tác `signature`. Chiêu chạy một lần mỗi lần đứng yên đủ lâu, rồi về đứng yên.
  - `src/FE/Client/js/pages/gamePage.ts`: hỏi skin của từng người khi vào trận, tải sheet ngầm, vẽ skin khi đã tải xong.
  - `src/FE/Client/js/pages/chest/chestSprites.js`: hình hòm `chest_whitechapel` (`wcBody`, `wcLid`, `wcUnderside`).
  - `src/FE/Client/js/pages/chestPage.js` + `css/47-chest.css` + `chest/vaultParticles.js` (kiểu hạt `embers`): cảnh Whitechapel ở Kho rương.
  - `src/FE/Client/js/pages/admin/chests/chestShowcase.js` + `css/50-admin-chests.css`: thẻ đêm ở admin. Muốn bộ sau có thẻ riêng thì thêm một mục vào `SHOWCASES` theo tên hình vẽ.
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
   - `SkinCatalog.Outfits` (và hòm riêng nếu có);
   - một phiên bản seed mới trong `CatalogSeedData`.
5. **Chạy test:**
   - `npm run test:skins`;
   - `npx playwright test tests/player-skins.spec.ts`;
   - `SkinCatalogTests`;
   - `npx playwright test tests/admin-chests/` (thẻ đêm ở admin và cảnh ở Kho rương).
