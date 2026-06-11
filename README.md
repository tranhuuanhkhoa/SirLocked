# SirLocked

AI-assisted cooperative detective game MVP.

## Stack

- Backend: ASP.NET Core Web API, MongoDB, JWT, SignalR
- Frontend: Vite JavaScript SPA, with Phaser 4 + TypeScript for the gameplay renderer
- AI case generation: DeepSeek when configured, deterministic mock fallback otherwise

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
AI__DeepseekApiKey=
AI__DeepseekModel=deepseek-chat
AI__DeepseekBaseUrl=https://api.deepseek.com
AI__DeepseekTimeoutSeconds=900
```

If `AI__DeepseekApiKey` is empty, the AI case creator uses a validated mock case generator.

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

On backend startup, if no admin exists, the app seeds:

- Email: `admin@sirlocked.local`
- Password: `Admin123!`
- Role: `ADMIN`

Public registration creates `PLAYER` accounts. Admins can promote a non-admin user to `VIP` from the dashboard. `VIP` accounts can generate AI drafts; only admins can review/import/publish drafts.

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

## AI Case Drafts

Admin:

- Generate AI/mock draft
- View recent drafts
- Import draft as case
- Import and publish draft

VIP:

- Generate AI/mock draft
- View the generated JSON returned by that generation request

Generated bundles are written under `src/BE/GeneratedCaseJson/`, which is ignored by git.

## Verification

```powershell
dotnet test SirLocked.sln
cd src/FE
npm run typecheck
npm run build
```
