# Sir Locked — giao diện "Bảng phá án" (gói bàn giao)

**Tình trạng:** chưa sửa vào code dự án. Gói này là bản thiết kế bấm thử được (21 màn), dùng để đối chiếu khi sửa code trong `src/FE`.

## Trong gói có gì

| Thư mục | Dùng để làm gì |
|---|---|
| `xem-truoc/` | Mở `index.html` bằng Chrome/Edge. Mỗi màn là một file `.html` chạy được offline (font và ảnh đã kèm trong `assets/`). Các nút nối sang nhau như trong game. Thêm tham số để mở thẳng một trạng thái, ví dụ `Game.html?view=may-anh`, `Game.html?view=qua-phong`, `Result.html?outcome=thua`. |
| `nguon-canvas/` | Mã nguồn gốc của từng màn (`.dc.html`) và `canvas.json` của canvas thiết kế. Trong mỗi file: CSS nằm trong `<helmet><style>`, HTML nằm trong `<x-dc>`, logic trạng thái/animation nằm trong `<script type="text/x-dc">` (class `Component`, hàm `renderVals()`). Định dạng này chỉ chạy trong canvas; lấy HTML/CSS ra từ đây khi sửa code. |
| `boards.json` | Danh sách màn, kích thước, các tham số trạng thái (dùng cho `index.html`). |
| `ban-giao-code/` | `20-bpa-foundation.css` (biến màu, font, class giấy/nút/ghim/con dấu và hiệu ứng kính lúp dùng chung) và `PROMPTS.md` (bước chuẩn bị + 4 prompt chạy agent song song). |
| `AGENTS-CHUNG.md` | Quy tắc chung mà mọi agent phải đọc trước khi sửa code. |

## Màn thiết kế → file cần sửa trong dự án

Đường dẫn theo nhánh `feature/ai-gameplay-v2-20260717`.

| Màn | Bản xem trước | File trong dự án |
|---|---|---|
| B · Đăng nhập / Đăng ký / Quên mật khẩu | `PhaAn.html` | `src/FE/Client/js/pages/loginPage.js`, `src/FE/css/03-auth.css` |
| B · Xác minh email | `VerifyEmail.html` | `verifyNoticePage.js`, `verifyEmailPage.js` |
| B · Đặt lại mật khẩu | `ResetPassword.html` | `resetPasswordPage.js` |
| 1 · Loading | `Loading.html` | màn chờ khi vào app (`main.js` / `routeLifecycle.js`) |
| 2 · Trang chủ | `Home.html` | `titleMenuPage.js`, `src/FE/components/nav.html`, `css/01-nav.css` |
| 3 · Tìm trận | `FindGame.html` | tính năng mới, cần API ghép đôi |
| 4 · Phòng | `Rooms.html` | `createRoomPage.js`, `joinRoomPage.js`, `css/05-create-room.css`, `css/06-join-room.css` |
| 5 · Chợ đồ | `Market.html` | tính năng mới, cần backend vật phẩm / xu / giao dịch |
| 6 · Workshop | `Workshop.html` | `workshopPage.js`, `workshop/caseOfWeekBanner.js` |
| 7 · Phòng chờ | `Lobby.html` | `lobbyPage.js` |
| 8 · Hiện trường (HUD, máy ảnh, túi đồ, qua phòng) | `Game.html` | `gamePage.ts` (HUD, `inventoryDrawer()`, chế độ CAMERA, chuyển cảnh), `game/gameShell.ts`, `game/dialoguePresenter.ts`, `game/cooperativePing.ts`, `css/10-game.css` |
| 9 · Hồ sơ vụ án | `CaseFile.html` | phần Hồ sơ vụ án trong `gamePage.ts`, `game/gameUiModel.ts` |
| 10 · Cùng xem xét — Phá Vỡ Lời Dối | `Confront.html` | `game/pairedConfrontation.ts`, `game/crackPayoff.ts` |
| 11 · Cáo buộc cuối cùng | `Accuse.html` | `game/accusationConsensus.ts`, phần cáo buộc trong `gamePage.ts` |
| 12 · Kết quả vụ án | `Result.html` | `resultPage.js` |
| 13 · Hồ sơ thám tử | `Profile.html` | `detectivePage.js` |
| 14 · Vụ án đã xuất bản | `Cases.html` | `casesPage.js`, `caseDetailPage.js` |
| 15 · Thử thách tuần | `Challenge.html` | `challengePage.js` |
| 16 · Workshop — chi tiết vụ án | `WorkshopCase.html` | `workshopCasePage.js`, `workshop/leaderboardSection.js`, `leaderboardTable.js`, `reviewSection.js`, `badgeSection.js` |
| A · Hồ sơ 221B (phương án không chọn) | `Main.html`, `Mobile.html` | chỉ để tham khảo |

## Ghi chú khi đưa vào code

- **Màu & chữ** (đưa vào `src/FE/css/_tokens.css`): nền cork `#2a1f17`/`#120d09`; giấy thẻ `#fbf6ed` (lề đỏ `rgba(182,64,48,.5)`, dòng kẻ `rgba(79,154,154,.4)`); giấy sổ `#f4efe3`; kraft `#e9dcc0`/`#d9c49a`; báo `#e3dbc9`; nhãn đen `#0d1014`; mực `#07111f`; chữ phụ `#5b5248`; chỉ đỏ `#bf3b2c`; nút đỏ `#9e3f2a` (bóng `#6b2a1c`); vàng đồng `#efd486`/`#c7a24b`/`#5e4a1c`; xanh ngọc `#2f6363`; gỉ sét `#7a3f27`. Font: Playfair Display (tiêu đề), Crimson Text (chữ thường), Source Code Pro (nhãn in hoa, giãn chữ).
- **Chuyển trang kính lúp:** keyframes `sLens` / `sZoom` / `sRim`, 1.15s, `cubic-bezier(.7,0,.2,1)`. Bọc nội dung trang trong `.s-enter` > `.s-enter-zoom`, kèm `.s-rim`. Đưa vào `_motion.css`, tắt khi `prefers-reduced-motion`.
- **Không vẽ nhân vật:** người chơi và nghi phạm chỉ hiện bằng chữ viết tắt (TM, TV, MV, SL, VK) hoặc bóng đen không mặt.
- **Máy ảnh:** giữ logic hiện có (`captureCameraFrame` → `GameplayService.CaptureClue`, kết quả HIT / NEAR_MISS / MISS, đếm `CameraMissCount`). Giao diện mới chỉ thay phần vẽ khung chụp, hiệu ứng mở máy (màn trập 6 lá, 4 góc khung bay vào), ảnh in ra và thông báo. Bản mẫu tự chấm theo ngưỡng 60% / 20% độ phủ; game thật lấy ngưỡng từ `cameraRules` của từng cảnh.
- **Túi đồ:** giữ logic `inventoryDrawer()`, `combineItems()`, `useSelectedItemOnTarget()`. Giao diện mới: cặp da 12 ô, hiệu ứng mở nắp / đóng nắp, thẻ chi tiết trượt ra, món đồ đi theo con trỏ khi "Dùng".
- **Qua phòng:** thêm lớp chuyển cảnh (đẩy vào cửa → khép tối → thẻ tiêu đề Hồi + chỉ đỏ → mở cảnh mới), gọi khi đổi `currentSceneId`.
- **Tính năng chưa có backend:** Tìm trận (ghép đôi), Chợ đồ (vật phẩm, giá, giao dịch), ví xu, chuông thông báo, "CẤP 12". Bản mẫu chỉ là giao diện.
- **Dữ liệu mẫu:** tên đội, điểm, đánh giá, giờ trong nhật ký, mã phòng là dữ liệu bịa cho bản mẫu. Nội dung vụ án lấy từ `ai-game-docs/reference-case-dem-khoa-so/case.json`.
- **Chuỗi mới cần duyệt:** một số câu không có trong `i18n` hiện tại (vd. "Không phát hiện chi tiết quan trọng nào.", "Có gì đó đáng chú ý ở đây. Hãy căn khung kỹ hơn.", "Ngăn thư dịch vụ đang khóa…", các con dấu "ĐỦ ĐỘI", "ĐÃ NỘP CÁO BUỘC", "CHƯA RÕ", "CHỤP TRƯỢT").
- **Bản xem trước** dùng một bộ chạy giả lập nhỏ (morphdom, MIT) để chạy logic của từng màn ngoài canvas; không dùng trong dự án.
