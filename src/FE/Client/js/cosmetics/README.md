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
