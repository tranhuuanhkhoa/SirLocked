# Plan 013: Persist Playtest Telemetry

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat af3da77..HEAD -- src/BE/Services/NoOpPlaytestEventSink.cs src/BE/Services/Interfaces/IPlaytestEventSink.cs src/BE/Models/PlaytestEventRecord.cs src/BE/WebAPI/Controllers/PlaytestEventsController.cs src/BE/DataAccess/MongoDbContext.cs src/BE/Program.cs src/BE/Services/PairedConfrontationCoordinator.cs`
> Nếu bất kỳ file nào đã đổi kể từ khi plan này được viết, so sánh phần "Current state" bên dưới với code thật trước khi làm.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: observability
- **Planned at**: commit `af3da77`, 2026-07-27

## Why this matters

Seam telemetry đã tồn tại đầy đủ — có model, có enum 20 loại sự kiện, có controller, có test privacy, và `PairedConfrontationCoordinator` đã gọi sink ở đúng các điểm chuyển trạng thái. Nhưng bản được đăng ký trong DI là `NoOpPlaytestEventSink`, trả `Task.CompletedTask`. **Toàn bộ sự kiện bị vứt đi.**

Hậu quả trực tiếp: mọi câu hỏi quyết định sản phẩm hiện phải trả lời bằng cảm tính.

- "Interrogator có phải chờ nhiều hơn Investigator không?" — không có số.
- "Người chơi mất bao lâu mới chạm confrontation đầu tiên?" — không có số.
- "Optimistic retry có xảy ra thật ngoài test không?" — không có số.

`docs/EXPERT_AUDIT_2026-07-18_VI.md` xếp đây là vấn đề #10 và đặt "chênh active-time hai vai <15%" làm exit criteria của Phase 2. Không có plan này thì exit criteria đó không đo được, và plan 014 (playtest có kịch bản) không có dữ liệu định lượng để kết luận Kill/Iterate/Scale.

## Current state

- `src/BE/Program.cs:103` đăng ký `builder.Services.AddSingleton<IPlaytestEventSink, NoOpPlaytestEventSink>();` — đây là bản duy nhất.
- `src/BE/Services/NoOpPlaytestEventSink.cs` — mọi tham số bị bỏ qua, trả `Task.CompletedTask`.
- `src/BE/Services/Interfaces/IPlaytestEventSink.cs` — chữ ký nhận `roomId`, `userId`, `role`, `eventType`, `stateVersion`, `attemptId?`, `revision?`, `durationMs?`, `count?`.
- `src/BE/Models/PlaytestEventRecord.cs` — model persist đã có sẵn và **cố ý không có `RoomId`/`UserId` thô**; nó có `SessionPseudonym`, `UserHash`, `Role`, `EventType`, `StateVersion`, `AttemptId`, `Revision`, `DurationMs`, `Count`, `Timestamp`. File này cũng khai báo `enum PlaytestEventType` với 20 giá trị.
- `src/BE/WebAPI/Controllers/PlaytestEventsController.cs:32-71` — `POST /api/game/rooms/{roomId}/playtest-events`, chặn khi `GameplayV3Settings.Enabled == false` hoặc `PlaytestInstrumentationEnabled == false`, và chỉ chấp nhận case `MechanicsVersion == InvestigationV3PairedConfrontation`.
- `src/BE/Services/PairedConfrontationCoordinator.cs:193-202` và `:228+` đã gọi sink cho `OptimisticRetry` và cho các chuyển trạng thái confrontation.
- `src/BE/Configurations/GameplayV3Settings.cs` — đã có cờ `Enabled` và `PlaytestInstrumentationEnabled`. **Không tạo cờ bật/tắt mới.**
- `src/BE/Configurations/MongoDbSettings.cs` — **chưa** có `PlaytestEventsCollectionName`.
- `src/BE/DataAccess/MongoDbContext.cs` — **chưa** có property collection và **chưa** có index cho playtest events; `EnsureIndexesAsync` là nơi thêm.
- `src/BE/Tests/PlaytestInstrumentationPrivacyTests.cs` — khẳng định schema không có property nào chứa `Evidence`, `Fragment`, `Title`, `Content`, `Payload`, `Text`, và `RecordUiPlaytestEventRequest` từ chối eventType lạ khi bind JSON.
- Không có endpoint đọc/tổng hợp nào.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend build | `dotnet build SirLocked.sln` | exit 0, 0 warning |
| Backend tests | `dotnet test SirLocked.sln --no-build` | 529+ passed, 0 failed |
| Mongo integration | `./scripts/test-v3-mongo.ps1` | exit 0 |
| Frontend typecheck | `cd src/FE; npm run typecheck` | exit 0 |
| Frontend build | `cd src/FE; npm run build` | exit 0 |

## Scope

**In scope**:
- `src/BE/Services/MongoPlaytestEventSink.cs` (mới)
- `src/BE/Services/PlaytestPseudonymizer.cs` (mới)
- `src/BE/Services/PlaytestSummaryService.cs` (mới)
- `src/BE/Configurations/MongoDbSettings.cs`, `src/BE/Configurations/PlaytestSettings.cs` (mới)
- `src/BE/DataAccess/MongoDbContext.cs`
- `src/BE/Models/PlaytestEventRecord.cs` — chỉ **thêm** giá trị enum
- `src/BE/Services/GameplayService.cs` — chỉ thêm điểm phát 3 sự kiện mới
- `src/BE/WebAPI/Controllers/AdminController.cs` — thêm endpoint summary
- `src/BE/DTOs/` — DTO summary
- `src/BE/Program.cs` — chọn sink theo cấu hình
- `src/BE/Tests/` — test mới
- `src/FE/Client/js/pages/adminDashboardPage.js`, `src/FE/Client/js/api/adminApi.js`
- `README.md` — biến môi trường mới

**Out of scope**:
- Đổi chữ ký `IPlaytestEventSink`.
- Thu thập cho case V1/V2 (giữ nguyên cổng V3 hiện tại).
- Dịch vụ analytics bên ngoài, dashboard biểu đồ, export CSV.
- Consent banner cho người dùng cuối (thuộc plan 033).
- Đổi bất kỳ luật gameplay nào.

## Design decisions locked before coding

1. **Không lưu định danh thô.** `roomId` và `userId` đi vào sink nhưng chỉ được persist dưới dạng băm. Đây là lý do model đã có `SessionPseudonym`/`UserHash` thay vì `RoomId`/`UserId`; giữ đúng ý định đó.
   - `SessionPseudonym = Base64Url(HMACSHA256(key, roomId))[..22]`
   - `UserHash = Base64Url(HMACSHA256(key, roomId + "|" + userId))[..22]`
   - Băm user **theo từng phòng** để không nối được hành vi của một người qua nhiều phòng.
2. **Khóa băm là bắt buộc khi bật ngoài Development.** `Playtest__PseudonymKey` tối thiểu 32 ký tự. Ở Development, nếu thiếu thì sinh khóa ngẫu nhiên theo tiến trình và ghi log cảnh báo (dữ liệu không nối được qua các lần restart — chấp nhận được cho local).
3. **Không thêm cờ bật/tắt mới.** Dùng đúng `GameplayV3__Enabled` + `GameplayV3__PlaytestInstrumentationEnabled` đang có. `Program.cs` chọn `MongoPlaytestEventSink` khi cả hai bật, ngược lại giữ `NoOpPlaytestEventSink`.
4. **Sink không bao giờ làm hỏng gameplay.** Mọi lỗi ghi được nuốt và log ở mức `Warning`. Telemetry thất bại không được ném ra ngoài command gameplay.
5. **Chỉ số chờ, không phải "active time".** Các sự kiện hiện có không đo được thời gian thao tác thật. Thay vì hứa một con số không tính được, dùng `WaitingStarted`/`WaitingEnded` để tính **thời gian chờ theo vai** — đây mới là tín hiệu trực tiếp cho câu hỏi mất cân bằng.
6. **Ba event type mới dùng `Count` để mang chỉ số vị trí, không mang ID.** `StageCompleted` gửi `Count = stageIndex`, `HintUsed` gửi `Count = tier`. Không thêm property nào vào `PlaytestEventRecord` — nếu không sẽ vi phạm `PlaytestInstrumentationPrivacyTests`.

## Steps

### Step 1: Thêm collection và cấu hình

Thêm `PlaytestEventsCollectionName = "playtestEvents"` vào `MongoDbSettings`. Thêm property `PlaytestEvents` vào `MongoDbContext`. Tạo `PlaytestSettings` với `PseudonymKey` (string) và `RetentionDays` (int, mặc định `30`), bind section `Playtest`.

**Verify**: `dotnet build SirLocked.sln` → exit 0.

### Step 2: Index và TTL

Trong `MongoDbContext.EnsureIndexesAsync`, thêm cho `PlaytestEvents`:

- `{ sessionPseudonym: 1, timestamp: 1 }` tên `ix_playtestEvents_session_timestamp`
- `{ eventType: 1, timestamp: 1 }` tên `ix_playtestEvents_type_timestamp`
- TTL: `{ timestamp: 1 }` với `ExpireAfter = TimeSpan.FromDays(RetentionDays)`, tên `ttl_playtestEvents_timestamp`

Đặt khối này **sau** `EnsureGameResultIndexesAsync` và trong nhóm index không-tối-quan-trọng, để lỗi ở đây không làm fail-fast startup (giữ nguyên hành vi hiện có: chỉ index của `GameResult` mới là invariant chặn khởi động).

**Verify**: `dotnet build SirLocked.sln` → exit 0.

### Step 3: `PlaytestPseudonymizer`

Lớp thuần, không phụ thuộc Mongo:

```csharp
public sealed class PlaytestPseudonymizer
{
    public PlaytestPseudonymizer(string key);           // ném nếu key < 32 ký tự
    public string SessionPseudonym(string roomId);
    public string UserHash(string roomId, string userId);
}
```

Dùng `HMACSHA256`, mã hóa base64url, cắt 22 ký tự. Cùng input phải cho cùng output trong một tiến trình và giữa các tiến trình khi cùng khóa.

**Verify**: `dotnet test SirLocked.sln --no-build` → test mới ở Step 8 pass.

### Step 4: `MongoPlaytestEventSink`

Cài `IPlaytestEventSink`, chèn `MongoDbContext`, `PlaytestPseudonymizer`, `TimeProvider`, `ILogger`. Ghi một `PlaytestEventRecord` với `Timestamp = TimeProvider.GetUtcNow().UtcDateTime`. Bọc `InsertOneAsync` trong `try/catch`, log `Warning`, không ném.

**Verify**: `dotnet build SirLocked.sln` → exit 0.

### Step 5: Đăng ký DI theo cấu hình

Trong `Program.cs`, thay dòng `:103` bằng lựa chọn có điều kiện: nếu `GameplayV3:Enabled` **và** `GameplayV3:PlaytestInstrumentationEnabled` đều true thì đăng ký `MongoPlaytestEventSink`, ngược lại giữ `NoOpPlaytestEventSink`. Nếu bật ngoài Development mà `Playtest__PseudonymKey` trống hoặc ngắn hơn 32 ký tự → ném `InvalidOperationException` ngay khi khởi động (cùng phong cách với `JwtSettings.IsSecretValid`).

**Verify**: `dotnet build SirLocked.sln` → exit 0. Chạy API local với `GameplayV3__PlaytestInstrumentationEnabled=false` → khởi động bình thường, không cần khóa.

### Step 6: Ba event type mới

Thêm vào `enum PlaytestEventType`: `SceneCompleted`, `StageCompleted`, `HintUsed`. **Thêm vào cuối enum** để không đổi thứ tự giá trị đã persist.

Phát sự kiện từ `GameplayService`, chỉ khi case là V3:

- `CompleteSceneAsync` → `SceneCompleted`, `Count = số scene đã hoàn thành sau thao tác`.
- `CompleteStageAsync` → `StageCompleted`, `Count = index của stage trong danh sách đã sắp xếp`.
- `RequestHintAsync` → `HintUsed`, `Count = tier`.

Không truyền stageId/sceneId/hintId vào sink.

**Verify**: `dotnet test SirLocked.sln --no-build` → tất cả pass, gồm cả `PlaytestInstrumentationPrivacyTests`.

### Step 7: `PlaytestSummaryService` và endpoint admin

`GET /api/admin/playtest/summary?from=&to=` — `[Authorize(Roles = "ADMIN")]`, `from`/`to` là UTC ISO, mặc định 7 ngày gần nhất, chặn khoảng > 90 ngày.

Trả về:

| Trường | Cách tính |
|---|---|
| `sessionCount` | số `sessionPseudonym` phân biệt |
| `waitingMsByRole` | tổng `durationMs` của `WaitingEnded` nhóm theo `role` |
| `waitingImbalancePct` | `abs(inv - int) / max(inv, int) * 100`, `null` nếu một vai bằng 0 |
| `notebookOpenMsByRole` | tổng `durationMs` của `PrivateNotebookClosed` nhóm theo `role` |
| `confrontationOutcomes` | đếm `ResolvedCorrect` / `ResolvedIncorrect` / `Cancelled` |
| `medianRevisionsPerAttempt` | trung vị `revision` lớn nhất theo `attemptId` |
| `medianStageMs` | trung vị khoảng cách giữa hai `StageCompleted` liên tiếp trong cùng session |
| `hintCountByTier` | đếm `HintUsed` nhóm theo `count` |
| `optimisticRetryCount` | đếm `OptimisticRetry` |
| `reconnectRestoredCount` | đếm `ReconnectRestored` |

Tính toán đặt trong service thuần nhận `IReadOnlyList<PlaytestEventRecord>` để test được mà không cần Mongo.

**Verify**: `dotnet test SirLocked.sln --no-build` → test aggregation pass.

### Step 8: Test

Thêm `src/BE/Tests/PlaytestTelemetryTests.cs`:

- Pseudonymizer: cùng `(roomId, userId)` → cùng hash; đổi `roomId` → hash khác (không nối được qua phòng); key < 32 ký tự → ném.
- Summary: dữ liệu dựng sẵn → `waitingMsByRole`, `waitingImbalancePct`, `medianStageMs`, `hintCountByTier` đúng; danh sách rỗng → trả 0/`null`, không chia cho 0; số phần tử chẵn/lẻ đều tính trung vị đúng.
- Sink: khi `InsertOneAsync` ném, `RecordAsync` vẫn hoàn thành (dùng double của collection hoặc tách một seam `IPlaytestEventStore` nhỏ nếu cần).

Mở rộng `PlaytestInstrumentationPrivacyTests`: khẳng định `PlaytestEventRecord` không có property nào chứa `Room`, `User` **trừ** `UserHash`, và không chứa `Stage`, `Scene`, `Hint`, `Clue`.

Thêm vào `src/BE/IntegrationTests/` (chạy khi `SIRLOCKED_RUN_MONGO_IT=true`): ghi rồi đọc round-trip, và khẳng định ba index ở Step 2 tồn tại sau `EnsureIndexesAsync`.

**Verify**: `dotnet test SirLocked.sln --no-build` → 529+ pass. `./scripts/test-v3-mongo.ps1` → exit 0.

### Step 9: Thẻ Playtest trong admin dashboard

Thêm `getPlaytestSummary()` vào `adminApi.js`. Trong `adminDashboardPage.js`, thêm một thẻ hiển thị: số session, thời gian chờ theo vai + % chênh, kết quả confrontation, trung vị stage, hint theo tier. Ẩn thẻ khi API trả 404/403 (instrumentation đang tắt) thay vì hiện lỗi đỏ. Mọi chuỗi phải đi qua `escapeHtml` và có bản dịch EN/VI qua `tr()`.

**Verify**: `cd src/FE; npm run typecheck; npm run build` → exit 0.

### Step 10: Docs

Thêm vào README phần cấu hình:

```env
GameplayV3__PlaytestInstrumentationEnabled=true
Playtest__PseudonymKey=replace-with-at-least-32-characters
Playtest__RetentionDays=30
```

Ghi rõ: telemetry chỉ chạy cho case V3, chỉ lưu định danh đã băm theo phòng, tự xóa sau `RetentionDays`, và mặc định tắt.

**Verify**: `rg -n "Playtest__" README.md src/BE` → README và code khớp tên khóa.

## Test plan

- Backend build, 0 warning.
- Toàn bộ suite backend pass (baseline 529).
- Mongo integration pass với DB cô lập.
- Frontend typecheck + build.
- Smoke thủ công: bật instrumentation, chơi hết một trận `case-v3-broken-seal-vi` bằng hai tài khoản, kiểm tra `db.playtestEvents.find()` có bản ghi, `sessionPseudonym` không phải roomId, và summary endpoint trả số khớp.

## Done criteria

- [ ] Bật cấu hình → sự kiện xuất hiện trong `playtestEvents`; tắt → không có bản ghi nào.
- [ ] Không document nào chứa `roomId`, `userId`, clue ID, evidence ID, testimony fragment ID hay stage/scene ID.
- [ ] TTL index tồn tại và đúng `RetentionDays`.
- [ ] Summary endpoint trả đủ 10 trường, chỉ ADMIN gọi được.
- [ ] Lỗi ghi telemetry không làm fail bất kỳ command gameplay nào.
- [ ] Thẻ Playtest hiện đúng trên dashboard, ẩn gọn khi tắt.
- [ ] `plans/README.md` cập nhật trạng thái plan 013.

## STOP conditions

- Phải đổi chữ ký `IPlaytestEventSink` để hoàn thành Step 6 → dừng, báo lại; chữ ký này đã được nhiều điểm gọi và đang nằm trong hợp đồng privacy đã test.
- Phải thêm property mới vào `PlaytestEventRecord` để chứa dữ liệu định danh → dừng; thiết kế lại để dùng `Count`/`Revision`.
- Yêu cầu thu thập cho case V1/V2 phát sinh giữa chừng → dừng, tách thành plan riêng.

## Maintenance notes

`RetentionDays` là mức bảo vệ dữ liệu duy nhất cho tới khi plan 033 làm chính sách lifecycle tổng thể; đừng nâng lên quá 90 ngày mà không có mục tương ứng trong chính sách riêng tư. Khi mở thu thập cho V1/V2, cổng V3 ở `PlaytestEventsController.cs:51` là chỗ duy nhất phải nới, và phải rà lại xem sự kiện nào còn ý nghĩa ngoài ngữ cảnh paired confrontation.
