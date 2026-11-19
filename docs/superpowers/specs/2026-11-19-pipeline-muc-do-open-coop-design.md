# Form đặt vụ mới và pipeline tạo vụ theo mức độ (OPEN_COOP)

Ngày: 19/11/2026. Nền: `origin/feature/kiet-auth-validation` (bản đang chạy trên sirlocked.id.vn). Bản phác form: `.superpowers/brainstorm/1563-1795020811/content/form-layout.html` (bố cục A).

## Vì sao

Vụ do AI tạo đang ra kiểu cũ: vụ "Toa cáp treo trống" có các chặng mở dần, câu đố nhập mã / xếp thứ tự, không có bảng Hồ sơ vụ án và không có cảnh mở đầu. Trong khi đó các màn làm tay mới ("Màn tân thủ", "Trâm hồng ngọc") chạy luật `OPEN_COOP`: mở mọi nơi từ đầu, câu đố tương tác (ghép giấy rách, mở khóa, dấu vân tay…), bảng Hồ sơ vụ án, cảnh mở đầu. Chủ dự án muốn vụ AI ra **cùng chuẩn** với các màn đó.

Nguyên nhân đã kiểm trong code:

- Độ khó chỉ là một chữ `easy/medium/hard` chèn vào prompt; không quy định cứng nào theo nó. Kiểu đơn (preset) còn ghi đè độ khó (`AiCaseService.cs:620`).
- Bước chiếu lối chơi dựng vụ nhiều chặng tuyến tính (`GameplayProjectionPlanner.cs:212`) và xoay vòng 3 loại câu đố cũ (`GameplayProjectionPlanner.Mechanics.cs:148`).
- Giới hạn nghi phạm tính theo số chặng (`AiTruthGenerationBudget.cs`), nên vụ một chặng chỉ còn 3 nghi phạm (vụ cáp treo mất anh phóng viên vì vậy).
- Cảnh mở đầu chỉ tạo khi admin bấm tay (`AdminCutscenesController`), không nằm trong pipeline.

Form đặt vụ trên `/admin/ai` cũng rối: nhiều ô ghi đè nhau (số chặng, số nghi phạm, thời lượng, 6 kiểu đơn, nút V3 Crack), khung lồng khung, nhìn máy móc.

## Mục tiêu

1. **Mức độ quyết định cỡ vụ.** Ba mức Dễ, Trung bình, Khó, mỗi mức một bộ thông số cứng; "Khó" là vụ to hơn và dài hơn.
2. **Mọi đơn mới ra vụ `OPEN_COOP`** có câu đố tương tác (phần thưởng phụ), bảng Hồ sơ vụ án, đối chất V3 và cảnh mở đầu tự tạo.
3. **Form đặt vụ một trang, gọn, đẹp** (bố cục A), không ô nào ghi đè ô nào; số trên form luôn khớp với server.
4. Bản nháp đang dở chạy tiếp như cũ.

## Không làm (đợt này)

- Góc nhìn cận cảnh "zoom vào bàn / bảng ghim": tính năng game mới, đợt sau.
- Làm lại phần theo dõi bản nháp (danh sách, trang chi tiết, cổng duyệt, thẻ quyết định): đợt sau, cùng thiết kế bot chạy nhiều máy (`2026-11-18-bot-nhieu-may-design.md`).
- Viết pipeline song song mới (cách 2) hay khung cố định theo màn làm tay (cách 3).
- Chuyển bản nháp cũ sang chuẩn mới.
- Cho bot tự giải câu đố tương tác trong bước chạy thử.

## Điều không được xảy ra

- Form hiện một con số, server làm theo con số khác.
- Một ô trên form âm thầm đổi giá trị ô khác.
- Câu đố chặn đường phá án: không giải câu đố nào vẫn phải buộc tội đúng được.
- Chứng cứ chỉ có được từ câu đố lại là chứng cứ duy nhất của một điều kiện buộc tội.
- Đáp án câu đố gắn với sự thật (vân tay, sửa giấy tờ, mã thị sai) bị AI bịa, không theo sự thật đã duyệt ở cổng TRUTH.
- Bản nháp đang dở (ví dụ "Toa cáp treo trống") bị hỏng hay đổi luật giữa chừng.
- Bot publish hay tự duyệt cổng TRUTH (luật cũ giữ nguyên).

## Cách làm đã chọn

| | Cách | Được | Mất |
|---|---|---|---|
| **1 (chọn)** | **Nâng tại chỗ; một "hồ sơ mức độ" trên server làm chuẩn duy nhất** cho form, ngân sách sự thật, prompt, bước chiếu lối chơi và validator | Sửa đúng gốc; giữ các bước và 4 cổng duyệt; bản nháp cũ chạy tiếp | Phải sửa nhiều chỗ của pipeline cùng lúc |
| 2 | Pipeline "V4" mới chạy song song, pipeline cũ đóng băng | Prompt sạch | Nhân đôi validator, bước bridge, skill; bảo trì hai pipeline |
| 3 | Khung cố định cho mỗi mức theo màn làm tay, AI chỉ điền truyện | Dễ đoán | Vụ giống nhau về cấu trúc; ngược với thế giới mới, truyện ngẫu nhiên |

## Thiết kế

### 1. Hồ sơ mức độ (server, nguồn duy nhất)

Một lớp tĩnh (ví dụ `AiDifficultyProfiles`) giữ bảng sau. Mọi nơi khác đọc từ đây, không tự đặt số.

| | Dễ (`easy`) | Trung bình (`medium`) | Khó (`hard`) |
|---|---|---|---|
| Thời gian chơi (hiện trên form; `estimatedMinutes` của vụ) | 10–15 phút (12) | 20–30 phút (25) | 40–60 phút (50) |
| Số cảnh | 2–3 | 4–5 | 6–8 |
| Nghi phạm | 3 | 4 | 5 |
| Lần đối chất V3 (`evidenceChallenges`) | 1 | 2 | 3 |
| Câu đố phụ | 1–2 | 2–3 | 4–6 |
| Chứng cứ gây nhiễu | 0–1 | 1–2 | 2–3 |
| Chứng cứ cần để buộc tội | 2 | 3 | 4, phải nối qua suy luận |
| Gợi ý (`hints`, mỗi cảnh, mỗi câu đố, mỗi đối chất) | 3 mức | 3 mức | 2 mức |
| Độ khó câu đố (`PuzzleDefinition.Difficulty`) | EASY | NORMAL | HARD |

- **"Thiên về"** chỉ nghiêng trong khoảng của mức, không vượt ra: *Cân bằng* lấy giữa khoảng; *Giải đố nhiều hơn* lấy mức trên của câu đố phụ; *Hội thoại nhiều hơn* lấy mức dưới của câu đố phụ và thêm nhánh hội thoại.
- `GET /api/ai/difficulty-profiles` (đăng nhập, admin và VIP) trả bảng này cùng **ước lượng lượt PixelLab** theo mức × thế giới (thế giới có thư viện thấp hơn thế giới mới). Form chỉ hiện số từ API này.
- Ngân sách sự thật (`AiTruthGenerationBudget`), `CaseTargetAllocationPolicy.RequiredSuspects`, `ProjectionCapacityPolicy` và hợp đồng sinh vụ (`AiGenerationContract`) lấy số nghi phạm, địa điểm, chứng cứ gây nhiễu, đối chất từ hồ sơ này khi bản nháp thuộc pipeline mới.

### 2. Đơn đặt vụ

- Đơn mới gồm: `difficulty`, `world`, `caseType`, `weather`, `timeOfDay`, `leaning` (`BALANCED | PUZZLE | DIALOGUE`), `idea`, `characterNotes`, và tùy chọn thêm: `locationIds`, `npcIds`, `language`, `contentLevel`, `pixelLabCap` (mặc định `-1` = không giới hạn), `reviewMode` (`FULL | FAST`).
- **Bỏ khỏi đơn mới:** `stageCount`, `suspectCount`, `playMinutes`, `generationPreset`, `includeCrackTheLie`. Server suy ra từ hồ sơ mức độ; gửi lên thì bỏ qua.
- Chuẩn hóa đơn không còn ghi đè: bỏ khối `request.Difficulty = request.GenerationPreset switch …` và `request.StageCount = …` cho pipeline mới.
- Bản nháp mới ghi `pipelineVersion` (ví dụ `"OPEN_COOP_1"`). Bản nháp không có trường này chạy đường cũ nguyên vẹn; các trường cũ vẫn đọc được.
- Đơn VIP dùng cùng đơn và cùng form (VIP đặt đơn ngay trên `/admin/ai`, qua `aiCaseApi.js`).

### 3. Form đặt vụ (bố cục A)

Một cột, không khung lồng khung; các mục cách nhau bằng khoảng trắng và đường kẻ mảnh; màu và font của token `--adm-*` (`60-admin-theme.css`), tiêu đề Playfair Display.

```
Đặt vụ án mới
Chọn mức độ và bối cảnh, bot lo phần còn lại.

MỨC ĐỘ
[ Dễ          ] [ Trung bình    ] [ Khó          ]
  10–15 phút      20–30 phút        40–60 phút
  2–3 cảnh ·      4–5 cảnh ·        6–8 cảnh ·
  3 nghi phạm…    4 nghi phạm…      5 nghi phạm…

THẾ GIỚI   [ảnh] Phố Hàng Đường  [ảnh] Nhật Bản Taishō  [ảnh] Thượng Hải 1930  [ ] Thế giới mới
──────────────────────────────────────────────
Loại vụ     (Ngẫu nhiên) (Án mạng) (Mất tích) (Trộm cắp) (Phá hoại) (Lừa đảo) (Bắt cóc)
Không khí   (Để bot chọn) (Nắng) (Mưa) (Gió) (Tuyết) (Giông)  ·  (Để bot chọn) (Ngày) (Hoàng hôn) (Đêm)
Thiên về    (Cân bằng) (Giải đố nhiều hơn) (Hội thoại nhiều hơn)
Ý tưởng     [ ô chữ ]
▸ Tùy chọn thêm: địa điểm và NPC có sẵn, ghi chú nhân vật, ngôn ngữ, mức nội dung, lượt PixelLab, cách duyệt
┌ Trung bình · Thế giới mới · Bắt cóc                        [ Tạo vụ án ] ┐
└ ~20–30 phút chơi · ước 150–220 lượt PixelLab · duyệt từng cổng          ┘
```

- Ba thẻ mức độ và thanh tóm tắt lấy số từ `GET /api/ai/difficulty-profiles`; đổi lựa chọn thì thanh tóm tắt cập nhật ngay, không ô nào khác đổi theo.
- "Thế giới mới" hiện câu nhắc sẵn có (thế giới mới chưa có ảnh, bot sẽ báo số lượt). Thế giới có thư viện thì "Tùy chọn thêm" có phần chọn địa điểm và NPC như hiện nay.
- "Tùy chọn thêm" gấp lại mặc định, nhớ trạng thái mở trong phiên.
- Thanh tóm tắt dính đáy vùng nội dung khi cuộn; trên điện thoại ba thẻ mức độ xếp dọc, chip tự xuống dòng, lề 16 px.
- Song ngữ qua `tr()` như trang hiện tại; lỗi hiện ngay dưới mục bị lỗi; điều khiển là radio thật (bàn phím, trình đọc màn hình dùng được).
- Bỏ hẳn: nút V3 Crack, các ô số chặng / số nghi phạm / thời lượng, 6 kiểu đơn, khối "Mở rộng gameplay", khung "Bản nháp sẽ tạo" và "Các bước duyệt sau khi tạo" kiểu cũ.

### 4. Pipeline

Các bước và 4 cổng giữ nguyên (STORY → TRUTH → LOGIC → LAYOUT → hình cuối → chấm đối chất V3 → sẵn sàng → nhập vụ). Với bản nháp `pipelineVersion = OPEN_COOP_1`:

- **Sự thật:** đúng số nghi phạm của mức; số địa điểm trong khoảng số cảnh; chứng cứ gây nhiễu trong khoảng của mức.
- **Chiếu lối chơi:** một chặng duy nhất chứa mọi cảnh (số cảnh trong khoảng của mức); `ruleSet = "OPEN_COOP"`; `mechanicsVersion` = V3 đối chất cặp; số `evidenceChallenges` đúng số đối chất của mức; điều kiện buộc tội cần đúng số chứng cứ của mức, mức Khó có ít nhất một suy luận nối.
- **Câu đố:** bước chiếu tạo đúng số ô câu đố của mức (theo "Thiên về"), mỗi ô `type = INTERACTIVE_PUZZLE`, `progressionRole = OPTIONAL`, gắn vào một vật bấm được trong cảnh (`isInteractivePuzzleObject`). AI chọn `kind` hợp truyện trong các loại ở `Services/PuzzleKinds/`, không lặp loại trong một vụ, và chỉ viết phần truyện (lời dẫn, chữ trên vật, điều lộ ra khi giải, lời thành công, gợi ý). Server gọi `IPuzzleKind.Complete` để sinh phần cơ chế và lời giải, rồi `Validate`. Ba loại `fingerprint`, `doc_forgery`, `parallax_code` lấy đáp án từ sự thật đã duyệt. Mỗi câu đố mở một chứng cứ hoặc lời khai củng cố; chứng cứ đó không được là chứng cứ duy nhất của bất kỳ điều kiện buộc tội nào. Bỏ vòng xoay 3 loại cũ cho pipeline mới.
- **Bảng Hồ sơ vụ án:** AI viết `board` (dòng nhỏ, tiêu đề, phụ đề của thẻ giữa, tóm tắt, 0–3 sợi dây nối); validator hiện có chặn dây nối làm lộ đáp án đối chất.
- **Dòng thời gian:** mức Trung bình và Khó có `timeline` lấy từ dòng thời gian sự thật (một số mốc cố định, một số mốc người chơi kéo); mức Dễ không có.
- **Gợi ý:** theo hồ sơ mức độ.
- **Kiểm tra theo mức:** thêm một bước kiểm tra "đúng mức" trước LAYOUT: đếm cảnh, nghi phạm, đối chất, câu đố, chứng cứ gây nhiễu, chứng cứ cần để buộc tội, `ruleSet`; lệch thì báo lỗi rõ cho bước sửa theo phạm vi.
- **Cảnh mở đầu:** nhập vụ xong, server tự gọi tạo cảnh mở đầu (như `CutsceneService.GenerateAsync`, chạy qua bridge cho bot). Tạo lỗi thì không chặn vụ; bản nháp ghi lỗi và admin vẫn tạo lại bằng tay như hiện nay.

### 5. Bot (skill `/tao-vu-an` và MCP studio)

- Skill: hướng dẫn mới cho bước LOGIC (chọn loại câu đố, viết phần truyện của câu đố, viết board, timeline), bước cảnh mở đầu tự đến sau nhập vụ, và số lượt PixelLab ước tính theo mức.
- MCP: nếu prompt/schema của bridge đã đủ thì không cần tool mới; `player_view` và bước chạy thử phải chạy với vụ `OPEN_COOP` (mọi cảnh mở). Bước chạy thử không giải câu đố phụ (đúng thiết kế: câu đố không chặn đường).
- Mang theo các thay đổi chưa commit của `feature/case-creating`: `asset_download`, `pixellab_character_zip`, luật 9 của skill.

### 6. Triển khai

- Nhánh mới từ `origin/feature/kiet-auth-validation`. Thêm `.superpowers/` vào `.gitignore`.
- Làm theo thứ tự chủ dự án chốt: **form đặt vụ trước** (cùng hồ sơ mức độ và API của nó), **rồi pipeline**.
- Một lần deploy cho cả hai phần. Bản nháp đang dở không bị ảnh hưởng.

### 7. Kiểm thử

- **Server (unit + integration Mongo):** bảng hồ sơ mức độ và API; đơn mới bỏ qua trường cũ và không ghi đè; ngân sách sự thật theo mức (5 nghi phạm ở mức Khó trong vụ một chặng); bước chiếu ra `OPEN_COOP` một chặng đúng số cảnh/đối chất/câu đố; câu đố `INTERACTIVE_PUZZLE` hoàn thiện được qua `Complete` + `Validate`; chứng cứ từ câu đố không là chứng cứ duy nhất; ba loại gắn sự thật lấy đáp án từ truth; kiểm tra "đúng mức" bắt từng loại lệch; cảnh mở đầu tự xếp hàng sau nhập vụ, lỗi không chặn; bản nháp cũ (không `pipelineVersion`) đi đường cũ nguyên vẹn.
- **Mock pipeline:** `AiCaseMockFactory` sinh được vụ hợp lệ cho cả ba mức, qua `CaseValidationService`.
- **Form (Playwright):** ba thẻ mức độ và thanh tóm tắt khớp số API; đổi mức không đổi ô nào khác; "Tùy chọn thêm" mở/gấp; gửi đúng đơn mới; không còn nút V3, ô số chặng, kiểu đơn; bố cục ở 375 px.
- **Chạy thật:** mỗi mức một đơn trên máy chạy bot, đi hết tới nhập vụ; chơi thử bằng tay một vụ mức Dễ.

## Để người làm tự quyết

- Tên lớp, tên trường (`pipelineVersion`, `leaning`), đường dẫn API.
- Bố cục chi tiết, khoảng cách, chữ trên form, miễn đúng bố cục A và token `--adm-*`.
- Cách chia ô câu đố vào cảnh và vật, miễn đúng số của mức và mỗi câu gắn một vật bấm được.
- Cách ước lượng lượt PixelLab theo mức × thế giới (lấy từ cách bot ước lượng hiện nay).

## Các quyết định do Claude đặt (chủ dự án kiểm khi đọc)

- Bảng số của từng mức như mục 1 (chủ dự án đã đồng ý bảng; "Khó" là vụ to hơn).
- Số câu đố theo "Thiên về": Cân bằng giữa khoảng, Giải đố mức trên, Hội thoại mức dưới.
- AI chọn loại câu đố, không lặp trong một vụ; người đặt đơn không chọn loại.
- Dòng thời gian chỉ có ở mức Trung bình và Khó.
- Độ khó của từng câu đố theo mức: EASY / NORMAL / HARD.
- Gợi ý: game chỉ có thứ tự gợi ý, không có giờ mở, nên "mở sớm / mở muộn" trong bảng đã duyệt thành số mức gợi ý: 3 / 3 / 2 cho mỗi cảnh, câu đố và đối chất.
- `estimatedMinutes` ghi vào vụ: 12 / 25 / 50.
- Cảnh mở đầu tạo lỗi thì không chặn vụ.
- Bản nháp cũ chạy tiếp đường cũ, không chuyển đổi.
- Bỏ hẳn 6 kiểu đơn cũ, kể cả "demo ngắn" và "đủ tính năng".
