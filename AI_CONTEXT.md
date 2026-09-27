# SirLocked MVP Context

## Project

- Backend: ASP.NET Core Web API, MongoDB, SignalR, JWT auth.
- Frontend: React-free Vite JavaScript SPA using existing JS/CSS patterns, with the gameplay renderer implemented in Phaser 4 + TypeScript.
- Branch: `develop`.
- Latest local commit: `08c4bc0 Implement SirLocked MVP`.

## Current State

- Full SirLocked MVP source has been implemented locally.
- Backend includes auth, admin seed/import/validate/publish, cases, rooms, SignalR hub, gameplay runtime, final accusation, and AI case generation with Deepseek/mock fallback.
- Frontend includes login/register, published cases, room lobby, role selection, ready/start flow, Phaser gameplay scene renderer, hotspots, dialogue overlays, progression, result, and admin case/AI pages.
- Sample case exists in `ai-game-docs/samples/sample-case.json` and is copied to `src/BE/SeedData/sample-case.json`.
- Local verification previously passed for backend build/tests, API smoke script, and frontend build.

## Important Files

- Backend entry: `src/BE/Program.cs`
- Backend project: `src/BE/SirLocked.Api.csproj`
- Tests: `src/BE/Tests/`
- Smoke test: `scripts/e2e_smoke.py`
- Frontend entry: `src/FE/Client/js/main.js`
- Frontend routes/pages: `src/FE/Client/js/pages/`
- Gameplay renderer: `src/FE/Client/js/pages/gamePage.ts`
- Frontend API wrappers: `src/FE/Client/js/api/`
- Styles: `src/FE/css/09-app.css`
- Seed case: `src/BE/SeedData/sample-case.json`
- Docs: `ai-game-docs/CLAUDE.md`

## Setup Notes

- MongoDB connection defaults to `mongodb://localhost:27017`.
- API defaults to `http://localhost:5000`.
- Frontend defaults to `http://localhost:5173`.
- Optional AI/image keys are not required; mock fallback should keep the app runnable.

## Continue On Another Machine

Run:

```bash
git pull
dotnet restore SirLocked.sln
dotnet test SirLocked.sln
cd src/FE
npm install
npm run typecheck
npm run build
```

Then start backend and frontend:

```bash
dotnet run --project src/BE/SirLocked.Api.csproj
cd src/FE
npm run dev
```

## Do Not

- Do not migrate the whole frontend to TypeScript without a clear reason. TypeScript is currently used only for the Phaser gameplay renderer.
- Do not rewrite frameworks.
- Do not hard-code case, scene, clue, item, character, or dialogue IDs in frontend logic.
- Do not add VIP/payment/analytics/leaderboard/replay/rating features.
