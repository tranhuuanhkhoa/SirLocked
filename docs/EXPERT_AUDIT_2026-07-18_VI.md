# SIRLOCKED — BÁO CÁO AUDIT SẢN PHẨM, KỸ THUẬT VÀ KHẢ NĂNG THƯƠNG MẠI

**Ngày audit:** 18/07/2026  
**Phạm vi:** gameplay, UX/UI, frontend, backend, MongoDB, SignalR, AI pipeline, prompt/schema/validation, tài sản hình ảnh, kiểm thử, LiveOps, tài liệu, roadmap và khả năng phát hành Steam.  
**Góc nhìn:** Creative Director AAA, Game Designer, Technical Director, PM, UX/UI, Backend Architect, LiveOps, QA, tư vấn indie và nhà đầu tư.

---

## 1. Kết luận điều hành

SirLocked **đã là một functional vertical slice đáng kể**, không còn là prototype giấy. Hai người có thể đăng nhập, tạo/join phòng, chọn hai vai khác nhau, đồng bộ trạng thái qua SignalR, khám phá cảnh, điều tra vật phẩm, chụp manh mối, đối thoại, trình bằng chứng, giải puzzle/deduction, dùng hint và đưa ra cáo buộc cuối. Hệ thống AI có nhiều tầng hơn mặt bằng đồ án: story preview, full logic, scene layout, assets, visual QA, deterministic validation, checkpoint và publish gate.

Tuy nhiên, đây **chưa phải sản phẩm có thể đưa lên Steam một cách an toàn**. Khoảng cách lớn nhất không nằm ở việc “thêm một cơ chế gameplay nữa”, mà ở độ tin cậy vận hành, activation của đúng hai người chơi, chất lượng/đồng nhất nội dung, bảo mật phiên đăng nhập, chi phí AI, UX onboarding, âm thanh, đóng gói desktop/Steamworks và khả năng đo lường hành vi người chơi.

**Phán quyết ngắn:**

- **MVP chức năng:** khoảng **81%**.
- **Production-ready web beta:** khoảng **58%**.
- **Steam commercial readiness:** khoảng **41%**.
- **Overall:** **62/100**.
- **Quyết định phát hành hôm nay:** **No-Go** cho paid Early Access; **Go có điều kiện** cho closed alpha 50–200 cặp người chơi.
- **Quyết định đầu tư:** chưa đầu tư ngay; cân nhắc pre-seed theo milestone sau khi có một vertical slice 30–45 phút được curate, onboarding hoàn chỉnh, cost cap AI và dữ liệu playtest/retention thật.

Điểm mạnh khó sao chép nhất là **trinh thám co-op bất đối xứng kết hợp không gian khám phá, camera clue và đối chất bằng chứng**, cộng với pipeline AI có validation. Điểm yếu nguy hiểm nhất là sản phẩm đòi đúng hai tài khoản online nhưng chưa có solo fallback/matchmaking đủ mạnh; nếu không giải quyết activation, nội dung hay đến đâu cũng khó tạo doanh thu.

---

## 2. Phạm vi và phương pháp kiểm chứng

Audit đã lập bản đồ toàn repo, đọc các tài liệu sản phẩm/kỹ thuật, schema, API, gameplay flow, AI pipeline, testing/deployment/NFR, kiểm tra các controller/service/model/DTO/middleware/hub và các luồng frontend chính. Tài sản hình ảnh được kiểm tra theo contact sheet và nhiều nhóm đại diện: backgrounds, character portraits/sprites, item cutouts, runtime compositing và ảnh chụp gameplay. Các dependency/build artifact được thống kê, không coi mã thư viện bên thứ ba là mã sản phẩm cần review từng dòng.

Đã chạy kiểm chứng:

- Backend: **237/237 tests pass**, 0 skipped.
- Frontend: `typecheck` pass, production build pass.
- UI smoke: **10/10 Playwright tests pass** ở mobile và các viewport desktop 1366×768, 1440×900, 1920×1080.
- `npm audit --omit=dev`: **0 vulnerability**.
- NuGet vulnerability scan gồm transitive dependency: **không phát hiện package dễ tổn thương**.
- Chạy API + Vite + MongoDB thật; đăng nhập admin thành công, dashboard trả dữ liệu thật, danh sách hiện **9/15 case published**, 90 users, 123 rooms.
- Production frontend output hiện có **482 files / 368,24 MB**; phần lớn là PNG trong `public` bị copy nguyên vào build.
- Gameplay chunk: khoảng **1.757 KB minified / 404,5 KB gzip**, vượt cảnh báo 500 KB của Vite.

Một số tài liệu mô tả trạng thái cũ (Deepseek/mock fallback hoặc nhiều feature “out of scope”), trong khi code hiện tại đã chuyển sang OpenAI-only và đã có workshop, review, leaderboard, badge, weekly challenge, camera, puzzle, deduction, conversation branching. Trong audit này, **code chạy được và test hiện tại là nguồn sự thật cao nhất**; tài liệu chỉ là nguồn bổ trợ.

---

## 3. Tóm tắt sản phẩm

### Thể loại và fantasy

Game trinh thám co-op online 2 người, góc nhìn 2D/chibi Victorian. Một người là **Investigator** thiên về di chuyển, quan sát, vật phẩm, camera và puzzle; người còn lại là **Interrogator** thiên về hội thoại, đọc mâu thuẫn và đối chất bằng chứng. Fantasy chính là “hai thám tử có năng lực khác nhau phải ghép thông tin để phá án”.

### Core loop

1. Chọn case → tạo/join phòng bằng mã.
2. Hai người chọn hai vai riêng biệt → ready → host start.
3. Di chuyển trong scene, tương tác hotspot/NPC, mở clues/items/dialogues.
4. Hai vai chia sẻ phát hiện, hoàn thành chain/puzzle/deduction, mở scene kế tiếp.
5. Ghép culprit + motive + method + evidence links.
6. Nhận verdict, score/rank; kết quả đi vào profile/leaderboard/badge/workshop.

### Đối tượng

- Người chơi co-op/puzzle/mystery 16–35 tuổi.
- Cặp bạn bè/couple muốn session 25–90 phút.
- Streamer/YouTuber thích tranh luận, suy luận và khoảnh khắc “aha”.
- Người dùng EN/VI; hiện UI có i18n hai ngôn ngữ nhưng content locale và độ bao phủ bản dịch chưa đồng đều.

### USP

- Hai vai bất đối xứng có nhiệm vụ khác nhau, không chỉ hai avatar giống nhau.
- Camera clue biến background thành không gian điều tra thay vì gallery tĩnh.
- Đối chất NPC bằng evidence và accusation nhiều thành phần.
- AI authoring có staged approval, strict schema, deterministic validator và visual QA.

### Khác biệt so với game cùng nhóm

SirLocked đứng giữa narrative detective, escape-room co-op và AI-authored UGC. Điểm khác biệt không phải “game dùng AI”, mà là **AI tạo nội dung đi qua contract có thể chơi được**. Đây là định vị tốt hơn nhiều so với chatbot mystery thuần văn bản. Dù vậy, trải nghiệm vẫn cần chứng minh rằng hai vai tạo ra giao tiếp thật, chứ không chỉ chia hai danh sách thao tác cho hai người.

### Tiến độ thực tế

- **Đã có:** auth, email verify/reset, Google OAuth, roles, room lifecycle, reconnect grace, SignalR, gameplay V2, AI creator, validation/import/publish, workshop/reviews/leaderboards/badges/weekly, profile, EN/VI UI, backend/unit/rule tests, API smoke và UI smoke.
- **Chưa đủ thương mại:** solo/matchmaking, accusation consensus, server-authoritative proximity, production AI job orchestration/cost controls, analytics, audio, accessibility đầy đủ, native packaging/Steamworks, cloud save/achievements, moderation/legal, deployment/backup/observability và một bộ case curate đã playtest.

---

## 4. Bảng điểm

| Hạng mục | Điểm | Nhận định |
|---|---:|---|
| Gameplay | **6,7/10** | Nhiều cơ chế đã nối thành loop; asymmetry và co-op communication chưa được chứng minh bằng telemetry/playtest, accusation một người có thể kết thúc game. |
| UI/UX | **6,2/10** | Art direction và scene-first HUD có cá tính; onboarding, hierarchy, text density, canvas accessibility, toast/label overlap và mobile movement còn vấn đề. |
| Technical | **6,6/10** | Backend authoritative cho state, optimistic concurrency và test suite tốt; nợ lớn ở lifecycle edge cases, security, scale-out, data retention, observability và lớp frontend lỏng type. |
| AI | **7,3/10** | Pipeline staged + schema + validation + visual QA là điểm mạnh; chưa có queue/lease recovery, idempotency đồng nhất, USD budget/quota và human content QA. |
| Business | **4,2/10** | Có nền móng LiveOps/community nhưng chưa có distribution, monetization, CAC/retention data, packaging hay giải pháp cold-start hai người. |
| Innovation | **7,7/10** | Kết hợp co-op role asymmetry, spatial clue camera và AI contract khá mới, dễ pitch. |
| Commercial potential | **5,6/10** | Có trailer hook tốt, nhưng activation, content trust, art consistency và Steam readiness làm rủi ro cao. |
| **Overall** | **62/100** | Vertical slice mạnh về phạm vi; cần một vòng “productization” nghiêm túc thay vì tiếp tục mở rộng feature ngang. |

---

## 5. Audit Gameplay

### Điều đang làm tốt

- Server giữ trạng thái điều tra và kiểm tra role/current scene/requirements; client không tự quyết định clue chính thức.
- Cơ chế Investigator đã có inspect, inventory, combine/use, camera, puzzle; Interrogator có dialogue, conversation branching và evidence challenge.
- Per-player scene ID cho phép hai người tách nhau điều tra; SignalR gửi discovery/state/presence gần realtime.
- Puzzle, deduction, teamwork chain, hint tier, score/rank và accusation V2 tạo đủ vật liệu cho một case hoàn chỉnh.
- Idempotency ở nhiều action và optimistic version giúp hạn chế double-click/double-submit.

### Vấn đề thiết kế

- Bất đối xứng chưa cân bằng nhịp: Investigator thường có nhiều thao tác không gian hơn; Interrogator dễ chờ trong đoạn đầu nếu clue mở dialogue chưa xuất hiện.
- “Co-op” chủ yếu là shared state và chain tuần tự. Thiếu các khoảnh khắc đồng thời/trao đổi thông tin mà một người thực sự không thể tự đọc từ UI hoặc devtools.
- Một thành viên có thể gửi accusation và kết thúc toàn trận; không có draft/confirm của đồng đội.
- Camera hit dùng `captureRect` do client gửi. Ảnh được lưu, nhưng backend không dùng pixel của ảnh để xác minh vị trí; API caller có thể giả rectangle. Runtime clue zones cũng đi xuống client, làm lộ tọa độ cho devtools.
- Pose realtime do client quyết định; hub chỉ clamp 0–5000 và không đối chiếu scene/walkable area. Các endpoint gameplay kiểm current scene nhưng không kiểm khoảng cách vật lý đến hotspot.
- Near-miss camera cho phản hồi định hướng nhưng không tăng miss count, có thể được dùng để dò miễn phí.
- Scene completion contract chỉ biểu diễn item/clue/dialogue trực tiếp. Puzzle/deduction/interaction phải vòng qua unlock khác, làm authoring khó hiểu và hạn chế thiết kế.
- Mobile dock chỉ trái/phải dù desktop runtime hỗ trợ trục X/Y và collision; trải nghiệm mobile không tương đương.

### Đề xuất gameplay

Ưu tiên “communication-first”: mỗi stage nên có ít nhất một information split, một action phụ thuộc vai kia và một checkpoint phối hợp. Accusation phải có cơ chế đề xuất → đồng đội xác nhận/chỉnh → khóa lựa chọn. Tách score preview thành các quy tắc dễ hiểu; bổ sung difficulty/assist mode thay vì để hint penalty mơ hồ. Không thêm cơ chế mới trước khi playtest chứng minh mỗi vai có thời lượng active tương đương trong khoảng ±15%.

---

## 6. Audit UX/UI

### Điều đang làm tốt

- Visual identity dark navy/brass/gaslight rõ ràng; card case và dashboard có cảm giác sản phẩm, không còn mặc định framework.
- Scene-first revision đã giảm modal blocking; discovery card có `aria-live`, case file/inventory/map tách drawer và có mobile controls.
- UI smoke kiểm canvas, mobile actions, keyboard Escape/A-D, i18n, presence event, accusation/result overflow và nhiều desktop viewport.
- Các chuỗi từ API phần lớn đi qua `escapeHtml`, giảm đáng kể nguy cơ DOM injection.

### Vấn đề UX

- Navigation admin quá dày và trộn khu vực player/admin; ở chiều cao thấp, hierarchy khó quét.
- Nhiều typography nhỏ, serif mảnh trên nền tối; độ đọc giảm khi stream/compress hoặc trên màn hình 13 inch.
- Tên NPC, prompt, badge và toast có thể chồng nhân vật/cảnh; inventory/hint/toast cạnh tranh không gian với gameplay.
- Case cards chứa summary dài không đồng đều, làm card cao và khiến quyết định chọn case chậm.
- Canvas không có semantic alternative đầy đủ; keyboard có nhưng focus order, screen reader, reduced motion, high contrast và remap chưa thành hệ thống.
- Login/OAuth, email verification và đúng hai người chơi tạo quá nhiều bước trước “fun in first five minutes”.
- UI EN/VI tồn tại, nhưng nhiều chuỗi gameplay/admin/workshop vẫn hard-coded một ngôn ngữ hoặc trộn locale.
- Không có audio/settings/accessibility hub, vì vậy người dùng không biết có thể chỉnh gì.

### Đề xuất UX

Thiết kế lại first-run theo một prologue 8–12 phút có bot companion, sau đó mới yêu cầu mời bạn. Tạo HUD budget cố định: objective + co-op presence ở top, một context action, một discovery queue; không để nhiều toast xếp tầng. Chuẩn hóa type scale tối thiểu 14–16 px, contrast, safe area và label collision. Case catalog nên có filters, difficulty, role complexity, completion/ratings và summary 2–3 dòng.

---

## 7. Audit Technical

### Kiến trúc hiện tại

- ASP.NET Core .NET 9 controller API; JWT + Google OAuth; middleware trạng thái user; MongoDB; SignalR.
- Frontend Vite SPA hash-router, JavaScript/TypeScript; Phaser 4 cho scene renderer.
- Case/gameplay state chủ yếu nằm trong MongoDB; asset ảnh ở static public path; AI gọi OpenAI qua `HttpClient`.

### Điểm tốt

- Ranh giới controller/service/DTO/model đủ rõ ở đa số module.
- Deterministic validation và state rules có test riêng; result snapshot có recovery nếu ghi result document lỗi sau khi room completed.
- Mongo index cho email/caseId/room code/result/review; health endpoint có liveness/readiness.
- CORS dùng allowlist; Swagger bị giới hạn ngoài Development; secrets mẫu không chứa key thật.
- Error envelope, correlation ID, optimistic state version và cache case là những nền tảng đúng hướng.

### Nợ kỹ thuật/rủi ro

- `RoomService.RequireLobby` chỉ chặn IN_PROGRESS/COMPLETED; ABANDONED có thể chọn role/ready rồi START lại và ghi đè failed state.
- `AiCaseService` 4.121 dòng, `gamePage.ts` 3.808 dòng, `GameplayService` 1.669 dòng, validator 1.496 dòng: blast radius cao và review khó.
- Một số đường AI approval có compare-and-set claim, nhưng Continue/Regenerate/Retry gọi generation trực tiếp; request đồng thời có thể nhân đôi OpenAI cost và file writes.
- AI chạy trong HTTP request với timeout cực dài; không có durable queue, worker lease, heartbeat/reclaim hoặc cancellation đúng nghĩa.
- Gameplay mutation replace toàn bộ room document; action log tăng vô hạn. Khi state/log lớn, write amplification và giới hạn document sẽ trở thành vấn đề.
- SignalR process-local, không backplane; cache case cũng process-local, dễ stale khi scale nhiều instance.
- TypeScript `strict: false`, `checkJs: false`; phần lớn frontend `.js` không được typecheck thực sự.
- CI chưa chạy `npm run test:ui`; Mongo CI 8.0 trong khi compose/dev dùng 7, tạo environment drift.
- Không có distributed tracing, metrics, error aggregation, SLO, production Docker image, backup/restore drill hay load test.
- Build frontend copy toàn bộ public assets: 368 MB; asset không được route theo case, resize/WebP/AVIF/CDN hay content manifest.

---

## 8. Audit Art Direction

### Điểm mạnh

- Palette teal/sepia/brass/oxblood và mood Victorian khá nhất quán ở background; nhiều cảnh có chất lượng key art tốt, ánh sáng và chiều sâu hấp dẫn.
- Case covers nhìn tốt trong catalog, có khả năng tạo thumbnail/trailer hook.
- Prompt contract đã cố định camera, palette, outline, pixel density, character proportion và cấm text/photorealism.

### Vấn đề

- Background, portraits, NPC sprites và canonical player sheets chưa cùng một “pixel grammar”: mức chi tiết, tỷ lệ đầu/thân, độ sắc, outline và ánh sáng khác nhau.
- Nhiều NPC có cấu trúc mặt gần nhau; silhouette/outfit variety thấp, dễ tạo cảm giác “AI-generated cast”.
- AI background vẫn sinh pseudo-text/biển chữ dù contract cấm; điều này vừa phá immersion vừa có thể gây rủi ro visual QA.
- Sprite scale/compositing trong scene đôi lúc quá nhỏ hoặc lệch perspective/lighting; cutout edge nổi trên background.
- Item asset có trường hợp không phản ánh đúng bản chất vật thể lớn/embedded mechanism.
- Chưa có audio direction; một game mystery không có ambience, footsteps, UI cues, clue sting và voice texture sẽ thiếu rất nhiều cảm giác cao cấp.

### Đề xuất art pipeline

Khóa một art bible với 10–15 golden references; tạo automated checks cho kích thước/alpha/palette/text OCR và human art QA rubric. Chỉ ship asset thuộc case published, chuyển scene sang WebP/AVIF hoặc texture format phù hợp, tạo thumbnail riêng. Dành ngân sách sửa tay cho player characters, NPC hero cast, covers và ba cảnh trailer; AI dùng cho breadth, artist dùng cho identity.

---

## 9. Audit AI System

### Điểm mạnh

- Pipeline nhiều cổng duyệt: story → full logic → scene layout → final assets → publish.
- Strict JSON schema, contract theo preset, deterministic validator, auto-repair, saved invalid checkpoint, visual QA và failed-asset regeneration.
- Prompt lưu version/schema, generation attempts có input/output token cho text calls; có dry-run/planned calls.
- Case validation kiểm ID links, reachability, evidence, stage order, visual-safe metadata và nhiều quy tắc gameplay V2.

### Rủi ro

- `AiCostReport` hiện chỉ phản ánh dry-run/planned calls; không tổng hợp USD, image units, vision usage hoặc budget còn lại.
- Không quota theo user/day/case, không hard spending cap và không circuit breaker khi provider tăng lỗi/latency.
- Idempotency claim không bao phủ mọi Continue/Retry/Regenerate path.
- Không durable job queue; process crash có thể để draft ở GENERATING vô hạn.
- Human approval tập trung ở stage gate, nhưng chưa có rubric về mystery fairness, prose quality, cultural safety, repetition và “fun per role”.
- Ba JSON case mẫu đều để trống `shortBio` cho toàn bộ nhân vật và `objective` cho toàn bộ stage; schema pass không đồng nghĩa content rich.
- Tài sản AI và case UGC chưa có provenance, moderation queue, takedown, prompt abuse controls, policy version và audit trail phục vụ thương mại.

### Kết luận AI

Đây là phần kỹ thuật khác biệt nhất của dự án, nhưng cần được chuyển từ “pipeline gọi API mạnh” thành **content production system có ngân sách, job orchestration và quality operations**. Không nên quảng bá “vô hạn case”; nên bán “case được AI hỗ trợ và kiểm duyệt”.

---

## 10. Audit Content System

Case contract hiện đủ phong phú: 2–6 stages/scenes, characters, items, clues, dialogues, conversations, evidence challenges, puzzles, deductions, teamwork chains, hints và final logic. Ba sample JSON có quy mô từ 15 đến 90 phút; Blackglass có 6 scenes, 5 characters, 12 clues, 12 dialogues, 3 puzzles, 2 deductions và 2 teamwork chains.

Vấn đề là **độ dài khai báo chưa được chứng minh bằng thời gian chơi thật**. “90 phút” có thể là 35 phút đọc nhanh hoặc 120 phút mắc kẹt. Content validator chứng minh tính liên kết logic, không chứng minh mystery fair, clue readable, không lặp mô-típ, nhịp cảm xúc tốt hoặc hai vai đều vui. Cần telemetry theo stage và playtest rubric: time-to-first-clue, idle time từng vai, hint tier, fail reason, contradiction comprehension, accusation confidence và perceived fairness.

Đề xuất trước public beta: curate tối thiểu 3 case — một onboarding 12 phút, một flagship 35–45 phút, một advanced 60 phút — với 20+ cặp playtest/case và ít nhất hai vòng rewrite.

---

## 11. Audit Multiplayer

### Hiện có

- Room code, 2 slots, unique roles, ready/start, host, presence, reconnect grace 30 giây, per-player scenes, SignalR pose/state notification và abandon khi teammate mất kết nối quá grace.

### Thiếu/rủi ro

- Không quick match/public lobby/invite link/deep link; activation phụ thuộc người chơi tự điều phối mã phòng.
- Không host migration khi trận đang chạy; chỉ host mới abandon sau disconnect của teammate.
- Established SignalR connection cache `RoomPlayer` trong `Context.Items`; membership/role thay đổi bên API có thể không phản ánh ngay.
- Pose scene không đối chiếu room state, không server rate limit; client có thể spam hoặc gửi scene/position giả.
- Không Redis/Azure SignalR backplane; nhiều instance sẽ làm nhóm room và cache không nhất quán.
- Không voice/text/ping system trong game; một game dựa vào giao tiếp lại yêu cầu người dùng mở Discord bên ngoài.
- Không spectator/streamer mode, replay/shareable case result hoặc anti-spoiler controls.

---

## 12. Audit Business Model và LiveOps

Workshop, review, leaderboard, badges và weekly feature là nền tốt cho retention. Tuy nhiên chúng đang là feature surface, chưa phải hệ vận hành LiveOps: không segment, remote config, experiments, cohort retention, scheduled content calendar, moderation SLA hay economy/monetization.

### Mô hình phù hợp nhất

Khuyến nghị **premium base game + curated case packs**, không đặt AI generation trực tiếp làm unlimited entitlement ngay từ đầu.

- Base game: 3–5 case curate + tutorial + co-op/solo companion.
- Free demo: prologue 12–15 phút có bot hoặc local invite friction thấp.
- Paid DLC/case packs theo mùa; workshop case được moderation và có badge “curated”.
- AI creator: ban đầu chỉ internal/admin; sau đó creator tier có quota, moderation và cost allowance rõ ràng.

Không nên dùng VIP chỉ như cờ role trong database nếu chưa có payment, entitlement, refund, tax, abuse và cost model.

### Rủi ro kinh doanh chính

- Exact-two-player làm giảm conversion và tăng refund/support.
- AI cost có thể vượt doanh thu nếu creator quota không được kiểm soát.
- Chưa có funnel/retention data nên không thể dự báo LTV/CAC.
- Chưa có Steam packaging, achievements, cloud save, controller, crash reporting, privacy/EULA và store assets.
- Nội dung AI cần provenance, disclosure, rights/takedown và moderation để giảm rủi ro platform/community.

---

## 13. Audit Codebase

### Chất lượng tổng quan

Codebase có nhiều dấu hiệu kỹ sư đã nghĩ về failure modes: compare-and-set, optimistic concurrency, result recovery, validation contract, index migration, health checks và rule tests. Đây là nền tốt hơn một MVP thông thường.

### Điểm cần refactor

- Chia `AiCaseService` theo orchestration, prompt building, provider client, checkpoint store, asset pipeline, visual QA và publishing.
- Chia `gamePage.ts` theo Phaser scene/runtime, networking, state controller, overlays/drawers, camera, conversation, accusation và accessibility adapter.
- Chia `GameplayService` theo command handlers hoặc domain services; giữ shared persistence/version policy.
- Bật TypeScript strict theo từng thư mục; đổi các JS service/page quan trọng sang TS trước.
- Dùng partial updates/event records hoặc tách append-only actions khỏi room snapshot; đặt retention/TTL.
- Viết architectural decision records và xóa/đánh dấu tài liệu stale; source-of-truth matrix phải rõ.

---

## 14. Top 50 vấn đề theo mức tác động

**Thang tác động:** ★★★★★ = blocker/thiệt hại tiền, dữ liệu hoặc launch; ★★★★☆ = ảnh hưởng lớn đến retention/quality; ★★★☆☆ = đáng kể; ★★☆☆☆ = polish/maintainability; ★☆☆☆☆ = nhỏ.

| # | Vấn đề | Tác động | Cách sửa cụ thể |
|---:|---|:---:|---|
| 1 | Continue/Retry/Regenerate AI không dùng claim idempotent đồng nhất, có thể chạy trùng và tính tiền hai lần | ★★★★★ | Một entrypoint tạo durable job với idempotency key `(draft, phase, revision)`; unique index + lease/heartbeat. |
| 2 | Room ABANDONED vẫn đi qua `RequireLobby`, có thể ready/start lại và ghi đè failed state | ★★★★★ | Terminal-state guard chỉ cho WAITING/READY; atomic start filter; regression tests cho mọi transition. |
| 3 | Access/refresh token ở `localStorage`; refresh/reset/verify token lưu plaintext; OAuth trả token trên URL | ★★★★★ | BFF hoặc HttpOnly Secure SameSite cookie; hash opaque tokens; rotation family/reuse detection; one-time auth code. |
| 4 | AI chạy trong HTTP request dài, không queue/lease recovery; crash để draft GENERATING | ★★★★★ | Background worker + persistent jobs + retry policy + stale lease reclaim + cancel/status endpoint. |
| 5 | Không có AI USD cost ledger, per-user quota, hard cap hoặc provider circuit breaker | ★★★★★ | Ghi usage theo model/text/image/vision, price version, budget reservation và daily/project cap. |
| 6 | Một người có thể accusation và kết thúc trận cho cả đội | ★★★★★ | Draft accusation → teammate approve/amend → final confirm; audit actor và timeout policy. |
| 7 | Camera tin `captureRect` từ client; clue-zone metadata lộ xuống browser | ★★★★☆ | Server session nonce + validate against server pose; không gửi hidden zones; nếu cần, server-side image/crop verification. |
| 8 | Pose/proximity client-authoritative; hub không kiểm scene/walk bounds/rate | ★★★★☆ | Server validate scene + bounds + max delta/rate; action endpoint kiểm proximity hoặc signed interaction target. |
| 9 | Exact-two-player nhưng không solo fallback/quick match/invite deep link | ★★★★☆ | Tutorial bot, AI companion hoặc drop-in bot; invite URL/QR; opt-in public matchmaking. |
| 10 | Không có product analytics/telemetry funnel | ★★★★☆ | Event taxonomy, consent, dashboard cho activation, stage time, idle time, hints, failure, retention. |
| 11 | Chưa có desktop packaging/Steamworks/controller/cloud/achievements | ★★★★☆ | Chọn wrapper/native shell, Steam auth/overlay/invite, cloud saves, achievements, controller QA. |
| 12 | Không HTTPS redirection/HSTS/forwarded headers/CSP/security headers trong app pipeline | ★★★★☆ | Production security middleware/profile; TLS termination contract; CSP nonce/hash và headers test. |
| 13 | Rate limiter được mô tả “per IP” nhưng là global fixed-window policy; thiếu ở refresh/reset/verify/AI | ★★★★☆ | Partitioned limiter theo IP + account/user; distributed store ở scale; endpoint-specific budgets. |
| 14 | SignalR chỉ in-memory, không backplane; cached membership có thể stale | ★★★★☆ | Backplane/managed SignalR; revalidate membership/role; invalidate on leave/lock; hub filters. |
| 15 | Không TTL/retention cho rooms, action logs, evidence photos, AI logs/drafts | ★★★★☆ | Lifecycle policy + TTL indexes/archive; admin purge và legal retention config. |
| 16 | Mỗi gameplay mutation replace toàn bộ room document và log tăng không giới hạn | ★★★★☆ | Atomic field updates hoặc snapshot+event stream; compact history; document-size metrics. |
| 17 | Frontend build 368 MB vì copy toàn bộ public assets, kể cả case không ship | ★★★★☆ | Manifest chỉ include published assets; optimize WebP/AVIF; CDN/object storage; lazy case download. |
| 18 | `gamePage` chunk 1,76 MB minified; startup/memory trên mobile yếu | ★★★★☆ | Lazy-load Phaser/runtime, split feature modules, preload theo case, bundle budgets trong CI. |
| 19 | Các “god file” 1.500–4.100 dòng làm blast radius và review cao | ★★★★☆ | Refactor theo bounded responsibility; characterization tests trước khi tách. |
| 20 | TypeScript strict tắt, JS không `checkJs` | ★★★★☆ | Strict incremental, typed API contracts, lint/no-unsafe, migrate state/network/auth trước. |
| 21 | UI Playwright tests không chạy trong CI | ★★★★☆ | Thêm browser install/cache, `npm run test:ui`, artifact screenshot/trace khi fail. |
| 22 | Không test tích hợp realtime reconnect thật giữa hai browser + Mongo | ★★★★☆ | Hai-context E2E thật: disconnect/reconnect, stale version, abandon grace, host/role changes. |
| 23 | Role Investigator có nhiều action hơn; Interrogator dễ idle | ★★★★☆ | Telemetry active-time; redesign stage với information split và action budget cân bằng ±15%. |
| 24 | Art asset khác scale/pixel density/lighting; background có pseudo-text | ★★★★☆ | Golden references, OCR/alpha/palette checks, artist polish pass và reject thresholds. |
| 25 | Không có audio/music/SFX | ★★★★☆ | Audio bible, ambience layers, footsteps, UI/clue stings, volume/mute/accessibility controls. |
| 26 | Không host migration hoặc continue-with-bot trong in-progress disconnect | ★★★★☆ | Role-neutral host authority; teammate takeover; bot substitution; reconnect/resume UX. |
| 27 | Validator chứng minh structure, không chứng minh mystery fairness/narrative quality | ★★★★☆ | Human content rubric + pair playtest gate + telemetry thresholds trước publish. |
| 28 | Generated case sample để trống toàn bộ character `shortBio` và stage `objective` | ★★★☆☆ | Bắt buộc semantic fields hoặc loại khỏi schema; hiển thị objective rõ theo stage. |
| 29 | Docs mâu thuẫn/stale về provider, scope, API và feature status | ★★★☆☆ | Source-of-truth docs, generated API/schema docs, owner/date/status banner và doc CI. |
| 30 | Không production deployment topology, image, backup/restore, rollback | ★★★★☆ | IaC/container, environment matrix, secret manager, migrations/index checks, rollback runbook. |
| 31 | Không metrics/tracing/error aggregation/SLO | ★★★★☆ | OpenTelemetry, structured logs, trace IDs, RED metrics, alerting và SLO dashboard. |
| 32 | Không load/soak/performance test cho SignalR, Mongo writes và AI queue | ★★★★☆ | k6/Locust scenarios, 2-player rooms, reconnect storm, hot case cache, capacity target. |
| 33 | Cache case process-local có thể stale khi nhiều instance/publish | ★★★☆☆ | Versioned cache key + pub/sub invalidation hoặc distributed cache; stampede lock. |
| 34 | Startup nuốt một số Mongo/index failure và vẫn serve degraded | ★★★☆☆ | Readiness fail rõ; classify fatal index/invariant failures; degraded mode chỉ cho endpoints an toàn. |
| 35 | Mongo dev/compose 7 nhưng CI 8 | ★★★☆☆ | Pin cùng major/minor, compatibility matrix nếu hỗ trợ nhiều version. |
| 36 | OAuth access/refresh token có thể nằm trong history/JS-visible callback URL | ★★★★☆ | Authorization code một lần, exchange server-side; dọn URL bằng `history.replaceState`. |
| 37 | Password policy 6 ký tự + chữ/số quá yếu | ★★★☆☆ | 10–12+ ký tự, breached-password check, no forced composition; login anomaly monitoring. |
| 38 | Một refresh token duy nhất/user khiến login thiết bị mới ghi đè thiết bị cũ | ★★★☆☆ | Per-device sessions, hashed token family, list/revoke sessions và reuse detection. |
| 39 | User-status middleware truy vấn Mongo mỗi authenticated HTTP request; connection hub đã mở có thể không bị khóa ngay | ★★★☆☆ | Short cache/version claim + revocation event; hub filter revalidate sensitive calls. |
| 40 | Mobile chỉ điều khiển trái/phải trong scene runtime hai trục | ★★★☆☆ | Virtual stick/tap-to-move hoặc thiết kế runtime mobile 1D chính thức và validate asset/layout theo mode. |
| 41 | Accessibility canvas/focus/reduced-motion/high-contrast/rebind chưa đầy đủ | ★★★★☆ | Accessibility tree thay thế, focus trap/return, WCAG audit, contrast/text scale, key rebinding. |
| 42 | Catalog summary dài, thiếu difficulty/role complexity/content warnings | ★★★☆☆ | Metadata chuẩn, clamp summary, filters, expected duration range, completion/ratings. |
| 43 | Toast/NPC labels/prompt có thể chồng scene và che nhân vật | ★★★☆☆ | Collision-aware label layout, toast queue/aggregation, safe HUD zones và screenshot regression. |
| 44 | Không chat/ping trong game, phụ thuộc Discord ngoài | ★★★☆☆ | Contextual ping/mark clue trước; sau đó optional text/voice với moderation/mute/report. |
| 45 | Không moderation/provenance/takedown cho AI/UGC | ★★★★☆ | Content status workflow, creator identity, automated safety, human queue, report/takedown SLA. |
| 46 | Không legal/privacy/consent/AI disclosure workflow | ★★★★☆ | Privacy policy, EULA, data map/retention, consent/DSAR, AI content records và platform checklist. |
| 47 | Không content version pinning rõ cho room đang chạy khi case republish | ★★★☆☆ | Immutable published revision; room lưu case revision/snapshot; migration policy. |
| 48 | Concurrency retry chỉ một lần, dễ hiện conflict khi hai người spam action | ★★★☆☆ | Command idempotency key, bounded retry/backoff, finer updates và UX tự refetch. |
| 49 | Camera near-miss không tính miss, có thể dò vị trí không mất điểm | ★★☆☆☆ | Xác định design: tính soft penalty/cooldown hoặc bỏ directional oracle; test scoring. |
| 50 | Admin/users/drafts list giới hạn cứng, pagination/filter chưa đồng đều | ★★☆☆☆ | Cursor pagination, search/filter/sort, total estimate và virtualized table. |

---

## 15. Top 30 tính năng còn thiếu

| # | Tính năng | Lý do cần | Ưu tiên |
|---:|---|---|:---:|
| 1 | Solo companion/tutorial bot | Giải quyết cold start và cho phép học vai trước khi mời bạn | P0 |
| 2 | Invite deep link/QR/Steam invite | Giảm rơi rụng do nhập mã phòng | P0 |
| 3 | Accusation proposal + team consensus | Bảo vệ agency của cả hai người | P0 |
| 4 | Durable AI job queue + progress/cancel/retry | Bảo đảm độ tin cậy và kiểm soát chi phí | P0 |
| 5 | AI quota/budget/cost dashboard | Ngăn unit economics âm | P0 |
| 6 | Product analytics + consent | Đo activation, balance, retention | P0 |
| 7 | Save/resume match và immutable case revision | Phục hồi session dài/an toàn khi publish | P0 |
| 8 | Host migration/continue with bot | Giảm trận hỏng do disconnect | P1 |
| 9 | Quick match/public lobby có opt-in | Tăng tỷ lệ tìm được bạn chơi | P1 |
| 10 | Guided prologue 8–12 phút | Time-to-fun nhanh, dạy camera/evidence | P0 |
| 11 | Difficulty/assist mode | Phục vụ casual và expert, kiểm soát hint | P1 |
| 12 | Gamepad/controller support | Cần cho desktop couch/Steam Deck | P1 |
| 13 | Audio system: ambience/music/SFX | Tăng immersion và feedback | P1 |
| 14 | Accessibility center | Text scale, contrast, reduced motion, rebind, screen-reader alternative | P1 |
| 15 | Steamworks integration | Auth/invite/overlay/achievements/store launch | P1 |
| 16 | Cloud save/profile sync | Kỳ vọng nền tảng và bảo vệ tiến trình | P1 |
| 17 | Native achievements | Retention, goals, Steam surface | P1 |
| 18 | Crash/error reporting | Sửa lỗi production theo dữ liệu | P0 |
| 19 | Contextual ping/mark clue | Hỗ trợ giao tiếp không cần Discord | P1 |
| 20 | Creator moderation/report/takedown | Bắt buộc trước UGC public | P0 |
| 21 | Curated case editor/preview simulator | Giảm phụ thuộc chỉnh JSON/admin raw | P1 |
| 22 | Content versioning/changelog/rollback | LiveOps an toàn | P1 |
| 23 | Spectator/streamer mode | Tăng discoverability và content creation | P2 |
| 24 | Replayable variants/seeded modifiers | Tăng giá trị chơi lại | P2 |
| 25 | Shareable case result card | Organic marketing | P2 |
| 26 | Remote config/feature flags/A-B test | LiveOps và rollout an toàn | P1 |
| 27 | Asset CDN/on-demand case packages | Giảm initial bundle 368 MB | P0 |
| 28 | Server-authoritative proximity/anti-cheat minimum | Bảo vệ integrity leaderboard/workshop | P1 |
| 29 | Privacy/data export/delete account | Production/legal hygiene | P1 |
| 30 | Offline/local co-op mode | Mở rộng thị trường và giảm network failure | P2 |

---

## 16. Ma trận ưu tiên

| | Nỗ lực thấp | Nỗ lực cao |
|---|---|---|
| **Tác động cao** | Fix ABANDONED transitions; accusation confirm; CI chạy UI tests; bundle asset manifest; token URL cleanup; partition rate limit; analytics taxonomy; clamp catalog summaries | AI durable jobs/cost controls; auth session redesign; solo bot/tutorial; server proximity; save/resume/versioning; Steamworks/controller; audio/art polish; observability/deployment |
| **Tác động thấp hơn** | Admin pagination; doc status banners; near-miss rule; label collision; locale cleanup | Voice chat; spectator mode; replay variants; offline/local co-op; advanced UGC economy |

Nguyên tắc: hoàn tất **tác động cao/nỗ lực thấp** trong sprint đầu; song song thiết kế hai initiative dài là **AI operations** và **activation/onboarding**. Không mở voice chat, economy hoặc procedural breadth trước khi launch blockers được đóng.

---

## 17. Roadmap bốn giai đoạn

### Phase 1 — Critical stabilization (3–4 tuần)

Mục tiêu: closed alpha không làm mất tiền/dữ liệu và không kết thúc trận sai.

- Fix state machine ABANDONED + exhaustive lifecycle tests.
- Accusation consensus/confirm.
- Durable AI job skeleton, idempotency, stale lease reclaim, quota và USD ledger.
- Session/auth hardening: token model, rate limit partition, OAuth one-time code, security headers.
- Asset shipping manifest, chuyển ảnh lớn sang format tối ưu; bundle budgets.
- CI chạy Playwright; two-browser reconnect E2E; error aggregation cơ bản.
- TTL/retention, room/result revision pinning và production readiness policy.

**Exit criteria:** không có P0 mở; AI double-click không tạo hai provider calls; abandoned room không thể restart; initial web payload không tải assets của case chưa chọn; 100 cặp smoke sessions không có state corruption.

### Phase 2 — Important product experience (6–8 tuần)

Mục tiêu: người mới chạm “fun” trong 5 phút và hoàn thành case đầu.

- Prologue 8–12 phút với companion bot.
- Invite deep link/QR, optional quick match; host migration/resume.
- Stage communication design và balance hai vai dựa trên telemetry.
- Contextual pings, accusation draft, difficulty/assist.
- Accessibility foundation, mobile movement decision, controller prototype.
- Curate 3 case với playtest rubric và content revision tooling.
- Product analytics dashboard: funnel, stage duration, idle time, hints/fails.

**Exit criteria:** ≥70% người bắt đầu prologue hoàn tất; median time-to-first-meaningful-action <3 phút; chênh active-time hai vai <15%; ≥60% cặp invited bắt đầu được room.

### Phase 3 — Polish và beta (6–8 tuần)

Mục tiêu: cảm giác premium, hiệu năng ổn, content đáng tin.

- Art bible/golden assets; sửa player/NPC/cover/hero scenes; OCR/palette QA.
- Ambience, music, footsteps, clue/puzzle/UI SFX và settings.
- Split `gamePage`/`AiCaseService`, bật strict TS theo module.
- Visual regression, load/soak tests, multi-instance SignalR/backplane.
- Full accessibility/controller/Steam Deck pass; locale QA EN/VI.
- Moderation, provenance, report/takedown; privacy/EULA/data controls.

**Exit criteria:** 60 FPS target trên thiết bị chuẩn, reconnect success ≥99%, crash-free sessions ≥99,5%, không critical accessibility issue, 3 flagship cases đạt rating playtest ≥4/5.

### Phase 4 — Commercial launch preparation (8–12 tuần)

Mục tiêu: Steam demo/Next Fest-style public beat rồi paid launch.

- Native packaging, Steam auth/invites/overlay/cloud/achievements.
- Production IaC, backups, rollback, SLO/on-call/support runbooks.
- Store page/trailer/capsules/demo, pricing và creator/community plan.
- Closed beta → public demo → launch candidate; cohort/refund/support review.
- Chỉ mở creator public khi moderation SLA và unit economics đã chứng minh.

**Exit criteria:** launch checklist 100%, recovery drill pass, support tooling sẵn sàng, D1/D7 và demo-to-wishlist đạt ngưỡng nội bộ, AI cost per published case nằm trong budget đã duyệt.

---

## 18. Nếu phát hành hôm nay

### Steam review giả lập

> **Mixed — ý tưởng rất hay, nhưng giống một bản web alpha được đưa lên Steam quá sớm.** Chơi cùng bạn, việc một người tìm dấu vết còn người kia bẻ lời khai tạo vài khoảnh khắc suy luận thực sự tuyệt. Art nền có không khí và hệ camera khá độc đáo. Nhưng phải có đúng hai người, onboarding rườm rà, không có âm thanh/controller/Steam invite, UI đôi lúc che cảnh và một lần đồng đội bấm cáo buộc sai đã kết thúc cả trận. Nội dung AI lúc rất cuốn, lúc lộ cảm giác lặp và hình ảnh có chữ giả. Tôi sẽ quay lại sau vài bản update, chưa khuyên mua ở giá premium.

**Dự đoán sentiment nếu paid launch hiện tại:** Mixed; người thích concept sẽ bênh game, nhưng review tiêu cực tập trung vào friction, polish và độ tin cậy hơn là thiếu feature.

### Một YouTuber có thể phàn nàn gì

1. “Tôi mất quá lâu để đưa khách mời vào đúng phòng.”
2. “Tại sao game co-op lại không có Steam invite/ping/chat?”
3. “Vai này đang chạy khắp nơi còn tôi chỉ chờ câu hỏi mở khóa.”
4. “Chúng tôi không hiểu vì sao scene chưa complete.”
5. “Một cú click cáo buộc đã phá hỏng 60 phút ghi hình.”
6. “UI và toast che mất thứ tôi muốn cho khán giả xem.”
7. “Ảnh nền đẹp nhưng NPC/sprite nhìn như từ bộ asset khác.”
8. “Không có nhạc/SFX nên video bị chết không khí.”
9. “AI tạo được nhiều case, nhưng liệu case nào thực sự hay?”
10. “Bundle/load lớn nhưng tôi chỉ chơi một case.”

### Cảm giác người chơi mới trong 30 phút đầu

| Thời điểm | Cảm xúc có khả năng xảy ra | Rủi ro |
|---|---|---|
| 0–5 phút | Tò mò bởi art/định vị, nhưng gặp đăng ký/verify/mời bạn | Drop trước khi thấy gameplay |
| 5–10 phút | Thích chọn vai và fantasy co-op | Không hiểu khác biệt vai đủ cụ thể |
| 10–15 phút | Ấn tượng với scene và camera/hotspot | Text/prompt/controls nhiều; không biết ưu tiên gì |
| 15–20 phút | Bắt đầu có “aha” khi clue mở dialogue | Một vai có thể idle, phải nói qua app ngoài |
| 20–25 phút | Thấy shared case file và progression có chiều sâu | Không rõ completion/hint/penalty; label/toast gây nhiễu |
| 25–30 phút | Muốn giải tiếp nếu case tốt | Nếu disconnect, kẹt hoặc accusation sớm, niềm tin mất nhanh |

Mục tiêu thiết kế là đưa khoảnh khắc “tôi có thông tin bạn không có” vào trước phút thứ 7.

---

## 19. Góc nhìn nhà đầu tư

### Có đầu tư không?

**Hiện tại: chưa.** Không phải vì concept yếu, mà vì chưa có bằng chứng cho ba giả định sống còn:

1. Hai người có thể activation đủ dễ để không phá conversion.
2. AI-authored cases giữ chất lượng và chi phí ở quy mô thương mại.
3. Role asymmetry thực sự tăng giao tiếp/retention thay vì tạo idle time.

### Điều kiện để cân nhắc đầu tư

- 3 case curate, ít nhất 20 cặp playtest/case, rating trung bình ≥4/5.
- Closed beta ≥500 người, có funnel và D1/D7 theo cohort; báo cáo disconnect/fail/refund intent.
- AI cost ledger, budget cap và published-case unit economics.
- Demo có solo onboarding, invite friction thấp và crash-free ≥99,5%.
- Lộ trình Steam rõ, quyền sử dụng/provenance asset và moderation/legal hoàn chỉnh.

Nếu các milestone trên đạt, dự án có thể phù hợp một vòng pre-seed nhỏ để tài trợ 6–9 tháng polish/content/launch. Moat cần được định nghĩa là **validated co-op mystery authoring system + dữ liệu playtest**, không phải quyền truy cập một model AI phổ biến.

---

## 20. Danh sách 100 TODO theo thứ tự triển khai

Quy ước: thời gian là effort người-thực-hiện; **Dễ/Vừa/Khó/Rất khó** gồm cả rủi ro kỹ thuật; lợi ích **Cao/Rất cao**. Số thứ tự chính là trình tự khuyến nghị. Dependency dùng số TODO; “—” nghĩa là có thể bắt đầu ngay.

| # | TODO | Thời gian | Độ khó | Lợi ích | Phụ thuộc |
|---:|---|---:|:---:|:---:|---|
| 1 | Viết state-transition table chính thức cho WAITING/READY/IN_PROGRESS/COMPLETED/ABANDONED | 0,5 ngày | Dễ | Rất cao | — |
| 2 | Sửa `RequireLobby` chỉ chấp nhận WAITING/READY và atomic filter cho Start | 0,5 ngày | Dễ | Rất cao | 1 |
| 3 | Thêm exhaustive room lifecycle tests, gồm ABANDONED restart/join/ready/leave | 1 ngày | Vừa | Rất cao | 1–2 |
| 4 | Thiết kế accusation proposal/approval state và concurrency rule | 1 ngày | Vừa | Rất cao | — |
| 5 | Implement proposal → teammate confirm/amend → final submit | 3 ngày | Khó | Rất cao | 4 |
| 6 | Thêm E2E hai browser cho accusation đồng thời/timeout/disconnect | 1,5 ngày | Khó | Cao | 5 |
| 7 | Lập AI job schema: idempotency key, phase, revision, lease, attempt, budget reservation | 1 ngày | Khó | Rất cao | — |
| 8 | Tạo unique index/idempotent enqueue cho mọi AI phase | 2 ngày | Khó | Rất cao | 7 |
| 9 | Chuyển Continue/Retry/Regenerate sang cùng job orchestration | 3 ngày | Khó | Rất cao | 8 |
| 10 | Tạo background worker, heartbeat, retry/backoff và stale lease reclaim | 5 ngày | Rất khó | Rất cao | 7–9 |
| 11 | Thêm cancel/status/progress API và UI polling/SignalR | 2 ngày | Khó | Cao | 10 |
| 12 | Tạo AI usage ledger cho text/image/vision theo model và price version | 2 ngày | Khó | Rất cao | 7 |
| 13 | Implement per-user/project daily quota, reservation và hard spending cap | 2 ngày | Khó | Rất cao | 12 |
| 14 | Thêm provider circuit breaker, timeout per phase và failure taxonomy | 1,5 ngày | Khó | Cao | 10,12 |
| 15 | Viết concurrency tests chứng minh double-click chỉ có một provider call | 1 ngày | Vừa | Rất cao | 8–10 |
| 16 | Chọn production session model: BFF cookie hoặc short access + HttpOnly refresh | 1 ngày | Khó | Rất cao | — |
| 17 | Hash refresh/reset/verify tokens trong DB, thêm rotation family/reuse detection | 3 ngày | Khó | Rất cao | 16 |
| 18 | Đổi OAuth callback sang one-time code exchange và dọn URL | 2 ngày | Khó | Rất cao | 16–17 |
| 19 | Thêm per-device session list/revoke và logout-all | 2 ngày | Khó | Cao | 17 |
| 20 | Nâng password policy + breached-password check + tests | 1 ngày | Vừa | Cao | — |
| 21 | Đổi auth/email limiters sang partitioned IP/account/user | 1 ngày | Vừa | Rất cao | — |
| 22 | Áp rate limit cho refresh/reset/verify/AI/hub pose | 1 ngày | Vừa | Rất cao | 21 |
| 23 | Thêm HTTPS/HSTS/forwarded headers/security headers/CSP production profile | 1,5 ngày | Khó | Rất cao | 16 |
| 24 | Viết integration tests cho auth cookie/token rotation/CORS/CSP/429 | 2 ngày | Khó | Cao | 17–23 |
| 25 | Định nghĩa immutable case revision và pin revision vào room/result | 1 ngày | Khó | Rất cao | — |
| 26 | Implement publish-as-new-revision, rollback và migration policy | 3 ngày | Khó | Cao | 25 |
| 27 | Thiết kế retention table cho rooms/logs/photos/results/drafts/jobs | 0,5 ngày | Vừa | Cao | — |
| 28 | Thêm TTL/archive indexes và admin cleanup dry-run | 2 ngày | Khó | Cao | 27 |
| 29 | Thêm document-size/action-count metrics và compaction guard | 1 ngày | Vừa | Cao | 27 |
| 30 | Refactor state persistence sang field updates hoặc snapshot + append-only events | 5 ngày | Rất khó | Rất cao | 25,29 |
| 31 | Thêm command idempotency key và bounded retry/backoff cho gameplay mutations | 3 ngày | Khó | Cao | 30 |
| 32 | Validate SignalR pose scene với `PlayerSceneIds` và room status | 1 ngày | Vừa | Cao | — |
| 33 | Validate bounds/max speed/rate; loại cached membership stale | 2 ngày | Khó | Cao | 32 |
| 34 | Thêm server-side interaction proximity hoặc signed interaction token | 4 ngày | Rất khó | Cao | 30,33 |
| 35 | Ẩn clue zones chưa mở khỏi state response; sửa camera trust boundary | 2 ngày | Khó | Cao | 34 |
| 36 | Quyết định near-miss penalty/cooldown và thêm scoring tests | 0,5 ngày | Dễ | Vừa | 35 |
| 37 | Xây two-browser realtime E2E thật: join/pose/action/disconnect/reconnect | 3 ngày | Khó | Rất cao | 32–35 |
| 38 | Chọn/triển khai SignalR backplane hoặc managed service | 3 ngày | Khó | Cao | 37 |
| 39 | Versioned/distributed case cache + invalidation pub/sub + stampede lock | 2 ngày | Khó | Cao | 26,38 |
| 40 | Thêm UI Playwright vào CI với trace/screenshot artifact | 0,5 ngày | Dễ | Cao | — |
| 41 | Pin Mongo version nhất quán dev/CI/prod và ghi compatibility policy | 0,5 ngày | Dễ | Vừa | — |
| 42 | Thêm unit/integration coverage gate và flaky-test tracking | 1 ngày | Vừa | Cao | 40 |
| 43 | Viết k6 scenarios cho API/SignalR/reconnect storm/Mongo hot room | 3 ngày | Khó | Cao | 37–38 |
| 44 | Đặt capacity targets và chạy load/soak 2 giờ | 2 ngày | Khó | Cao | 43 |
| 45 | Tích hợp OpenTelemetry traces, structured logs và correlation propagation | 2 ngày | Khó | Rất cao | — |
| 46 | Thêm RED metrics, AI cost/job metrics và dashboards | 2 ngày | Khó | Rất cao | 10,12,45 |
| 47 | Tích hợp frontend/backend error aggregation và source maps bảo mật | 1 ngày | Vừa | Rất cao | 45 |
| 48 | Định nghĩa SLO/alerts/on-call severity và incident template | 1 ngày | Vừa | Cao | 46–47 |
| 49 | Tạo production container/IaC/environment matrix/secrets contract | 4 ngày | Khó | Rất cao | 23,45 |
| 50 | Viết backup/restore/rollback runbook và thực hiện recovery drill | 2 ngày | Khó | Rất cao | 26,28,49 |
| 51 | Sinh asset manifest chỉ gồm case published/case được chọn | 2 ngày | Khó | Rất cao | 25–26 |
| 52 | Convert/resize scene và cover sang WebP/AVIF + thumbnail variants | 3 ngày | Vừa | Cao | 51 |
| 53 | Đưa case assets lên object storage/CDN và lazy download theo case | 4 ngày | Khó | Rất cao | 51–52 |
| 54 | Đặt CI budgets cho initial JS, game chunk, CSS, image và total case pack | 0,5 ngày | Dễ | Cao | 51–53 |
| 55 | Split Phaser/gameplay lazy chunk và preload có progress/cancel | 3 ngày | Khó | Cao | 54 |
| 56 | Tách `gamePage.ts` thành runtime/network/controller/overlay/camera modules | 5 ngày | Rất khó | Cao | 40,55 |
| 57 | Tách `AiCaseService` thành orchestrator/provider/prompt/assets/QA/publish | 6 ngày | Rất khó | Cao | 8–15 |
| 58 | Tách `GameplayService` theo command/domain modules | 5 ngày | Rất khó | Cao | 30–31 |
| 59 | Bật TS strict cho auth/API/state/network modules | 3 ngày | Khó | Cao | 56 |
| 60 | Migrate các JS page/service rủi ro cao sang TS và typed API contracts | 5 ngày | Khó | Cao | 59 |
| 61 | Thiết kế event taxonomy + consent/privacy fields | 1 ngày | Khó | Rất cao | — |
| 62 | Implement funnel events: landing→auth→invite→role→first clue→complete | 2 ngày | Khó | Rất cao | 61 |
| 63 | Implement gameplay balance events: active/idle time, hint, fail, stage time | 2 ngày | Khó | Rất cao | 61 |
| 64 | Dựng dashboard cohort/activation/role balance/content quality | 2 ngày | Khó | Rất cao | 62–63 |
| 65 | Thiết kế prologue 8–12 phút và learning objectives | 2 ngày | Khó | Rất cao | 61 |
| 66 | Implement companion bot cho prologue/solo fallback tối thiểu | 8 ngày | Rất khó | Rất cao | 25,65 |
| 67 | Tạo invite deep link/QR/copy UX và expiration rule | 2 ngày | Vừa | Rất cao | 16,25 |
| 68 | Implement resume/rejoin screen và persisted match checkpoint | 3 ngày | Khó | Rất cao | 25,30 |
| 69 | Implement host migration và continue-with-bot policy | 5 ngày | Rất khó | Cao | 66,68 |
| 70 | Prototype opt-in quick match/public lobby với safety controls | 5 ngày | Rất khó | Cao | 67–69 |
| 71 | Audit action count/idle time từng vai trên 20 cặp playtest | 3 ngày | Vừa | Rất cao | 63–66 |
| 72 | Rewrite stages để mỗi stage có information split + dependency + payoff | 5 ngày | Rất khó | Rất cao | 71 |
| 73 | Thêm contextual ping/mark clue và notification aggregation | 3 ngày | Khó | Cao | 56,72 |
| 74 | Thiết kế difficulty/assist/hint transparency và score preview | 2 ngày | Khó | Cao | 63,71 |
| 75 | Implement difficulty/assist presets và test fairness | 4 ngày | Khó | Cao | 74 |
| 76 | Quyết định mobile runtime: virtual stick/tap-to-move hoặc official 1D | 1 ngày | Khó | Cao | 71 |
| 77 | Implement và test mobile movement tương đương quyết định thiết kế | 3 ngày | Khó | Cao | 76 |
| 78 | Tạo accessibility audit checklist và keyboard/focus map | 1 ngày | Vừa | Cao | 56 |
| 79 | Implement text scale/high contrast/reduced motion/rebind/focus return | 5 ngày | Khó | Rất cao | 78 |
| 80 | Tạo semantic alternative cho canvas hotspots/objectives/state | 5 ngày | Rất khó | Cao | 78–79 |
| 81 | Chuẩn hóa i18n, loại hard-coded EN/VI và thêm locale completeness test | 3 ngày | Vừa | Cao | 56,60 |
| 82 | Thiết kế gamepad mapping và navigation model | 1 ngày | Khó | Cao | 78 |
| 83 | Implement controller + Steam Deck viewport/input QA | 5 ngày | Rất khó | Cao | 79,82 |
| 84 | Tạo art bible, golden references và character scale/palette grid | 3 ngày | Khó | Rất cao | — |
| 85 | Thêm asset QA: dimensions/alpha/palette/OCR/prompt hash/provenance | 4 ngày | Khó | Rất cao | 84 |
| 86 | Artist polish pass cho player sheets, 10 NPC hero, 3 covers, 6 scenes | 15–25 ngày | Rất khó | Rất cao | 84–85 |
| 87 | Sửa label/toast collision và thêm screenshot visual regression | 3 ngày | Khó | Cao | 40,56,84 |
| 88 | Viết audio bible và event list | 2 ngày | Vừa | Cao | 65,72 |
| 89 | Implement audio mixer/settings/ambience/music/SFX hooks | 6 ngày | Khó | Rất cao | 56,88 |
| 90 | Curate tutorial, flagship 35–45 phút và advanced 60 phút | 15–20 ngày | Rất khó | Rất cao | 72,84–89 |
| 91 | Tạo human content QA rubric và publish score gate | 2 ngày | Khó | Rất cao | 61,85 |
| 92 | Playtest ≥20 cặp/case, rewrite hai vòng, khóa launch revisions | 12–15 ngày | Rất khó | Rất cao | 64,90–91 |
| 93 | Implement moderation/report/takedown/provenance audit trail | 6 ngày | Rất khó | Rất cao | 12–13,26,91 |
| 94 | Hoàn thiện privacy/EULA/data export/delete/retention consent | 5 ngày | Rất khó | Rất cao | 27–28,61,93 |
| 95 | Chọn desktop wrapper và tạo signed installer/updater | 7 ngày | Rất khó | Rất cao | 49,53,83 |
| 96 | Tích hợp Steam auth/invite/overlay | 6 ngày | Rất khó | Rất cao | 67,83,95 |
| 97 | Tích hợp Steam cloud saves/achievements và offline conflict policy | 6 ngày | Rất khó | Cao | 25,68,95–96 |
| 98 | Tạo store assets/trailer/demo build/support FAQ | 10–15 ngày | Rất khó | Rất cao | 86,89–97 |
| 99 | Closed beta 500+ users; đo funnel/D1/D7/crash/cost/support/refund intent | 3–4 tuần lịch | Rất khó | Rất cao | 48,64,92,98 |
| 100 | Go/No-Go launch review; đóng blockers, recovery drill và release candidate | 3 ngày | Rất khó | Rất cao | 44,50,94,97,99 |

---

## 21. Thứ tự quyết định sản phẩm

Ba quyết định cần khóa sớm, vì chúng thay đổi toàn roadmap:

1. **SirLocked là game 2 người bắt buộc hay game có solo companion?** Khuyến nghị: co-op là trải nghiệm tốt nhất, bot là onboarding/fallback.
2. **AI creator là internal tool hay user-facing business?** Khuyến nghị: internal qua ít nhất một beta; chỉ mở creator sau quota/moderation/unit economics.
3. **Mobile là platform chính hay companion access?** Khuyến nghị: ưu tiên desktop/Steam; mobile web hỗ trợ join/profile và gameplay assist, không hứa full parity nếu chưa có virtual control tốt.

---

## 22. Kết luận cuối

SirLocked có một lõi sản phẩm đáng tiếp tục đầu tư công sức: fantasy rõ, USP có thể trình bày trong một câu, pipeline AI thực sự có kỹ thuật và game đã chạy end-to-end. Dự án không thiếu ý tưởng; dự án đang thiếu **sự tập trung vào độ tin cậy, activation và chất lượng cảm nhận**.

Trong 3–4 tháng tới, đừng tối ưu số lượng case hay thêm nhiều feature social. Hãy làm một case 35–45 phút mà hai người mới có thể vào chơi nhanh, mỗi vai đều bận và có khoảnh khắc phụ thuộc nhau, không bị disconnect phá trận, không bị một người kết thúc game ngoài ý muốn, có audio/art/UI nhất quán và được đo bằng telemetry. Nếu làm được điều đó, SirLocked có cơ hội chuyển từ một đồ án kỹ thuật ấn tượng thành một indie game có khả năng thương mại thật.

