# Codex Instructions

Last synced with code: 2026-06-12.

## Repository Orientation

This is a working SirLocked MVP. Before changing behavior, inspect the existing controller, service, DTO, model, and frontend API wrapper for that feature.

Important paths:

- `src/BE/Program.cs`
- `src/BE/WebAPI/Controllers`
- `src/BE/WebAPI/Hubs/GameHub.cs`
- `src/BE/Services`
- `src/BE/Models`
- `src/BE/DTOs`
- `src/BE/SeedData/sample-case.json`
- `src/FE/Client/js/main.js`
- `src/FE/Client/js/api`
- `src/FE/Client/js/pages`
- `ai-game-docs`

## Current Contracts

- Backend target: `net9.0`.
- API response envelope: `{ success, message, data, errors }`.
- Auth: JWT bearer.
- SignalR hub: `/hubs/game`.
- Room size: exactly two players for start.
- Roles: `INVESTIGATOR`, `INTERROGATOR`.
- User roles: `PLAYER`, `VIP`, `ADMIN`.
- Room statuses: `WAITING`, `READY`, `IN_PROGRESS`, `COMPLETED`.
- Game statuses: `IN_PROGRESS`, `WON`, `FAILED`.

## Backend Implementation Rules

- Keep Web API controllers unless the whole route strategy is intentionally changed.
- Register services in `Program.cs`.
- Keep MongoDB camelCase conventions.
- Add indexes in `MongoDbContext.EnsureIndexesAsync` when new uniqueness/query requirements are real.
- Throw `ApiException` for expected API failures.
- Preserve `UserStatusMiddleware` behavior for locked users.
- Preserve SignalR JWT query handling for `/hubs`.
- Gameplay mutations must keep optimistic concurrency on `gameplayState.version`.

## Gameplay Rules

- Only `INVESTIGATOR` inspects items.
- Only `INTERROGATOR` asks dialogue.
- Both players can complete scenes, revisit scenes, present evidence, and accuse.
- Inspect and ask actions are idempotent.
- `complete-scene` performs progression; `complete-stage` is confirmation.
- `go-to-scene` can only revisit visited scenes.
- Final accusation requires last scene and all required evidence clues unlocked.
- Wrong accusation completes the room with a failed result.

## 2D Movement Direction

If implementing Sherlock/Watson-style movement, read these docs first:

- `PLAYER_MOVEMENT_SYSTEM.md`
- `REALTIME_CHARACTER_SYNC.md`
- `SCENE_RUNTIME_SCHEMA.md`

Movement must be layered on top of existing backend gameplay commands. Do not move clue unlock/progression authority into the client. Pose sync is visual/transient unless a later change explicitly persists and validates player positions server-side.

## AI Rules

- AI case creation is OpenAI-only.
- No OpenAI API key means AI generation fails with a configuration error.
- Story preview must stay spoiler-free.
- Full logic is generated only after preview approval.
- OpenAI invalid full-case output gets one repair/validation retry.
- Valid generated bundles are exported to `src/BE/GeneratedCaseJson/`.
- Do not commit generated bundles.

## Frontend Rules

- Preserve hash routes unless refactoring the router intentionally.
- Use existing `apiFetch` wrapper.
- Add endpoint wrappers before calling raw `fetch` from pages.
- Use SignalR helper and refetch state after reconnect.
- Treat `GameStateUpdated` as canonical.
- Keep public player pages from exposing hidden final case logic.

## Documentation Rules

When code logic changes, update at least:

- `API_SPEC.md` for routes, DTOs, SignalR events.
- `DATABASE_SCHEMA.md` for model/collection/index changes.
- `GAMEPLAY_FLOW.md` for gameplay rule changes.
- `PLAYER_MOVEMENT_SYSTEM.md`, `REALTIME_CHARACTER_SYNC.md`, and `SCENE_RUNTIME_SCHEMA.md` for 2D movement/runtime changes.
- `FRONTEND_PAGES.md` for route/page/client changes.
- `TESTING_STRATEGY.md` when verification changes.

## Verification

Use the smallest relevant set, then broaden when shared behavior changes:

```powershell
dotnet test SirLocked.sln
cd src/FE
npm run typecheck
npm run build
```

With MongoDB and backend running:

```powershell
python scripts/e2e_smoke.py --base http://localhost:5215
```
