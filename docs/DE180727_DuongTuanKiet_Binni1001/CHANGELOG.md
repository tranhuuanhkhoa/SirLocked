# Changelog - Duong Tuan Kiet

## 2026-05-25 - Week 1 Case System Scaffold

### Added

- Added case domain model scaffold:
  - `src/BE/Models/GameCase.cs`
  - `Stage`, `Scene`, `Character`, `Item`, `Clue`, `Dialogue`, `FinalCaseLogic`
- Added case DTOs:
  - `src/BE/DTOs/Case/CaseDtos.cs`
- Added repository/service/controller scaffold:
  - `src/BE/Repositories/ICaseRepository.cs`
  - `src/BE/Repositories/CaseRepository.cs`
  - `src/BE/Services/ICaseService.cs`
  - `src/BE/Services/CaseService.cs`
  - `src/BE/Controllers/CaseController.cs`
  - `src/BE/Controllers/AdminCaseController.cs`
- Added frontend case API and page:
  - `src/FE/src/api/caseApi.js`
  - `src/FE/src/pages/CaseListPage.jsx`
- Added route `/cases`.

### Tested

- `dotnet build SirLocked.sln`: passed.
- `npm run build`: passed.

### Notes

- Week 1 scope is scaffold/contract only. Deep import/publish/edit flows continue in later weeks.
