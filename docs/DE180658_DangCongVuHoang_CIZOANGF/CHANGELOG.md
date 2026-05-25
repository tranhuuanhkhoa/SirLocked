# Changelog - Dang Cong Vu Hoang

## 2026-05-25 - Week 1 React FE + .NET BE Setup

### Added

- Added real backend project at `src/BE/SirLocked.API.csproj`.
- Added `Program.cs` with controller routing, MongoDB DI, JWT authentication, role authorization, CORS, SignalR, and `/api/health`.
- Added MongoDB/JWT configuration:
  - `src/BE/appsettings.json`
  - `src/BE/appsettings.Development.json`
  - `src/BE/Configurations/MongoDbSettings.cs`
  - `src/BE/Configurations/JwtSettings.cs`
- Added auth/user backend files:
  - `src/BE/Models/User.cs`
  - `src/BE/Models/RefreshToken.cs`
  - `src/BE/DTOs/Auth/RegisterRequest.cs`
  - `src/BE/DTOs/Auth/LoginRequest.cs`
  - `src/BE/DTOs/Auth/AuthResponse.cs`
  - `src/BE/DTOs/Users/UserProfileResponse.cs`
  - `src/BE/DTOs/Users/UpdateProfileRequest.cs`
  - `src/BE/DTOs/Users/UpdateUserStatusRequest.cs`
  - `src/BE/Repositories/IUserRepository.cs`
  - `src/BE/Repositories/UserRepository.cs`
  - `src/BE/Services/AuthService.cs`
  - `src/BE/Services/JwtService.cs`
  - `src/BE/Services/UserService.cs`
  - `src/BE/Services/Pbkdf2PasswordHasher.cs`
- Added backend controllers:
  - `src/BE/Controllers/AuthController.cs`
  - `src/BE/Controllers/UsersController.cs`
  - `src/BE/Controllers/AdminUsersController.cs`
- Added `src/BE/Middlewares/UserStatusMiddleware.cs` to block locked users.
- Added `src/BE/Hubs/GameHub.cs` as Week 1 SignalR placeholder.
- Added `src/BE/Properties/launchSettings.json`.
- Added React FE structure:
  - `src/FE/src/api`
  - `src/FE/src/components`
  - `src/FE/src/contexts`
  - `src/FE/src/hooks`
  - `src/FE/src/layouts`
  - `src/FE/src/pages`
  - `src/FE/src/routes`
  - `src/FE/src/styles`
- Added FE auth/routing files:
  - `src/FE/src/api/apiClient.js`
  - `src/FE/src/api/authApi.js`
  - `src/FE/src/api/userApi.js`
  - `src/FE/src/api/adminApi.js`
  - `src/FE/src/contexts/AuthContext.jsx`
  - `src/FE/src/components/ProtectedRoute.jsx`
  - `src/FE/src/components/RoleRoute.jsx`
  - `src/FE/src/layouts/AppLayout.jsx`
  - `src/FE/src/routes/AppRoutes.jsx`
  - `src/FE/src/pages/HomePage.jsx`
  - `src/FE/src/pages/LoginPage.jsx`
  - `src/FE/src/pages/RegisterPage.jsx`
  - `src/FE/src/pages/DashboardPage.jsx`
  - `src/FE/src/pages/AdminUsersPage.jsx`
  - `src/FE/src/styles/app.css`
  - `src/FE/.env.example`

### Updated

- Replaced `src/FE/src/App.jsx` with the new React app shell using `AuthProvider`, `AppLayout`, and `AppRoutes`.
- Updated `src/FE/src/main.jsx` to use the new app-level stylesheet instead of the old static prototype CSS imports.
- Recreated `SirLocked.sln` as a real .NET solution and added `src/BE/SirLocked.API.csproj`.

### APIs Completed

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/users/me`
- `PATCH /api/users/me/profile`
- `GET /api/admin/users`
- `PATCH /api/admin/users/{id}/lock`
- `PATCH /api/admin/users/{id}/unlock`

### Tested

- `dotnet build SirLocked.sln`: passed.
- `npm run build` in `src/FE`: passed.
- `GET /api/health` on `http://localhost:5292/api/health`: returned healthy response.

### Not Fully Tested Yet

- Auth API register/login requires a running MongoDB instance.
- Admin user list and lock/unlock require seeded users in MongoDB.
