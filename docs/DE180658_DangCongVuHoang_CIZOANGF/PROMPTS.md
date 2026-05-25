# Prompt Log - Dang Cong Vu Hoang

## 2026-05-25 - Week 1 Full-stack Setup Prompt

````markdown
# ROLE
Bạn là Senior Full-stack Developer kiêm Technical Lead cho dự án game điều tra multiplayer.

# PROJECT CONTEXT
Dự án là web game điều tra vụ án có multiplayer:
- Frontend: React
- Backend: .NET / ASP.NET Core
- Database: MongoDB
- Lưu ảnh/media: Cloudinary
- AI APIs:
  - DeepSeek: tạo case JSON, flow vụ án, logic điều tra
  - ChatGPT API: tạo character, item, clue, dialogue
  - Gemini API: generate background
- Game có login mới được chơi
- Có phân quyền:
  - Player
  - Host
  - Admin
- Multiplayer real-time:
  - 2 người chơi trong 1 phòng
  - 1 người điều tra hiện trường
  - 1 người tra khảo nhân vật/nghi phạm
  - Host chọn vai cho người chơi
- Người chơi có thể giao tiếp bằng chat hoặc mic
- Admin có thể tạo case bằng AI trực tiếp trên web và xem/quản lý data

# TASK
Hãy đọc toàn bộ các file docs/code hiện có trong project, đặc biệt:
- README.md
- docs/MASTER_PLAN.md
- docs/PROMPTS.md
- docs/AI_AUDIT_LOG.md
- docs/REFLECTION.md
- docs/CHANGELOG.md
- các file backend/frontend/database hiện có

Sau đó thực hiện công việc của TUẦN 1.

# WEEK 1 GOAL
Tuần 1 tập trung vào:
1. Setup kiến trúc project chuẩn
2. Chuẩn hóa cấu trúc folder FE/BE
3. Setup database MongoDB
4. Setup Auth cơ bản
5. Setup Role cơ bản
6. Chuẩn bị nền tảng cho multiplayer và AI case generation
7. Không code lan sang gameplay phức tạp nếu chưa cần

# WEEK 1 SCOPE

## 1. Backend Setup - .NET
Kiểm tra và hoàn thiện cấu trúc backend theo hướng clean architecture đơn giản:

- Controllers
- Services
- Repositories
- Models / Entities
- DTOs
- Configurations
- Middlewares
- Helpers
- Hubs nếu có realtime
- Program.cs cấu hình DI rõ ràng

Nếu cấu trúc hiện tại sai vị trí, hãy chỉ rõ file nào đang sai và đề xuất vị trí đúng trước khi sửa.

Backend cần có tối thiểu:

### Auth
- Register
- Login
- JWT token
- Password hashing
- Middleware xác thực JWT
- Role-based authorization

### User
Model User gồm tối thiểu:
- Id
- FullName
- Email
- PasswordHash
- Role
- Status
- CreatedAt
- UpdatedAt

Role gồm:
- ADMIN
- HOST
- PLAYER

Status gồm:
- ACTIVE
- LOCKED

### API tối thiểu
- POST /api/auth/register
- POST /api/auth/login
- GET /api/users/me
- GET /api/admin/users
- PATCH /api/admin/users/{id}/lock
- PATCH /api/admin/users/{id}/unlock

## 2. MongoDB Setup
Cấu hình MongoDB rõ ràng:
- Connection string trong appsettings.json
- MongoDbSettings class
- Register MongoDB client trong Program.cs
- Repository dùng MongoDB collection đúng cách

Không hard-code connection string trong code.

## 3. Frontend Setup - React
Kiểm tra và hoàn thiện frontend theo cấu trúc:

- src/
  - api/
  - assets/
  - components/
  - layouts/
  - pages/
  - routes/
  - hooks/
  - contexts/
  - services/
  - utils/
  - types/

Frontend Tuần 1 cần có tối thiểu:

### Pages
- LoginPage
- RegisterPage
- HomePage
- DashboardPage
- AdminUsersPage

### Auth
- Lưu token
- AuthContext
- ProtectedRoute
- RoleRoute
- Logout
- Gọi API login/register thật từ backend

### Routing
- Public route:
  - /
  - /login
  - /register

- Protected route:
  - /dashboard

- Admin route:
  - /admin/users

## 4. Documentation Update
Sau khi code xong, cập nhật docs:

### docs/CHANGELOG.md
Ghi rõ:
- Đã thêm file nào
- Đã sửa file nào
- API nào đã hoàn thành
- Chức năng nào đã test

### docs/AI_AUDIT_LOG.md
Ghi rõ:
- AI đã kiểm tra gì
- Phát hiện vấn đề gì
- Đã sửa gì
- Còn rủi ro gì

### docs/REFLECTION.md
Ghi ngắn gọn:
- Tuần 1 đã làm được gì
- Gặp khó khăn gì
- Tuần 2 nên làm gì tiếp

### docs/PROMPTS.md
Lưu lại prompt đã dùng trong lần code này.

# IMPORTANT RULES

## Code Rules
- Không xóa code cũ nếu không cần thiết.
- Không tự ý đổi công nghệ.
- Không tự ý đổi database.
- Không hard-code userId, adminId, role.
- Không mock API nếu backend đã có API thật.
- Không code gameplay phức tạp trong tuần 1.
- Không code AI generation sâu trong tuần 1, chỉ chuẩn bị structure/service placeholder nếu cần.
- Không code payment.
- Không code Cloudinary chi tiết nếu chưa cần.
- Không code voice chat trong tuần 1, chỉ chuẩn bị định hướng hoặc folder/service placeholder nếu hợp lý.

## Backend Rules
- Controller chỉ nhận request và trả response.
- Business logic nằm trong Service.
- Query database nằm trong Repository.
- DTO không được trộn với Entity.
- JWT secret phải lấy từ config.
- Password phải hash, không lưu plain text.
- API phải có response rõ ràng.

## Frontend Rules
- Không gọi fetch/axios trực tiếp lung tung trong component.
- API call đặt trong src/api hoặc src/services.
- Auth state đặt trong AuthContext.
- Route bảo vệ bằng ProtectedRoute/RoleRoute.
- UI chưa cần quá đẹp, ưu tiên chạy đúng flow.

# OUTPUT REQUIREMENT
Trước khi sửa code, hãy trả lời theo format:

## 1. Project Scan Summary
- Backend hiện có gì?
- Frontend hiện có gì?
- Docs hiện có gì?
- Thiếu gì so với Tuần 1?

## 2. Week 1 Implementation Plan
Liệt kê task theo thứ tự code:
1. ...
2. ...
3. ...

## 3. Files To Create / Update
Bảng gồm:
| File | Action | Purpose |
|---|---|---|

## 4. Risk Check
Liệt kê rủi ro có thể gây lỗi:
- Auth
- MongoDB
- Routing
- Role
- CORS
- JWT

Sau đó mới bắt đầu code.

# AFTER CODING
Sau khi code xong, bắt buộc trả lời:

## Completed
- ...

## Changed Files
- ...

## APIs Added
- ...

## Frontend Pages Added
- ...

## How To Run
Backend:

```bash
dotnet run
```
````
