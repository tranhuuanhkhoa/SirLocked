# Màn tân thủ và lựa chọn Kỳ cựu / Nhập môn

## Người chơi thấy gì

1. Tài khoản tạo từ ngày 17/11/2026 trở đi, lần đầu vào trang chủ (`/menu`), được hỏi một lần: **Nhập môn** hay **Người chơi kỳ cựu**. Tài khoản cũ hơn coi như kỳ cựu, không bị hỏi. Admin không bị hỏi, không bị chặn.
2. **Nhập môn:** chưa chơi xong màn tân thủ thì `/find-game`, `/create-room`, `/rooms`, `/join`, `/lobby/...` đưa về `/tan-thu`; server cũng từ chối tạo phòng, vào phòng, tìm trận (403, mã `TUTORIAL_REQUIRED`). Chơi xong một lần (thắng hay thua) là mở khóa. Không đổi sang kỳ cựu được.
3. **Kỳ cựu:** chơi như cũ; màn tân thủ vẫn có trên trang chủ.
4. Màn tân thủ là **phòng một người** (`GameRoom.Mode = "TUTORIAL"`), vụ `case-pixel-tan-thu-vi`. Người chơi bắt đầu là Sherlock và tự đổi qua lại Sherlock / Watson bằng nút **Đổi nhân vật** trên thanh công cụ (phím Q). Chỉ phòng tân thủ có nút này; phòng nhiều người không đổi được vai giữa chừng (server trả 403 `TUTORIAL_ROOM_ONLY`). Đối chất và buộc tội chỉ cần một xác nhận.
   - Hướng dẫn dạy cả hai vai. Sherlock (Thẩm vấn viên) hỏi chuyện. Watson (Điều tra viên) khám đồ vật, chụp ảnh, mở Túi đồ. Câu đố, Hồ sơ vụ án, vạch lời nói dối và cáo buộc là việc chung.
   - Bấm vào thứ của vai kia thì không làm gì. Game báo vai nào làm việc đó, nút Đổi nhân vật nhấp nháy, thẻ hướng dẫn ghi "Bước này cần …" và mũi tên chỉ vào nút.
5. Thẻ hướng dẫn (góc dưới trái, trên điện thoại ở trên cùng) cùng mũi tên vàng chỉ từng bước. Tiến độ lưu theo phòng trong trình duyệt.
6. Không có xu, XP, bảng xếp hạng, huy hiệu hay đánh giá: kết quả màn tân thủ không ghi vào `gameResults`. Trang kết quả vẫn hiện, có nút "Chơi vụ án thật".

## Server

| Phần | File |
| --- | --- |
| Luật (đường đi, chặn, số xác nhận) | `src/BE/Services/Tutorial/TutorialRules.cs` |
| Trạng thái, chọn, mở phòng, đổi vai | `src/BE/Services/Tutorial/TutorialService.cs`, `WebAPI/Controllers/TutorialController.cs` |
| Vụ tân thủ luôn là DRAFT, không đăng được, làm mới từ file mỗi lần khởi động | `CaseService.EnsureTutorialCaseAsync`, `CaseService.PublishAsync` |
| Chặn phòng và tìm trận | `RoomService.EnsureEmailVerifiedAsync`, `MatchmakingService.EnsureEmailVerifiedAsync` |
| Một xác nhận trong phòng một người | `AccusationConsensusRules` (`requiredPlayers`), `PairedConfrontationRules.Confirm` (`requiredConfirmations`) |
| Đánh dấu xong, không lưu kết quả | `GameplayService.ResolveAccusationCoreAsync`, `TutorialResultStore` |

API (cần đăng nhập):

| Lệnh | Việc |
| --- | --- |
| `GET /api/tutorial/status` | `path`, `needsChoice`, `required`, `completed`, `activeRoomId` |
| `POST /api/tutorial/choice` `{ path: "BEGINNER" \| "VETERAN" }` | Chọn một lần (chọn lại đúng đường cũ thì bỏ qua, đổi đường thì 409) |
| `POST /api/tutorial/start` | Mở phòng tân thủ, hoặc trả phòng đang chơi dở (`resumed: true`) |
| `POST /api/tutorial/rooms/{roomId}/role` `{ role }` | Đổi vai, chỉ trong phòng tân thủ |

## Test

- `src/BE/Tests/TutorialTests.cs`: luật, một xác nhận, kết quả không lưu, vụ và cutscene hợp lệ.
- `src/BE/IntegrationTests/MongoTutorialTests.cs`: chặn phòng và tìm trận, mở lại phòng, đổi vai, buộc tội một mình xong màn mà không có `gameResults`.
- `src/FE/tests/tutorial-onboarding.spec.ts`, `tutorial-coach.spec.ts` (API giả lập, nằm trong `npm run test:ui`).
- `src/FE/tests/tutorial-full-stack.spec.ts`: chạy bằng `scripts/test-v3-full-stack.ps1 -Tutorial`.
