# Plan 036: Make the UI Read As a Game — Surface System and Screen Pass

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat 30ddc5c..HEAD -- src/FE/css src/FE/index.html src/FE/main.html src/FE/Client/js/pages src/FE/Client/js/utils src/FE/tests`
> Nếu bất kỳ file nào đã đổi, chạy lại `cssaudit.py` và cập nhật bảng "Current state" trước khi bắt đầu. Mọi ngưỡng trong Done criteria được tính từ baseline ở dưới; baseline lệch thì ngưỡng phải tính lại.

## Status

- **Priority**: P1
- **Effort**: L (7–10 ngày)
- **Risk**: MED — chạm mọi màn hình, nhưng không chạm logic, không chạm backend
- **Depends on**: none. Phải làm **trước** 026 (accessibility) và **trước** 029 (tách `gamePage.ts`)
- **Category**: ui
- **Planned at**: commit `30ddc5c`, 2026-07-27
- **Evidence**: audit thị giác 9 màn hình thật (login, cases, case detail, create room, join room, profile, workshop, lobby, game HUD), chụp bằng `src/FE/tests/ui-audit-capture.spec.ts`

## Why this matters

Nhận xét của chủ dự án: *"chưa giống một con game"*. Bản 036 trước được viết khi **chưa nhìn thấy UI** — chỉ đọc CSS. Sau khi chụp và xem 9 màn hình thật, chẩn đoán đổi hẳn, và nó sắc hơn nhiều so với "CSS thiếu token".

### Kết luận đã chốt: art direction ĐÚNG

Màn đăng nhập (`01-login`) là bằng chứng. Ảnh cửa 221B chiếm nửa phải khung hình, panel navy nổi trên nền, wordmark **SIR LOCKED** dùng Playfair với tracking rộng, tagline in nghiêng vàng, phân cấp nút rõ (Log in đặc vàng > Register ghost > Continue with Google trắng). Màn này **đọc ra là một con game**. Không đổi bảng màu (`#07111f` / `#c7a24b` / `#eee4d2`), không đổi bộ font (Playfair Display + Crimson Text + Source Code Pro). Ai muốn đổi art direction thì mở plan khác.

### Vấn đề thật: art direction chỉ tồn tại ở màn đăng nhập

Từ màn thứ hai trở đi, UI trở thành **document flow trên nền tối**. Quan sát từng màn:

| Màn | Quan sát trên ảnh chụp thật |
|---|---|
| `02-cases` | Nền 221B bị làm mờ tới mức **gần như vô hình** — chỉ còn thấy chữ "221B" mờ ở giữa. **Một** thẻ rộng ~378px nằm trong container 1180px, nên 800px bên phải trống trơn. **Nửa dưới màn hình hoàn toàn trống**. Tên case **lặp hai lần**: một lần in trên ảnh bìa (`.case-cover-title`), một lần ngay dưới ảnh (`<h3>`). Chip metadata nhỏ, xám, mờ, ai cũng như ai. Lỗi số nhiều **"1 scenes" / "1 suspects"**. Hai CTA "Create room" cạnh tranh nhau: một ở `page-head` góc phải trên, một trong thẻ. |
| `03-case-detail` | Cùng bệnh. Ảnh bìa lại in tên case lần nữa trong khi `<h1>` đứng ngay cạnh. Chỉ 1 nhân vật "People of interest" hiển thị, chiếm 1/4 chiều rộng, **nửa dưới trống**. Hai CTA Create room / Join with code đặt sát nhau không có phân cấp thị giác. |
| `04-create-room` | Hai cột "Published cases" / "Room preview". Preview lặp lại **toàn bộ** thông tin của thẻ bên trái. Nửa dưới trống. |
| `05-join-room` | Một ô input rộng 1050px cho **6 ký tự**, nút Join room bên phải. Còn lại là 550px màn hình trống. Không có gì gợi ra đây là bước vào một vụ án. |
| `06-profile` | Màn duy nhất có mật độ nội dung. Nhưng vẫn là bảng biểu xếp dọc: progress bar mảnh, hộp gạch đứt (`border: dashed`), lưới huy hiệu 6 ô xám, dải xanh lá "Email đã được xác minh" **lệch hẳn khỏi bảng màu**, rồi form đổi mật khẩu. |
| `07-workshop` | Lặp lại y hệt bệnh của `02-cases`: một thẻ, tên lặp hai lần, chip mờ, nửa dưới trống. Hàng filter Hot/Mới/Top điểm/Khó nhất là dãy pill giống nhau, không rõ cái nào đang active ngoài viền vàng nhạt. |
| `08-lobby` | Nghiêm trọng nhất về mặt thiết kế game. Đây là nơi hai người **chọn vai** — cơ chế cốt lõi bất đối xứng của Sir Locked. Nhưng INVESTIGATOR và INTERROGATOR là **hai hình chữ nhật giống hệt nhau, chỉ khác chữ**. Không chân dung, không biểu tượng, không màu phân biệt vai. UI không nói lên bất cứ điều gì về việc hai vai làm hai việc khác nhau. Nút "Ready up" và "Start investigation" đang ở màu **olive xỉn** — trông y như đang disabled, người chơi sẽ do dự không dám bấm. Nửa dưới trống. |
| `09-game-hud` | Modal briefing là một **hộp bo tròn màu xanh với danh sách đánh số 1-2-3-4**. Nó đọc như popup chấp thuận cookie, không phải hồ sơ vụ án được trao vào tay thám tử. Toast "Your partner joined the room." là hộp chữ nhật trắng góc phải trên, phong cách web app. HUD hai bên bị nền tối nuốt. |

### Nguyên nhân gốc: không có lớp surface dùng chung

Đo bằng `cssaudit.py`, ba con số giải thích toàn bộ hiện tượng trên:

| Đo được | Con số | Hệ quả nhìn thấy được |
|---|---:|---|
| Class tự dựng khung riêng (`*-card`, `*-panel`, `*-box`, `*-modal`, `*-overlay`, `*-drawer`, `*-frame`) | **48** | 48 định nghĩa "cái hộp" độc lập → padding, radius, viền, bóng mỗi chỗ một khác |
| Biến thể của `.panel` / `.surface` | **0** | Không có primitive để dùng lại, nên màn mới = phát minh hộp mới |
| Class đặt tên theo component | **3%** | 20% đặt theo màn hình (`ws-`, `v3-`, `auth-`, `conv-`, `scene-`). Năm màn = năm từ vựng = năm sản phẩm |

Hệ quả phái sinh, cũng đo được: **1811** giá trị `px` hardcode, **458** màu hex/rgba hardcode, **114** giá trị padding khác nhau, **62** cỡ chữ khác nhau, **25** giá trị `z-index`, **36** giá trị `box-shadow`, **22** `transition` trên toàn bộ 3803 dòng CSS, **1** khối `prefers-reduced-motion`.

Ba thứ khiến một giao diện đọc ra là game, mà bản hiện tại thiếu từ màn thứ hai trở đi:

1. **Surface diegetic.** Panel phải trông như hồ sơ vụ án, tấm đồng thau, kính mờ — không phải `div` trên nền tối. Màn login làm được điều này; 8 màn còn lại không.
2. **Bố cục có chủ đích.** Game lấp đầy khung hình. 6/9 màn để trống nửa dưới vì layout là document flow chảy từ trên xuống rồi hết nội dung.
3. **Phản hồi tức thì.** 22 `transition` cho 3803 dòng CSS nghĩa là gần như bấm gì cũng không phản ứng.

## Current state

Đo tại commit `30ddc5c` bằng `cssaudit.py`:

| Chỉ số | Baseline |
|---|---:|
| `px` hardcode ngoài `:root` | 1811 (126 giá trị khác nhau) |
| hex + rgb/rgba hardcode | 458 (70 hex + 388 rgba) |
| `padding` giá trị khác nhau | 114 |
| `font-size` giá trị khác nhau | 62 |
| `z-index` giá trị khác nhau | 25 |
| `box-shadow` giá trị khác nhau | 36 |
| `border-radius` giá trị khác nhau | 18 |
| Class tự dựng khung | 48 |
| Biến thể `.surface` / `.panel` | 0 |
| Class đặt theo component | 3% (21/630) |
| Class đặt theo màn hình | 20% (127/630) |
| `transition` | 22 |
| `@media prefers-reduced-motion` | 1 |
| Breakpoint khác nhau | 44 |

Cấu trúc file:

- `src/FE/css/` — 11 file, 3803 dòng:
  - `00-base.css` (38 dòng) — reset + 24 token màu trong `:root` + `body`
  - `01-nav.css`, `02-screen-layout.css`, `03-auth.css`, `04-how-to-play.css`, `05-create-room.css`, `06-join-room.css`, `07-options.css`, `08-menu-responsive.css` — chỉ `main.html` (prototype) nạp
  - `09-app.css` (~830 dòng) — vỏ app, nav, form, thẻ case, lobby
  - `10-game.css` (~2300 dòng) — toàn bộ gameplay, 65% CSS
- `src/FE/index.html` nạp `00-base.css`, `09-app.css`, `10-game.css`. `src/FE/main.html` nạp 9 file `00`–`08`.
- Markup ghép bằng template string trong từng page module dưới `src/FE/Client/js/pages/`; `escapeHtml` + `render` ở `src/FE/Client/js/utils/dom.js`.
- Lưới an toàn: `src/FE/tests/` có 9 spec, tổng **35 pass / 3 skipped**. `game-ui-smoke.spec.ts` là spec bám selector nhiều nhất.
- `package.json` — dependency: `@microsoft/signalr`, `lucide`, `phaser`. devDependency: `@playwright/test`, `typescript`, `vite`. **Không được thêm gì.**

Bằng chứng cụ thể trong code cho các lỗi đã quan sát:

- `src/FE/Client/js/pages/casesPage.js:19-27` — `.case-cover-title` in tên case trên ảnh, `<h3>` in lại tên case ngay dưới ảnh.
- `src/FE/Client/js/pages/casesPage.js:29-32` — chip metadata `${c.sceneCount} ${tr('scenes', 'hiện trường')}` sinh ra "1 scenes".
- `src/FE/Client/js/pages/casesPage.js:34-37` và `:43-46` — hai CTA "Create room" trên cùng một màn.
- `src/FE/Client/js/pages/lobbyPage.js:108` — `.role-card` cho cả hai vai, không truyền gì phân biệt vai ngoài chuỗi tên.
- `src/FE/css/09-app.css:175-182` — `.role-card` là `padding: 16px; background: var(--navy2); border-radius: 10px`. Không có chân dung, không có màu vai.
- `src/FE/css/09-app.css:57` — `.btn:disabled { opacity: 0.45 }`; `:60` — `.btn-gold { background: var(--gold) }`. Nút vàng ở 45% opacity trên nền navy chính là màu olive xỉn đã thấy ở lobby.
- `src/FE/Client/js/pages/gamePage.ts:2600-2613` — modal briefing dùng `.overlay > .modal > h2 + p + p.muted + ol.tutorial-steps + button`. Đây là cấu trúc popup thông báo, không phải hồ sơ.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `cd src/FE && npx tsc --noEmit` | exit 0 |
| Build | `cd src/FE && npm run build` | exit 0 |
| UI test đầy đủ | `cd src/FE && npx playwright test --reporter=line` | **35 passed, 3 skipped** |
| UI smoke (nhanh, dùng giữa các bước) | `cd src/FE && npx playwright test tests/game-ui-smoke.spec.ts --reporter=line` | tất cả pass |
| Chụp lại ảnh audit | `cd src/FE && npx playwright test tests/ui-audit-capture.spec.ts` | ảnh mới trong thư mục output |
| Backend build (không được đổi) | `dotnet build SirLocked.sln -v q --nologo` | 0 warning |
| Backend test (không được đổi) | `dotnet test SirLocked.sln --no-build --nologo` | **635 passed** |
| Đo tiến độ CSS | `PYTHONIOENCODING=utf-8 python <scratchpad>/cssaudit.py` rồi đọc `<scratchpad>/cssaudit.txt` | in ra bảng chỉ số |

## Scope

**In scope**:
- `src/FE/css/**` — thêm `_tokens.css`, `_surfaces.css`; tái cấu trúc `00-base.css`, `09-app.css`, `10-game.css`
- `src/FE/index.html`, `src/FE/main.html` — thứ tự nạp CSS
- `src/FE/Client/js/pages/**` — **chỉ đổi class và cấu trúc DOM trình bày**. Không đổi luồng dữ liệu, không đổi handler, không đổi API call
- `src/FE/Client/js/utils/dom.js` — thêm helper dựng surface nếu cần
- `src/FE/tests/` — thêm `ui-visual.spec.ts`; sửa selector trong spec hiện có **chỉ khi** buộc phải đổi, và phải ghi lại

**Out of scope**:
- **Mọi thứ trong `src/BE`.** Backend giữ nguyên 635 test, không sửa một dòng.
- Logic gameplay, state machine, API client, SignalR, router.
- Phaser renderer bên trong `<canvas>` — chỉ chạm HUD/overlay HTML bao quanh.
- Tách `gamePage.ts` (plan 029). Plan này không refactor JS.
- Âm thanh (plan 025), accessibility đầy đủ (plan 026).
- **Đổi bảng màu hoặc font.** Art direction được giữ.
- **Sửa lỗi số nhiều "1 scenes" / "1 suspects".** Đây là đổi chuỗi hiển thị, vi phạm quyết định số 7 bên dưới. Ghi vào backlog thành plan riêng; plan này chỉ làm chip **dễ đọc hơn** chứ không đổi chữ.
- Thêm case mới, thêm nhân vật, thêm ảnh bìa. Việc "chỉ có 1 case nên màn trống" là vấn đề nội dung; plan này phải làm cho layout **trông đúng ngay cả khi chỉ có 1 case**.

## Design decisions locked before coding

Chốt trước, không tranh luận lại trong lúc thực thi.

1. **Đây là pass hệ thống hoá, không phải re-skin.** Giữ navy/gold/beige, giữ Playfair/Crimson/Source Code Pro, giữ nền 221B Baker Street. Nếu cải thiện đến từ việc đổi màu thì sẽ không ai biết hệ thống có tác dụng hay không.
2. **Màn login là chuẩn mực.** Mọi màn khác phải đạt cùng mật độ thị giác, cùng độ tương phản panel-với-nền, cùng độ rõ của phân cấp nút. Khi phân vân, mở `01-login.png` ra so.
3. **Token trước, surface sau, màn hình sau cùng.** Không sửa màn nào trước khi `_tokens.css` và `_surfaces.css` tồn tại — nếu không sẽ đẻ thêm px rời rạc.
4. **Thang 4px, không ngoại lệ.** Cần 13px thì chọn 12 hoặc 16.
5. **Type scale 1.25 cố định.** Không đặt `font-size` tuỳ ý, không dùng `rem` lẻ.
6. **Không thêm dependency.** CSS thuần + custom property. Không framework, không thư viện animation.
7. **Không đổi chuỗi hiển thị.** Mọi text giữ nguyên, vẫn qua `tr()` EN/VI và `escapeHtml`. Được phép **bọc** một chuỗi vào phần tử con để đổi cách trình bày, miễn `textContent` gộp lại không đổi. Nhờ vậy test i18n hiện có vẫn là lưới an toàn.
8. **Selector được bảo vệ.** Các selector sau tuyệt đối không đổi vì test bám vào:
   `#case-file-btn`, `.case-file-drawer`, `.page-head h2`, `#game-hud-slot .objective-brief`, `.context-action`, `.case-file-clue-card`, `#accuse-next`, `#mobile-camera-btn`, `.final-confrontation-callout`, `#game-hud-slot .game-players`, `[data-ui-language="vi"]`, `canvas`.
   Nếu buộc phải đổi, cập nhật spec trong **cùng** lượt và ghi vào report. Vượt quá 5 test phải sửa → STOP.
9. **Bố cục phải lấp khung hình.** Không màn nào được để trống nửa dưới ở 1366×768. Nếu nội dung ít, layout phải co lại và căn giữa theo chiều dọc, hoặc bổ sung khối bối cảnh (không phải khối text mới — dùng ảnh nền, khung hồ sơ, đường kẻ).
10. **Ưu tiên tuyệt đối là Phase 4 (case selection).** Đây là chỗ ảo giác "đây là game" bị vỡ đầu tiên và mạnh nhất. Nếu hết thời gian, Phase 0–4 vẫn phải xong trọn vẹn.

## Token scales (chốt số, không sửa trong lúc thực thi)

```css
/* ---- spacing: thang 4px ---- */
--s-1: 4px;   --s-2: 8px;   --s-3: 12px;  --s-4: 16px;  --s-5: 24px;
--s-6: 32px;  --s-7: 48px;  --s-8: 64px;  --s-9: 96px;

/* ---- typography: 1.25 major third, gốc 16px ---- */
--t-xs: 12px;  --t-sm: 14px;  --t-base: 16px;  --t-lg: 20px;
--t-xl: 25px;  --t-2xl: 31px; --t-3xl: 39px;   --t-4xl: 49px;

--lh-tight: 1.15;  --lh-snug: 1.35;  --lh-normal: 1.6;
--tracking-label: 0.08em;   /* nhãn viết hoa kiểu hồ sơ */
--tracking-wordmark: 0.18em; /* wordmark SIR LOCKED, mã phòng */

--font-display: 'Playfair Display', Georgia, serif;
--font-body: 'Crimson Text', Georgia, serif;
--font-mono: 'Source Code Pro', ui-monospace, monospace;

/* ---- radius: SẮC. Game UI không bo tròn kiểu SaaS ---- */
--r-sm: 2px;  --r-md: 4px;  --r-lg: 8px;  --r-pill: 999px;
/* --r-pill CHỈ dùng cho chip/avatar tròn. Panel không bao giờ dùng. */

/* ---- elevation: 4 mức, không hơn ---- */
--e-1: 0 1px 2px rgba(0,0,0,.40);
--e-2: 0 4px 16px rgba(0,0,0,.45);
--e-3: 0 12px 40px rgba(0,0,0,.50);
--e-glow: 0 0 0 1px var(--line-strong), 0 0 24px rgba(199,162,75,.15);

/* ---- motion: 3 mức ---- */
--m-fast: 120ms;   /* hover, press, focus */
--m-base: 200ms;   /* mở/đóng panel, đổi tab */
--m-slow: 320ms;   /* chuyển màn, overlay vào/ra */
--ease-out: cubic-bezier(.2,.8,.2,1);
--ease-in-out: cubic-bezier(.4,0,.2,1);

/* ---- z-index: 6 BẬC thay cho 25 giá trị hiện tại ---- */
--z-base: 0;      /* nội dung thường */
--z-raised: 10;   /* thẻ hover, dropdown trong luồng */
--z-sticky: 100;  /* nav, thanh công cụ dính */
--z-hud: 200;     /* HUD phủ trên canvas */
--z-overlay: 300; /* drawer, modal, dialogue */
--z-toast: 400;   /* toast, thông báo hệ thống */
/* Ngoài 6 biến này, giá trị z-index hợp lệ duy nhất còn lại là -1 (lớp trang trí
   nằm sau nội dung) và 1 (stacking cục bộ trong một component đã có isolation). */

/* ---- breakpoint: 4 mốc thay cho 44 mốc hiện tại ---- */
/* 480px (phone), 768px (tablet), 1024px (laptop), 1440px (desktop rộng) */

/* ---- màu vai: dẫn xuất từ bảng màu đang có, KHÔNG thêm màu mới ---- */
--role-investigator: var(--teal);   /* #4f9a9a — quan sát, hiện trường */
--role-interrogator: var(--copper); /* #b66b4d — đối chất, con người */
```

Ghi chú: 24 token màu đang nằm trong `00-base.css` được **chuyển** sang `_tokens.css`, không nhân bản.

## Steps

### Phase 0: Baseline & safety

**Step 0.1 — Chốt baseline và xác nhận lưới an toàn còn nguyên.**

Chạy drift check ở đầu plan. Sau đó chạy đủ 5 cổng verify và ghi output thật:

```
cd src/FE && npx tsc --noEmit
cd src/FE && npm run build
cd src/FE && npx playwright test --reporter=line
dotnet build SirLocked.sln -v q --nologo
dotnet test SirLocked.sln --no-build --nologo
```

Chạy `cssaudit.py` và lưu bản `cssaudit-baseline.txt` để so cuối plan.

**Verify**: typecheck exit 0; build exit 0; Playwright **35 passed, 3 skipped**; backend build 0 warning; backend **635 passed**. Nếu bất kỳ cổng nào đã đỏ **trước khi** động vào → STOP, báo lại. Không được sửa gì trên nền đỏ.

**Step 0.2 — Ảnh mốc "before".**

Chạy `tests/ui-audit-capture.spec.ts`, lưu 9 ảnh vào thư mục mốc. Cuối plan sẽ chụp lại đúng 9 màn đó để so bằng mắt.

**Verify**: đủ 9 file ảnh, đúng 9 màn đã liệt kê trong "Why this matters".

---

### Phase 1: Tokens

**Step 1.1 — Tạo `src/FE/css/_tokens.css`.**

Chứa toàn bộ thang ở mục "Token scales", **cộng** 24 token màu chuyển từ `00-base.css`. `00-base.css` chỉ còn reset + `body`.

**Step 1.2 — Nạp `_tokens.css` đầu tiên** trong cả `index.html` và `main.html`, trước mọi file CSS khác.

**Verify**: `npm run build` exit 0. `npx playwright test tests/game-ui-smoke.spec.ts --reporter=line` pass — bước này chưa đổi một pixel nào về hình, nên test phải xanh nguyên.

**Step 1.3 — Quét thay giá trị trần trong `09-app.css` và `10-game.css` bằng token**, ưu tiên theo thứ tự: `z-index` (25 → 6 bậc) → `box-shadow` (36 → 4 mức) → `border-radius` (18 → 4 mức) → `font-size` (62 → 8 bậc) → `padding`/`gap`/`margin` (114 → thang 4px) → màu hex/rgba (458 → token).

Làm từng nhóm một, chạy verify sau mỗi nhóm. Không gộp cả 6 nhóm vào một lần sửa.

**Verify**: sau mỗi nhóm — `npm run build` exit 0 và `npx playwright test tests/game-ui-smoke.spec.ts --reporter=line` pass. Sau cả Phase 1 — chạy `cssaudit.py`, `z-index` khác nhau ≤ 6, `box-shadow` ≤ 5, `border-radius` ≤ 4.

---

### Phase 2: Surface primitives

Đây là phần chữa nguyên nhân gốc: **48 class tự dựng khung → 4 primitive**.

**Step 2.1 — Tạo `src/FE/css/_surfaces.css`** với 4 primitive, đặt tên theo **chức năng** chứ không theo màn hình:

- **`.surface`** — cái hộp duy nhất của toàn app. Nền `--panel`, viền `--line`, `--r-md`, `--e-2`, padding `--s-5`. Bốn biến thể bắt buộc:
  - `.surface--file` — hồ sơ vụ án: viền đậm hơn (`--line-strong`), góc trên phải gấp bằng `clip-path`, dải nhãn viết hoa `--tracking-label` ở đỉnh. Đây là surface mặc định cho case card, case detail, lobby role, briefing.
  - `.surface--brief` — bản tóm tắt đặt trên canvas: nền `--fog`, `backdrop-filter: blur()`, viền mảnh. Dùng cho HUD overlay.
  - `.surface--rail` — thanh dọc/ngang gắn cạnh màn: không bo góc phía dính vào cạnh, dùng cho nav và HUD rail.
  - `.surface--inset` — vùng lõm bên trong một surface khác: nền tối hơn, `--e-1` đảo chiều, không có bóng ngoài.
- **`.btn`** — giữ nguyên tên và các biến thể đang dùng (`btn-primary`, `btn-ghost`, `btn-gold`, `btn-secondary`, `btn-block`, `btn-sm`) để không phá markup, nhưng viết lại bằng token và **đủ 5 trạng thái**: rest / hover / active / focus-visible / disabled. Focus ring phải nhìn rõ trên nền navy. Trạng thái disabled **không được dùng `opacity` đơn thuần** — đó chính là thứ làm nút "Ready up" ở lobby trông như olive xỉn. Thay bằng nền phẳng xám-navy + chữ mờ + `cursor: not-allowed`, để nút **đang bật** luôn giữ đủ độ vàng.
- **`.field`** — label + input + hint + lỗi. Dùng lại `.field-group`, `.field-label`, `.field-input` sẵn có để không phá test.
- **`.chip`** — giữ `chip`, `chip-gold`, `chip-ok`, `chip-bad`, `chip-role`; thêm `.chip--stat` cho metadata dạng nhãn/giá trị (nhãn viết hoa nhỏ ở trên, số lớn ở dưới) và `.chip--role-inv` / `.chip--role-int` dùng `--role-investigator` / `--role-interrogator`.

Cộng hai utility layout duy nhất: `.stack` (dọc) và `.cluster` (ngang), cả hai nhận `--gap` từ thang spacing. Không thêm utility nào khác — plan này không dựng framework.

**Step 2.2 — Nạp `_surfaces.css`** sau `_tokens.css` trong cả hai file HTML. Chưa áp dụng vào màn nào.

**Verify**: `npm run build` exit 0; `npx playwright test --reporter=line` → 35 passed, 3 skipped (CSS mới chưa được dùng nên không được ảnh hưởng gì).

---

### Phase 3: Shell/nav

Mục tiêu cảm giác: thanh nav như **tấm đồng thau gắn trên tường**, không phải navbar web.

**Step 3.1** — Nav dùng `.surface--rail`: cao cố định `--app-nav-height`, nền kính mờ (`backdrop-filter`), viền dưới `--line`, `z-index: var(--z-sticky)`.

**Step 3.2** — Link active có gạch chân đồng thau, chuyển trong `--m-fast`. Hover có phản hồi.

**Step 3.3** — Tách rõ khu vực player và khu vực admin trong nav.

**Step 3.4** — Nền trang: hiện nền 221B bị lớp `linear-gradient(180deg, rgba(7,17,31,0.9), rgba(5,10,18,0.98))` nuốt gần hết (`00-base.css`). Giảm độ đục để nền còn đọc được **nhưng không cạnh tranh với nội dung**: dùng gradient theo chiều dọc sáng hơn ở nửa trên, vignette tối ở rìa. Chuẩn so sánh là màn login — ở đó nền vẫn nhìn rõ.

**Verify**: `npx playwright test tests/game-ui-smoke.spec.ts --reporter=line` pass, đặc biệt test i18n (`[data-ui-language="vi"]`) và mobile menu. Chụp lại `02-cases` và xác nhận nền 221B nhìn thấy được.

---

### Phase 4: Case selection — ƯU TIÊN CAO NHẤT

Đây là chỗ ảo giác "đây là game" bị vỡ. Màn `02-cases` và `07-workshop` cùng bệnh, sửa chung một lượt.

**Step 4.1 — Bỏ tên case lặp hai lần.** Giữ **một** vị trí duy nhất. Chọn tên in trên ảnh bìa (`.case-cover-title`) vì nó nằm trong khung ảnh giống bìa hồ sơ; bỏ `<h3>` lặp lại bên dưới, hoặc ngược lại — nhưng phải chỉ còn một. Đây là đổi cấu trúc DOM, không đổi chuỗi.

**Step 4.2 — Thẻ case dùng `.surface--file`.** Ảnh bìa tỉ lệ cố định 16:10, tiêu đề `--font-display` ở `--t-xl`, tóm tắt `--t-base` kẹp 2 dòng bằng `-webkit-line-clamp`.

**Step 4.3 — Metadata thành `.chip--stat`.** Nhãn viết hoa nhỏ (`--t-xs`, `--tracking-label`, màu `--beige-muted`) + giá trị `--t-lg` màu `--beige`. **Không đổi chuỗi**: bọc số và chữ vào hai `<span>` con, `textContent` gộp lại vẫn y hệt hiện tại. Điều này làm metadata đọc được mà không chạm i18n.

**Step 4.4 — Lưới lấp khung hình.** `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))` với `max-width` container. Khi chỉ có **1** case: container co lại và căn giữa, thẻ được phóng to (ảnh bìa lớn hơn, tóm tắt đầy đủ) thay vì để một thẻ 378px lạc lõng trong 1180px. Đây là ràng buộc bắt buộc — dữ liệu thật hiện chỉ có 1 case.

**Step 4.5 — Gỡ CTA cạnh tranh.** Chỉ giữ **một** "Create room" trên màn. Bỏ cái ở `page-head` (giữ `.page-head h2` nguyên vẹn vì test bám vào), để CTA nằm trong thẻ nơi nó có ngữ cảnh. Nếu cần lối vào toàn cục thì để "Have a room code?" ở `page-head` với style ghost.

**Step 4.6 — Hover.** Nâng thẻ bằng `--e-3` trong `--m-fast`, viền chuyển sang `--line-strong`.

**Step 4.7 — Áp cùng bộ thay đổi cho `workshop`**, kể cả hàng filter Hot/Mới/Top điểm/Khó nhất: trạng thái active phải rõ ràng (nền đặc, không chỉ viền).

**Verify**: `npm run build` exit 0; `npx playwright test --reporter=line` → 35 passed, 3 skipped. Chụp lại `02-cases` và `07-workshop`, đối chiếu với ảnh baseline: không còn khoảng trống nửa dưới ở 1366×768, không còn tên lặp, chip đọc được.

---

### Phase 5: Case detail & remaining meta screens

**Step 5.1 — `case-detail`**: bỏ tên lặp trên ảnh bìa, dùng `.surface--file` cho khối chính, hai CTA có phân cấp rõ (Create room primary đặc, Join with code ghost). Khối "People of interest" chuyển sang lưới chân dung lấp chiều ngang; khi chỉ có 1 nhân vật, phóng to thẻ chân dung thay vì để nó nhỏ ở góc trái.

**Step 5.2 — `create-room`**: bỏ trùng lặp giữa cột trái và Room preview. Cột trái là danh sách chọn (compact), cột phải là hồ sơ đầy đủ dùng `.surface--file`. Hai cột phải cao bằng nhau ở 1366×768.

**Step 5.3 — `join-room`**: ô mã phòng thu về đúng kích thước 6 ký tự, `--font-mono`, `--t-3xl`, `--tracking-wordmark`, căn giữa màn hình theo cả hai chiều. Thêm bối cảnh thị giác quanh ô nhập (khung hồ sơ, đường kẻ) — không thêm chữ mới.

**Step 5.4 — `profile`**: hộp `border: dashed` chuyển sang `.surface--inset`. Dải "Email đã được xác minh" màu xanh lá chuyển sang `.chip-ok` dùng token trong bảng màu (teal), bỏ màu xanh lá lệch bảng. Lưới huy hiệu dùng `.surface` + `--r-md`, huy hiệu đã đạt được nhấn bằng gold, chưa đạt thì mờ — hiện tại cả 6 ô nhìn như nhau.

**Verify**: `npx playwright test --reporter=line` → 35 passed, 3 skipped. Kiểm tra thủ công 4 màn ở 1366×768: không màn nào trống nửa dưới, không màn nào tràn ngang.

---

### Phase 6: Lobby

Đây là màn có khoảng cách lớn nhất giữa "cơ chế game" và "cái UI nói ra".

**Step 6.1 — Hai vai phải khác nhau ngay từ cái nhìn đầu.** `.role-card` dùng `.surface--file` với:
- Chân dung/biểu tượng riêng cho từng vai (dùng asset sẵn có; nếu chưa có thì dùng biểu tượng lucide đã là dependency — kính lúp cho Investigator, đèn thẩm vấn cho Interrogator).
- Màu viền và màu nhấn theo `--role-investigator` (teal) / `--role-interrogator` (copper). Hai màu này đã có trong bảng màu, không thêm màu mới.
- Nhãn vai viết hoa `--tracking-label` ở đỉnh thẻ.
- Mô tả một câu giữ nguyên chuỗi hiện có.

**Step 6.2 — Trạng thái vai bị chiếm** phải rõ bằng hình: dấu khoá + lớp phủ mờ + đường gạch chéo, không chỉ `opacity: 0.55` như hiện tại.

**Step 6.3 — Sửa nút trông như disabled.** "Ready up" và "Start investigation" hiện dùng `.btn-gold` + `.btn:disabled { opacity: .45 }` → ra màu olive. Áp `.btn` mới từ Phase 2: nút **đang bật** giữ nguyên độ vàng đầy đủ; nút **disabled** dùng nền phẳng riêng, không giảm opacity của màu vàng.

**Step 6.4 — Mã phòng**: `--font-mono`, `--t-2xl`, `--tracking-wordmark`, nút Copy có phản hồi trạng thái sau khi bấm.

**Step 6.5 — Lấp khung hình**: khối "Detectives (1/2)" và hai thẻ vai phải chiếm hết chiều cao khả dụng ở 1366×768. Trạng thái chờ có nhịp thở nhẹ (`--m-slow`, trong `prefers-reduced-motion: no-preference`) để không cảm giác treo máy.

**Verify**: `npx playwright test tests/v3-two-browser-flow.spec.ts --reporter=line` pass; `npx playwright test --reporter=line` → 35 passed, 3 skipped. Chụp lại `08-lobby`: hai vai phân biệt được từ xa, nút Ready up nhìn ra là bấm được.

---

### Phase 7: Game HUD

`10-game.css` là ~2300 dòng, 65% CSS. Bước lớn nhất, làm sau cùng trong nhóm màn hình.

**Step 7.1 — Modal briefing thành hồ sơ vụ án.** Hiện là `.overlay > .modal` bo tròn xanh với `<ol>` 1-2-3-4, đọc như popup cookie. Chuyển sang `.surface--file`:
- Dải nhãn viết hoa ở đỉnh (dùng chuỗi tiêu đề case sẵn có, không thêm chữ mới).
- Tiêu đề `--font-display` `--t-2xl`.
- Dòng vai dùng màu vai từ Phase 6 để nối liền lobby → game.
- Danh sách 4 bước bỏ số thứ tự trần, chuyển sang các dòng có ký hiệu/phím tắt hiển thị (A/D hiện thành khung phím). Chuỗi text giữ nguyên; chỉ đổi marker và cách trình bày.
- Nút "Enter the scene" là `.btn-gold` full width, giữ id `#intro-dismiss`.

**Step 7.2 — Chuyển toàn bộ `10-game.css` sang token.** Giữ nguyên mọi selector trong danh sách được bảo vệ ở quyết định số 8.

**Step 7.3 — Overlay dùng chung một khung.** Case file drawer, inventory, dialogue hiện là 3 kiểu khác nhau → đều dùng `.surface--file` / `.surface--brief`. `.case-file-drawer` và `.case-file-clue-card` giữ nguyên tên class.

**Step 7.4 — Vùng an toàn HUD.** Chừa lề để nhãn NPC và toast không đè lên nhân vật.

**Step 7.5 — Hàng đợi toast.** Tối đa 3, cái mới đẩy cái cũ, tự tắt. Toast dùng `.surface--brief` + `--z-toast`, bỏ kiểu hộp trắng web-app.

**Step 7.6 — Ô hành động (`.context-action`)** hiển thị phím tắt ngay trên nút.

**Verify**: `npx playwright test --reporter=line` → 35 passed, 3 skipped. Không được có test nào phải sửa vì lý do ngoài đổi selector đã ghi chú. Chụp lại `09-game-hud`.

---

### Phase 8: Motion

**Step 8.1 — Ngân sách chuyển động.** Mọi phần tử bấm được có `transition` ở `--m-fast` cho `background`, `border-color`, `transform`, `box-shadow`. Mọi panel mở/đóng ở `--m-base`. Chuyển màn ở `--m-slow` (fade + dịch lên 8px).

**Step 8.2 — Mọi animation phải nằm trong `@media (prefers-reduced-motion: no-preference)`**, và có khối `@media (prefers-reduced-motion: reduce)` tắt/rút ngắn ở mỗi file CSS có animation.

**Verify**: `cssaudit.py` → `transition` ≥ 60, `prefers-reduced-motion` ≥ 8. `npx playwright test --reporter=line` → 35 passed, 3 skipped.

---

### Phase 9: Responsive & QA

**Step 9.1 — Gom breakpoint từ 44 mốc về 4 mốc**: 480 / 768 / 1024 / 1440.

**Step 9.2 — Thêm `src/FE/tests/ui-visual.spec.ts`**:
- Với mỗi màn (login, cases, case detail, lobby, game, result) × 3 viewport (390×844, 1366×768, 1920×1080): khẳng định `document.body.scrollWidth <= window.innerWidth` — không màn nào tràn ngang.
- Khẳng định mọi phần tử bấm được có kích thước ≥ 44×44 CSS px.
- Khẳng định không có `font-size` tính ra < 12px.

Spec mới sẽ làm tổng số test tăng quá 35. **Ghi rõ con số mới trong report** và cập nhật kỳ vọng ở phần Commands. Nếu muốn giữ đúng 35/3 thì đặt spec này ngoài `testDir` mặc định và chạy riêng — chọn một trong hai và ghi lại.

**Step 9.3 — Dọn nợ cuối.** Quét lại toàn bộ CSS, thay nốt px và màu còn sót. Xoá class chết của các màn đã chuyển sang primitive.

**Step 9.4 — Chụp lại 9 màn** bằng `ui-audit-capture.spec.ts`, đặt cạnh ảnh baseline Phase 0.2 để so bằng mắt.

**Verify**: chạy đủ 5 cổng verify; chạy `cssaudit.py` và đối chiếu từng ngưỡng trong Done criteria.

---

## Test plan

- Frontend typecheck (`npx tsc --noEmit`) và build (`npm run build`) sau **mỗi** phase.
- `npx playwright test --reporter=line` sau mỗi phase: **35 passed, 3 skipped** (cộng số test mới của Step 9.2, phải ghi rõ).
- `npx playwright test tests/game-ui-smoke.spec.ts` sau mỗi step con trong Phase 1 và Phase 7 — hai phase rủi ro nhất.
- `tests/v3-two-browser-flow.spec.ts` riêng sau Phase 6.
- Backend `dotnet build` (0 warning) và `dotnet test` (635 passed) ở Phase 0 và Phase 9 — chỉ để chứng minh không chạm vào. Không có bước nào trong plan này được sửa `src/BE`.
- `cssaudit.py` sau mỗi phase từ Phase 1 trở đi, so với baseline.
- Kiểm tra tay: đi trọn luồng login → cases → case detail → create room → lobby → game → result ở 1366×768 và 390×844.
- Đối chiếu ảnh: 9 màn before/after.

## Done criteria

Chỉ số đo bằng `cssaudit.py`:

- [ ] `px` hardcode ngoài `:root`: **1811 → < 400**
- [ ] hex + rgba hardcode: **458 → < 40**
- [ ] `padding` giá trị khác nhau: **114 → ≤ 12**
- [ ] `font-size` giá trị khác nhau: **62 → ≤ 10**
- [ ] `z-index` giá trị khác nhau: **25 → ≤ 6**
- [ ] `box-shadow` giá trị khác nhau: **36 → ≤ 5**
- [ ] Class tự dựng khung: **48 → ≤ 6**
- [ ] Biến thể của `.surface`: **0 → 4** (`--file`, `--brief`, `--rail`, `--inset`), và mọi khung trong app dùng chúng
- [ ] Class đặt theo component: **3% → ≥ 40%**
- [ ] `transition`: **22 → ≥ 60**
- [ ] `@media prefers-reduced-motion`: **1 → ≥ 8**

Cổng kiểm thử:

- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] Playwright giữ **35 passed, 3 skipped** (cộng test mới ở Step 9.2, ghi rõ con số)
- [ ] `dotnet build SirLocked.sln -v q --nologo` → 0 warning
- [ ] `dotnet test SirLocked.sln --no-build --nologo` → **635 passed**
- [ ] `git status` xác nhận **không có file nào dưới `src/BE` bị sửa**
- [ ] `package.json` không thêm dependency nào

Kiểm chứng thị giác (so ảnh before/after):

- [ ] Nền 221B nhìn thấy được ở mọi màn, không bị làm mờ tới mức vô hình
- [ ] Không màn nào để trống nửa dưới ở 1366×768
- [ ] Không màn nào tràn ngang ở 390×844 / 1366×768 / 1920×1080
- [ ] Tên case không còn lặp hai lần ở `cases`, `case-detail`, `workshop`, `create-room`
- [ ] Chỉ còn **một** CTA "Create room" trên màn `cases`
- [ ] Hai vai ở lobby phân biệt được bằng hình (chân dung + màu), không chỉ bằng chữ
- [ ] Nút "Ready up" / "Start investigation" ở trạng thái bật không còn trông như disabled
- [ ] Modal briefing đọc như hồ sơ vụ án, không như popup thông báo
- [ ] Mọi phần tử tương tác có đủ 5 trạng thái, focus ring nhìn rõ trên nền navy
- [ ] Mọi chuỗi hiển thị giữ nguyên, vẫn qua `tr()` EN/VI và `escapeHtml`
- [ ] Mọi selector được bảo vệ còn nguyên; nếu có cái nào đổi, đã cập nhật spec trong cùng lượt và ghi vào report
- [ ] `plans/README.md` cập nhật dòng plan 036

## STOP conditions

- Cần sửa `src/BE` để hoàn thành → dừng. Plan này thuần frontend.
- Cần đổi bảng màu hoặc font để đạt kết quả → dừng và báo lại. Đó là quyết định art direction, tách plan riêng.
- Phải sửa **quá 5 test** trong toàn bộ `src/FE/tests/` → dừng. Nghĩa là đang đổi cấu trúc chứ không đổi trình bày, và lưới an toàn đang bị gỡ.
- Muốn thêm thư viện UI hoặc animation → dừng. Quyết định số 6 cấm.
- Cần đổi chuỗi hiển thị (kể cả để sửa lỗi "1 scenes") → dừng phần đó, ghi vào backlog, tiếp tục phần còn lại.
- Bất kỳ cổng verify nào đỏ ngay ở Phase 0 → dừng, báo lại. Không sửa trên nền đỏ.
- Hết thời gian trước khi xong Phase 9 → dừng ở ranh giới phase gần nhất, đảm bảo mọi cổng verify xanh, và báo rõ đã dừng ở phase nào. Không để phase dở dang.

## Maintenance notes

Quy tắc để không tụt lại sau plan này: **không viết `px` trần, không viết màu trần, không tự dựng khung mới.** Ba lệnh đếm của `cssaudit.py` (px, màu, class khung) nên thành cổng mềm trong CI — cảnh báo trước, chưa fail — để nợ không tích lại.

Khi thêm màn mới: bắt đầu bằng `.surface` + biến thể sẵn có. Nếu thấy cần biến thể thứ 5, đó là tín hiệu phải xem lại 4 biến thể hiện có trước, chứ không phải thêm ngay.

Thứ tự phụ thuộc với plan khác:
- Plan 029 (tách `gamePage.ts`) làm **sau** 036 là cố ý — tách file dễ hơn nhiều khi class đã được hệ thống hoá.
- Plan 026 (accessibility) dựa trên focus ring, kích thước chạm và type scale mà 036 dựng. Đừng làm ngược thứ tự.
- Lỗi số nhiều "1 scenes" / "1 suspects" và việc dữ liệu chỉ có 1 case (làm mọi màn danh sách trông trống) là hai việc riêng, cần plan riêng.
