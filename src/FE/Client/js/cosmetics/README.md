# Mỹ phẩm hồ sơ thám tử

`art-manifest.js`, `lib.js`, `frames.js`, `avatars.js`, `titles.js`, `fx.js`, `stage.js` và `chime.js` được chuyển nguyên
từ bản thử đã duyệt (`Claude outputs/quay-hom/ho-so-src/`). Đây là mã vẽ: **không vẽ lại hay đơn giản hóa**.

Những thay đổi so với bản thử, không có gì khác:

- Thêm `import`/`export`, gỡ phạm vi chung (IIFE).
- Mọi class có tiền tố `hs-`; tên `@keyframes` cũng vậy (xem `css/48-cosmetics.css`).
- `avatars.js`: bỏ biến `userAvatar`, thêm `avatarFor({ avatar, avatarUrl })` cho ảnh tải lên từ máy chủ.
- `stage.js`: `openStage(id, player, { onClose, skipLabel, arrivedLabel })` nhận dữ liệu qua tham số thay cho `me`,
  `renderLobby`, `avatarImg`; tự chạy vòng lặp `requestAnimationFrame` của mình và nghe phím Esc khi đang mở.
  Trong lúc mở, trang bên dưới ngừng vẽ, và vị trí nhân vật chỉ đo lại 2 lần mỗi giây.
- `frames.js`: `paintFrame` lấy kích thước từ `ResizeObserver` thay vì đo mỗi khung hình; thêm `isAnimatedFrame`,
  `frameArtReady`, `forgetCanvas`.
- `stage.js`: canvas toàn màn hình tối đa 1.5x và tự hạ độ phân giải khi máy không theo kịp.
- `titles.js`: thêm `setPlaqueMotion` để dừng hoặc chạy chuyển động của một danh hiệu; SMIL của danh hiệu chạy theo một
  đồng hồ chung 30 nhịp mỗi giây; viền cánh chỉ vẽ khi có danh hiệu cần đến.

Phần viết mới cho game:

- `index.js`: điểm vào, đổi id máy chủ (`frame_dong`) sang id vẽ (`dong`), chuẩn bị sprite và phông.
- `painter.js`: vòng lặp vẽ viền dùng chung, chỉ chạy khi tab hiện và có canvas trong khung nhìn.
- `entrances.js`: hàng đợi hiệu ứng vào sảnh, bản nhẹ cho hiệu ứng mặc định, bản tĩnh cho `prefers-reduced-motion`.
- `icons.js`: mỹ phẩm dưới dạng sprite cho vòng quay mở hòm.
- `catalog.js`: đổi mô tả của máy chủ (`GET /api/cosmetics/catalog`) thành các bảng vẽ `FR`, `T`, `EN`; không tải được thì trang vẽ đồ có sẵn.

Thêm vào mã vẽ để vẽ theo dữ liệu, đồ có sẵn không đổi một điểm ảnh (`tests/admin-cosmetics-look.spec.ts`):

- `frames.js`: `defineFrame`, `refreshFrame`, `fitPicture`, `uploadedPic`, `picFailed`; `layer` đọc `layerOf` để biến thể dùng chung lớp hình với viền gốc.
- `titles.js`: `defineTitle`, `titleFrom`; `titleHTML` đọc `t.ov` để ghi đè `glow` và `parts`; `paintedTitleHTML` vẽ bảng tên từ ảnh (`t.pic`).
- `fx.js`: `defineEntrance`, `drawWarpSoft`; `drawSword` nhận ảnh kiếm riêng; `defineEntrance` nhận `flip` (sprite sheet).
- `stage.js`: `stageOf`, `timingOf`, `artOf`, `paintStageThumb`, `drawFlipbook`; mọi màu của sân khấu đi qua `retint`.
- `lib.js`: `retint`. Không có màu chủ đạo thì trả về nguyên màu cũ.
- `painter.js`: ô đã vẽ xong sẽ vẽ lại khi `frameRevision` đổi.

## Vẽ theo dữ liệu

Mỗi def có `visual`. `builtinId` có giá trị thì dùng mã vẽ có sẵn; `template` thì dựng từ mẫu với tham số `params`. Chi tiết và giới hạn ở `docs/admin-cosmetics.md`.

| Nhóm | `template` | `params` |
|---|---|---|
| Viền | `painted` (ảnh ở `imageUrl`) | `hole: { x, y, r }` theo pixel ảnh gốc, `scale`, `live`, `sheen`, `glowUrl` |
| Viền | `builtin-clone` | `base` là builtinId, `live`, `sheen` |
| Danh hiệu | `style` | `style` là khóa trong `STY`, `glow`, `parts` |
| Danh hiệu | `painted` (ảnh ở `imageUrl`) | `size: { w, h }` px, `box: { x, y, w, h }` phần của ảnh, `color`, `textBaked`, `scale`, `glow`, `parts` |
| Hiệu ứng | một trong 10 hiệu ứng | `tint`, `duration`; `imageUrl` cho `kim-long`, `phuong-hoang`; `swordUrl` cho `van-kiem` |
| Hiệu ứng | `flipbook` | `sheetUrl`, `cols`, `rows`, `frames`, `fps`, `loop`, `place`, `size`, `blend`, `tint`, `duration` |

`live` cùng dạng bảng `LIVE` trong `frames.js`: `aura: [rgb, mạnh]`, `rays: [rgb, mạnh]`, `comet: [rgb, tốc độ, số vệt]`, `spark: [rgb, số]`, `fall: ["snow"|"petal"|"rose"|"feather", số]`, `embers: [rgb, số]`, `flame: 1`, `breathe: độ`.

