# Full-Stack Feature Plan - SirLocked

Project giữ mục tiêu ban đầu: React FE + .NET Web API + MongoDB + SignalR + Cloudinary + AI, làm game điều tra 2 người real-time, có login, room, gameplay, admin và AI case creator.

## Nguyên tắc chia mới

```txt
Mỗi member phụ trách 1 cụm feature end-to-end:

- Tự tạo Model / DTO / Repository / Service / Controller
- Tự tạo FE page / component / API service / state
- Tự viết test case cho feature
- Tự viết docs ngắn cho API mình làm
- Cuối mỗi tuần merge theo feature branch
```

Không chia kiểu:

```txt
Member 1 chỉ BE
Member 2 chỉ SignalR
Member 3 chỉ FE
```

Chia theo feature full stack:

```txt
Member 1: Auth + User + Role
Member 2: Case System + Case JSON
Member 3: Room + Lobby Realtime
Member 4: Gameplay Runtime
Member 5: Admin + AI + Cloudinary
```

## Tổng quan phân công

| Member | Feature chính | Phạm vi full stack |
| --- | --- | --- |
| Member 1 | Auth + User + Role | Login, register, JWT, role, user status, FE auth |
| Member 2 | Case System | Case model, import JSON, case list, case detail |
| Member 3 | Room + Lobby | Create room, join room, select role, ready, start, SignalR lobby |
| Member 4 | Gameplay | Scene, item, clue, dialogue, evidence, accusation, result |
| Member 5 | Admin + AI + Cloudinary | Admin dashboard, user/case/room/result management, AI case creator, upload ảnh |

## Bảng task chi tiết theo từng member

### Member 1 - Auth + User + Role

| Tuần | Backend task | Frontend task | Test/docs | Dependency | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | Tạo `User`, `RefreshToken` model draft; tạo `AuthController`, `UserController`, `AuthService`, `JwtService` skeleton | Tạo `LoginPage`, `RegisterPage`, `ProfilePage`, `authStore`, `apiClient` skeleton | Ghi API contract auth draft | Setup chung FE/BE/Mongo | Auth module có folder và file base |
| 2 | Làm register/login/me/logout, hash password, generate JWT, role claim, status `ACTIVE/LOCKED/DELETED` | Login/register form gọi API, lưu token, attach token vào axios/fetch, logout | Test register/login đúng sai, email trùng, token attach | MongoDB connection | Login/register chạy end-to-end |
| 3 | Làm `UserStatusMiddleware`, `/api/users/me`, update profile cơ bản | ProtectedRoute, RoleGuard, UserMenu, ProfilePage | Test PLAYER bị chặn admin, LOCKED user bị chặn | Admin routes từ Member 5 | Guard và profile hoạt động |
| 4 | Fix auth refresh hoặc restore session từ token; chuẩn hóa error 401/403 | Auto redirect theo role; xử lý loading auth khi reload | Test refresh không mất login | Room lobby cần auth ổn | Auth state ổn định khi refresh |
| 5 | Thêm helper lấy user info cho action log/game action | Hiển thị username/avatar nếu có trong game/lobby | Test action log có userId/username | Member 4 action log | Log biết ai thực hiện action |
| 6 | Viết guard kiểm tra room membership dùng chung cho game API | FE xử lý lỗi 403 khi user không thuộc room | Test user ngoài room không gọi game API được | Member 3 room data | Game API bảo vệ theo room |
| 7 | API user result history nếu cần demo profile | Profile hiển thị lịch sử kết quả nếu có | Test xem result history của user | Member 4 result | User xem được history cá nhân nếu cần |
| 8 | Admin user API lock/unlock hoặc hỗ trợ Member 5 endpoint user | UI admin user management nếu feature được giao lại | Test lock/unlock user | Member 5 admin dashboard | Admin quản lý user được |
| 9 | Guard admin cho AI API, đảm bảo chỉ ADMIN gọi được | Redirect PLAYER khỏi AI creator route | Test PLAYER gọi AI API bị 403 | Member 5 AI API | AI API được bảo vệ |
| 10 | Fix auth/security bug, kiểm tra secret config, token expiry, role policy | Polish login/register/profile error state | Regression test auth full flow | Toàn bộ feature | Auth ổn định cho demo |

Checklist riêng Member 1:

```txt
[ ] Không hard-code token/admin account trong FE
[ ] JWT có userId, username, role
[ ] Backend không tin userId FE gửi lên
[ ] LOCKED user bị chặn API và hub
[ ] DELETED user không login được
```

### Member 2 - Case System + Case JSON

| Tuần | Backend task | Frontend task | Test/docs | Dependency | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | Tạo schema draft `GameCase`, `Stage`, `Scene`, `Character`, `Item`, `Clue`, `Dialogue`, `FinalCaseLogic`; tạo `CaseController`, `AdminCaseController` skeleton | Tạo `CaseListPage`, `CaseDetailPage`, `AdminCaseListPage`, `ImportCaseJsonPage` skeleton | Ghi schema case draft | Setup MongoDB | Case module có base |
| 2 | Làm `CaseRepository`, `CaseImportService`, import JSON vào MongoDB; validate field tối thiểu | Import JSON form cơ bản cho admin | Test import case mẫu | Member 1 admin auth nếu có | Import case JSON được |
| 3 | API published list/detail, publish/unpublish, admin case detail | Player case list/detail; admin publish/unpublish UI | Test player chỉ thấy published case | Auth guard | Player xem case published được |
| 4 | `CaseValidationService`: check thiếu stage/scene/item/clue/dialogue, duplicate ID, missing reference | UI hiển thị lỗi validation khi import | Test JSON thiếu field, trùng ID, reference sai | Case JSON mẫu | Validation rõ lỗi |
| 5 | Bổ sung relation item -> clue, item position/click data, clue metadata | FE render item/clue data để Member 4 dùng | Test item unlock clue đúng theo schema | Member 4 inspect item | Case đủ dữ liệu gameplay item/clue |
| 6 | Bổ sung dialogue/evidence rule: requiredClueIds, requiredItemIds, unlocks | Case structure viewer hiển thị dialogue/evidence relation | Test dialogue lock/unlock reference hợp lệ | Member 4 dialogue | Case đủ dữ liệu dialogue/evidence |
| 7 | Bổ sung `FinalCaseLogic`: culpritId, motive, method, requiredEvidenceIds | Admin case detail hiển thị final logic | Test final logic đủ field | Member 4 accusation | Case đủ dữ liệu kết thúc game |
| 8 | Polish admin case management: search/filter/status/delete mềm | Admin case table polish, status badge, confirm modal | Test publish/unpublish/delete mềm | Member 5 admin layout | Admin quản lý case ổn |
| 9 | Validate AI case JSON theo cùng schema; map AI draft thành `GameCase` | Preview AI case theo structure viewer | Test AI JSON publish thành case thật | Member 5 AI creator | AI case publish được |
| 10 | Fix schema/import/render bug; chuẩn bị case seed demo | Polish empty/error/loading states case pages | Regression test import -> publish -> play | Member 3/4 consume case | Case mẫu ổn định cho demo |

Checklist riêng Member 2:

```txt
[ ] ID không trùng trong cùng case
[ ] Không dùng display name làm khóa logic
[ ] Player chỉ thấy published case
[ ] Case mẫu có ít nhất stage, scene, character, item, clue, dialogue, final logic
[ ] Nếu đổi schema phải báo Member 3/4/5
```

### Member 3 - Room + Lobby Realtime

| Tuần | Backend task | Frontend task | Test/docs | Dependency | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | Tạo `GameRoom`, `RoomPlayer`, `RoomProgress`, `RoomChatMessage` draft; tạo `RoomController`, `GameHub` skeleton | Tạo `CreateRoomPage`, `JoinRoomPage`, `RoomLobbyPage`, `roomStore`, `signalrClient` skeleton | Ghi SignalR event draft | Setup SignalR | Room module có base |
| 2 | Cấu hình SignalR đọc JWT, hub lấy user từ claim | FE connect hub với token | Test connect hub có JWT | Member 1 JWT | SignalR connect bằng user thật |
| 3 | API create room, join by code, get room; generate room code | Create room UI, join room UI, room code box | Test tạo/join room | Member 2 published case | Player tạo/join room được |
| 4 | Role select, ready, start, leave; realtime events `PlayerJoined`, `RolesUpdated`, `ReadyUpdated`, `GameStarted` | Lobby realtime UI: player slots, role selector, ready, start | Test 2 client, room full, duplicate role, non-host start | Member 1 auth, Member 2 case | Lobby realtime chạy được |
| 5 | Broadcast gameplay SignalR events theo room group; đảm bảo user join đúng group | FE nhận `ItemFound`, `ClueUnlocked`, update game store hoặc chuyển tiếp cho Member 4 | Test 2 client thấy clue realtime | Member 4 inspect item | Gameplay event sync được |
| 6 | Broadcast dialogue/evidence events | FE nhận `DialogueAnswered`, `EvidencePresented`, system log | Test 2 client thấy dialogue/evidence realtime | Member 4 dialogue | Dialogue/evidence sync được |
| 7 | Làm room chat realtime, lưu `RoomChatMessage`; events `SendRoomMessage`, `RoomMessageReceived` | `LobbyChatBox`/game chat box, message list, system message | Test chat lưu DB và realtime | Auth + room membership | Text chat chạy được |
| 8 | Reconnect/refresh handling, leave/disconnect, avoid duplicate event | FE restore room after refresh, loading/error lobby | Test refresh không mất room | Room state persisted | Lobby ổn khi refresh |
| 9 | Test AI case tạo room được như case thường | FE không hard-code case data trong room flow | Test room với case AI | Member 5 AI publish | Case AI chơi qua room được |
| 10 | Fix realtime race, duplicate action broadcast, reconnect bug | Polish lobby/chat error state | Regression test 2 browser full lobby flow | Toàn bộ flow | Room/lobby ổn định demo |

Checklist riêng Member 3:

```txt
[ ] Max 2 player một room
[ ] Host là người tạo room
[ ] Chỉ host start
[ ] Cả 2 ready mới start
[ ] Không chọn trùng INVESTIGATOR/INTERROGATOR
[ ] SignalR không tin userId client gửi
```

### Member 4 - Gameplay Runtime

| Tuần | Backend task | Frontend task | Test/docs | Dependency | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | Tạo `GameActionLog`, `GameResult`, `FoundItem`, `FoundClue`, `DialogueState`, `FinalAccusation` draft; tạo `GameController`, runtime service skeleton | Tạo `GamePage`, `AccusationPage`, `ResultPage`, `gameStore` skeleton | Ghi game API contract draft | Case/room contract draft | Gameplay module có base |
| 2 | Thiết kế `GameStateResponse`, runtime state structure, current stage/scene draft | GamePage layout placeholder | Test load state mock hoặc skeleton | Member 2 case schema | Runtime contract rõ |
| 3 | Load current scene từ case JSON và room progress | Render scene đầu tiên, item placeholder | Test room started load scene | Member 2 case, Member 3 room | Game load scene đầu |
| 4 | Initialize game state khi room start, check room PLAYING | FE chuyển từ lobby sang game khi `GameStarted` | Test start room tạo game state | Member 3 start room | Game state sẵn sau start |
| 5 | Inspect item, unlock clue, action log, duplicate guard | `GameScene`, `ClickableItem`, `CluePanel`, `InventoryPanel`, `SystemLog` | Test click item, no duplicate, 2 client sync | Member 2 item/clue, Member 3 SignalR | Item/clue gameplay chạy |
| 6 | Ask dialogue, present evidence, complete scene/stage | `CharacterPanel`, `DialoguePanel`, `EvidenceSelector`, `StageProgressBar` | Test dialogue lock, evidence đúng/sai, stage change | Member 2 dialogue rules | Dialogue/evidence chạy |
| 7 | Accuse API, calculate win/fail, save result, set room completed | `AccusationForm`, `ResultSummary`, ResultPage | Test accuse đúng/sai, result saved | Member 2 final logic | Game chơi tới kết thúc |
| 8 | Polish gameplay validation/error response, room membership checks with Member 1 | Loading/error/empty state, responsive game UI | Test user ngoài room, room chưa start | Auth/room guards | Gameplay an toàn hơn |
| 9 | Render dynamic AI case: scene/item/character/dialogue không hard-code | UI chịu được case AI thiếu ảnh hoặc có asset dynamic | Test AI case chơi được | Member 5 AI case | Runtime chơi được case AI |
| 10 | Fix race condition, duplicate inspect, result accuracy | Polish demo flow game screen/result | Regression test full game flow | All features | Gameplay ổn định demo |

Checklist riêng Member 4:

```txt
[ ] Client không tự unlock clue local
[ ] Mọi game action qua backend validate trước
[ ] Action quan trọng có log
[ ] Duplicate inspect không tạo clue trùng
[ ] Accuse lưu result và set room COMPLETED
```

### Member 5 - Admin + AI + Cloudinary

| Tuần | Backend task | Frontend task | Test/docs | Dependency | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | Tạo `AdminController`, `AiCaseController`, `UploadController` skeleton; tạo AI/Cloudinary config placeholder | Tạo admin layout, dashboard page, AI creator page skeleton | Tạo `.env.example`, setup docs AI/Cloudinary | Setup chung | Admin/AI module có base |
| 2 | Admin dashboard mock API hoặc service skeleton; env key placeholders | Admin layout + sidebar + dashboard mock | Docs cấu hình Cloudinary/AI key | Member 1 auth route | Admin route có giao diện |
| 3 | Upload image API Cloudinary skeleton; admin case preview endpoint nếu cần | Admin case preview, Cloudinary upload UI test nhỏ | Test upload placeholder hoặc mock | Member 2 case | Admin preview và upload base |
| 4 | Admin room history basic | Room history table basic | Test xem room history | Member 3 room | Admin xem room cơ bản |
| 5 | Admin action log API basic | Action log viewer basic | Test log inspect item hiển thị | Member 4 action log | Admin xem action log |
| 6 | Admin case structure viewer support | Structure viewer cho stage/scene/item/dialogue/clue relation | Test xem relation case | Member 2 schema | Admin xem cấu trúc case |
| 7 | Admin game result history API | Game result history page | Test result hiển thị sau game | Member 4 result | Admin xem result |
| 8 | Dashboard thật: users, cases, rooms, completed games, success rate; log viewer | Admin dashboard thật, table/filter/search, confirm modal | Test admin quản lý user/case/room/result/log | Member 1/2/3/4 APIs | Admin management hoàn chỉnh |
| 9 | AI draft, Deepseek/Gemini/ChatGPT services, Cloudinary upload assets, validate/preview/publish APIs | AI Case Creator stepper, prompt form, JSON preview, asset grid, error panel, publish | Test draft -> generate -> validate -> preview -> publish | Member 2 schema, Member 4 runtime | AI creator demo được |
| 10 | Fix admin/AI/deploy docs, seed data, demo script, final report | Polish admin/AI UX | Full-flow test and deploy checklist | All features | Demo/deploy/report sẵn sàng |

Checklist riêng Member 5:

```txt
[ ] Admin APIs chỉ ADMIN gọi được
[ ] Không hard-code API key trong code
[ ] AI JSON phải validate trước khi publish
[ ] Ảnh AI upload Cloudinary và lưu URL
[ ] Admin xem được dashboard, users, cases, rooms, results, logs
```

## Member 1 - Auth + User + Role

### Mục tiêu

Làm xong toàn bộ hệ thống tài khoản để người chơi và admin đăng nhập được.

### Backend cần làm

```txt
Models:
- User.cs
- RefreshToken.cs

DTOs:
- RegisterRequest.cs
- LoginRequest.cs
- AuthResponse.cs
- UserProfileResponse.cs
- UpdateUserStatusRequest.cs

Repository:
- UserRepository.cs
- RefreshTokenRepository.cs

Service:
- AuthService.cs
- JwtService.cs
- UserService.cs

Controller:
- AuthController.cs
- UserController.cs

Middleware:
- UserStatusMiddleware.cs
```

API:

```txt
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

GET  /api/users/me
PATCH /api/users/me/profile
```

Middleware chặn:

```txt
LOCKED user không được gọi API
DELETED user không được login
```

### Frontend cần làm

```txt
Pages:
- LoginPage.tsx
- RegisterPage.tsx
- ProfilePage.tsx

Components:
- LoginForm.tsx
- RegisterForm.tsx
- UserMenu.tsx
- ProtectedRoute.tsx
- RoleGuard.tsx

Services:
- authApi.ts
- userApi.ts
- apiClient.ts

Store:
- authStore.ts
```

### Test cần làm

```txt
[ ] Register thành công
[ ] Register email trùng
[ ] Login đúng
[ ] Login sai password
[ ] Token được lưu ở FE
[ ] Auto attach token vào API
[ ] PLAYER không vào được admin
[ ] ADMIN vào được admin
[ ] LOCKED user bị chặn
```

### Output cuối cùng

```txt
Người dùng có thể đăng ký, đăng nhập, logout.
Admin và Player được phân quyền rõ ràng.
FE tự điều hướng theo role.
```

## Member 2 - Case System + Case JSON

### Mục tiêu

Làm hệ thống case để admin import case JSON, player xem danh sách case và xem chi tiết case.

### Backend cần làm

```txt
Models:
- GameCase.cs
- Stage.cs
- Scene.cs
- Character.cs
- Item.cs
- Clue.cs
- Dialogue.cs
- FinalCaseLogic.cs

DTOs:
- ImportCaseRequest.cs
- CaseListResponse.cs
- CaseDetailResponse.cs
- PublishCaseRequest.cs
- CaseValidationResult.cs

Repository:
- CaseRepository.cs

Service:
- CaseService.cs
- CaseImportService.cs
- CaseValidationService.cs

Controller:
- CaseController.cs
- AdminCaseController.cs
```

API cho Player:

```txt
GET /api/cases/published
GET /api/cases/{caseId}
```

API cho Admin:

```txt
POST  /api/admin/cases/import-json
GET   /api/admin/cases
GET   /api/admin/cases/{caseId}
PATCH /api/admin/cases/{caseId}/publish
PATCH /api/admin/cases/{caseId}/unpublish
PATCH /api/admin/cases/{caseId}/delete
```

### Frontend cần làm

```txt
Player pages:
- CaseListPage.tsx
- CaseDetailPage.tsx

Admin pages:
- AdminCaseListPage.tsx
- AdminCaseDetailPage.tsx
- ImportCaseJsonPage.tsx

Components:
- CaseCard.tsx
- CaseDetailPanel.tsx
- CaseStatusBadge.tsx
- ImportJsonForm.tsx
- CaseStructureViewer.tsx

Services:
- caseApi.ts
- adminCaseApi.ts

Types:
- case.types.ts
```

### Test cần làm

```txt
[ ] Admin import case JSON được
[ ] Case JSON thiếu field thì báo lỗi
[ ] Admin publish case được
[ ] Admin unpublish case được
[ ] Player chỉ thấy case published
[ ] Player xem detail case được
[ ] Case có stage, scene, character, item, clue, dialogue
```

### Output cuối cùng

```txt
Có ít nhất 1 case mẫu trong MongoDB.
Player xem được case published.
Admin import/publish/unpublish case được.
```

## Member 3 - Room + Lobby Realtime

### Mục tiêu

Làm toàn bộ flow tạo phòng, join phòng, chọn vai, ready và start game.

### Backend cần làm

```txt
Models:
- GameRoom.cs
- RoomPlayer.cs
- RoomProgress.cs
- RoomChatMessage.cs

DTOs:
- CreateRoomRequest.cs
- JoinRoomRequest.cs
- RoomResponse.cs
- SelectRoleRequest.cs
- ReadyRequest.cs
- StartRoomRequest.cs

Repository:
- RoomRepository.cs

Service:
- RoomService.cs
- RoomCodeService.cs
- LobbyRealtimeService.cs

Controller:
- RoomController.cs

SignalR Hub:
- GameHub.cs
```

API:

```txt
POST /api/rooms
POST /api/rooms/join
GET  /api/rooms/{roomId}
POST /api/rooms/{roomId}/select-role
POST /api/rooms/{roomId}/ready
POST /api/rooms/{roomId}/start
POST /api/rooms/{roomId}/leave
```

SignalR client gửi lên:

```txt
JoinRoom
LeaveRoom
SelectRole
Ready
StartGame
SendRoomMessage
```

SignalR server bắn về:

```txt
PlayerJoined
PlayerLeft
RolesUpdated
ReadyUpdated
GameStarted
RoomMessageReceived
RoomError
```

### Frontend cần làm

```txt
Pages:
- CreateRoomPage.tsx
- JoinRoomPage.tsx
- RoomLobbyPage.tsx

Components:
- RoomCodeBox.tsx
- PlayerSlot.tsx
- RoleSelector.tsx
- ReadyButton.tsx
- StartGameButton.tsx
- LobbyChatBox.tsx

Services:
- roomApi.ts
- signalrClient.ts

Store:
- roomStore.ts
```

### Rule cần xử lý

```txt
- Một phòng tối đa 2 người
- Người tạo phòng là host
- Chỉ host được start
- Phải đủ 2 người mới start
- 2 người không được chọn trùng vai
- Chỉ start khi cả 2 đã ready
- Vai trong game: INVESTIGATOR, INTERROGATOR
```

### Test cần làm

```txt
[ ] Player tạo room được
[ ] Player 2 join bằng room code được
[ ] Player thứ 3 không join được
[ ] Host chọn vai được
[ ] Guest chọn vai được
[ ] Không chọn trùng vai
[ ] Ready realtime
[ ] Host start game
[ ] Guest thấy game started realtime
[ ] Refresh page không mất room
```

### Output cuối cùng

```txt
2 người chơi có thể vào cùng 1 phòng.
Lobby realtime sync được.
Host start game được.
```

## Member 4 - Gameplay Runtime

### Mục tiêu

Làm lõi gameplay: xem scene, click item, unlock clue, hỏi nhân vật, present evidence, accuse và xem result.

### Backend cần làm

```txt
Models:
- GameActionLog.cs
- GameResult.cs
- FoundItem.cs
- FoundClue.cs
- DialogueState.cs
- FinalAccusation.cs

DTOs:
- GameStateResponse.cs
- InspectItemRequest.cs
- AskDialogueRequest.cs
- PresentEvidenceRequest.cs
- AccuseRequest.cs
- GameResultResponse.cs

Repository:
- GameActionLogRepository.cs
- GameResultRepository.cs

Service:
- GameRuntimeService.cs
- SceneService.cs
- ClueUnlockService.cs
- DialogueService.cs
- EvidenceService.cs
- AccusationService.cs

Controller:
- GameController.cs
```

API:

```txt
GET  /api/game/rooms/{roomId}/state
POST /api/game/rooms/{roomId}/inspect-item
POST /api/game/rooms/{roomId}/ask-dialogue
POST /api/game/rooms/{roomId}/present-evidence
POST /api/game/rooms/{roomId}/complete-scene
POST /api/game/rooms/{roomId}/complete-stage
POST /api/game/rooms/{roomId}/accuse
GET  /api/game/results/{resultId}
```

SignalR server bắn về:

```txt
ItemFound
ClueUnlocked
DialogueAnswered
EvidencePresented
SceneChanged
StageChanged
GameCompleted
SystemMessageReceived
```

### Frontend cần làm

```txt
Pages:
- GamePage.tsx
- AccusationPage.tsx
- ResultPage.tsx

Components:
- GameScene.tsx
- ClickableItem.tsx
- CluePanel.tsx
- InventoryPanel.tsx
- CharacterPanel.tsx
- DialoguePanel.tsx
- EvidenceSelector.tsx
- StageProgressBar.tsx
- SystemLog.tsx
- AccusationForm.tsx
- ResultSummary.tsx

Services:
- gameApi.ts

Store:
- gameStore.ts
```

### Rule cần xử lý

```txt
Client không tự unlock clue local.

Flow đúng:
Client click item
-> Backend validate
-> Backend update MongoDB
-> Backend bắn SignalR cho cả room
-> FE nhận event và update UI
```

### Test cần làm

```txt
[ ] Load game state được
[ ] Click item unlock clue đúng
[ ] Click lại item không duplicate clue
[ ] 2 người đều thấy clue mới realtime
[ ] Dialogue bị lock nếu thiếu clue
[ ] Present evidence đúng unlock thông tin mới
[ ] Present evidence sai có message lỗi
[ ] Chuyển scene/stage được
[ ] Accuse đúng ra win
[ ] Accuse sai ra fail
[ ] Result lưu DB
```

### Output cuối cùng

```txt
Game chơi được từ đầu đến cuối bằng case JSON mẫu.
Có result thắng/thua.
Có action log.
```

## Member 5 - Admin + AI + Cloudinary

### Mục tiêu

Làm hệ thống admin quản lý data và AI case creator.

### Backend cần làm

```txt
Models:
- AiCaseDraft.cs
- AiGenerationLog.cs
- GeneratedAsset.cs
- AdminDashboardStats.cs

DTOs:
- AdminDashboardResponse.cs
- AdminUserResponse.cs
- AdminRoomResponse.cs
- AdminResultResponse.cs
- CreateAiCaseRequest.cs
- AiCaseDraftResponse.cs
- GenerateAssetRequest.cs

Repository:
- AiCaseRepository.cs
- AiGenerationLogRepository.cs
- GeneratedAssetRepository.cs

Service:
- AdminService.cs
- AiCaseService.cs
- DeepseekService.cs
- GeminiService.cs
- ChatGptImageService.cs
- CloudinaryService.cs
- AiCaseValidationService.cs

Controller:
- AdminController.cs
- AiCaseController.cs
- UploadController.cs
```

Admin API:

```txt
GET   /api/admin/dashboard
GET   /api/admin/users
PATCH /api/admin/users/{userId}/lock
PATCH /api/admin/users/{userId}/unlock

GET   /api/admin/rooms
GET   /api/admin/results
GET   /api/admin/logs
```

AI API:

```txt
POST /api/admin/ai-cases
POST /api/admin/ai-cases/{draftId}/generate-overview
POST /api/admin/ai-cases/{draftId}/generate-content
POST /api/admin/ai-cases/{draftId}/generate-assets
POST /api/admin/ai-cases/{draftId}/validate
POST /api/admin/ai-cases/{draftId}/preview
POST /api/admin/ai-cases/{draftId}/publish
```

Cloudinary API:

```txt
POST /api/uploads/image
```

### Frontend cần làm

```txt
Admin pages:
- AdminDashboardPage.tsx
- UserManagementPage.tsx
- RoomHistoryPage.tsx
- GameResultHistoryPage.tsx
- LogViewerPage.tsx
- AiCaseCreatorPage.tsx
- AiCasePreviewPage.tsx

Components:
- AdminStatCard.tsx
- AdminDataTable.tsx
- StatusBadge.tsx
- ConfirmModal.tsx
- AiPromptForm.tsx
- AiStepProgress.tsx
- JsonPreview.tsx
- GeneratedAssetGrid.tsx
- AiErrorPanel.tsx

Services:
- adminApi.ts
- aiCaseApi.ts
- uploadApi.ts
```

### AI flow cần làm

```txt
Admin nhập ý tưởng
-> Deepseek tạo story/gameplay JSON
-> Deepseek tạo scene/item/clue/dialogue
-> Gemini tạo background image
-> ChatGPT tạo character/item image
-> Upload Cloudinary
-> Lưu generatedAssets
-> Validate case
-> Preview
-> Publish
```

### Test cần làm

```txt
[ ] Admin xem dashboard được
[ ] Admin lock/unlock user được
[ ] Admin xem room history được
[ ] Admin xem game result được
[ ] Admin nhập prompt tạo draft được
[ ] AI sinh case JSON được
[ ] Generate ảnh upload Cloudinary được
[ ] Validate case AI được
[ ] Preview case AI được
[ ] Publish case AI thành case thật được
```

### Output cuối cùng

```txt
Admin quản lý được toàn bộ data.
Admin tạo case bằng AI được hoặc có bản demo ổn định.
Ảnh AI lưu trên Cloudinary.
```

## Cách chia tuần mới theo full stack feature

### Tuần 1 - Setup chung + mỗi member tạo base feature

| Member | Task |
| --- | --- |
| Member 1 | Setup Auth module BE/FE |
| Member 2 | Setup Case module BE/FE |
| Member 3 | Setup Room module BE/FE/SignalR |
| Member 4 | Setup Game module BE/FE |
| Member 5 | Setup Admin/AI/Cloudinary module BE/FE |

Output tuần 1:

```txt
- FE/BE chạy được
- MongoDB connect được
- Có folder chuẩn
- Mỗi member có branch feature riêng
- Mỗi feature có Controller/Service/Page rỗng
```

### Tuần 2 - Auth + Case nền

| Member | Task |
| --- | --- |
| Member 1 | Hoàn thiện login/register/JWT/role |
| Member 2 | Hoàn thiện GameCase model + import JSON |
| Member 3 | Chuẩn bị Room model + GameHub connect JWT |
| Member 4 | Thiết kế GameStateResponse + runtime skeleton |
| Member 5 | Admin layout + dashboard mock + env Cloudinary/AI |

Output tuần 2:

```txt
- Login/register chạy được
- Import case JSON mẫu được
- SignalR connect được với JWT
- Admin layout có route
```

### Tuần 3 - Case list + Room create/join

| Member | Task |
| --- | --- |
| Member 1 | Profile + auth guard + user status middleware |
| Member 2 | Player case list/detail + admin case publish |
| Member 3 | Create room + join room + room code |
| Member 4 | Load current scene từ case JSON |
| Member 5 | Admin case preview + setup Cloudinary upload |

Output tuần 3:

```txt
- Player đăng nhập xem case được
- Admin publish/unpublish case được
- Player tạo/join room được
- Game load được scene đầu tiên
```

### Tuần 4 - Lobby realtime

| Member | Task |
| --- | --- |
| Member 1 | Fix auth refresh/protected route |
| Member 2 | Case validation service |
| Member 3 | Lobby realtime: select role, ready, start |
| Member 4 | Chuẩn bị game state khi room start |
| Member 5 | Admin room history basic |

Output tuần 4:

```txt
- 2 người vào lobby realtime
- Chọn vai được
- Ready được
- Host start game được
```

### Tuần 5 - Gameplay item/clue

| Member | Task |
| --- | --- |
| Member 1 | Support user info trong action log |
| Member 2 | Bổ sung item/clue relation trong case JSON |
| Member 3 | Sync SignalR event cho gameplay |
| Member 4 | Inspect item + unlock clue + FE game scene |
| Member 5 | Admin xem action log basic |

Output tuần 5:

```txt
- Game screen chạy được
- Click item unlock clue
- 2 người thấy clue realtime
- Action log được lưu
```

### Tuần 6 - Dialogue/evidence

| Member | Task |
| --- | --- |
| Member 1 | Guard API theo room membership |
| Member 2 | Bổ sung dialogue/evidence rule vào case |
| Member 3 | Sync DialogueAnswered/EvidencePresented |
| Member 4 | Ask dialogue + present evidence + FE dialogue |
| Member 5 | Admin case structure viewer |

Output tuần 6:

```txt
- Hỏi nhân vật được
- Present evidence được
- Unlock dialogue/clue mới được
```

### Tuần 7 - Final accusation + result + chat

| Member | Task |
| --- | --- |
| Member 1 | User result history API nếu cần |
| Member 2 | FinalCaseLogic trong case JSON |
| Member 3 | Room chat realtime |
| Member 4 | Accuse + result + FE result page |
| Member 5 | Admin game result history |

Output tuần 7:

```txt
- Game chơi được từ đầu đến cuối
- Có thắng/thua
- Có chat text
- Admin xem result được
```

### Tuần 8 - Admin management + polish

| Member | Task |
| --- | --- |
| Member 1 | Admin user management |
| Member 2 | Admin case management polish |
| Member 3 | Room reconnect/refresh handling |
| Member 4 | Gameplay UI polish + error state |
| Member 5 | Admin dashboard thật + log viewer |

Output tuần 8:

```txt
- Admin quản lý user/case/room/result/log
- Player UI ổn hơn
- Reconnect tốt hơn
```

### Tuần 9 - AI Case Creator

| Member | Task |
| --- | --- |
| Member 1 | Auth guard cho admin AI API |
| Member 2 | Validate AI case JSON theo schema |
| Member 3 | Test AI case có chơi được trong room không |
| Member 4 | Fix gameplay render dynamic case |
| Member 5 | AI Case Creator + Deepseek/Gemini/ChatGPT/Cloudinary |

Output tuần 9:

```txt
- Admin nhập prompt tạo case AI
- AI sinh JSON
- AI tạo ảnh
- Upload Cloudinary
- Preview case
- Publish case
```

### Tuần 10 - Fix bug + demo + deploy

| Member | Task |
| --- | --- |
| Member 1 | Fix auth/security/user bug |
| Member 2 | Fix case JSON/validation bug |
| Member 3 | Fix room/realtime/reconnect bug |
| Member 4 | Fix gameplay/result bug |
| Member 5 | Fix admin/AI/deploy/docs/demo script |

Output tuần 10:

```txt
- Demo full flow
- Có admin account
- Có player account
- Có ít nhất 1 case mẫu
- Có thể tạo room 2 người
- Có thể chơi tới kết thúc
- Admin xem data được
- AI creator có demo
```

## Branch Git theo feature

```txt
main
develop

feature/auth-user
feature/case-system
feature/room-lobby
feature/gameplay-runtime
feature/admin-ai
```

Mỗi member làm trên branch riêng:

```txt
Member 1 -> feature/auth-user
Member 2 -> feature/case-system
Member 3 -> feature/room-lobby
Member 4 -> feature/gameplay-runtime
Member 5 -> feature/admin-ai
```

Quy tắc merge:

```txt
1. Mỗi feature phải chạy được cả BE + FE
2. Có API test cơ bản
3. Không làm hỏng flow của member khác
4. Pull develop mỗi ngày
5. Merge vào develop theo tuần
6. main chỉ dùng cho bản demo ổn định
```

## Prompt chuẩn cho AI

```txt
Bạn đang làm project SirLocked. Hãy đọc docs/AI_ALIGNMENT_RULES.md và docs/FULLSTACK_FEATURE_PLAN.md trước.

Task:
[mô tả task cụ thể]

Tuần:
[1-10]

Feature owner:
[Member 1 Auth + User + Role | Member 2 Case System | Member 3 Room + Lobby Realtime | Member 4 Gameplay Runtime | Member 5 Admin + AI + Cloudinary]

Yêu cầu:
- Làm full stack cho feature: Model/DTO/Repository/Service/Controller + FE page/component/service/state + test/docs nếu liên quan.
- Không làm ngoài scope tuần.
- Không đổi contract của feature khác nếu chưa cần.
- Nếu đổi API/SignalR/schema, cập nhật docs.
- Sau khi sửa, chạy kiểm tra phù hợp và báo rõ kết quả.

Output mong muốn:
[file/API/UI/test cụ thể]
```

## Kết luận

```txt
Member 1: Auth + User + Role full stack
Member 2: Case System full stack
Member 3: Room + Lobby Realtime full stack
Member 4: Gameplay Runtime full stack
Member 5: Admin + AI + Cloudinary full stack
```

Cách này giúp mỗi người có một feature rõ ràng, tự code từ database đến UI, dễ demo, dễ báo cáo tiến độ, và tránh tình trạng FE phải chờ BE.
