# Testing Strategy

Last synced with code: 2026-07-23.

## Test Layers

| Layer | Current coverage |
| --- | --- |
| Backend unit tests | xUnit tests for complete condition and case validation |
| Backend integration/smoke | `WebApplicationFactory<Program>` runs the mock HTTP AI flow with fake auth/OpenAI; `scripts/test-v3-mongo.ps1` covers Mongo CAS, queue claims, stale completion and gameplay concurrency in isolated databases |
| Frontend static checks | `npm run typecheck`, `npm run build` in GitHub Actions |
| Frontend browser smoke | Playwright smoke coverage for the gameplay UI; manual QA remains required for Phaser rendering and realtime interaction |

## Commands

From repository root:

```powershell
dotnet test SirLocked.sln
```

From frontend folder:

```powershell
cd src/FE
npm run typecheck
npm run build
```

With a loopback MongoDB listening on `27017`, run the isolated Mongo and real
two-browser Crack flows from the repository root:

```powershell
./scripts/test-v3-mongo.ps1
./scripts/test-v3-full-stack.ps1
```

Both scripts create a unique `sirlocked_it_<guid>` database and always drop it
in `finally`. The safety guard lives in the integration/test tooling and rejects
SRV, remote hosts, and database names without the test prefix.

CI runs the Mongo integration project with `SIRLOCKED_RUN_MONGO_IT=true`
against its Mongo service. Tests never call live OpenAI or image APIs. The local
Mongo script performs a dependency preflight and fails clearly instead of
silently passing when MongoDB is unavailable.

Dynamic Crack regression coverage includes 2T×3E, 3T×4E, and 4T×6E browser
matrices; unit coverage additionally checks 2T×6E, 3T×6E, 4T×4E, incomplete or
duplicate Cartesian reviews, readiness subsets, per-Crack/per-case budgets,
blueprint drift, and the 24-pair review batching boundary.

With backend running at `http://localhost:5215`:

```powershell
python scripts/e2e_smoke.py --base http://localhost:5215
```

## Backend Unit Tests

`CompleteConditionTests` verifies:

- `AND` requires every listed item, clue, and dialogue.
- `OR` accepts one fully satisfied non-empty group.
- empty `OR` is never satisfied.
- empty `AND` is satisfied.

`CaseValidationServiceTests` verifies:

- sample case is valid,
- sample shape stays within expected demo ranges,
- duplicate IDs are rejected,
- missing scene item references are rejected,
- final evidence cannot use item IDs,
- final evidence clues must set `isEvidence`,
- unreachable unlock cycles are rejected,
- undiscoverable final evidence is rejected,
- invalid complete condition logic is rejected,
- `MockCaseFactory` produces valid cases for multiple stage counts.

## Smoke Test Coverage

The Python smoke test:

- logs in as seeded admin,
- seeds and publishes sample case,
- validates a broken case,
- registers two players,
- creates and joins a room,
- verifies duplicate roles fail,
- starts a game,
- verifies role enforcement,
- plays through scenes by inspecting/asking/completing,
- verifies accusation availability,
- submits correct accusation,
- retrieves result from partner account,
- verifies wrong accusation creates a fail result in a second room,
- generates and publishes an AI/mock draft.

## Manual QA Checklist

- Login/register form errors render clearly.
- Admin can seed and publish cases.
- Two separate browser sessions can join the same room.
- Lobby updates after role and ready changes.
- Start button is host-only.
- Game screen renders background, hotspots, dialogue, clue board, action log, and players.
- Investigator cannot ask dialogue.
- Interrogator cannot inspect items.
- Locked hotspots/dialogues show an understandable disabled state.
- Scene progression opens the next location.
- Reconnect refetches state.
- Final accusation shows win and fail endings.

## Gaps

- No automated full SignalR transport reconnect test beyond version/refetch browser coverage.

## Load testing and CI security

The k6 scripts in `scripts/loadtest/` provide 30-second HTTP and SignalR smoke
runs, a 50-VU five-minute load run, stress ramps up to 200 VUs, and a separate
one-VU auth scenario at four logins per minute. VUs create or authenticate once
and reuse their 60-minute access token. Use an isolated Development API and
database; do not use production. The API and results setup are documented in
`scripts/loadtest/README.md`.

HTTP API requests are measured against p95 < 500 ms and <1% failures.
SignalR `inspect-item` command-to-`GameStateUpdated` latency is measured against
p95 < 1,000 ms, session success > 99%, and <1% HTTP errors. The local baseline
used one Release API and a throwaway MongoDB database on a machine with 8 CPUs
and 31.3 GiB RAM; it is a test baseline, not a production capacity claim.

| HTTP scenario | Latency measured (p50 / p95 / p99, ms) | Rate | HTTP errors | Max VUs |
|---|---:|---:|---:|---:|
| Smoke | 6.30 / 35.16 / 87.74 (API requests) | 1.046 RPS | 0% | 1 |
| Load | 2.82 / 12.13 / 16.85 (API requests) | 38.958 RPS | 0% | 50 |
| Stress | 2.36 / 10.60 / 14.99 (API requests) | 105.444 RPS | 0% | 200 |
| Auth (default limits) | 132 / 195 / 245.4 (login) | 4 logins/min; 0.077 HTTP RPS | 0% | 1 |

| SignalR scenario | Command-to-broadcast latency (p50 / p95 / p99, ms) | HTTP RPS | HTTP errors | Session success | Commands | Max VUs |
|---|---:|---:|---:|---:|---:|---:|
| Smoke | 11 / 33.5 / 35.5 | 0.866 | 0% | 100% | 3 / 3 | 2 |
| Load | 8 / 12 / 13.26 | 5.254 | 0% | 100% | 75 / 75 | 50 |
| Stress | 8 / 16 / 37.05 | 11.506 | 0% | 100% | 300 / 300 | 200 |

All runs met the thresholds above; no 429 responses were observed. Result JSON
and text summaries are in `/home/ubuntu/reports/loadtest/results/`.

CI runs the NuGet and production npm audits, CodeQL analysis for C# and
JavaScript/TypeScript, and the Gitleaks CLI history scan. Dependabot checks
NuGet, npm, and GitHub Actions weekly. Local actionlint 1.7.12 passed the CI,
CodeQL, and secret-scan workflows; Gitleaks 8.30.1 passed with the exact-path
allowlist. The local NuGet audit reported six known `SixLabors.ImageSharp`
3.1.11 advisories (four high, two moderate), the documented accepted risk; no
other vulnerable NuGet package was reported. The production npm audit found
zero vulnerabilities. The allowlist does not approve other findings.
- No visual regression testing for Phaser/canvas.
