# Gameplay Flow

## Player Flow

1. Player registers or logs in.
2. Player opens published case list.
3. Player chooses a case.
4. Player creates a room or joins by room code.
5. Player selects role:
   - `INVESTIGATOR`
   - `INTERROGATOR`
6. Both players ready up.
7. Host starts the game.
8. Backend creates initial runtime state:
   - first stage by order
   - first scene in first stage
   - empty inspected items
   - empty clues
   - empty asked dialogues
9. Frontend renders game scene.
10. Players inspect items, talk to characters, unlock clues.
11. Backend broadcasts updates by SignalR.
12. Players satisfy scene conditions and the investigation naturally opens the next scene/objective.
13. Final accusation becomes available only when MVP accusation readiness rules are satisfied.
14. Players choose culprit and evidence.
15. Backend validates accusation.
16. Result page shows ending.

## Player-Facing Continuity

Stages remain an internal backend structure for ordering, validation, and progression. The UI should not present the case as disconnected `Stage 1`, `Stage 2`, or `Stage Complete` screens.

Player-facing progress should feel like one continuous investigation:

- current objective
- open or visited locations
- newly discovered clues
- unlocked dialogue questions
- contradictions and unresolved leads
- final confrontation readiness

## Role Rules

Roles are not cosmetic in MVP.

- `INVESTIGATOR` owns physical evidence actions:
  - inspect item hotspots
  - collect item-based clues
  - review scene objects and evidence details
- `INTERROGATOR` owns witness actions:
  - ask dialogue questions
  - unlock dialogue-based clues
  - challenge contradictions
- Both players can view shared state, clue board/notebook, investigation progress, and final accusation.
- Final accusation should be submitted only after both players can review the selected culprit/evidence. The backend may accept either player as submitter, but the room result is shared.
- If a single-player/dev shortcut is needed, keep it behind a development flag; production rooms should enforce two different roles.

This split is required so the co-op loop has real coordination: one player discovers physical facts while the other turns those facts into testimony and contradictions.

## Inspect Item Flow

1. `INVESTIGATOR` clicks hotspot for an item.
2. Frontend calls `POST /api/game/rooms/{roomId}/inspect-item`.
3. Backend checks:
   - user is in room
   - room is in progress
   - user role is `INVESTIGATOR`
   - item belongs to current scene
   - required hotspot clues are unlocked, if any
4. Backend records inspected item.
5. Backend unlocks item `unlockClueIds`.
6. Backend logs action.
7. Backend broadcasts:
   - `ItemFound`
   - `ClueUnlocked` if new clues were added
8. Frontend updates item modal and clue board.

## Ask Dialogue Flow

1. `INTERROGATOR` clicks a character or opens dialogue panel.
2. Frontend shows available dialogue questions.
3. Locked dialogue is disabled or hidden if required clues are missing.
4. Player asks a dialogue.
5. Frontend calls `POST /api/game/rooms/{roomId}/ask-dialogue`.
6. Backend checks:
   - user role is `INTERROGATOR`
   - character is in current scene
   - dialogue belongs to character
   - required clues are unlocked
7. Backend records asked dialogue.
8. Backend unlocks dialogue `unlockClueIds`.
9. Backend broadcasts `DialogueAnswered` and `ClueUnlocked`.

## Scene Completion Flow

1. Player clicks a natural progress action such as continue investigation, review objective, or proceed when ready.
2. Frontend calls `POST /api/game/rooms/{roomId}/complete-scene`.
3. Backend checks scene `completeCondition`.
4. MVP default is `logic: "AND"`: all required item, clue, and dialogue IDs must be satisfied.
5. `logic: "OR"` is allowed only when documented in the case JSON and at least one non-empty requirement group is satisfied.
6. If missing requirements, backend returns clear missing IDs.
7. If complete:
   - mark scene completed
   - move to next scene in current stage, or next stage first scene
   - broadcast `SceneChanged` or `StageChanged`

The frontend should translate successful completion into investigation language, such as a newly opened location, new objective, or new confrontation opportunity. Avoid showing a prominent `Stage Complete` message.

MVP scene progression is linear by `stage.order` and by the `scenes` array order inside each stage. When `complete-scene` succeeds, the backend moves to the next scene in the same stage. If no next scene exists, the backend moves to the first scene of the next stage. Free scene travel is deferred unless `go-to-scene` is explicitly implemented; the frontend investigation map must not bypass backend progression rules.

Players may revisit completed scenes for review. Inspecting an item or asking a dialogue again is idempotent and must not duplicate clues/logs.

## Final Accusation Flow

1. Player opens final deduction panel only when accusation is available.
2. Player selects culprit.
3. Player selects evidence/clues.
4. Frontend calls `POST /api/game/rooms/{roomId}/accuse`.
5. Backend compares:
   - selected culprit == `finalLogic.culpritId`
   - selected evidence contains all `finalLogic.requiredEvidenceIds`
6. Backend saves result.
7. Room status becomes `COMPLETED`.
8. Backend broadcasts `GameCompleted`.
9. Frontend shows win/fail ending.

`finalLogic.requiredEvidenceIds` must reference clue IDs only. If an item matters for the final accusation, it must unlock a clue marked `isEvidence: true`; the final logic then references that clue.

MVP accusation availability rule:

- The current scene must be the last scene of the last stage.
- All `finalLogic.requiredEvidenceIds` must already be present in `gameplayState.unlockedClueIds`.
- The room status must be `IN_PROGRESS`.
- The frontend may hide or disable the final accusation button before these conditions are met, but the backend must enforce the same rule.

## Deadlock And Hint Rules

Case validation must reject unlock chains that can deadlock:

- Every required clue for a hotspot/dialogue/scene must be discoverable before that point in stage order.
- Dialogue and clue dependencies must not form cycles.
- Final evidence must be discoverable through item or dialogue unlocks before the final accusation scene.
- Required scene completion IDs must exist and be reachable in the same scene or earlier scenes.

Frontend should show a current objective/hint panel based on missing scene completion requirements. Hints should reveal the next missing action category first, then exact clue/item IDs only after repeated failed progress attempts.

## Reconnect Flow

1. Client uses SignalR automatic reconnect.
2. After reconnect or page refresh, client calls `GET /api/game/rooms/{roomId}/state`.
3. Client replaces local state with the API response.
4. Each realtime event should include a `version` or be followed by `GameStateUpdated`; if the client sees an older version, it refetches state.
5. Backend remains authoritative; clients never infer unlock/progression locally.

## Important Rule

Frontend displays state, but backend enforces all rules. Never trust frontend state for unlocking, progression, or accusation.
