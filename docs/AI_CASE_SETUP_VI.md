# Tạo vụ án AI bằng bot Claude (bridge)

Từ đợt VUAN-1, server **không gọi API AI nào**. Mọi bước tạo vụ (xem trước truyện, sự thật, logic, bố cục, kiểm tra vị trí, cutscene) được đưa vào **hàng chờ Claude**. Bot là Claude Code chạy trên máy Yen hoặc VPS studio, lấy việc qua **API bridge** có khóa riêng, viết JSON và nộp lại. Server giữ nguyên prompt, schema, bộ kiểm tra, các cổng duyệt, sửa theo phạm vi, import và publish; chỉ đổi người viết.

Người chơi chỉ nhận vụ đã đăng, không bao giờ gọi tới Claude. Bot **không bao giờ publish**: chỉ ADMIN bấm Xuất bản trên admin.

## Cấu hình

| Khóa | Ý nghĩa |
| --- | --- |
| `Bridge__Key` | Khóa của bot, 32–256 ký tự. Chỉ nằm trong biến môi trường (file env của API trên server). Đặt bằng `bash scripts/set-bridge-key.sh`. Không có khóa thì mọi API bridge trả `503 BRIDGE_NOT_CONFIGURED` và form tạo vụ báo `BRIDGE_NOT_CONFIGURED`. |
| `Bridge__LeaseHours` | Thời gian bot giữ một yêu cầu đã nhận (mặc định 2 giờ). Hết lease thì yêu cầu nhận lại được. |
| `Bridge__RateLimitPerMinute` | Giới hạn số lần gọi bridge mỗi phút theo địa chỉ (mặc định 240). |
| `Bridge__MaxAssetBytes` | Dung lượng tối đa mỗi hình (mặc định 5 MB). |
| `Bridge__ExposeMockResponses` | Chỉ Development/Testing: `take` trả kèm câu trả lời mock để chạy thử không cần Claude. Production luôn tắt. |
| `Bridge__AllowLocalAssetStorage` | Chỉ ngoài Production: lưu hình bot tải lên vào `src/FE/public/assets/ai-generated/bridge/` khi chưa có Cloudinary. |
| `AiGeneration__MockAiResponses` / `AiGeneration__AiDryRun` | Trả JSON mock như trước, không tạo yêu cầu bridge nào. Dùng cho test và `scripts/start-local-demo.ps1`. Biến cũ `MOCK_AI_RESPONSES`, `AI_DRY_RUN` và cách viết `OpenAI__…` của các cờ này vẫn được đọc. |
| `AiGeneration__SkipAssetGeneration`, `…GenerateJsonOnly`, `…ValidateOnly`, `…DisableAutoPublish`, `…EnableBlindSolvabilityReview` | Các cờ an toàn cũ, chuyển từ mục `OpenAI` sang mục `AiGeneration`. |
| `Cloudinary__*` | Bắt buộc để bot tải hình lên trên server thật. Thiếu thì upload trả `ASSET_STORAGE_UNAVAILABLE` (không chặn việc đặt đơn). |

Đã gỡ: `OpenAI__ApiKey`, các model, sổ chi phí USD (`AiUsage__*`, `AiQuota__EstimatedCaseCostUsd`, `AiQuota__GlobalBudgetUsd`), trang chi phí. Dữ liệu cũ trong MongoDB (`aiUsageEvents`, `aiBudgetLedger`) **không bị xóa**, chỉ không còn được đọc hay ghi. Sau khi deploy, xóa dòng `OpenAI__ApiKey` khỏi file env trên server và thu hồi khóa ở trang OpenAI.

`AiQuota__Enabled`, `MaxActiveDraftsPerUser`, `MaxCasesPerUserPerDay` vẫn là hạn mức số bản nháp (không có tiền).

## Đơn hàng, ADMIN và VIP

- `POST /api/admin/ai-cases` nhận thêm object `order` (mọi trường tùy chọn): `world` (`HANG_DUONG_VICTORIAN` | `TAISHO_JAPAN` | `SHANGHAI_1930` | `NEW_WORLD`), `locationIds[]`, `npcIds[]` (key trong thư viện hình), `suspectCount` 3–6, `characterNotes` ≤ 600 ký tự, `weather` (`CLEAR` | `RAIN` | `WIND` | `SNOW` | `STORM` | `AUTO`), `timeOfDay` (`DAY` | `DUSK` | `NIGHT` | `AUTO`), `playMinutes` 20/30/45/60, `contentLevel` (`LIGHT` | `STANDARD`), `pixelLabCap` 0/30/60/100, `reviewMode` (`FULL` mặc định | `FAST`). Ô "Ý tưởng" (`prompt`) dài tối đa 2.000 ký tự.
- Đơn được lưu trên draft và chèn vào cuối prompt của **mọi bước** dưới dạng khối `CREATOR ORDER`. Bộ chọn bối cảnh ngẫu nhiên chỉ chọn trong thế giới đã chọn.
- **ADMIN** đặt đơn: vào hàng chờ ngay (`QUEUED_FOR_CLAUDE`).
- **VIP** đặt đơn: `AWAITING_OWNER_APPROVAL`, chưa có yêu cầu bridge nào; server ép `reviewMode = FULL` và `pixelLabCap = 30`. ADMIN duyệt bằng `POST /api/admin/ai-cases/{id}/approve-order` hoặc từ chối bằng `POST …/reject-order` với `{ "reason": "…" }`. Cả hai ghi vào nhật ký admin (`ai-order.approve`, `ai-order.reject`). Đơn bị từ chối không tính vào hạn mức tuần.
- Mỗi VIP đặt tối đa **2 đơn mỗi tuần** (thứ Hai–Chủ nhật, giờ Việt Nam). ADMIN đổi bằng `GET/PUT /api/admin/ai-cases/settings` với `{ "vipWeeklyOrderLimit": n }` (ghi nhật ký `ai-settings.update`).
- Trạng thái đơn (`orderStatus`, kèm `orderStatusHistory` có mốc thời gian): `AWAITING_OWNER_APPROVAL` → `QUEUED_FOR_CLAUDE` → `CLAUDE_WORKING` → `AWAITING_GATE` → … → `SUBMITTED` (sẵn sàng đăng hoặc đã import). Thêm `REJECTED`, `CANCELLED`.

## Hàng chờ Claude (park/resume)

- Mỗi câu hỏi là một tài liệu trong collection `aiBridgeRequests` (ownerType `CASE_DRAFT` hoặc `CUTSCENE`, kind `JSON` hoặc `ASSETS`, trạng thái `PENDING` | `TAKEN` | `SUBMITTED` | `ACCEPTED` | `REJECTED` | `STALE` | `CANCELLED`).
- `requestKey` xác định = SHA-256(ownerType, ownerId, `GenerationRunId`, bước, số lần thử, thứ tự của lời gọi cùng bước và cùng lần thử trong lượt chạy). Chạy lại bước nào thì tìm lại đúng câu trả lời cũ.
- Chưa có câu trả lời: server lưu yêu cầu `PENDING` rồi **đỗ** draft (`queueState = AWAITING_CLAUDE`, `claudeWait` ghi requestId, bước, thời điểm). Đây không phải lỗi, không retry theo backoff.
- Bot nộp câu trả lời hợp lệ: draft quay lại hàng chờ **với cùng `GenerationRunId`**, worker chạy lại từ checkpoint; câu đã có trả ngay, gặp câu chưa có thì đỗ tiếp.
- Chạy lại mà prompt khác bản đã lưu (bỏ qua mốc thời gian `…At`): yêu cầu cũ thành `STALE`, server hỏi lại và ghi cảnh báo `STALE` vào nhật ký draft.
- Draft cũ đang `GENERATING_*` từ thời OpenAI: sau deploy tự vào hàng chờ, gặp bước AI đầu tiên thì đỗ chờ Claude, không hỏng.
- Hủy draft hoặc từ chối đơn: các yêu cầu đang mở thành `CANCELLED`.

## Kiểm schema khi nhận

Thay cho structured output của OpenAI, server kiểm JSON bot nộp theo đúng JSON Schema của bước (thư viện **JsonSchema.Net 7.3.4**, ghim version). Sai thì trả `{ accepted: false, errors: ["$.stages[0].title: … (type)", …] }`, yêu cầu thành `REJECTED` nhưng vẫn mở để bot sửa và nộp lại. Đúng thì đi tiếp qua các validator sẵn có (`CaseValidationService`, đồ thị nhân quả, đối chất, 11 loại giải đố, review ngữ nghĩa…).

## API bridge cho bot (`/api/bridge/*`)

Xác thực chỉ bằng header `X-Bridge-Key` (so khớp thời gian hằng, không log header). JWT không mở được bridge; khóa bridge không mở được API admin.

| API | Việc |
| --- | --- |
| `GET /api/bridge/ping` | Kiểm khóa; `assetStorage` cho biết server có nơi lưu ảnh chưa (Cloudinary, hoặc lưu local ngoài Production) |
| `GET /api/bridge/requests?status=PENDING` | Liệt kê yêu cầu (đơn VIP chỉ hiện sau khi được duyệt) |
| `POST /api/bridge/requests/{id}/take` | Nhận: prompt, instructions, schema, tóm tắt đơn |
| `POST /api/bridge/requests/{id}/release` | Trả lại |
| `POST /api/bridge/requests/{id}/submit` | Nộp JSON → kiểm schema → lưu → chạy tiếp → `{accepted, errors, next}` |
| `GET /api/bridge/drafts/{id}` | Trạng thái, cổng đang chờ, báo cáo validator, việc cần làm tiếp |
| `GET /api/bridge/drafts/{id}/player-view` | Những gì người chơi thấy, đã bỏ lời giải (cho thám tử mù) |
| `GET /api/bridge/drafts/{id}/case-json` | Case JSON đầy đủ, có lời giải, cho tool chạy thử trên máy bot: sau import là vụ đã lưu (`source: IMPORTED`, giữ metadata của server), trước đó là JSON của draft (`DRAFT`) |
| `GET /api/bridge/drafts/{id}/assets-needed` | Các ô hình (bìa, nền cảnh, sprite, chân dung, vật phẩm), mô tả mỹ thuật, kích thước, url hiện tại |
| `POST /api/bridge/drafts/{id}/assets` | Multipart `slotId` + `file`: PNG/WebP thật, ≤ 5 MB, giữ alpha, lên Cloudinary |
| `POST /api/bridge/drafts/{id}/assets/complete` | Báo đủ hình, pipeline đi tiếp |
| `PUT /api/bridge/drafts/{id}/report` | Lưu `report.md` của bot; admin xem trong chi tiết draft |
| `POST /api/bridge/drafts/{id}/approve-gate` | Chỉ đơn `reviewMode = FAST`, cổng `STORY`, `LOGIC`, `LAYOUT`. Cổng `TRUTH` luôn trả 403 |
| `POST /api/bridge/drafts/{id}/import` | Import bản nháp để chạy thử (không publish; người chơi không thấy) |
| `GET/PUT /api/bridge/library` | Thư viện hình dùng chung (`assetLibrary`, upsert theo `key`). Mỗi mục có thêm `prompt`, `files` (vai → URL: `sprite`, `idle` 1152×128, `portrait` 288×288, `thumb`…), `retired` (ảnh hỏng, form đặt đơn không hiện). GET của bot mặc định kèm mục retired (`includeRetired=false` để bỏ) |
| `POST /api/bridge/library/files` | Multipart `key` + `role` + `file` (PNG/WebP thật, ≤ 5 MB): lưu ảnh thư viện lên Cloudinary ở `<folder>/library/<key>/<role>-<sha12>`, trả URL; gửi lại cùng ảnh ra cùng địa chỉ |

Thư viện cho form: `GET /api/admin/ai-cases/library?world=&kind=` (ADMIN và VIP), không có mục `retired`.

Phía bot (MCP `sirlocked-studio`, skill `/tao-vu-an`, cách cài trên máy Yen và VPS studio): xem [docs/studio-vps.md](studio-vps.md).

## Tài nguyên: chế độ "Claude tải lên"

Không còn gpt-image. Bước bố cục và bước tài nguyên cuối mỗi bước tạo một yêu cầu `ASSETS`: bot xem `assets-needed`, tải từng hình, gọi `assets/complete`. Sau đó server hỏi Claude bố cục cảnh (`PlanScenePlacement`) và kiểm tra vị trí (`VerifyScenePlacement`) như các bước JSON khác; prompt liệt kê URL các hình. QA nền hoặc vị trí trượt thì server xin tải lại đúng ô đó một lần rồi mới báo lỗi. `regenerate-assets` và `regenerate-failed-assets` tạo lại yêu cầu `ASSETS` cho các ô cần thay.

## Cutscene

Nút "Tạo bằng AI" của cutscene tạo yêu cầu bridge `ownerType = CUTSCENE`; trang cutscene hiện "đang chờ Claude" tới khi bot nộp. Bấm lại thì tiếp tục đúng lượt đang chờ, không tạo yêu cầu thứ hai. Khởi động server không còn tự xếp cutscene cho bot.

## Thử trên máy

- Không cần Claude: `scripts/start-local-demo.ps1` (mock như trước).
- Xưởng của bot trọn vòng (MCP thật, không cần Claude): `cd tools/studio-mcp && npm run e2e:local`.
- `POST /api/admin/cases/import-json` nhận thêm `preserveServerMetadata: true` để giữ metadata AI (preset, phiên bản hợp đồng) khi import: **chỉ có tác dụng ngoài Production** (stack chạy thử của bot dùng); Production luôn bỏ qua cờ này.
- Chạy qua bridge bằng mock: `scripts/start-local-demo.ps1 -Bridge`, rồi `node scripts/bridge-smoke.mjs` với cùng `SIRLOCKED_BRIDGE_KEY` trong biến môi trường. Script tạo đơn → nhận từng yêu cầu → nộp JSON mock (`AiCaseMockFactory`) → qua các cổng → tải hình giả → `READY_TO_PUBLISH` → import (không publish), và báo lỗi nếu có yêu cầu nào thành `STALE`.

## Khi tạo chưa được

- `BRIDGE_NOT_CONFIGURED`: server chưa có `Bridge__Key`. Chạy `bash scripts/set-bridge-key.sh`.
- `AI_WEEKLY_LIMIT`: VIP đã dùng hết số đơn của tuần.
- `AI_ORDER_INVALID`: một lựa chọn trong `order` không hợp lệ.
- `AI_ORDER_AWAITING_APPROVAL`: đơn VIP chưa được duyệt.
- `AI_ACTIVE_DRAFT_LIMIT`, `AI_DAILY_LIMIT`: hạn mức số bản nháp khi `AiQuota__Enabled=true`.
- `ASSET_STORAGE_UNAVAILABLE`: bot tải hình khi server chưa có Cloudinary.

## Sửa chất lượng từ checkpoint

Các chức năng sửa theo phạm vi (sửa truth, sửa tiếp candidate, sửa logic, thay JSON) giữ nguyên như trước; khác duy nhất là mỗi lần sửa cần Claude viết thì tạo yêu cầu bridge thay vì gọi OpenAI. Các bước cần Claude chỉ chạy trong lượt của hàng chờ: thao tác đồng bộ trên admin (ví dụ thay JSON) mà cần review ngữ nghĩa thì báo bước đó chưa chạy; dùng **Tiếp tục** hoặc **retry-json** để đưa vào hàng chờ.
