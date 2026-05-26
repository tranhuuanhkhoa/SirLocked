# Changelog - Tran Huu Anh Khoa

## 2026-05-25 - Week 1 Gameplay Runtime Scaffold

### Added

- Added gameplay models:
  - `src/BE/Models/GameplayModels.cs`
- Added gameplay DTOs:
  - `src/BE/DTOs/Investigation/GameplayDtos.cs`
- Added gameplay repository/service/controller scaffold:
  - `src/BE/Repositories/IGameplayRepository.cs`
  - `src/BE/Repositories/GameplayRepository.cs`
  - `src/BE/Services/IGameplayService.cs`
  - `src/BE/Services/GameplayService.cs`
  - `src/BE/Controllers/GameController.cs`
- Added frontend gameplay API and page:
  - `src/FE/src/api/gameApi.js`
  - `src/FE/src/pages/GamePage.jsx`
- Added route `/game`.

### Tested

- `dotnet build SirLocked.sln`: passed.
- `npm run build`: passed.
