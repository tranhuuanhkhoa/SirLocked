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
GameplayV3__Enabled=true
GameplayV3__PlaytestInstrumentationEnabled=false
Playtest__PseudonymKey=replace-with-at-least-32-characters
Playtest__RetentionDays=30
# Unset follows the case mechanics version; true/false forces it everywhere.
Accusation__RequireConsensus=
AiCaseV3Preset__Enabled=true
Email__FrontendUrl=http://localhost:5173
Cors__AllowedOrigins__0=http://localhost:5173
Swagger__Enabled=false
CaseCache__AbsoluteExpirationSeconds=300
CaseCache__SlidingExpirationSeconds=60
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
Swagger is always available in `Development`; outside Development it is disabled unless `Swagger__Enabled=true` is explicitly configured.
The case cache is process-local and intended for the current single-instance deployment. Use a distributed cache or coordinated invalidation before scaling the API to multiple instances.

### Playtest telemetry

Playtest telemetry is off by default. It is written only when `GameplayV3__Enabled` **and** `GameplayV3__PlaytestInstrumentationEnabled` are both `true`, and only for cases running the V3 paired-confrontation mechanics; otherwise the no-op sink stays registered and nothing is stored.

- No raw identifiers are persisted. Rooms become `sessionPseudonym` and players become `userHash`, both HMAC-SHA256 values keyed by `Playtest__PseudonymKey`. The user hash is salted with the room, so the same person in two rooms cannot be linked.
- `Playtest__PseudonymKey` must be at least 32 characters. Outside `Development` the API refuses to start without it; in `Development` a random per-process key is generated and a warning is logged.
- Documents live in the `playtestEvents` collection and are deleted automatically by a TTL index after `Playtest__RetentionDays` days (default 30). Keep this at or below 90 days.
- Aggregates are readable by admins at `GET /api/admin/playtest/summary?from=&to=` (UTC ISO, defaults to the last 7 days, maximum 90); the endpoint returns 404 while instrumentation is off. A summary folds at most 200,000 events; past that it answers `isTruncated: true` with `eventCount` so a wide window degrades instead of loading an unbounded result set.
- `POST /api/game/rooms/{roomId}/playtest-events` is limited to 120 accepted calls per minute per user; the UI emits far fewer, and the cap keeps a looping client from inflating the collection.

### Accusation consensus

The final accusation is the one decision that ends the match, so on V3 cases it takes both detectives. One player writes the whole proposal and the other reviews it as a block:

- `POST /api/game/rooms/{roomId}/accusation` opens a proposal. Writing it counts as its author's confirmation.
- `PUT /api/game/rooms/{roomId}/accusation/{attemptId}` amends it. The revision increments, every earlier confirmation is voided, and the editor becomes the only confirmer of the new revision.
- `POST /api/game/rooms/{roomId}/accusation/{attemptId}/confirm` agrees to a revision. Every command carries `expectedRevision`; confirming a revision that has since been edited returns 409 `ACCUSATION_STALE_REVISION` instead of silently agreeing to something else. Confirming twice is a harmless retry.
- `POST /api/game/rooms/{roomId}/accusation/{attemptId}/cancel` withdraws the proposal and lets either player start a new one.

The case ends the moment both players have confirmed the same revision. That final confirmation and the completed room are written together under the existing `gameplayState.version` check, so two simultaneous confirmations still produce exactly one `gameResults` document; the losing request gets a coded 409.

A proposal is reviewed by both players, but its evidence ids still respect the V3 knowledge boundary. A claim backed by a clue only the proposer discovered reaches the partner with `evidenceId: null` and `isUndisclosed: true`, so the partner sees the full shape of the accusation without being handed an id the paired-confrontation disclosure path never gave them.

`Accusation__RequireConsensus` decides who is subject to this. Leave it unset (the default) to follow the case: V3 cases require consensus and published V1/V2 cases keep the single-player `POST /accuse`. Set it to `true` or `false` to force one behaviour on every mechanics version. Both routes stay reachable from the UI: `POST /accuse` answers 409 `ACCUSATION_CONSENSUS_REQUIRED` while consensus applies, the consensus routes answer 409 `ACCUSATION_CONSENSUS_NOT_REQUIRED` while it does not, and the client follows whichever code it gets. Whether an accusation is *correct*, and how it scores, is unchanged.

```env
Accusation__RequireConsensus=true
```

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

To install the two bundled Crack cases into the configured main database, log in
as an admin and use **Seed Crack cases**, or call
`POST /api/admin/cases/seed-crack-demo`. The operation validates, upserts, and
publishes only `case-v3-broken-seal-en` and `case-v3-broken-seal-vi`; it is never
run automatically at API startup and does not migrate existing V2 cases.

For a code-synced Vietnamese map of the current AI case creation, room, realtime,
and gameplay flows, see
[`ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md`](ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md).

## AI Case Creator

The AI flow uses explicit review gates backed by a durable Mongo queue:

1. Create and approve a spoiler-free story preview.
2. Generate and approve the immutable CaseTruthPackage (seed, timeline,
   opportunity matrix, evidence, statements, and five canonical conclusions).
3. Project the approved truth into full case JSON and pass blind solvability review.
   A V2 preset with `includeCrackTheLie=true` produces mechanics version 3,
   generates a budgeted case/Crack blueprint, reviews every dynamic Cartesian
   testimony/evidence pair, and locks the reviewed contract with a conformance
   hash before full JSON generation.
4. Generate and approve scene backgrounds, clue regions, and placement metadata.
5. Generate final portraits, sprites, item assets, and runtime metadata.
6. An admin imports and publishes the validated case.

Generation, approval, and retry endpoints return 202 Accepted after atomically
queueing work. A hosted worker claims a 20-minute lease, heartbeats every two
minutes, resumes from saved checkpoints after restart, and retries transient
provider failures after 15 seconds, 60 seconds, and 5 minutes. VIP users can
reload and continue only their own drafts; import/publish remains admin-only.

Truth budgets are derived once from preset and stage count and shared by the
prompt, strict JSON Schema, deterministic validator, and review UI. Generated
bundles are written under `src/BE/GeneratedCaseJson/`, and generated image assets
under `src/FE/public/assets/ai-generated/`; both are ignored by git.

Artifact cleanup is dry-run by default:

```powershell
./scripts/cleanup-ai-artifacts.ps1 -Token '<admin-jwt>'
./scripts/cleanup-ai-artifacts.ps1 -Token '<admin-jwt>' -Apply
```

Only failed, unpublished drafts older than 30 days are candidates. Active,
ready, imported, and published drafts are always protected.

## Verification

```powershell
dotnet test SirLocked.sln
./scripts/test-v3-mongo.ps1
./scripts/test-v3-full-stack.ps1
cd src/FE
npm run typecheck
npm run build
```

Mongo integration and full-stack scripts only accept a loopback MongoDB server.
Each run creates a unique `sirlocked_it_<guid>` database and drops it in `finally`.
