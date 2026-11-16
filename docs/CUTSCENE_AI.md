# Cutscene mở đầu (truyện tranh động do AI viết)

Mỗi vụ pixel có thể có một cutscene mở đầu dạng truyện tranh động: 2–3 trang, 5–9 khung, 40–75 giây, vẽ trên canvas bằng chính ảnh pixel của vụ án.

## Cách hoạt động

- **AI chỉ viết kịch bản JSON** (`motion-comic-v1`): tên bố cục, ảnh nào làm nền, lời dẫn, thoại, chữ hiệu ứng. Không có toạ độ, camera hay code. Động cơ ở FE (`src/FE/Client/js/game/cutscene/`) tự tính hình học, camera, thời lượng, âm thanh.
- **Chống lộ hung thủ**: AI chỉ nhận dữ liệu công khai (`CutsceneInputBuilder`: tiêu đề, tóm tắt, cảnh, nhân vật, vật phẩm có ảnh). Không bao giờ gửi sự thật vụ án, manh mối, lời giải, timeline. Kịch bản trả về còn bị `CutsceneScriptValidator` kiểm tra (schema, giới hạn, id, tiếng Việt, không lặp tiêu đề manh mối quan trọng / lời giải / câu của manh mối, không buộc tội nhân vật) và AI chỉ được sửa 1 lần.
- **Lưu riêng**: collection `caseCutscenes` (không đụng document vụ án và seeder). Mỗi vụ có nhiều phiên bản, trạng thái `DRAFT` / `APPROVED` / `DISABLED` / `SUPERSEDED`. Người chơi chỉ nhận bản `APPROVED`.
- **API**
  - Người chơi: `GET /api/cases/{caseId}/intro-cutscene` → `data` là `null` nếu không có, vụ bị ẩn (`CaseCatalog:PixelOnly`), chưa xuất bản, hoặc đang tắt.
  - Admin (`/api/admin/cases/{caseId}/cutscene`): `GET`, `POST generate` (`{regenerate}`), `PUT {id}/script`, `POST {id}/approve`, `POST disable`, `GET export`.

## Trong game

Lần đầu một người chơi vào màn chơi của phòng: cutscene → màn giới thiệu vai → điều tra. Mỗi người xem độc lập (khóa localStorage theo phòng + người chơi, tải lại không phát lại). Nút "Xem lại mở đầu" nằm cạnh phần Âm thanh. Ở `/cases`, phần Chi tiết có nút "Xem mở đầu".

Phím: Space hoặc nhấp để tua, giữ Esc (hoặc giữ nút) để bỏ qua, M tắt tiếng. Âm thanh theo cài đặt âm thanh chung của game. `prefers-reduced-motion`: không rung, không chớp, không lia camera, bấm để sang khung kế.

## Cấu hình

```
Cutscene__Enabled=true                    # false: ẩn mọi cutscene khỏi người chơi
Cutscene__AutoGenerateForPixelCases=true  # đã ngừng dùng: khởi động server không tự xếp cutscene cho bot
Cutscene__AutoApprove=false               # true: bản qua kiểm tra được duyệt luôn
Cutscene__Model=                          # đã ngừng dùng: kịch bản do bot Claude viết
```

"Tạo bằng AI" đưa yêu cầu vào hàng chờ của bot Claude (`ownerType = CUTSCENE`, xem `docs/AI_CASE_SETUP_VI.md`); trang hiện "đang chờ Claude" tới khi bot nộp, rồi bản nháp mới xuất hiện để duyệt. Cần `Bridge__Key` trên server. Khi `MOCK_AI_RESPONSES=true` thì nút cho ra kịch bản mẫu giả lập ngay.

## Đưa lên server

Bản đã duyệt được xuất ra file và commit: `src/BE/SeedData/Cutscenes/<caseId>.intro.json` (lấy từ `GET .../cutscene/export`). Khi API khởi động, `CutsceneSeedWorker` chèn cutscene còn thiếu (đã duyệt, nguồn `SEED`), không bao giờ ghi đè bản đang có. Vì vậy server mới tự có cutscene mà không cần chạy AI.

## Quay lui

- Tắt ngay: nút **Tắt** ở trang admin của vụ, hoặc `Cutscene__Enabled=false`.
- Về bản cũ: duyệt lại phiên bản cũ ở trang admin (các bản cũ được giữ).
- Bỏ hẳn: quay về commit trước khi có nhánh `feat/cutscene-ai`.
