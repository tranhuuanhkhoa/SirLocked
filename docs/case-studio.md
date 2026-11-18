# Case Studio — sửa vụ trước khi xuất bản

Trang `/admin/editor/<caseId>` (chỉ ADMIN). Bot làm xong vụ thì `draft_import` thành bản nháp (chưa đăng); Yen mở vụ
ở đây, sửa, chơi thử, rồi tự bấm **Duyệt & xuất bản**. Vụ đã xuất bản chỉ xem được: muốn sửa thì gỡ xuất bản trước.
Màn tân thủ chỉ xem được (server nạp lại nó từ file JSON mỗi lần khởi động).

Lối vào: nút **Sửa trong editor** ở thẻ bản nháp trên `/admin/ai` (bản đã import, chưa đăng), và **Mở Case Studio** ở
trang chi tiết vụ `/admin/cases/<caseId>` khi vụ chưa đăng.

## Có gì

| Mục | Ở đâu | Ghi chú |
|---|---|---|
| A1 Phiên bản | tab Lịch sử | Mỗi lần lưu tăng "bản N". "Lưu phiên bản" giữ một bản có số. Bản bot nhập (ORIGINAL) giữ mãi; tối đa 50 bản khác. Khôi phục tự lưu bản hiện tại thành "Trước khi khôi phục". Nhập lại vụ đè lên bản đã sửa thì bản sửa được giữ thành "Bản sửa trước khi nhập lại". |
| A2 Kiểm tra | tab Kiểm tra | Server chạy lại sau mỗi lần lưu: `CaseValidationService` + luật gợi ý (lỗi) + luật bố cục pixel (`PixelDraftRules`, lỗi với vụ của bot, cảnh báo với vụ làm tay) + cổng V3/cổng sự thật của vụ bot + đối chiếu sự thật (`CaseTruthService`). Bấm một dòng để tới đúng đối tượng; khung lỗi tô đỏ trên cảnh. |
| A3 Hoàn tác | Ctrl+Z, Ctrl+Y (Ctrl+Shift+Z), Ctrl+S | Mỗi cú kéo / nét cọ / lần gõ (dừng 0,7 s) là một bước. Tự lưu sau 1,5 s. |
| A4 Chơi thử cảnh này | nút trên đầu | Phòng chơi thử của bản nháp AI, hai thám tử bắt đầu ở cảnh đang mở (`RoomPlaytest.StartSceneId`). Vụ cổ điển mở thêm cảnh đầu. |
| B1 Khung cảnh | giữa | Nền 2048×2048 (512 × 4) không làm mịn, NPC vẽ khung 0 của sheet thở, neo ở chân, lớp foreground theo `baseY`. |
| B2 Kéo thả | Chọn & kéo | NPC (chân + khung nói đi cùng), ô vật phẩm, vùng manh mối, cửa, điểm xuất hiện. Bám lưới 4 (1 pixel gốc), không ra ngoài cảnh. Kéo góc dưới phải để đổi cỡ. Mũi tên dời 4, Shift dời 16. Kéo nền để cuộn, lăn chuột để phóng. |
| B3 Lưới đi | Vẽ lối đi / Vẽ vật cản, Kiểm đường đi | Tô ô 16×16 trên lưới 128×128. "Kiểm đường đi" dùng đúng luật server: tô xanh vùng đi tới được từ điểm xuất hiện mặc định, vàng là sàn bị cô lập, đỏ là chỗ không tới được. |
| C2 Bằng chứng | tab Bằng chứng | Sửa tên, mô tả, nội dung. Xóa thì hiện trước mọi chỗ còn dùng nó (đối chất, kết luận, dòng thời gian…); khung trong cảnh xóa theo. |
| D1 Đổi mặt NPC | chọn NPC → thư viện | Chỉ NPC trong thư viện có sheet `idle` và `portrait`. Giữ id, tên, lời khai, lời thoại. Sheet 9 khung 128, 6 fps, anchorY 0.8203. |
| E1 Lời thoại | tab Lời thoại | Câu hỏi, trả lời, lời khai, câu hội thoại và lựa chọn, có khung xem trước như trong game; báo khi dài hơn 280 ký tự. |
| E3 Gợi ý | tab Kiểm tra | Thiếu gợi ý mức 1–3 là lỗi chặn xuất bản; điền thẳng ở khung "Thiếu gợi ý". Mục "Tất cả gợi ý" cho sửa chữ, xóa gợi ý của các câu hỏi đã đủ. |

## API (`api/admin/case-editor`, ADMIN)

`GET {caseId}`, `PUT {caseId}` `{ baseVersion, caseJson, checkpoint, note }`, `GET {caseId}/revisions`,
`GET {caseId}/revisions/{n}`, `POST {caseId}/revisions/{n}/restore` `{ baseVersion }`,
`POST {caseId}/publish` `{ baseVersion, note }`, `POST {caseId}/playtest` `{ sceneId }`.

- `baseVersion` cũ → 409 `CASE_EDITOR_STALE` (kèm `currentVersion`, `updatedByName`); editor ngừng tự lưu và mời tải bản mới.
- Vụ đã đăng / màn tân thủ → 409 `CASE_EDITOR_READ_ONLY`. Phòng chơi thật đang mở → 409 `CASE_IMMUTABLE_WHILE_ACTIVE` (phòng chơi thử không chặn).
- Server tự giữ các trường của server (status, mechanicsVersion, ruleSet, presentation, cổng AI, truth hash…), dù editor gửi gì.
- Ảnh chỉ nhận `/assets/...` hoặc `https://...` (422 `CASE_EDITOR_URL`).
- Lưu không bao giờ bị chặn vì lỗi kiểm tra (bản nháp được phép dở dang); chỉ xuất bản bị chặn.
- Mọi khôi phục và xuất bản ghi vào Nhật ký admin (`case-editor.restore`, `case-editor.publish`).

Dữ liệu: `caseEditorStates` (một dòng mỗi vụ: version, số bản kế tiếp) và `caseEditorRevisions` (bản sao JSON).

## Kiểm thử

- BE: `src/BE/Tests/CaseEditorTests.cs`, `src/BE/IntegrationTests/MongoCaseCatalogEditorTests.cs` (cần Mongo, `SIRLOCKED_RUN_MONGO_IT=true`).
- FE: `node --test src/FE/scripts/case-editor.test.mjs`, `npx playwright test tests/case-editor.spec.ts`.
