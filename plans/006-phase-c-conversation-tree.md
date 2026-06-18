# Plan 006 — Phase C: Conversation Tree (locked spec)

Status: SPEC LOCKED — ready to implement.
Author decisions (locked): Augment within V2 · Topic + 1-level follow-up · `POST /converse` per turn.

Frontend already has a polished V2 conversation overlay (chat log + present-evidence + ask choices,
Phase A/B). Phase C makes authored, branching NPC conversations possible **without** free-form runtime AI.

---

## 1. Goals & constraints

- Authored **conversation tree** per NPC: greeting → topics → optional 1-level follow-up → back.
- **No free-form AI at runtime.** Trees are generated when the case is created, validated, and the
  runtime only walks authored branches.
- **Backward compatible.** V1 (legacy) and V2 (challenge/deduction/scoring) cases keep working
  unchanged. All 58 backend tests must stay green.
- **Reuse existing systems** — clue unlock, discovery tracking, teamwork, `EvidenceChallenge` —
  no parallel engine.

## 2. Mechanics versioning — augment within V2

- `mechanicsVersion` stays **2**. Conversation tree is an **optional enrichment**.
- A character is rendered as a **tree** iff the case has `conversationNodes` for that character;
  otherwise the existing **flat** `dialogues` list is used. Mixed cases are allowed
  (some NPCs flat, some tree).
- Cases with no `conversationNodes` behave exactly as today.

## 3. Contract additions (`GameCase`)

```
conversationNodes[] : ConversationNode

ConversationNode {
  nodeId            : string   // unique across case
  characterId       : string   // owner NPC
  isRoot            : bool      // exactly one root per character that has nodes
  requiredClueIds[] : string   // gate: node is selectable only when all are unlocked
  lines[] {
    speaker : "NPC" | "DETECTIVE"
    text    : string
  }
  unlockClueIds[]   : string   // unlocked the first time this node is reached
  challengeId?      : string   // optional: node is a present-evidence confrontation (reuses EvidenceChallenge)
  choices[] {
    choiceId        : string   // unique within node
    label           : string
    requiredClueIds[] : string // gate: choice is shown/enabled only when all are unlocked
    nextNodeId      : string?  // null => end turn / return to root
  }
}
```

Depth model (topic + 1-level follow-up):
- **root** (depth 0): greeting `lines` + `choices` = topics.
- **topic node** (depth 1): NPC `lines`; `choices` = optional follow-ups (gated) — each either
  goes to one follow-up node or `null` (return to root).
- **follow-up node** (depth 2): NPC `lines`; all its `choices` MUST have `nextNodeId = null`
  (return to root). No deeper branching.

`challengeId` may appear on a topic or follow-up node; the node then renders the existing
present-evidence panel (correct evidence resolves the `EvidenceChallenge`, applying its unlocks).

## 4. Runtime state (`GameplayState`)

Add:
- `VisitedConversationNodeIds[]` — nodes the team has reached (for unlock idempotency + UI history).

Reuse (no change): `UnlockedClueIds`, `ClueDiscoveries`, `ResolvedConfrontationRecords`,
`EvidenceAttemptKeys`, scoring/teamwork. `AskedDialogueIds` still drives flat NPCs.

Clue discovery from a node uses `sourceAction = "conversation"` (new constant) so teamwork/discovery
attribution keeps working.

## 5. API — `POST /api/game/rooms/{roomId}/converse`

Request:
```
{ "characterId": "char-x", "nodeId": "node-y", "choiceId": "choice-z" | null }
```
- `nodeId` null/omitted → server returns the character's **root** node (open conversation).
- `choiceId` provided → server resolves the chosen branch from `nodeId`.

Server rules:
- Only `INTERROGATOR` may drive `/converse` (mirror present-evidence/ask).
- NPC must be in the player's current scene.
- The target node's `requiredClueIds` and the chosen choice's `requiredClueIds` must all be unlocked,
  else 400 (generic message, no spoiler).
- On reaching a node the first time: add to `VisitedConversationNodeIds`, apply `unlockClueIds`
  (record discovery, broadcast `DIALOGUE_UNLOCKED`-style follow-up signals), bump version.
- Re-walking a visited node is idempotent (no double unlock, no penalty).
- If the node has `challengeId`, present-evidence stays a separate `POST /present-evidence` call
  (unchanged); `/converse` just exposes the challenge.

Response (no secrets):
```
{
  node: { nodeId, lines[], challengeId? },
  choices: [ { choiceId, label, isLocked } ],   // locked choices carry NO label spoiler
  unlockedClueIds[],
  state: GameStateResponse,
  changed: bool
}
```
- Locked choices are returned as `{ isLocked: true }` with label suppressed (mirror current
  locked-dialogue behavior). Correct evidence / hidden gates are never sent.

V1/V2 with no nodes: endpoint returns 400 “This case has no conversation tree”; flat `ask-dialogue`
remains the path.

## 6. Validator rules (V2, only when `conversationNodes` present)

- `nodeId` unique across case; `choiceId` unique within a node.
- Every `characterId` used exists; each such character has **exactly one** `isRoot` node.
- `choices[].nextNodeId`, `challengeId`, `requiredClueIds`, `unlockClueIds` reference valid entities.
- A node’s `challengeId` (if set) must reference an `EvidenceChallenge` whose dialogue character
  matches the node’s `characterId`.
- **Depth ≤ 2**: root→topic→follow-up; follow-up nodes’ choices must all be `nextNodeId = null`.
- **Reachability**: every node reachable from its character’s root via some clue state.
- **No dead author content**: no node unreachable; no choice points to a missing node.
- **No soft-lock**: from any node a path returns to root (the global Leave button is always
  available, so this is a content-quality check, not a hard lock).
- Lines non-empty; `speaker` ∈ {NPC, DETECTIVE}.

Validator stays scoped: these checks only run when `conversationNodes` is non-empty, so V1/V2
flat cases are unaffected.

## 7. DTOs (no secret leak)

- `ConversationNodeDto` excludes nothing secret by itself, but the **response builder** filters
  choices by gate and suppresses locked labels and any `requiredClueIds`.
- Reuse existing `EvidenceChallengeDto` (already hides `CorrectEvidenceId`/`FailureResponse`).
- A DTO test asserts `ConversationChoiceDto` does not expose `requiredClueIds`/`nextNodeId` of
  locked choices.

## 8. Frontend (reuse the Phase A/B overlay)

- If the opened NPC has nodes → tree mode; else flat mode (current behavior).
- Tree mode:
  - Open NPC → `/converse` root → render greeting `lines` into the existing chat log; render
    `choices` as the existing `.conv-choice` buttons (locked → spoiler-free, same as now).
  - Click a choice → `/converse {nodeId, choiceId}` → append node `lines` to log (deterministic
    rebuild from `VisitedConversationNodeIds` keeps it idempotent, reusing Phase B/“no duplicate”
    architecture), update choices.
  - Node with `challengeId` → show the existing present-evidence panel.
  - Phase B “New” cues apply to newly-unlocked choices/nodes.
- Reuse typewriter, grouped turns, fixed-form scroll, footer Leave.

## 9. AI generation & compatibility

- Prompt: optionally emit `conversationNodes` (topic + 1-level follow-up) per NPC; still allowed to
  emit flat V2 only.
- Update parser, `CaseAutoRepair`, `MockCaseFactory`, and `SeedData/sample-case.json` to include a
  small tree on one NPC as a reference.
- Mongo cases without `conversationNodes` are read as flat (no migration needed).

## 10. Scoring / teamwork / co-op

- Unchanged math. Node `unlockClueIds` and node `challengeId` feed the same clue/discovery/teamwork
  pipeline, so evidence coverage / contradiction / teamwork still compute correctly.
- SignalR: `/converse` reuses `NotifyNewCluesAndDialoguesAsync` + InvestigationUpdate; signals
  describe opportunity only (no answers).

## 11. Implementation phases

- **C1 — Contract + state + validator + DTO** (backend, no AI): models, `VisitedConversationNodeIds`,
  validator rules, DTO filtering, `ConversationNodeDto`. Unit tests.
- **C2 — `/converse` endpoint + rules**: walk root/choice, gating, idempotent unlocks, role/scene
  checks, broadcasts. Tests for correct/locked/duplicate/wrong-role/wrong-scene/concurrency.
- **C3 — FE tree mode**: render nodes/choices in the existing overlay, wire `/converse`, integrate
  challenge + Phase B cues.
- **C4 — AI gen + sample**: prompt/parser/repair/mock/sample; validate a generated tree case end-to-end.

Each phase keeps prior tests green.

## 12. Testing

- Validator: tree present/absent, depth>2 rejected, missing root, duplicate nodeId, bad refs,
  unreachable node, soft-lock content, challenge/character mismatch.
- `/converse`: root open, gated choice locked vs unlocked, idempotent revisit, wrong role,
  wrong scene, concurrency conflict; V1/V2-no-tree → 400.
- DTO: locked choices/secret gates not leaked.
- Flat V1/V2 regression: existing 58 tests stay green.
- Two-session co-op: tree walk + reconnect + realtime.

## 13. Verification (mandatory)

```powershell
dotnet test SirLocked.sln --no-restore
cd src/FE; npm run typecheck; npm run build
```
Baseline: 58 backend tests pass before each phase; all old + new tests pass.
Bump `?v=` in `src/FE/index.html` on every CSS change.
```
