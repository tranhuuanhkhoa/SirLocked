# AI Alignment Rules - SirLocked

File này là luật bắt buộc cho mọi AI agent khi hỗ trợ code project SirLocked. Mục tiêu là giữ AI không đi lệch master plan, không làm vượt scope, không tự đổi kiến trúc, và luôn tạo output có thể demo được.

## 1. Mục tiêu sản phẩm

AI phải hiểu project là:

```txt
Game điều tra 2 người real-time.
Player đăng nhập, chọn case, tạo/join phòng, chọn vai, chơi điều tra, chat, accuse, xem kết quả.
Admin đăng nhập, quản lý user/case/room/result/log, và tạo case bằng AI trên web.
```

Stack đã chốt:

```txt
Frontend: React + Vite + TypeScript nếu build mới; hiện repo có React/Vite JSX trong src/FE.
Backend: ASP.NET Core Web API
Database: MongoDB
Realtime: SignalR
Auth: JWT + role ADMIN/PLAYER
Image: Cloudinary
AI text logic: Deepseek
AI background image: Gemini
AI character/item image: ChatGPT
Voice: text chat là bắt buộc; mic là stretch goal nếu thiếu thời gian.
```

AI không được tự đổi stack nếu user không yêu cầu rõ.

## 2. Thứ tự ưu tiên không được đảo

AI phải bám thứ tự MVP:

```txt
1. Game chạy bằng case JSON mẫu
2. Room real-time 2 người
3. Gameplay điều tra
4. Admin quản lý dữ liệu
5. AI tạo case
6. Polish, test, deploy
```

Rule quan trọng:

```txt
Không làm AI Case Creator trước khi runtime game và case JSON mẫu chơi được.
Không làm mic trước khi text chat chạy ổn.
Không làm UI polish lớn khi auth, room, gameplay core chưa xong.
Không làm editor kéo thả phức tạp cho admin trong MVP.
```

## 3. Phạm vi theo tuần

Khi user yêu cầu làm một tuần cụ thể, AI chỉ làm đúng output của tuần đó, trừ khi cần sửa lỗi nền để chạy được.

| Tuần | Scope chính | Không làm trong tuần này |
| --- | --- | --- |
| 1 | Setup FE/BE/Mongo/SignalR base, health check, docs setup | Auth đầy đủ, gameplay, AI |
| 2 | Auth, JWT, role ADMIN/PLAYER, guard FE/BE | Room/gameplay, AI |
| 3 | Case models, import JSON, published case list/detail | Room realtime, final accusation |
| 4 | Room 2 người, lobby, role, ready, start | Gameplay item/dialogue sâu |
| 5 | Game screen, inspect item, unlock clue, sync realtime | Dialogue/evidence/final |
| 6 | Dialogue, present evidence, scene/stage progression | AI creator, deploy |
| 7 | Accuse, result, text chat, mic basic nếu kịp | AI creator full |
| 8 | Admin dashboard/user/case/room/result/log | AI generation nếu admin core chưa xong |
| 9 | Admin AI Case Creator, validate JSON, Cloudinary assets | Refactor lớn không cần thiết |
| 10 | Fix bug, polish, docs, seed, deploy | Feature lớn mới |

## 4. Luật chia feature full-stack cho 5 người

AI phải chia việc theo feature ownership, không chia cứng theo BE/FE riêng. Xem chi tiết ở `docs/FULLSTACK_FEATURE_PLAN.md`.

```txt
Member 1 - Auth + User + Role:
Login, register, JWT, role, user status, FE auth, protected route.

Member 2 - Case System + Case JSON:
Case model, import JSON, case list, case detail, publish/unpublish, case validation.

Member 3 - Room + Lobby Realtime:
Create room, join room, lobby, role select, ready/start, SignalR room sync, text chat, reconnect.

Member 4 - Gameplay Runtime:
Current scene, inspect item, unlock clue, dialogue, present evidence, stage progression, accusation, result.

Member 5 - Admin + AI + Cloudinary:
Admin dashboard, user/case/room/result/log management, AI case creator, Deepseek/Gemini/ChatGPT services, Cloudinary upload.
```

Rule bắt buộc:

```txt
Member nào sở hữu feature thì làm full-stack cho feature đó: model, API, service, repository, SignalR nếu có, FE page/component/store, validation, test, docs.
Không để một member chỉ làm BE và member khác chỉ làm FE cho cùng một feature nếu chưa có lý do rõ.
Nếu feature giao nhau, owner phải viết contract trước: DTO, API route, SignalR event, UI state, lỗi chính.
Member khác consume contract, không tự đổi logic lõi của feature owner.
```

## 5. Luật kiến trúc bắt buộc

Backend phải theo luồng:

```txt
Controller/Hub
-> Service
-> Repository
-> MongoDB
```

Không để Controller hoặc Hub thao tác MongoDB trực tiếp, trừ health check rất đơn giản.

Frontend phải theo luồng:

```txt
Page
-> Component
-> service/api client
-> store nếu cần state dùng chung
```

Realtime/game action phải theo luồng:

```txt
Client gửi action
-> Backend validate
-> Backend update MongoDB/runtime state
-> Backend bắn SignalR event cho cả room
-> FE cập nhật UI từ event/server response
```

Không để FE tự unlock clue, tự start game, tự complete scene, hoặc tự kết luận thắng/thua chỉ bằng local state.

## 6. ID và data contract

Mọi JSON case phải dùng ID ổn định:

```txt
caseId
stageId
sceneId
characterId
itemId
clueId
dialogueId
roomId
userId
resultId
```

Rule:

```txt
Không dùng tên hiển thị làm khóa logic.
Không tạo ID random mỗi lần render.
Không cho unlock logic tham chiếu ID không tồn tại.
Không trùng ID trong cùng một case.
Không đổi schema public nếu chưa cập nhật FE, BE, seed, docs.
```

## 7. API response rule

Mọi API nên trả format thống nhất:

```json
{
  "success": true,
  "message": "OK",
  "data": {}
}
```

Lỗi validation/auth/game rule phải trả message rõ:

```txt
401: chưa đăng nhập hoặc token sai
403: sai role hoặc user bị khóa
404: không tìm thấy resource
409: xung đột logic, ví dụ role trùng, room full, duplicate action
400: input sai
```

## 8. Auth và authorization

Rule bắt buộc:

```txt
ADMIN chỉ vào admin API/UI.
PLAYER không được vào admin API/UI.
LOCKED user không được gọi API/game hub.
DELETED user không được login.
SignalR phải đọc user từ JWT, không tin userId client gửi lên.
```

Không hard-code admin token trong FE.

## 9. Room và realtime rule

Room MVP:

```txt
Max 2 player.
Người tạo phòng là host.
Chỉ host được start.
Phải đủ 2 người mới start.
2 người không được chọn trùng role.
Role gồm INVESTIGATOR và INTERROGATOR.
Refresh page không được làm mất room nếu token/session còn hợp lệ.
```

SignalR event phải có tên thống nhất:

```txt
Client -> Server:
JoinRoom, LeaveRoom, SelectRole, Ready, StartGame,
InspectItem, CompleteScene,
AskDialogue, PresentEvidence, CompleteStage,
SendRoomMessage

Server -> Client:
PlayerJoined, PlayerLeft, RolesUpdated, PlayerReadyUpdated,
GameStarted, RoomError,
ItemFound, ClueUnlocked, SceneProgressUpdated, SceneCompleted,
DialogueAnswered, EvidencePresented, DialogueUnlocked,
StageCompleted, SceneChanged, StageChanged,
RoomMessageReceived, SystemMessageReceived, GameCompleted
```

Nếu cần thêm event mới, phải ghi vào docs/API_CONVENTION.md hoặc docs/SIGNALR_EVENTS.md.

## 10. Gameplay rule

AI phải bảo vệ gameplay bằng backend:

```txt
Inspect item:
- Room phải PLAYING.
- User phải thuộc room.
- Item phải thuộc current scene.
- Item chỉ unlock clue một lần.
- Action phải được log.

Dialogue:
- Dialogue bị lock nếu thiếu required clue/item.
- Present evidence đúng mới unlock dialogue/clue mới.
- Present evidence sai phải có feedback nhưng không phá state.

Final accusation:
- Check culprit, motive, method, required evidence.
- Lưu GameResult.
- Set room COMPLETED.
```

## 11. Admin rule

Admin MVP chỉ cần:

```txt
Dashboard số liệu thật.
User list + lock/unlock.
Case list/detail + publish/unpublish/delete mềm.
Room history.
Game result history.
Action/message logs.
AI Case Creator step-by-step.
```

Không tạo admin editor phức tạp nếu chưa xong MVP.

## 12. AI Case Creator rule

AI creator chỉ được làm sau khi case schema và runtime chơi được.

Flow bắt buộc:

```txt
Admin nhập ý tưởng
-> Deepseek tạo story/gameplay JSON
-> Validate JSON
-> Gemini tạo background
-> ChatGPT tạo character/item image
-> Upload Cloudinary
-> Preview
-> Publish
```

Validation bắt buộc:

```txt
Có title.
Có stages/scenes/characters/items/clues/dialogues.
Có culpritId.
Có winCondition.
Không trùng ID.
Không tham chiếu ID không tồn tại.
Mỗi stage có ít nhất 1 scene.
Mỗi scene có background hoặc placeholder.
Mỗi clue quan trọng có đường unlock được.
```

Nếu AI sinh JSON sai, không publish. Phải trả danh sách lỗi để admin sửa hoặc generate lại.

## 13. UI/UX rule

Player UI phải ưu tiên chơi được:

```txt
Login/register rõ.
Case list rõ.
Create/join room rõ.
Lobby có room code, player list, role, ready, start.
Game screen có scene, item clickable, clue notebook, chat/log.
Result screen có thắng/thua và lý do.
```

Admin UI phải ưu tiên quản lý được:

```txt
Table có loading/error/empty state.
Action nguy hiểm có confirm.
Status dùng badge rõ ràng.
AI creator có progress stepper, preview JSON, error panel.
```

Không dùng mock data ở màn hình đã nối API thật, trừ khi ghi rõ là fallback demo.

## 14. Test và Definition of Done

Một task chỉ được xem là xong khi có:

```txt
Code chạy được.
API/UI liên quan được kiểm thử thủ công hoặc automated.
Không phá flow trước đó.
Có loading/error state nếu là FE.
Có validation/error response nếu là BE.
Có log nếu là game action hoặc AI generation.
Docs cập nhật nếu đổi contract.
```

Checklist tối thiểu trước khi báo xong:

```txt
FE: npm run dev hoặc npm run build nếu có.
BE: dotnet build nếu solution/project thật đã sẵn sàng.
API: test request chính và case lỗi chính.
SignalR: test 2 client nếu đổi realtime.
AI: test JSON validation trước publish.
```

Không được báo "hoàn tất" nếu chưa chạy được phần liên quan hoặc chưa nói rõ phần chưa test.

## 15. Những việc AI không được tự làm

AI không được:

```txt
Tự đổi công nghệ chính.
Tự xóa file user đã sửa.
Tự đổi schema lớn mà không cập nhật toàn bộ contract.
Tự hard-code secret/API key/token.
Tự bỏ qua auth/role vì làm demo nhanh.
Tự làm AI creator trước game runtime.
Tự tạo feature ngoài MVP khi chưa xong checklist bắt buộc.
Tự claim deploy/test thành công khi chưa chạy.
```

## 16. Prompt chuẩn dùng cho AI

Khi giao việc cho AI, dùng mẫu:

```txt
Bạn đang làm project SirLocked. Hãy đọc docs/AI_ALIGNMENT_RULES.md trước.

Task:
[mô tả task cụ thể]

Tuần:
[1-10]

Feature owner:
[Member 1 Auth + User + Role | Member 2 Case System | Member 3 Room + Lobby Realtime | Member 4 Gameplay Runtime | Member 5 Admin + AI + Cloudinary]

Yêu cầu:
- Bám đúng stack đã chốt.
- Làm full stack cho feature: Model/DTO/Repository/Service/Controller + FE page/component/service/state + test/docs nếu liên quan.
- Không làm ngoài scope tuần.
- Không đổi contract nếu không cần.
- Nếu đổi API/SignalR/schema, cập nhật docs.
- Sau khi sửa, chạy kiểm tra phù hợp và báo rõ kết quả.

Output mong muốn:
[file/API/UI/test cụ thể]
```

## 17. Cách xử lý khi task mơ hồ

Nếu user yêu cầu quá rộng, AI phải chia nhỏ theo thứ tự:

```txt
1. Xác định task thuộc tuần nào.
2. Xác định feature owner.
3. Xác định contract cần có.
4. Làm phần nhỏ nhất có thể chạy được.
5. Test.
6. Báo kết quả và next step.
```

Nếu yêu cầu mâu thuẫn với master plan, AI phải nói rõ rủi ro và đề xuất hướng bám MVP.
