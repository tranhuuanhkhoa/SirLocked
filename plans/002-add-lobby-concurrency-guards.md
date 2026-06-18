# Plan 002: Add Lobby Concurrency Guards

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat ffc67d2..HEAD -- src/BE/Services/RoomService.cs src/BE/Models/GameRoom.cs src/BE/Tests`
> If any in-scope file changed since this plan was written, compare the current state below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ffc67d2`, 2026-06-18

## Why this matters

Gameplay actions already use optimistic concurrency, but lobby mutations overwrite the whole room document without a version guard. If two users select roles, ready up, leave, or start at nearly the same time, one request can write stale room state over the other. This can produce duplicate roles, lost readiness, or a start state based on stale players.

## Current state

- `src/BE/Services/RoomService.cs:149-169` mutates role and writes `ReplaceOneAsync(r => r.Id == roomId, room)`.
- `src/BE/Services/RoomService.cs:177-193` mutates ready state and writes the whole room document.
- `src/BE/Services/RoomService.cs:201-250` starts the game and writes the whole room document.
- `src/BE/Services/GameplayService.cs:709-728` is the existing optimistic-concurrency pattern using `gameplayState.version`; match its retry/Conflict style where practical.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend tests | `dotnet test SirLocked.sln --no-build --no-restore` | exit 0, all tests pass |
| Backend build | `dotnet build SirLocked.sln` | exit 0 |
| Frontend typecheck | `cd src/FE && npm run typecheck` | exit 0, no errors |

## Scope

**In scope**:
- `src/BE/Models/GameRoom.cs`
- `src/BE/Services/RoomService.cs`
- `src/BE/DTOs/Room/RoomDtos.cs` only if a version value must be surfaced
- `src/BE/Tests/` room service tests

**Out of scope**:
- Rewriting room service around transactions.
- Changing public route URLs.
- Changing max player count or role names.
- Frontend lobby redesign.

## Steps

### Step 1: Add a lobby version field

Add a numeric `Version` or `LobbyVersion` field to `GameRoom` initialized to 0 or 1. Keep existing Mongo camelCase convention. Do not reuse `GameplayState.Version`; lobby state exists before gameplay starts.

**Verify**: `dotnet build SirLocked.sln` -> exit 0.

### Step 2: Guard stale room writes

Update lobby mutations that write whole room documents (`LeaveAsync`, `SelectRoleAsync`, `SetReadyAsync`, `StartAsync`) to filter on the expected lobby version and increment it on success. If the update loses the race, reload once and retry when safe, otherwise throw `ApiException.Conflict("The room changed; please retry.")`.

**Verify**: `dotnet build SirLocked.sln` -> exit 0.

### Step 3: Keep atomic join behavior

Preserve the existing atomic join filter at `RoomService.cs:91-99`. If adding the lobby version to join, include the same `Status == Waiting` and `SizeLt(Players, MaxPlayers)` protections so two joins cannot overfill a room.

**Verify**: `dotnet test SirLocked.sln --no-build --no-restore` -> all existing tests pass.

### Step 4: Add concurrency tests

Add backend tests for:
- Two players cannot both keep the same role after competing role updates.
- Ready state from one player is not lost when the other player updates role/ready from a stale room copy.
- Starting the room fails or retries cleanly when the room changed between load and save.

Use an isolated fake/test seam if the existing tests do not spin up MongoDB.

**Verify**: `dotnet test SirLocked.sln --no-build --no-restore` -> all tests pass with new regression coverage.

## Test plan

- Unit/service tests around the versioned update helper.
- Regression tests for stale role, ready, and start writes.
- Full backend test suite.
- Frontend typecheck to ensure DTO changes do not break JS/TS imports.

## Done criteria

- [ ] Lobby room writes cannot silently overwrite a newer lobby state.
- [ ] Concurrent conflicts produce a clear 409-style API error or safe retry.
- [ ] Existing join full-room guard remains intact.
- [ ] New tests fail on the old stale-write behavior and pass after the fix.
- [ ] `plans/README.md` row for plan 002 is updated.

## STOP conditions

- Mongo serialization of the added version field breaks existing room documents.
- The fix requires changing the two-player role model or frontend workflow.
- Reliable tests require a real shared database rather than an isolated test setup.

## Maintenance notes

Any future lobby mutation must go through the same versioned save helper. Reviewers should reject new direct `ReplaceOneAsync(r => r.Id == roomId, room)` writes for lobby state.
