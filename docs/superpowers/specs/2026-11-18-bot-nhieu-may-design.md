# Bot chạy nhiều máy, tự gỡ treo, theo đúng bản trên server

Ngày: 18/11/2026. Nền: `origin/feature/kiet-auth-validation` (bản đang chạy trên sirlocked.id.vn; đã chứa toàn bộ `feature/case-creating`). Tiếp nối thiết kế `2026-11-18-bot-tu-chay-design.md`.

## Vì sao

Bot tạo vụ án đã tự chạy trên máy chủ dự án (runner + hub `/hubs/bridge`), nhưng chạy thật hôm 18/11 cho thấy nó đứng vì những lý do vặt:

- thiếu công cụ (`curl` bị chặn) nên chạy 19 lượt liền không làm gì, tốn lượt Claude;
- bot dừng mà vẫn giữ yêu cầu, đơn đứng 2 tiếng (lease) dù máy rảnh;
- lỡ tắt cửa sổ runner là bot ngừng hẳn;
- server đóng bước (đối chất bị chấm 0,6) và người phải tự đọc log mới biết làm gì.

Chủ dự án muốn bot **chạy trơn tru, không cần ai trông**, và muốn **các thành viên trong nhóm cùng chạy bot trên máy của mình** (mỗi người một tài khoản Claude Pro) để có nhiều sức chạy, và để khi một máy hết lượt Claude thì việc chuyển sang máy khác, kể cả khi đang làm dở.

## Mục tiêu

1. **Nhiều máy, mỗi máy một khóa.** Admin cấp và thu hồi khóa từng máy trên `/admin/ai`; server biết máy nào đang giữ việc nào.
2. **Không đơn nào đứng vì một máy.** Máy hết lượt, tắt, treo hay rớt mạng thì việc nó giữ được trả lại trong vài phút và máy khác nhận tiếp, có đủ file làm việc của đơn.
3. **Không chạy lặp vô ích.** Việc bot không làm được thì thành thẻ "Bot kẹt: <lý do>" trên `/admin/ai`, không gọi bot lại cho tới khi người bấm.
4. **Bot chạy đúng bản trên server.** Máy nào cũng chạy MCP, skill, runner và bước chạy thử của đúng commit đang deploy, dù chủ máy đang code ở nhánh nào.
5. **Cài một lần cho mọi máy có repo.**

## Không làm

- Không cài cho máy trắng không có repo (đã bỏ).
- Không chuyển bot lên VPS, không dùng API key Anthropic; hướng VUAN-7 (`feat/claude-vu-an`, VIP trả xu) đã bỏ.
- Không thay đổi pipeline tạo màn (các bước, 4 cổng, 5 lớp kiểm tra).
- Không cho bot publish, không cho bot tự duyệt cổng TRUTH, không cho bot vượt trần PixelLab của đơn.

## Điều không được xảy ra

- Máy hỏi server theo chu kỳ (chủ dự án đã loại từ thiết kế trước). Server được dùng hẹn giờ của chính nó; máy chỉ có hẹn giờ một lần (ví dụ "hết lượt tới 15:00 thì thức dậy").
- Bot có quyền shell hay tải link tùy ý để "tự sửa": bot đọc đơn do VIP viết.
- Khóa bridge hay khóa PixelLab lộ ra log, URL, file trong repo hay trang web (khóa máy chỉ hiện một lần lúc tạo).
- Bot chạy code khác với server, hoặc code đang sửa dở trong thư mục của chủ máy.
- Một máy hỏng làm đơn đứng quá vài phút mà không ai biết.

## Cách làm đã chọn

| | Cách | Được | Mất |
|---|---|---|---|
| A | Một khóa chung, máy nào nhanh tay thì nhận (như bây giờ) | Không phải sửa server | Không thu hồi được từng máy, không biết ai giữ việc, không trả việc thay máy chết |
| **B (chọn)** | **Khóa riêng từng máy; server điều phối: gắn đơn mềm với máy, trả việc khi máy chết hoặc hết lượt, đánh dấu việc kẹt; máy tự theo commit của server** | Đáp ứng cả 5 mục tiêu | Sửa cả server, runner, MCP, trang admin; một lần deploy |

Về chỗ bot lấy code, đã cân nhắc: zip thả vào repo (cũ ngay sau lần deploy kế), cài MCP vào cấu hình chung của Claude (bước chạy thử vẫn build code dở của chủ máy), bắt mọi nhánh chứa MCP (nhánh cũ vẫn hỏng). Chọn: **thư mục bot riêng, ngang hàng repo, luôn ở đúng commit server đang chạy.**

## Thiết kế

### 1. Máy và khóa (server + `/admin/ai`)

- Collection mới `bridgeMachines`: `id`, `name` (ví dụ "Máy của An"), `keyHash` (SHA-256 của khóa), `createdAt`, `createdBy`, `revokedAt`, `lastSeenAt`, `online`, `pausedUntil`, `pauseReason`, `commit` (bản bot máy đang chạy), `runningSince`.
- Khóa máy: 48 ký tự ngẫu nhiên, sinh trên server, chỉ trả về **một lần** khi tạo. Server chỉ lưu hash.
- `BridgeKeyAttribute` và `BridgeHubKeyGate` nhận khóa nếu hash khớp một máy chưa thu hồi; gắn `machineId` vào request (HttpContext item / hub connection). Khóa chung cũ `Bridge:Key` vẫn được nhận như một máy tên "Khóa chung (cũ)" để chuyển tiếp; admin bỏ nó khỏi cấu hình server khi mọi máy đã có khóa riêng.
- Thu hồi: đặt `revokedAt`, ngắt kết nối hub của máy đó, trả mọi việc nó đang giữ.
- **Trang "Máy chạy bot"** (mục mới trong `/admin/ai`, chỉ ADMIN):

```
Máy chạy bot                                              [+ Thêm máy]
Tên            Trạng thái                          Bản bot    Lần cuối
Máy của Khoa   Đang làm "Toa cáp treo trống" 12'   f10c95b    vừa xong
Máy của An     Hết lượt Claude tới 15:00           f10c95b    3 phút
Máy của Bình   Lệch bản (đang cập nhật)            9ca5017    1 phút   [Thu hồi]
```

  "Thêm máy": nhập tên → hiện khóa một lần, nút chép, và 3 lệnh cài (mục 6).

### 2. Điều phối việc (server)

- `AiBridgeRequest` thêm `TakenByMachineId`. Draft thêm `PreferredMachineId`: máy nhận yêu cầu đầu tiên của draft thành máy ưu tiên.
- **Ai được nhận một yêu cầu PENDING:** máy ưu tiên của draft; hoặc mọi máy nếu draft chưa có máy ưu tiên, máy ưu tiên đang offline / bị thu hồi / đang nghỉ vì hết lượt, hoặc yêu cầu đã PENDING quá **5 phút** mà máy ưu tiên chưa nhận. Máy khác nhận thì `PreferredMachineId` chuyển sang máy đó.
- Máy lệch bản (`commit` khác commit server) không được nhận việc nào.
- `WorkAvailable` gửi **theo từng máy**, chỉ khi máy đó có việc được nhận. `PendingCount` và `GET /api/bridge/requests` trả đúng danh sách của máy hỏi. `take` một yêu cầu không phải của mình → 409 `BRIDGE_NOT_YOURS`.
- Hẹn giờ phía server (dịch vụ nền, mỗi phút): yêu cầu PENDING quá 5 phút mà máy ưu tiên chưa nhận → báo các máy khác.

### 3. Trả việc tự động

- **Runner trả việc sau mỗi lượt bot:** bot thoát với bất cứ mã nào → runner gọi hub `ReleaseMine()`; server trả mọi yêu cầu TAKEN của máy đó (AWAITING_DECISION giữ nguyên) và báo máy có việc. Luật 9 của skill (bot tự trả trước khi dừng) giữ nguyên làm lớp đầu.
- **Máy mất kết nối:** hub `OnDisconnectedAsync` → nếu máy không nối lại trong **2 phút**, server trả việc của máy đó.
- **Giới hạn thời gian mỗi lượt:** runner dừng bot sau **45 phút** (cấu hình được), rồi `ReleaseMine()`.
- Lease vẫn là lưới an toàn cuối, giữ 2 giờ.

### 4. Việc kẹt thành thẻ, không chạy lặp

- Trạng thái yêu cầu mới `BLOCKED` (`BlockedReason`, `BlockedAt`, `BlockedByMachineId`): không nhận được, không tính vào việc chờ.
- **Bot tự báo:** tool MCP mới `bridge_block { requestId, reason }`. Skill: kẹt vì thứ tạm thời (hết lượt, mạng, hết giờ) thì `bridge_release`; kẹt vì thứ bot không tự gỡ được (thiếu công cụ, thiếu quyền, server từ chối lặp lại cùng lỗi, cần người quyết mà không hợp `draft_ask`) thì `bridge_block` với lý do một-hai câu tiếng Việt.
- **Server tự phát hiện (khi bot không báo):** runner gọi `RunStarted()` và `RunFinished(exitCode, summary)` (summary = 500 ký tự cuối trong output của bot). Server chụp danh sách việc máy được nhận lúc `RunStarted`. Lúc `RunFinished`: nếu lượt đó **không tiến triển ở bất kỳ yêu cầu nào** trong danh sách (không nhận, nộp, hỏi hay chặn cái nào), mọi yêu cầu trong danh sách tăng `NoProgressRuns`; có tiến triển ở dù một yêu cầu thì không tăng gì (bot làm lần lượt nhiều yêu cầu, ví dụ 4 bố cục, không bị chặn oan). Yêu cầu tới **2** lượt liền → `BLOCKED` với lý do = summary của lượt cuối. Yêu cầu có tiến triển thì đặt lại về 0.
- **Thẻ trên `/admin/ai`** (ở draft, cho admin và người đặt đơn, như thẻ quyết định hiện có): "Bot kẹt ở bước <step>: <lý do>" với nút **Thử lại** (về PENDING, đặt lại `NoProgressRuns`, báo máy) và **Bỏ yêu cầu này** (hủy yêu cầu như hủy bước hiện có).
- Bộ đếm "3 lượt liền thì chờ sự kiện" của runner giữ làm lưới an toàn.

### 5. Hết lượt Claude

- Runner nhận ra hết lượt từ output của `claude -p` (danh sách mẫu chữ trong một file riêng, có test; lấy giờ mở lại nếu output có, không có thì 1 giờ).
- Runner gọi `Pause(until, reason)`: server ghi `pausedUntil`, trả việc của máy, máy khác nhận thay. Runner hẹn một lần tới `until` rồi gọi `Resume()`.
- Trang "Máy chạy bot" hiện "Hết lượt Claude tới HH:MM".

### 6. Bot theo đúng bản trên server

- **Server công bố bản:** `deploy-server.sh` truyền commit vào bản build (`version.json` trong gói); `GET /api/version` (công khai) trả `{ commit, deployedAt }`; hub gửi commit cho máy lúc kết nối.
- **Deploy chặn bản không tải được:** `deploy-server.sh` dừng (không chỉ cảnh báo) khi repo có thay đổi chưa commit ở `src/`, `tools/`, `.claude/`, `scripts/`, hoặc commit HEAD không có trên nhánh nào của `origin`.
- **Thư mục bot:** `git worktree` ngang hàng repo, mặc định `<repo>\..\SirLocked-bot`, ở chế độ detached tại commit server (không thuộc nhánh nào, không ai commit vào đó). Runner, MCP, skill, `tmp/` của bot và bước chạy thử đều nằm ở đây.
- **Khi nào cập nhật:** lúc runner kết nối, khi server báo đổi bản (hub gửi `VersionChanged { commit }` cho mọi máy sau mỗi lần deploy), và trước mỗi lượt bot. Không được chỉ cập nhật trước lượt bot: máy lệch bản không được nhận việc nên sẽ không bao giờ có lượt để cập nhật.
- **Cách cập nhật**, runner: lấy commit server → khác commit thư mục bot thì `git fetch origin` + `git checkout --detach <commit>` → `npm ci` + build `tools/studio-mcp` nếu thư mục đó đổi → nếu `tools/studio-runner` đổi thì thoát với mã "khởi động lại" để Task Scheduler bật lại bản mới. Báo `commit` mới cho server.
- Commit server không có trên GitHub → runner không nhận việc, server hiện lý do ở trang máy.
- **Cài (mỗi máy một lần)**, từ repo ở nhánh nào cũng được:
  1. `git fetch origin` rồi `git worktree add --detach ..\SirLocked-bot <commit server>` (script in sẵn lệnh, lấy commit từ `/api/version`);
  2. đặt biến môi trường `SIRLOCKED_BRIDGE_KEY` (khóa máy) và `PIXELLAB_API_KEY` (khóa chung của nhóm, admin đưa riêng);
  3. trong `..\SirLocked-bot`: chạy `claude` một lần để tin cậy thư mục và duyệt MCP, rồi `scripts\install-studio-runner.ps1`.
  Đường dẫn thư mục bot không đổi nên chỉ duyệt một lần.

### 7. File làm việc của đơn lên server

- Endpoint mới `GET/PUT /api/bridge/drafts/{id}/files/{name}`: file chữ nhỏ (≤ 256 KB mỗi file, ≤ 20 file mỗi draft; tên `[a-z0-9._-]`).
- Bot giữ mọi file cần cho bước sau trong `tmp/drafts/<draftId>/` (receipts PixelLab, ghi chú, mã nhân vật…). `bridge_take` tự tải các file của draft về đó; `bridge_submit`, `draft_ask`, `bridge_block`, `bridge_release` tự đẩy lên. Skill chuyển `tmp/pixellab/<draftId>/receipts.json` về chỗ mới. `report.md` vẫn đi qua `draft_report` như hiện tại.
- Ảnh không đi đường này: đã có `asset_download` và `pixellab_character_zip`.

### 8. Runner bền hơn

- Chạy ẩn thật (Windows Terminal bỏ qua `-WindowStyle Hidden`): khởi động qua `conhost.exe --headless` hoặc một shim không cửa sổ; Task Scheduler khởi động lại khi runner thoát bất thường (không giới hạn 3 lần).
- Sửa hai cảnh báo: bỏ `Write(tmp/**)` khỏi danh sách quyền (đã có `Edit(tmp/**)`), cho bot stdin rỗng để khỏi chờ 3 giây.
- Log runner ghi tên máy và commit mỗi lượt.

### 9. Triển khai

- Nhánh mới từ `origin/feature/kiet-auth-validation`, mang theo các thay đổi chưa commit của `feature/case-creating` (`asset_download`, `pixellab_character_zip`, luật 9 của skill).
- Một lần deploy server. Thứ tự chuyển: deploy → admin tạo khóa cho từng máy → mỗi máy cài thư mục bot → khi mọi máy chạy khóa riêng, bỏ `Bridge:Key` cũ khỏi cấu hình server.
- Runner hiện tại (trên máy chủ dự án) không báo commit. Máy "Khóa chung (cũ)" được miễn kiểm tra lệch bản để nó vẫn chạy được trong thời gian chuyển; mọi máy dùng khóa riêng thì bị kiểm tra.

### 10. Kiểm thử

- **Server (integration, Mongo):** khóa máy đúng/sai/thu hồi; điều phối (máy ưu tiên, chuyển sau 5 phút, máy nghỉ, máy lệch bản, `BRIDGE_NOT_YOURS`); `ReleaseMine`; trả việc khi mất kết nối quá 2 phút và không trả khi nối lại kịp; `BLOCKED` sau 2 lượt không tiến triển, không chặn khi lượt có tiến triển ở yêu cầu khác, nút Thử lại; `VersionChanged` sau deploy; máy "Khóa chung (cũ)" được miễn kiểm tra bản; `Pause`/`Resume`; file của draft (giới hạn cỡ, tên).
- **Runner (node --test):** nhận ra hết lượt từ các mẫu output; hết giờ 45 phút thì dừng bot và trả việc; cập nhật thư mục bot (đổi commit, build lại khi `studio-mcp` đổi, thoát khi `studio-runner` đổi) lúc kết nối và khi nhận `VersionChanged`; không nhận việc khi commit không có trên GitHub.
- **MCP (node --test):** `bridge_block`; `bridge_take` tải file draft, các lệnh nộp/hỏi/chặn/trả đẩy file lên.
- **Trang admin (Playwright):** mục "Máy chạy bot" (thêm máy hiện khóa một lần, thu hồi, các trạng thái); thẻ "Bot kẹt" với hai nút.
- **Deploy script:** dừng khi có thay đổi chưa commit hoặc commit chưa đẩy.

## Để người làm tự quyết

- Tên collection, tên endpoint/hub method cụ thể, cách gắn `machineId` vào request.
- Cách chạy ẩn trên Windows (conhost headless hay shim), miễn không hiện cửa sổ và tự bật lại.
- Bố cục chi tiết của mục "Máy chạy bot" và thẻ "Bot kẹt", theo kiểu các thẻ hiện có trên `/admin/ai`.
- Danh sách mẫu chữ "hết lượt" ban đầu (thu từ output thật của `claude -p` nếu có).

## Các quyết định do Claude đặt (chủ dự án kiểm khi đọc)

- Chuyển đơn sang máy khác sau **5 phút** máy ưu tiên chưa nhận; trả việc sau **2 phút** mất kết nối; mỗi lượt bot tối đa **45 phút**; chặn sau **2** lượt không tiến triển.
- Khóa chung cũ vẫn chạy trong thời gian chuyển, như một máy tên "Khóa chung (cũ)".
- Trang "Máy chạy bot" chỉ ADMIN thấy; thẻ "Bot kẹt" thì người đặt đơn (kể cả VIP) cũng thấy và bấm được trên đơn của mình.
- Khóa PixelLab chung không lưu trên server; admin đưa cho từng người ngoài hệ thống.
- Máy thiếu .NET hoặc MongoDB thì bỏ bước chạy thử, ghi vào report, không coi là lỗi của vụ án.
- Thư mục bot mặc định `..\SirLocked-bot`, đổi được khi cài.
- Làm trên nhánh mới tách từ `feature/kiet-auth-validation` (bản đang deploy), không từ `feature/case-creating`: deploy từ `feature/case-creating` sẽ làm mất 6 commit của Kiet trên server. Đổi lại, nhánh này phụ thuộc nhánh của Kiet cho tới khi nhóm gộp.
- Máy "Khóa chung (cũ)" được miễn kiểm tra lệch bản trong thời gian chuyển.
