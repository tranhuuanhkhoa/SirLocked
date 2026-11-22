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
- `AdminSecurity__RequireTwoFactor` (optional, defaults to `false`)
- `AdminSecurity__StepUpMinutes` (optional, defaults to `5`)
- `DataProtection__KeysPath` (optional path for persistent Data Protection keys)

Required for AI case creation (the Claude bot answers through the bridge; the server calls no AI API):

- `Bridge__Key` (32+ characters), set with `bash scripts/set-bridge-key.sh`
- `Cloudinary__*` before the bot uploads case images

Required for public AI generation:

- `Cloudinary__Enabled=true`, `Cloudinary__CloudName`, `Cloudinary__ApiKey`, and `Cloudinary__ApiSecret`
- `AiQuota__Enabled=true`, `AiQuota__MaxActiveDraftsPerUser=1`, and `AiQuota__MaxCasesPerUserPerDay=1`
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

### Nginx security headers

Install `scripts/server/security-headers.conf` as `/etc/nginx/snippets/sirlocked-security-headers.conf` and include it in the SPA-serving `server` block:

```nginx
server {
    listen 443 ssl;
    server_name example.invalid;
    include /etc/nginx/snippets/sirlocked-security-headers.conf;
    # Existing SPA root and /api, /hubs, /signin-google proxy locations.
}
```

The snippet applies `nosniff`, frame, referrer, and permissions policies, HSTS, and a `Content-Security-Policy-Report-Only` policy. Report-Only is intentional while reports are reviewed; the current external allowances cover Cloudinary images, Google Fonts, Google ads, Google OAuth, and PayOS navigation used by the app.

When admin 2FA is enabled, configure `DataProtection__KeysPath` to a persistent
directory shared by all API instances and restricted to the API service
account. Protect and back up those keys with the deployment configuration:
losing them makes encrypted TOTP secrets unreadable. Admins can recover with a
saved one-time recovery code; otherwise a `SUPER_ADMIN` must reset the
affected account's 2FA.

# Deployment And Operations

## MongoDB backup and restore

Install MongoDB Database Tools (`mongodump`, `mongorestore`) and `mongosh` on the backup host. Create `/etc/sirlocked/backup.env` readable only by the service account:

```sh
MONGO_URI=mongodb://127.0.0.1:27017
MONGO_DB=sirlocked
BACKUP_DIR=/var/backups/sirlocked
KEEP=14
```

`backup-mongo.sh` writes a gzip archive and neighboring SHA-256 checksum and retains the newest `KEEP` archives. Restore is destructive to the selected target database and refuses to run without explicit confirmation:

```sh
MONGO_URI=... MONGO_DB=sirlocked scripts/server/restore-mongo.sh /var/backups/sirlocked/sirlocked-<timestamp>.archive.gz sirlocked_restore --yes
MONGO_URI=... MONGO_DB=sirlocked scripts/server/backup-verify.sh
```

Install `scripts/server/sirlocked-backup.service` and `.timer` as `/etc/systemd/system/` after setting `ExecStart` to the installed script path. Then run `systemctl daemon-reload && systemctl enable --now sirlocked-backup.timer`. The persistent timer runs daily at 03:00; `backup-verify.sh` restores into `${MONGO_DB}_restore_check`, compares collection counts and drops the scratch database on exit.

## Production Docker Compose

Set required application values in a private `.env` file, then run:

```sh
docker compose -f docker-compose.prod.yml up -d --build
curl -fsS http://localhost:8088/live
python scripts/e2e_smoke.py --base http://localhost:8088
```

MongoDB has no published host port and persists in the Compose project volume. The API uses the `api-keys` volume for Data Protection keys. Use a unique Compose project name for isolated deployments and tests; use `docker compose -p <project> -f docker-compose.prod.yml down -v` only for disposable projects.

The Compose port is configurable as `SIRLOCKED_WEB_PORT`; `SIRLOCKED_ENV_FILE` may point to an alternate environment file for isolated test runs. The existing API health endpoints are `/health` and `/live` at the root (not under `/api`).

## Telemetry and logging

Set `OpenTelemetry__OtlpEndpoint` to enable OTLP traces and metrics; without it no exporter is registered. `OpenTelemetry__ServiceName` defaults to `sirlocked-api`. `Logging__Json=true` enables JSON console logs with scopes, including `CorrelationId`.
