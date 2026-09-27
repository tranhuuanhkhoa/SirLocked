# SIRLOCKED — GIAO THỨC PLAYTEST V3 (BA CẶP)

**Ngày viết:** 27/07/2026
**Phạm vi:** `mechanicsVersion = 3`, sandbox `case-v3-broken-seal-en` / `case-v3-broken-seal-vi`
**Trạng thái:** viết trước buổi đầu tiên, theo `plans/014-run-v3-playtest-gate.md` Step 1
**Nguồn dữ liệu thô:** `docs/playtest/V3_30_SECOND_OBSERVATION.csv`

Tài liệu này phải được ghi vào git **trước** buổi playtest đầu tiên. Ngưỡng quyết định định sau khi đã nhìn thấy số liệu là tự lừa mình.

---

## 1. Mục tiêu và phạm vi

### 1.1 Câu hỏi cần trả lời

Giả thuyết cốt lõi của Crack the Lie: **information split buộc hai người phải nói chuyện với nhau, và cuộc nói chuyện đó là phần vui**. Ba buổi này kiểm chứng bốn điều:

1. **Comprehension** — người chơi có hiểu vai của mình làm gì không, mà không cần được dạy.
2. **Communication** — có tồn tại thời điểm người chơi *phải* hỏi đồng đội mới đi tiếp được không, và họ có tự nói ra chi tiết riêng trước joint review không.
3. **Waiting** — có vai nào ngồi chờ mà không biết làm gì không, và chênh lệch giữa hai vai bao nhiêu.
4. **Blocking** — có lỗi kỹ thuật nào chặn tiến trình không.

### 1.2 Ngoài phạm vi

- Không đo "vui" bằng thang tuyệt đối. Chỉ đo proxy: có muốn chơi case thứ hai không.
- Không đo balance nội dung, độ khó, hay chất lượng bản dịch ngoài những gì lộ ra tự nhiên.
- Không kiểm thử performance, load, hay bảo mật.
- **Ba cặp chỉ đủ để kết luận Kill hoặc Iterate.** Không được kết luận Scale từ ba cặp, kể cả khi cả ba đều tốt. Mốc Scale là 8–12 cặp, theo quyết định số 8 trong `docs/CORE_GAMEPLAY_FEASIBILITY_AUDIT_VI.md`.

---

## 2. Thiết lập

### 2.1 Build đóng băng

Ba buổi dùng **cùng một commit** và **cùng checksum sandbox**. Sửa code hoặc sửa nội dung case giữa chừng thì các buổi trước không so sánh được với nhau nữa.

Trước buổi đầu tiên, điều phối viên ghi lại:

```powershell
git rev-parse --short HEAD
```

Giá trị này điền vào cột `build_commit` của **mọi** dòng CSV trong cả ba buổi. Checksum sandbox điền vào `sandbox_checksum`, cũng giữ nguyên cho cả ba buổi.

Nếu buộc phải sửa code giữa chừng (chỉ khi chạm STOP condition), toàn bộ đợt bắt đầu lại từ cặp A01 trên build mới. **Không trộn dữ liệu của hai build.**

### 2.2 Bố trí người chơi

- Hai người chơi ngồi **tách nhau**, không nhìn được màn hình của nhau.
- Giao tiếp **chỉ qua thoại** (cùng phòng nhưng quay lưng, hoặc hai phòng + Discord/thoại). Không chat text, không chia sẻ màn hình.
- Nếu hai người ngồi chung nhìn chung một màn hình, buổi đó **không hợp lệ** — toàn bộ giả thuyết information split không kiểm chứng được.
- Điều phối viên ngồi ở vị trí quan sát được cả hai màn hình và nghe được thoại, nhưng không tham gia.
- Điều kiện tuyển: chưa từng biết đáp án của case. Người đã biết đáp án không đo được comprehension.

### 2.3 Phân bổ locale

| Cặp | Locale | Case |
|---|---|---|
| A01 | `vi` | `case-v3-broken-seal-vi` |
| A02 | `vi` | `case-v3-broken-seal-vi` |
| A03 | `en` | `case-v3-broken-seal-en` |

Một cặp `en` là cố ý: để lộ vấn đề bản dịch và chuỗi thiếu i18n mà hai cặp `vi` không thấy được.

### 2.4 Tài khoản test

- Dùng tài khoản riêng cho playtest, không dùng tài khoản cá nhân của ai.
- Đặt tên theo cặp và vai, ví dụ `playtest-a01-inv`, `playtest-a01-int`. Không dùng tên thật, email thật, hay avatar cá nhân.
- Một tài khoản admin riêng cho điều phối viên để seed sandbox và gọi endpoint summary.
- Tài khoản test phải được reset (chưa có progress trên case sandbox) trước mỗi buổi.

### 2.5 Chuẩn bị môi trường

Chạy theo thứ tự, trước khi người chơi tới:

| Bước | Lệnh / thao tác | Kỳ vọng |
|---|---|---|
| 1 | `docker compose up -d` | Mongo sẵn sàng |
| 2 | Đặt `GameplayV3__Enabled=true`, `GameplayV3__PlaytestInstrumentationEnabled=true` | cờ bật |
| 3 | `cd src/BE; dotnet run` | `http://localhost:5215/health` trả healthy |
| 4 | `cd src/FE; npm run dev` | `http://localhost:5173` mở được |
| 5 | Seed sandbox | xem 2.6 |
| 6 | Trận thử của chính điều phối viên | vào lobby, chọn hai vai, start được một trận |

### 2.6 Seed sandbox

Đăng nhập bằng tài khoản admin, lấy JWT, rồi gọi:

```
POST /api/admin/cases/seed-crack-demo
Authorization: Bearer <jwt-admin>
```

Endpoint validate, upsert và publish đúng hai case bundled `case-v3-broken-seal-en` và `case-v3-broken-seal-vi`. Response là `ApiResponse<CaseSummaryResponse[]>` với 2 phần tử ở trạng thái published.

Endpoint **không** chạy tự động lúc khởi động, nên phải gọi tay sau mỗi lần dựng lại database. Sau khi seed, ghi checksum sandbox và giữ nguyên cho cả ba buổi.

---

## 3. Kịch bản 45 phút

Tổng 45 phút mỗi cặp. Điều phối viên bấm giờ và bám sát mốc; nếu vượt 35 phút chơi thì dừng và ghi là chưa hoàn thành, không kéo dài.

### 3.1 Giới thiệu — 5 phút

Điều phối viên đọc gần đúng nguyên văn, **không** thêm hướng dẫn cách chơi:

> "Đây là một game trinh thám hai người. Mỗi người có một vai riêng và nhìn thấy thông tin khác nhau. Hai bạn ngồi tách nhau và chỉ nói chuyện bằng lời, không được nhìn màn hình nhau. Mục tiêu của buổi hôm nay là xem game có tự giải thích được không, nên mình sẽ **không** hướng dẫn cách chơi. Nếu gặp lỗi kỹ thuật thì cứ nói, mình sẽ xử lý. Còn nếu bí thì cứ bí, đó cũng là dữ liệu. Buổi này được ghi chú lại nhưng không ghi tên các bạn ở bất cứ đâu."

Sau đó hỏi bộ câu hỏi trước buổi (mục 4.1) và ghi lại đáp án.

### 3.2 Chơi — 35 phút

- Đồng hồ bắt đầu tính từ lúc cả hai vào phòng và trận bắt đầu. `elapsed_seconds = 0` tại thời điểm này.
- Điều phối viên ghi một dòng CSV **mỗi 30 giây**, liên tục, kể cả khi không có gì xảy ra.
- Điều phối viên không trả lời câu hỏi về nội dung, không gợi ý, không xác nhận suy đoán đúng/sai. Xem quy tắc can thiệp ở mục 6.
- Nếu cặp hoàn thành case trước 35 phút: dừng đồng hồ, ghi `elapsed_seconds` cuối cùng, chuyển sang phỏng vấn sớm.
- Nếu hết 35 phút mà chưa xong: dừng, ghi trạng thái tại thời điểm dừng vào `observer_notes_no_pii`, chuyển sang phỏng vấn.

### 3.3 Phỏng vấn — 5 phút

Hỏi riêng từng người nếu có thể, hoặc hỏi chung nhưng cho từng người trả lời trước khi người kia nói. Dùng đúng bộ câu hỏi ở mục 4.2. Không dẫn dắt, không giải thích đáp án case trước khi hỏi xong.

Sau phỏng vấn mới được giải thích case và nhận feedback tự do (phần này không tính vào dữ liệu định lượng).

### 3.4 Sau buổi

Xuất số liệu định lượng cho đúng khoảng thời gian buổi đó:

```
GET /api/admin/playtest/summary
```

Lưu response kèm session, dùng cho ô "chênh thời gian chờ hai vai" trong bảng tiêu chí.

---

## 4. Bộ câu hỏi

### 4.1 Trước buổi

Hỏi cả hai người, ghi đáp án ngắn gọn, không PII:

1. "Bạn có hay chơi game co-op hai người không?" (không / thỉnh thoảng / thường xuyên)
2. "Bạn đã từng chơi game trinh thám hoặc escape room chưa?" (có / không)
3. "Bạn đã từng nghe về case này hoặc đáp án của nó chưa?" — nếu **có**, dừng, đổi người chơi.
4. "Bạn đọc tiếng Anh thoải mái không?" — chỉ hỏi với cặp `en`.
5. "Trước khi bắt đầu, bạn đoán vai của mình sẽ làm gì?" — ghi nguyên văn ngắn, dùng để đối chiếu với câu hỏi sau buổi.

### 4.2 Sau buổi — bắt buộc tối thiểu

Bốn câu này là **bắt buộc**, hỏi nguyên văn, hỏi cho **từng người**:

1. **"Vai của bạn làm gì trong case này?"** — chấm 1–5 theo mức khớp thiết kế (thang ở 4.3).
2. **"Có lúc nào bạn phải hỏi đồng đội mới đi tiếp được không? Kể một lúc cụ thể."**
3. **"Có lúc nào bạn ngồi chờ mà không biết làm gì không? Bao lâu?"**
4. **"Bạn có muốn chơi case thứ hai không?"** (có / không, kèm một câu lý do)

### 4.3 Thang chấm câu hỏi 1 (comprehension)

Điều phối viên chấm ngay sau khi nghe, không sửa lại về sau:

| Điểm | Mô tả |
|---|---|
| 5 | Mô tả đúng vai, đúng loại thông tin mình giữ riêng, và đúng vai trò của mình trong joint review |
| 4 | Đúng vai và đúng loại thông tin riêng, mờ ở phần joint review |
| 3 | Đúng vai nhưng không nêu được thông tin nào là riêng của mình |
| 2 | Mô tả chung chung ("đi tìm manh mối"), không phân biệt được với vai kia |
| 1 | Sai vai, hoặc không trả lời được |

Điểm của một buổi = trung bình hai người. Điểm của cả đợt = trung bình sáu người.

### 4.4 Câu hỏi phụ (hỏi nếu còn thời gian)

- "Lúc nào bạn thấy bối rối nhất?"
- "Có thông tin nào bạn muốn thấy mà game không cho thấy không?"
- "Bạn có tin đồng đội đọc đúng thông tin của họ không?" (chỉ hỏi khi đã có tranh cãi trong lúc chơi)

---

## 5. Tiêu chí quyết định

Bảng dưới đây **sao nguyên văn** từ `plans/014-run-v3-playtest-gate.md` mục "Tiêu chí quyết định". Không được sửa ngưỡng sau khi đã thấy số liệu.

| Chỉ số | Cách đo | Kill | Iterate | Đạt |
|---|---|---|---|---|
| Hoàn thành case | quan sát | 0/3 cặp | 1–2/3 | 3/3 |
| Hiểu vai của mình | hỏi sau buổi, thang 1–5 | trung bình < 2,5 | 2,5–3,9 | ≥ 4,0 |
| Nói ra chi tiết riêng trước joint review | cột `private_detail_spoken_before_review` | 0 lần ở cả 3 cặp | thưa thớt | xảy ra đều đặn |
| Chênh thời gian chờ hai vai | `waitingMsByRole` từ plan 013 | > 40% | 15–40% | < 15% |
| Số lần điều phối viên phải can thiệp vì kẹt | cột `facilitator_intervention` | > 3 lần/cặp | 1–3 | ≤ 1 |
| Lỗi kỹ thuật chặn tiến trình | cột `technical_error` | ≥ 1 lỗi chặn ở cả 3 cặp | rải rác | 0 |

**Quy tắc đọc:** một ô Kill ở "hoàn thành case" hoặc "hiểu vai" → Kill. Còn lại, đa số ô Iterate → Iterate.

Bổ sung ba ràng buộc khi áp dụng bảng:

- Mỗi ô phải có **số thật** hoặc chữ "không quan sát được". Không để trống, không suy luận từ code.
- Ô "Đạt" **không** có nghĩa là Scale. Ba cặp chỉ đủ để kết luận Kill hoặc Iterate; "Đạt" nghĩa là được phép chuẩn bị đợt 5 cặp tiếp theo.
- Quyết định cuối cùng viết ở **dòng đầu tiên** của `docs/playtest/V3_PLAYTEST_RESULT_<ngày>_VI.md`, đúng một trong ba: Kill / Iterate / Scale.

---

## 6. Quy tắc can thiệp của điều phối viên

### 6.1 Nguyên tắc

Điều phối viên **không dạy cách chơi**. Chỉ được can thiệp trong đúng hai trường hợp:

1. **Lỗi kỹ thuật** — game crash, mất kết nối, state kẹt, nút không phản hồi.
2. **Kẹt hoàn toàn quá 5 phút** — cả hai người không thực hiện bất kỳ hành động có ý nghĩa nào và không trao đổi hướng đi mới, liên tục hơn 5 phút.

Không can thiệp khi: người chơi đoán sai, cãi nhau, im lặng nhưng vẫn đang đọc, hoặc hỏi điều phối viên một câu về nội dung. Với câu hỏi nội dung, trả lời đúng một câu: *"Cái đó mình không trả lời được, hai bạn tự bàn nhé."* — câu này **không** tính là can thiệp.

### 6.2 Mức can thiệp, dùng thang thấp nhất trước

| Mức | Nội dung | Ghi vào `intervention_category` |
|---|---|---|
| 1 | Sửa lỗi kỹ thuật, reload trang, reconnect | `TECHNICAL` |
| 2 | Nhắc lại luật giao tiếp (ngồi tách, chỉ nói bằng lời) | `PROTOCOL` |
| 3 | Nhắc chung chung về UI, không nhắc nội dung ("thử xem sổ tay của bạn") | `UI_HINT` |
| 4 | Gợi ý hướng nội dung — chỉ khi kẹt > 5 phút và mức 3 đã thất bại | `CONTENT_HINT` |

Một buổi phải dùng tới mức 4 nhiều hơn ba lần là tín hiệu Kill theo bảng tiêu chí; không được "cứu" buổi bằng cách gợi ý thêm.

### 6.3 Ghi lại

Mỗi lần can thiệp:

- Cột `facilitator_intervention` của dòng 30 giây đang chạy: ghi **số lần can thiệp xảy ra trong khoảng 30 giây đó** (0 nếu không có).
- Cột `intervention_category`: ghi nhãn ở bảng 6.2. Nếu trong cùng một khoảng có nhiều loại, ghi loại **cao nhất**. Nếu không có can thiệp, ghi `NONE`.
- Cột `observer_notes_no_pii`: một câu mô tả vì sao phải can thiệp, không nêu tên người.

Tổng số lần can thiệp của một cặp = tổng cột `facilitator_intervention` của session đó, **chỉ tính** các dòng có `intervention_category` khác `TECHNICAL` khi đối chiếu với ô "can thiệp vì kẹt" trong bảng tiêu chí. Can thiệp `TECHNICAL` được đối chiếu với ô "lỗi kỹ thuật".

---

## 7. Hướng dẫn điền CSV

Nguồn dữ liệu thô duy nhất: `docs/playtest/V3_30_SECOND_OBSERVATION.csv`.

Quy tắc chung:

- Một dòng mỗi **30 giây**, liên tục từ `elapsed_seconds = 0` tới lúc kết thúc. Khoảng nào không quan sát được thì để trống ô nội dung, **không** bỏ dòng.
- Không sửa các dòng cũ khi chạy đợt sau. Đợt mới thêm session mới với `build_commit` mới.
- Session mẫu `A01` với 2 dòng hiện có là dòng định nghĩa schema. Khi chạy thật, ghi đè phần dữ liệu của A01 bằng dữ liệu thật hoặc dùng lại đúng `session_id` A01 cho cặp thật — nhưng phải nhất quán và ghi rõ trong file kết luận.
- Ô chứa dấu phẩy phải bọc trong dấu nháy kép.

### 7.1 Hai mươi mốt cột, đúng thứ tự header

| # | Cột | Kiểu | Ý nghĩa và cách điền |
|---:|---|---|---|
| 1 | `session_id` | text | Mã cặp: `A01`, `A02`, `A03`. Không bao giờ là tên người. |
| 2 | `build_commit` | text | `git rev-parse --short HEAD` chốt trước buổi đầu tiên. Giống nhau ở cả ba session của một đợt. |
| 3 | `sandbox_locale` | `vi` \| `en` | Locale case dùng trong buổi. A01/A02 = `vi`, A03 = `en`. |
| 4 | `sandbox_checksum` | hex | Checksum của case sandbox đã seed. Giống nhau ở cả ba session; khác nghĩa là nội dung đã đổi và dữ liệu không so sánh được. |
| 5 | `elapsed_seconds` | số nguyên | Giây kể từ lúc trận bắt đầu. Tăng đều 30 mỗi dòng: 0, 30, 60, … |
| 6 | `investigator_action` | nhãn | Hành động chính của Investigator trong khoảng 30 giây đó. Bộ nhãn ở 7.2. Để trống nếu không quan sát được. |
| 7 | `investigator_actionable` | 0 \| 1 | 1 nếu Investigator **có** việc có nghĩa để làm trong khoảng đó (có thể hành động, không bị chặn chờ đối phương); 0 nếu không. |
| 8 | `interrogator_action` | nhãn | Như cột 6, cho Interrogator. |
| 9 | `interrogator_actionable` | 0 \| 1 | Như cột 7, cho Interrogator. |
| 10 | `communication_state` | nhãn | Trạng thái trao đổi bằng lời trong khoảng đó. Bộ nhãn ở 7.3. |
| 11 | `private_detail_spoken_before_review` | số nguyên | Số lần trong khoảng đó một người **tự nói ra** một chi tiết chỉ mình mình thấy, **trước** khi vào joint review. Đây là chỉ số communication cốt lõi; đếm chặt, chỉ tính khi nội dung được nói ra cụ thể, không tính "tôi có cái này hay lắm". |
| 12 | `joint_review_revision` | số nguyên | Số `revision` của joint review đang hiện trên màn hình tại cuối khoảng. Để trống khi chưa vào joint review. |
| 13 | `waiting_role` | `NONE` \| `INVESTIGATOR` \| `INTERROGATOR` \| `BOTH` | Vai đang ở trạng thái chờ không làm gì được trong khoảng đó. `NONE` nếu cả hai đều có việc. |
| 14 | `waiting_episode_seconds` | số nguyên | Độ dài **tích lũy** của đợt chờ hiện tại tính tới cuối khoảng, theo giây. Reset về 0 khi vai đó hành động trở lại. Đợt chờ > 45 giây là tín hiệu cảnh báo theo giả thuyết idle. |
| 15 | `wrong_pair_count` | số nguyên | Tổng số lần cặp submit sai (wrong pair) tính từ đầu trận tới cuối khoảng — giá trị cộng dồn, không phải trong khoảng. |
| 16 | `edit_count` | số nguyên | Tổng cộng dồn số lần chỉnh sửa đề xuất/testimony sau khi đã đưa vào review. Dùng để đo cặp có thực sự thương lượng hay chỉ chốt một lần. |
| 17 | `clarification_count` | số nguyên | Số lần trong khoảng đó một người hỏi lại đồng đội để làm rõ ("ý bạn là gì", "đọc lại giúp mình"). Đếm theo khoảng, không cộng dồn. |
| 18 | `facilitator_intervention` | số nguyên | Số lần điều phối viên can thiệp trong khoảng đó. 0 nếu không có. Xem mục 6. |
| 19 | `intervention_category` | nhãn | `NONE` \| `TECHNICAL` \| `PROTOCOL` \| `UI_HINT` \| `CONTENT_HINT`. Nhiều loại trong một khoảng thì ghi loại cao nhất. |
| 20 | `technical_error` | số nguyên | Số lỗi kỹ thuật quan sát được trong khoảng đó. Mức chặn hay không chặn mô tả ở cột 21 và tổng hợp lại trong file kết luận. |
| 21 | `observer_notes_no_pii` | text tự do | Ghi chú ngắn, **không PII**. Mô tả hành vi và trạng thái game, không mô tả con người. Để trống khi không có gì đáng ghi. |

### 7.2 Bộ nhãn cho `investigator_action` / `interrogator_action`

| Nhãn | Nghĩa |
|---|---|
| `ORIENTING` | Đọc, xem xét, định hướng; chưa thao tác |
| `EXPLORING` | Di chuyển scene, mở item, chụp ảnh, tương tác |
| `READING_PRIVATE` | Đọc sổ tay/thông tin riêng của vai mình |
| `PROPOSING` | Chọn/đưa evidence hoặc testimony vào đề xuất |
| `REVIEWING` | Đang ở joint review, đọc hoặc sửa đề xuất chung |
| `CONFIRMING` | Thao tác xác nhận/submit |
| `WAITING` | Không có việc làm được, đang chờ đối phương |
| `BLOCKED` | Muốn hành động nhưng bị lỗi kỹ thuật chặn |
| `IDLE_LOST` | Không chờ ai nhưng không biết làm gì |

Để trống nếu khoảng đó không quan sát được. Không tự thêm nhãn mới giữa đợt; nếu thấy hành vi không khớp nhãn nào, dùng nhãn gần nhất và mô tả ở cột 21.

### 7.3 Bộ nhãn cho `communication_state`

| Nhãn | Nghĩa |
|---|---|
| `NONE` | Không ai nói gì trong khoảng đó |
| `SMALL_TALK` | Có nói nhưng không liên quan tới case |
| `STATUS` | Trao đổi trạng thái ("mình xong rồi", "chờ mình tí") |
| `SHARING` | Một người mô tả nội dung riêng của mình cho người kia |
| `NEGOTIATING` | Hai người bàn để chọn giữa các khả năng |
| `CONFLICT` | Hai người bất đồng và chưa giải quyết được |

---

## 8. Ràng buộc không-PII

Đây là ràng buộc, không phải gợi ý. Áp dụng cho CSV, file kết luận, và mọi ảnh chụp màn hình đính kèm.

**Không được xuất hiện trong bất kỳ file nào được commit:**

- Tên thật, biệt danh, email, số điện thoại, handle mạng xã hội của người chơi.
- Ảnh mặt, giọng nói, bản ghi âm, bản ghi hình.
- Tuổi, giới tính, nơi làm việc, quan hệ giữa hai người chơi.
- Nội dung câu nói dẫn tới nhận dạng được người cụ thể.
- Username của tài khoản cá nhân — chỉ dùng tài khoản test ở mục 2.4.

**Được phép:**

- Mã cặp `A01`/`A02`/`A03` và vai `INVESTIGATOR`/`INTERROGATOR`.
- Mô tả hành vi ẩn danh: "Interrogator hỏi lại hai lần rồi tự mở sổ tay".
- Trích dẫn ngắn không định danh, diễn đạt lại thay vì nguyên văn khi có thể.

Cột `observer_notes_no_pii` có hậu tố `_no_pii` để nhắc chính điều này. Trước khi commit, đọc lại toàn bộ cột đó một lượt và xóa mọi thứ có thể lần ra người thật. Ghi âm/ghi hình, nếu có, chỉ tồn tại cục bộ trong lúc phân tích và bị xóa sau khi điền xong CSV; không đưa vào repo.

---

## 9. Danh mục kiểm tra trước mỗi buổi

- [ ] `build_commit` và `sandbox_checksum` đã chốt, giống hệt các buổi trước.
- [ ] `GameplayV3__Enabled=true` và `GameplayV3__PlaytestInstrumentationEnabled=true`.
- [ ] `/health` healthy; seed sandbox trả 2 case published.
- [ ] Điều phối viên đã chạy một trận thử, vào lobby và chọn được hai vai.
- [ ] Hai tài khoản test đã reset, không có progress trên case sandbox.
- [ ] Hai người chơi ngồi tách nhau, chỉ nói bằng thoại.
- [ ] Cả hai đã xác nhận chưa biết đáp án case.
- [ ] Đồng hồ 30 giây và file CSV mở sẵn.
- [ ] Đã đọc lại mục 6 — điều phối viên không dạy cách chơi.
