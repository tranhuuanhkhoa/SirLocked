# Plan 015: Accusation Consensus Between Both Players

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat af3da77..HEAD -- src/BE/Services/GameplayService.cs src/BE/Services/GameRules.cs src/BE/Services/GameplayV2Rules.cs src/BE/Services/PairedConfrontationCoordinator.cs src/BE/Services/PairedConfrontationRules.cs src/BE/Models/GameRoom.cs src/BE/DTOs/Submission src/FE/Client/js/pages/gamePage.ts`
> Nếu bất kỳ file nào đã đổi, so lại "Current state" bên dưới với code thật trước khi làm.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (nên làm sau 016 để tránh trùng vùng sửa `RoomService`; 013 là tùy chọn, chỉ để telemetry của feature này được lưu)
- **Category**: gameplay
- **Planned at**: commit `af3da77`, 2026-07-27

## Why this matters

`GameplayService.AccuseAsync` (`:1431`) cho phép **một** người chơi kết thúc trận cho cả đội. Người kia không được hỏi, không được xem, không được phản đối. Sau lời gọi đó `room.Status = RoomStatus.Completed` và `GameResult` được ghi vĩnh viễn.

Đây là vấn đề #6 trong top-50 của `docs/EXPERT_AUDIT_2026-07-18_VI.md`, và bản review giả lập ở mục 18 nêu đúng nó là lý do trừ điểm: *"một lần đồng đội bấm cáo buộc sai đã kết thúc cả trận"*.

Nó cũng mâu thuẫn trực tiếp với hướng đi V3. `docs/CORE_GAMEPLAY_FEASIBILITY_AUDIT_VI.md` mục 1 liệt kê "accusation hiện là action đơn phương của bất kỳ thành viên nào" là một trong năm khoảng trống cốt lõi, và mục 10.3 đã khóa mô hình joint review cho confrontation. Cáo buộc cuối — quyết định quan trọng nhất trong cả trận — lại đang là hành động một người, trong khi một mâu thuẫn lời khai nhỏ thì phải hai người xác nhận. Đây là bất nhất về thiết kế, không chỉ là thiếu tính năng.

Điểm thuận lợi: **mô hình cần dùng đã tồn tại và đã qua gate kỹ thuật.** Plan này không phát minh cơ chế mới, nó áp dụng đúng state machine của paired confrontation cho accusation.

## Current state

### Luồng cáo buộc hiện tại

- `src/BE/WebAPI/Controllers/GameController.cs:87-89` — `POST /api/game/rooms/{roomId}/accuse` → `AccuseAsync`.
- `src/BE/Services/GameplayService.cs:1431-1500` — `AccuseAsync`:
  - `:1433` `LoadContextAsync(..., requireInProgress: true)`
  - `:1435` `RequireNoActiveConfrontation(state)`
  - `:1437-1441` `GameRules.IsAccusationAvailable(gameCase, state, playerSceneId)`
  - `:1443-1446` kiểm tra culprit tồn tại
  - `:1448-1466` phân nhánh V2 (`GameplayV2Rules.ValidateAccusation` + `IsAccusationCorrect`) và V1 (culprit + `RequiredEvidenceIds`)
  - `:1468-1480` `GameResultFactory.CreateSnapshot`, set `GameStatus`, `CompletedAt`, `FinalAccusationSnapshot`, `room.Status = Completed`
  - `:1482-1485` `TrySaveStateAsync` (optimistic theo `GameplayState.Version`)
  - `:1487` `GameResultPersistenceCoordinator.MaterializeAsync` — **đã bảo đảm exactly-once cho `GameResult`**
  - `:1489-1500` log, notify `GameCompleted`, notify version
- `src/BE/Services/GameRules.cs:166-185` — `IsAccusationAvailable`, gồm cả điều kiện V3 `everyV3CrackResolved`.

### Mô hình đồng thuận đã có sẵn để tái dùng

- `src/BE/Models/GameRoom.cs:149-164` — `PairedConfrontationState`: `AttemptId`, `ChallengeId`, `Status`, `Revision`, các trường proposal, `Confirmations`, `Disclosures`, `CreatedAt`, `UpdatedAt`.
- `src/BE/Models/GameRoom.cs:166-173` — `PlayerConfrontationConfirmation`: `UserId`, `Role`, `Revision`, `ConfirmedAt`.
- `src/BE/Models/Enums/PairedConfrontationStatus.cs` — `CollectingProposals`, `ReadyForReview`, `AwaitingSecondConfirmation`, `ResolvedCorrect`, `ResolvedIncorrect`, `Cancelled`.
- `src/BE/Services/PairedConfrontationRules.cs` — luật thuần, ném `PairedConfrontationRuleException`, trả `PairedConfrontationTransition`.
- `src/BE/Services/PairedConfrontationCoordinator.cs:168-226` — `ExecuteAsync`: vòng lặp `MaxWriteAttempts`, load context → gọi transition thuần → `_persistence.TrySaveAsync` → nếu fail thì ghi `OptimisticRetry` và retry → notify version → ghi playtest events → trả response. **Đây là mẫu bắt buộc theo cho plan này.**
- `src/BE/WebAPI/Controllers/PairedConfrontationsController.cs` — mẫu route: `POST` tạo, `PUT` sửa, `POST {id}/confirm`, `POST {id}/cancel`, mọi lệnh nhận `ExpectedRevision`.
- `src/BE/Models/GameRoom.cs:76-79` — `GameplayState.ActiveConfrontation` và `PairedConfrontationAttempts` là chỗ để đặt trường tương tự cho accusation.

### Frontend

- `src/FE/Client/js/game/gameUiModel.ts:3` — **đã có** `export type AccusationDraft` và `:21` `{ kind: 'ACCUSATION'; draft: AccusationDraft }`. Kiểu này hiện chỉ dùng ở client.
- `src/FE/Client/js/pages/gamePage.ts` — khối accusation (theo bản đồ trong audit là vùng ~2941-3027 của bản 3.808 dòng; file hiện 4.075 dòng nên **phải tìm lại bằng `rg -n "accus" src/FE/Client/js/pages/gamePage.ts`**, không tin số dòng cũ).
- `src/FE/Client/js/game/pairedConfrontation.ts` — mẫu UI joint review đã có, tái dùng bố cục và trạng thái chờ.

### Chưa có

- Không có model proposal, không có endpoint nào ngoài `POST /accuse`, không có test nào về đồng thuận.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend build | `dotnet build SirLocked.sln` | exit 0, 0 warning |
| Backend tests | `dotnet test SirLocked.sln --no-build` | 529+ passed, 0 failed |
| Mongo integration | `./scripts/test-v3-mongo.ps1` | exit 0 |
| Frontend typecheck | `cd src/FE; npm run typecheck` | exit 0 |
| Frontend build | `cd src/FE; npm run build` | exit 0 |
| Two-browser E2E | `cd src/FE; npx playwright test tests/v3-two-browser-flow.spec.ts` | pass |

## Scope

**In scope**:
- `src/BE/Models/GameRoom.cs` — thêm model proposal (additive)
- `src/BE/Models/Enums/AccusationProposalStatus.cs` (mới)
- `src/BE/Services/AccusationConsensusRules.cs` (mới, thuần)
- `src/BE/Services/AccusationConsensusCoordinator.cs` (mới)
- `src/BE/Services/GameplayService.cs` — tách phần resolve dùng chung, giữ `AccuseAsync` cho đường đơn phương
- `src/BE/Configurations/AccusationSettings.cs` (mới)
- `src/BE/WebAPI/Controllers/GameController.cs` hoặc `AccusationsController.cs` (mới)
- `src/BE/DTOs/Submission/`, `src/BE/DTOs/Investigation/GameStateDtos.cs`
- `src/BE/Services/GameStateBuilder.cs` — project proposal vào state
- `src/BE/Tests/`, `src/BE/IntegrationTests/`
- `src/FE/Client/js/pages/gamePage.ts`, `src/FE/Client/js/game/`, `src/FE/Client/js/api/gameApi.js`
- `src/FE/tests/` — E2E hai browser
- `README.md`

**Out of scope**:
- Đổi logic tính đúng/sai của cáo buộc (`GameplayV2Rules.IsAccusationCorrect`, `GameResultFactory`, scoring). Plan này chỉ đổi **ai được bấm nút**, không đổi **kết quả ra sao**.
- Đổi `GameRules.IsAccusationAvailable`.
- Tự động resolve khi hết thời gian chờ.
- Dual accusation cho V1/V2 khi cấu hình không bật.
- Tách `gamePage.ts` (plan 029).

## Design decisions locked before coding

1. **State machine tối giản, khác confrontation ở một điểm.** Trong confrontation, mỗi vai sở hữu một nửa proposal. Trong accusation, một người soạn **toàn bộ** đề xuất rồi người kia duyệt. Vì vậy không có trạng thái `CollectingProposals`:

```
   (không có proposal)
        │ propose
        ▼
   AWAITING_CONFIRMATION ──── confirm (người còn lại) ────► RESOLVED → kết thúc trận
        │  ▲                                                     
        │  └── amend (bất kỳ ai): revision + 1, xóa confirmations
        │ cancel
        ▼
    CANCELLED (giữ lại làm lịch sử, cho phép tạo proposal mới)
```

2. **Người đề xuất tự động xác nhận revision của mình.** `Propose` ghi luôn một `Confirmation` cho người gọi ở revision đó. Resolve xảy ra khi tập `Confirmations` ở revision hiện tại chứa **cả hai** userId trong phòng. Nhờ vậy không cần bước "proposer bấm xác nhận lần nữa".
3. **Amend xóa mọi confirmation.** Ai sửa thì người đó trở thành người xác nhận duy nhất của revision mới. Đây là đúng quy tắc đã khóa cho confrontation ("confirmation gắn với revision").
4. **Confirm phải mang `ExpectedRevision`.** Confirm với revision cũ bị từ chối bằng lỗi coded, không tự nâng cấp lên revision mới. Chống race và chống "xác nhận nhầm bản đã bị sửa".
5. **Cổng bật theo mechanics version, không phải theo cờ toàn cục.**
   - `AccusationSettings.RequireConsensus` kiểu `bool?`.
   - `null` (mặc định) → bắt buộc đồng thuận khi `MechanicsVersion >= InvestigationV3PairedConfrontation`, giữ đơn phương cho V1/V2.
   - `true`/`false` → ép cho mọi version.

   Lý do khóa như vậy — đã kiểm chứng, không phải phỏng đoán: `scripts/e2e_smoke.py:203` và `:215` gọi thẳng `POST /api/game/rooms/{roomId}/accuse` trên sample case, và `MockCaseFactory.cs:51` cho sample case `MechanicsVersion = InvestigationV2`. Smoke test này chạy trong job `api-smoke` của `.github/workflows/ci.yml`. Ép đồng thuận toàn cục sẽ làm đỏ CI ngay lập tức và phá mọi case V1/V2 đã publish. Đây là lựa chọn có chủ đích, không phải né việc.
6. **Chỉ một proposal hoạt động tại một thời điểm**, đặt ở `GameplayState.ActiveAccusation`. Các proposal đã cancel đi vào `AccusationAttempts` để giữ lịch sử và cho phép thử lại.
7. **Nội dung proposal là thông tin chung, không phải thông tin riêng.** Cả hai người đều thấy đầy đủ culprit/motive/method/evidence ngay khi có proposal — đây là bước "cùng nhìn rồi cùng quyết", không phải bước giấu bài. Vì vậy không cần luật projection riêng, nhưng **vẫn phải test** rằng không có ID nào rò rỉ trước khi proposal tồn tại.
8. **`POST /accuse` cũ được giữ nguyên** và trở thành đường đơn phương. Khi đồng thuận đang bật, nó trả 409 với mã lỗi ổn định chỉ sang endpoint mới. Không xóa route để không phá client cũ.
9. **Resolve dùng lại đúng code hiện tại.** Tách `:1443-1500` của `AccuseAsync` thành một hàm private dùng chung `ResolveAccusationAsync(room, gameCase, user, request)`; cả đường đơn phương và đường đồng thuận gọi chung nó. Không sao chép logic.

## API

Prefix `api/game/rooms/{roomId}/accusation`, `[Authorize]`, envelope `ApiResponse<AccusationCommandResponse>` — cùng phong cách `PairedConfrontationsController`.

| Method | Route | Body | Ghi chú |
|---|---|---|---|
| `POST` | `/` | `AccuseRequest` | Tạo proposal, tự xác nhận cho người gọi |
| `PUT` | `/{attemptId}` | `AccuseRequest` + `expectedRevision` | Sửa, revision + 1, xóa confirmations |
| `POST` | `/{attemptId}/confirm` | `expectedRevision` | Xác nhận; nếu đủ hai người → resolve |
| `POST` | `/{attemptId}/cancel` | `expectedRevision` | Hủy, ghi vào lịch sử |

`AccusationCommandResponse` chứa `state` (GameStateResponse như hiện tại) + `accusation` (proposal hiện hành, có `status`, `revision`, `proposedBy`, `confirmedUserIds`) + `result` (chỉ khác null khi vừa resolve).

Mã lỗi ổn định: `ACCUSATION_STALE_REVISION`, `ACCUSATION_NOT_ACTIVE`, `ACCUSATION_ALREADY_CONFIRMED`, `ACCUSATION_CONSENSUS_REQUIRED`.

## Steps

### Step 1: Model và enum

Thêm vào `src/BE/Models/GameRoom.cs`:

```csharp
public sealed class AccusationProposalState
{
    public string AttemptId { get; set; }
    [BsonRepresentation(BsonType.String)]
    public AccusationProposalStatus Status { get; set; }
    public int Revision { get; set; } = 1;
    public string ProposedByUserId { get; set; }
    public string ProposedByRole { get; set; }
    public string CulpritId { get; set; }
    public string? MotiveId { get; set; }
    public string? MethodId { get; set; }
    public List<string> EvidenceIds { get; set; } = new();
    public List<SelectedEvidenceLink> EvidenceLinks { get; set; } = new();
    public List<PlayerConfrontationConfirmation> Confirmations { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

Thêm `GameplayState.ActiveAccusation` (nullable) và `GameplayState.AccusationAttempts` (list). Tái dùng `PlayerConfrontationConfirmation` — cùng shape, không tạo type trùng.

`AccusationProposalStatus`: `AwaitingConfirmation`, `Resolved`, `Cancelled`.

**Bắt buộc**: đánh dấu `[BsonIgnoreExtraElements]` như các class lân cận, và kiểm tra room document cũ (không có hai trường mới) vẫn deserialize được.

**Verify**: `dotnet build SirLocked.sln` → exit 0. `dotnet test SirLocked.sln --no-build` → pass (test BSON legacy hiện có phải vẫn xanh).

### Step 2: `AccusationConsensusRules` thuần

Không chạm Mongo, không async. Trả về `AccusationTransition { bool Changed, AccusationProposalState? Active, AccusationProposalState? Terminal, bool ShouldResolve }`, ném `AccusationRuleException` với mã lỗi ổn định.

Hàm cần có: `Propose`, `Amend`, `Confirm`, `Cancel`.

Luật bất biến phải cài trong lớp này:

- Không tạo proposal mới khi đã có proposal `AwaitingConfirmation`.
- `Amend`/`Confirm`/`Cancel` yêu cầu `attemptId` khớp proposal đang hoạt động.
- `ExpectedRevision` khác `Revision` hiện tại → `ACCUSATION_STALE_REVISION`.
- Một người xác nhận hai lần trên cùng revision → không tăng số confirmation (idempotent, không phải lỗi).
- `ShouldResolve = true` chỉ khi số userId phân biệt trong `Confirmations` ở revision hiện tại bằng số người trong phòng (2).
- Không cho `Propose` khi `GameRules.IsAccusationAvailable` trả false — dùng lại đúng hàm đó, không viết lại điều kiện.

**Verify**: `dotnet build SirLocked.sln` → exit 0.

### Step 3: `AccusationConsensusCoordinator`

Sao chép **cấu trúc** `PairedConfrontationCoordinator.ExecuteAsync` (`:168-226`): vòng lặp `MaxWriteAttempts`, load context qua `IGameplayContextLoader`, gọi rules thuần, `_persistence.TrySaveAsync`, retry khi optimistic fail, notify version qua `IGameNotifier`, ghi playtest events.

Khi `transition.ShouldResolve`: gọi hàm resolve dùng chung ở Step 4 **trong cùng lượt ghi**, để không có khoảng hở giữa "đã đủ hai xác nhận" và "trận kết thúc".

**Verify**: `dotnet build SirLocked.sln` → exit 0.

### Step 4: Tách phần resolve dùng chung

Trong `GameplayService`, tách `:1443-1500` thành `private async Task<GameResultResponse> ResolveAccusationCoreAsync(GameRoom room, GameCase gameCase, CurrentUser actor, AccuseRequest request)` và cho `AccuseAsync` gọi nó. Đưa hàm này ra interface nội bộ (`IAccusationResolver`) để coordinator dùng được.

**Không đổi một dòng logic nào bên trong** — chỉ di chuyển. Xác nhận bằng cách chạy suite trước và sau: cùng số test pass.

**Verify**: `dotnet test SirLocked.sln --no-build` → đúng số test như trước Step 4, 0 fail.

### Step 5: Cổng đồng thuận

Tạo `AccusationSettings { bool? RequireConsensus }`, bind section `Accusation`, đăng ký trong `Program.cs`.

Hàm quyết định đặt cạnh rules:

```csharp
public static bool RequiresConsensus(GameCase gameCase, bool? configured) =>
    configured ?? gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation;
```

Trong `AccuseAsync`, nếu `RequiresConsensus(...)` → ném 409 `ACCUSATION_CONSENSUS_REQUIRED` với message chỉ sang endpoint mới.

**Verify**: `dotnet test SirLocked.sln --no-build` → toàn bộ test V1/V2 hiện có vẫn pass **không cần sửa**. Nếu có test phải sửa, dừng lại và xem lại Step 5 — đó là dấu hiệu cổng đang sai.

### Step 6: Controller và DTO

Tạo `AccusationsController` theo mẫu `PairedConfrontationsController`. DTO request/response đặt cùng thư mục với DTO submission hiện có. Giữ `POST /accuse` cũ nguyên vị trí trong `GameController`.

**Verify**: `dotnet build SirLocked.sln` → exit 0. Bật Swagger local, thấy đủ 4 route mới.

### Step 7: Project proposal vào game state

Trong `GameStateBuilder`, thêm `activeAccusation` vào `GameStateResponse` (nullable). Nội dung: `attemptId`, `status`, `revision`, `proposedByUserId`, `proposedByRole`, `culpritId`, `motiveId`, `methodId`, `evidenceIds`/`evidenceLinks`, `confirmedUserIds`, `updatedAt`.

Khi không có proposal → `null`, và **không** thêm trường nào khác vào response.

**Verify**: `dotnet test SirLocked.sln --no-build` → `GameStateProjectionTests` pass; thêm test khẳng định `activeAccusation == null` khi chưa có proposal.

### Step 8: Test luật thuần

`src/BE/Tests/AccusationConsensusRuleTests.cs`:

- Propose khi accusation chưa mở → lỗi.
- Propose → status `AwaitingConfirmation`, revision 1, đúng một confirmation của người đề xuất.
- Người kia confirm → `ShouldResolve == true`.
- Người đề xuất confirm lại → không resolve, không tăng confirmation.
- Amend bởi partner → revision 2, confirmations chỉ còn người amend, `ShouldResolve == false`.
- Confirm với `expectedRevision = 1` sau khi đã amend → `ACCUSATION_STALE_REVISION`.
- Propose lần hai khi đang có proposal → lỗi.
- Cancel → `Cancelled`, vào lịch sử, propose mới được phép.
- Cancel/confirm với `attemptId` sai → lỗi.

**Verify**: `dotnet test SirLocked.sln --no-build` → pass.

### Step 9: Test exactly-once (bắt buộc)

`src/BE/IntegrationTests/` (chạy khi `SIRLOCKED_RUN_MONGO_IT=true`): hai lời gọi `Confirm` đồng thời từ hai người trên cùng revision → đúng **một** `GameResult` trong DB, `room.Status == COMPLETED` đúng một lần, và lời gọi thua nhận lỗi ổn định thay vì 500.

Đây là test quan trọng nhất của plan: nó là điểm khác biệt giữa "có đồng thuận" và "có đồng thuận mà không hỏng dữ liệu".

**Verify**: `./scripts/test-v3-mongo.ps1` → exit 0.

### Step 10: UI

Trong `gamePage.ts` (tìm vùng accusation bằng `rg -n "accus"`, không dựa vào số dòng cũ):

- Nút "Cáo buộc" mở form như hiện tại, nhưng submit gọi `POST /accusation` thay vì `/accuse`.
- Sau khi có proposal: cả hai thấy bảng tóm tắt đề xuất (culprit, motive, method, danh sách evidence), trạng thái xác nhận của từng người, và nút **Xác nhận** / **Sửa** / **Hủy**.
- Người đã xác nhận thấy trạng thái chờ, tái dùng bố cục chờ của `pairedConfrontation.ts`.
- Khi partner sửa, hiện rõ "đề xuất đã thay đổi, hãy xem lại" và vô hiệu hóa nút xác nhận cũ (client đọc `revision` từ state, không tự đoán).
- Mọi chuỗi qua `escapeHtml` và có bản dịch EN/VI qua `tr()`.

**Verify**: `cd src/FE; npm run typecheck; npm run build` → exit 0.

### Step 11: E2E hai browser

Thêm `src/FE/tests/v3-accusation-consensus.spec.ts` theo mẫu `v3-two-browser-flow.spec.ts`:

A đề xuất → B thấy đề xuất → B sửa → A thấy cảnh báo revision đổi → A xác nhận → B xác nhận → màn kết quả hiện cho **cả hai**.

**Verify**: `npx playwright test tests/v3-accusation-consensus.spec.ts` → pass.

### Step 12: Telemetry và docs

Thêm event type `AccusationProposed`, `AccusationAmended`, `AccusationConfirmed`, `AccusationCancelled` vào cuối `PlaytestEventType` và phát từ coordinator. Nếu plan 013 chưa xong thì sink No-Op vẫn nuốt — không sao, điểm phát vẫn đúng chỗ.

Cập nhật README: mô tả luồng đồng thuận và khóa `Accusation__RequireConsensus`.

**Verify**: `dotnet test SirLocked.sln --no-build` → pass; `rg -n "Accusation__" README.md src/BE` khớp.

## Test plan

- Backend build, 0 warning.
- Toàn bộ suite backend pass; **không test V1/V2 nào phải sửa**.
- Test luật thuần mới (Step 8).
- Test exactly-once trên Mongo cô lập (Step 9).
- Frontend typecheck + build.
- E2E hai browser (Step 11).
- Smoke thủ công trên `case-v3-broken-seal-vi`: chơi đến cuối, thử mọi nhánh propose/amend/confirm/cancel, kiểm tra chỉ có một `gameResults` document cho phòng.

## Done criteria

- [ ] Với case V3, một người **không thể** kết thúc trận; cần xác nhận của cả hai trên cùng revision.
- [ ] Sửa đề xuất xóa toàn bộ xác nhận trước đó.
- [ ] Xác nhận với revision cũ bị từ chối bằng mã lỗi ổn định.
- [ ] Xác nhận trùng lặp là idempotent, không phải lỗi.
- [ ] Đúng một `GameResult` cho mỗi phòng kể cả khi hai người bấm xác nhận cùng lúc.
- [ ] Case V1/V2 chơi hết được như cũ, không test nào phải sửa.
- [ ] `POST /accuse` cũ vẫn tồn tại, trả lỗi có hướng dẫn khi đồng thuận đang bật.
- [ ] Logic tính đúng/sai và scoring không đổi — cùng input cho cùng kết quả như trước.
- [ ] Room document cũ (không có trường accusation) vẫn deserialize được.
- [ ] `plans/README.md` cập nhật trạng thái plan 015.

## STOP conditions

- Sau Step 4 (tách hàm resolve) mà số test pass **thay đổi** → dừng ngay; việc tách đã làm đổi hành vi, phải hoàn tác và tách lại.
- Cần sửa test V1/V2 hiện có để plan chạy được → dừng; cổng ở Step 5 đang sai phạm vi.
- Cần đổi `GameRules.IsAccusationAvailable` hoặc `GameplayV2Rules.IsAccusationCorrect` → dừng; nằm ngoài phạm vi, và đổi ở đó là đổi luật thắng/thua chứ không phải luật đồng thuận.
- Không thể bảo đảm exactly-once ở Step 9 bằng optimistic version hiện có → dừng và báo lại trước khi cân nhắc transaction; `docs/CORE_GAMEPLAY_FEASIBILITY_AUDIT_VI.md` đã ghi nhận cấu hình Mongo local không bảo đảm replica set.

## Maintenance notes

Sau plan này, hệ thống có **hai** state machine đồng thuận gần giống nhau (`PairedConfrontationRules` và `AccusationConsensusRules`). Đừng vội gộp chúng: chúng khác nhau ở quyền sở hữu proposal (nửa/nửa so với một người soạn toàn bộ) và ở hậu quả khi resolve (mở khóa clue so với kết thúc trận). Chỉ cân nhắc trừu tượng hóa chung khi xuất hiện state machine đồng thuận thứ ba, và khi đó phải có characterization test cho cả hai cái cũ trước.

Timeout khi partner không phản hồi hiện **không** được xử lý tự động — người chơi có thể hủy đề xuất. Nếu playtest (plan 014) cho thấy các cặp bị kẹt ở bước chờ, hãy thêm cảnh báo đếm ngược ở UI trước, và chỉ cân nhắc auto-resolve sau cùng: tự động kết thúc trận là đúng thứ mà plan này sinh ra để ngăn.
