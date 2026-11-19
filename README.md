# SirLocked

AI-assisted cooperative detective game MVP.

## Stack

- Backend: ASP.NET Core Web API, MongoDB, JWT, SignalR
- Frontend: Vite JavaScript SPA, with Phaser 4 + TypeScript for the gameplay renderer
- AI case generation: the Claude bot answers every step through the bridge queue (no AI API is called by the server); preview/truth/logic/layout approval gates, validation and publishing; optional xAI cinematic videos

## Cinematic presentation

Visual-novel dialogue, NPC idle, independent cutscenes, audio, recap and cooperative pings are available with legacy-case fallbacks. Optional xAI generation is off by default and requires explicit budget/pricing configuration. See [setup, authoring and verification](docs/CINEMATIC_PRESENTATION_VI.md).

## Requirements

- .NET SDK 9
- Node.js 20+
- Access to the MongoDB instance configured in `.env` (local or remote). Docker Desktop or a local MongoDB installation is only needed when using a local database.

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
# Claude bridge key (32+ characters). Set it on the server with bash scripts/set-bridge-key.sh; never commit it.
Bridge__Key=
# Mock answers instead of the Claude queue (tests, local demo).
AiGeneration__MockAiResponses=false
```

The AI case creator needs `Bridge__Key`: every model-written step is queued for the Claude bot, which works through `/api/bridge/*` with that key. Keep real keys in local `.env` files or deployment secrets only.
Cloudinary storage is required when the bot uploads case images. See [AI case setup with the Claude bridge](docs/AI_CASE_SETUP_VI.md) and the [audio, weather and voice fields](docs/case-audio-weather.md).
In the game, each character speaks in its own synthesized blips, each area plays its own looping music (cross-faded between areas, ducked under dialogue), and outdoor scenes show and play rain, wind, snow or storms drawn and synthesized in code (off indoors, lighter on slow devices, with a switch in the sound panel). Puzzle and interface sounds come from a CC0 Kenney pack listed in `src/FE/public/assets/audio/sfx/LICENSES.json`.
The bot side (MCP server `tools/studio-mcp`, the `/tao-vu-an` skill, sub-agents, style guide, world handbooks, image library) is described in [the studio guide](docs/studio-vps.md); `cd tools/studio-mcp && npm ci && npm test` builds and tests it.
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

### Mở hòm (chest opening)

`/kho-ruong` lets a player spend in-game coins on chests and keys and open a chest for one item, which then trades on the market like any other. Chests spend coins; optional payOS coin top-ups are documented below. The server decides every result; the client only animates the answer.

- `GET /api/chests` lists the chests, their contents, the caller's free chests and keys, prices and the public drop rates.
- `POST /api/chests/{chestId}/keys`, `/buy` and `/open` take `{ "idempotencyKey": "<uuid>" }`. Resending a key returns the original result and spends nothing more. They are limited to 60 calls per minute per user.
- `POST /api/chests/admin/grant` gives a detective chests and keys for testing (`ADMIN` only, `Source = GRANT`, not in the audit log). The admin page uses `POST /api/admin/chests/grant`, which is logged.
- Errors carry a code: `CHEST_NONE`, `KEY_NONE`, `FUNDS`, `SLOTS_FULL`, `IN_PROGRESS`, `CHEST_NOT_FOR_SALE`, `CHEST_PRICE_CHANGED`. Opening always frees a slot, so `SLOTS_FULL` only comes from buying or granting.
- Each chest has its own drop table and look (`ChestDto.Odds`, `ChestDto.Look`). A chest switched off leaves the shop, but anyone still holding one or its key sees it in `ChestListDto.OffSale` and can open it. Buying may send `expectedPrice`, so a price changed by an admin is refused instead of charged.

Contents, drop rates and prices live in MongoDB (see [admin contracts](docs/admin-contracts.md)) and every read goes through `ICatalogProvider`. `Services/Market/ChestCatalog.cs` and the `Chests:Prices` section of `appsettings.json` only seed an empty database, so changing them later has no effect. At startup the API still refuses to start if the configured seed prices would pay out more on average than an opening costs.

As MongoDB runs standalone, `chestOpenings` is a journal: the reward is rolled and stored before anything is spent, one free chest and key are locked (`LockedBy = chest:<id>`), and a commit flag separates the part that can still fail from the part that only rolls forward. `chestPurchases` does the same for the shop. The market's maintenance worker resumes anything left unfinished for more than 30 seconds.

### Hồ sơ thám tử (detective profile)

`/detective` adds a framed portrait, a level and four tabs; the lobby shows every player's frame and title and plays their
entrance for the whole room. Drawing code lives in `src/FE/Client/js/cosmetics/`, moved as it is from the approved mock-up (see
the README there); art is in `src/FE/public/assets/cosmetics/`.

- XP to go from level `lv` to `lv + 1` is `200 + 40 * (lv - 1)`, capped at level 50. `POST /api/progress/exchange` burns Rare items
  for 150 XP and Epic items for 600 XP (the rates are in `gameSettings/progress`), journaled in `xpExchanges` with an idempotency key. `GET /api/progress/me` reads it all.
- Categories `FRAME`, `TITLE` and `ENTRANCE` hold one equipped item each, through the market's equip API. Ids are prefixed
  (`frame_`, `title_`, `entrance_`) because titles and entrances share names.
- Chest drops are tradable. What a detective earns (levels, achievements, the defaults) has `Tradable = false`, takes no bag slot,
  and the market refuses to list, bid on, trade or exchange it.
- `title_tho-khoa` ("Giải 25 câu đố ổ khóa") stays closed: rooms record which puzzles were solved, not by whom.
- `GameHub.JoinRoom` announces an arrival once per seat through SignalR `PlayerEntrance`. A refresh or reconnect plays nothing.
- Uploaded avatars need `Cloudinary__Enabled=true`, `Cloudinary__CloudName`, `Cloudinary__ApiKey` and `Cloudinary__ApiSecret`; without them the upload button is not offered. `bash scripts/set-cloudinary.sh` checks them with Cloudinary and sets them on the server. The browser turns the picked photo into a square of at most 512px before sending it, so phone photos up to 40 MB work. The API then re-encodes it as a 256px WebP.

### Admin catalog

Items, chests, level rewards, achievements and XP rates live in MongoDB (`catalogItems`, `chests`, `levelRewards`, `achievements`,
`gameSettings`) and are managed from `/admin`. The API seeds them from code at startup, once per seed version and never over an
admin's edit. Every admin write records itself in `adminAudit` (`GET /api/admin/audit`). `POST /api/admin/assets` stores admin
pictures as WebP in the Cloudinary folder `sirlocked/admin` and answers `ASSET_STORAGE_UNAVAILABLE` without Cloudinary. Schemas and
rules for anyone extending this are in [docs/admin-contracts.md](docs/admin-contracts.md) and [docs/admin-cosmetics.md](docs/admin-cosmetics.md).

The admin tabs: `/admin/chests` and `/admin/items` (chests, items, odds, versions, grants), `/admin/cosmetics` (frames, titles,
entrances, how each is earned, XP rates), `/admin/players` (coins, items, level, avatars, sessions), `/admin/economy` (listings,
orders, sales, stuck operations, rooms, reviews) and `/admin/audit`. Operations on a player are journaled in `adminPlayerOps` and
take an idempotency key.

## payOS coin top-ups (disabled by default)

Players can open **Market → Top up coins** (`/payments`) to select a server-priced package,
view a transfer QR or open payOS checkout, cancel an unpaid order and view recent top-ups.
Signed webhooks and background reconciliation confirm payment before an atomic, permanently deduplicated wallet credit.
Configure a dedicated payOS channel using [the local setup and webhook guide](docs/PAYOS_TOPUP_VI.md)
and [configuration example](config/payos.env.example). No real payment is enabled without credentials and `PayOS__Enabled=true`.
payOS has no separate sandbox; automated tests use a fake provider and isolated local MongoDB.

## Run Locally


To run the project with your existing database and accounts, keep the repository-root `.env` configuration and start the backend and frontend below. The backend connects to the database specified by `MongoDb__ConnectionString` and `MongoDb__DatabaseName`.

If `.env` points to a local MongoDB instance, start that instance first. For the repository's Docker setup:

```powershell
docker compose up -d
```

Skip this step when `.env` already points to a reachable remote database; Docker and local MongoDB are not required for that configuration.

Run the backend:

```powershell
cd src/BE
dotnet run
```

Backend default URL: `http://localhost:5215`

Run the frontend in another terminal, starting from the repository root:

```powershell
cd src/FE
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

### Optional isolated Windows demo

For a separate demo with portable MongoDB, the two pixel cases (older cases are hidden; `-LegacyCases` brings them back), two player accounts and no paid AI calls, run `./scripts/start-local-demo.ps1` from the repository root. Open [the isolated demo](http://127.0.0.1:5174); its API uses port `5216` and MongoDB uses port `27020`. These defaults keep the normal project's `5173`/`5215` ports and browser sessions separate. The demo uses its own database and preserves the existing `.env`.

Stop only the demo with `./scripts/stop-local-demo.ps1`. See [Vietnamese demo and release instructions](docs/LOCAL_DEMO_VI.md).

## Demo Account

On backend startup in `Development`, if no admin exists, the app seeds:

- Email: `admin@sirlocked.local`
- Password: `Admin123!`
- Role: `ADMIN`

Outside `Development`, default admin seeding is disabled unless `Auth__SeedDefaultAdmin=true` is explicitly configured. When enabling it outside development, also configure `Auth__SeedAdminPassword`; do not use the demo password in deployed environments.

Admins sign in at `/admin/login`, players at `/login`. An admin who signs in at `/login` lands on the menu like anyone else and can still open `/admin`; that is also the way in for an admin whose account only has Google sign-in. No page can make someone an `ADMIN`.

Public registration creates `PLAYER` accounts. Admins can promote a non-admin user to `VIP` from the dashboard. `VIP` and `ADMIN` accounts can create AI cases.

## Health Checks

- `/live` returns process liveness.
- `/health` reports readiness and checks MongoDB connectivity.

## Demo Flow

1. Log in as admin at `/admin/login`.
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

### Disconnection timeout

During an active match, either player's continuous disconnection starts a five-minute reconnect window. Rejoining before the deadline cancels that player's countdown; a later disconnection starts a new window. Closing one tab does not disconnect a player who still has another room connection.

The server automatically ends expired rooms as `ABANDONED` with a failed game state, even if both players are offline. A background check runs every five seconds; the client countdown is informational and waits for the server's final state. Returning after the deadline cannot reopen the match. Waiting lobbies and already completed games are unaffected.

Disconnect timestamps are stored in MongoDB. Presence tracking currently assumes one API instance: an abrupt API crash can leave a previously online player marked online until they reconnect. Multi-instance or crash-reconciled presence needs connection leases before scaling out.

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
npm run test:atmosphere
npm run build
```

Mongo integration and full-stack scripts only accept a loopback MongoDB server.
Each run creates a unique `sirlocked_it_<guid>` database and drops it in `finally`.
