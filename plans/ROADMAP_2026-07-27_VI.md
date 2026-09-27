# SirLocked — Kế hoạch phát triển chi tiết (Roadmap 013+)

> **Ngày lập:** 27/07/2026
> **Commit nền:** `af3da77 chore(assets): commit generated assets for the Broken Seal star-carpet case`
> **Nhánh hiện tại:** `feature/ai-gameplay-v2-20260717`
> **Nguồn sự thật:** code đang chạy + test hiện tại. Tài liệu trong `ai-game-docs/` là nguồn bổ trợ và nhiều chỗ đã cũ.
> **Mục đích:** biến các audit đã có (`docs/EXPERT_AUDIT_2026-07-18_VI.md`, `docs/CORE_GAMEPLAY_FEASIBILITY_AUDIT_VI.md`) thành một hàng đợi feature có thể code được, mỗi mục đủ chi tiết để mở một plan file theo template `plans/003-*.md` rồi thực thi.

---

## 0. Baseline đã kiểm chứng trong lượt lập kế hoạch này

| Kiểm tra | Lệnh | Kết quả |
|---|---|---|
| Build backend | `dotnet build SirLocked.sln` | **Pass** — 0 warning, 0 error |
| Test backend | `dotnet test SirLocked.sln --no-build` | **Pass** — 502 unit + 27 integration = **529/529** |
| Typecheck frontend | `npx tsc --noEmit` (`src/FE`) | **Pass** |

Baseline sạch. Mọi feature dưới đây phải giữ nguyên ba cổng này ở trạng thái pass.

### Những gì ĐÃ có (kiểm chứng từ code, không phải từ docs)

- **Auth**: JWT + refresh token, Google OAuth, email verify/reset, khóa/mở user, role `PLAYER`/`VIP`/`ADMIN`.
- **Case**: import/validate/publish/unpublish, cache process-local, validator sâu (`CaseValidationService.cs` 1.813 dòng) gồm reachability, V2 counts, canonical truth references.
- **Room/Lobby**: room code 6 ký tự, 2 người, role bắt buộc khác nhau, ready/start, reconnect grace, `RoomRecoveryRules`.
- **Gameplay V1/V2**: inspect item, inventory, use/combine, camera capture clue + evidence photo, puzzle, conversation tree (`ConverseAsync`), present evidence, deduction, hint tier, teamwork chain, scene/stage progression, accusation V2 nhiều thành phần, score/rank.
- **Gameplay V3 "Crack the Lie"**: `PairedConfrontationCoordinator` + `PairedConfrontationsController` (start / edit testimony / submit evidence / confirm / cancel), `V3KnowledgeProjector` cho projection theo caller, private notebook + joint review UI, sandbox case song ngữ `case-v3-broken-seal-en|vi`, test chống rò rỉ sentinel.
- **Realtime**: SignalR `/hubs/game`, version-only invalidation, pose broadcast, presence.
- **AI pipeline**: hàng đợi Mongo bền vững + `AiGenerationWorker` (lease 20 phút, heartbeat 2 phút, checkpoint resume, retry 15s/60s/5m), staged approval preview → truth package → projection → assets → import/publish, strict JSON Schema, deterministic validator, artifact cleanup script.
- **Meta**: workshop, review, leaderboard, badge, weekly challenge, profile, i18n EN/VI, health checks `/live` + `/health`.
- **Test nền**: 529 backend tests, Playwright UI smoke + two-browser V3 flow + full-stack V3 gate, script Mongo cô lập.

### Những gì CHƯA có (đã grep xác nhận, đây là nguồn của roadmap)

| Thiếu | Bằng chứng |
|---|---|
| Accusation đồng thuận 2 người | `GameplayService.cs:1431 AccuseAsync` — một caller kết thúc cả trận |
| Lưu telemetry playtest | `NoOpPlaytestEventSink.cs` trả `Task.CompletedTask`, `Program.cs:103` đăng ký bản No-Op |
| Ledger chi phí AI / quota / circuit breaker | không có định danh `costUsd`, `TokenUsage`, `budget` nào trong `src/BE` |
| Security headers production | không có `UseHsts`, `UseHttpsRedirection`, CSP trong `Program.cs` |
| Rate limit phân vùng theo IP/user | `Program.cs:121-159` chỉ là `AddFixedWindowLimiter` global (đúng như plan 011 mô tả) |
| Token an toàn | `session.js` lưu access + refresh token trong `localStorage` |
| Đóng gói asset | `src/FE/public` = **402 MB**, copy nguyên vào build |
| Audio | không có file `.mp3`/`.ogg` hay module audio nào trong `src/FE/Client` |
| Solo / bot / tutorial | không có định danh bot/solo trong `src/BE/Services` |
| Invite link / QR | `createRoomPage.js`, `lobbyPage.js` không có share/invite |
| Host migration khi đang chơi | chỉ chuyển host ở phòng WAITING |
| Tách god file | `AiCaseService.cs` 6.091 dòng, `gamePage.ts` 4.075 dòng, `GameplayService.cs` 1.848 dòng |

---

## 1. Nguyên tắc thực thi

1. **Một feature = một plan file** trong `plans/` theo template của `plans/003-add-real-health-checks.md` (Status → Why → Current state → Commands → Scope → Steps → Test plan → Done criteria → STOP conditions).
2. **Một feature = một nhánh** `feature/<id>-<slug>`, merge vào `develop` sau khi qua đủ cổng verify.
3. **Backend luôn authoritative.** Không tin state từ client cho unlock, progress, role, kết quả, vị trí.
4. **Additive trước, refactor sau.** Không đổi shape response `ApiResponse<T>` và route hiện có trừ khi plan nói rõ; thêm field mới thay vì đổi field cũ.
5. **Mechanics version là ranh giới tương thích.** V1/V2 không được regression khi thêm V3+; mọi thay đổi contract case phải additive và có migration matrix.
6. **Cổng verify bắt buộc cho mọi plan:**
   ```powershell
   dotnet build SirLocked.sln
   dotnet test SirLocked.sln --no-build
   cd src/FE; npm run typecheck; npm run build
   ```
   Feature chạm gameplay phải thêm: `npm run test:ui` hoặc script Playwright liên quan.
7. **Không dùng Atlas/production DB khi test.** Dùng `scripts/test-v3-mongo.ps1` (tạo `sirlocked_it_<guid>` rồi drop).
8. **Mỗi thành viên ghi `docs/<MSSV>_.../AI_AUDIT_LOG.md` và `CHANGELOG.md`** theo yêu cầu môn học ngay trong PR của feature mình làm.

---

## 2. Bản đồ giai đoạn

| Giai đoạn | Mục tiêu | Thời lượng ước tính | Feature |
|---|---|---|---|
| **P0 — Đo được** | Có dữ liệu thật để quyết định, không phải cảm tính | 3–5 ngày | 013, 014 |
| **P1 — Không mất trận, không mất tiền, không mất dữ liệu** | Đủ an toàn để mở closed alpha | 2–3 tuần | 015 → 019 |
| **P2 — Activation & onboarding** | Người mới chạm "fun" trong 5 phút, mời được bạn | 3–4 tuần | 020 → 024 |
| **P3 — Chất lượng cảm nhận** | Cảm giác premium, hiệu năng ổn, nội dung tin được | 3–4 tuần | 025 → 030 |
| **P4 — Vận hành & phát hành** | Deploy được, quan sát được, hợp lệ pháp lý | 4+ tuần | 031 → 035 |

Quy tắc thứ tự: **không mở P2 khi P1 còn P0-blocker**, và **không thêm cơ chế gameplay mới khi telemetry (013) chưa chứng minh hai vai cân bằng**.

---

# GIAI ĐOẠN P0 — ĐO ĐƯỢC

## Plan 013 — Lưu và đọc telemetry playtest

- **Ưu tiên:** P0 · **Effort:** M (1–1,5 ngày) · **Risk:** LOW · **Depends on:** none

### Vì sao

`PlaytestEventsController` và `IPlaytestEventSink` đã có seam sẵn nhưng bản đăng ký là `NoOpPlaytestEventSink` — mọi sự kiện bị vứt đi. Không có dữ liệu này thì các kết luận "Investigator hoạt động nhiều hơn Interrogator", "người chơi kẹt ở stage 2", "hint bị lạm dụng" đều là phỏng đoán, và các feature P2/P3 sẽ được thiết kế mù.

### Thiết kế

> Chi tiết đầy đủ: [`013-persist-playtest-telemetry.md`](013-persist-playtest-telemetry.md).

- Thêm `MongoPlaytestEventSink : IPlaytestEventSink` ghi vào collection `playtestEvents` (model `PlaytestEventRecord` đã tồn tại).
- Index `{ sessionPseudonym: 1, timestamp: 1 }` + `{ eventType: 1, timestamp: 1 }`, TTL trên `timestamp` theo `Playtest__RetentionDays` (mặc định 30).
- **Không thêm cờ bật/tắt mới** — dùng đúng `GameplayV3__PlaytestInstrumentationEnabled` đang có; `Program.cs` chỉ chọn sink theo cờ đó.
- Giữ nguyên ràng buộc privacy đã có test (`PlaytestInstrumentationPrivacyTests`): **không** ghi clue ID, evidence ID, nội dung testimony, và không ghi cả `roomId`/`userId` thô — model đã cố ý dùng `SessionPseudonym`/`UserHash`.
- Endpoint admin đọc tổng hợp: `GET /api/admin/playtest/summary?caseId&from&to` trả:
  - active-time theo role (ms), chênh lệch %,
  - thời gian trung vị mỗi stage,
  - số hint theo tier,
  - tỷ lệ hoàn thành phòng, tỷ lệ abandoned,
  - số confrontation thành công/thất bại, số revision trung bình.

### Tasks

1. `src/BE/Services/MongoPlaytestEventSink.cs` + interface không đổi.
2. `MongoDbContext`: collection + index + TTL trong `EnsureIndexesAsync`.
3. `Configurations/PlaytestSettings.cs` + đăng ký `Program.cs` (chọn sink theo cấu hình).
4. `AdminController` (hoặc `PlaytestEventsController`) thêm endpoint summary, `[Authorize(Roles="ADMIN")]`.
5. FE: thẻ "Playtest" trong `adminDashboardPage.js` hiển thị 6 chỉ số trên.

### Test

- Unit: sink ghi đúng field, không ghi field nhạy cảm (mở rộng `PlaytestInstrumentationPrivacyTests`).
- Unit: aggregation tính đúng active-time/median trên dữ liệu dựng sẵn.
- Integration (Mongo cô lập): TTL index tồn tại, ghi/đọc round-trip.

### Done criteria

- [ ] Bật `Playtest__Enabled=true`, chơi 1 trận local → thấy sự kiện trong `playtestEvents`.
- [ ] Summary endpoint trả số liệu khớp với sự kiện đã ghi.
- [ ] Không có clue/evidence/testimony ID nào lọt vào document.
- [ ] 529+ tests vẫn pass.

---

## Plan 014 — Chạy 3 cặp playtest có kịch bản trên sandbox V3

- **Ưu tiên:** P0 · **Effort:** S (0,5 ngày chuẩn bị + 3 buổi) · **Depends on:** 013
- Chi tiết đầy đủ: [`014-run-v3-playtest-gate.md`](014-run-v3-playtest-gate.md)

Không phải feature code, nhưng là **cổng quyết định** cho toàn bộ P2/P3. Audit feasibility đã khóa điều kiện: 3 cặp đầu chỉ đủ để Kill/Iterate.

### Tasks

1. Viết `docs/playtest/V3_PLAYTEST_PROTOCOL_VI.md`: kịch bản 45 phút, câu hỏi trước/sau, thang đo comprehension và communication.
2. Chuẩn bị build cố định + case `case-v3-broken-seal-vi`, seed bằng `POST /api/admin/cases/seed-crack-demo`.
3. Ghi quan sát vào `docs/playtest/V3_30_SECOND_OBSERVATION.csv` (file mẫu đã có).
4. Xuất summary từ plan 013 sau mỗi buổi.

### Done criteria

- [ ] 3 cặp hoàn thành hoặc bỏ cuộc có lý do ghi nhận được.
- [ ] Có số liệu chênh lệch active-time giữa hai vai.
- [ ] Có quyết định ghi vào `docs/`: **Kill / Iterate / Scale**.

**STOP:** nếu chênh lệch active-time > 30% hoặc ≥2/3 cặp không hiểu mục tiêu vai mình, dừng mở feature mới và ưu tiên redesign stage trước khi làm P2.

---

# GIAI ĐOẠN P1 — KHÔNG MẤT TRẬN, KHÔNG MẤT TIỀN, KHÔNG MẤT DỮ LIỆU

## Plan 015 — Accusation đồng thuận hai người

- **Ưu tiên:** P0 · **Effort:** L (3–4 ngày) · **Risk:** MED · **Depends on:** 016 (mềm — cùng vùng `RoomService`)
- Chi tiết đầy đủ: [`015-accusation-consensus.md`](015-accusation-consensus.md)

### Vì sao

`AccuseAsync` cho phép **một** người kết thúc trận cho cả đội. Đây là vấn đề #6 trong top-50 audit và mâu thuẫn trực tiếp với định hướng communication-first của V3: hai người điều tra chung nhưng một người quyết định kết cục.

### Thiết kế

Tái dùng đúng mô hình state machine đã chứng minh ở paired confrontation, **không** phát minh cơ chế mới:

```
DRAFTING → (proposer submit) → AWAITING_CONFIRMATION → (partner confirm) → RESOLVED
                                        ↑                     ↓ (partner amend)
                                        └──────── revision + 1 ┘
```

- Model mới trong `GameplayState`: `AccusationProposal { AttemptId, ProposedByUserId, ProposedByRole, CulpritId, EvidenceLinks[], Motive, Method, Revision, Status, ConfirmedBy[], CreatedAt, UpdatedAt }`.
- Confirmation gắn với `Revision` — sửa proposal làm mất confirmation cũ (giống quy tắc đã khóa cho confrontation).
- Timeout mềm: nếu partner không phản hồi trong `Accusation__ConfirmTimeoutSeconds` (mặc định 180), hiện cảnh báo cho cả hai; **không** tự động resolve.
- Chỉ khi có đủ 2 confirmation trên cùng revision mới gọi logic `GameplayV2Rules.ValidateAccusation` + ghi `GameResult` hiện tại. Toàn bộ logic tính đúng/sai **không đổi**.
- Rollback an toàn: `Accusation__RequireConsensus` (mặc định `true`, V3 luôn `true`; V1/V2 có thể tắt để không phá case cũ).

### API (additive, giữ `POST /accuse` cũ cho V1/V2 khi tắt consensus)

| Method | Route | Vai trò |
|---|---|---|
| `POST` | `/api/game/rooms/{roomId}/accusation` | Tạo/ghi đè proposal (bất kỳ người chơi nào) |
| `PUT` | `/api/game/rooms/{roomId}/accusation/{attemptId}` | Sửa proposal → revision + 1, xóa confirmations |
| `POST` | `/api/game/rooms/{roomId}/accusation/{attemptId}/confirm` | Xác nhận theo revision |
| `DELETE` | `/api/game/rooms/{roomId}/accusation/{attemptId}` | Hủy proposal |

Tất cả nhận `revision` trong body để chống stale, trả `PairedConfrontationCommandResponse`-style envelope, phát SignalR version-invalidation (không gửi nội dung proposal qua hub).

### Files

`Models/GameRoom.cs`, `Services/GameRules.cs`, `Services/GameplayService.cs`, `Services/AccusationConsensusRules.cs` (mới, pure), `WebAPI/Controllers/GameController.cs`, `DTOs/Submission/`, `src/FE/Client/js/pages/gamePage.ts` (khối accusation ~dòng 2941–3027 theo bản đồ audit), `src/FE/Client/js/game/gameUiModel.ts` (đã có type `AccusationDraft` để tái dùng).

### Test

- Pure rules: propose → confirm → resolve; sửa proposal xóa confirmation; confirm với revision cũ bị từ chối; người thứ hai confirm hai lần chỉ tính một.
- Concurrency (Mongo cô lập): hai confirm đồng thời chỉ tạo **một** `GameResult` (exactly-once).
- Không rò rỉ: proposal của người này không lộ đáp án qua state của người kia trước khi vào trạng thái review.
- Playwright two-browser: A đề xuất → B thấy → B sửa → A xác nhận → kết quả.

### Done criteria

- [ ] Không thể kết thúc trận bằng một người khi `RequireConsensus=true`.
- [ ] Đúng một `GameResult` cho mỗi room dù spam confirm.
- [ ] V1/V2 case cũ vẫn chơi hết được.

---

## Plan 016 — Khóa trạng thái terminal của room

- **Ưu tiên:** P0 · **Effort:** S (0,5–1 ngày) · **Risk:** LOW
- Chi tiết đầy đủ: [`016-lock-room-terminal-transitions.md`](016-lock-room-terminal-transitions.md)

### Vì sao

Đã xác nhận lại từ code ở `af3da77`: `RequireLobby` (`RoomService.cs:360`) chỉ chặn `IN_PROGRESS`/`COMPLETED` nên `ABANDONED` lọt qua; `StartAsync` (`:298`) cũng vậy và sẽ ghi đè `GameplayState` bằng state mới; `LeaveAsync` (`:164`) gán thẳng `WAITING` không xét trạng thái cũ, tức là "hồi sinh" phòng terminal.

### Thiết kế

- Hàm thuần `RoomLifecycle.CanTransition(from, to)` liệt kê **toàn bộ** cặp hợp lệ; mọi transition khác ném lỗi coded.
- `WAITING`/`READY` là hai trạng thái duy nhất cho phép join/select-role/ready/start.
- `IN_PROGRESS → COMPLETED|ABANDONED` là một chiều; `COMPLETED`/`ABANDONED` là terminal tuyệt đối.
- Start dùng **atomic filter** (`UpdateOne` với filter status + version) thay vì đọc-rồi-ghi.

### Test

- Bảng test tham số hóa **mọi** cặp (from, to) — hợp lệ pass, còn lại reject.
- Race: hai lần start đồng thời chỉ một thành công.
- Room abandoned rồi gọi lần lượt join/ready/start/inspect → đều 400/409 với message ổn định.

---

## Plan 017 — Ledger chi phí AI, quota và circuit breaker

- **Ưu tiên:** P0 · **Effort:** L (3–4 ngày) · **Risk:** MED

### Vì sao

Pipeline AI đã bền vững (worker + lease + retry) nhưng **không đo tiền**. Một draft V3 đầy đủ gồm logic model + image model + cutout model + vision review; retry và regenerate nhân chi phí lên. Không có ledger thì không thể trả lời "một case tốn bao nhiêu USD" — câu hỏi đầu tiên của bất kỳ đánh giá thương mại nào, và cũng là rủi ro thật khi VIP được tự tạo case.

### Thiết kế

- Collection `aiUsageEvents`: `{ draftId, phase, provider, model, kind (TEXT|IMAGE|VISION), promptTokens, completionTokens, imageCount, unitPriceVersion, estimatedUsd, occurredAt, userId }`.
- Bảng giá versioned trong `Configurations/AiPricing.cs` (hằng số + version string). Không lấy giá từ provider lúc runtime; đổi giá = đổi version + migration note.
- Ghi usage ngay trong `AiOpenAiClient` — điểm duy nhất gọi provider, nên không sót đường.
- **Budget reservation**: trước khi bắt đầu một phase, ước tính chi phí; nếu vượt `AiBudget__PerUserDailyUsd` hoặc `AiBudget__ProjectDailyUsd` thì từ chối bằng lỗi coded `AI_BUDGET_EXCEEDED` (không queue).
- **Circuit breaker**: N lỗi provider liên tiếp trong cửa sổ T → mở mạch, các request mới trả `AI_PROVIDER_UNAVAILABLE` cho tới khi half-open thử lại.
- Admin dashboard: chi phí theo ngày/model/user, top draft đắt nhất, số lần chạm cap.

### Test

- Unit: tính USD đúng theo bảng giá, đúng version.
- Unit: reservation từ chối khi vượt cap; không tạo job.
- Unit: circuit breaker mở/half-open/đóng theo chuỗi lỗi mô phỏng.
- Integration: chạy pipeline ở chế độ `MOCK_AI_RESPONSES=true` → ledger vẫn ghi với `estimatedUsd = 0` và đánh dấu mock.

---

## Plan 018 — Cứng hóa phiên đăng nhập và security headers

- **Ưu tiên:** P0 · **Effort:** L (3–5 ngày) · **Risk:** MED-HIGH (chạm auth)
- **Gộp plan 011 đang TODO vào đây.**

### Phạm vi

1. **Token model**: refresh token per-device, lưu **hash** (không plaintext), có `family`, xoay vòng mỗi lần refresh, phát hiện tái sử dụng → thu hồi cả family. Endpoint `GET /api/auth/sessions` + `DELETE /api/auth/sessions/{id}`.
2. **OAuth**: Google callback trả **authorization code một lần** thay vì token trên URL; FE đổi code lấy token qua POST; dọn URL bằng `history.replaceState`.
3. **Rate limiter phân vùng** (plan 011): `PartitionedRateLimiter` theo IP **và** theo account cho login/register/email/refresh/reset, cộng budget riêng cho endpoint AI. Cấu hình forwarded headers + known proxies để `RemoteIpAddress` đúng sau reverse proxy.
4. **Security headers middleware**: HSTS, HTTPS redirection (bật theo môi trường), `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, CSP có nonce cho SPA.
5. **Password policy**: tối thiểu 10 ký tự, bỏ ép thành phần, chặn danh sách mật khẩu phổ biến.

### Ghi chú rủi ro

Đây là plan duy nhất trong P1 có thể làm hỏng đăng nhập của tất cả tài khoản hiện có. Bắt buộc:
- Migration cho refresh token cũ: chấp nhận token cũ trong N ngày (`Auth__LegacyRefreshGraceDays`), sau đó từ chối.
- Test hồi quy đầy đủ trước khi merge; không merge cùng ngày với plan gameplay khác.

### Test

- Reuse detection: dùng lại refresh token đã xoay → cả family bị thu hồi.
- Hai thiết bị đăng nhập song song không đá nhau ra.
- Rate limit: 6 login sai từ cùng IP bị chặn; IP khác không bị ảnh hưởng; cùng account từ 2 IP vẫn bị chặn theo partition account.
- Headers test: mọi response chứa đủ header bắt buộc; CSP không chặn Phaser/SignalR.

---

## Plan 019 — Save/resume trận và ghim revision của case

- **Ưu tiên:** P0 · **Effort:** M-L (2–3 ngày) · **Depends on:** 016

### Vì sao

Case đang chơi có thể bị admin republish giữa chừng → room đọc case đã đổi → soft-lock hoặc kết quả sai. Đồng thời một session 45–90 phút không có "chơi tiếp buổi sau" là rào cản retention lớn.

### Thiết kế

- **Immutable revision**: mỗi lần publish tạo `caseRevision` (số tăng dần) và snapshot bất biến; `gameRooms` lưu `caseId + caseRevision`; runtime luôn đọc theo revision đã ghim.
- **Resume**: room `IN_PROGRESS` quá `Room__IdleMinutes` không bị abandon ngay mà chuyển `PAUSED`; cả hai người quay lại → tiếp tục từ state đã lưu (state đã bền vững sẵn nhờ plan 008).
- Trang "Trận đang dở" trong `#/detective` liệt kê room có thể tiếp tục.

### Test

- Republish case khi room đang chơi → room không đổi nội dung, vẫn hoàn thành được.
- Pause → cả hai reconnect → state, clue, notebook, confrontation đang mở đều khôi phục đúng.

---

# GIAI ĐOẠN P2 — ACTIVATION & ONBOARDING

## Plan 020 — Invite link, QR và join bằng URL

- **Ưu tiên:** P1 · **Effort:** S-M (1–1,5 ngày) · **Risk:** LOW

Đây là feature rẻ nhất trong nhóm tác động cao. Hiện người chơi phải đọc mã 6 ký tự cho nhau.

### Thiết kế

- Route mới `#/join/:roomCode` tự điền mã và join khi đã đăng nhập; nếu chưa đăng nhập thì lưu ý định (`pendingJoin`) và tiếp tục sau khi login.
- Lobby có nút **Sao chép link**, **QR** (sinh client-side, không thêm dependency nặng — dùng canvas tự vẽ hoặc thư viện QR nhỏ), và nút chia sẻ Web Share API khi có.
- Backend: không đổi. Chỉ cần route FE + validate mã như hiện tại.

### Done criteria

- [ ] Dán link vào tab ẩn danh → đăng nhập → vào thẳng lobby đúng phòng.
- [ ] Mã sai/phòng đầy/phòng đã chơi → thông báo rõ, không kẹt màn trắng.

---

## Plan 021 — Prologue solo 8–12 phút với companion bot

- **Ưu tiên:** P0 cho activation · **Effort:** XL (6–8 ngày) · **Risk:** HIGH · **Depends on:** 013, 015

### Vì sao

Sản phẩm hiện đòi **đúng hai người online cùng lúc** mới học được cách chơi. Đây là rào cản cold-start lớn nhất theo audit. Prologue solo cho phép một người học vai, hiểu camera/evidence/crack, rồi mới rủ bạn.

### Thiết kế (chọn phương án rẻ nhất chứng minh được giá trị)

- **Không** làm AI đối thoại. Bot là **scripted partner**: một máy trạng thái phía server đóng vai còn lại, phản hồi theo kịch bản của case prologue (case riêng `case-prologue-*`, mechanicsVersion 3, đánh dấu `isTutorial=true`).
- Room tutorial được tạo với 1 người thật + 1 `BotParticipant`; bot "confirm" sau độ trễ có chủ đích, cung cấp đúng mảnh testimony mà vai kia cần.
- Bot chạy trong `TutorialBotService` được kích hoạt bởi cùng các sự kiện gameplay hiện có — **không** viết đường code gameplay song song.
- Kết quả tutorial **không** vào leaderboard/badge/workshop.

### Rủi ro và cách chặn

- Nguy cơ tạo nhánh logic thứ hai trong `GameplayService`: bắt buộc bot đi qua đúng các command API hiện có với một user ảo, không gọi thẳng vào internal state.
- Nếu sau 2 ngày thấy phải sửa lõi gameplay để bot chạy được → STOP, quay lại thiết kế.

---

## Plan 022 — Ping/đánh dấu manh mối trong game

- **Ưu tiên:** P1 · **Effort:** M (2 ngày) · **Depends on:** 013

Hiện hai người phải dùng Discord ngoài. Ping ngữ cảnh là cách rẻ nhất tăng giao tiếp mà không mở text/voice chat (kéo theo moderation).

- Investigator ping toạ độ trong scene → partner thấy marker + label ngắn theo whitelist ("Xem chỗ này", "Đã có bằng chứng", "Cần lời khai").
- Server validate: ping thuộc scene hiện tại của người gửi, rate limit 1 ping/2 giây, không kèm free text (tránh moderation).
- Ghi telemetry `PING_SENT` để đo tác động lên communication.

---

## Plan 023 — Host migration và tiếp tục sau ngắt kết nối

- **Ưu tiên:** P1 · **Effort:** M-L (2–3 ngày) · **Depends on:** 016, 019

- Quyền host trở thành **role-neutral**: người còn lại nhận quyền điều khiển tiến trình khi host mất kết nối quá grace period.
- Trạng thái "đồng đội mất kết nối" hiển thị rõ, kèm đếm ngược và lựa chọn: chờ / tạm dừng (→ plan 019) / kết thúc.
- Không tự abandon khi vẫn còn một người online.

---

## Plan 024 — Quick match / phòng công khai (opt-in)

- **Ưu tiên:** P1 · **Effort:** M (2–3 ngày) · **Depends on:** 020, 023

- Cờ `isPublic` trên room; danh sách phòng công khai đang chờ, lọc theo case/ngôn ngữ.
- Hàng đợi đơn giản: người chơi chọn case + vai mong muốn → ghép cặp đầu tiên khớp.
- Chỉ mở sau khi đã có ping (022) và host migration (023), nếu không ghép người lạ sẽ hỏng trải nghiệm.

---

# GIAI ĐOẠN P3 — CHẤT LƯỢNG CẢM NHẬN

## Plan 025 — Hệ thống âm thanh

- **Ưu tiên:** P1 · **Effort:** M-L (3 ngày)

Hiện **không có âm thanh nào**. Đây là khoảng trống cảm nhận lớn nhất so với chi phí bỏ ra.

- Lớp: ambience theo scene, SFX tương tác (mở ngăn kéo, chụp ảnh, mở khóa clue), sting khi crack đúng/sai, UI click.
- `AudioManager` dùng WebAudio, preload theo scene, tôn trọng `prefers-reduced-motion` không áp dụng nhưng phải có mute/volume riêng cho music/SFX/ambience và lưu vào settings.
- Asset: dùng thư viện CC0 có ghi nguồn trong `docs/`, không sinh bằng AI để tránh vấn đề bản quyền.

---

## Plan 026 — Trung tâm accessibility

- **Ưu tiên:** P1 · **Effort:** M-L (3 ngày)

- Text scale, high contrast, reduced motion, rebind phím, focus trap/return cho drawer và modal.
- Cây accessibility thay thế cho canvas Phaser: danh sách hotspot/NPC hiện có dưới dạng DOM ẩn, điều hướng được bằng bàn phím và đọc được bằng screen reader.
- Kiểm tra tương phản theo WCAG AA cho HUD chính.

---

## Plan 027 — Difficulty / assist mode và làm lại hint

- **Ưu tiên:** P1 · **Effort:** M (2 ngày) · **Depends on:** 013

- Ba mức: Casual (hint rẻ, timer rộng), Standard, Expert (không hint trực tiếp, chỉ gợi ý cấu trúc).
- Hint penalty hiện mơ hồ → chuyển thành quy tắc hiển thị được: "dùng hint tier 2 = -X điểm", hiện trước khi bấm.
- Điều chỉnh dựa trên số liệu từ 013 (tỷ lệ hint theo stage).

---

## Plan 028 — Asset manifest và đóng gói theo case

- **Ưu tiên:** P0 kỹ thuật · **Effort:** L (3–4 ngày)

`src/FE/public` đang **402 MB** và bị copy nguyên vào build. Đây là chặn thật cho mọi hình thức phát hành web.

- Sinh `asset-manifest.json` từ danh sách case **đã publish**; build chỉ copy asset được manifest tham chiếu.
- Chuyển PNG sang WebP/AVIF với fallback; đặt ngân sách kích thước cho từng loại asset và fail build khi vượt.
- Tải asset của case theo yêu cầu (khi vào lobby/case detail) thay vì tải hết lúc khởi động.
- Nền tảng cho CDN/object storage sau này: đường dẫn asset đi qua một hàm `resolveAssetUrl()` duy nhất.

---

## Plan 029 — Tách `gamePage.ts`, lazy Phaser, ngân sách bundle trong CI

- **Ưu tiên:** P1 · **Effort:** L (4 ngày) · **Depends on:** 028

- Tách `gamePage.ts` (4.075 dòng) theo bounded responsibility: `sceneRuntime`, `hud`, `caseFile`, `dialogue`, `confrontation`, `accusation`, `network`.
- **Viết characterization test (Playwright) trước khi tách** — audit đã cảnh báo refactor trước test là rủi ro.
- Lazy-load Phaser và runtime gameplay; đặt `build.rollupOptions` chia chunk; thêm bước CI fail khi chunk vượt ngưỡng.
- Bật TypeScript `strict` theo từng module đã tách, bắt đầu từ `network` và `session`.

---

## Plan 030 — Công cụ soạn/preview case cho admin

- **Ưu tiên:** P1 · **Effort:** XL (5–7 ngày) · **Depends on:** 019

Hiện sửa case = sửa JSON thô. Điều này khóa việc tạo nội dung vào tay người biết schema.

- Trình xem case dạng đồ thị: stage → scene → hotspot/dialogue → clue → confrontation, tô đỏ node không reachable.
- Sửa được các trường an toàn (text, objective, shortBio, vị trí hotspot) rồi validate qua đúng `CaseValidationService` hiện có.
- "Preview simulator": chạy thử một case bằng một người, bỏ qua ràng buộc 2 vai, chỉ dành cho admin, không ghi kết quả.

---

# GIAI ĐOẠN P4 — VẬN HÀNH & PHÁT HÀNH

| Plan | Nội dung | Effort |
|---|---|---|
| **031** | **Observability**: OpenTelemetry traces, structured logs với correlation ID (middleware đã có), RED metrics cho API/hub/Mongo/AI, error aggregation, SLO cơ bản | L |
| **032** | **CI/CD đầy đủ**: chạy Playwright trong CI (cache browser, artifact trace khi fail), bundle budget, `npm audit` + NuGet scan, build image, deploy staging tự động, rollback runbook | L |
| **033** | **Data lifecycle & privacy**: TTL cho rooms/action logs/evidence photos/AI logs, xuất dữ liệu và xóa tài khoản, chính sách lưu trữ, ghi nhận nội dung do AI tạo | M-L |
| **034** | **Moderation cho UGC/AI**: trạng thái nội dung, provenance, báo cáo/gỡ bỏ, hàng đợi duyệt thủ công — **bắt buộc trước khi mở creator công khai** | L |
| **035** | **Đóng gói desktop / Steam** (chỉ khi quyết định thương mại hóa): native shell, Steam auth/invite/overlay/cloud/achievements, hỗ trợ tay cầm | XL |

---

## 3. Ma trận ưu tiên nhanh

| | Nỗ lực thấp | Nỗ lực cao |
|---|---|---|
| **Tác động cao** | 013 telemetry · 016 lifecycle guard · 020 invite link · 022 ping | 015 accusation consensus · 017 AI cost · 018 auth · 021 prologue bot · 028 asset manifest |
| **Tác động vừa** | 027 difficulty · 023 host migration | 025 audio · 026 accessibility · 029 refactor · 030 case editor |

**Nếu chỉ có 2 tuần:** làm **013 → 016 → 015 → 020**. Bốn plan này khép lại rủi ro "một người kết thúc trận", "room hỏng chơi lại được", và mở được kênh mời bạn — đồng thời bắt đầu có dữ liệu để quyết định phần còn lại.

---

## 4. Phân công gợi ý cho 5 thành viên

| Người | Mảng phù hợp | Plan |
|---|---|---|
| A | Gameplay domain (BE) | 015, 016, 019 |
| B | AI pipeline & ops (BE) | 017, 031 |
| C | Auth/security & API (BE) | 018, 033 |
| D | Frontend gameplay (FE) | 020, 022, 029 |
| E | Frontend meta + tooling | 013 (dashboard), 025, 026, 030 |

Mỗi người tự viết plan file cho phần mình theo template rồi cập nhật `plans/README.md` trước khi code.

---

## 5. Rủi ro cần theo dõi

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Plan 018 làm hỏng đăng nhập toàn hệ thống | Cao | Grace period cho token cũ, merge riêng, test hồi quy đầy đủ |
| Plan 021 tạo nhánh gameplay thứ hai | Cao | Bot bắt buộc đi qua command API công khai; STOP sau 2 ngày nếu phải sửa lõi |
| Refactor 029 trước khi có characterization test | Cao | Viết test trước, tách sau — đúng cảnh báo trong `plans/README.md` |
| Thêm feature ngang trước khi có telemetry | Trung bình | 013/014 là cổng chặn cho P2 |
| Case V3 cũ không tương thích khi contract đổi | Trung bình | Mọi thay đổi contract phải additive + migration matrix + validator test |
| 402 MB asset chặn mọi deploy | Cao | 028 phải xong trước bất kỳ kế hoạch staging/public nào |

---

## 6. Cách bắt đầu một plan

```powershell
git checkout develop
git pull
git checkout -b feature/013-playtest-telemetry
# viết plans/013-persist-playtest-telemetry.md theo template plans/003-*.md
# code
dotnet build SirLocked.sln
dotnet test SirLocked.sln --no-build
cd src/FE; npm run typecheck; npm run build
# cập nhật plans/README.md, docs/<MSSV>/CHANGELOG.md, docs/<MSSV>/AI_AUDIT_LOG.md
```
