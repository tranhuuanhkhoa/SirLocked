# Changelog - Le Minh Nhat

## 2026-05-25 - Week 1 Admin + AI + Cloudinary Scaffold

### Added

- Added AI/Cloudinary config classes:
  - `src/BE/Configurations/AiSettings.cs`
  - `src/BE/Configurations/CloudinarySettings.cs`
- Added Admin/AI models:
  - `src/BE/Models/AdminAiModels.cs`
- Added Admin/AI DTOs:
  - `src/BE/DTOs/Admin/AdminDtos.cs`
- Added repository/service/controller scaffold:
  - `src/BE/Repositories/IAiCaseRepository.cs`
  - `src/BE/Repositories/AiCaseRepository.cs`
  - `src/BE/Services/IAdminService.cs`
  - `src/BE/Services/AdminService.cs`
  - `src/BE/Services/IAiCaseService.cs`
  - `src/BE/Services/AiCaseService.cs`
  - `src/BE/Services/AiProviderPlaceholders.cs`
  - `src/BE/Controllers/AdminController.cs`
  - `src/BE/Controllers/AiCaseController.cs`
  - `src/BE/Controllers/UploadController.cs`
- Added React admin/AI files:
  - `src/FE/src/api/aiCaseApi.js`
  - `src/FE/src/pages/AdminDashboardPage.jsx`
  - `src/FE/src/pages/AiCaseCreatorPage.jsx`
- Added routes `/admin/dashboard` and `/admin/ai-cases`.

### Tested

- `dotnet build SirLocked.sln`: passed.
- `npm run build`: passed.
