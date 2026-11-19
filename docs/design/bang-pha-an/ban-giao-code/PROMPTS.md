# Chạy 4 agent song song để đưa giao diện "Bảng phá án" vào code

## Bước 0 — làm một lần trước (Git Bash hoặc PowerShell, ở thư mục gốc repo)

```bash
git fetch origin
git switch -c ui/bang-pha-an origin/feature/ai-gameplay-v2-20260717
# Giải nén SirLocked-UI-BangPhaAn.zip, chép cả thư mục vào docs/design/bang-pha-an/
# Chép docs/design/bang-pha-an/ban-giao-code/20-bpa-foundation.css vào src/FE/css/
# Sửa src/FE/index.html:
#   - thêm ngay sau dòng _primitives.css:  <link rel="stylesheet" href="/css/20-bpa-foundation.css">
#   - trong link Google Fonts đổi  Source+Code+Pro:wght@400;600  thành  Source+Code+Pro:wght@400;500;600;700
git add -A
git commit -m "chore(ui): thêm gói thiết kế Bảng phá án và CSS nền tảng"
git worktree add ../sl-ui-1 -b ui/bpa-1-nen-tang
git worktree add ../sl-ui-2 -b ui/bpa-2-trang
git worktree add ../sl-ui-3 -b ui/bpa-3-hien-truong
git worktree add ../sl-ui-4 -b ui/bpa-4-ho-so
# Trong mỗi worktree: cd src/FE && npm ci
# Mở 1 agent trong mỗi thư mục ../sl-ui-N và dán prompt N bên dưới.
# Merge vào ui/bang-pha-an theo thứ tự 1 → 2 → 3 → 4 (agent 4 rebase lên nhánh 3 trước khi merge).
```

## Prompt agent 1 — Nền tảng, khung app, đăng nhập & trang chủ

```text
Bạn là agent 1/4 đưa giao diện "Bảng phá án" vào Sir Locked. Làm trong thư mục hiện tại (nhánh ui/bpa-1-nen-tang). Đọc trước: docs/design/bang-pha-an/AGENTS-CHUNG.md và docs/design/bang-pha-an/README.md.

Bạn được sửa:
- src/FE/index.html, src/FE/Client/js/main.js, src/FE/Client/js/services/routeLifecycle.js, src/FE/Client/js/utils/dom.js (chỉ thêm helper nếu cần)
- src/FE/css/00-base.css, 01-nav.css, 03-auth.css, 09-app.css (chỉ phần header/khung chung)
- src/FE/Client/js/pages/loginPage.js, verifyNoticePage.js, verifyEmailPage.js, resetPasswordPage.js, oauthCallbackPage.js, titleMenuPage.js
- File mới: src/FE/css/21-bpa-shell.css, 22-bpa-auth.css, 23-bpa-home.css

Việc cần làm (đối chiếu xem-truoc/Home.html, PhaAn.html, VerifyEmail.html, ResetPassword.html, Loading.html):
1. Khung app: nền cork .bpa-board cho mọi trang trừ trang game. Header như Home.html: logo kính lúp + "SIR LOCKED", menu, nút đổi ngôn ngữ đang có, chip hồ sơ (chữ viết tắt + tên + cấp bậc thật) dẫn tới trang thám tử. Menu chỉ gồm route đang có: TRANG CHỦ, PHÒNG (tạo/vào phòng), VỤ ÁN, WORKSHOP. Không thêm Tìm trận, Chợ đồ, ví xu, chuông. Trên điện thoại menu xuống hàng.
2. Chuyển trang kính lúp cho mọi lần đổi route: khi routeLifecycle tạo root mới, thêm class bpa-enter vào root và gắn <div class="bpa-rim" aria-hidden="true"> vào body; khi animationend (animationName bpaLens) thì gỡ class và rim. Bỏ qua khi prefers-reduced-motion.
3. Màn tải theo Loading.html: hiện khi app khởi động/kiểm tra phiên và khi đang import động trang game; chỉ hiện nếu phải chờ quá khoảng 300 ms.
4. Đăng nhập / đăng ký / quên mật khẩu theo PhaAn.html (bảng cork có manh mối và chỉ đỏ hội tụ vào thẻ giữa, 2 tab, chỉ chuyển vàng khi đang gửi). Xác minh email theo VerifyEmail.html, đặt lại mật khẩu theo ResetPassword.html. Giữ nguyên xử lý form, Google OAuth, lời mời phòng đã lưu và các thông báo lỗi/thành công hiện có.
5. Trang chủ (titleMenuPage.js) theo Home.html: các thẻ ghim nối chỉ đỏ — Phòng điều tra, Vụ án cộng đồng (vụ của tuần từ workshopApi), thẻ thám tử ở giữa (số liệu thật từ profileApi), khối "Sẵn sàng phá án?" với nút BẮT ĐẦU PHÁ ÁN, thẻ Thử thách tuần (weeklyApi). Bỏ thẻ Chợ đồ; nếu cần lấp chỗ thì dùng thẻ huy hiệu từ profile. Giữ đủ các lối vào hiện có của menu (bắt đầu phá án, vào phòng, hồ sơ thám tử, đăng xuất, vụ án cộng đồng).

Không sửa các trang/module của agent khác (phòng, vụ án, workshop, kết quả, game). Nhánh của bạn được merge đầu tiên.
```

## Prompt agent 2 — Phòng, vụ án, hồ sơ, workshop & kết quả

```text
Bạn là agent 2/4 đưa giao diện "Bảng phá án" vào Sir Locked. Làm trong thư mục hiện tại (nhánh ui/bpa-2-trang). Đọc trước: docs/design/bang-pha-an/AGENTS-CHUNG.md và docs/design/bang-pha-an/README.md.

Bạn được sửa:
- src/FE/Client/js/pages/createRoomPage.js, joinRoomPage.js, lobbyPage.js, casesPage.js, caseDetailPage.js, detectivePage.js, challengePage.js, resultPage.js, workshopPage.js, workshopCasePage.js, pages/workshop/*.js
- src/FE/css/05-create-room.css, 06-join-room.css (chỉ để gỡ luật cũ bị xung đột)
- File mới: src/FE/css/30-bpa-rooms.css, 31-bpa-lobby.css, 32-bpa-cases.css, 33-bpa-profile.css, 34-bpa-workshop.css, 35-bpa-result.css (import trong trang tương ứng)

Việc cần làm, mỗi trang đối chiếu bản xem-truoc:
1. Tạo phòng / vào phòng → Rooms.html (thẻ "Tạo phòng", ô mã 6 ký tự). Backend không có danh sách phòng công khai và chế độ công khai/riêng tư nên bỏ bảng phòng công khai và nút chọn chế độ.
2. Phòng chờ → Lobby.html: bìa hồ sơ vụ án, thẻ mã phòng + sao chép + liên kết mời, 2 thẻ thám tử nối chỉ đỏ (chỉ vẽ ra kèm dấu "ĐỦ ĐỘI" khi cả hai sẵn sàng), 2 thẻ vai trò, thanh hành động Sẵn sàng / Bắt đầu điều tra / Rời phòng. Giữ nguyên realtime và roomApi.selectRole/ready/start/leave.
3. Vụ án + chi tiết → Cases.html: "Tiếp tục ván đang chơi" (roomApi.mine), "Đã có mã phòng?", ngăn kéo hồ sơ và bìa chi tiết (nhân vật liên quan bằng chữ viết tắt, các hồi).
4. Hồ sơ thám tử (detectivePage.js) → Profile.html: thẻ thám tử, tiến độ cấp bậc bằng chỉ đỏ, ô số liệu, tủ huy hiệu, case tôi tạo, tài khoản (xác minh email, đổi mật khẩu). Chưa có dữ liệu lịch sử ván và túi đồ nên bỏ hai phần đó.
5. Thử thách tuần → Challenge.html: trang báo, đồng hồ lật đếm ngược, bảng xếp hạng có nút Phá nhanh nhất / Top điểm, trạng thái đã kết thúc và chưa có thử thách.
6. Workshop → Workshop.html (banner vụ của tuần, thẻ vụ án, sắp xếp); Workshop chi tiết → WorkshopCase.html (tab Thống kê / Đánh giá / Bảng xếp hạng có lens wipe, ô KPI, form đánh giá, bảng xếp hạng).
7. Kết quả → Result.html: trang báo với dấu PHÁ ÁN THÀNH CÔNG / VỤ ÁN BẾ TẮC đập xuống, điểm đếm lên, thanh điểm, các dòng phân tích cáo buộc có dấu CHÍNH XÁC / SAI, cột cáo buộc của bạn và sự thật, các nút hành động. Dòng thời gian chỉ làm nếu dữ liệu có.

Không sửa index.html, main.js, CSS nền tảng hay file game. Nhánh của bạn merge sau agent 1.
```

## Prompt agent 3 — Hiện trường (HUD, máy ảnh, túi đồ, qua phòng)

```text
Bạn là agent 3/4 đưa giao diện "Bảng phá án" vào màn chơi Sir Locked. Làm trong thư mục hiện tại (nhánh ui/bpa-3-hien-truong). Đọc trước: docs/design/bang-pha-an/AGENTS-CHUNG.md và docs/design/bang-pha-an/README.md. Bản mẫu: xem-truoc/Game.html (thử ?view=kham-pha, may-anh, tui-do, hoi-thoai, phat-hien, qua-phong, hanh-lang và ?role=tham-van-vien), mã nguồn nguon-canvas/Game.dc.html.

Bạn được sửa:
- src/FE/Client/js/pages/gamePage.ts, CHỈ các phần: class scene Phaser (khung camera, nhãn "Đang dùng"), draw(), investigationToolDock(), inventoryDrawer(), inventoryDetailOverlay(), introOverlay(), inspectOverlay(), photoOverlay(), puzzleOverlay(), puzzleSolveOverlay(), dialogueOverlay(), showDiscovery(), renderRoleGuide(), renderReconnectWaitStatus(), renderRecoveryStatus(), toggleCameraMode(), goToScene() và chỗ áp state khi đổi cảnh.
- src/FE/Client/js/game/gameShell.ts, dialoguePresenter.ts, cooperativePing.ts, roleGuide.js, presentationMedia.ts
- src/FE/css/10-game.css; file mới src/FE/css/40-bpa-game.css (import ở đầu gamePage.ts)
KHÔNG sửa caseFileDrawer(), caseFileOverlay(), mapOverlay(), logOverlay(), renderChallengePanel(), accusationModal() và các hàm accusation*, game/pairedConfrontation.ts, crackPayoff.ts, accusationConsensus.ts (của agent 4).

Việc cần làm:
1. HUD: thẻ mục tiêu (hồi, tên cảnh, currentObjective, tiến độ), đồng hồ, bảng "Đội điều tra" (vai, vị trí, trạng thái kết nối), dòng gợi ý phím, khay công cụ (Máy ảnh Z, Túi đồ B, Hồ sơ vụ án, Địa điểm, Gợi ý, Hướng dẫn, Gọi đồng đội) có khóa theo vai; nhãn hotspot khi rê chuột.
2. Máy ảnh: giữ logic chụp hiện có (captureCameraFrame → captureClue → HIT / NEAR_MISS / MISS). Đổi giao diện: lớp xám, vùng ngoài khung tối hơn, 4 góc vàng, nhãn "Máy ảnh"; hiệu ứng mở/đóng riêng (màn trập 6 lá, 2 dải đen trên dưới, góc khung bay vào); thanh hướng dẫn mảnh có "Đã chụp" (capturedClueIds) và "Chụp trượt" (đếm ở client từ kết quả MISS vì server chưa trả CameraMissCount); ảnh in ra dùng chính Blob vừa chụp, dấu "CHƯA RÕ" cho NEAR_MISS và "CHỤP TRƯỢT" cho MISS; thông báo tiếng Việt khi server trả câu tiếng Anh.
3. Túi đồ: cặp da 12 ô theo bản mẫu, nút Kết hợp / Đang kết hợp / Dùng N / đóng, thẻ chi tiết trượt ra; hiệu ứng mở nắp và đóng nắp (khi đóng giữ DOM khoảng 300 ms rồi mới gỡ); chế độ "Đang dùng: …" với món đồ đi theo con trỏ. Giữ combineItems / useSelectedItemOnTarget.
4. Qua phòng: khi currentSceneId đổi, phát lớp chuyển cảnh (đẩy vào lối ra, khép tối, thẻ tiêu đề hồi + tên cảnh có chỉ đỏ nối cảnh cũ sang cảnh mới, mở ra cảnh mới); reduced motion thì mờ dần + thẻ tiêu đề.
5. Hội thoại, menu Gọi đồng đội, thẻ "Phát hiện mới", hướng dẫn vai trò, banner mất kết nối: đổi sang phong cách bản mẫu, giữ nguyên hành vi và phím tắt.
Chân dung/sprite nhân vật lấy từ dữ liệu vụ án giữ nguyên cách hiển thị; không thêm ảnh nhân vật mới.

Nhánh của bạn merge sau agent 1 và 2; agent 4 sẽ rebase lên nhánh của bạn.
```

## Prompt agent 4 — Hồ sơ vụ án, đối chất, cáo buộc

```text
Bạn là agent 4/4 đưa giao diện "Bảng phá án" vào các lớp phủ trong màn chơi Sir Locked. Làm trong thư mục hiện tại (nhánh ui/bpa-4-ho-so). Đọc trước: docs/design/bang-pha-an/AGENTS-CHUNG.md và docs/design/bang-pha-an/README.md. Bản mẫu: xem-truoc/CaseFile.html (?tab=chung-cu|loi-khai|pha-vo|suy-luan|ban-do|nhat-ky|so-tay, ?final=san-sang), Confront.html (?phase=de-xuat|cung-xem-xet|pha-vo|chua-dung), Accuse.html (?phase=soan|doc-lai|da-xac-nhan); mã nguồn trong nguon-canvas/.

Bạn được sửa:
- src/FE/Client/js/game/pairedConfrontation.ts, crackPayoff.ts, accusationConsensus.ts, gameUiModel.ts (nếu cần)
- src/FE/Client/js/pages/gamePage.ts, CHỈ các hàm: caseFileDrawer(), evidencePhotoMarkup(), caseFileOverlay(), mapOverlay(), logOverlay(), renderChallengePanel(), accusationModal(), accusationConsensusPanel(), accusationSummaryRows(), optionPicker(), accusationClaimLabel() và handler sự kiện gắn với các phần này.
- File mới: src/FE/css/41-bpa-casefile.css (import ở đầu pairedConfrontation.ts, KHÔNG import trong gamePage.ts)
KHÔNG sửa HUD, camera, túi đồ, hội thoại, chuyển cảnh, 10-game.css (của agent 3).

Việc cần làm:
1. Hồ sơ vụ án → CaseFile.html: bìa hồ sơ manila, tab dọc dạng phiếu (Chứng cứ vật lý, Lời khai, Phá Vỡ Lời Dối, Suy luận, Bản đồ điều tra, Nhật ký phối hợp; Sổ tay riêng chỉ khi game đã có ghi chú riêng), nhãn RIÊNG / ĐÃ CHIA SẺ theo vai, chi tiết chứng cứ, dòng tiến độ, nút Lập cáo buộc theo trạng thái, đóng bằng Esc, đổi tab có lens wipe. Bản đồ và Nhật ký đang là lớp phủ riêng; đưa vào làm tab nếu không phá luồng hiện có.
2. Cùng xem xét / Phá Vỡ Lời Dối → Confront.html: giai đoạn đề xuất (phong bì niêm phong khi chờ đồng đội), xem xét cặp LỜI KHAI ↔ CHỨNG CỨ nối chỉ đỏ qua kính lúp, ô xác nhận Bạn / Đồng đội; crackPayoff: dấu PHÁ VỠ LỜI DỐI, thẻ lời khai bị xé, thẻ sự thật mới; thất bại: CẶP CHƯA ĐÚNG kèm gợi ý.
3. Cáo buộc cuối cùng → Accuse.html: hàng nghi phạm dạng bảng tên (chữ viết tắt, bóng đen), chỉ đỏ từ nghi phạm tới các ô luận điểm, chọn động cơ/phương thức, gán chứng cứ (giữ assignEvidenceToClaim), màn cùng đọc lại với "Tôi đã đọc lại" và hai ô xác nhận, dấu ĐÃ NỘP CÁO BUỘC.
Giữ nguyên toàn bộ luồng dữ liệu, sự kiện realtime và quy tắc đồng thuận.

Gom thay đổi trong gamePage.ts vào commit riêng để dễ rebase. Nhánh của bạn merge cuối cùng: rebase lên nhánh agent 3 trước khi merge.
```
