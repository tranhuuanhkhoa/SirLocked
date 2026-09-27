# Implementation Plan

Last synced with code: 2026-06-12.

This plan reflects current repository state. Completed items should stay stable unless a new feature explicitly changes the scope.

## Completed Backend Foundation

- .NET 9 ASP.NET Core Web API project.
- MongoDB context and startup indexes.
- JWT auth with seeded admin.
- Error handling middleware.
- User status middleware.
- Swagger with bearer auth.
- CORS for local Vite origins.
- SignalR game hub.

## Completed Domain Features

- User register/login/me/logout.
- Admin dashboard/users/lock/unlock/role.
- Published case list/detail.
- Admin case validate/import/publish/unpublish.
- Sample and demo seed.
- Room create/join/get/leave.
- Role select/ready/start.
- Gameplay state read.
- Inspect item.
- Ask dialogue.
- Present evidence.
- Complete scene/stage.
- Revisit scene.
- Final accusation and result.
- Action logs.
- Realtime room/game events.
- Player pose broadcast.

## Completed AI Features

- `GenerateAiCaseRequest` and `AiDraftResponse`.
- OpenAI story preview generation.
- Preview approval endpoint.
- OpenAI full-case generation after approval.
- Case auto repair.
- Strict validation.
- Export bundle.
- Automatic import and publish after approval.

## Completed Frontend Features

- Hash router.
- Session service.
- API wrapper and endpoint clients.
- Login/register page.
- Case list/detail.
- Create/join room.
- Lobby page.
- Game page.
- Result page.
- Admin dashboard/users/cases/import.
- Admin/VIP AI creator route.
- SignalR reconnect helper.

## Verification Tasks

Run before demo or handoff:

```powershell
dotnet test SirLocked.sln
cd src/FE
npm run typecheck
npm run build
```

Run with backend and MongoDB active:

```powershell
python scripts/e2e_smoke.py --base http://localhost:5215
```

## Remaining Practical Improvements

- Add browser automation for the two-session room flow.
- Add SignalR reconnect integration test.
- Add MongoDB test fixture for services.
- Add production deployment profile.
- Add admin case editor for repairing generated JSON.
- Add persistent room chat only after the gameplay loop stays stable.
- Add generated image upload only after asset requirements are clear.

## Do Not Rework Without Scope Change

- Do not split gameplay state into a separate collection.
- Do not support more than two active players.
- Do not make frontend authoritative for unlock/progression rules.
- Do not replace the current controller route shape with duplicate minimal APIs.
- Do not migrate all frontend JavaScript to TypeScript unless requested.
