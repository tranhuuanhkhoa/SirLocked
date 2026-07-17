# Plan 009: Restore authored scene progression and coherent map pacing

> **Executor instructions**: Read this plan fully before editing. Execute steps in order and run every verification command. Stop rather than reinterpret the progression contract. Update the plan row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 6869c99..HEAD -- src/BE/Services/RoomService.cs src/BE/Services/GameRules.cs src/BE/Services/GameplayService.cs src/BE/Services/GameStateBuilder.cs src/FE/Client/js/pages/gamePage.ts ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md ai-game-docs/UI_UX_REQUIREMENTS.md`
>
> These gameplay paths were locally modified when this plan was written. Compare live code to the excerpts below and stop on mismatch.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 007 recommended first, so validator automatically follows the new `GameRules.CanEnterScene` contract
- **Category**: bug
- **Planned at**: commit `6869c99`, 2026-07-13

## Why this matters

The data model, stage ordering, transition assets, UI copy, and gameplay documentation describe authored progression. Current runtime code instead makes every scene without an explicit puzzle/interaction gate enterable from the start. In the sample case this opens all five locations, including the final accusation room, collapsing stage pacing into an unordered checklist. This plan makes authored scene order authoritative while preserving per-player movement and optional explicit unlocks.

## Locked product contract

Implement this exact contract unless the owner explicitly rejects it:

1. At game start, only the first scene is visited/unlocked and both players are there.
2. Completing the current authored scene unlocks the next scene in flattened order: stages sorted by `Order`, scenes in array order.
3. A puzzle/interaction may explicitly unlock another scene early; explicit unlocks remain valid.
4. Players may revisit any visited scene independently.
5. An unlocked but unvisited scene is selectable; entering it adds it to `VisitedSceneIds` for the team and moves only the caller.
6. Pressing Continue on a completed scene moves only the caller to the authored next unlocked scene. A teammate may remain behind.
7. Locked scene titles remain hidden as `Unknown location`.

## Current state

- `src/BE/Services/RoomService.cs:275-290` starts both players in the first scene but leaves `UnlockedSceneIds` empty.
- `src/BE/Services/GameRules.cs:13-24` treats every scene without an explicit unlock effect as freely reachable.
- `src/BE/Services/GameRules.cs:32-57` auto-completes visited scenes but does not unlock the authored successor.
- `src/BE/Services/GameplayService.cs:1065-1112` confirms completion but does not advance the caller.
- `src/BE/Services/GameplayService.cs:1155-1200` already supports user-specific scene movement.
- `src/FE/Client/js/pages/gamePage.ts:1055-1109` chooses the first reachable incomplete scene, not the authored successor.
- `src/FE/Client/js/pages/gamePage.ts:3395-3410` repeats that arbitrary selection after Complete Scene.
- `ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md:474-495` documents sequential unlock and caller-only movement.
- `ai-game-docs/UI_UX_REQUIREMENTS.md:85-94` says future scenes must not be clickable.

The faulty gate is:

```csharp
// GameRules.cs:21-24
return state.VisitedSceneIds.Contains(sceneId)
    || state.UnlockedSceneIds.Contains(sceneId)
    || !SceneRequiresUnlock(gameCase, sceneId);
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Progression tests | `dotnet test src/BE/Tests/SirLocked.Tests.csproj --no-restore --filter "FullyQualifiedName~GameProgressionRuleTests|FullyQualifiedName~GameplayRuleTests|FullyQualifiedName~CaseValidationServiceTests"` | exit 0, all selected tests pass |
| Backend suite | `dotnet test SirLocked.sln --no-restore` | exit 0 |
| Frontend typecheck | `cd src/FE; npm run typecheck` | exit 0, no errors |
| Frontend build | `cd src/FE; npm run build` | exit 0 |
| UI smoke | `cd src/FE; npm run test:ui` | exit 0, all tests pass |

## Scope

**In scope**:

- `src/BE/Services/RoomService.cs`
- `src/BE/Services/GameRules.cs`
- `src/BE/Services/GameplayService.cs`
- `src/BE/Services/GameStateBuilder.cs` only for map/progression projection
- `src/BE/Services/CaseValidationService.cs` only to keep the plan 007 simulator aligned with authored successor unlocks
- `src/BE/DTOs/Investigation/GameStateDtos.cs` only if an authored `SuggestedNextSceneId` is added
- `src/BE/Tests/GameProgressionRuleTests.cs`
- `src/BE/Tests/GameplayRuleTests.cs`
- `src/BE/Tests/CaseValidationServiceTests.cs` only for new reachability expectations
- `src/FE/Client/js/pages/gamePage.ts`
- `src/FE/tests/game-ui-smoke.spec.ts`
- `ai-game-docs/CURRENT_CASE_AND_GAME_FLOW_VI.md`
- `ai-game-docs/UI_UX_REQUIREMENTS.md`

**Out of scope**:

- Changing evidence, dialogue, deduction, scoring, accusation, or role rules.
- Removing `PlayerSceneIds` or forcing both players to move together.
- Building a general branching quest graph. Explicit `UnlockSceneIds` remains the branch mechanism.
- Editing generated case assets or backgrounds.
- Adding stage-complete interstitial screens; docs explicitly reject disconnected stage screens.

## Git workflow

- Suggested branch: `advisor/009-authored-scene-progression`
- Suggested commit: `fix(gameplay): restore authored scene progression`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Lock the contract with rule tests

Update `GameProgressionRuleTests` to cover:

- Start state: only scene A is enterable; B/C are not.
- Completing A unlocks B, not C.
- Completing the last scene in stage 1 unlocks the first scene of stage 2.
- An interaction/puzzle may explicitly unlock C before B.
- Visited scenes remain enterable.
- Auto-completion and successor unlock are idempotent.
- The final scene is not enterable at start and accusation remains unavailable until all scenes complete.

Replace existing tests/comments that intentionally assume out-of-order free completion.

**Verify**: progression tests fail against the current free-roam implementation for the expected assertions.

### Step 2: Centralize authored scene ordering

In `GameRules`, add internal pure helpers that flatten scenes exactly once using stage `Order` and scene array order, then resolve the next authored scene. Do not duplicate sorting/index logic across service and frontend.

Change `CanEnterScene` to allow only:

- visited scene IDs, or
- unlocked scene IDs.

Remove `SceneRequiresUnlock` if no longer used. The first scene must be explicitly seeded into `UnlockedSceneIds` in `RoomService.StartAsync` as well as `VisitedSceneIds`.

Extend `AutoCompleteProgress` so every newly completed scene adds its authored successor to `UnlockedSceneIds`. Preserve explicit scene unlocks already applied by interactions/puzzles. The helper must not automatically mark the successor visited or move either player.

Keep plan 007's validator on the same progression contract: when its simulated state satisfies and completes a reachable scene, it must apply the same authored-successor unlock rule before the global reachability fixpoint continues. Reuse the runtime helper or a narrowly extracted pure helper; do not add a second ordering algorithm inside the validator.

**Verify**: progression tests pass, including idempotency and cross-stage transition.

### Step 3: Make Continue use the authored successor

Update `CompleteSceneAsync` so both paths work:

- If the scene is newly satisfied, save completion/unlock state and move only the caller to the authored successor.
- If a teammate already completed it, pressing Continue moves the caller to the already unlocked successor without re-completing or duplicating events.
- If it is the final scene, remain there and return the final-confrontation message.

Perform movement and completion in one optimistic room update where possible. Emit `SceneChanged`; emit `StageChanged` when the successor belongs to another stage. The global `CurrentSceneId` fields may remain for backward compatibility, but user-specific behavior must use `PlayerSceneIds`.

Either return `SuggestedNextSceneId` from backend state/action response or perform the move entirely server-side. Do not let the frontend independently choose the first unlocked scene.

**Verify**: backend tests cover newly completed, teammate-already-completed, stage-boundary, final-scene, and CAS retry paths.

### Step 4: Align map and Phaser navigation

In `gamePage.ts`:

- Delete the free-movement comments and the `find(first incomplete unlocked)` fallback.
- Render visited/unlocked map entries as selectable and locked entries as disabled/unknown.
- Continue must consume backend-authored movement/state; do not issue a second arbitrary `goToScene` request after `completeScene`.
- Runtime transition buttons may navigate only if their target is visited/unlocked. A transition does not override backend gate checks.
- Preserve independent player navigation and stale-version protection.

Add/extend the Playwright smoke fixture so it includes a locked future scene, then assert it is disabled/unknown until mocked state marks it unlocked.

**Verify**: typecheck, build, and UI smoke all exit 0.

### Step 5: Reconcile validator and documentation

Plan 007 is complete at `9fa3aa8`. Run its circular/self-unlock tests and preserve its global fixpoint. Because `CanEnterScene` now requires visited/unlocked state, update the simulator narrowly so a simulated completed scene unlocks its authored successor through the shared progression rule. Confirm circular/self-unlocking cases still fail, while the valid authored sample remains accepted.

Update the two gameplay docs to state the locked contract above. Remove statements implying all non-gated locations are freely reachable. Preserve the terminology `UnlockedSceneIds`, `VisitedSceneIds`, and caller-only movement.

**Verify**: full backend suite, frontend typecheck/build, and UI smoke pass.

## Test plan

- Pure rule tests for start, sequential unlock, stage boundary, explicit early unlock, revisit, idempotency, and final scene.
- Service-level tests for Complete Scene caller movement and teammate-lagging-behind behavior where the current test infrastructure permits; otherwise extract a pure transition decision helper and test it.
- Validator regression from plan 007.
- Playwright mocked-state check for locked versus newly unlocked map entry.

## Done criteria

- [ ] At game start only the first scene is enterable.
- [ ] Completing a scene unlocks exactly its authored successor plus any explicit mechanic unlocks.
- [ ] Continue moves only the caller and never chooses an arbitrary incomplete scene.
- [ ] Revisited scenes remain selectable; locked titles remain hidden.
- [ ] Sample-case final accusation room is locked at start.
- [ ] Backend suite, frontend typecheck/build, and UI smoke all exit 0.
- [ ] Docs and runtime describe the same progression contract.
- [ ] No out-of-scope files are modified.
- [ ] `plans/README.md` marks plan 009 DONE.

## STOP conditions

- The product owner wants full free-roam rather than the locked authored contract; stop and request a revised design plan.
- Existing published cases rely on entering arbitrary later scenes before any predecessor completion. Report affected case IDs and do not silently change them.
- A branching case requires more than ordered successor plus explicit `UnlockSceneIds`; that needs a separate quest-graph design.
- Completion/movement cannot be made atomic without changing public API semantics unexpectedly.
- Plan 007 has changed the relevant helpers incompatibly; reconcile the plan before editing.

## Maintenance notes

- New progression features must define whether they affect `UnlockedSceneIds`, `VisitedSceneIds`, or only `PlayerSceneIds`.
- Reviewers should reject frontend logic that derives a “next” scene independently from backend authored order.
- If a future quest graph is introduced, replace the ordered-successor helper and validator together.

## Execution record

- DONE on 2026-07-13 in isolated branch `advisor/009-authored-scene-progression` at `62fec91966b2f09a683bf81dac629d1dc6379ce2`.
- Reviewer-approved after one revision round that separated `COMPLETE_SCENE` from lagging-player `CONTINUE_SCENE` and added caller-only/idempotent continuation regressions.
- Verified: focused backend 58/58, frontend typecheck/build, Playwright 2/2. Full backend: 171 passed with the sole known Plan 008 failure `EvidencePhotoServiceTests.CaptureClueAsync_PersistsPhotoOnlyAfterStateSaveSucceeds`.
- The branch includes mechanical snapshot commit `d864527`; do not cherry-pick blindly onto a workspace that already contains the same uncommitted snapshot changes.
