# Plan 016: Lock Room Terminal-State Transitions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat af3da77..HEAD -- src/BE/Services/RoomService.cs src/BE/Services/RoomRecoveryRules.cs src/BE/Models/Enums/RoomStatus.cs src/BE/Models/GameRoom.cs src/BE/Services/GameplayContextLoader.cs src/BE/Tests`
> Nếu bất kỳ file nào đã đổi, so lại "Current state" bên dưới với code thật trước khi làm.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `af3da77`, 2026-07-27

## Why this matters

Phòng ở trạng thái `ABANDONED` hiện **vẫn đi qua được toàn bộ luồng lobby và có thể start lại**, ghi đè `GameplayState` cũ bằng một state mới tinh. Đây là vấn đề #2 trong top-50 của `docs/EXPERT_AUDIT_2026-07-18_VI.md` và đã được xác nhận lại bằng đọc code ở commit `af3da77`.

Ba đường vào đã kiểm chứng:

1. `RoomService.cs:360-366` — `RequireLobby` chỉ ném khi status là `InProgress` hoặc `Completed`. `Abandoned` lọt qua, nên `SelectRoleAsync` (`:190`) và `SetReadyAsync` (`:263`) chấp nhận thao tác trên phòng đã kết thúc.
2. `RoomService.cs:298-305` — `StartAsync` cũng chỉ chặn `InProgress` và `Completed`. Một phòng `Abandoned` đủ hai người, đủ hai vai, đủ ready sẽ **start lại được**, và `:325-337` gán `room.GameplayState = new GameplayState { Version = 1, ... }`, xóa sạch tiến trình, notebook riêng, confrontation đã giải và `FinalAccusationSnapshot`.
3. `RoomService.cs:164` — `LeaveAsync` gán `room.Status = RoomStatus.Waiting` **không xét trạng thái trước đó**. Một người rời phòng `Abandoned` sẽ đưa phòng đó về `WAITING`, tức là "hồi sinh" một phòng terminal.

Tác hại: mất dữ liệu trận đã kết thúc, kết quả sai lệch cho leaderboard/badge, và một class lỗi rất khó tái hiện khi báo cáo.

Ngoài ra, các kiểm tra trạng thái hiện nằm rải rác dưới dạng `if (room.Status == ...)` đọc-rồi-ghi. `TrySaveLobbyAsync` (`:368-383`) có bảo vệ bằng `LobbyVersion` nên không mất dữ liệu do ghi đè song song, nhưng **status không nằm trong filter**, nên hai request hợp lệ về version vẫn có thể đưa phòng qua một chuyển trạng thái không hợp lệ.

## Current state

- `src/BE/Models/Enums/RoomStatus.cs` — hằng chuỗi: `WAITING`, `READY`, `IN_PROGRESS`, `COMPLETED`, `ABANDONED`. Không phải enum, không có nơi nào định nghĩa chuyển trạng thái hợp lệ.
- `src/BE/Services/RoomService.cs`
  - `:104-118` — `JoinAsync` **đã** dùng atomic filter đúng cách (`Status == Waiting` + `SizeLt(Players, MaxPlayers)`). Đây là mẫu để nhân rộng.
  - `:134-176` — `LeaveAsync`; `:141` chặn `InProgress`; `:164` gán `Waiting` vô điều kiện.
  - `:178-210` — `SelectRoleAsync`, gọi `RequireLobby` ở `:190`.
  - `:212-255` — `AbandonAsync`; **đã** dùng atomic filter đúng (`Status == InProgress` + `GameplayState.Version` khớp) ở `:228-241`.
  - `:257-285` — `SetReadyAsync`, gọi `RequireLobby` ở `:263`.
  - `:287-348` — `StartAsync`; kiểm tra status ở `:298-305`; gán state mới ở `:325-337`; lưu bằng `TrySaveLobbyAsync` ở `:338`.
  - `:360-366` — `RequireLobby`.
  - `:368-383` — `TrySaveLobbyAsync`, replace theo `LobbyVersion`.
- `src/BE/Services/RoomRecoveryRules.cs` — luật thuần cho grace period/abandon, đã có test `RoomRecoveryRuleTests`.
- `src/BE/Services/GameplayContextLoader.cs` — dùng `requireInProgress` cho các command gameplay, nên gameplay không bị ảnh hưởng bởi lỗ hổng này; lỗ hổng nằm hoàn toàn ở lobby.
- Không có test nào phủ chuyển trạng thái từ `ABANDONED`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend build | `dotnet build SirLocked.sln` | exit 0, 0 warning |
| Backend tests | `dotnet test SirLocked.sln --no-build` | 529+ passed, 0 failed |
| Mongo integration | `./scripts/test-v3-mongo.ps1` | exit 0 |
| Frontend typecheck | `cd src/FE; npm run typecheck` | exit 0 |

## Scope

**In scope**:
- `src/BE/Services/RoomLifecycle.cs` (mới, thuần)
- `src/BE/Services/RoomService.cs`
- `src/BE/Tests/RoomLifecycleTests.cs` (mới)
- `src/BE/IntegrationTests/` — test đua khi start
- `src/FE/Client/js/pages/lobbyPage.js` — chỉ hiển thị lỗi cho đúng, nếu cần

**Out of scope**:
- Đổi ý nghĩa của `ABANDONED` hay thêm trạng thái mới (ví dụ `PAUSED` — thuộc plan 019).
- Host migration (plan 023).
- Đổi `RoomStatus` từ hằng chuỗi sang enum C# — đây là refactor có blast radius rộng qua BSON và DTO; tách riêng nếu cần.
- Đổi luật grace period trong `RoomRecoveryRules`.

## Design decisions locked before coding

1. **Một bảng chuyển trạng thái duy nhất, thuần, liệt kê hết.** Không dùng "chặn vài trạng thái xấu" mà dùng "chỉ cho phép các cặp hợp lệ". Mọi cặp không có trong bảng đều bị từ chối. Đây là điểm khác biệt cốt lõi so với code hiện tại.
2. **`COMPLETED` và `ABANDONED` là terminal tuyệt đối.** Không có bất kỳ cặp `(COMPLETED, *)` hay `(ABANDONED, *)` nào trong bảng.
3. **Status phải nằm trong filter của mọi thao tác ghi lobby**, không chỉ `LobbyVersion`. `JoinAsync` và `AbandonAsync` đã làm đúng; `StartAsync`, `SelectRoleAsync`, `SetReadyAsync`, `LeaveAsync` phải theo.
4. **Message lỗi ổn định theo trạng thái**, để FE và test bám vào được: phòng terminal trả 409 với message riêng, không trộn vào message "game đã bắt đầu".
5. **Không đổi hành vi hợp lệ hiện có.** Phòng `WAITING`/`READY` phải làm được đúng những gì đang làm được; đây là plan sửa lỗ hổng, không phải plan đổi luật lobby.

## Bảng chuyển trạng thái hợp lệ

| Từ | Sang | Kích hoạt bởi |
|---|---|---|
| `WAITING` | `WAITING` | join, select role, set ready = false, leave |
| `WAITING` | `READY` | người thứ hai ready, đủ hai vai khác nhau |
| `READY` | `WAITING` | đổi vai, bỏ ready, một người rời |
| `READY` | `READY` | thao tác không đổi điều kiện ready |
| `READY` | `IN_PROGRESS` | host start |
| `IN_PROGRESS` | `COMPLETED` | accusation resolve |
| `IN_PROGRESS` | `ABANDONED` | host abandon sau grace period |

Mọi cặp khác — bao gồm `ABANDONED → *`, `COMPLETED → *`, `WAITING → IN_PROGRESS` (phải qua `READY`), `IN_PROGRESS → WAITING` — đều không hợp lệ.

> Đã kiểm chứng: `SetReadyAsync` **có** ghi `READY` khi đủ hai người và cả hai ready (`RoomService.cs:271-273`), nên `READY → IN_PROGRESS` là đường thật và `WAITING → IN_PROGRESS` không cần nằm trong bảng.
>
> Nhưng cũng đã phát hiện một trạng thái lệch liên quan: `SelectRoleAsync` đặt `player.IsReady = false` (`RoomService.cs:198`) mà **không tính lại `room.Status`**. Một phòng đang `READY`, khi một người đổi vai, sẽ giữ nguyên `Status = READY` trong khi thực tế chưa ai sẵn sàng. Việc này chưa cho phép start sai vì `StartAsync:307-313` vẫn kiểm tra `IsReady` của từng người, nên đây là lệch hiển thị chứ không phải lỗ hổng. Vẫn sửa trong plan này (Step 5) vì nó cùng loại vấn đề: trạng thái phòng không phản ánh dữ liệu phòng.

## Steps

### Step 1: `RoomLifecycle` thuần

Tạo `src/BE/Services/RoomLifecycle.cs`:

```csharp
public static class RoomLifecycle
{
    public static bool IsTerminal(string status);
    public static bool CanTransition(string from, string to);
    public static bool AllowsLobbyMutation(string status);   // WAITING | READY
    public static bool AllowsStart(string status);           // READY (+ WAITING nếu ghi chú trên áp dụng)
}
```

Bảng cặp hợp lệ là một `HashSet<(string, string)>` `static readonly`, khai báo đúng bảng ở trên. Không có nhánh `if` rải rác.

**Verify**: `dotnet build SirLocked.sln` → exit 0.

### Step 2: Siết `RequireLobby`

Đổi `RoomService.RequireLobby` (`:360-366`) để dùng `RoomLifecycle.AllowsLobbyMutation(room.Status)`. Ném 409 với message phân biệt:

- `IN_PROGRESS` → "The game has already started." (giữ nguyên chuỗi hiện tại để không phá test/FE)
- `COMPLETED` hoặc `ABANDONED` → "This room has already ended and cannot be reused."

**Verify**: `dotnet build SirLocked.sln` → exit 0. `dotnet test SirLocked.sln --no-build` → pass.

### Step 3: Siết `StartAsync`

Thay khối `:298-305` bằng kiểm tra `RoomLifecycle.AllowsStart(room.Status)`, ném đúng message theo trạng thái (`IN_PROGRESS` giữ nguyên chuỗi cũ; terminal dùng chuỗi mới ở Step 2).

Sau đó chuyển bước lưu sang **atomic filter có status**, theo đúng mẫu của `JoinAsync` (`:110-118`):

```csharp
var startFilter = Builders<GameRoom>.Filter.And(
    Builders<GameRoom>.Filter.Eq(r => r.Id, room.Id),
    Builders<GameRoom>.Filter.In(r => r.Status, RoomLifecycle.StartableStatuses),
    Builders<GameRoom>.Filter.Eq(r => r.LobbyVersion, expectedVersion));
```

Nếu `ModifiedCount == 0` thì retry đúng như vòng lặp hiện tại, và sau lần thứ hai ném `Conflict("The room changed; please retry.")`.

**Verify**: `dotnet test SirLocked.sln --no-build` → pass.

### Step 4: Sửa `LeaveAsync`

Ở `:164`, thay `room.Status = RoomStatus.Waiting;` bằng: chỉ hạ về `WAITING` khi trạng thái hiện tại là `WAITING` hoặc `READY`. Nếu phòng đã terminal thì `LeaveAsync` phải từ chối bằng 409 "This room has already ended." trước khi thay đổi gì (đặt kiểm tra ngay sau `RequireMember` ở `:139`).

Giữ nguyên hành vi chuyển host ở `:159-162` cho phòng lobby.

**Verify**: `dotnet test SirLocked.sln --no-build` → pass.

### Step 5: Thêm status vào filter của các ghi lobby còn lại

`SelectRoleAsync`, `SetReadyAsync`, `LeaveAsync` đang lưu qua `TrySaveLobbyAsync` (chỉ lọc `LobbyVersion`). Thêm tham số cho phép truyền tập status kỳ vọng:

```csharp
private async Task<bool> TrySaveLobbyAsync(GameRoom room, IReadOnlyCollection<string> expectedStatuses)
```

và đưa `Filter.In(r => r.Status, expectedStatuses)` vào `ReplaceOneAsync`. Các nơi gọi truyền tập lobby (`WAITING`, `READY`).

Trong cùng bước, sửa lệch trạng thái đã nêu ở ghi chú dưới bảng: `SelectRoleAsync` phải tính lại `room.Status` sau khi reset `IsReady`, dùng đúng biểu thức đang có trong `SetReadyAsync` (`RoomService.cs:271-273`). Tách biểu thức đó ra một helper `RecomputeLobbyStatus(room)` và gọi từ cả hai chỗ, thay vì lặp lại.

**Verify**: `dotnet build SirLocked.sln` → exit 0; `dotnet test SirLocked.sln --no-build` → pass. Thêm test: phòng `READY`, một người đổi vai → `Status` trở về `WAITING`.

### Step 6: Test vét cạn bảng chuyển trạng thái

Tạo `src/BE/Tests/RoomLifecycleTests.cs`:

- `[Theory]` với **tích Descartes đầy đủ** của 5 trạng thái × 5 trạng thái = 25 cặp; khẳng định `CanTransition` trả đúng theo bảng. Đây là test quan trọng nhất của plan: nó biến bảng thành hợp đồng.
- `IsTerminal` đúng cho `COMPLETED`/`ABANDONED` và sai cho ba trạng thái còn lại.
- `AllowsLobbyMutation` và `AllowsStart` khớp bảng.

**Verify**: `dotnet test SirLocked.sln --no-build` → 25 case pass.

### Step 7: Test hành vi service trên phòng terminal

Thêm vào test suite hiện có (hoặc file mới `RoomTerminalGuardTests.cs`), với phòng `ABANDONED` và phòng `COMPLETED`:

- `SelectRoleAsync` → 409, message terminal.
- `SetReadyAsync` → 409.
- `StartAsync` → 409, và **`GameplayState` cũ không bị thay đổi** (khẳng định rõ `Version` và `CompletedAt` giữ nguyên — đây là hồi quy chính).
- `LeaveAsync` → 409, và `Status` vẫn terminal.
- `JoinAsync` → vẫn 409 như hiện tại (đã đúng sẵn, thêm test để khóa hành vi).

**Verify**: `dotnet test SirLocked.sln --no-build` → pass.

### Step 8: Test đua khi start

Thêm vào `src/BE/IntegrationTests/MongoGameplayConcurrencyTests.cs` (chạy khi `SIRLOCKED_RUN_MONGO_IT=true`): hai lời gọi `StartAsync` đồng thời trên cùng phòng `READY` → đúng **một** thành công, một nhận 409, và trong DB chỉ có một `GameplayState` với `Version == 1`.

**Verify**: `./scripts/test-v3-mongo.ps1` → exit 0.

### Step 9: Thông báo phía FE

Trong `lobbyPage.js`, hiển thị message terminal như một trạng thái cuối (kèm nút quay lại danh sách case) thay vì để người chơi bấm lại vô ích. Không thêm logic đoán trạng thái ở client — chỉ hiển thị message server trả về.

**Verify**: `cd src/FE; npm run typecheck; npm run build` → exit 0.

## Test plan

- Backend build, 0 warning.
- Toàn bộ suite backend pass (baseline 529 + ~35 test mới).
- 25 case chuyển trạng thái pass.
- Mongo integration pass, gồm test đua khi start.
- Frontend typecheck + build.
- Smoke thủ công: tạo phòng, start, abandon (chờ hết grace period), rồi thử select role / ready / start / leave → tất cả bị từ chối, và trận cũ vẫn xem được kết quả.

## Done criteria

- [ ] Phòng `ABANDONED` hoặc `COMPLETED` không thể select role, ready, start hay leave.
- [ ] `StartAsync` trên phòng terminal không ghi đè `GameplayState` — có test khẳng định.
- [ ] `LeaveAsync` không đưa phòng terminal về `WAITING`.
- [ ] Mọi ghi lobby đều có `Status` trong filter, không chỉ `LobbyVersion`.
- [ ] Test phủ đủ 25 cặp chuyển trạng thái.
- [ ] Hai start đồng thời chỉ tạo một gameplay state.
- [ ] Hành vi hợp lệ của phòng `WAITING`/`READY` không đổi — toàn bộ test cũ vẫn pass.
- [ ] `plans/README.md` cập nhật trạng thái plan 016.

## STOP conditions

- Phát hiện `SetReadyAsync` **không** ghi trạng thái `READY` và việc sửa nó làm fail test lobby hiện có → dừng, giữ `WAITING → IN_PROGRESS` trong bảng và báo lại; đổi luật ready là thay đổi hành vi, không thuộc plan này.
- Phải đổi `RoomStatus` thành enum C# để hoàn thành → dừng; đó là refactor riêng, chạm BSON và DTO.
- Có case/room production đang ở trạng thái không nằm trong 5 giá trị đã biết → dừng, báo lại trước khi siết.

## Maintenance notes

Khi plan 019 thêm trạng thái `PAUSED` và plan 023 thêm host migration, **chỉ sửa bảng trong `RoomLifecycle`** rồi mở rộng `[Theory]` sang tích Descartes 6×6 hoặc 7×7. Đó là toàn bộ điểm của việc tập trung bảng vào một nơi: mỗi trạng thái mới tốn một dòng bảng và một lượt cập nhật test, không phải đi tìm lại các `if` rải rác trong `RoomService`.
