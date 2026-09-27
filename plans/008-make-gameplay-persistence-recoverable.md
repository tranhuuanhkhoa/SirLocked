# Plan 008: Make evidence capture and final results recoverable

> **Executor instructions**: Follow this plan exactly, verifying every step. Stop on any condition listed below instead of inventing a different consistency model. Update the status row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 62fec91..HEAD -- src/BE/Services/GameplayService.cs src/BE/Services/EvidencePhotoService.cs src/BE/Services/Interfaces/IEvidencePhotoService.cs src/BE/Models/GameRoom.cs src/BE/Models/GameResult.cs src/BE/DataAccess/MongoDbContext.cs src/BE/Tests/EvidencePhotoServiceTests.cs`
>
> These paths had uncommitted gameplay changes when planned. Also inspect `git diff -- <paths above>` and confirm the current-state excerpts still match.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plan 009 execution baseline
- **Category**: bug
- **Planned at**: commit `62fec91`, reconciled 2026-07-13

Plan 009 changed scene progression in `GameplayService`; this plan must preserve its approved caller-only continuation and authored-successor behavior while changing only evidence/result persistence.

## Why this matters

Two critical commands update the room document and another collection sequentially. A photo failure after room save leaves a permanently captured clue without its photo; a result insert failure after room completion leaves a completed game without a result. Local Mongo configuration is a standalone connection, so this plan uses idempotent writes plus embedded recovery data rather than assuming multi-document transactions are available.

## Current state

- `src/BE/Services/GameplayService.cs:543-563`: clue state is saved before `EvidencePhotos.UpsertAsync`.
- `src/BE/Services/GameplayService.cs:1242-1270`: room is marked completed before `GameResults.InsertOneAsync`.
- `src/BE/Services/GameplayService.cs:46-52`: result GET returns 404 when no result document exists.
- `src/BE/Services/EvidencePhotoService.cs:76-102`: photo upsert is already idempotent by `(roomId, clueId)`.
- `src/BE/DataAccess/MongoDbContext.cs:109-115`: evidence photos already have a unique compound index.
- `src/BE/DataAccess/MongoDbContext.cs:84-89`: `GameResult.RoomId` is indexed but not unique.
- `src/BE/Tests/EvidencePhotoServiceTests.cs:60-74`: the only ordering test searches source text and is currently broken by a method-signature change; it does not execute failure behavior.

Problematic ordering:

```csharp
// GameplayService.cs:552-563
if (!await TrySaveStateAsync(room, gameCase)) { ... }
await _evidencePhotos.UpsertAsync(roomId, clue.ClueId, scene.SceneId, user.Id, normalizedPhoto);
```

```csharp
// GameplayService.cs:1242-1270
state.GameStatus = success ? GameStatus.Won : GameStatus.Failed;
room.Status = RoomStatus.Completed;
if (!await TrySaveStateAsync(room, gameCase)) { ... }
await _db.GameResults.InsertOneAsync(result);
```

## Target consistency model

1. **Evidence photo**: persist the idempotent photo first, then commit the room state. A failed room CAS may leave an orphan photo, but `GetEvidencePhotoAsync` already hides photos unless the clue is unlocked. A retry overwrites the same `(roomId, clueId)` record and can complete normally. Broken visible state is forbidden; hidden orphan data is acceptable and cleanable.
2. **Final result**: persist a complete `FinalAccusationSnapshot` inside `GameplayState` in the same room CAS that marks the game complete. Upsert the denormalized `GameResult` by unique `RoomId`. `GetResultAsync` must reconstruct/upsert from the embedded snapshot if the result collection write previously failed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `dotnet test src/BE/Tests/SirLocked.Tests.csproj --no-restore --filter "FullyQualifiedName~EvidencePhoto|FullyQualifiedName~GameplayPersistence|FullyQualifiedName~GameplayRuleTests"` | exit 0, all selected tests pass |
| Backend suite | `dotnet test SirLocked.sln --no-restore` | exit 0, all tests pass |
| Build | `dotnet build SirLocked.sln --no-restore` | exit 0, no errors |

## Scope

**In scope**:

- `src/BE/Services/GameplayService.cs`
- `src/BE/Services/GameStateBuilder.cs` only to prevent orphan photo projection before `CapturedClueIds` commits
- `src/BE/Services/EvidencePhotoService.cs`
- `src/BE/Services/Interfaces/IEvidencePhotoService.cs` only if a fakeable cleanup/query operation is needed
- `src/BE/Models/GameRoom.cs`
- `src/BE/Models/GameResult.cs`
- `src/BE/DataAccess/MongoDbContext.cs`
- `src/BE/Services/GameResultFactory.cs` (optional new pure mapper)
- `src/BE/Services/Interfaces/IGameResultStore.cs` and implementation (optional, preferred for failure-injection tests)
- `src/BE/Tests/EvidencePhotoServiceTests.cs`
- `src/BE/Tests/GameplayPersistenceTests.cs` (create)
- DI registration in `src/BE/Program.cs` only if a result-store abstraction is added

**Out of scope**:

- Requiring a Mongo replica set or introducing distributed transactions.
- Changing accusation scoring, win/loss rules, photo matching thresholds, API routes, or response JSON.
- Adding a general event-sourcing/outbox framework.
- Refactoring unrelated commands in the large `GameplayService`.
- Returning stored photos without first checking that the clue is unlocked.

## Git workflow

- Suggested branch: `advisor/008-recoverable-gameplay-persistence`
- Suggested commit: `fix(gameplay): make evidence and result writes recoverable`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Replace the source-text ordering test with executable behavior tests

Delete `CaptureClueAsync_PersistsPhotoOnlyAfterStateSaveSucceeds`; searching a source string is not a behavioral test. Add fakeable seams only where required:

- Keep `IEvidencePhotoService` as the photo seam.
- Extract game-result construction into a pure factory and persistence into an interface if direct `MongoDbContext` prevents failure injection.
- Do not introduce interfaces for every gameplay dependency.

Add tests that can force photo/result persistence failures and assert observable state/retry behavior. Follow the direct xUnit assertion style used by existing tests; no new mocking package is required if small in-test fakes are sufficient.

**Verify**: focused tests compile. The newly added regression tests should fail against current ordering/GET behavior.

### Step 2: Persist a hit photo before exposing captured state

In the HIT branch of `CaptureClueAsync`:

1. Normalize once before the retry loop mutation or retain the normalized value across CAS retries so the upload is not decoded repeatedly.
2. Upsert the normalized photo before adding/saving `CapturedClueIds` and `UnlockedClueIds`.
3. Then perform the existing optimistic room save.
4. If CAS conflicts, reload and retry; the photo upsert is safe because `(roomId, clueId)` is unique.
5. If the room never commits, leave the photo hidden. Do not delete it blindly because a concurrent successful request may now own the same clue.

Keep `GetEvidencePhotoAsync` gated by both unlocked and captured clue state. Apply the same gate when `GameStateBuilder` projects `PhotoUrl`; an orphan photo for a clue unlocked by another mechanic must remain hidden until `CapturedClueIds` commits. Ensure duplicate capture returns idempotently and does not corrupt first-discovery attribution.

**Verify**: focused tests cover photo-upsert failure (room remains uncaptured), room-save conflict followed by retry (eventual HIT), and hidden orphan photo (GET remains 404 until clue state commits).

### Step 3: Embed a final accusation snapshot in the room

Add a BSON-compatible `FinalAccusationSnapshot` to `GameplayState`, containing every value required to recreate `GameResult` without request data:

- selected culprit, motive, method
- selected evidence IDs and evidence links
- success flag and ending
- score summary
- player IDs, case ID, and completion timestamp

Populate it before the same CAS that sets `GameStatus`, `CompletedAt`, and room `Completed`. Use one pure mapper to build both the snapshot and `GameResult`; avoid two handwritten mappings that can drift.

Existing rooms without the field must deserialize with null due to Mongo's additive model. Do not migrate historical documents in this plan.

**Verify**: add pure mapping tests for V1 and V2 accusation data, including score/evidence-link preservation.

### Step 4: Make result materialization idempotent and recoverable

- Change the `GameResult.RoomId` index to unique with an explicit name such as `ux_gameResults_roomId`.
- Before deploying the unique index, include a STOP note or startup diagnostic for existing duplicate room IDs; do not auto-delete duplicates.
- Replace `InsertOneAsync` with an upsert keyed by `RoomId`. The persisted result must be derived from the embedded snapshot.
- In `GetResultAsync`, if no result is found but the caller belongs to a completed room with a valid final snapshot, upsert from the snapshot and return it.
- If the room is completed but has no snapshot (legacy/corrupt room), retain a clear not-found/conflict response and log enough identifiers to investigate; do not fabricate answer selections.

If a result upsert fails immediately after room completion, the command may return an infrastructure error, but a later GET/retry must repair it deterministically.

**Verify**: tests cover missing result repair, repeated repair producing one logical result, and concurrent/repeated accusation not producing duplicates.

### Step 5: Verify downstream compatibility

Confirm `WorkshopService`, `LeaderboardService`, `BadgeService`, `ProfileService`, and `ReviewService` still read the unchanged `GameResult` shape. No downstream code should need modification.

Run the full backend suite. If creating the unique index against a disposable/local database is available, verify two inserts with the same `RoomId` cannot coexist; do not run destructive cleanup against the user's database.

**Verify**: backend suite and build both exit 0.

## Test plan

- Photo normalization tests remain unchanged.
- Replace the brittle source scan with failure-injection tests.
- Add photo-first ordering behavior: photo failure cannot expose captured clue state.
- Add CAS retry behavior: an orphan photo is hidden and safely overwritten/reused.
- Add V1/V2 final snapshot mapping tests.
- Add missing-result recovery and idempotent upsert tests.
- Add legacy completed-room-without-snapshot behavior test.

## Done criteria

- [ ] No source-text ordering assertion remains in `EvidencePhotoServiceTests`.
- [ ] A visible captured clue always has a persisted photo after a successful response.
- [ ] Result GET repairs a missing denormalized result from a completed room snapshot.
- [ ] `GameResult.RoomId` has a named unique index and result writes are upserts.
- [ ] Repeated repair/accusation cannot create multiple logical results per room.
- [ ] Existing GameResult consumers compile without response-shape changes.
- [ ] `dotnet test SirLocked.sln --no-restore` and `dotnet build SirLocked.sln --no-restore` exit 0.
- [ ] No files outside the declared scope are modified.
- [ ] `plans/README.md` marks plan 008 DONE.

## STOP conditions

- Existing production data contains duplicate `GameResult.RoomId` values; report counts/IDs only and request a migration decision.
- Product owners require strict all-or-nothing writes and production Mongo is not guaranteed to be a replica set.
- Reconstructing a result would require data not included in the specified snapshot.
- The proposed model would expose hidden final answers in `GameStateResponse`; the snapshot must remain server-side only.
- Failure-injection tests require a broad rewrite of gameplay DI rather than a small store/factory seam.

## Maintenance notes

- Treat the room snapshot as the authoritative recovery record and `GameResult` as a query/analytics projection.
- Any new accusation field must be added to the request, snapshot, pure mapper, result model, and mapping tests together.
- Orphan evidence photos are intentionally hidden and harmless; a future maintenance job may remove photos whose clue is not captured after a retention period.

## Execution record

- DONE on 2026-07-13 in isolated branch `advisor/008-recoverable-gameplay-persistence` at `55b3e8849a0a41c60b1688c091c3f019d2442fe6`.
- Reviewer-approved after two revisions: photo visibility now requires both unlocked and captured state, and the critical `GameResult.RoomId` unique-index invariant runs first after ping and fails startup if it cannot be confirmed.
- Verified independently: focused persistence/gameplay tests 20/20, full backend 182/182, build 0 warnings and 0 errors; no source-text ordering assertion remains.
- Live duplicate-data and duplicate-insert checks were not run because no local Mongo listener or `mongosh` was available. Startup performs a read-only duplicate preflight, reports identifiers/counts, never deletes data, and aborts if uniqueness cannot be established.
- This branch descends from Plan 009 and the mechanical snapshot commit `d864527`; do not cherry-pick blindly onto a workspace that already contains the same uncommitted snapshot changes.
