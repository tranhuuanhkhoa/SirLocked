# Changelog - Nguyen Van Cau

## 2026-05-25 - Week 1 Room + Lobby Realtime Scaffold

### Added

- Added room helpers:
  - `src/BE/Helpers/RoomStatuses.cs`
  - `src/BE/Helpers/GameRoles.cs`
- Added room models:
  - `src/BE/Models/GameRoom.cs`
- Added room DTOs/repository/service/controller:
  - `src/BE/DTOs/Room/RoomDtos.cs`
  - `src/BE/Repositories/IRoomRepository.cs`
  - `src/BE/Repositories/RoomRepository.cs`
  - `src/BE/Services/IRoomService.cs`
  - `src/BE/Services/RoomService.cs`
  - `src/BE/Controllers/RoomController.cs`
- Added React room API and pages:
  - `src/FE/src/api/roomApi.js`
  - `src/FE/src/services/signalrClient.js`
  - `src/FE/src/pages/CreateRoomPage.jsx`
  - `src/FE/src/pages/RoomLobbyPage.jsx`
- Added routes `/rooms/create` and `/rooms/lobby`.

### Tested

- `dotnet build SirLocked.sln`: passed.
- `npm run build`: passed.
