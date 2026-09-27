# Plan 010: Make OR scene objectives and pending counts truthful

> **Executor instructions**: Follow each step and verification gate. Keep completion semantics unchanged; this plan fixes projection and copy only. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 55b3e88..HEAD -- src/BE/Models/GameCase.cs src/BE/Services/CaseValidationService.cs src/BE/Services/GameRules.cs src/BE/Services/GameStateBuilder.cs src/BE/DTOs/Investigation/GameStateDtos.cs src/BE/Tests/GameProgressionRuleTests.cs`
>
> These files had uncommitted gameplay changes when planned. Compare current source to the excerpts below and stop if they differ materially.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans 009 and 008 execution baseline
- **Category**: bug
- **Planned at**: commit `55b3e88`, reconciled 2026-07-13

Plan 009 added shared authored progression in `GameRules`; Plan 008 tightened photo projection in `GameStateBuilder`. Preserve both approved behaviors while centralizing completion-condition progress.

## Why this matters

Runtime correctly treats an OR completion condition as alternative requirement groups, but the state projection sums and describes every missing group. Players can be told to inspect items, ask dialogue, and uncover clues even though completing any one branch is sufficient. This creates false objectives and makes map pending counts disagree with actual scene completion.

## Current state

- `src/BE/Models/GameCase.cs:182-189` defines `CompleteCondition` with `Logic` and three requirement groups.
- `src/BE/Services/CaseValidationService.cs:1260-1277` is the current completion authority: OR succeeds when any non-empty group is fully satisfied.
- `src/BE/Services/GameStateBuilder.cs:31-33` computes completion plus missing requirements separately.
- `src/BE/Services/GameStateBuilder.cs:86-101` sums every missing ID into `PendingRequirementCount`.
- `src/BE/Services/GameStateBuilder.cs:260-269` returns all missing IDs regardless of logic.
- `src/BE/Services/GameStateBuilder.cs:315-325` tells the player to complete all missing groups.
- `src/BE/DTOs/Investigation/GameStateDtos.cs:453-462` exposes a single pending count.

Current mismatch:

```csharp
// Runtime OR rule, CaseValidationService.cs:1270-1274
return (condition.RequiredItemIds.Count > 0 && itemsOk)
    || (condition.RequiredClueIds.Count > 0 && cluesOk)
    || (condition.RequiredDialogueIds.Count > 0 && dialoguesOk);
```

```csharp
// Projection, GameStateBuilder.cs:96-100
PendingRequirementCount = missingItems + missingClues + missingDialogues;
```

## Target contract

- AND: pending count is the total missing IDs; objective joins all missing actions.
- OR: each non-empty type is one alternative branch; pending count is the smallest number of missing IDs among unfinished branches; objective says “Choose one” and lists alternatives.
- Once any OR branch is complete, pending count is 0, missing DTO is empty, and `CurrentSceneCanComplete` is true.
- Do not change the meaning of OR to item-by-item OR across mixed IDs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `dotnet test src/BE/Tests/SirLocked.Tests.csproj --no-restore --filter "FullyQualifiedName~GameProgressionRuleTests|FullyQualifiedName~GameState"` | exit 0 |
| Backend suite | `dotnet test SirLocked.sln --no-restore` | exit 0 |
| Frontend typecheck | `cd src/FE; npm run typecheck` | exit 0 |

## Scope

**In scope**:

- `src/BE/Services/GameRules.cs` or a new `CompleteConditionProgress.cs` pure helper
- `src/BE/Services/CaseValidationService.cs` only to delegate `IsConditionSatisfied` to the shared helper
- `src/BE/Services/GameStateBuilder.cs`
- `src/BE/DTOs/Investigation/GameStateDtos.cs` only if a structured alternative DTO is necessary
- `src/BE/Tests/GameProgressionRuleTests.cs`
- `src/BE/Tests/GameStateProjectionTests.cs` (create if useful)
- `src/FE/Client/js/pages/gamePage.ts` only if response shape adds explicit alternatives

**Out of scope**:

- Changing case JSON schema or AI generation prompts.
- Changing scene completion, progression, or accusation availability.
- Rewriting all English objective copy.
- Adding localization infrastructure.

## Git workflow

- Suggested branch: `advisor/010-or-objective-projection`
- Suggested commit: `fix(gameplay): align OR objectives with completion rules`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Introduce one pure completion-progress evaluator

Create an internal pure result type containing at least:

- `IsSatisfied`
- missing item/clue/dialogue IDs
- non-empty alternative groups for OR
- `PendingCount`

Create one evaluator that accepts `CompleteCondition` plus inspected/unlocked/asked sets. Move or delegate `CaseValidationService.IsConditionSatisfied` to this evaluator so completion and projection cannot drift.

Rules:

- Empty groups are ignored as OR alternatives.
- AND with an empty group treats that group as satisfied, preserving current `All` behavior.
- OR with no non-empty groups remains invalid content and returns unsatisfied defensively.
- For satisfied OR, public missing requirements must be empty even if other alternatives are unfinished.

Do not add Mongo or DTO dependencies to the evaluator.

**Verify**: add pure tests for AND, empty groups, each OR branch, satisfied OR with other groups missing, and unequal branch sizes.

### Step 2: Use the evaluator everywhere in state projection

In `GameStateBuilder`:

- Compute progress once for the current scene and reuse it for `CurrentSceneCanComplete`, `MissingRequirements`, and `BuildObjective`.
- Compute progress once per map scene and use `PendingCount`.
- Remove the independent count/sum code and the separate `MissingRequirements` implementation.
- Ensure completed scenes always project pending count 0.

If performance becomes a concern, retain the existing prebuilt hash sets and pass them to the pure evaluator; do not rebuild sets per requirement ID.

**Verify**: focused tests assert current objective, missing DTO, and map count agree for identical state.

### Step 3: Render clear OR copy

For an unfinished OR condition, produce copy in this shape:

`Investigate <scene>: choose ond; or uncover 3 clue(s).`

List only non-empty unfinished alternatives. For a branch already complete, the scene is satisfied and should show the existing completion copy instead.

Prefer generating this text server-side to preserve the current `Objective` contract. Add structured alternatives to DTOs only if the frontend already needs them for visual grouping; if so, maintain backward-compatible existing fields.

**Verify**: exact or substring assertions cover two-branch and three-branch OR copy without requiring fragile punctuation matching.

### Step 4: Run regression checks

Confirm existing AND scenes produce the same pending counts and substantially the same objective text. Confirm validator tests for invalid empty OR still pass.

**Verify**: backend suite and frontend typecheck exit 0.

## Test plan

- Pure evaluator: AND all/partial, OR item branch, clue branch, dialogue branch, empty branch ignored, empty OR invalid/unsatisfied.
- Projection: OR branch satisfied while other branches missing returns `PendingRequirementCount = 0` and empty missing requirements.
- Projection: unfinished OR with branch missing counts 3/1/2 returns pending count 1.
- Copy: contains “choose one” and only valid alternatives.
- Regression: existing AND count remains total missing IDs.

## Done criteria

- [ ] Completion, missing requirements, objective, and map pending count use one evaluator.
- [ ] OR pending count represents the shortest unfinished alternative, not the sum.
- [ ] A satisfied OR condition exposes no false missing requirements.
- [ ] AND behavior remains unchanged.
- [ ] Focused and full backend tests pass; frontend typecheck passes.
- [ ] No files outside scope are modified.
- [ ] `plans/README.md` marks plan 010 DONE.

## STOP conditions

- Product semantics define OR differently from the locked target contract.
- Fixing projection requires changing stored case data or migrating Mongo documents.
- A DTO change would break existing frontend clients and cannot be additive.
- Plan 009 has introduced a different shared condition evaluator; extend it instead of creating a duplicate.

## Maintenance notes

- Any fourth requirement category must be added once to the evaluator and automatically flow into completion, missing state, objective, and map count.
- Reviewers should search for new manual sums of `RequiredItemIds`, `RequiredClueIds`, and `RequiredDialogueIds` outside the evaluator.

## Execution record

- DONE on 2026-07-13 in isolated branch `advisor/010-or-objective-projection` at `b4be2574bc27726346cc98006b02ce537da114c2`.
- Added one pure completion-progress evaluator shared by validator/runtime projection; OR objectives now show typed alternatives, pending count uses the shortest unfinished branch, and satisfied OR exposes no false missing requirements.
- Verified independently: focused 23/23, full backend 192/192, build 0 warnings and 0 errors, frontend typecheck passed.
- Scope remained backend-only across five approved files; DTO/frontend shape and Plan 008 captured-photo projection were unchanged.
- This branch descends from Plans 009/008 and the mechanical snapshot commit `d864527`; do not cherry-pick blindly onto a workspace that already contains the same uncommitted snapshot changes.
