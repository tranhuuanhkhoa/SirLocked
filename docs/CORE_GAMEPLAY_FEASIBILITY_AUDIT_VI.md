# SIRLOCKED — CORE GAMEPLAY FEASIBILITY AUDIT

**Ngày audit:** 19/07/2026  
**Repository:** `prn232-su26-ai-audit-project-prn232_se18d07_group-01`  
**Commit nền:** `35e1b62 chore: checkpoint hardening and audit work`  
**Phạm vi:** core gameplay dùng chung, không đánh giá một case cụ thể và không đánh giá khả năng phát hành Steam.

---

# 1. Executive decision

## Quyết định

> **GO WITH CONSTRAINTS**

SirLocked có thể chuyển sang hướng **Crack the Lie — communication-first** mà không phải thay MongoDB, SignalR, controller API hoặc room lifecycle. Hạ tầng hiện có đã chứa khoảng **65–75% nền móng kỹ thuật** cần cho vertical slice: caller identity, role permission, `BuildStateAsync(..., userId)`, clue attribution, evidence challenge gắn với dialogue và correct evidence, optimistic concurrency, version-only realtime invalidation, reconnect/refetch và mechanics versioning.

Phần còn thiếu không nhỏ nhưng có ranh giới rõ:

1. Không có domain state cho hai proposal và hai confirmation.
2. `UnlockedClueIds`, clue content, testimony, resolved contradiction và action log hiện là shared state toàn đội.
3. Evidence challenge hiện là action đơn phương của Interrogator.
4. Accusation hiện là action đơn phương của bất kỳ thành viên nào.
5. Content contract biết “dialogue + correct evidence”, nhưng chưa biểu diễn testimony fragment, private knowledge lifecycle hoặc contribution của cả hai người.

Một vertical slice có thể hoàn thành trong **78–108 giờ**, tương đương 26–30 ngày ở mức trung bình khoảng ba giờ/ngày. Không nên dùng 30 ngày này để migrate toàn bộ case hoặc nâng AI generator lên production-ready V3.

Mọi nhận định rằng loop mới sẽ vui hơn, tạo tension, khiến người chơi nói chuyện hoặc tạo khoảnh khắc đáng nhớ đều là:

> `Requires human playtest validation`

## Verdict card

| Mục | Kết luận |
|---|---|
| Verdict | **GO WITH CONSTRAINTS** |
| Confidence kỹ thuật | **Cao** — source, test và local flow cho thấy các seam cần thiết đã tồn tại |
| Confidence gameplay | **Trung bình-thấp** — đây vẫn là design hypothesis chưa qua human playtest |
| Gameplay rationale | Current loop đã có clue → dialogue/challenge → deduction, nhưng communication chưa được hệ thống bắt buộc |
| Technical rationale | Có caller-aware state builder, role authorization, optimistic version và refetch-on-version; không cần thay stack |
| Reuse estimate | 65–75% infrastructure; 35–45% interaction/domain behavior |
| Vertical slice effort | 78–108 giờ, gồm automated test và sandbox |
| Production migration effort | Chưa nằm trong 30 ngày; ước tính thêm 40–80 giờ cho platform hardening, chưa gồm 4–12 giờ authoring/migration mỗi case |
| Biggest blocker | Không có knowledge-visibility model và paired-confrontation state |
| Cheapest falsification test | Hai caller nhận projection khác nhau và hoàn thành một paired contradiction qua API với dual confirm |
| Decision gate | Gate kỹ thuật 7 ngày: hai caller nhận projection khác nhau, zero sentinel leak và V1/V2 không regression |

## Implementation decisions locked before coding

Các quyết định dưới đây đã được khóa ngày 19/07/2026 và thay thế mọi phương án còn để mở ở các phần sau:

1. **Joint review, không blind lock.** Hai proposal được giữ riêng trong `CollectingProposals`; khi đủ evidence và testimony, pair chuyển sang `ReadyForReview`, được hiển thị cho cả hai và chỉ resolve sau confirmation thứ hai.
2. **Disclosure là không thể đảo ngược.** Mỗi revision từng vào `ReadyForReview` trở thành `ATTEMPT_DISCLOSED`. Edit tăng revision và xóa confirmations nhưng không thể làm partner “quên” pair cũ.
3. **Wrong attempt chỉ chia sẻ đúng pair đã review.** Evidence/testimony khác vẫn private. Failure feedback không được chứa correct ID, tên đáp án hoặc gợi ý trực tiếp.
4. **Confirmation gắn với revision.** Mỗi record chứa user, role, revision và timestamp; confirmation cũ không hợp lệ sau edit.
5. **Testimony dùng fragment ID.** `EvidenceChallenge` V3 tham chiếu `TestimonyFragmentId`; sandbox có thể dùng một fragment mỗi dialogue nhưng contract hỗ trợ nhiều fragment.
6. **Lifecycle MVP:** active attempt block scene/stage transition, accusation và unilateral evidence presentation; persist qua disconnect; abandon lưu snapshot `Cancelled`; stale proposal trả lỗi rõ và không tự thay thế.
7. **Gate 7 ngày trước UI.** Chưa thêm paired command API, UI, sandbox, case migration hoặc AI generator cho tới khi server projection đạt zero leak và V1/V2 pass.
8. **Human validation dùng ba gate.** Ba cặp đầu chỉ đủ để Kill/Iterate; chạy thêm 3–5 cặp mới sau iteration; chỉ cân nhắc scale khi tổng cộng 8–12 cặp đạt communication/comprehension target.

---

# 2. Quy tắc bằng chứng và kiểm tra đã thực hiện

## 2.1 Nhãn bằng chứng

- **[Đã kiểm chứng từ code]**: đã đọc implementation/type/test cụ thể.
- **[Đã kiểm chứng khi chạy local]**: đã chạy command hoặc dựa trên isolated instrumented flow đã lưu trong repository.
- **[Suy luận thiết kế]**: kết luận cấu trúc cần playtest nếu liên quan hành vi/cảm xúc.
- **[Chưa thể biết]**: không đủ dữ liệu hiện tại.

## 2.2 Kiểm tra trong lượt audit này

| Kiểm tra | Kết quả |
|---|---|
| `dotnet test SirLocked.sln --configuration Release --no-restore` | **237/237 pass**, 0 fail, 0 skip |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; Vite cảnh báo `gamePage` chunk 1.757 MB minified / 404,50 KB gzip |
| Git secret scan cho checkpoint | Không thấy Atlas URL, production key hoặc private key |
| Remote database | Không được sử dụng |
| Source/case/asset mutation trong audit | Không có |

## 2.3 Bằng chứng local đã có từ audit biệt lập trước đó

Theo `docs/PRE_PLAYTEST_GAME_DIRECTOR_AUDIT_2026-07-18_VI.md`:

- Hai case đi được từ room đến trạng thái thắng bằng hai test account trong MongoDB local biệt lập.
- Wrong-role action bị API chặn.
- Browser xác nhận lobby SignalR tự cập nhật và hai role vào gameplay.
- Cả hai role nhận full unlocked clue/testimony/contradiction qua `GameStateResponse`.
- Không quan sát full-case soft-lock trên canonical path.
- Local audit database đã bị drop; Atlas không bị truy cập.

Audit hiện tại không chạy lại MongoDB vì câu hỏi feasibility đã có đủ bằng chứng từ source, test và flow local đã lưu. Vì vậy mọi điểm mới về V3 là **thiết kế**, chưa phải runtime V3 đã kiểm chứng.

---

# 3. Current gameplay architecture map

| Layer | File/module | Trách nhiệm hiện tại | Liên quan tới Crack the Lie | Mức cần thay đổi |
|---|---|---|---|---|
| Case document | `src/BE/Models/GameCase.cs:13-47` | Canonical contract cho case, AI, validator và renderer | Có mechanics version, challenge, deduction, teamwork chain | Trung bình, additive V3 |
| Runtime state | `src/BE/Models/GameRoom.cs:43-82` | Embedded authoritative gameplay state | Có global progress/version nhưng chưa có private knowledge/draft | Cao nhưng khu trú |
| Discovery attribution | `GameRoom.cs:122-129` | Ghi ai/role nào tìm clue và bằng action gì | Có thể tái sử dụng làm owner của private clue | Thấp |
| Game state DTO | `DTOs/Investigation/GameStateDtos.cs:473-520` | Trả toàn bộ state player-facing | Hiện trộn private/shared trong một response | Cao |
| Projection | `Services/GameStateBuilder.cs:21-229` | Build state theo `userId` và current scene từng người | Đây là seam tốt nhất để tạo caller-specific knowledge | Trung bình |
| Core commands | `Services/GameplayService.cs` | Role check, mutation, save, notification | Cần thêm paired commands; không rewrite toàn service | Trung bình |
| Pure V2 rules | `Services/GameplayV2Rules.cs:35-149` | Resolve evidence/deduction deterministic | Có thể tái dùng final resolution và scoring | Trung bình |
| Progression | `Services/GameRules.cs:166-190` | Accusation availability và teamwork completion | Chain hiện kiểm global completion, chưa kiểm joint confirmation | Thấp-trung bình |
| Persistence | `GameplayService.cs:1393-1419` | Optimistic replace room document theo version | Đủ cho prototype hai người; cần race/idempotency test | Thấp |
| API | `WebAPI/Controllers/GameController.cs:10-89` | Controller endpoints mỏng | Thêm 3–4 command endpoint, không đổi API model | Thấp |
| SignalR | `Services/GameNotifier.cs:33-49`, `GameHub.cs:20-45` | Group event và version invalidation | Version-only event phù hợp private refetch; ID event cần sanitize/target | Thấp-trung bình |
| Reconnect | `signalrClient.js:26-52` | Rejoin group và refetch sau reconnect | Có sẵn chiến lược phục hồi server state | Thấp |
| Gameplay UI | `gamePage.ts` | Phaser, HUD, overlays, case file, dialogue, accusation | Có mọi surface nhưng file 3.808 dòng; nên thêm module mới | Trung bình-cao |
| Case file | `gamePage.ts:2499-2553` | Render clue/testimony/contradiction shared | Phải tách private notebook và resolved shared archive | Trung bình |
| Challenge UI | `gamePage.ts:2809-2823` | Interrogator chọn evidence và resolve ngay | Thay bằng hai proposal và hai confirm | Cao nhưng khu trú |
| Accusation UI | `gamePage.ts:2941-3027` | Một client tự tạo toàn bộ draft và submit | Không nằm trong Crack MVP đầu tiên; dual accusation làm sau |
| Validator | `CaseValidationService.cs:1200-1304` | Kiểm references, V2 counts, options, reachability | Có nền tảng; cần V3 semantic/no-cycle/no-leak rules | Trung bình |
| AI contract | `AiGenerationContract.cs:43-80`, `AiCaseService.cs:1427-1441` | Ép số lượng challenge/deduction/chain | Hiện count-first, chưa chứng minh semantic contradiction | Cao, hoãn sau prototype |
| Tests | `src/BE/Tests`, `src/FE/tests` | Rule, projection helper, persistence và UI smoke | Nền test tốt nhưng chưa có two-caller privacy/dual confirm | Trung bình |

## Kết luận kiến trúc

**[Đã kiểm chứng từ code]** Project không cần một gameplay architecture mới. Nó cần một feature slice V3 gồm:

```text
PairedConfrontationRules
→ persisted PairedConfrontationState
→ caller-specific KnowledgeProjection
→ thin controller commands
→ version-only room invalidation
→ role-specific UI controller
```

Không nên đặt toàn bộ logic mới trực tiếp vào `GameplayService.cs` hoặc `gamePage.ts`; hai file đã lần lượt có 1.669 và 3.808 dòng.

---

# 4. Core gameplay hiện tại

## 4.1 Runtime command flow

```text
Client action
→ authorized controller
→ GameplayService LoadContext + role/current-scene gate
→ mutate embedded GameplayState
→ optimistic ReplaceOne by gameplayState.version
→ log + SignalR room event
→ action caller nhận full state
→ partner nhận version event và GET state theo userId
```

## 4.2 Reconstruction theo mechanic

| Mechanic | Initiating role | Knowledge trước action | Mutation | Role kia hiện nhận gì | Payoff hiện tại | Communication structurally required? |
|---|---|---|---|---|---|---|
| Camera clue | Investigator | Scene + hidden zone qua runtime/client | Global captured/unlocked clue | Full clue content/photo sau refetch | Detail/toast/unlock | **Không** |
| Item/interaction | Investigator | Item metadata và requirement | Global item/clue/scene state | Full result qua state/log | Unlock/message | **Không** |
| Dialogue | Interrogator | Question và required clue IDs | Global asked dialogue + clue | Full Q/A testimony | Answer/toast | **Không** |
| Conversation | Interrogator | Node/choices | Global transcript/visited node | Full transcript | New node/clue | **Không** |
| Evidence challenge | Interrogator | Full testimony + toàn evidence clue | Correct/wrong resolve trong một request | Full contradiction result | Success/failure text + clue unlock | **Không**; chỉ role permission |
| Deduction | Either role | Cả hai thấy cùng prompt/options | Một người chọn option, global resolve | Full deduction result | Text + clue unlock | **Không** |
| Accusation | Either room member | Cả hai có full clue/options | Một request kết thúc room | Result broadcast | Win/fail result | **Không** |

## 4.3 Bằng chứng co-op hiện tại chủ yếu là permission/gate

- `CaptureClueAsync` bắt buộc Investigator (`GameplayService.cs:469-476`).
- `AskDialogueAsync` bắt buộc Interrogator (`GameplayService.cs:620-637`).
- `PresentEvidenceAsync` bắt buộc Interrogator nhưng nhận cả `challengeId` và `evidenceId` trong một request (`GameplayService.cs:774-818`).
- `SolveDeductionAsync` không yêu cầu role cụ thể (`GameplayService.cs:1001-1023`).
- `AccuseAsync` không yêu cầu host hoặc teammate confirm (`GameplayService.cs:1267-1320`).
- Teamwork scoring chỉ kiểm Investigator từng discover evidence và Interrogator từng resolve challenge; không có communication/confirmation state (`GameplayV2Rules.cs:234-256`).

> **Kết luận:** current design đã có cross-role sequence nhưng chưa có joint decision.

---

# 5. Information distribution hiện tại

## 5.1 Các leak route phải xử lý trong V3

| Route | Bằng chứng | Vấn đề cho role-private gameplay | V3 action |
|---|---|---|---|
| Global clue lists | `GameStateResponse.UnlockedClueIds/UnlockedClues`, lines 493 và 511 | Partner biết ID, title, content, meaning, tags | Project theo caller |
| Testimony | `GameStateBuilder.cs:198-205` | Mọi asked Q/A trả cho cả hai | Thêm asker attribution và filter |
| Scene dialogues | `GameStateBuilder.cs:39-57`, DTO answer lines 188-214 | Investigator nhận questions/asked answers | V3 chỉ Interrogator nhận private dialogue |
| Evidence photo | `GameplayService.cs:444-454` | Bất kỳ room member nào xem ảnh nếu clue global-visible | Authorize theo knowledge visibility |
| Action log | `GameStateBuilder.cs:108-109, 222-228` | Message có thể chứa clue title/question | Audience-aware log hoặc sanitize |
| Clue event | `GameNotifier.cs:39-46` | Room-wide event chứa clue/dialogue/evidence ID | V3 dùng generic event hoặc user target |
| Partner toast | `gamePage.ts:2061-2068` | Sau refetch có thể hiện clue title | Chỉ hiện “partner found evidence/testimony” |
| Case file | `gamePage.ts:2499-2553` | Full evidence, Q/A, contradiction dùng chung | Private notebook + resolved archive |
| Deduction data | `GameStateBuilder.cs:170-197` | Cả hai thấy clue/challenge requirements và options | Không dùng trong sandbox, xử lý sau nếu V3 deduction |

## 5.2 Điểm thuận lợi

`GameStateBuilder.BuildStateAsync` đã nhận `userId` và dùng `PlayerSceneIds` để build visible scene khác nhau (`GameStateBuilder.cs:21-26, 232-239`). Vì vậy caller-specific projection là mở rộng tự nhiên, không phải thay API authentication hoặc tạo hai backend.

SignalR `GameStateUpdated` chỉ gửi `roomId + version` (`GameNotifier.cs:33-34`), và frontend refetch state (`gamePage.ts:2054-2057`). Điều này cho phép giữ room-wide invalidation nhưng trả projection khác nhau cho mỗi caller.

---

# 6. Current vs target gap map

| Target step | Hệ thống hiện có gần nhất | Reuse | Cần sửa | Cần mới | Bằng chứng |
|---|---|---|---|---|---|
| 1. Private physical discovery | `ClueDiscoveryRecord` có user/role/source | Attribution | Projection/photo authorization | Visibility rule | `GameRoom.cs:122-129` |
| 2. Private testimony | `AskedDialogueIds` global | Dialogue content/gates | Ghi asker và filter | `TestimonyDiscoveryRecord` | `GameRoom.cs:58`, `GameStateBuilder.cs:198-205` |
| 3. Non-spoiler notification | `InvestigationUpdate` generic message | Version/refetch | Không gửi target secret cho room | V3 generic event | `GameNotifier.cs:33-49` |
| 4. Verbal relay | Không có built-in voice | Không | Playtest cùng phòng/Discord | Không build voice trong MVP | — |
| 5. Investigator proposal | Evidence ID đã tồn tại | Clue/evidence selector | Không để INT chọn evidence | Proposal command/state | Challenge UI lines 2817-2821 |
| 6. Interrogator proposal | Challenge đã gắn dialogue | `ChallengeId + DialogueId` | Expose testimony fragment riêng | Testimony excerpt field | `GameCase.cs:462-470` |
| 7. Pending state | Không có | — | — | Active attempt record | `GameplayState` không có draft |
| 8. Dual confirmation | Không có | Room players/user IDs | — | Confirm set + transition rule | — |
| 9. Edit/cancel | Client accusation draft only | UI pattern | Persist/authorize | Revision/reset-confirm rule | `gamePage.ts:2941-3027` |
| 10. Server resolution | `ApplyEvidence` deterministic | Correct/wrong logic | Trigger chỉ sau two confirm | Paired orchestration | `GameplayV2Rules.cs:74-114` |
| 11. Wrong feedback | `FailureResponse` | Text content/penalty | Present joint result | Optional mismatch category later | `GameCase.cs:468-470` |
| 12. NPC reaction | Success/failure text + portrait | Existing character overlay | Low-cost presentation | Reaction UI state | `gamePage.ts:2809-2823` |
| 13. Hypothesis update | Unlock clue + deduction resolution | Unlock pipeline | Present as reversal | Không cần graph trong MVP | `GameplayV2Rules.cs:110-113` |
| 14. Downstream unlock | `UnlockClueIds` | Full reuse | — | — | `EvidenceChallenge.UnlockClueIds` |
| 15. Shared archive after resolve | Resolved confrontation DTO | Result record | Filter pre-resolve, share post-resolve | Contributor fields | `GameStateBuilder.cs:155-169` |
| 16. Reconnect/replay | Persisted room + rejoin/refetch | Full strategy | Project pending attempt | Attempt state persisted | `signalrClient.js:36-43` |

---

# 7. Feasibility matrix

Thang điểm: 0 phải viết lại; 5 gần như có sẵn.

| Subsystem | Score | Bằng chứng | Reuse | Change | Risk | Effort |
|---|---:|---|---|---|---|---:|
| Domain model/state machine | 2 | Không có pending/confirm state | Embedded room/version | Add attempt/visibility records | Transition bug | 10–14h |
| Caller-specific projection | 4 | Builder đã nhận `userId` | Current scene/user lookup | Filter every leak route | Missed field leak | 8–12h |
| Gameplay persistence | 4 | Optimistic versioned replace | Existing save/retry | Persist attempt/revision | Whole-doc race | 4–6h |
| API command flow | 4 | Thin controllers/service pattern | Auth/context/exception | Add role commands | Scope creep | 5–8h |
| SignalR privacy/routing | 4 | Full state không broadcast | Version invalidation | Suppress/target ID events | Secret IDs | 3–5h |
| Reconnect/idempotency | 3 | Rejoin + refetch có sẵn | Persisted state | Idempotent confirm/edit tests | Double resolution | 5–8h |
| Investigator UI | 3 | Evidence card selector tồn tại | Case file/cards | Private evidence + proposal | Monolithic page | 6–9h |
| Interrogator UI | 3 | Dialogue/challenge panel tồn tại | Dialogue overlay | Select testimony fragment/start | Monolithic page | 6–9h |
| Joint confirmation UI | 1 | Không có multiplayer draft UI | Accusation modal patterns | New waiting/edit/confirm states | Confusion/waiting | 8–12h |
| NPC reaction/presentation | 3 | Portrait, overlay, toast có sẵn | Existing visual shell | Crack composition/sting | Payoff weak | 5–8h |
| Case schema | 4 | Dialogue/challenge/evidence relation đã có | Most fields | Add excerpt/V3 semantics | Author ambiguity | 3–5h |
| Validator | 4 | Strong ID/reachability validation | Validation pipeline/tests | Add V3 semantic rules | False pass | 5–8h |
| AI generation pipeline | 2 | Prompt count-first | JSON/preset pipeline | Semantic prompt/repair/eval | Bad contradictions | 12–24h, post-MVP |
| Existing case compatibility | 5 nếu versioned | Mechanics V1/V2 đã có | Keep unchanged | Add V3 branch | Accidental behavior change | 2–4h |
| Automated tests | 3 | 237 backend tests + UI smoke | Test conventions | Two-caller/privacy/race cases | Mock hides integration bug | 12–18h |
| Human playtest readiness | 3 | Existing two-role flow | Room/auth/game shell | Sandbox/protocol | No participants | 8–12h |

## Blockers thực tế

1. **Knowledge visibility phải là server concern.** Nếu chỉ filter UI, direction là NO-GO vì technical debt và information asymmetry giả.
2. **V3 phải versioned.** Thay semantics của V2 global fields sẽ làm hỏng case và test hiện tại.
3. **MVP chỉ hỗ trợ một active paired attempt/room.** Nhiều attempt đồng thời làm phình state/concurrency/UI trước khi gameplay được chứng minh.
4. **Không đưa AI generation V3 vào critical path.** Một fixture hand-authored + validator đủ để test system.

---

# 8. Attempt to falsify

| Phản biện mạnh | Bằng chứng ủng hộ | Mức | Có thể giảm? | Test rẻ nhất |
|---|---|---|---|---|
| Ép giao tiếp biến thành friction | Game chưa có voice/chat tích hợp | Cao | Playtest cùng phòng/Discord; generic partner cue | Hai cặp mới, không hướng dẫn nội dung |
| Private info gây mất phương hướng | Objective hiện team-wide, role chưa có next action riêng | Cao | Role objective + partner-ready status | Đo câu hỏi “tôi phải làm gì?” |
| Dual confirm tăng waiting | Current flow đã có entry state một role 0 action | Cao | Cho edit/review và private notebook khi chờ | Đo idle >45 giây như alarm hypothesis |
| Authoring paired content quá đắt | AI contract hiện chỉ kiểm count/reference | Cao | Một challenge = dialogue excerpt + correct evidence + responses | Timebox author sandbox 4 giờ |
| AI tạo contradiction không công bằng | Prompt chỉ yêu cầu contradiction chain chung | Cao | Hoãn AI V3; human-authored fixture | Blind comprehension test |
| Existing case bị break | V1/V2 branch có khắp code | Thấp nếu V3 | Thêm V3, không mutate V2 | Regression toàn bộ 237 tests |
| Loop trở nên công thức lặp | Challenge schema luôn 1 correct evidence | Trung bình | Chỉ test một loop; chưa scale content | Không thể biết trước playtest |
| Payoff vẫn chỉ là toast | Current `presentEvidence` dùng toast/detail | Cao | Dedicated 3–5s Crack presentation | Hỏi recall/hypothesis before-after |
| Investigator vẫn nhiều agency hơn | Camera/item/puzzle có nhiều action hơn | Trung bình-cao | Đo active contribution, không chỉ action count | 30-second observation sheet |
| Một người vẫn đoán bằng menu | Correct evidence nằm trong list | Cao | Không show partner's exact fragment; require confirm | Test cặp không nói chuyện có hoàn thành được không |
| Devtools vẫn lộ content | Runtime response hiện nhiều global fields | Cao | Server projection + API no-leak tests | Wrong-role snapshot deep diff |
| 30 ngày bị nuốt bởi refactor | GameplayService/gamePage rất lớn | Cao | Feature slice files, không rewrite | Weekly scope gate |

**Kết luận falsification:** Không có phản biện nào khiến direction bất khả thi về kỹ thuật. Ba phản biện có thể khiến direction thất bại về sản phẩm — forced communication friction, waiting và weak payoff — chỉ có thể được giải bằng human playtest. `Requires human playtest validation`.

---

# 9. Chọn duy nhất phạm vi MVP

## So sánh phương án

| Option | Gameplay value hypothesis | Reuse | Effort | Migration | Debt risk | Playtest value |
|---|---|---:|---:|---:|---|---|
| Minimal adaptation | V3 projection + paired proposal/confirm trên `EvidenceChallenge` | Cao | **78–108h** | Không migrate V2 | Thấp | Rất cao |
| Moderate redesign | Generic paired knowledge subsystem + hypothesis board | Trung bình | 130–190h | Schema mới lớn | Trung bình | Cao nhưng chậm |
| Full system | Branching reactions, theory graph, multi-attempt, AI V3 | Thấp | 240h+ | Cao | Cao | Thấp trước khi core được chứng minh |

## Phương án được chọn

> **Minimal adaptation: Paired Evidence Challenge V3**

### MVP bao gồm

- `mechanicsVersion = 3`; V1/V2 giữ nguyên behavior.
- Investigator clue và Interrogator testimony private theo server projection.
- Một active confrontation attempt trong room.
- Interrogator chọn `challengeId`/testimony excerpt.
- Investigator chọn `evidenceId`.
- Mỗi người chỉ thấy nội dung private của mình và trạng thái ready của partner.
- Cả hai confirm; edit làm clear confirmation.
- Second confirmation trigger server-authoritative resolution.
- Correct/wrong dùng logic và response của `EvidenceChallenge` hiện có.
- Resolved pair đi vào shared case file.
- Low-cost Crack presentation và generic partner notification.
- Reconnect phục hồi attempt.
- Một hand-authored sandbox 8–12 phút.

### MVP không bao gồm

- Voice/text chat tích hợp.
- Migrate mọi case.
- AI tự sinh V3 production-ready.
- Theory graph tổng quát.
- Nhiều confrontation active cùng lúc.
- Timer, NPC relationship meter hoặc branching narrative lớn.
- Dual final accusation; đây là phase kế tiếp nếu paired loop được giữ.
- Rewrite `GameplayService` hoặc `gamePage` toàn bộ.
- Cinematic, animation asset mới lớn hoặc audio system đầy đủ.

### Definition of Done

1. Hai caller cùng room nhận projection khác nhau và không lấy được private content của role kia qua normal API/SignalR/photo endpoint.
2. Interrogator và Investigator gửi hai proposal khác loại.
3. Không resolve trước khi cả hai confirm.
4. Retry/duplicate confirm không resolve hai lần.
5. Edit proposal clear confirmation và tăng revision.
6. Reconnect phục hồi đúng draft/confirmation.
7. Result đúng/sai được cả hai thấy, sau đó pair trở thành shared archive.
8. Fixture V3 pass validator mà không sửa gameplay code theo ID cụ thể.
9. Backend tests, typecheck, build và automated two-session flow pass.
10. Sandbox sẵn sàng cho human playtest; fun chưa được coi là pass criterion kỹ thuật.

---

# 10. Technical design — selected MVP

## 10.1 Versioning

Thêm:

```csharp
public const int InvestigationV3PairedConfrontation = 3;
```

Quy tắc:

- V1/V2 đi nguyên code path cũ.
- V3 dùng caller projection và paired challenge.
- Không thêm boolean capability rải rác nếu toàn bộ V3 cùng một contract.
- Không đổi ý nghĩa persistence của `UnlockedClueIds`; nó vẫn là canonical progression state. Chỉ DTO projection quyết định caller được biết gì.

## 10.2 Persisted state tối thiểu

Tên cuối cùng phải theo convention khi implement; shape đề xuất:

```csharp
public sealed class TestimonyDiscoveryRecord
{
    public string TestimonyFragmentId { get; set; }
    public string DialogueId { get; set; }
    public string DiscoveredByUserId { get; set; }
    public string DiscoveredByRole { get; set; }
    public DateTime DiscoveredAt { get; set; }
}

public sealed class PairedConfrontationState
{
    public string AttemptId { get; set; }
    public PairedConfrontationStatus Status { get; set; }
    public int Revision { get; set; }
    public string? TestimonyFragmentId { get; set; }
    public string? TestimonyProposedByUserId { get; set; }
    public string? EvidenceId { get; set; }
    public string? EvidenceProposedByUserId { get; set; }
    public List<PlayerConfrontationConfirmation> Confirmations { get; set; }
    public List<PairedConfrontationDisclosureRecord> Disclosures { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

`GameplayState` thêm:

```csharp
List<TestimonyDiscoveryRecord> TestimonyDiscoveries
PairedConfrontationState? ActiveConfrontation
List<PairedConfrontationAttemptRecord> PairedConfrontationAttempts
```

Không cần duplicate private clue list: `ClueDiscoveries` đã có owner. Sau resolution, `ResolvedConfrontationRecords` là nguồn để xác định pair đã shared.

## 10.3 State machine

```text
NONE
  → CollectingProposals             Interrogator chọn testimony fragment
  → ReadyForReview                  Investigator chọn evidence; pair được disclosure cho cả hai
  → AwaitingSecondConfirmation      một trong hai confirm revision hiện tại
  → ResolvedCorrect                 người thứ hai confirm, pair đúng
  → ResolvedIncorrect               người thứ hai confirm, pair sai

CollectingProposals/ReadyForReview/AwaitingSecondConfirmation
  → Cancelled                       một trong hai người cancel

ReadyForReview/AwaitingSecondConfirmation
  → ReadyForReview                  một role edit phần của mình; revision++; clear confirmations;
                                     disclosure revision cũ vẫn được giữ
```

## 10.4 Server invariants

1. Chỉ room member trong game in-progress được mutate.
2. V3 chỉ có một active attempt.
3. Chỉ Interrogator đã discover testimony fragment mới được set `TestimonyFragmentId`.
4. Chỉ Investigator đã discover evidence mới được set `EvidenceId`.
5. Proposal không được chứa ID không visible với caller.
6. Confirm chỉ hợp lệ khi đủ hai proposal và `expectedRevision` đúng.
7. Edit sau khi một người confirm làm clear mọi confirmation nhưng không xóa disclosure cũ.
8. User ID chỉ được xuất hiện một lần trong confirmation set.
9. Second confirmation và resolution nằm trong cùng optimistic write.
10. Duplicate retry sau resolution trả result hiện có, không cộng penalty/unlock lần hai.
11. Scene/stage transition bị block khi active attempt chưa cancel/resolve; disconnect không mutate attempt.
12. Room completion không được xảy ra khi active attempt unresolved.

## 10.5 Content changes additive

Thêm top-level testimony fragment và mở rộng `EvidenceChallenge`:

```csharp
public sealed class TestimonyFragment
{
    public string Id { get; set; } = string.Empty;
    public string DialogueId { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

public string TestimonyFragmentId { get; set; } = string.Empty;
public string RevealTitle { get; set; } = string.Empty;
```

Các field hiện có tiếp tục dùng:

- `DialogueId`: source testimony.
- `CorrectEvidenceId`: correct pair.
- `SuccessResponse`: NPC concession/reversal.
- `FailureResponse`: meaningful rejection.
- `UnlockClueIds`: downstream reveal.

Không thêm generic ACL vào toàn bộ content trong MVP. Visibility được suy ra từ role action + discovery attribution cho V3. Nếu playtest chứng minh cần intentional sharing khác nhau theo clue, mới thêm `KnowledgeVisibilityPolicy` ở phase sau.

## 10.6 Caller-specific projection

Projection phải được thực hiện trong backend trước khi tạo `GameStateResponse`.

### Knowledge matrix

| Data | Investigator khi collecting | Interrogator khi collecting | Ready for review / terminal |
|---|---|---|---|
| Physical clue do Investigator tìm | Full title/content/photo | Generic “partner found evidence”, không ID semantic | Full cho cả hai nếu nằm trong resolved pair |
| Testimony do Interrogator lấy | Generic “partner obtained testimony” | Full question/answer/excerpt | Full cho cả hai nếu nằm trong resolved pair |
| Testimony proposal | Partner ready + neutral cue | Full fragment của mình | Full pair cho cả hai |
| Evidence proposal | Full chosen evidence của mình | Partner ready, không full evidence | Full pair cho cả hai |
| Confirmation | Readiness của cả hai | Readiness của cả hai | Archived |
| Wrong result | Pair + failure response shared | Pair + failure response shared | Chỉ pair đã review vào attempt history; không unlock |
| Correct result | Pair + success response + reveal shared | Như Investigator | Shared case file |
| Unrelated private discovery | Full nếu owner | Generic count only | Vẫn private trong MVP |

### Projection rules

V3 `GameStateBuilder` cần lấy caller player/role ngay đầu method, sau đó build ba nhóm:

```text
PrivateEvidence
PrivateTestimonies
SharedInvestigation
```

Không nên tiếp tục dùng `UnlockedClues` với hai ý nghĩa “progression đã unlock” và “caller được đọc”. Với V3:

- `GameplayState.UnlockedClueIds`: internal canonical progression.
- `GameStateResponse.PrivateEvidence`: caller-only.
- `GameStateResponse.SharedClues`: resolved/team-visible.
- Legacy `UnlockedClues`: chỉ populated theo behavior cũ cho mechanics <= 2; V3 frontend không đọc field này.

Phải kiểm tra đồng thời:

- `VisibleScene.AvailableDialogues`;
- `CollectedItems` và inspect text;
- `Deductions`/missing IDs;
- `Testimonies`;
- `ActionLog`;
- evidence photo URL;
- transient action response;
- SignalR event payload.

### Evidence photo authorization

Thay `IsPhotoVisible(room, clueId)` bằng policy caller-aware:

```text
CanViewEvidencePhoto(room, userId, clueId)
  = caller discovered clue
  OR clue is part of resolved shared confrontation
  OR mechanicsVersion <= 2 and current legacy visibility allows it
```

## 10.7 DTO/API contract

### Response DTOs mới

```text
PrivateEvidenceDto
PrivateTestimonyDto
PairedConfrontationViewDto
PartnerProposalStatusDto
SharedKnowledgeDto
```

`PairedConfrontationViewDto` không được serialize partner secret trong `CollectingProposals`; khi vào `ReadyForReview`, pair đã được cả hai chủ động disclosure và phải hiển thị cho cả hai:

| Field | Investigator | Interrogator |
|---|---|---|
| AttemptId | ✓ | ✓ |
| Revision | ✓ | ✓ |
| Status | ✓ | ✓ |
| Own proposal ID/content | Evidence | Challenge/excerpt |
| Partner proposal ID/content | Không khi collecting; có khi review | Không khi collecting; có khi review |
| PartnerHasProposed | ✓ | ✓ |
| ConfirmedByMe | ✓ | ✓ |
| PartnerConfirmed | ✓ | ✓ |
| Character cue | Có thể shared | ✓ |

### Commands

| Command | Caller | Preconditions | Mutation | Response | Realtime |
|---|---|---|---|---|---|
| `POST paired-confrontations` | Interrogator | V3, discovered fragment, no active attempt | Create draft with testimony fragment | Caller projection | Version invalidation only |
| `PUT .../{attemptId}/testimony` | Interrogator | Active attempt, own discovered fragment, expected revision | Edit testimony, revision++, clear confirm | Caller projection | Version invalidation only |
| `PUT .../{attemptId}/evidence` | Investigator | Active attempt, visible evidence | Set/change evidence, revision++, clear confirm | Caller projection | Generic version + partner-ready |
| `POST .../{attemptId}/confirm` | Either | Both proposals, expected revision | Add confirmation; second resolves atomically | Caller projection/result | Version + resolved event without pre-resolve secrets |
| `DELETE .../{attemptId}` | Initiator or both by rule | Unresolved | Cancel/clear | Caller projection | Version |

Không mở endpoint “get partner proposal”. State endpoint là source of truth.

### Idempotency

- Create: nếu cùng Interrogator/challenge và active draft tồn tại, trả existing draft.
- Evidence upsert: gửi lại cùng evidence/revision không tạo mutation mới.
- Confirm: confirmation được định danh bằng user + revision; duplicate confirm cùng revision trả unchanged.
- Nếu retry đến sau resolution, trả resolved record thay vì tạo attempt mới.
- Không cần command ledger vô hạn trong MVP.

## 10.8 SignalR

Giữ:

```text
GameStateUpdated { roomId, version }
```

V3 không broadcast trước resolve:

- clue ID;
- dialogue ID;
- evidence ID;
- challenge ID;
- private title/content;
- photo URL.

Có thể thêm generic room event:

```json
{
  "type": "PARTNER_PROPOSAL_UPDATED",
  "actorUserId": "...",
  "actorRole": "INTERROGATOR",
  "version": 12
}
```

Không cần user-target SignalR cho state content vì HTTP action caller đã nhận projection của mình và partner sẽ refetch theo user. Nếu sau này cần private push, dùng `Clients.User(userId)`, không gửi full content vào room group.

## 10.9 Frontend feature slice

Không tiếp tục nhồi toàn bộ rule vào `gamePage.ts`. Tạo tối thiểu:

```text
src/FE/Client/js/game/pairedConfrontation.ts
src/FE/Client/js/game/knowledgeProjection.ts   // types/view helpers nếu cần
```

`gamePage.ts` chỉ:

- nhận state;
- gọi view-model helper;
- mount overlay;
- dispatch command;
- apply returned state.

### Investigator flow

```text
Explore/camera
→ private evidence card
→ partner opens confrontation
→ review own evidence
→ choose evidence
→ see both-ready status
→ confirm/edit
→ wait with private notebook available
→ Crack result
```

### Interrogator flow

```text
Question NPC
→ private testimony
→ select suspicious excerpt/challenge
→ partner notified
→ see evidence-ready status, not evidence content
→ confirm/edit
→ Crack result
```

### Waiting state requirements

Mỗi waiting state phải cho người chơi:

- biết mình đang chờ ai;
- biết partner đã/ chưa submitted;
- xem lại private information;
- edit/cancel nếu chưa resolve;
- không thấy secret của partner;
- không bị khóa toàn bộ exploration nếu design sandbox cho phép.

## 10.10 Low-cost Crack presentation

MVP presentation kéo dài khoảng 3–5 giây, không phải cinematic:

1. Dim gameplay layer.
2. Đặt testimony excerpt bên trái, evidence card bên phải.
3. Highlight phrase/detail mâu thuẫn.
4. Animate một đường “crack” hoặc stamp giữa hai card.
5. Chuyển NPC portrait sang shake/tint/pose CSS nếu chưa có reaction asset.
6. Hiện `SuccessResponse` hoặc `FailureResponse`.
7. Nếu đúng, hiện reveal clue/hypothesis card và objective mới.
8. Cả hai client nhận cùng presentation sau resolution.

Audio sting nhỏ là optional nếu asset có sẵn. Không xây audio framework mới trong MVP.

---

# 11. Content authoring và migration

## 11.1 V3 authoring contract tối thiểu

Một paired chain phải có:

| Field/relationship | Mục đích | Validator rule |
|---|---|---|
| Investigator evidence clue | Một nửa vật lý | Phải reachable trước challenge resolution và được Investigator action discover |
| Interrogator dialogue | Nguồn lời khai | Phải reachable độc lập, không cần clue được chính challenge unlock |
| `TestimonyFragmentId` | Claim cụ thể để pair | Tham chiếu fragment tồn tại, non-empty, thuộc đúng dialogue |
| `CorrectEvidenceId` | Correct pair | Existing evidence, `isEvidence=true`, không circular |
| `FailureResponse` | Wrong pair feedback | Non-empty, không tiết lộ correct evidence |
| `SuccessResponse` | NPC concession | Non-empty và giải thích contradiction |
| `RevealTitle` | Presentation headline | Non-empty cho V3 |
| `UnlockClueIds` | Hypothesis/reveal downstream | Ít nhất một, reachable contract hợp lệ |
| Required teamwork chain | Final gate/attribution | Tham chiếu đúng clue/challenge; deduction optional trong sandbox V3 |

## 11.2 Validator V3 cần thêm

1. Chỉ chấp nhận mechanics version 1, 2 hoặc 3.
2. V3 sandbox cho phép đúng một paired challenge; production preset count được quyết định sau playtest.
3. `TestimonyFragmentId`, fragment text và `RevealTitle` bắt buộc.
4. Challenge dialogue phải tồn tại và có thể được Interrogator hỏi trước resolution.
5. Correct evidence phải được Investigator discover bằng camera/inspect/interaction được hỗ trợ.
6. Correct evidence không được unlock bởi chính challenge đó.
7. Không có path cần success clue để mở correct evidence hoặc source dialogue.
8. `FailureResponse` không được trùng `SuccessResponse`.
9. Unlock clue phải tạo state change mới, không chỉ reward trùng với một required path trước đó.
10. Final required chain không được complete chỉ bằng global IDs nếu paired attempt chưa có two contributors.
11. V3 fixture phải có role-action budget tối thiểu cho cả hai; đây là structural rule, không phải fun proof.
12. Public/player DTO không serialize `CorrectEvidenceId`.

## 11.3 Migration matrix

| Content hiện tại | Giữ nguyên | Map tự động | Author bổ sung | Không tương thích |
|---|---|---|---|---|
| V1 case | Chạy legacy mode | Không | Không | Không dùng V3 |
| V2 case không challenge | Chạy V2 | Không | Nhiều | Không nên migrate |
| V2 `EvidenceChallenge` | Chạy V2 unchanged | Dialogue/evidence/response/unlock | Excerpt, reveal, privacy review | Có thể migrate bán tự động |
| V2 clue | Chạy V2 | Discovery owner suy ra runtime | Kiểm tra Investigator-owned semantic | Một số dialogue/puzzle clue không phù hợp |
| V2 teamwork chain | Chạy V2 | Map references | Xác nhận paired semantics | Chain late-merge có thể không phù hợp |
| V2 deduction | Chạy V2 | Không cần cho MVP | Thiết kế sau | Không block sandbox |
| AI generated case | Chạy V2 | JSON shape một phần | Human review contradiction | Chưa tự publish V3 |

## 11.4 Chiến lược versioning/migration

- **Không migrate existing cases trong 30 ngày.**
- Tạo một V3 sandbox hand-authored.
- Giữ V1/V2 resolver và DTO behavior.
- Sau khi human gate pass, viết converter tạo **draft V3** từ V2 challenge.
- Converter không được publish tự động; testimony fragment, fairness và hypothesis reversal bắt buộc human review.
- AI generation V3 chỉ bắt đầu sau khi ít nhất hai hand-authored paired chains đã qua playtest.

## 11.5 Authoring effort hypothesis

| Work | Initial estimate |
|---|---:|
| Map existing dialogue + evidence | 15–30 phút |
| Viết excerpt/success/failure/reveal | 45–90 phút |
| Kiểm dependency và validator | 30–60 phút |
| Blind comprehension test | 30–60 phút |
| Tổng mỗi chain | **2–4 giờ** nếu asset có sẵn |

Đây là planning range, không phải số đo production. Nếu một chain thường vượt bốn giờ mà không tạo giá trị rõ trong playtest, authoring cost là stop signal.

---

# 12. Test strategy

## 12.1 Unit/domain tests

| Test | Expected |
|---|---|
| Interrogator tạo draft với testimony chưa discover | Forbidden/bad request |
| Investigator gửi challenge | Forbidden |
| Interrogator gửi evidence | Forbidden |
| Investigator chọn evidence chưa discover | Rejected không leak |
| First proposal | Draft persisted, no resolution |
| Second proposal | Paired, no resolution |
| First confirm | One-confirmed, no resolution |
| Second confirm correct | Exactly one resolution/unlock |
| Second confirm wrong | Exactly one penalty/failure result |
| Duplicate confirm | Idempotent |
| Edit after one confirm | Revision++, confirmations empty |
| Stale expected revision | Conflict |
| Cancel | Draft removed, no penalty |
| Recreate same draft retry | Existing state returned |
| V2 behavior | Unchanged |

## 12.2 Projection/no-leak tests

Hai user trên cùng canonical `GameplayState`:

1. Investigator response có private clue; Interrogator response không có clue ID/title/content/photo.
2. Interrogator response có private testimony; Investigator response không có question/answer/excerpt.
3. Partner response chỉ có boolean readiness.
4. Action log không leak private text.
5. Evidence photo endpoint trả 404/403 cho partner trước resolve.
6. Sau correct hoặc wrong resolution theo policy, pair/result shared đúng.
7. Serialization snapshot không chứa `CorrectEvidenceId`.

Không chỉ assert count; deep-search serialized JSON cho tất cả secret sentinel values.

## 12.3 Integration tests

Tối thiểu dùng hai authenticated caller:

- Interrogator tạo draft, Investigator nhận generic pending state.
- Proposal đến theo cả hai thứ tự hợp lệ nếu API cho phép.
- Confirm đồng thời; chỉ một write resolve.
- Một request mất response rồi retry.
- Reconnect/refetch khôi phục revision và confirm.
- V3 SignalR room payload không chứa private ID/content.
- V2 canonical path vẫn hoàn thành.
- Scene transition với active draft tuân invariant.

## 12.4 UI tests

- Investigator chỉ thấy private evidence tab.
- Interrogator chỉ thấy private testimony tab.
- Generic partner notification không spoiler.
- Interrogator chọn excerpt/start.
- Investigator chọn evidence/respond.
- Waiting state hiển thị correct actor/status.
- Edit clear confirm trên cả hai client.
- Resolved presentation xuất hiện đồng bộ.
- Keyboard focus không bị mắc trong overlay.
- 1366×768 không che confirm/cancel.

## 12.5 Human playtest protocol

Chạy cùng phòng hoặc Discord; không build voice chat trước.

Quan sát:

- Nội dung private nào được nói ra.
- Người chơi có mô tả hay chỉ gọi tên ID/card.
- Số lần clarify.
- Ai đề xuất theory.
- Thời gian active và waiting theo role.
- Wrong pair và nguyên nhân.
- Trước Crack: mỗi người viết một câu hypothesis.
- Sau Crack: mỗi người viết lại hypothesis.
- Mỗi người giải thích vì sao evidence mâu thuẫn testimony.
- Cả hai tự đánh giá contribution 1–5.

Mọi kết luận fun/tension/payoff: `Requires human playtest validation`.

---

# 13. Gameplay sandbox 8–12 phút

## Scope

- Một scene.
- Một NPC chính.
- Ba physical evidence; một correct, hai plausible wrong.
- Ba testimony excerpts; một challenge chính, hai context statements.
- Một paired contradiction.
- Một hypothesis reversal/reveal clue.
- Một final decision ngắn, không phải full accusation system.

Không cần art mới: dùng asset local hiện có hoặc placeholder dev-safe; fixture riêng không sửa case/asset gốc.

## Beat map

| Beat | Investigator biết/làm | Interrogator biết/làm | Dependency | System feedback | Metric |
|---|---|---|---|---|---|
| 0. Entry | Objective tìm physical inconsistency | Objective lấy timeline claim | Parallel | Role-specific objective | Time-to-first-action |
| 1. Explore | Tìm 2–3 evidence | Hỏi 2–3 topic | Không | Private discovery card | Active time |
| 2. Suspicion | Chỉ có evidence detail | Chỉ có suspicious excerpt | Communication | Generic partner progress | Detail shared verbally |
| 3. Open Crack | Nhận request generic | Chọn suspicious excerpt | INT initiates | Pending state | Time to response |
| 4. Pair | Chọn evidence | Chờ/review testimony | I responds | Both-ready | Waiting duration |
| 5. Confirm | Confirm hoặc edit | Confirm hoặc edit | Both | Confirmation status | Edits/clarifications |
| 6. Resolve | Xem pair/result | Xem pair/result | Server | Crack presentation | Comprehension |
| 7. Reversal | Đọc reveal shared | Đọc reveal shared | Shared | Objective changes | Hypothesis before/after |
| 8. End decision | Cùng chọn một short conclusion | Cùng thảo luận | Social | Result summary | Contribution self-report |

## Sandbox success gate

Technical:

- Complete được bằng two-session automated flow.
- Không một caller truy cập private content của partner trước resolution.
- Reload/reconnect không mất attempt.

Human targets:

- Cả hai truyền đạt ít nhất một chi tiết riêng trước confirm.
- Cả hai giải thích được contradiction sau reveal.
- Không một người tự giải chỉ bằng UI.
- Waiting không hành động/suy luận trên 45 giây được coi là alarm ban đầu, không phải universal threshold.
- Hypothesis sau Crack khác trước Crack ở phần causal claim.

Toàn bộ human targets: `Requires human playtest validation`.

---

# 14. Implementation backlog

Backlog dưới đây chỉ dành cho selected MVP. Task lớn hơn tám giờ đã được tách.

| Priority | Task | Player value | Technical purpose | Files/modules likely affected | Effort | Dependencies | Risk | Definition of Done | Verification |
|---:|---|---|---|---|---:|---|---|---|---|
| 1 | Chốt V3 ADR + visibility matrix | Không xây nhầm co-op giả | Khóa semantics/versioning | `docs/adr/*` | 2–3h | — | Thiết kế quá rộng | Có invariants, non-goals, DTO visibility | Review against this audit |
| 2 | Thêm V3 constant và additive challenge fields | Case phân biệt rõ behavior | Versioned schema | `GameCase.cs` | 2–3h | 1 | Break deserialize | V1/V2 deserialize unchanged | Unit serialization |
| 3 | Thêm testimony attribution + active attempt state | Persist private ownership/pending action | Domain storage | `GameRoom.cs` | 3–4h | 1 | State bloat | Default-safe legacy documents | BSON/serialization tests |
| 4 | Viết pure paired state rules | Joint decision thật | Central state machine | `PairedConfrontationRules.cs` | 6–8h | 2–3 | Edge transition | All transitions deterministic | Unit test matrix |
| 5 | Thêm V3 caller knowledge projection | Mỗi vai có kiến thức riêng | Server privacy | `GameStateBuilder.cs`, DTOs | 6–8h | 2–4 | Missed leak | Separate private/shared lists | Deep JSON sentinel tests |
| 6 | Khóa photo/log/transient leak | Không bypass asymmetry | Close secondary channels | photo policy, action log, notifier | 4–6h | 5 | Legacy regression | Wrong role cannot read secret | Endpoint/event tests |
| 7 | Tạo paired command DTO/controller | API rõ theo role | Thin API surface | `GameController.cs`, DTOs, interface | 3–4h | 4 | Endpoint sprawl | Four commands documented | Controller compile/tests |
| 8 | Orchestrate create/propose | Hai role đóng góp khác nhau | Service command flow | `GameplayService`, new coordinator | 5–7h | 4–7 | Logic vào giant service | Coordinator owns rule orchestration | Unit/service tests |
| 9 | Orchestrate confirm/resolve/cancel | Không ai resolve một mình | Atomic second confirm | Same as task 8 | 5–7h | 8 | Double resolve | Idempotent resolution | Concurrent tests |
| 10 | Sanitize V3 SignalR | Partner biết progress không biết secret | Generic invalidation/event | `GameNotifier`, interface | 2–4h | 5–9 | ID leak | V3 payload contains no sentinel | Serialized event test |
| 11 | Two-caller reconnect/race tests | Không mất draft hoặc double reward | Multiplayer reliability | integration test fixture | 5–7h | 8–10 | Fixture effort | Retry/reconnect pass | Automated run |
| 12 | Tách FE paired view-model module | UI mới không tăng debt monolith | Feature boundary | `js/game/pairedConfrontation.ts` | 3–5h | DTO stable | Import coupling | Pure view states tested | Typecheck/unit/static test |
| 13 | Private evidence/testimony notebooks | Người chơi hiểu phần mình biết | Role-specific UI | `gamePage.ts`, game module | 5–7h | 5,12 | UX overload | No wrong-role secret rendered | Playwright assertions |
| 14 | Proposal/wait/edit/confirm UI | Joint action rõ ràng | Full interaction state | game module + API client | 6–8h | 7–13 | Waiting confusion | All server states render/actionable | UI smoke |
| 15 | Crack result presentation | Resolution có payoff rõ | Dedicated feedback | game module/CSS | 4–6h | 9,14 | Toast-level feel | Both clients show paired reveal | Screenshot/UI test |
| 16 | V3 validator rules | Fixture authorable, không circular | Content safety | `CaseValidationService`, tests | 5–7h | 2,4 | False positives | Invalid fixtures fail targeted codes | Unit tests |
| 17 | Hand-author sandbox fixture | Test mechanic, không test prose | Minimal content | new dev fixture outside originals | 4–6h | 16 | Content confound | Pass validator, one Crack loop | Validator + static review |
| 18 | Automated two-session sandbox flow | Proof end-to-end | Regression harness | scripts/tests | 4–6h | 11,14,17 | Flaky timing | Complete/reconnect/no-leak pass | Repeat 3 runs |
| 19 | Freeze build + run 3 human pairs | Xác nhận communication/agency | Product validation | protocol/data sheet | 8–12h | 18 | Small sample | Same build for all 3 | Observation + interview |
| 20 | Sửa một bottleneck và retest | Đo iteration, không feature creep | Close highest evidence gap | TBD by data | 4–8h | 19 | Cherry-picking | One hypothesis, one change | New pair/regression |

---

# 15. Roadmap 30 ngày — solo developer 2–4 giờ/ngày

## Tuần 1 — Contract và proof of privacy architecture

| Day | Objective | Task 1 | Task 2 nếu có | Time | Dependency | Deliverable | Verification | Stop/Rollback condition |
|---:|---|---|---|---:|---|---|---|---|
| 1 | Khóa scope | Viết ADR V3: lifecycle, visibility, non-goals | Lập secret sentinel matrix | 3h | Audit | ADR approved by self-review | Every response/event route covered | Nếu cần generic ACL toàn game ngay, thu scope |
| 2 | Version contract | Thêm mechanics V3 constant | Thêm additive excerpt/reveal fields | 3h | D1 | Schema compile | V1/V2 deserialize tests | Nếu field phá JSON cũ, sửa additive trước tiếp tục |
| 3 | Runtime records | Thêm testimony attribution | Thêm active confrontation record | 3h | D1–2 | Persistence shape | BSON/default tests | Không dùng parallel collections mới |
| 4 | State machine part 1 | Implement create/propose/edit pure rules | — | 4h | D3 | Draft→paired transitions | Unit tests | Nếu rule phụ thuộc HTTP/Mongo, tách lại |
| 5 | State machine part 2 | Implement confirm/cancel/resolve idempotency | — | 4h | D4 | Full transition engine | Duplicate/stale tests | Nếu second confirm không atomic, không làm UI |
| 6 | Projection proof | Project private evidence/testimony/shared result | — | 4h | D2–5 | Two caller DTO snapshots differ | Deep secret sentinel test | Nếu phải hide client-side, **NO-GO** |
| 7 | Close first leaks | Filter action log + photo policy proof | Weekly gate review | 3–4h | D6 | Privacy proof build | 237 legacy tests + new tests | Nếu V2 regression không isolated được, revise version boundary |

### Week 1 decision gate

| Mục | Nội dung |
|---|---|
| Hypothesis | Caller-specific projection có thể tạo private knowledge mà không rewrite stack |
| Build cần có | Domain rules + serialized two-caller projection test |
| Metrics | Secret leaks; legacy failures; code paths touched; hours used |
| Keep | 0 leak trong tested routes; V1/V2 pass; <=26 giờ |
| Revise | Một số DTO/event cần tách thêm nhưng version boundary rõ |
| Rollback | Chỉ đạt privacy bằng frontend hiding hoặc phải thay room/auth model |
| Adjustment | Nếu chậm, bỏ action-log UI ở V3 thay vì thiết kế ACL tổng quát |

## Tuần 2 — Paired interaction end-to-end

| Day | Objective | Task 1 | Task 2 nếu có | Time | Dependency | Deliverable | Verification | Stop/Rollback condition |
|---:|---|---|---|---:|---|---|---|---|
| 8 | API surface | Thêm request/response DTO | Thêm thin controller routes | 3h | W1 | Compiling endpoints | Model validation tests | Không thêm endpoint read partner secret |
| 9 | Interrogator proposal | Implement create/upsert challenge draft | Generic room invalidation | 3–4h | D8 | INT can open attempt | Wrong-role/undiscovered tests | Nếu challenge ID broadcast, fix trước |
| 10 | Investigator proposal | Implement evidence upsert | Clear confirm on edit | 3–4h | D9 | Both proposals persisted | Revision tests | Không cho INT submit evidence |
| 11 | Dual confirmation | Implement confirm and second-confirm resolution | Reuse existing ApplyEvidence outcome | 4h | D10 | Correct/wrong resolve | Exactly-once tests | Double reward = blocker |
| 12 | Cancel + scene behavior | Implement cancel | Block/define scene transition with active attempt | 3h | D11 | No orphan draft | Transition tests | Không tự silently discard draft |
| 13 | Realtime/reconnect | Sanitize V3 events | Refetch restores attempt | 4h | D9–12 | Reconnect-safe state | Hub payload + reconnect tests | Secret in group event = blocker |
| 14 | Two-session API proof | Run full paired flow in isolated test fixture | Weekly gate | 4h | D13 | Headless end-to-end loop | Three repeat runs | Race remains after one focused fix → cut/reassess |

### Week 2 decision gate

| Mục | Nội dung |
|---|---|
| Hypothesis | Hai client có thể complete một Crack loop ổn định |
| Build cần có | API-only paired flow, no polished UI |
| Metrics | Duplicate resolution; conflict/retry; reconnect recovery; leak count; flow calls |
| Keep | Exactly-once resolution, deterministic retry, 0 private leak |
| Revise | Waiting semantics/API naming unclear nhưng state correct |
| Rollback | Không đạt atomic resolution bằng existing optimistic version trong timebox |
| Adjustment | Giữ one-active-attempt; không thêm queue/multi-attempt |

## Tuần 3 — Playable UI, validator và sandbox

| Day | Objective | Task 1 | Task 2 nếu có | Time | Dependency | Deliverable | Verification | Stop/Rollback condition |
|---:|---|---|---|---:|---|---|---|---|
| 15 | FE boundary | Thêm V3 TS types | Tạo paired view-model module | 3h | W2 DTO stable | Pure UI state mapper | Typecheck | Không duplicate server rules trong client |
| 16 | Private notebook | Render Investigator evidence riêng | Render Interrogator testimony riêng | 4h | D15 | Role-specific case file | Wrong-role Playwright assertions | Secret DOM text = blocker |
| 17 | INT interaction | UI chọn excerpt/start attempt | Generic partner activity | 3h | D16 | INT proposal usable | UI smoke | Không show correct evidence hint |
| 18 | INV interaction | UI chọn evidence/respond | Evidence photo caller-safe | 3h | D17 | Pair complete | UI smoke | Không show excerpt content |
| 19 | Joint decision | Waiting/edit/confirm states | Focus/keyboard handling | 4h | D17–18 | Both-confirm flow | Desktop viewport smoke | Modal traps player with no exit |
| 20 | Payoff | Implement Crack comparison/reveal overlay | Optional existing audio sting | 4h | D19 | Dedicated result presentation | Both-client screenshot/assertion | Không mở audio system mới |
| 21 | Authoring safety | Add V3 validator rules | Add invalid circular/leak fixtures | 4h | W2 | V3 validation suite | Targeted error codes | Validator chỉ kiểm count → chưa đủ |
| 22 | Sandbox | Hand-author one-scene fixture | Automated two-session UI/API run | 4h | D20–21 | Playable 8–12m sandbox | Full regression + 3 runs | Authoring >4h chỉ cho chain → flag risk |

### Week 3 decision gate

| Mục | Nội dung |
|---|---|
| Hypothesis | Loop có thể author bằng data và hiểu được qua UI |
| Build cần có | Frozen V3 sandbox |
| Metrics | Validator errors; source code special-case count; UI leak; authoring hours; completion |
| Keep | Không hard-code fixture ID; one chain <=4h authoring; automated flow pass |
| Revise | Presentation/labels chưa rõ nhưng system reliable |
| Rollback | Mỗi chain cần custom gameplay code hoặc schema explodes |
| Adjustment | Bỏ reveal extras, giữ excerpt/evidence/result tối thiểu |

## Tuần 4 — Human validation và một iteration

| Day | Objective | Task 1 | Task 2 nếu có | Time | Dependency | Deliverable | Verification | Stop/Rollback condition |
|---:|---|---|---|---:|---|---|---|---|
| 23 | Freeze test build | Regression + privacy checklist | Chuẩn bị consent/protocol/30s sheet | 3h | W3 | Version A frozen | Hash/build note | Không sửa content giữa ba cặp |
| 24 | Pair 1 | Chạy playtest + interview | Ghi 30-second observations | 3h | D23 | Session 1 dataset | Data completeness | Chỉ can thiệp theo soft-lock rule |
| 25 | Pair 2 | Chạy cùng Version A | Interview | 3h | D23 | Session 2 dataset | Same protocol | Không hotfix theo một người |
| 26 | Pair 3 | Chạy cùng Version A | Interview | 3h | D23 | Session 3 dataset | Same protocol | Nếu critical bug, invalidate và refreeze |
| 27 | Synthesis | Map communication/wait/comprehension | Chọn một bottleneck | 3–4h | D24–26 | Evidence ranking | Trace each conclusion to event/timestamp | Không sửa nhiều hypothesis cùng lúc |
| 28 | One change | Implement smallest fix cho bottleneck #1 | Regression | 4h | D27 | Version B | Automated suite | Change >4h phải rescope |
| 29 | Retest | Chạy một cặp mới với Version B | Compare same metrics | 3h | D28 | A/B directional evidence | Same protocol | Không claim statistical significance |
| 30 | Decision | GO/REVISE/ROLLBACK memo | Freeze next backlog | 3h | D29 | Product decision | Gates below | Không tự động migrate cases |

### Week 4 decision gate

| Mục | Nội dung |
|---|---|
| Hypothesis | Private halves + dual confirm tạo information sharing và joint reasoning |
| Build cần có | Version A cho ba cặp; Version B cho một retest |
| Metrics | Private detail shared; idle; clarification; wrong pair; comprehension; hypothesis change; contribution |
| Keep | Người chơi cần trao đổi, hiểu contradiction và cả hai tạo contribution |
| Revise | Loop tốt nhưng cue/wait/payoff gây friction cục bộ |
| Rollback | Cặp hoàn thành không cần trao đổi hoặc private split gây mất phương hướng dai dẳng |
| Adjustment | Nếu communication tốt nhưng confirm thừa, thử một confirm chung sau explicit proposals thay vì bỏ privacy |

---

# 16. Risk register

| Risk | Probability | Impact | Early signal | Mitigation | Contingency | Owner |
|---|---|---|---|---|---|---|
| Private data leak qua DTO | Cao | Rất cao | Sentinel xuất hiện wrong-role JSON | Central projection + deep serialization tests | Tắt V3 route cho tới fix | Solo dev |
| Leak qua photo/log/event | Trung bình-cao | Cao | Wrong role mở URL/đọc ID/title | Route policy + audience-aware/generic payload | V3 không expose log/photo tạm thời | Solo dev |
| Double resolve do race | Trung bình | Rất cao | Hai unlock/penalty | Optimistic version + idempotent rule | Serialize confirm per room trong MVP | Solo dev |
| Reconnect mismatch | Trung bình | Cao | Client hiện stale confirm | Persist attempt + refetch only | Force close overlay and reload projection | Solo dev |
| V2 regression | Thấp-trung bình | Cao | Existing tests fail | Mechanics V3 branch | Feature flag V3 fixture only | Solo dev |
| Authoring explosion | Trung bình | Cao | One chain >4h hoặc cần custom code | Minimal excerpt/pair/reveal contract | Giữ V2 content, giảm semantic extras | Solo dev |
| One-role waiting | Cao | Cao | Idle > alarm threshold | Review/edit/explore while waiting, objective cue | Remove redundant second confirm or reorder | Playtester + dev |
| Forced communication friction | Trung bình-cao | Cao | “Bạn thấy gì?” lặp mà không suy luận | Generic cues + concise private info | Add limited share/ping after test | Playtester + dev |
| Không có integrated comms | Cao | Trung bình-cao | Remote pair không biết kênh nói | Test cùng phòng/Discord, onboarding note | Text ping later, không voice stack | Solo dev |
| Repeated loop fatigue | Chưa biết | Cao | Later chains solved by pattern | Chỉ scale after one-loop validation | Vary relation/presentation/content | Game Director |
| Payoff không đủ mạnh | Trung bình | Cao | Players không recall/hypothesis unchanged | Dedicated compare/reveal presentation | Rewrite setup/reveal before adding systems | Game Director |
| Scope creep/refactor | Cao | Rất cao | Touch unrelated services, day gate slips | Feature slice, weekly stop conditions | Cut AI/migration/polish | Solo dev |

---

# 17. Testable success criteria

## 17.1 Technical success

- V1/V2 automated tests vẫn pass.
- Wrong role không lấy private sentinel qua state, scene DTO, logs, events hoặc photo endpoint.
- Một active attempt persist và survive reconnect.
- Duplicate create/propose/confirm không tạo duplicate state/reward.
- Concurrent second confirm chỉ có một winner mutation; caller còn lại nhận resolved state.
- V3 fixture pass validator mà gameplay code không chứa fixture ID.
- Build/typecheck/UI smoke pass.

## 17.2 Structural gameplay success

- Investigator và Interrogator cung cấp hai input khác loại.
- Không role nào resolve chain một mình.
- Trước resolve, mỗi role thiếu nội dung cần thiết để tự match bằng UI.
- Sau resolve, result và reveal trở thành shared knowledge.
- Correct result thay đổi downstream game state.
- Mọi pending state có objective/action/review rõ cho từng role.

## 17.3 Human validation targets

Các target sau không phải kết quả hiện có:

- Mỗi cặp truyền đạt ít nhất một chi tiết private có ý nghĩa trước confirm.
- Cả hai người giải thích được contradiction bằng lời sau result.
- Ít nhất một hypothesis causal thay đổi sau Crack.
- Không role nào tự mô tả mình chỉ là “người bấm confirm”.
- Waiting không hành động hoặc suy luận trên 45 giây là alarm cần xem lại.
- Nếu hai trong ba cặp hoàn thành mà không cần trao đổi chi tiết, private split/UX đã thất bại về mục tiêu.

Tất cả: `Requires human playtest validation`.

---

# 18. Những việc không nên làm

| Không làm | Lý do | Xem lại khi nào |
|---|---|---|
| Tạo thêm full case | Không chứng minh core loop | Sau human gate |
| Migrate Glasshouse/Meridian ngay | Trộn migration/content với system test | Sau V3 sandbox ổn định |
| Giấu full state bằng CSS/JS | Information asymmetry giả, technical debt | Không bao giờ là production solution |
| Rewrite toàn `GameplayService` | Tăng blast radius | Sau khi feature slice ổn và có test |
| Rewrite toàn `gamePage.ts` | Trì hoãn proof | Tách đúng module V3 trước |
| Xây voice chat | Chi phí cao, chưa biết loop cần gì | Sau playtest cùng phòng/Discord |
| Làm theory graph tổng quát | Chưa cần để test reversal | Khi nhiều chain chứng minh nhu cầu |
| Mở nhiều concurrent attempts | Concurrency/UI tăng mạnh | Sau one-attempt flow pass |
| Thêm timer để tạo tension | Không sửa information/co-op | Chỉ khi playtest chứng minh pacing cần |
| Nâng AI generator V3 trước | AI sẽ scale contract chưa đúng | Sau hai hand-authored chain validated |
| Làm cinematic/asset lớn | Có thể che logic yếu | Sau comprehension pass |
| Đếm action để gọi là cân bằng | Action count không bằng agency | Đo contribution/active/waiting thật |

---

# 19. Final decision

## Verdict

**GO WITH CONSTRAINTS**

## Tại sao

Hướng Crack the Lie phù hợp với fantasy hiện có và có seam kỹ thuật tốt hơn vẻ bề ngoài. `GameStateBuilder` đã caller-aware; `EvidenceChallenge` đã nối dialogue với correct evidence; `ClueDiscoveryRecord` đã ghi role attribution; optimistic version đã bảo vệ mutation; SignalR chỉ cần broadcast version để mỗi caller lấy projection riêng. Vì vậy không cần thay stack hoặc rewrite room lifecycle.

Rủi ro tập trung ở ba điểm: đóng mọi information leak route, thiết kế paired state idempotent và chứng minh forced communication không trở thành waiting/friction. Hai điểm đầu có thể giải bằng feature slice và test trong hai tuần. Điểm cuối chỉ giải bằng người thật. Không nên triển khai production-wide hoặc migrate case trước human gate.

## Phạm vi MVP đã chọn

Một V3 sandbox có một paired evidence challenge: Interrogator giữ testimony excerpt riêng, Investigator giữ evidence riêng, mỗi người proposal phần của mình, cả hai confirm, server resolve đúng/sai, rồi pair và reveal mới trở thành shared. V1/V2 giữ nguyên. Không voice chat, không theory graph, không AI generation V3, không migrate case và không dual accusation trong MVP.

## Việc duy nhất phải làm ngày mai

**Viết ADR `Paired Confrontation V3` và visibility matrix trước khi sửa code.**

- File dự kiến: `docs/adr/ADR-PAIRED-CONFRONTATION-V3.md`.
- Timebox: 2–4 giờ.
- Definition of Done: state machine, server invariants, V1/V2 boundary, mọi response/event/photo/log route và MVP non-goals được ghi rõ.
- Verify: đối chiếu ADR với section 5 và 10 của báo cáo; không còn field nào chưa xác định audience.

## Điều phải chứng minh sau 7 ngày

Hai caller trên cùng canonical state nhận serialized response khác nhau; wrong-role response không chứa bất kỳ private sentinel nào; V1/V2 tests vẫn pass. Nếu chỉ đạt bằng frontend hiding, direction phải dừng.

## Điều phải chứng minh qua human gates

Ba cặp đầu chỉ là falsification gate để quyết định Kill/Iterate. Sau một iteration phải chạy thêm 3–5 cặp mới; chỉ khi tổng cộng 8–12 cặp cần trao đổi private detail, hiểu vì sao pair tạo contradiction và cùng có contribution mới được cân nhắc scale. `Requires human playtest validation`.

## Khi nào phải bỏ hoặc thu nhỏ hướng này

- Server privacy đòi rewrite rộng hơn versioned projection.
- Paired confirm vẫn double-resolve hoặc mất state sau reconnect sau một tuần timebox.
- Một chain cần custom gameplay code hoặc thường vượt bốn giờ authoring.
- Hai trong ba cặp có thể hoàn thành mà không trao đổi detail.
- Hai trong ba cặp không giải thích được contradiction sau presentation.
- Một role chủ yếu chờ hoặc chỉ confirm dù đã thử một iteration nhỏ.
- 30 ngày kết thúc mà chưa có frozen human-playtest build.
