# SirLocked

AI-assisted cooperative detective game MVP.

## Stack

- Backend: ASP.NET Core Web API, MongoDB, JWT, SignalR
- Frontend: Vite JavaScript SPA, with Phaser 4 + TypeScript for the gameplay renderer
- AI case generation: OpenAI-only preview approval flow, with automatic validation and publishing

## Requirements

- .NET SDK 9
- Node.js 20+
- Docker Desktop, or a local MongoDB instance

## Configuration

Create `.env` in the repository root. The backend loader accepts ASP.NET-style double-underscore keys:

You can start from `ai-game-docs/.env.example`.

```env
MongoDb__ConnectionString=mongodb://localhost:27017
MongoDb__DatabaseName=SirLockedDb
Jwt__Secret=replace-with-at-least-32-characters
Jwt__Issuer=SirLocked
Jwt__Audience=SirLockedUsers
OpenAI__ApiKey=
OpenAI__LogicModel=gpt-5.5
OpenAI__ImageModel=gpt-image-2
OpenAI__CutoutImageModel=gpt-image-1.5
OpenAI__BaseUrl=https://api.openai.com/v1
OpenAI__TimeoutSeconds=900
```

`OpenAI__ApiKey` is required for the AI case creator. Keep real keys in local `.env` files or deployment secrets only.

## Run Locally

Start MongoDB:

```powershell
docker compose up -d
```

Run the backend:

```powershell
cd src/BE
dotnet run
```

Backend default URL: `http://localhost:5215`

Run the frontend:

```powershell
cd src/FE
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Demo Account

On backend startup in `Development`, if no admin exists, the app seeds:

- Email: `admin@sirlocked.local`
- Password: `Admin123!`
- Role: `ADMIN`

Outside `Development`, default admin seeding is disabled unless `Auth__SeedDefaultAdmin=true` is explicitly configured. When enabling it outside development, also configure `Auth__SeedAdminPassword`; do not use the demo password in deployed environments.

Public registration creates `PLAYER` accounts. Admins can promote a non-admin user to `VIP` from the dashboard. `VIP` and `ADMIN` accounts can create AI cases.

## Health Checks

- `/live` returns process liveness.
- `/health` reports readiness and checks MongoDB connectivity.

## Demo Flow

1. Log in as admin.
2. Open Admin Dashboard and seed demo/sample cases.
3. Publish a valid case if needed.
4. Register or log in as two player accounts in two browser sessions.
5. Player A opens a published case and creates a room.
6. Player B joins by room code.
7. Players select different roles: `INVESTIGATOR` and `INTERROGATOR`.
8. Both ready up; host starts the game.
9. Investigator clicks item hotspots to unlock clues.
10. Interrogator questions characters and unlocks dialogue clues.
11. Complete scenes/stages until final accusation is available.
12. Submit a culprit and evidence to reach win/fail result.

For a code-synced Vietnamese map of the current AI case creation, room, realtime,
and gameplay flows, see
[`ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md`](ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md).

## AI Case Creator

The AI flow uses explicit review gates:

1. Create and approve a spoiler-free story preview.
2. Generate and approve the hidden culprit logic and full case JSON.
3. Generate and approve scene backgrounds, clue regions, and placement metadata.
4. Generate final portraits, sprites, item assets, and runtime metadata.
5. An admin imports and publishes the validated case.

The culprit and final logic are first generated after story approval. Generated
bundles are written under `src/BE/GeneratedCaseJson/`, and generated image assets
under `src/FE/public/assets/ai-generated/`; both are ignored by git.

## Verification

```powershell
dotnet test SirLocked.sln
cd src/FE
npm run typecheck
npm run build
```
