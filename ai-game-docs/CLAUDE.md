# Claude Instructions

Last synced with code: 2026-06-12.

Use this repository as an existing implementation, not a blank project.

## Current Architecture

- Backend: `src/BE`, ASP.NET Core Web API, .NET 9.
- Frontend: `src/FE`, Vite SPA.
- Database: MongoDB.
- Realtime: SignalR hub `/hubs/game`.
- Main docs: `ai-game-docs`.

## Do First

1. Read `README.md`.
2. Read `ai-game-docs/API_SPEC.md`.
3. Read `ai-game-docs/DATABASE_SCHEMA.md`.
4. Read `ai-game-docs/GAMEPLAY_FLOW.md`.
5. Inspect the relevant controller/service before editing.

## Backend Rules

- Preserve current controller route shape.
- Use the response envelope `ApiResponse<T>`.
- Keep backend authoritative for game rules.
- Do not trust frontend state for unlocks, progress, roles, or final result.
- Keep gameplay state embedded in `gameRooms.gameplayState`.
- Preserve optimistic concurrency on `gameplayState.version`.
- Keep generated cases as `DRAFT` until admin import/publish.

## Frontend Rules

- Use existing hash router.
- Use existing API clients under `src/FE/Client/js/api`.
- Use `createRoomConnection` for SignalR.
- Refetch game state after reconnect.
- Do not expose full case logic on public player pages.
- Do not bypass role restrictions client-side.

## Case JSON Rules

- Keep camelCase.
- Use prefixed IDs.
- Final evidence IDs are clue IDs only.
- Every clue must be unlocked by an item or dialogue.
- Scene completion must be reachable in linear stage/scene order.
- Validate through backend before publishing.

## Verify

Run after relevant changes:

```powershell
dotnet test SirLocked.sln
cd src/FE
npm run typecheck
npm run build
```

Run API smoke test with backend and MongoDB active:

```powershell
python scripts/e2e_smoke.py --base http://localhost:5215
```
