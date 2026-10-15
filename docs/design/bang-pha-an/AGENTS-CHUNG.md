# Quy tắc chung cho các agent sửa giao diện "Bảng phá án"

Mọi agent đọc file này trước khi làm. Prompt riêng của từng agent nói phần việc và các file được sửa.

## Bối cảnh

- Frontend ở `src/FE` (Vite). Ứng dụng chính: `src/FE/index.html` + `src/FE/Client/js/main.js` (router theo hash, mỗi route gọi `render…Page(app)`). Trang là module JS trong `Client/js/pages/*.js`, dựng HTML bằng `render(app, html)` (`utils/dom.js`). Game ở `Client/js/pages/gamePage.ts` + `Client/js/game/*.ts`, cảnh vẽ bằng Phaser. CSS ở `src/FE/css/`. Chuỗi song ngữ: `tr('English', 'Tiếng Việt')` (`services/i18n.js`).
- Bản thiết kế ở `docs/design/bang-pha-an/`:
  - `xem-truoc/<Màn>.html`: bản bấm thử, mở bằng trình duyệt. Thêm tham số để mở một trạng thái, ví dụ `Game.html?view=may-anh`, `Result.html?outcome=thua` (danh sách đầy đủ trong `xem-truoc/index.html`). Có thể chụp ảnh bằng Playwright (đã có trong devDependencies).
  - `nguon-canvas/<Màn>.dc.html`: mã nguồn. CSS trong `<helmet><style>`, HTML trong `<x-dc>`, logic trạng thái và hiệu ứng trong `<script type="text/x-dc">` (class `Component`, hàm `renderVals()`). `{{ ten }}` là chỗ điền dữ liệu, `<sc-if>` là khối hiện theo điều kiện.
  - `README.md`: bảng màn → file trong dự án.
- Nền tảng dùng chung có sẵn trong `src/FE/css/20-bpa-foundation.css`: biến `--bpa-*` (màu, font, bóng, easing) và class `.bpa-*`:
  - nền và giấy: `bpa-board`, `bpa-container`, `bpa-paper` (`--card`, `--ruled`, `--ledger`, `--kraft`, `--folder`, `--news`, `--note`), `bpa-panel`, `bpa-label`;
  - chi tiết: `bpa-pin` (`--red`), `bpa-tape`, `bpa-strings`/`bpa-string` (`--shadow`, `--draw`), `bpa-stamp` (`--teal`), `bpa-chip` (`--dark`, `--teal`, `--rust`), `bpa-avatar` (`--rust`, `--lg`);
  - điều khiển và chữ: `bpa-btn` (`--red`, `--ink`, `--gold`, `--teal`, `--sm`, `--block`), `bpa-link` (`--gold`), `bpa-field`, `bpa-field-label`, `bpa-code`, `bpa-seg`, `bpa-tab`, `bpa-table`, `bpa-kicker`, `bpa-h1/2/3`, `bpa-num`, `bpa-sr`;
  - hiệu ứng: `bpa-enter` + `bpa-rim` (chuyển trang kính lúp), `bpa-wipe-a/-b` (đổi tab), `bpa-slam-a/-b` (đóng dấu), `bpa-rise`, `bpa-spin`.
  Dùng lại các class này và không sửa file nền tảng. Thiếu gì thì viết trong file CSS riêng của bạn.

## Ranh giới giữa các agent

- Chỉ sửa các file trong mục "Bạn được sửa" của prompt. Các file khác chỉ đọc.
- CSS riêng: tạo file mới theo tên cho trong prompt và `import` từ chính module của bạn, ví dụ trong `lobbyPage.js` thêm `import '../../../css/31-bpa-lobby.css';`. Không thêm `<link>` vào `index.html` (chỉ agent 1 sửa file đó).
- Đặt tên class có tiền tố riêng (ví dụ `bpa-lobby-…`) để không đụng nhau.

## Giữ nguyên

- Toàn bộ logic: gọi API, SignalR, state, route, phân quyền theo vai, telemetry và các test hiện có. Chỉ thay markup, CSS và hiệu ứng giao diện.
- Các `id` / `data-*` mà code hoặc test đang dùng (`querySelector('#…')`, `data-inventory`, `data-close-overlay`…). Đổi class thoải mái nhưng giữ các hook này.
- Chuỗi hiển thị qua `tr('English', 'Tiếng Việt')`. Chuỗi mới cũng phải có đủ hai ngôn ngữ.
- Nội dung lấy từ dữ liệu thật (API, case data). Số liệu trong bản thiết kế chỉ là mẫu.

## Không làm

- Không thêm hay hard-code ảnh nhân vật. Trong giao diện, người chơi và nghi phạm hiện bằng chữ viết tắt (`initials()` trong `utils/dom.js`) hoặc bóng đen không mặt. Sprite và chân dung do dữ liệu vụ án cung cấp thì giữ cách hiển thị hiện tại.
- Không làm tính năng chưa có backend: Tìm trận (ghép đôi), Chợ đồ, ví xu, chuông thông báo, "CẤP n". Bỏ các phần đó khỏi màn, không gọi API giả.
- Không thêm thư viện mới.

## Chất lượng

- Đích bấm ≥ 44px, `:focus-visible` rõ, `aria-pressed` / `aria-selected` / `aria-expanded` cho nút bật tắt, `role="status"` hoặc `aria-live` cho thông báo, tương phản chữ ≥ 4.5:1.
- Mọi animation có nhánh `@media (prefers-reduced-motion: reduce)`.
- Hiển thị tốt ở 1440×900 và 390×844, không cuộn ngang.
- Đối chiếu bằng ảnh: chụp màn của bạn và bản `xem-truoc` tương ứng ở cùng kích thước, sửa tới khi gần giống.

## Hoàn thành

1. Trong `src/FE`: `npm run typecheck`, `npm run build`, `npm run test:navigation`, `npm run test:guide`, `npm run test:assets` đều qua. Nếu môi trường chạy được thì thêm `npm run test:ui`.
2. Commit trên nhánh của bạn, message dạng `feat(ui): …`. Không push, không merge.
3. Báo cáo: file đã sửa/tạo, màn nào xong, chỗ nào chưa làm hoặc phải đoán, ảnh chụp trước/sau.
