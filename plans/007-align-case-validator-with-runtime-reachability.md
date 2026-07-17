# Plan 007: Make published-case validation match runtime reachability

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6869c99..HEAD -- src/BE/Services/CaseValidationService.cs src/BE/Services/GameRules.cs src/BE/Services/GameplayConversationRules.cs src/BE/Tests/CaseValidationServiceTests.cs src/BE/Tests/GameplayConversationRuleTests.cs`
>
> This plan was written while those gameplay files had uncommitted local changes. Also run `git diff -- src/BE/Services/CaseValidationService.cs src/BE/Services/GameRules.cs src/BE/Services/GameplayConversationRules.cs` and compare the live code with the excerpts below. If the excerpts no longer match, stop.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6869c99`, 2026-07-13
- **Executed**: APPROVED on branch `advisor/007-runtime-reachability-validator`, commit `9fa3aa8`, 2026-07-13. Focused tests 60/60 and build passed; full suite passed 163/164 with only the pre-existing Plan 008 EvidencePhoto source-string test failure.

## Why this matters

AI-generated cases are published only after `CaseValidationService` simulates a playthrough. The current simulator processes every scene in stage order even when runtime would reject entry, and it marks conversation nodes reachable without traversing their choices. A case can therefore pass publish validation and hard-lock real players behind a circular scene or conversation gate. The fix must establish one reachability contract shared with runtime rules, not add another approximation.

## Current state

- `src/BE/Services/CaseValidationService.cs:755-935` owns the greedy publish-time simulator.
- `src/BE/Services/GameRules.cs:13-24` is the runtime authority for whether a player may enter a scene.
- `src/BE/Services/GameplayConversationRules.cs:38-65` is the runtime authority for root/node/choice traversal and clue gates.
- `src/BE/Tests/CaseValidationServiceTests.cs:148-179` contains existing unreachable-progress tests.
- `src/BE/Tests/GameplayConversationRuleTests.cs:60-224` contains runtime gating/idempotency examples.
- Tests can access internal helpers through `src/BE/Properties/AssemblyInfo.cs:3`.

The scene loop currently ignores reachability:

```csharp
// CaseValidationService.cs:775-782
var unlockedScenes = new HashSet<string>();
var orderedStages = c.Stages.OrderBy(s => s.Order).ToList();
foreach (var stage in orderedStages)
{
    foreach (var scene in stage.Scenes)
    {
        // processes the scene without consulting GameRules.CanEnterScene
```

The conversation loop also bypasses authored paths:

```csharp
// CaseValidationService.cs:836-844
foreach (var node in c.ConversationNodes)
{
    if (visitedConversationNodes.Contains(node.NodeId)) continue;
    if (!scene.CharacterIds.Contains(node.CharacterId)) continue;
    if (!node.RequiredClueIds.All(unlockedClues.Contains)) continue;
    visitedConversationNodes.Add(node.NodeId);
    foreach (var clue in node.UnlockClueIds) unlockedClues.Add(clue);
}
```

Runtime, however, rejects direct access to an unvisited non-root node and enforces both choice and destination gates.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `dotnet test src/BE/Tests/SirLocked.Tests.csproj --no-restore --filter "FullyQualifiedName~CaseValidationServiceTests|FullyQualifiedName~GameplayConversationRuleTests"` | exit 0, all selected tests pass |
| Backend suite | `dotnet test SirLocked.sln --no-restore` | exit 0, all tests pass |
| Build | `dotnet build SirLocked.sln --no-restore` | exit 0, no errors |

## Scope

**In scope**:

- `src/BE/Services/CaseValidationService.cs`
- `src/BE/Services/GameplayConversationRules.cs` only if a pure shared graph helper must be extracted
- `src/BE/Services/CasePlaythroughSimulator.cs` (create if extraction keeps the validator readable)
- `src/BE/Tests/CaseValidationServiceTests.cs`
- `src/BE/Tests/GameplayConversationRuleTests.cs` only for shared-rule parity tests

**Out of scope**:

- Changing the product decision about free-roam versus authored scene order; plan 009 owns that.
- Changing API DTOs, controller routes, Mongo models, AI prompts, or frontend behavior.
- Auto-repairing invalid cycles. Validation must reject them with actionable errors.
- Weakening runtime authorization or clue gates merely to make generated cases pass.

## Git workflow

- Suggested branch: `advisor/007-runtime-reachability-validator`
- Use conventional commit style matching recent history, e.g. `fix(gameplay): align case reachability validation with runtime`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing characterization tests

In `CaseValidationServiceTests.cs`, add at least these publish-validation cases:

1. `SceneUnlockedOnlyFromInsideIt_IsRejected`: create a target scene explicitly gated by an interaction/puzzle whose only usable target is inside that same scene. Expect `UnreachableScene` for the target scene.
2. `SceneUnlockedFromReachableEarlierScene_IsAccepted`: the same gate, but place the unlocking action and its prerequisites in an enterable earlier scene. Expect the case to remain valid.
3. `ConversationChoiceRequiresClueItUnlocks_IsRejected`: root choice requires clue X and the destination node is the only source of X. Make X required for completion/final evidence. Expect an unreachable-content or undiscoverable-evidence error.
4. `ConversationNodeReachedThroughAvailableChoice_IsAccepted`: a reachable root choice leads to a node that unlocks required clue X. Expect valid.
5. `DirectlyReachableNodeRequirementWithoutGraphPath_IsRejected`: a node has satisfied node requirements but no traversable choice path from the root. Expect rejection.

Use the `LoadSampleCase` and `AddValidConversationTree` fixture style already present. Assertions must target error code and `RefId`, not full message text.

**Verify**: run the focused test command. The new invalid-case tests should fail against the current simulator for the expected reason; existing tests must still pass.

### Step 2: Model runtime scene entry in the simulator

Replace the unconditional stage/scene loop with a global fixpoint:

- Initialize a simulated `GameplayState` with the first authored scene in both `VisitedSceneIds` and `UnlockedSceneIds`, matching room start semantics.
- Keep existing simulated item/clue/dialogue/interaction/puzzle state, but copy scene unlock effects into `simulatedState.UnlockedSceneIds`.
- In each pass, process only scenes for which `GameRules.CanEnterScene(gameCase, simulatedState, sceneId)` returns true.
- Mark a processed enterable scene visited before evaluating its actions.
- Continue global passes while any scene/action/clue/node state changes; actions in a newly unlocked earlier/later scene must be considered on the next pass.
- After fixpoint, evaluate completion only for reachable scenes. Emit `UnreachableScene` for required authored scenes that can never be entered or completed, with a message distinguishing `not enterable` from `requirements unreachable`.

Do not copy the body of `CanEnterScene` into the validator.

**Verify**: focused tests. Both circular scene tests and the existing unlock-cycle tests pass.

### Step 3: Traverse conversation graphs through actual choices

Remove the loop that independently visits all nodes. For each character present in an enterable scene:

- Start only from that character's single root.
- A node is reachable only if its own `RequiredClueIds` are unlocked.
- A transition is reachable only if the current node was reached, the choice's `RequiredClueIds` are unlocked, and the target node's requirements are unlocked.
- Apply `UnlockClueIds` only the first time a reachable node is entered.
- Repeat because a newly unlocked clue may expose a previously locked choice.
- A null `NextNodeId` returns to root and does not invent a new node.

Prefer extracting a pure internal helper from `GameplayConversationRules` that returns traversable choices/nodes and can be called by both runtime presentation logic and validation. Do not call the HTTP/service command path or catch `ApiException` as control flow.

**Verify**: focused tests. All new conversation-cycle/path tests and existing runtime conversation tests pass.

### Step 4: Preserve actionable validation output

Use stable error codes:

- `UnreachableScene` for a scene that cannot be entered or completed.
- `UnreachableConversationNode` for authored graph content with no reachable root path.
- `UndiscoverableEvidence` for final required evidence still unavailable after the fixpoint.

Avoid leaking answer content beyond IDs already present in admin validation output. Do not change validation stages: reachability remains publish-only.

**Verify**: `dotnet test SirLocked.sln --no-restore` exits 0.

### Step 5: Document the shared-rule invariant in code

Add a short comment beside the simulator entry loop stating that scene entry must call `GameRules.CanEnterScene` so future progression changes automatically affect publish validation. Add an equivalent comment at the shared conversation transition helper.

**Verify**: `dotnet build SirLocked.sln --no-restore` exits 0.

## Test plan

- Add the five regression cases in Step 1.
- Preserve `SampleCase_IsValid` and `DemoLumiereCase_IsValid`.
- Preserve runtime tests for locked choice, locked destination, direct non-root open, revisit idempotency, and return-to-root.
- Run the focused tests after each logic change and the full backend suite before completion.

## Done criteria

- [ ] The publish simulator calls `GameRules.CanEnterScene`; it contains no unconditional processing of locked scenes.
- [ ] Conversation clues are unlocked only by traversing a reachable root/choice path.
- [ ] Circular self-unlock scene and conversation cases are rejected.
- [ ] A valid earlier-scene unlock and valid conversation branch are accepted.
- [ ] `dotnet test SirLocked.sln --no-restore` exits 0.
- [ ] `dotnet build SirLocked.sln --no-restore` exits 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` marks plan 007 DONE.

## STOP conditions

- Live source no longer matches the excerpts or plan 009 has already replaced scene-entry semantics without updating this plan.
- Correct simulation requires changing public gameplay/API behavior.
- The seed or demo case becomes invalid for a real authored gate; report the exact gate instead of weakening validation.
- A shared conversation helper would expose hidden labels/requirements in DTOs.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Any future change to `GameRules.CanEnterScene`, conversation choice gating, or a new unlock-producing mechanic must add a validator parity test.
- Reviewers should reject duplicated scene-entry predicates inside the validator.
- Plan 009 intentionally changes scene progression later; because this simulator calls `GameRules.CanEnterScene`, it should inherit that policy automatically.
