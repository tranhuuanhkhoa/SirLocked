# Plan 014: Run the Three-Pair V3 Playtest Gate

> **Executor instructions**: Follow this plan step by step. Đây là plan **kiểm chứng bằng người thật**, không phải plan viết feature. Không được thay kết luận playtest bằng suy luận từ code. Nếu một mục không quan sát được, ghi "không quan sát được" thay vì suy đoán.
>
> **Drift check (run first)**: `git diff --stat af3da77..HEAD -- src/BE/Services/PairedConfrontationRules.cs src/BE/Services/V3KnowledgeProjector.cs src/FE/Client/js/game src/BE/SeedData docs/playtest`
> Nếu luật V3 hoặc sandbox đã đổi, chốt lại build và checksum trước khi chạy buổi đầu tiên.

## Status

- **Priority**: P0
- **Effort**: S (0,5 ngày chuẩn bị + 3 buổi × ~90 phút)
- **Risk**: LOW về kỹ thuật, HIGH về kết quả — plan này có quyền dừng cả hướng đi
- **Depends on**: 013 (cần telemetry được lưu để có số định lượng)
- **Category**: validation
- **Planned at**: commit `af3da77`, 2026-07-27

## Why this matters

`docs/V3_TECHNICAL_GATE_1_RESULT_VI.md` mục 4 ghi rõ những gì **chưa** được kiểm chứng, và mục 5 chỉ cho phép đi tiếp có điều kiện. `docs/CORE_GAMEPLAY_FEASIBILITY_AUDIT_VI.md` mục 1 khóa quyết định số 8: *"Ba cặp đầu chỉ đủ để Kill/Iterate; chạy thêm 3–5 cặp mới sau iteration; chỉ cân nhắc scale khi tổng cộng 8–12 cặp đạt communication/comprehension target."*

Từ đó tới nay đã có thêm rất nhiều code V3 — coordinator, API, UI notebook riêng, joint review, reveal, sandbox song ngữ — nhưng **chưa có buổi playtest nào với người thật được ghi nhận**. `docs/playtest/V3_30_SECOND_OBSERVATION.csv` hiện chỉ có một session mẫu `A01` với 2 dòng, dùng để định nghĩa schema.

Nghĩa là: toàn bộ giả thuyết "Crack the Lie làm hai người phải nói chuyện với nhau" vẫn đang ở trạng thái `Requires human playtest validation`.

Rủi ro nếu bỏ qua plan này: cả giai đoạn P2 và P3 trong `plans/ROADMAP_2026-07-27_VI.md` — prologue bot, ping, quick match, audio, accessibility — sẽ được xây trên một core loop chưa ai xác nhận là chơi được.

## Current state

- Sandbox: `case-v3-broken-seal-en` và `case-v3-broken-seal-vi`, cài bằng `POST /api/admin/cases/seed-crack-demo` (chỉ admin, không chạy tự động lúc khởi động).
- Cờ chạy: `GameplayV3__Enabled=true`, `GameplayV3__PlaytestInstrumentationEnabled=true`.
- Công cụ quan sát: `docs/playtest/V3_30_SECOND_OBSERVATION.csv` — 21 cột đã định nghĩa, gồm `investigator_actionable`, `interrogator_actionable`, `communication_state`, `private_detail_spoken_before_review`, `waiting_role`, `waiting_episode_seconds`, `joint_review_revision`, `edit_count`, `clarification_count`, `facilitator_intervention`, `technical_error`, `observer_notes_no_pii`.
- Chưa có: file giao thức playtest, tiêu chí Kill/Iterate/Scale viết ra trước, và bất kỳ session thật nào.
- Telemetry: bị vứt bỏ cho tới khi plan 013 xong.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Chốt build | `git rev-parse --short HEAD` | ghi lại, dùng cho cột `build_commit` |
| Chạy DB local | `docker compose up -d` | Mongo sẵn sàng |
| Chạy backend | `cd src/BE; dotnet run` | `http://localhost:5215/health` trả healthy |
| Chạy frontend | `cd src/FE; npm run dev` | `http://localhost:5173` |
| Seed sandbox | `POST /api/admin/cases/seed-crack-demo` (JWT admin) | 2 case publish |
| Đọc số liệu | `GET /api/admin/playtest/summary` (từ plan 013) | trả 10 chỉ số |

## Scope

**In scope**:
- `docs/playtest/V3_PLAYTEST_PROTOCOL_VI.md` (mới)
- `docs/playtest/V3_30_SECOND_OBSERVATION.csv` (ghi thêm session thật)
- `docs/playtest/V3_PLAYTEST_RESULT_<ngày>_VI.md` (mới, kết luận)
- Tài khoản test dùng riêng cho playtest

**Out of scope**:
- Sửa code trong lúc chạy ba buổi. Build phải cố định.
- Sửa nội dung case giữa các buổi.
- Mở rộng lên 8–12 cặp (chỉ sau khi có iteration).

## Design decisions locked before running

1. **Build đóng băng.** Ba buổi dùng **cùng một commit** và cùng checksum sandbox. Sửa gì giữa chừng thì các buổi trước không so sánh được với nhau nữa.
2. **Tiêu chí viết trước khi chạy.** Ngưỡng Kill/Iterate/Scale phải nằm trong `V3_PLAYTEST_PROTOCOL_VI.md` **trước** buổi đầu tiên. Đây là điều kiện để kết quả có nghĩa; định ngưỡng sau khi thấy số liệu là tự lừa mình.
3. **Người điều phối không dạy cách chơi.** Chỉ can thiệp khi có lỗi kỹ thuật hoặc khi cặp kẹt hoàn toàn quá 5 phút; mọi lần can thiệp phải ghi vào cột `facilitator_intervention` và `intervention_category`.
4. **Hai người chơi ngồi tách nhau**, nói chuyện qua thoại, không nhìn màn hình nhau. Nếu ngồi chung, toàn bộ giả thuyết về information split không kiểm chứng được.
5. **Không PII trong dữ liệu.** Người chơi là `A01`, `A02`, `A03`. Cột ghi chú có hậu tố `_no_pii` là ràng buộc, không phải gợi ý.
6. **Ba cặp chỉ đủ để Kill hoặc Iterate.** Không được kết luận Scale từ ba cặp, kể cả khi cả ba đều tốt.

## Tiêu chí quyết định

| Chỉ số | Cách đo | Kill | Iterate | Đạt |
|---|---|---|---|---|
| Hoàn thành case | quan sát | 0/3 cặp | 1–2/3 | 3/3 |
| Hiểu vai của mình | hỏi sau buổi, thang 1–5 | trung bình < 2,5 | 2,5–3,9 | ≥ 4,0 |
| Nói ra chi tiết riêng trước joint review | cột `private_detail_spoken_before_review` | 0 lần ở cả 3 cặp | thưa thớt | xảy ra đều đặn |
| Chênh thời gian chờ hai vai | `waitingMsByRole` từ plan 013 | > 40% | 15–40% | < 15% |
| Số lần điều phối viên phải can thiệp vì kẹt | cột `facilitator_intervention` | > 3 lần/cặp | 1–3 | ≤ 1 |
| Lỗi kỹ thuật chặn tiến trình | cột `technical_error` | ≥ 1 lỗi chặn ở cả 3 cặp | rải rác | 0 |

**Quy tắc đọc:** một ô Kill ở "hoàn thành case" hoặc "hiểu vai" → Kill. Còn lại, đa số ô Iterate → Iterate.

## Steps

### Step 1: Viết giao thức

Tạo `docs/playtest/V3_PLAYTEST_PROTOCOL_VI.md` gồm: mục tiêu, thiết lập phòng, kịch bản 45 phút (5 phút giới thiệu, 35 phút chơi, 5 phút phỏng vấn), bộ câu hỏi trước/sau, bảng tiêu chí ở trên nguyên văn, và quy tắc can thiệp.

Câu hỏi sau buổi tối thiểu:
- "Vai của bạn làm gì trong case này?" (chấm 1–5 theo mức khớp thiết kế)
- "Có lúc nào bạn phải hỏi đồng đội mới đi tiếp được không? Kể một lúc cụ thể."
- "Có lúc nào bạn ngồi chờ mà không biết làm gì không? Bao lâu?"
- "Bạn có muốn chơi case thứ hai không?" (có/không, một câu lý do)

**Verify**: file tồn tại, chứa bảng tiêu chí, và **được ghi vào git trước buổi đầu tiên**.

### Step 2: Chốt build và môi trường

Ghi lại `git rev-parse --short HEAD`, checksum của case sandbox, locale dùng cho từng cặp (2 cặp `vi`, 1 cặp `en` để lộ vấn đề bản dịch). Bật `GameplayV3__Enabled` và `PlaytestInstrumentationEnabled`. Xác nhận `/health` healthy và seed sandbox thành công.

**Verify**: đăng nhập hai tài khoản test, vào được lobby, chọn hai vai, start được một trận thử của chính người điều phối.

### Step 3: Chạy cặp A01

Chạy đúng giao thức. Ghi CSV mỗi 30 giây. Sau buổi, xuất `GET /api/admin/playtest/summary` cho khoảng thời gian buổi đó và lưu kèm.

**Verify**: CSV có đủ dòng cho toàn bộ thời lượng; summary trả số khác 0.

### Step 4: Chạy cặp A02 và A03

Giống Step 3. **Không sửa gì giữa các buổi.** Nếu phát hiện lỗi chặn, ghi lại và vẫn chạy tiếp cặp còn lại trên cùng build — dữ liệu về lỗi đó cũng là kết quả.

**Verify**: 3 session trong CSV, mỗi session có summary tương ứng.

### Step 5: Viết kết luận

Tạo `docs/playtest/V3_PLAYTEST_RESULT_<ngày>_VI.md`:

- Bảng tiêu chí với số thật điền vào từng ô.
- **Một** quyết định: Kill / Iterate / Scale, viết ở dòng đầu tiên.
- Nếu Iterate: liệt kê tối đa 5 thay đổi cụ thể, xếp theo tác động, mỗi thay đổi nêu rõ quan sát nào dẫn tới nó.
- Danh sách lỗi kỹ thuật đã gặp, mỗi lỗi kèm mức chặn hay không chặn.
- Mục "Chưa kiểm chứng được" — thành thật liệt kê những gì ba buổi không trả lời được.

**Verify**: mọi ô trong bảng tiêu chí có số hoặc chữ "không quan sát được"; không ô nào để trống.

### Step 6: Cập nhật roadmap theo kết quả

- **Kill** → dừng mở feature P2/P3; mở một plan redesign core loop.
- **Iterate** → mở plan cho tối đa 5 thay đổi ở Step 5, chạy lại 3–5 cặp mới sau khi xong.
- **Đạt** → vẫn **chưa** phải Scale; ghi nhận và chuẩn bị đợt 5 cặp tiếp theo để đạt mốc 8–12 cặp.

Cập nhật `plans/README.md` và mục rủi ro trong `plans/ROADMAP_2026-07-27_VI.md`.

**Verify**: `plans/README.md` phản ánh đúng quyết định; nếu Kill hoặc Iterate thì các plan P2 bị đánh dấu `BLOCKED` kèm lý do một dòng.

## Test plan

Plan này không có test tự động. Cổng chất lượng là:

- Ba session hoàn chỉnh trong CSV, cùng `build_commit`.
- Ba bản xuất summary từ endpoint plan 013.
- Một file kết luận với đủ ô đã điền.
- Không có PII trong bất kỳ file nào đã commit.

## Done criteria

- [ ] `V3_PLAYTEST_PROTOCOL_VI.md` được commit **trước** buổi đầu tiên.
- [ ] 3 cặp đã chạy trên cùng một commit.
- [ ] CSV có 3 session thật, ngoài session mẫu `A01` cũ.
- [ ] Có số liệu chênh thời gian chờ giữa hai vai.
- [ ] File kết luận nêu đúng một quyết định Kill/Iterate/Scale ở dòng đầu.
- [ ] `plans/README.md` và roadmap cập nhật theo quyết định đó.
- [ ] Không có PII trong dữ liệu đã commit.

## STOP conditions

- Plan 013 chưa xong → dừng; không chạy ba buổi mà không có số liệu định lượng, vì ba cặp là nguồn lực đắt và không lặp lại được với người mới.
- Lỗi kỹ thuật chặn ngay buổi đầu tiên khiến cặp A01 không chơi được → dừng, sửa lỗi, và **bắt đầu lại từ A01** trên build mới. Không trộn dữ liệu của hai build.
- Không tìm đủ ba cặp người chơi chưa từng biết case → dừng; người đã biết đáp án không đo được comprehension.

## Maintenance notes

Giữ CSV là nguồn dữ liệu thô duy nhất và không sửa các dòng cũ khi chạy đợt sau — thêm session mới với `build_commit` mới. So sánh giữa các đợt chỉ có nghĩa khi cột `build_commit` và `sandbox_checksum` được điền trung thực.
