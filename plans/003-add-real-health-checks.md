# Plan 003: Add Real Health Checks

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat ffc67d2..HEAD -- src/BE/Program.cs src/BE/DataAccess/MongoDbContext.cs src/BE/Tests README.md ai-game-docs`
> If any in-scope file changed since this plan was written, compare the current state below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `ffc67d2`, 2026-06-18

## Why this matters

The current `/health` endpoint returns OK even if MongoDB startup tasks fail. A deployment monitor can mark the API healthy while database-backed endpoints are unusable. The app needs a readiness endpoint that reflects Mongo connectivity and can keep a simple liveness endpoint for process-only checks.

## Current state

- `src/BE/Program.cs:153` maps `/health` to a static `{ status = "ok" }` response.
- `src/BE/Program.cs:155-172` pings Mongo and ensures indexes during startup, but catches and logs failures without stopping the host.
- `src/BE/DataAccess/MongoDbContext.cs` exposes `PingAsync()` and `EnsureIndexesAsync()`.
- README tells users the backend health path is `/health`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend tests | `dotnet test SirLocked.sln --no-build --no-restore` | exit 0, all tests pass |
| Backend build | `dotnet build SirLocked.sln` | exit 0 |
| Frontend typecheck | `cd src/FE && npm run typecheck` | exit 0, no errors |

## Scope

**In scope**:
- `src/BE/Program.cs`
- `src/BE/DataAccess/MongoDbContext.cs`
- `src/BE/Tests/` if testable health check seams are added
- README or operations docs for endpoint semantics

**Out of scope**:
- Making startup fail hard on Mongo outage.
- Adding external observability services.
- Changing frontend proxy paths except if docs require it.

## Steps

### Step 1: Register ASP.NET health checks

Add `builder.Services.AddHealthChecks()` and register a Mongo readiness check that calls `MongoDbContext.PingAsync()`. Use a named check such as `mongodb`.

**Verify**: `dotnet build SirLocked.sln` -> exit 0.

### Step 2: Replace static readiness endpoint

Replace the static `/health` route with `MapHealthChecks("/health")` so it returns unhealthy when Mongo is unavailable. If process liveness is useful, add `/live` returning OK and document the distinction.

**Verify**: `dotnet build SirLocked.sln` -> exit 0.

### Step 3: Test the health check behavior

Add a focused test for the health check implementation if possible without requiring a real Mongo instance. If the test host can replace `MongoDbContext`, assert healthy/unhealthy behavior through dependency replacement.

**Verify**: `dotnet test SirLocked.sln --no-build --no-restore` -> all tests pass.

### Step 4: Update docs

Update README or deployment docs so `/health` means readiness and `/live` means process liveness if `/live` is added.

**Verify**: `rg -n "/health|/live" README.md ai-game-docs src/BE/Program.cs` -> references agree on semantics.

## Test plan

- Backend build.
- Backend tests, including any new health-check tests.
- Manual local smoke after implementation: run API, verify `/health` reports healthy when Mongo is reachable and unhealthy when not reachable.

## Done criteria

- [ ] `/health` is tied to Mongo readiness instead of a static OK.
- [ ] Startup can still log Mongo failure without crashing if that remains the intended local behavior.
- [ ] Docs describe health endpoint semantics accurately.
- [ ] `plans/README.md` row for plan 003 is updated.

## STOP conditions

- Health check implementation requires a package download that cannot be approved.
- Existing deployment tooling depends on `/health` always returning 200 and no alternate readiness endpoint is acceptable.

## Maintenance notes

Future operational dependencies, such as external AI providers or asset storage, should get separate readiness checks only if the app cannot serve core gameplay without them.
