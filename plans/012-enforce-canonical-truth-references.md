# Plan 012: Khóa canonical reference xuyên suốt AI Case Truth

> **Executor instructions**: Thực hiện lần lượt từng bước và chạy mọi verification
> gate trước khi chuyển bước. Không sửa validator để “cho qua” dữ liệu sai. Nếu gặp
> một điều kiện trong phần **STOP conditions**, dừng và báo lại thay vì tự mở rộng
> phạm vi. Khi hoàn tất, cập nhật trạng thái plan này trong `plans/README.md`.
>
> **Drift check (chạy đầu tiên)**:
>
> ```powershell
> git diff --stat ef6bb18..HEAD -- src/BE/Services/AiGenerationSchemas.cs src/BE/Services/AiCaseService.CaseTruth.cs src/BE/Services/CaseTruthService.cs src/BE/Services/Interfaces/ICaseTruthService.cs src/BE/Tests/CaseTruthServiceTests.cs src/BE/Tests/AiRequestValidationTests.cs
> git status --short -- src/BE/Services/AiGenerationSchemas.cs src/BE/Services/AiCaseService.CaseTruth.cs src/BE/Services/CaseTruthService.cs src/BE/Services/Interfaces/ICaseTruthService.cs src/BE/Tests/CaseTruthServiceTests.cs src/BE/Tests/AiRequestValidationTests.cs
> ```
>
> Các file AI Case Truth hiện là thay đổi chưa commit tại baseline `ef6bb18`, nên
> output `git diff <sha>..HEAD` một mình không đủ phát hiện drift. Đối chiếu thêm
> các excerpt trong **Current state** với worktree thực tế; nếu khác về hành vi,
> coi đó là STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — thay đổi strict schema và điểm bắt đầu repair, nhưng giữ nguyên JSON model và schema version
- **Depends on**: none
- **Category**: bug, tests, tech-debt
- **Planned at**: commit `ef6bb18`, 2026-07-23; worktree có thay đổi AI workflow chưa commit

## Why this matters

Một OpenAI response thực tế đã tạo `coreTruth.*ActionIds` và
`traceLedger.sourceActionId` dạng `action_*`, trong khi timeline chỉ định nghĩa
`eventId` dạng `event_*`; các `action_*` chỉ xuất hiện trong prose của trường
`action`. Budget vẫn đúng (12 timeline, 10 trace, 10 statement, 5 conclusion),
nhưng deterministic validation trả 11 lỗi core action và ít nhất 9 lỗi trace
reference. Auto-repair hiện có thể lặp lại cùng lỗi vì prompt vẫn khuyến khích
namespace riêng và JSON Schema không khóa ID theo upstream.

Sau plan này, `trueTimeline[].eventId` là canonical causal-action ID duy nhất của
CaseTruthPackage v1. Mọi core action, trace source, alibi event, statement event,
proof support và clearing reference phải dùng ID có thật từ artifact upstream.
Sai lệch phải bị chặn ở artifact sớm nhất có thể và repair phải bắt đầu từ
artifact định nghĩa bị thiếu, không regenerate upstream hợp lệ.

## Vetted findings

### CORRECTNESS-01 — Prompt và model dùng hai khái niệm cho cùng một causal ID

- **Evidence**: `src/BE/Models/CaseTruthPackage.cs:133-151` — core gọi các giá trị là action IDs nhưng timeline chỉ có `EventId`; không có structural `ActionId`/`ActionIds` khác.
- **Evidence**: `src/BE/Services/AiCaseService.CaseTruth.cs:541-544` — prompt yêu cầu core tạo action IDs rồi yêu cầu timeline “build every core action”, nhưng không bắt buộc copy ID vào `eventId` và không cấm nhét ID mới vào prose.
- **Impact**: model tạo `action_*` trong core/prose và `event_*` trong timeline, làm toàn bộ causal ledger invalid dù số lượng artifact đúng.
- **Effort**: M.
- **Risk**: MED; phải giữ tương thích với truth v1 đã hợp lệ.
- **Confidence**: HIGH; lỗi đã tái hiện trong output thực tế và khớp trực tiếp code.

### CORRECTNESS-02 — Strict schema chưa khóa reference vào upstream

- **Evidence**: `src/BE/Services/AiGenerationSchemas.cs:162-203` — schema chỉ đặt array bounds và canonical proof conclusion IDs; `sourceActionId`, `alibiEventIds`, `eventIds`, supporting/clearing IDs vẫn là string tự do.
- **Evidence**: `src/BE/Services/AiGenerationSchemas.cs:368-373` — đã có helper tạo string enum nhưng chưa dùng cho các upstream reference nói trên.
- **Impact**: provider có thể trả JSON “strict-schema valid” nhưng chắc chắn thất bại deterministic validation, tốn toàn bộ các call downstream và một repair call.
- **Effort**: M.
- **Risk**: LOW/MED; enum rỗng hoặc reference set sai có thể làm provider từ chối schema, nên phải preflight trước khi gọi.
- **Confidence**: HIGH.

### CORRECTNESS-03 — Validator quy lỗi thiếu definition về phía consumer

- **Evidence**: `src/BE/Services/CaseTruthService.cs:421-423` — core ID không có trong `eventById` được báo tại path `coreTruth`.
- **Evidence**: `src/BE/Services/CaseTruthService.cs:384-388` — repair planner chọn artifact đầu tiên dựa vào prefix path; `coreTruth` khiến regenerate từ CORE_TRUTH thay vì TIMELINE.
- **Impact**: một timeline sai có thể làm mất core truth hợp lệ và lần repair kế tiếp vẫn tái tạo hai namespace.
- **Effort**: S sau khi canonical contract được chốt.
- **Risk**: LOW.
- **Confidence**: HIGH.

### TESTS-01 — Fixture mock luôn tự khớp ID nên không bắt được namespace drift

- **Evidence**: `src/BE/Services/AiCaseMockFactory.cs:127-133` — mock dùng cùng `ActionId` cho core và `TrueTimelineEvent.EventId`.
- **Evidence**: `src/BE/Tests/CaseTruthServiceTests.cs:45-72` — test assembly chỉ xác nhận fixture tự khớp hợp lệ; chưa có regression case nơi action ID chỉ xuất hiện trong prose.
- **Impact**: CI xanh trong khi live OpenAI output thất bại.
- **Effort**: S.
- **Risk**: LOW.
- **Confidence**: HIGH.

## Current state

Các file và vai trò:

- `src/BE/Models/CaseTruthPackage.cs` — contract persisted; giữ nguyên trong plan này.
- `src/BE/Services/AiCaseService.CaseTruth.cs` — điều phối stage, prompt, checkpoint và một bounded deterministic repair.
- `src/BE/Services/AiGenerationSchemas.cs` — tạo OpenAI strict JSON Schema.
- `src/BE/Services/CaseTruthService.cs` — deterministic validation và repair planning.
- `src/BE/Tests/CaseTruthServiceTests.cs` — test truth contract, budget, repair planner và prompt.
- `src/BE/Tests/AiRequestValidationTests.cs` — pattern test strict schemas.

Contract hiện tại tại `src/BE/Models/CaseTruthPackage.cs:133-151`:

```csharp
public List<string> CrimeActionIds { get; set; } = new();

public sealed class TrueTimelineEvent
{
    public string EventId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public List<string> TraceIds { get; set; } = new();
}
```

Validator hiện lấy canonical dictionary duy nhất từ event ID tại
`src/BE/Services/CaseTruthService.cs:56`:

```csharp
var eventById = UniqueBy(result, "trueTimeline", truth.TrueTimeline, item => item.EventId);
```

Nhưng lỗi definition thiếu đang được gán cho core tại dòng 421-423:

```csharp
foreach (var id in core.PreparationActionIds.Concat(core.CrimeActionIds)
             .Concat(core.ConcealmentActionIds).Concat(core.CulpritMistakeActionIds)
             .Where(id => !eventById.ContainsKey(id)))
    result.Add("MissingReference", "coreTruth",
        "Core truth action does not exist in the true timeline.", id);
```

Production schema calls hiện không nhận upstream IDs tại
`src/BE/Services/AiCaseService.CaseTruth.cs:377-411`:

```csharp
AiStrictSchemaProvider.TrueTimelineSchema(budget)
AiStrictSchemaProvider.OpportunityMatrixSchema(budget, truth.CaseSeed.SuspectIds.Count)
AiStrictSchemaProvider.TraceLedgerSchema(budget)
AiStrictSchemaProvider.StatementLedgerSchema(budget)
AiStrictSchemaProvider.ProofGraphSchema(budget)
```

Convention phải giữ: ordinal, case-sensitive IDs (`StringComparer.Ordinal`),
canonical JSON hash, một automatic deterministic repair, checkpoint upstream
hợp lệ không bị generate lại. Mock factory tại
`src/BE/Services/AiCaseMockFactory.cs:127-133` là exemplar đúng: cùng một ID được
dùng cho `CrimeActionIds` và `EventId`.

## Chốt contract trước khi sửa

Không thêm `actionId` hoặc `actionIds` vào `TrueTimelineEvent`, không bump
`CaseTruthSchemaVersions.V1`, và không đổi `GameCase`. Trong truth v1:

1. `trueTimeline[].eventId` vừa là timeline event ID vừa là canonical causal-action ID.
2. Mỗi distinct ID trong hợp của bốn `coreTruth.*ActionIds` phải xuất hiện đúng
   một lần dưới dạng `trueTimeline[].eventId`.
3. Một core ID có thể thuộc nhiều nhóm core (mock hiện dùng một action vừa là
   crime vừa là culprit mistake); không coi việc xuất hiện ở hai nhóm là duplicate.
4. `traceLedger[].sourceActionId`, `opportunityMatrix[].alibiEventIds` và
   `statementLedger[].eventIds` chỉ được tham chiếu `trueTimeline[].eventId`.
5. `trueTimeline[].action` chỉ là prose; mọi chuỗi giống ID trong prose không tạo
   reference và không được dùng downstream.
6. Timeline được phép có auxiliary alibi/witness events ngoài core action set.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused backend tests | `dotnet test src/BE/Tests/SirLocked.Tests.csproj --configuration Release --no-restore --filter "FullyQualifiedName~CaseTruthServiceTests|FullyQualifiedName~AiRequestValidationTests"` | exit 0, all selected tests pass |
| Full backend | `dotnet test SirLocked.sln --configuration Release --no-restore` | exit 0, no failed tests |
| Mongo integration | `./scripts/test-v3-mongo.ps1` | dependency ping succeeds; integration tests execute without skip and pass |
| Frontend typecheck | `cd src/FE; npm run typecheck` | exit 0, no TypeScript errors |
| Frontend build | `cd src/FE; npm run build` | exit 0 |

Không gọi OpenAI/image API thật trong bất kỳ verification nào.

## Scope

**In scope — chỉ sửa/tạo các file sau:**

- `src/BE/Services/CaseTruthReferenceContract.cs` (new)
- `src/BE/Services/AiGenerationSchemas.cs`
- `src/BE/Services/AiCaseService.CaseTruth.cs`
- `src/BE/Services/CaseTruthService.cs`
- `src/BE/Services/Interfaces/ICaseTruthService.cs`
- `src/BE/Tests/CaseTruthServiceTests.cs`
- `src/BE/Tests/AiRequestValidationTests.cs`
- `src/BE/IntegrationTests/AiCaseWorkflowHostTests.cs` only if needed for the no-downstream-before-valid-reference regression test
- `plans/README.md` status only

**Out of scope — không được sửa:**

- `src/BE/Models/CaseTruthPackage.cs` và `CaseTruthSchemaVersions`.
- `src/BE/Models/GameCase.cs`, gameplay rules, V3 Crack contract hoặc projection response shape.
- Model OpenAI, token budgets, image pipeline, queue/lease policy hoặc Mongo schema.
- Tự động “normalize” bằng cách parse ID từ prose `trueTimeline[].action`.
- Xóa hoặc mutate draft/artifact cũ; draft invalid hiện tại phải tiếp tục dùng manual repair.
- Nới validator, bỏ `MissingReference`, hoặc chấp nhận reference không tồn tại.

## Git workflow

- Tạo branch `advisor/012-canonical-truth-references` nếu operator yêu cầu branch.
- Commit message theo convention hiện tại, ví dụ:
  `fix(ai): enforce canonical truth references`.
- Không push, merge hoặc mở PR nếu operator chưa yêu cầu.
- Worktree đang dirty; không stage, revert hoặc format file ngoài scope.

## Steps

### Step 1: Thêm regression tests từ live failure trước khi đổi hành vi

Trong `CaseTruthServiceTests.cs`, tạo test bằng cách clone `ValidTruth()` rồi:

- đổi một core action ID thành `action-pryce-prepares-jam`;
- giữ timeline definition là `event-pryce-prepares-jam`;
- đặt prose `Action` chứa chuỗi `action-pryce-prepares-jam` để chứng minh prose
  không được tính là definition;
- đặt một trace `SourceActionId` thành `action-pryce-prepares-jam`.

Test phải chứng minh validator trả hai lỗi độc lập:

- `MissingCoreTimelineEvent` tại path `trueTimeline` với offending ID;
- `MissingReference` tại đúng `traceLedger[i].sourceActionId`.

Thêm test repair planner: chỉ có `MissingCoreTimelineEvent/trueTimeline` phải
`RegenerateFromArtifact == TIMELINE`, giữ CASE_SEED và CORE_TRUTH, invalidate
OPPORTUNITY trở xuống.

Thêm test prompt cho TIMELINE và EVIDENCE với các câu invariant exact enough để
không bị vô tình xóa khi refactor:

- copy mỗi distinct `coreTruth.*ActionIds` verbatim vào đúng một `eventId`;
- không tạo causal/action ID khác trong prose;
- `sourceActionId` phải là exact `trueTimeline.eventId`.

**Verify**: chạy focused backend tests. Các regression test mới phải fail trước
implementation vì code hiện tại dùng `MissingReference/coreTruth` và prompt chưa
có invariant.

### Step 2: Tạo một nguồn duy nhất để trích canonical reference sets

Tạo `CaseTruthReferenceContract.cs` dạng `internal static` với các pure helper,
dùng `StringComparer.Ordinal`, không mutate model:

- `CoreActionIds(CoreCaseTruth)` — hợp distinct theo thứ tự ổn định của bốn list;
- `TimelineEventIds(IEnumerable<TrueTimelineEvent>)`;
- `PlannedTraceIds(IEnumerable<TrueTimelineEvent>)`;
- helper kiểm tra null/blank/duplicate trong từng definition collection nếu cần.

Không coi cùng ID xuất hiện ở hai core categories là duplicate. Các consumer
`CaseTruthService`, `AiCaseService.CaseTruth` và schema builder phải dùng helper
này thay vì tự viết lại chuỗi `Concat/Distinct` riêng.

Thêm unit tests cho ordering, ordinal case sensitivity, cross-category overlap và
duplicate timeline definitions.

**Verify**: focused backend tests pass cho helper tests; regression behavior tests
từ Step 1 vẫn fail cho đến Step 3.

### Step 3: Cố định prompt và định vị lỗi vào artifact sở hữu definition

Trong `BuildTruthStagePrompt`:

- CORE_TRUTH: nói rõ các `*ActionIds` sẽ trở thành canonical
  `trueTimeline.eventId`; không tạo nhiều ID cho một prose event.
- TIMELINE: bắt buộc mỗi distinct core ID xuất hiện đúng một lần làm `eventId`;
  auxiliary event được phép nhưng dùng ID riêng; cấm nhét một causal ID thứ hai
  vào `action` prose.
- OPPORTUNITY/STATEMENTS: event reference phải copy verbatim từ timeline.
- EVIDENCE: `sourceActionId` phải copy exact timeline `eventId`; prose không phải ID source.
- PROOF_GRAPH: support/clearing IDs phải copy từ locked ledgers.

Trong `ValidateCoreTruth`:

- lỗi core field rỗng/duplicate trong cùng list vẫn có path `coreTruth...`;
- core action ID hợp lệ về hình thức nhưng thiếu definition trong timeline dùng
  code `MissingCoreTimelineEvent`, path `trueTimeline`, offending value là ID;
- một distinct core ID phải resolve đúng một timeline event;
- giữ `CulpritActionMismatch` và mọi kiểm tra causal hiện có.

Không tìm hoặc sửa ID bằng regex trong prose.

**Verify**: focused backend tests; prompt tests, live-failure regression và repair
planner test đều pass.

### Step 4: Khóa downstream references ngay trong strict JSON Schema

Mở rộng schema factory bằng overload nhận upstream sets; giữ overload không tham
số hiện tại cho test/backward caller nếu còn dùng, nhưng production stage calls
phải dùng overload có upstream data.

Áp enum case-sensitive và bounds như sau:

- `CoreTruthSchema`: `culpritId` enum theo locked suspects; bốn action arrays có
  item max length hiện tại, `crimeActionIds` min 1, và tổng distinct vẫn được
  deterministic validator kiểm tra với `MaxTimelineEvents`.
- `TrueTimelineSchema`: `actorId`/`witnessIds` theo suspects + target,
  `locationId` theo locked locations, mỗi event tối đa hai `traceIds`; không khóa
  `eventId` thành enum vì auxiliary events được phép.
- `OpportunityMatrixSchema`: `characterId` enum theo suspect IDs và
  `alibiEventIds.items` enum theo timeline event IDs.
- `TraceLedgerSchema`: `sourceActionId` enum theo timeline event IDs;
  `traceId` enum theo distinct planned trace IDs; `minItems == maxItems ==` số
  planned trace IDs sau khi preflight xác nhận số này nằm trong budget.
- `StatementLedgerSchema`: `speakerId` enum theo suspects + target,
  `eventIds.items` enum timeline IDs và `contradictedByTraceIds.items` enum trace IDs.
- `ProofGraphSchema`: supporting/clearing trace IDs và statement IDs dùng enum từ
  locked ledgers; `excludesSuspectIds`/red-herring `suspectId` dùng suspect enum;
  giữ đúng năm proof conclusion IDs hiện tại.

Tạo schema path helper có thông báo rõ khi path không tồn tại. Trước khi tạo enum,
preflight không cho production gọi OpenAI với set rỗng tại stage bắt buộc; trả
`CASE_TRUTH_INVALID` và giữ checkpoint thay vì tạo schema `enum: []`.

Trong `GenerateTruthStagesAsync`, truyền exact upstream sets ở mỗi production
schema call. Không tăng token budget và không thêm provider call.

Thêm tests inspect JSON Schema trực tiếp:

- `sourceActionId.enum` chỉ chứa timeline event IDs, không chứa ID trong prose;
- `traceId.enum` và ledger exact count bằng planned trace set;
- alibi/statement/support/clearing enums dùng đúng upstream sets;
- Short Demo vẫn giữ max 10 trace và mọi max string length hiện tại;
- empty mandatory upstream set bị preflight chặn, không tạo unusable schema.

**Verify**: focused backend tests pass.

### Step 5: Chặn namespace drift trước khi gọi các stage downstream

Thêm một checkpoint validation API hẹp vào `ICaseTruthService`, ví dụ
`ValidateTimelineReferences(CaseTruthPackage truth, AiTruthGenerationBudget budget)`.
Nó chỉ kiểm tra các invariant đã có đủ dữ liệu sau TIMELINE:

- core ID syntax/list validity;
- event ID uniqueness;
- mọi distinct core ID có đúng một timeline definition;
- crime action được culprit thực hiện;
- planned trace IDs không blank/duplicate và không vượt budget.

Ngay sau khi generate TIMELINE và trước OPPORTUNITY:

1. chạy checkpoint validation;
2. nếu invalid, retry đúng TIMELINE một lần với danh sách offending IDs và invariant
   canonical trong correction prompt;
3. validate lại;
4. nếu vẫn invalid, lưu partial truth/checkpoint và chuyển draft sang
   `CASE_TRUTH_INVALID`; không gọi OPPORTUNITY/EVIDENCE/STATEMENTS/PROOF_GRAPH.

Tái sử dụng chính sách một bounded semantic repair hiện có; không tạo vòng retry
mới ngoài giới hạn một lần. Nếu cách cài đặt hiện tại không thể trả partial result
an toàn, refactor kết quả nội bộ của `GenerateTruthStagesAsync` thành một value
object chứa truth + checkpoint validation thay vì dùng exception làm control flow.
Không thay public API response.

Thêm test với scripted stage response hoặc một seam nội bộ không cần Mongo/live
OpenAI:

- timeline lần đầu dùng `event_*` và nhét `action_*` vào prose;
- correction lần hai dùng exact core IDs;
- downstream schema/call chỉ được tạo sau lần hai hợp lệ;
- nếu lần hai vẫn sai, downstream call count bằng 0 và checkpoint dừng ở TIMELINE;
- upstream CASE_SEED/CORE_TRUTH call count không tăng khi repair timeline.

Nếu cần integration test, mở rộng `AiCaseWorkflowHostTests` bằng fake
`IAiOpenAiClient`; tuyệt đối không gọi network. Không làm test phụ thuộc thứ tự hoặc
thời gian thực.

**Verify**: focused backend tests và Mongo integration tests pass.

### Step 6: Chạy full regression và kiểm tra phạm vi

Chạy theo thứ tự:

```powershell
dotnet test SirLocked.sln --configuration Release --no-restore
./scripts/test-v3-mongo.ps1
Set-Location src/FE
npm run typecheck
npm run build
Set-Location ../..
git status --short
```

Expected:

- toàn bộ backend test pass;
- Mongo tests thực sự chạy, không skip;
- frontend typecheck/build pass;
- không có file ngoài Scope bị thay đổi bởi implementation;
- không có OpenAI/image call thật.

## Test plan

Tối thiểu phải có các case sau:

1. Real regression: core `action_*`, timeline `event_*`, action prose chứa
   `action_*` — fail bằng `MissingCoreTimelineEvent` và repair từ TIMELINE.
2. Happy path: mock convention `core action ID == timeline eventId` vẫn valid.
3. Cross-category overlap: cùng ID ở crime và culprit-mistake chỉ cần một event.
4. Missing/duplicate/blank core ID và duplicate timeline event ID cho error ổn định.
5. Auxiliary timeline event hợp lệ dù không nằm trong core action lists.
6. Trace source enum chỉ nhận timeline IDs; planned trace ID exact-set được khóa.
7. Alibi/statement/proof/red-herring upstream enums đúng.
8. First timeline mismatch rồi scoped retry thành công; upstream không chạy lại.
9. Second mismatch terminal tại TIMELINE; không sinh downstream artifact.
10. Existing budget, proof reciprocal, incomplete retry và full mock HTTP tests
    không regression.

Pattern test cần theo `CaseTruthServiceTests.ValidTruth()` và schema tree assertions
hiện có; không tạo một validator giả khác với production.

## Done criteria

- [ ] `trueTimeline[].eventId` được ghi rõ và test như canonical causal-action ID duy nhất của truth v1.
- [ ] Live-failure regression không thể pass strict pipeline với namespace `action_*` chỉ nằm trong prose.
- [ ] `traceLedger.sourceActionId` bị strict schema khóa vào actual timeline IDs.
- [ ] Opportunity, statement, proof và red-herring reference fields được khóa vào exact upstream IDs tương ứng.
- [ ] Missing core definition trả `MissingCoreTimelineEvent` tại `trueTimeline` và repair từ TIMELINE.
- [ ] Một mismatch timeline được retry đúng một lần; lần hai thất bại dừng trước mọi downstream call và giữ checkpoint.
- [ ] Không parse ID từ prose, không nới deterministic validator, không tăng token budget.
- [ ] Không đổi CaseTruthPackage/GameCase/schema version/public response.
- [ ] Focused tests, full solution tests, Mongo integration, frontend typecheck và build đều exit 0.
- [ ] `git status --short` chỉ có thay đổi implementation trong Scope cộng với dirty worktree có sẵn đã được ghi nhận.
- [ ] `plans/README.md` cập nhật trạng thái plan.

## STOP conditions

Dừng và báo lại nếu:

- In-scope excerpts đã đổi hành vi sau thời điểm lập plan hoặc một agent khác đang
  sửa cùng các file trong dirty worktree.
- OpenAI strict structured-output API từ chối `enum`, `minItems` hoặc `maxItems`
  đang được plan yêu cầu; ghi lại schema/provider error, không âm thầm bỏ constraint.
- Dữ liệu production hợp lệ đã được publish mà cố ý dùng `EventId != ActionId` theo
  một contract khác chưa được ghi nhận; khi đó cần migration/schema-v2 plan riêng.
- Auxiliary event không đủ để mô hình hóa alibi/witness nếu mỗi distinct core action
  phải có event riêng; không tự thêm `ActionIds` vào model.
- Stage-local terminal handling đòi thay public endpoint/status hoặc queue lease
  semantics; tách thành plan khác thay vì mở rộng Plan 012.
- Verification fail hai lần sau một fix hợp lý hoặc cần gọi live OpenAI để tiếp tục.

## Maintenance notes

- Mọi artifact mới có trường `*Id` tham chiếu upstream phải được thêm vào cả dynamic
  strict schema và deterministic validator; chỉ thêm prompt là chưa đủ.
- Reviewer cần đối chiếu ba tầng cho từng reference: prompt vocabulary, schema enum,
  validator/repair ownership.
- Nếu sau này muốn tách event và action thành hai entity thật sự, phải bump truth
  schema và viết migration/backfill; không tái sử dụng truth v1 với semantics mới.
- Mẫu JSON lỗi thực tế không cần commit nguyên nội dung vụ án; regression fixture
  tối giản phải giữ đúng cấu trúc namespace drift để tránh dữ liệu test dài và giòn.
