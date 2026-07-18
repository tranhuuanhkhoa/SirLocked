# SIRLOCKED — CORE GAMEPLAY FEASIBILITY AUDIT & IMPLEMENTATION PLAN

## Cách sử dụng

Dán toàn bộ prompt này cho AI có quyền đọc repository SirLocked. Thay `[REPOSITORY_PATH]` nếu cần.

---

# PROMPT BẮT ĐẦU

Bạn sẽ đóng vai một nhóm chuyên gia thống nhất gồm:

- Game Director chuyên game co-op và mystery/deduction.
- Lead Gameplay Designer.
- Co-op Systems Designer.
- Senior ASP.NET Core Backend Architect.
- Senior Frontend/Phaser Gameplay Engineer.
- Technical Game Designer phụ trách content schema và authoring workflow.
- QA Lead phụ trách state machine, multiplayer race condition và regression testing.
- Producer chuyên lập kế hoạch cho solo developer.

Bạn không được chia thành nhiều báo cáo rời rạc theo từng vai. Hãy tổng hợp thành một quyết định sản phẩm và kỹ thuật duy nhất, có bằng chứng từ project.

## Repository cần audit

```text
[REPOSITORY_PATH]
```

Nếu chưa được thay, sử dụng:

```text
D:\CODE\Final\prn232-su26-ai-audit-project-prn232_se18d07_group-01
```

## Bối cảnh sản phẩm

SirLocked là game trinh thám co-op hai người:

- **Investigator** thiên về quan sát không gian, camera, vật chứng, item, interaction và puzzle.
- **Interrogator** thiên về hỏi NPC, đọc lời khai, conversation và evidence challenge.
- Fantasy trung tâm: hai thám tử có năng lực và nguồn thông tin khác nhau phải phối hợp để phá lời nói dối và thay đổi giả thuyết điều tra.

Project đã có nhiều mechanic và case. Nhiệm vụ hiện tại **không phải tạo thêm case** và cũng không phải audit mức độ sẵn sàng phát hành.

Nhiệm vụ là trả lời một quyết định quan trọng:

> Có khả thi và đáng để chuyển core gameplay chung của SirLocked sang hướng “Crack the Lie” communication-first hay không?

Nếu khả thi, hãy lập kế hoạch triển khai chi tiết, chuyên sâu, có thể thực hiện bởi **một người làm 2–4 giờ mỗi ngày**.

## Hướng gameplay cần đánh giá — không được mặc định là đúng

Hướng đề xuất là một loop dùng chung cho mọi case:

```text
Investigator khám phá bằng chứng riêng
→ Interrogator thu lời khai riêng
→ hai người truyền đạt và diễn giải thông tin
→ Investigator đề xuất evidence
→ Interrogator đề xuất testimony fragment
→ cả hai xác nhận
→ hệ thống resolve contradiction
→ NPC phản ứng
→ giả thuyết điều tra thay đổi
→ hướng điều tra hoặc bí mật mới được mở
```

Tên làm việc của loop này là:

> **Crack the Lie**

Các thuộc tính mong muốn:

1. Mỗi vai sở hữu một phần thông tin thực sự riêng.
2. Role còn lại không nhận toàn bộ nội dung chỉ nhờ shared state tự động.
3. Việc trao đổi thông tin là một hành vi gameplay cần thiết, không chỉ là role-play tùy chọn.
4. Mỗi người đóng góp một nửa khác nhau vào contradiction.
5. Một người không thể đơn phương resolve contradiction hoặc chốt accusation quan trọng.
6. Kết quả đúng phải tạo payoff nhìn thấy được: lời khai bị phá, NPC đổi trạng thái, hypothesis thay đổi hoặc lead mới mở.
7. Kết quả sai phải tạo feedback có ý nghĩa, không chỉ hiện “wrong, try again”.
8. Hệ thống phải dùng lại được cho nhiều case và author được bằng data; không hard-code theo một case.
9. Dữ liệu role-private không được gửi đầy đủ xuống client rồi chỉ giấu bằng UI.
10. Phải xử lý được reconnect, retry, double-submit và hai người xác nhận ở thời điểm khác nhau.

Đây chỉ là **design hypothesis**. Không được bảo vệ nó bằng mọi giá. Hãy cố gắng tìm bằng chứng khiến hướng này:

- không phù hợp với SirLocked;
- quá đắt cho solo developer;
- phá hỏng flow hiện tại;
- làm tăng waiting hoặc friction;
- đòi authoring cost quá lớn;
- tạo technical debt;
- hoặc có một phiên bản nhỏ hơn đạt phần lớn giá trị với chi phí thấp hơn.

Chỉ chọn hướng này nếu bằng chứng sau audit vẫn ủng hộ nó.

---

# 1. NGUYÊN TẮC BẮT BUỘC

## 1.1 Phân loại bằng chứng

Mọi phát hiện quan trọng phải được gắn một trong bốn nhãn:

- **[Đã kiểm chứng từ code]**: chỉ dùng khi đã đọc file, type, method, contract hoặc test liên quan.
- **[Đã kiểm chứng khi chạy local]**: chỉ dùng khi đã build/test/chạy flow và quan sát kết quả.
- **[Suy luận thiết kế]**: suy luận hợp lý từ cấu trúc nhưng chưa có người chơi thật xác nhận.
- **[Chưa thể biết]**: project và dữ liệu hiện tại không đủ để kết luận.

Mọi kết luận về:

- fun;
- boredom;
- surprise;
- tension;
- emotional payoff;
- memorability;
- streamer reaction;
- chất lượng tranh luận;
- willingness to continue;

phải ghi:

> `Requires human playtest validation`

Không được biến code path hoặc automated flow thành bằng chứng cảm xúc người chơi.

## 1.2 Dẫn chứng source

Mỗi kết luận kỹ thuật quan trọng phải dẫn:

- đường dẫn file;
- class/function/type liên quan;
- line hoặc vùng code nếu công cụ cho phép;
- giải thích ngắn code đó chứng minh điều gì.

Không được chỉ liệt kê tên file mà không đọc nội dung.

Nếu tài liệu và code mâu thuẫn, ưu tiên theo thứ tự:

1. Behavior đã chạy local.
2. Test đang pass và code thực thi.
3. Source code hiện tại.
4. Case contract/JSON.
5. Documentation.
6. Comment cũ.

## 1.3 Giới hạn phạm vi

Chỉ tập trung vào những gì quyết định tính khả thi của core gameplay:

- game state và state transition;
- role permission và role-private projection;
- clue/testimony/dialogue/evidence challenge/deduction;
- shared state và information distribution;
- SignalR/gameplay synchronization;
- reconnect/idempotency/concurrency cần thiết cho dual confirmation;
- frontend gameplay flow và UI state;
- authoring contract, validator, AI case generation contract;
- compatibility/migration của case hiện có;
- testability;
- effort và rủi ro với solo developer.

Không được chuyển trọng tâm sang:

- Steamworks;
- deployment;
- monetization;
- cloud scaling;
- CSP/security header;
- observability platform;
- moderation;
- marketing;
- native packaging;
- analytics platform tổng quát;
- refactor không cần thiết cho loop đề xuất.

Chỉ nhắc đến một vấn đề ngoài phạm vi nếu nó là blocker trực tiếp của gameplay direction.

## 1.4 An toàn môi trường

Không sử dụng hoặc tạo MongoDB Atlas từ xa.

Không thực hiện bất kỳ thao tác nào trên production database hoặc dữ liệu người dùng hiện có.

Nếu cần chạy local:

1. Dùng MongoDB local hoặc Docker local.
2. Tạo database riêng, ví dụ `sirlocked_core_gameplay_feasibility_audit`.
3. Chỉ dùng tài khoản giả và email miền `.local`.
4. Không dùng OAuth thật, email thật, production API key hoặc external AI production call.
5. Dùng config audit riêng, không commit secret.
6. Không sửa source case JSON hoặc asset gốc.
7. Sau khi kiểm tra, chỉ drop đúng local audit database đã tạo.
8. Không chạy bất kỳ lệnh drop/delete nào trên Atlas.

Nếu không thể chạy an toàn, dừng ở static audit và ghi rõ phần chưa được kiểm chứng.

## 1.5 Worktree

- Kiểm tra `git status` trước khi làm.
- Không ghi đè thay đổi hiện có của người dùng.
- Audit này là read-only đối với source code, case data và asset.
- Có thể tạo một báo cáo mới trong `docs/` nếu được phép.
- Không tự implement direction trong lượt audit này.
- Không commit hoặc push.

---

# 2. CÂU HỎI QUYẾT ĐỊNH

Audit phải trả lời rõ, không né tránh:

1. Gameplay hiện tại có những thành phần nào đã gần với Crack the Lie?
2. Hiện tại “co-op” đến từ knowledge asymmetry thật hay chủ yếu từ role permission và sequential gate?
3. Một người có thể đọc gần như toàn bộ thông tin của người kia qua state/UI không?
4. Current gameplay contract có biểu diễn được private discovery, testimony fragment, paired proposal và dual confirmation không?
5. Backend có thể project state khác nhau theo caller mà không phá contract hiện tại không?
6. SignalR hiện phát full state, delta hay event gì; private payload cần thay đổi ở đâu?
7. Evidence challenge hiện tại có thể nâng cấp thành paired contradiction hay phải tạo subsystem mới?
8. Deduction hiện tại là suy luận thực sự, matching data, menu selection hay checklist gate?
9. Accusation có cần dual confirmation và nó dùng lại được infrastructure nào?
10. Frontend hiện có thể hiển thị private knowledge, pending partner choice và resolved shared knowledge không?
11. Existing case schema có đủ dữ liệu để author testimony fragments và evidence links không?
12. Validator và AI generation contract phải thay đổi bao nhiêu?
13. Case hiện có có thể migrate tự động, bán tự động hay phải viết lại thủ công?
14. Direction có làm tăng content authoring cost vượt khả năng solo developer không?
15. Có cách nhỏ hơn, ít rủi ro hơn nhưng đạt ít nhất 70–80% giá trị thiết kế không?
16. Trong 60–120 giờ làm việc, solo developer có thể tạo vertical slice đủ test không?
17. Điểm nào bắt buộc phải test với hai người thật trước khi mở rộng?

---

# 3. QUY TRÌNH AUDIT BẮT BUỘC

## Phase 0 — Inventory và scope map

Trước khi kết luận, hãy lập bản đồ các module liên quan:

- Room/gameplay models.
- Gameplay response DTO.
- Gameplay service/action handlers.
- Game controller/endpoints.
- SignalR hubs/events.
- Authentication/caller role lookup chỉ trong phạm vi gameplay.
- Frontend store/state synchronization.
- Phaser/game page/runtime.
- Case file/evidence/testimony/dialogue/deduction/accusation UI.
- Case models/schema.
- Case validation.
- AI case generation contract/prompts.
- Unit/integration/UI tests hiện có.

Xuất bảng:

| Layer | File/module | Trách nhiệm hiện tại | Liên quan tới direction | Mức cần thay đổi |
|---|---|---|---|---|

Không đề xuất kiến trúc mới trước khi hoàn thành inventory.

## Phase 1 — Reconstruct core gameplay hiện tại

Từ source code và contract, tái dựng chính xác loop hiện tại:

```text
Input/action
→ authorization
→ validation/gate
→ state mutation
→ persistence
→ response/event
→ state nhận bởi mỗi role
→ UI feedback
```

Làm riêng cho:

- camera clue;
- inspect/item/interaction;
- ask dialogue/conversation;
- present evidence/evidence challenge;
- deduction;
- scene completion;
- accusation.

Xuất bảng:

| Mechanic | Initiating role | Knowledge trước action | Mutation | Role kia nhận gì | Payoff | Có cần giao tiếp thật không? |
|---|---|---|---|---|---|---|

Với cột cuối, chỉ được kết luận cấu trúc. Cảm nhận thực tế phải ghi `Requires human playtest validation`.

## Phase 2 — Current loop vs target loop

So sánh từng bước:

| Target step | Hệ thống hiện có gần nhất | Reuse được | Cần sửa | Cần mới | Bằng chứng |
|---|---|---|---|---|---|

Target steps tối thiểu:

1. Role-private discovery.
2. Role-private testimony.
3. Notification không leak nội dung.
4. Deliberate share hoặc verbal relay.
5. Investigator evidence proposal.
6. Interrogator testimony-fragment proposal.
7. Pending state cho từng người.
8. Dual confirmation.
9. Conflict/change/cancel trước lock.
10. Server-authoritative resolution.
11. Wrong-attempt feedback.
12. NPC reaction state.
13. Hypothesis update/reversal.
14. Unlock downstream gameplay.
15. Resolved knowledge đi vào shared case file.
16. Reconnect và replay state.

## Phase 3 — Feasibility by subsystem

Chấm từng subsystem từ 0–5:

- `0`: gần như phải viết lại.
- `1`: rủi ro rất cao.
- `2`: khả thi nhưng tốn kém hoặc nhiều debt.
- `3`: khả thi với thay đổi đáng kể.
- `4`: phù hợp, reuse phần lớn.
- `5`: gần như đã hỗ trợ sẵn.

Subsystem bắt buộc:

- Domain model/state machine.
- Caller-specific state projection.
- Gameplay persistence.
- API command flow.
- SignalR privacy/routing.
- Reconnect/idempotency/concurrency.
- Investigator UI.
- Interrogator UI.
- Joint confirmation UI.
- NPC reaction/presentation layer.
- Case schema.
- Validator.
- AI generation pipeline.
- Existing case compatibility.
- Automated tests.
- Human playtest readiness.

Xuất:

| Subsystem | Score 0–5 | Bằng chứng | Reuse | Change | Risk | Effort range |
|---|---:|---|---|---|---|---|

Không cộng điểm giả tạo nếu các subsystem có trọng số khác nhau. Sau bảng, giải thích blockers quan trọng nhất.

## Phase 4 — Attempt to falsify

Trước khi đưa verdict GO, phải đưa ra ít nhất năm phản biện mạnh nhất:

| Phản biện | Bằng chứng ủng hộ | Mức nghiêm trọng | Có thể giảm rủi ro? | Cách kiểm chứng rẻ nhất |
|---|---|---|---|---|

Ít nhất phải xét:

- ép giao tiếp có thể biến thành friction;
- private information có thể gây mất phương hướng;
- người chơi không dùng voice/chat tích hợp;
- dual confirmation có thể tăng waiting;
- authoring paired clue/testimony quá tốn thời gian;
- generated content khó bảo đảm contradiction công bằng;
- existing cases bị break hoặc phải migrate lớn;
- repeated Crack loop có thể trở thành công thức lặp;
- presentation payoff có thể không đủ mạnh;
- một role vẫn có nhiều agency hơn role kia.

Không được trả lời các phản biện chỉ bằng ý kiến. Phải chỉ ra test hoặc prototype có thể xác nhận.

## Phase 5 — Minimum viable version

Nếu full direction quá lớn, hãy tìm **Minimum Viable Crack the Lie**.

So sánh tối đa ba phương án, nhưng cuối cùng phải chọn một:

1. **Minimal adaptation**: tận dụng evidence challenge hiện tại, thêm private projection và dual confirmation tối thiểu.
2. **Moderate redesign**: paired evidence/testimony proposal có state machine riêng.
3. **Full system**: hypothesis board, NPC reaction states, branching consequences và richer presentation.

Xuất:

| Option | Gameplay value hypothesis | Reuse | Effort | Migration cost | Debt risk | Playtest value |
|---|---|---|---:|---:|---|---|

Sau đó chọn đúng một phương án phù hợp nhất cho MVP và giải thích vì sao hai phương án còn lại chưa nên làm.

## Phase 6 — Technical design cho phương án được chọn

Thiết kế phải dựa trên code hiện có, không viết kiến trúc tưởng tượng tách khỏi repository.

### 6.1 Domain state machine

Đề xuất state transition cụ thể, ví dụ chỉ khi phù hợp:

```text
Unavailable
→ DiscoveredPrivately
→ EligibleForProposal
→ ProposedByInvestigator / ProposedByInterrogator
→ ProposedByBoth
→ ConfirmedByOne
→ ConfirmedByBoth
→ ResolvedCorrect | ResolvedIncorrect | Cancelled
```

Phải xác định:

- server invariants;
- ai được thực hiện transition nào;
- dữ liệu nào private/shared;
- version/concurrency rule;
- retry/idempotency behavior;
- disconnect/reconnect behavior;
- timeout có cần hay không;
- cancel/change proposal rule;
- wrong attempt có persist hay không;
- scene transition xử lý pending proposal thế nào.

### 6.2 Data contract

Đề xuất field/type cụ thể cho:

- private discoveries;
- testimony fragments;
- proposal state;
- per-player confirmation;
- contradiction result;
- NPC reaction;
- hypothesis mutation;
- shared archive sau resolution.

Không bắt buộc giữ tên gợi ý. Hãy dùng naming phù hợp convention hiện tại.

Phân loại từng thay đổi:

- Additive và backward-compatible.
- Breaking nhưng migrate được.
- Breaking và cần versioning.

### 6.3 Caller-specific projection

Chỉ rõ:

- nơi projection nên xảy ra;
- DTO nào cần tách hoặc thay đổi;
- field nào Investigator thấy;
- field nào Interrogator thấy;
- field nào shared;
- field nào chỉ shared sau resolution;
- làm sao tránh leak qua SignalR, endpoint phụ, evidence photo URL hoặc client case metadata.

### 6.4 API/command flow

Liệt kê command cần có hoặc cần mở rộng:

| Command | Caller | Preconditions | Mutation | Response | Realtime event |
|---|---|---|---|---|---|

Phải đánh giá có nên mở endpoint mới hay mở rộng endpoint hiện có.

### 6.5 SignalR/event routing

Chỉ rõ:

- event public cho room;
- event chỉ gửi một user/role;
- event notification không chứa secret;
- resync sau reconnect;
- stale client behavior;
- duplicate event behavior.

### 6.6 Frontend flow

Mô tả riêng cho hai vai:

```text
Idle/available
→ discovery/testimony
→ private review
→ proposal
→ waiting for partner
→ confirm/edit
→ resolution
→ payoff
→ updated objective
```

Với mọi màn hình/state, ghi:

- người chơi biết gì;
- quyết định gì;
- action khả dụng;
- feedback khi chờ;
- cách tránh spoiler;
- cách tránh một role trở thành spectator.

Không thiết kế UI pixel-perfect. Tập trung vào interaction contract và information hierarchy.

### 6.7 Presentation payoff

Đề xuất phiên bản MVP có chi phí thấp nhưng rõ ràng:

- pause/dim ngắn;
- juxtapose evidence và testimony;
- highlight contradiction phrase/detail;
- NPC portrait/reaction state;
- audio sting placeholder hoặc asset nhỏ;
- hypothesis card thay đổi;
- reveal lead mới;
- feedback đồng thời cho cả hai role.

Phân biệt:

- cần thiết để hiểu gameplay;
- polish có thể làm sau;
- giả thuyết cần human playtest.

## Phase 7 — Content authoring và migration

Đánh giá schema hiện tại có biểu diễn được loop không.

Đề xuất authoring contract tối thiểu cho một Crack chain:

- private physical evidence;
- private testimony fragment;
- semantic contradiction relation;
- accepted pairing;
- plausible wrong pair behavior;
- NPC response trước/sau;
- hypothesis before/after;
- downstream unlock;
- hint tiers;
- fallback để tránh soft-lock.

Xuất migration matrix:

| Content type hiện tại | Giữ nguyên | Map tự động | Cần author bổ sung | Không tương thích |
|---|---|---|---|---|

Phân loại case hiện có thành:

- chạy unchanged bằng legacy mode;
- migrate bán tự động;
- cần sửa thủ công;
- không nên migrate.

Không cần sửa từng case. Mục tiêu là xác định chiến lược versioning/migration cho gameplay chung.

Phải trả lời:

1. Có cần `gameplayVersion` hoặc capability flag không?
2. Có nên giữ legacy resolver trong giai đoạn chuyển đổi không?
3. Validator cần rule gì để ngăn impossible pairing, circular dependency và private-info leak?
4. AI case generator cần contract gì để tạo contradiction công bằng thay vì chỉ tạo matching ID?
5. Authoring cost mỗi chain ước lượng bao nhiêu và yếu tố nào làm cost tăng mạnh?

## Phase 8 — Test strategy

Lập test pyramid cụ thể.

### Unit/domain tests

Tối thiểu kiểm:

- role permission;
- private projection;
- proposal transition;
- change/cancel;
- dual confirmation;
- correct resolution;
- incorrect resolution;
- duplicate command;
- stale version;
- disconnect/reconnect;
- scene transition khi pending;
- no secret in wrong-role response;
- legacy case compatibility.

### Integration tests

Tối thiểu có hai caller/session độc lập và kiểm:

- mỗi role nhận state khác nhau;
- SignalR không leak secret;
- cả hai proposal đến theo thứ tự khác nhau;
- simultaneous confirm;
- retry sau network failure;
- resolution được nhìn thấy nhất quán;
- reload/reconnect phục hồi đúng state.

### UI tests

Tối thiểu kiểm:

- role-specific private card;
- partner notification không spoiler;
- proposal/edit/lock flow;
- waiting state có action rõ;
- confirm state;
- resolved presentation;
- keyboard/focus/basic accessibility;
- narrow viewport không che action quan trọng.

### Human playtest

Không được mô phỏng cảm xúc. Hãy viết protocol test với hai người thật nhằm đo:

- họ có truyền đạt chi tiết riêng không;
- một người có tự giải được không;
- số lần hỏi lại/clarify;
- active time từng role;
- thời gian chờ không có action;
- thời gian một Crack loop;
- số wrong pairing và nguyên nhân;
- comprehension sau resolution;
- hypothesis before/after;
- cả hai có cảm thấy mình đóng góp không.

Mọi ngưỡng metric là **target để kiểm chứng**, không phải bằng chứng hiện có.

## Phase 9 — Gameplay sandbox specification

Nếu verdict cho phép tiếp tục, hãy thiết kế một gameplay sandbox 8–12 phút, không cần narrative case hoàn chỉnh.

Sandbox tối đa gồm:

- một scene;
- một NPC chính;
- ba physical evidence;
- ba testimony fragments;
- một contradiction chính;
- một hypothesis reversal;
- một downstream reveal;
- một accusation/decision kết thúc.

Mục tiêu của sandbox là kiểm chứng system, không phải chất lượng văn học.

Xuất:

| Beat | Investigator biết/làm gì | Interrogator biết/làm gì | Dependency | Expected system feedback | Metric |
|---|---|---|---|---|---|

Chỉ rõ dữ liệu fixture nào cần tạo mới và dữ liệu nào có thể tái sử dụng. Không sửa asset/case gốc trong audit.

---

# 4. VERDICT BẮT BUỘC

Sau audit, chọn đúng một verdict:

## GO

Direction phù hợp với fantasy, reuse được phần lớn hệ thống, vertical slice khả thi trong 60–120 giờ và rủi ro có thể kiểm soát.

## GO WITH CONSTRAINTS

Direction khả thi nhưng chỉ nếu cắt scope hoặc thỏa một số điều kiện rõ ràng.

## NO-GO

Direction không phù hợp hoặc chi phí/rủi ro vượt giá trị ở giai đoạn hiện tại.

Không được dùng verdict mơ hồ như “có tiềm năng”.

Xuất verdict card:

| Mục | Kết luận |
|---|---|
| Verdict | GO / GO WITH CONSTRAINTS / NO-GO |
| Confidence | Cao / Trung bình / Thấp |
| Gameplay rationale | 1 đoạn ngắn |
| Technical rationale | 1 đoạn ngắn |
| Reuse estimate | Range, không giả chính xác |
| Vertical slice effort | Range giờ/ngày |
| Production migration effort | Range và assumptions |
| Biggest blocker | Một blocker |
| Cheapest falsification test | Một test |
| Decision gate | Điều kiện để tiếp tục |

Nếu verdict là NO-GO:

- Không lập roadmap triển khai full direction.
- Đề xuất một phương án nhỏ hơn dùng hệ thống hiện tại.
- Lập tối đa 10 ngày để kiểm chứng phương án đó.

Nếu verdict là GO hoặc GO WITH CONSTRAINTS, tiếp tục các phần dưới.

---

# 5. CHỌN DUY NHẤT PHẠM VI MVP

Phải chốt một scope duy nhất.

Xuất:

## MVP bao gồm

Liệt kê cụ thể các capability bắt buộc.

## MVP không bao gồm

Loại rõ những thứ như:

- voice chat tích hợp nếu không phải blocker;
- cinematic lớn;
- branching narrative phức tạp;
- generalized theory graph nếu paired contradiction đã đủ test;
- migrate toàn bộ case;
- rewrite gameplay service chỉ để đẹp kiến trúc;
- production telemetry platform;
- thêm case hoàn chỉnh;
- polishing không cần để hiểu loop.

## Definition of Done

Phải đo được và kiểm tra được, gồm:

- functional completion;
- privacy/no-leak;
- multiplayer consistency;
- reconnect;
- authorability;
- automated test;
- sandbox completion;
- human playtest readiness.

---

# 6. IMPLEMENTATION BACKLOG CHUYÊN SÂU

Lập backlog tối đa 20 epic/task có ROI cao nhất.

| Priority | Task | Player value | Technical purpose | Files/modules likely affected | Effort | Dependencies | Risk | Definition of Done | Verification |
|---:|---|---|---|---|---:|---|---|---|---|

Mỗi task phải:

- tạo giá trị trực tiếp cho core loop;
- cần thiết để vertical slice hoạt động;
- không hard-code theo case;
- không tạo đường tắt client-side gây debt;
- phù hợp solo developer;
- có test condition rõ;
- có phạm vi đủ nhỏ để hoàn thành trong 2–8 giờ, hoặc phải tách nhỏ hơn.

Không dùng task chung chung như:

- improve gameplay;
- refactor backend;
- optimize UX;
- add polish;
- improve co-op;
- add telemetry.

Phải gọi tên state, behavior hoặc interaction cần thay đổi.

---

# 7. ROADMAP 30 NGÀY CHO SOLO DEVELOPER

Giả định:

- một người;
- 2–4 giờ/ngày;
- 30 ngày làm việc;
- mỗi ngày chỉ 1–2 task;
- không làm song song hai task cùng sửa một contract chưa ổn định;
- ưu tiên vertical slice testable hơn độ hoàn thiện production;
- tối đa ba ngày code liên tục phải có một lần build/test hoặc flow verification;
- cuối mỗi tuần phải có decision gate.

Không nhồi đủ mọi backlog vào 30 ngày. Chỉ đưa những việc cần để trả lời liệu core loop mới có đáng tiếp tục hay không.

Xuất bảng từng ngày:

| Day | Objective | Task 1 | Task 2 nếu có | Estimated Time | Dependency | Deliverable | Verification | Stop/Rollback condition |
|---:|---|---|---|---:|---|---|---|---|

## Cấu trúc tuần bắt buộc

### Tuần 1 — Contract và proof of architecture

Mục tiêu gợi ý, phải điều chỉnh theo code thật:

- domain state machine;
- caller-specific projection proof;
- API/privacy test;
- quyết định versioning.

Cuối tuần phải trả lời:

> Có thể tạo private knowledge mà không rewrite hệ thống hoặc leak qua client không?

### Tuần 2 — Paired interaction end-to-end

Mục tiêu:

- proposal của hai role;
- dual confirmation;
- resolution;
- realtime/reconnect;
- automated two-session flow.

Cuối tuần phải trả lời:

> Hai client có thể hoàn thành một Crack loop ổn định không?

### Tuần 3 — Playable presentation và authoring

Mục tiêu:

- role UI;
- waiting/edit/confirm feedback;
- low-cost payoff;
- validator/fixture;
- sandbox 8–12 phút.

Cuối tuần phải trả lời:

> Một content designer/AI contract có thể author loop mà không hard-code không?

### Tuần 4 — Human validation và iteration

Mục tiêu:

- playtest với ít nhất ba cặp nếu có thể;
- ghi dữ liệu;
- sửa duy nhất bottleneck lớn nhất;
- retest;
- quyết định tiếp tục, thu nhỏ hoặc rollback.

Cuối tuần phải trả lời:

> Loop có thực sự tạo information sharing, joint reasoning và contribution từ cả hai role không?

Với mỗi tuần, thêm bảng:

| Mục | Nội dung |
|---|---|
| Hypothesis | Điều đang kiểm chứng |
| Build cần có | Phiên bản testable |
| Metrics | Tối đa 5 chỉ số |
| Keep condition | Điều kiện giữ thay đổi |
| Revise condition | Điều kiện cần chỉnh |
| Rollback condition | Điều kiện bỏ hướng |
| Roadmap adjustment | Việc thay đổi nếu kết quả khác giả định |

Không được tự điền kết quả playtest tương lai.

---

# 8. RISK REGISTER

Xuất tối đa 12 rủi ro quan trọng:

| Risk | Probability | Impact | Early signal | Mitigation | Contingency | Owner |
|---|---|---|---|---|---|---|

`Owner` mặc định là solo developer nhưng có thể ghi “human playtester” cho validation task.

Bắt buộc có:

- state leak;
- race/double-confirm;
- reconnect inconsistency;
- legacy case breakage;
- authoring explosion;
- one-role waiting;
- forced communication friction;
- no integrated comms;
- repeated loop fatigue;
- insufficient payoff;
- scope creep;
- oversized refactor.

---

# 9. TESTABLE SUCCESS CRITERIA

Tách thành ba nhóm.

## Technical success

Ví dụ, chỉ giữ nếu phù hợp code:

- Wrong role không thể lấy private payload qua API/SignalR.
- Duplicate command không tạo hai resolution.
- Reconnect phục hồi proposal/confirmation nhất quán.
- Legacy flow vẫn chạy hoặc bị route rõ qua version.
- Một fixture mới author được mà không sửa gameplay code.

## Structural gameplay success

- Cả hai role cung cấp input khác loại.
- Không một role nào resolve chain một mình.
- Resolution thay đổi game state có ý nghĩa.
- Mỗi role có objective/action rõ trong mọi phase.
- Full information chỉ shared theo rule đã định.

## Human validation targets

Các mục sau chỉ là target:

- Người chơi trao đổi ít nhất một chi tiết độc quyền trước khi resolve.
- Cả hai giải thích được vì sao evidence mâu thuẫn testimony.
- Active contribution không lệch quá lớn giữa hai role.
- Waiting không có hành động hoặc suy luận không kéo dài quá ngưỡng playtest quyết định.
- Hypothesis sau Crack khác hypothesis trước Crack.

Ghi `Requires human playtest validation` cho toàn bộ nhóm này.

Không tự đặt ngưỡng phần trăm chính xác nếu không giải thích lý do. Có thể đề xuất ngưỡng ban đầu dưới dạng hypothesis.

---

# 10. DANH SÁCH NHỮNG VIỆC KHÔNG NÊN LÀM

Từ codebase thực tế, liệt kê tối đa 10 việc hấp dẫn nhưng ROI thấp hoặc làm sai thứ tự.

Ví dụ:

- tạo thêm full case trước khi chứng minh loop;
- làm private state chỉ bằng CSS/frontend filtering;
- rewrite toàn bộ GameplayService trước prototype;
- xây voice chat trước khi test cùng phòng/Discord;
- tạo theory board tổng quát quá sớm;
- migrate mọi case trước khi sandbox pass;
- thêm timer để giả tạo tension;
- dùng animation/cinematic để che logic chưa rõ;
- thêm analytics platform thay vì log test tối thiểu;
- cân bằng bằng số action mà không đo agency/contribution.

Mỗi mục phải giải thích ngắn gọn lý do và thời điểm thích hợp để xem xét lại.

---

# 11. OUTPUT CUỐI CÙNG

Tạo báo cáo:

```text
docs/CORE_GAMEPLAY_FEASIBILITY_AUDIT_VI.md
```

Nếu không được phép ghi file, xuất toàn bộ trong câu trả lời.

Báo cáo phải theo đúng thứ tự:

1. Executive decision.
2. Evidence and confidence rules.
3. Current gameplay architecture map.
4. Current loop reconstruction.
5. Current vs target gap map.
6. Feasibility matrix.
7. Attempt-to-falsify findings.
8. GO / GO WITH CONSTRAINTS / NO-GO verdict.
9. Selected MVP scope.
10. Technical design.
11. Content contract and migration strategy.
12. Test strategy.
13. Gameplay sandbox specification.
14. Detailed implementation backlog.
15. 30-day solo roadmap.
16. Weekly decision gates.
17. Risk register.
18. Success criteria.
19. Do-not-do list.
20. Final next action.

## Phần kết thúc bắt buộc

Kết thúc bằng đúng cấu trúc:

### Verdict

GO, GO WITH CONSTRAINTS hoặc NO-GO.

### Tại sao

Tối đa 200 từ, dựa trên code và effort.

### Phạm vi MVP đã chọn

Một đoạn cụ thể, không đưa nhiều lựa chọn ngang nhau.

### Việc duy nhất phải làm ngày mai

Một task hoàn thành được trong 2–4 giờ, có file/module dự kiến, Definition of Done và cách verify.

### Điều phải chứng minh sau 7 ngày

Một technical/gameplay architecture gate.

### Điều phải chứng minh sau 30 ngày

Một human-playtest/product gate; ghi `Requires human playtest validation`.

### Khi nào phải bỏ hoặc thu nhỏ hướng này

Các stop condition rõ ràng.

Không kết thúc bằng lời khen chung chung.

Không nói “game có tiềm năng” mà không chỉ ra code path, mechanic và validation gate cụ thể.

# PROMPT KẾT THÚC
