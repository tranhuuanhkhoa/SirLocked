# Deployment And Operations

Last synced with code: 2026-09-20.

## Local Requirements

- .NET SDK 9.
- Node.js 20+.
- Docker Desktop or local MongoDB.
- PowerShell on Windows.

## Environment

Create `.env` at repository root using `ai-game-docs/.env.example`.

Required for backend startup:

- `MongoDb__ConnectionString`
- `MongoDb__DatabaseName`
- `Jwt__Secret` with at least 32 characters
- `Jwt__Issuer`
- `Jwt__Audience`

Required for AI case creation:

- `OpenAI__ApiKey`
- `OpenAI__LogicModel`
- `OpenAI__ImageModel`
- `OpenAI__BaseUrl`
- `OpenAI__TimeoutSeconds`

Required for public AI generation:

- `Cloudinary__Enabled=true`, `Cloudinary__CloudName`, `Cloudinary__ApiKey`, and `Cloudinary__ApiSecret`
- `AiQuota__Enabled=true`, `AiQuota__MaxActiveDraftsPerUser=1`, and `AiQuota__MaxCasesPerUserPerDay=1`
- `AiQuota__EstimatedCaseCostUsd` and `AiQuota__GlobalBudgetUsd` set by the operator; paid admission is refused when they are missing or exhausted
- SMTP host, port, sender, username, and password; production startup validation refuses incomplete SMTP configuration
- `TrustedProxies__0` (and additional entries) only for known HTTPS reverse proxies

The backend loads repo-root `.env` through `EnvFileLoader.LoadFromRepoRoot(Directory.GetCurrentDirectory())`.

## Run MongoDB

```powershell
docker compose up -d
```

The compose file starts `mongo:7` on port `27017` with volume `sirlocked-mongo-data`.

## Run Backend

```powershell
cd src/BE
dotnet run
```

Default launch URL:

```txt
http://localhost:5215
```

Swagger:

```txt
http://localhost:5215/swagger
```

Health:

```txt
http://localhost:5215/health
```

## Backend Startup Tasks

On startup the API:

- validates JWT secret length,
- configures MongoDB, JWT, AI, and Cloudinary options,
- registers services,
- enables CORS for `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://localhost:4173`,
- maps controllers and `/hubs/game`,
- pings MongoDB,
- creates indexes,
- seeds default admin if no admin exists.

In Development, MongoDB startup failures can remain degraded for local work. In
Production, the API refuses to start until MongoDB is reachable and indexes are
ensured, unless `MongoDb__AllowDegradedStartup=true` is explicitly set for a
controlled maintenance window.

## Run Frontend

```powershell
cd src/FE
npm install
npm run dev
```

Default Vite URL:

```txt
http://localhost:5173
```

## Demo Setup

1. Start MongoDB.
2. Start backend.
3. Login as `admin@sirlocked.local` / `Admin123!`.
4. Seed sample or demo cases from admin UI or API.
5. Publish a case.
6. Start frontend.
7. Use two browser sessions/accounts to create and join a room.

## Generated Files

AI draft exports are written under:

```txt
src/BE/GeneratedCaseJson/
```

Generated AI image assets are written under:

```txt
src/FE/public/assets/ai-generated/
```

These folders are excluded from source control. For production, generated case
assets are uploaded by the API to Cloudinary with stable case-scoped public IDs;
published cases store secure URLs and do not depend on the source checkout at
runtime. Evidence photos captured by players remain behind the authenticated
MongoDB-backed endpoint.

## Production Notes

- Replace default admin password immediately after first deployment.
- Use a strong JWT secret from a secret manager.
- Restrict CORS origins to production frontend URLs.
- Use managed MongoDB or persistent backups.
- Do not expose `.env`.
- Configure HTTPS termination.
- Keep Swagger disabled or protected if deploying publicly.
