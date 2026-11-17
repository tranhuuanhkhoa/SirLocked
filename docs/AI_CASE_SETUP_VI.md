# Tạo vụ án AI bằng bot Claude (bridge)

Từ đợt VUAN-1, server **không gọi API AI nào**. Mọi bước tạo vụ (xem trước truyện, sự thật, logic, bố cục, kiểm tra vị trí, cutscene) được đưa vào **hàng chờ Claude**. Bot là Claude Code chạy trên máy Yen hoặc VPS studio, lấy việc qua **API bridge** có khóa riêng, viết JSON và nộp lại. Server giữ nguyên prompt, schema, bộ kiểm tra, các cổng duyệt, sửa theo phạm vi, import và publish; chỉ đổi người viết.

Người chơi chỉ nhận vụ đã đăng, không bao giờ gọi tới Claude. Bot **không bao giờ publish**: chỉ ADMIN bấm Xuất bản trên admin.

Bài này là hướng dẫn trọn vẹn cách tạo vụ bằng bot Claude: phần đầu cho người làm (Yen), phần sau là chi tiết server. Cài đặt máy chạy bot: [docs/studio-vps.md](studio-vps.md). Luật viết vụ: [docs/case-style-guide.md](case-style-guide.md). Âm thanh, thời tiết, bíp: [docs/case-audio-weather.md](case-audio-weather.md). Quy trình của bot: skill `.claude/skills/tao-vu-an/SKILL.md`.

## Tạo một vụ từ đầu đến cuối

| # | Ai | Làm gì | Ở đâu |
| --- | --- | --- | --- |
| 0 | Yen, một lần | Đặt khóa `SIRLOCKED_BRIDGE_KEY`, `PIXELLAB_API_KEY` vào biến môi trường của máy chạy bot; `cd tools/studio-mcp && npm ci`; `claude mcp list` thấy `sirlocked-studio` và `pixellab` là Connected | [studio-vps.md](studio-vps.md) mục A hoặc B |
| 1 | Yen (ADMIN) hoặc VIP | Đặt đơn: thế giới, địa điểm, nghi phạm, thời tiết, thời điểm, preset, mức nội dung, trần PixelLab, chế độ duyệt, ý tưởng. Bấm "Gửi đơn cho Claude" | `/admin/ai` |
| 2 | Yen | Đơn VIP: bấm **Duyệt đơn** (hoặc Từ chối). Đơn ADMIN vào hàng chờ ngay | bảng "Bản nháp AI gần đây" ở `/admin/ai` |
| 3 | Yen | Mở Claude Code ở gốc repo (`claude`), gõ `/tao-vu-an` | máy Yen hoặc VPS studio trong `tmux` |
| 4 | Bot | Viết xem trước truyện → dừng ở **cổng 1 STORY** | — |
| 5 | Yen | Đọc truyện, duyệt; gõ lại `/tao-vu-an` | `/admin/ai` → chi tiết draft |
| 6 | Bot | Viết sự thật, cho thám tử mù thử → **cổng 2 TRUTH** (luôn là Yen, kể cả chế độ nhanh) | — |
| 7 | Bot | Viết logic chơi: cảnh, giải đố, hội thoại, đối chất, **gợi ý 3 mức cho mọi câu hỏi**, kết thúc; agent `kiem-dinh` trả lời bước đánh giá → **cổng 3 LOGIC** | — |
| 8 | Bot | Hình nền cảnh (vụ pixel: khai `asset_plan`, thư viện → biến thể → PixelLab trong trần lượt) và bố cục pixel → **cổng 4 LAYOUT**; rồi sprite, chân dung, icon; nhạc, bíp, thời tiết | — |
| 9 | Bot | Import bản nháp (không đăng), Playwright tự chơi, viết `report.md` 5 lớp | chi tiết draft hiện `report.md` |
| 10 | Yen, hoặc VIP đã đặt đơn | Bấm **Chơi thử** ở bản nháp "Đã import, chưa đăng": mở phòng riêng, gửi **liên kết mời** cho một người chơi vai thứ hai (liên kết chỉ dùng được một lần; chỉ có mã phòng thì không vào được). Ván chơi thử không tính xếp hạng, không nhận thưởng. Chơi trên máy tính và điện thoại | `/admin/ai` |
| 11 | Yen | Ưng thì tự bấm **Xuất bản** | `/admin/cases/<caseId>` |

Chế độ nhanh (`reviewMode = FAST`, chỉ ADMIN chọn): bot tự qua STORY, LOGIC, LAYOUT khi cả 5 lớp kiểm tra đạt; Yen chỉ duyệt TRUTH và bản cuối. Bot **không bao giờ** publish: bridge không có đường publish.

Mỗi lần gõ `/tao-vu-an`, bot làm các đơn đang chờ rồi dừng ở cổng của Yen hoặc khi hết việc. Không có vòng lặp tự động; đơn chờ trong hàng tới lần gõ sau.

## Luật nội dung từ VUAN-6

### Gợi ý 3 mức cho mọi câu hỏi

Mọi câu hỏi trong vụ có gợi ý, để sau này gắn quảng cáo hoặc thu xu khi người chơi xin gợi ý.

- Mỗi cảnh (`SCENE`), mỗi lần đối chất (`CONFRONTATION`, theo `challengeId`), mỗi suy luận (`DEDUCTION`) có `hints` ở **đủ** `order` 1, 2, 3: mức 1 hướng chung, mức 2 chỉ chỗ cần xem, mức 3 gần như đáp án. Mức 1 và 2 không nêu tên hay ám chỉ hung thủ.
- Mỗi câu đố tương tác (`INTERACTIVE_PUZZLE`) có ít nhất 3 `solution.hints`. Câu đố cổ điển (mã số, thứ tự, ký hiệu) không có `solution`; gợi ý của cảnh chứa nó lo phần này.
- Mã lỗi: `MissingHintLevel`, `DuplicateHintLevel` (đường dẫn `hints[SCENE:<sceneId>]`, `hints[CONFRONTATION:<challengeId>]`, `hints[DEDUCTION:<deductionId>]`), `MissingPuzzleHints` (`puzzles[i].solution.hints`).
- **Áp dụng chặt** (báo lỗi, chặn) cho: mọi bản nháp AI (các bước logic, bố cục, tài nguyên cuối) và mọi vụ **mới** nhập ở `/admin/import` (`caseId` chưa có trong database và không phải vụ đi kèm server).
- **Chỉ cảnh báo** (không chặn) cho: vụ đã có trong database (nhập đè, xuất bản), các vụ đi kèm server trong `src/BE/SeedData/` (gồm 2 vụ pixel đang đăng), vụ AI nhập qua bridge (pipeline AI đã kiểm chặt trước đó), và bản nháp AI có projection plan lập trước luật này (plan không đổi được). Cảnh báo hiện ở `/admin/import` và ô "Điều kiện xuất bản" của chi tiết vụ; API trả trong `warnings` (`/validate`) và `validationWarnings` (import, publish).
- Bước logic theo projection: server lập sẵn 3 ô gợi ý (`order` 1, 2, 3) cho mỗi câu hỏi, bot chỉ viết chữ. `player_view` cho thám tử mù chỉ có gợi ý mức 1.

### Ô chứng cứ khi buộc tội nhận nhiều đáp án

`finalLogic.requiredEvidenceLinks[].acceptedEvidenceIds` (tùy chọn): các chứng cứ khác chứng minh **đúng ô đó** cũng hợp lý. Người chơi gắn chứng cứ chính hoặc một chứng cứ trong danh sách đều được chấm đúng; màn kết quả hiện chứng cứ đội đã gắn là chứng cứ đúng. Không có trường này thì chấm y như cũ (một đáp án mỗi ô).

```json
{ "claimType": "OPPORTUNITY", "evidenceId": "evidence-dh-ve-tau", "acceptedEvidenceIds": ["evidence-dh-van-tay"] }
```

Validator kiểm: chứng cứ có thật và `isEvidence: true`; tìm được trước lúc buộc tội; không lặp, không trùng chứng cứ chính của ô; **không** là chứng cứ chính của ô khác (mỗi ô cần một chứng cứ khác nhau, nên làm vậy là chặn ô kia); tối đa 8; vụ hợp đồng 5 ô thì phải hỗ trợ đúng `conclusionId` của ô. Kết quả đã chơi lưu kèm định nghĩa lúc buộc tội (cả `acceptedEvidenceIds`), nên sửa vụ sau này không chấm lại ván cũ. Schema JSON đầy đủ của AI có trường này (mảng hoặc null, không bắt buộc).

**Server tự điền (VUAN-6B phần B).** Ở bước projection (mọi đơn mới), các ô buộc tội do server lập từ đồ thị chứng minh. Lúc biên dịch vụ, server thêm vào mỗi ô các chứng cứ `isEvidence` khác cùng chứng minh `conclusionId` của ô (`AcceptedEvidencePolicy`): không phải chứng cứ chính của ô nào, không phải manh mối gây nhiễu, tối đa 8; chứng cứ nào validator báo không tìm được trước lúc buộc tội thì bị bỏ. Chỉ thêm, không xóa. Bot vẫn ghi đề xuất khác vào mục "Cần Yen xem" của `report.md`; ADMIN sửa được trong case JSON trên trang duyệt. Vụ viết tay (như vụ mẫu, không có `conclusionId`) thì ghi thẳng trong JSON trước khi nhập; server không đổi gì ở các vụ này.

## Cấu hình server

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
- `GET /api/admin/ai-cases/quota` (ADMIN và VIP, từ VUAN-3): số đơn còn lại trong tuần của người gọi, `{ unlimited, weeklyLimit, usedThisWeek, remaining, weekStart }`. ADMIN nhận `unlimited: true`. Form dùng nó để hiện "Còn x/y đơn trong tuần này" và khóa nút khi hết.
- `npcIds` tối đa **số nghi phạm + 3** (vẫn không quá 12).
- Lỗi `AI_ORDER_INVALID` có thêm `errors.field` (ví dụ `order.suspectCount`, `order.npcIds`) để form hiện lỗi ngay cạnh ô sai. Lỗi khác không có trường này.
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
| `GET /api/bridge/drafts/{id}/assets-needed` | Các ô hình, mô tả mỹ thuật, kích thước, url hiện tại. Vụ pixel: thêm `pixel` gồm chủ thể (cảnh, NPC, icon) với loại thư viện và gợi ý từ đơn, kế hoạch request PixelLab, tổng lượt so với `pixelLabCap` |
| `PUT /api/bridge/drafts/{id}/asset-plan` | Vụ pixel: `{ choices: [{ subject, source: LIBRARY\|VARIANT\|PIXELLAB, libraryKey, parentKey, variant, inpaintItems }] }` → kế hoạch request PixelLab theo `templates.json`. `inpaintItems` (cảnh LIBRARY/VARIANT): vật ảnh cảnh chưa có, mỗi vật một request `item-inpaint` (vẽ thêm vào cảnh, không dán ảnh). Vượt trần: 409 `AI_PIXELLAB_CAP_EXCEEDED` |
| `POST /api/bridge/drafts/{id}/assets` | Multipart `slotId` + `file`: PNG/WebP thật, ≤ 5 MB, giữ alpha, lên Cloudinary. Vụ pixel: cần kế hoạch đã duyệt (`AI_ASSET_PLAN_REQUIRED`), đúng cỡ ô (`ASSET_WRONG_SIZE`), có alpha trừ ô nền (`ASSET_NEEDS_ALPHA`) |
| `POST /api/bridge/drafts/{id}/assets/complete` | Báo đủ hình, pipeline đi tiếp |
| `PUT /api/bridge/drafts/{id}/report` | Lưu `report.md` của bot; admin xem trong chi tiết draft |
| `POST /api/bridge/drafts/{id}/approve-gate` | Chỉ đơn `reviewMode = FAST`, cổng `STORY`, `LOGIC`, `LAYOUT`. Cổng `TRUTH` luôn trả 403 |
| `POST /api/bridge/drafts/{id}/import` | Import bản nháp để chạy thử (không publish; người chơi không thấy) |
| `GET/PUT /api/bridge/library` | Thư viện hình dùng chung (`assetLibrary`, upsert theo `key`). Mỗi mục có thêm `prompt`, `files` (vai → URL: `sprite`, `idle` 1152×128, `portrait` 288×288, `thumb`…), `retired` (ảnh hỏng, form đặt đơn không hiện). GET của bot mặc định kèm mục retired (`includeRetired=false` để bỏ) |
| `POST /api/bridge/library/files` | Multipart `key` + `role` + `file` (PNG/WebP thật, ≤ 5 MB): lưu ảnh thư viện lên Cloudinary ở `<folder>/library/<key>/<role>-<sha12>`, trả URL; gửi lại cùng ảnh ra cùng địa chỉ |

Thư viện cho form: `GET /api/admin/ai-cases/library?world=&kind=` (ADMIN và VIP), không có mục `retired`.

### Màn đặt đơn `/admin/ai` (VUAN-3)

Bảy thẻ theo thứ tự: **Thế giới và địa điểm** (4 thẻ thế giới có ảnh nhỏ lấy từ bản đồ ngoài trời đầu tiên của thế giới; chọn nhiều địa điểm từ thư viện, lọc Tất cả / Ngoài trời / Trong nhà; thay ô Khóa bối cảnh cũ), **Cấu hình tạo** (5 preset, số chặng, độ khó, thời lượng 20/30/45/60 phút; preset nào cố định chặng và độ khó thì form chỉ cho chọn đúng giá trị server chấp nhận), **Ngôn ngữ và loại vụ án** (thêm mức nội dung Nhẹ/Thường), **Nhân vật** (3–6 nghi phạm, chân dung NPC của thế giới, mô tả ≤ 600 ký tự), **Không khí** (thời tiết, thời điểm, khóa sắc thái), **Mở rộng gameplay** (Phá Vỡ Lời Dối), **Ý tưởng** (2.000 ký tự, bộ đếm, chip chèn Nạn nhân / Hung khí / Bí mật / Bầu không khí, khóa cơ chế điều tra).

Khung "Bản nháp sẽ tạo" tóm tắt đơn; chỉ ADMIN thấy **Lượt PixelLab tối đa** và **Chế độ duyệt** (chế độ nhanh rút "Các bước duyệt" còn 2) cùng ô giới hạn đơn VIP mỗi tuần. VIP thấy "Đơn sẽ chờ Yen duyệt" và số đơn còn lại. Mặc định khi mở: Phố Hàng Đường, bot chọn thời tiết và thời điểm, Nhẹ, 30 lượt, đầy đủ 4 cổng. Bảng "Bản nháp AI gần đây" có cột Người đặt và Trạng thái đơn (kèm giờ); ADMIN duyệt hoặc từ chối đơn VIP ngay trong bảng, lý do từ chối nhập trong hộp của trang. Chi tiết draft hiện `report.md` của bot dạng Markdown đã lọc (không chèn HTML thô).

Phía bot (MCP `sirlocked-studio`, skill `/tao-vu-an`, cách cài trên máy Yen và VPS studio): xem [docs/studio-vps.md](studio-vps.md).

## Tài nguyên: chế độ "Claude tải lên"

Không còn gpt-image. Bước bố cục và bước tài nguyên cuối mỗi bước tạo một yêu cầu `ASSETS`: bot xem `assets-needed`, tải từng hình, gọi `assets/complete`. Sau đó server hỏi Claude bố cục cảnh (`PlanScenePlacement`) như các bước JSON khác; prompt liệt kê URL các hình. QA nền trượt thì server xin tải lại đúng ô đó một lần rồi mới báo lỗi. `regenerate-assets` và `regenerate-failed-assets` tạo lại yêu cầu `ASSETS` cho các ô cần thay.

### Vụ pixel (VUAN-6B, mọi đơn mới)

Production bật `CaseCatalog:PixelOnly=true`, nên đơn mới làm **vụ pixel** đúng dạng "Trâm hồng ngọc mất tích" (`AiCaseDraft.visualPipeline = pixel-v1`). Bản nháp làm trước đó (trường rỗng) giữ nguyên kiểu cũ 1600×900 và vẫn đọc được.

| Phần | Vụ pixel |
| --- | --- |
| Ô hình | nền mỗi cảnh 512×512; sprite thở mỗi NPC 1152×128 (9 khung 128, server đo `anchorY` ở chân khung 0); chân dung 288×288; icon 64×64 cho vật nhặt được; **không có ô bìa** (bìa là ảnh một phòng có người) |
| Kế hoạch | `PUT asset-plan`: thư viện, biến thể 0 lượt; chỗ mới thành request PixelLab theo `ai-game-docs/visual-style-templates/pixellab/templates.json` (server nhúng file này lúc build, cùng nguồn với `scripts/build_pixellab_requests.mjs`; test golden giữ hai bên cùng prompt). Tổng lượt ≤ `pixelLabCap`, vượt thì bị chặn và chưa tải ảnh được |
| Bố cục | Cảnh ngoài trời (`atmosphere.indoor = false`) là topdown, trong nhà là isometric. Bot trả `walkGrid` (128×128 ô 16), `foreground` (có `baseY`), spawn, cửa, ô bấm trên vật đã vẽ vào nền, chân NPC; server dựng `runtime.render` theo số đo của Trâm hồng ngọc (2048×2048, ×4, `cameraZoom`, `actorScale`, `walkSpeed`, `interactRadius`) |
| Kiểm | `PixelDraftRules` chặn: cảnh không pixel, thiếu `walkGrid`, spawn/cửa ngoài vùng đi được, ô vật/NPC không đi tới được, ô ra ngoài khung, `foreground` sai `baseY`, sprite sheet/chân dung/icon sai cỡ. Bước kiểm vị trí bằng ảnh cắt (`VerifyScenePlacement`) bỏ cho vụ pixel vì vật đã vẽ vào nền |
| Phong cách NPC | Lấy từ quy trình PixelLab của `templates.json` (mặt trước có ảnh Sherlock làm mẫu → `create_character` v3 → idle v3), sprite south 96×96: khung trần, cùng khung với Sherlock và Watson V3 96. Tỉ lệ người thật như Sherlock, Watson, NPC vụ Lò thuốc; cao thấp tùy nhân vật, không khóa pixel; không chibi. `asset_process` của studio từ chối sprite không phải 96×96 (`NPC_FORMAT`) và zip PixelLab có prompt chibi (`NPC_STYLE`). 39 NPC chibi của thư viện Đợt 0 đã khóa (`retired`) |
| Vật điều tra | Nằm trong ảnh cảnh, **không dán ảnh vật lên** (Yen chốt 17/11/2026). Cảnh vẽ mới: ghi vật vào `visualDescription`. Cảnh thư viện/biến thể chưa có vật: khai `inpaintItems`, rồi `asset_process inpaint_prep` → PixelLab inpaint (6 lượt) → `inpaint_merge` (chỉ chép vùng mask). `itemPlacements[].asset` rỗng, ô bấm phủ vật; `items[].imageUrl` chỉ là icon. `asset_variant compose` không còn `add` (`ITEM_PASTE_FORBIDDEN`); validator chặn ảnh dán (`PixelItemOverlay`). Mẫu: màn tân thủ, `ai-game-docs/pixel-case-tan-thu/inpaint/` |
| Âm | Nhạc, thời tiết, bíp như VUAN-4, VUAN-5; cảnh pixel thiếu tiếng giao diện thì server ghi 7 cue CC0 `/assets/audio/sfx/ui/<cue>.ogg` |

Chế độ mock không ảnh (`MockAiResponses` + `SkipAssetGeneration`, dùng cho `start-local-demo.ps1`) vẫn dựng bố cục kiểu cũ vì không có ảnh nào để dựng cảnh pixel.

### Chơi thử bản nháp chưa đăng (VUAN-6B phần C)

Bản nháp bot đã import có trạng thái **"Đã import, chưa đăng"**. Vụ của nó vẫn là `DRAFT`, nên không hiện ở danh sách vụ, không vào ghép trận và không có trang công khai.

- **Ai mở được:** ADMIN, hoặc VIP đã đặt đơn (tác giả). Nút **Chơi thử** nằm ở hàng bản nháp và thẻ chi tiết trên `/admin/ai`. API: `POST /api/admin/ai-cases/{draftId}/playtest`; bấm lại thì trả về phòng đang mở.
- **Phòng:** riêng tư (`GameRoom.playtest`), 2 ghế như phòng thường.
- **Mời người thứ hai:** phòng chờ hiện liên kết `/join?code=…&invite=…`. Người đầu tiên vào bằng liên kết thì liên kết gắn với người đó. Người khác có liên kết hay chỉ có mã phòng đều bị chặn (403 `PLAYTEST_FORBIDDEN`). ADMIN và tác giả vào bằng mã phòng mà không cần liên kết.
- **Không tính gì:** ván chơi thử không ghi `gameResults`. Vì vậy không có bảng xếp hạng, hồ sơ, thành tích, đánh giá hay xu thưởng. Kết quả đọc lại từ chính phòng; trang kết quả ghi "Ván chơi thử".
- Phòng chơi thử không bao giờ hiện ở bảng phòng công khai. Thành viên phòng đọc được chi tiết vụ và cutscene mở màn đã duyệt qua `?roomId=`.
- Khi phòng chơi thử còn mở (chờ hoặc đang chơi), server vẫn chặn **nhập đè** vụ đó (`CASE_IMMUTABLE_WHILE_ACTIVE`, luật có sẵn). Bấm Xuất bản ở `/admin/cases/<caseId>` không bị chặn.

## Cutscene

Nút "Tạo bằng AI" của cutscene tạo yêu cầu bridge `ownerType = CUTSCENE`; trang cutscene hiện "đang chờ Claude" tới khi bot nộp. Bấm lại thì tiếp tục đúng lượt đang chờ, không tạo yêu cầu thứ hai. Khởi động server không còn tự xếp cutscene cho bot.

## Thử trên máy

- Không cần Claude: `scripts/start-local-demo.ps1` (mock như trước).
- Xưởng của bot trọn vòng (MCP thật, không cần Claude): `cd tools/studio-mcp && npm run e2e:local`.
- `POST /api/admin/cases/import-json` nhận thêm `preserveServerMetadata: true` để giữ metadata AI (preset, phiên bản hợp đồng) khi import: **chỉ có tác dụng ngoài Production** (stack chạy thử của bot dùng); Production luôn bỏ qua cờ này.
- Chạy qua bridge bằng mock: `scripts/start-local-demo.ps1 -Bridge`, rồi `node scripts/bridge-smoke.mjs` với cùng `SIRLOCKED_BRIDGE_KEY` trong biến môi trường. Script tạo đơn → nhận từng yêu cầu → nộp JSON mock (`AiCaseMockFactory`) → qua các cổng → tải hình giả → `READY_TO_PUBLISH` → import (không publish), và báo lỗi nếu có yêu cầu nào thành `STALE`.
- Kiểm một vụ viết tay trước khi nhập, không cần database: `dotnet run --project tools/ValidateCase -- --new <case.json> [report.json]`. Có `--new` thì luật gợi ý 3 mức chặn như với vụ mới; bỏ `--new` thì thiếu gợi ý chỉ là cảnh báo (`warnings`).

## Xử lý sự cố

Tool của `sirlocked-studio` trả mã lỗi kèm cách sửa; bot chép nguyên hướng dẫn đó cho Yen. Không ai dán khóa vào chat.

### Bridge trả 401 (`BRIDGE_KEY_INVALID`, `BRIDGE_KEY_MISSING`)

Server không nhận khóa bot gửi.

1. Kiểm máy chạy bot có biến mà không in giá trị: PowerShell `[bool]$env:SIRLOCKED_BRIDGE_KEY`, bash `test -n "$SIRLOCKED_BRIDGE_KEY" && echo co`.
2. Biến vừa đặt mà phiên Claude Code cũ không thấy: đóng hẳn VS Code và mọi terminal, mở lại (Windows); `source ~/.config/sirlocked/env` hoặc SSH lại (VPS studio).
3. Khóa trên máy và trên server lệch nhau (vừa đổi khóa ở một bên): chạy lại `bash scripts/set-bridge-key.sh` trên máy Yen. Script đặt cùng một khóa cho server và biến Windows; VPS studio thì sửa `~/.config/sirlocked/env`.
4. Kiểm: `GET https://sirlocked.id.vn/api/bridge/ping` có header `X-Bridge-Key` phải ra 200; không có header ra 401. Bot gọi được bằng `bridge_list`.

401 khi gọi API admin bằng khóa bridge là **đúng thiết kế**: khóa bridge không mở được API admin, JWT của admin không mở được bridge.

### Bridge trả 503

- `BRIDGE_NOT_CONFIGURED`: server chưa có `Bridge__Key`. Yen chạy `bash scripts/set-bridge-key.sh` (đặt khóa và tắt `MOCK_AI_RESPONSES`, `SKIP_ASSET_GENERATION`).
- 502/503 không có mã, vài giây rồi hết: API đang khởi động lại sau deploy. Đợi `GET /health` trả `Healthy` rồi gõ lại `/tao-vu-an`.
- `ASSET_STORAGE_UNAVAILABLE` (lúc tải hình): server chưa bật Cloudinary. Yen chạy `bash scripts/set-cloudinary.sh`; `ping` trả `assetStorage: true` là được.
- `RATE_LIMITED` (429 của bridge): bot gọi quá 240 lần một phút. Đợi một phút rồi làm tiếp.

### Yêu cầu bị treo do lease

Khi bot nhận một yêu cầu (`bridge_take`), yêu cầu thành `TAKEN` trong `Bridge__LeaseHours` (mặc định 2 giờ, tối đa 24). Phiên Claude Code tắt giữa chừng thì yêu cầu nằm đó: `bridge_list` mặc định không hiện nó, nhận lại thì báo `BRIDGE_REQUEST_NOT_TAKEABLE` kèm giờ hết lease.

1. Xem: `bridge_list { status: "TAKEN" }` (cột `leaseExpiresAt`), hoặc `draft_get { draftId }`.
2. Chắc chắn không còn phiên nào khác đang làm yêu cầu đó (chỉ một phiên `/tao-vu-an` mỗi lúc), rồi `bridge_release { requestId }` và `bridge_take` lại. Còn file trong `tmp/bridge/<requestId>/` thì có thể sửa `answer.json` và `bridge_submit` luôn: yêu cầu `TAKEN` vẫn nộp được.
3. Không làm gì cũng được: hết lease thì yêu cầu tự hiện lại trong `bridge_list` như `PENDING`.

Yêu cầu bị server từ chối (`REJECTED`) vẫn mở: đọc `errors`, sửa, nộp lại. Yêu cầu `STALE` (server chạy lại bước với prompt khác) thì bỏ, làm yêu cầu mới server vừa tạo.

### PixelLab báo 429

PixelLab giới hạn số job chạy cùng lúc và số lần gọi.

1. Dừng tạo job mới. Chờ job đang chạy xong bằng `wait_for_jobs` hoặc xem `list_jobs` (job bị từ chối vì 429 không chạy, xem lại số dư bằng `get_balance` trước khi tính lượt).
2. Đợi 1–2 phút rồi chạy tiếp, mỗi lần ít job hơn (skill cho tối đa 10 job cùng lúc; gặp 429 thì hạ xuống 3–5).
3. Không vòng lặp gọi lại liên tục. Gặp 429 nhiều lần liền: `bridge_release` yêu cầu `ASSETS`, ghi vào `report.md`, báo Yen và để lần gõ sau làm tiếp.
4. Hết lượt của gói (không phải 429): dừng, báo Yen. Không vượt `order.pixelLabCap` khi Yen chưa đồng ý; có thể làm tiếp bằng thư viện và `asset_variant` (0 lượt).

### Studio báo `NPC_STYLE` hoặc `NPC_FORMAT`

- `NPC_STYLE`: nhân vật PixelLab tạo với prompt chibi/đầu to, lệch phong cách game.
- `NPC_FORMAT`: sprite south không phải 96×96.

1. Bot dừng NPC đó, ghi vào `report.md`, báo Yen. Không sửa hay thu nhỏ ảnh cho lọt.
2. Vẽ lại theo `character-front` (ảnh Sherlock V3 96 làm mẫu) → `create_character` v3 → idle v3. Đây là tạo lại nên bot phải hỏi Yen trước.
3. Rẻ hơn: nếu trong 4 ứng viên mặt trước đã có (giữ ở `tmp/pixellab/<draftId>/`) có ứng viên nhìn thẳng, đúng phong cách, thì xoay lại và làm idle lại từ ứng viên đó, chỉ tốn 4 lượt thay vì 14. Vẫn phải hỏi Yen trước.

### Hết hạn mức Claude giữa chừng

Không mất gì. Mọi câu trả lời đã nộp nằm trên server; draft đỗ ở trạng thái chờ Claude (`queueState = AWAITING_CLAUDE`) và đứng yên trong hàng chờ.

1. Khi hạn mức hồi lại, mở phiên Claude Code mới ở gốc repo và gõ `/tao-vu-an`: bot thấy yêu cầu đang chờ và làm tiếp đúng bước đó.
2. Yêu cầu đang dở có thể còn `TAKEN` tới hết lease: làm như mục "Yêu cầu bị treo do lease".
3. Đơn FAST bị dừng giữa lúc chạy thử: gõ lại `/tao-vu-an`, bot `draft_get` rồi chạy tiếp `playtest`.
4. Hay hết hạn mức: chia việc như skill dặn (bước sự thật và logic dùng model mạnh nhất; hình và âm giao agent chạy Sonnet), và làm từng đơn một.

### Lỗi khi đặt đơn hoặc nhập vụ

- `BRIDGE_NOT_CONFIGURED`: server chưa có `Bridge__Key`. Chạy `bash scripts/set-bridge-key.sh`.
- `AI_WEEKLY_LIMIT`: VIP đã dùng hết số đơn của tuần.
- `AI_ORDER_INVALID`: một lựa chọn trong `order` không hợp lệ (`errors.field` chỉ ô sai).
- `AI_ORDER_AWAITING_APPROVAL`: đơn VIP chưa được duyệt.
- `AI_ACTIVE_DRAFT_LIMIT`, `AI_DAILY_LIMIT`: hạn mức số bản nháp khi `AiQuota__Enabled=true`.
- `ASSET_STORAGE_UNAVAILABLE`: bot tải hình khi server chưa có Cloudinary.
- `MissingHintLevel`, `DuplicateHintLevel`, `MissingPuzzleHints`: thiếu gợi ý 3 mức (mục "Gợi ý 3 mức cho mọi câu hỏi"). Bản nháp AI: bot sửa đúng chỗ và nộp lại. Vụ mới ở `/admin/import`: thêm gợi ý rồi nhập lại.
- Tool `playtest` bị cắt giữa chừng trong Claude Code: đặt `MCP_TOOL_TIMEOUT=1800000` rồi mở lại phiên.

## Sửa chất lượng từ checkpoint

Các chức năng sửa theo phạm vi (sửa truth, sửa tiếp candidate, sửa logic, thay JSON) giữ nguyên như trước; khác duy nhất là mỗi lần sửa cần Claude viết thì tạo yêu cầu bridge thay vì gọi OpenAI. Các bước cần Claude chỉ chạy trong lượt của hàng chờ: thao tác đồng bộ trên admin (ví dụ thay JSON) mà cần review ngữ nghĩa thì báo bước đó chưa chạy; dùng **Tiếp tục** hoặc **retry-json** để đưa vào hàng chờ.
