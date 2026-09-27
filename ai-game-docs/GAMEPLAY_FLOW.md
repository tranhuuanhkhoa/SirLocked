# Gameplay Flow

Last synced with code: 2026-06-12.

> Note: gameplay now includes camera clue capture and per-player scene location
> through `PlayerSceneIds`. See `CURRENT_CASE_AND_GAME_FLOW_VI.md` for the
> code-synced flow as of 2026-06-18.

This file describes the current authoritative backend flow. For the next 2D co-op direction, layer the movement/runtime rules from `PLAYER_MOVEMENT_SYSTEM.md`, `REALTIME_CHARACTER_SYNC.md`, and `SCENE_RUNTIME_SCHEMA.md` on top of these commands.

## Lobby Flow

1. Player A logs in and creates a room from a published case.
2. Player B joins with the room code.
3. Each player selects a unique role:
   - `INVESTIGATOR`
   - `INTERROGATOR`
4. Selecting/changing a role resets that player's ready state.
5. Both players ready up.
6. Room status becomes `READY`.
7. Host calls `POST /api/rooms/{roomId}/start`.
8. Backend initializes `gameplayState` and sets room status to `IN_PROGRESS`.

Start fails unless there are exactly two players, both have roles, both are ready, and the roles are different.

## Initial Gameplay State

On start, backend chooses:

- first stage by ascending `stage.order`,
- first scene in that stage's `scenes` array,
- `version = 1`,
- `visitedSceneIds = [firstSceneId]`,
- `gameStatus = IN_PROGRESS`.

All inspected/collected/unlocked/asked/completed arrays start empty.

## Role Split

`INVESTIGATOR`:

- can inspect item hotspots,
- unlocks item-based clues,
- collects collectible items.

`INTERROGATOR`:

- can ask dialogue questions,
- unlocks dialogue-based clues.

Both players:

- can view room/game state,
- can complete scenes,
- can revisit visited scenes,
- can present evidence,
- can submit the final accusation.

## 2D Co-op Movement Layer

Current code already supports transient player pose broadcasting through SignalR. The target gameplay direction is that Sherlock/Watson-style characters move independently inside the same 2D scene.

Movement does not replace backend commands. It changes how players reach those commands:

- Investigator walks near an item and interacts, then frontend calls `inspect-item`.
- Interrogator walks near a character and interacts, then frontend calls `ask-dialogue`.
- Both players can stand in different positions in the same scene.
- Remote player position is rendered from SignalR `PlayerPoseUpdated`.
- `GameStateUpdated` remains the source of truth for puzzle state.

Implementation details live in:

- `PLAYER_MOVEMENT_SYSTEM.md`
- `REALTIME_CHARACTER_SYNC.md`
- `SCENE_RUNTIME_SCHEMA.md`

## Inspect Item

Endpoint: `POST /api/game/rooms/{roomId}/inspect-item`.

In the current UI, this can be triggered from a hotspot/list. In the 2D movement direction, the same endpoint should be triggered only after the investigator is close to the item's interaction zone.

Backend checks:

- user is a room member,
- room is in progress,
- user role is `INVESTIGATOR`,
- item exists in the case,
- item belongs to the current scene,
- the matching item hotspot is not locked by missing `requiredClueIds`.

Successful first inspection:

- adds `itemId` to `inspectedItemIds`,
- adds `itemId` to `collectedItemIds` when `isCollectible` is true,
- adds new item `unlockClueIds` to `unlockedClueIds`,
- increments `version`,
- writes action logs,
- broadcasts `ItemFound`, `ClueUnlocked`, and `GameStateUpdated`.

Repeated inspection is idempotent and does not duplicate logs or clues.

## Ask Dialogue

Endpoint: `POST /api/game/rooms/{roomId}/ask-dialogue`.

In the current UI, this can be triggered from a dialogue panel. In the 2D movement direction, the same endpoint should be triggered after the interrogator is close to the relevant character.

Backend checks:

- user is a room member,
- room is in progress,
- user role is `INTERROGATOR`,
- dialogue exists,
- dialogue character is present in the current scene,
- all dialogue `requiredClueIds` are unlocked.

Successful first ask:

- adds `dialogueId` to `askedDialogueIds`,
- adds new dialogue `unlockClueIds` to `unlockedClueIds`,
- increments `version`,
- writes action logs,
- broadcasts `DialogueAnswered`, `ClueUnlocked`, and `GameStateUpdated`.

Repeated asking is idempotent and returns the same answer.

## Present Evidence

Endpoint: `POST /api/game/rooms/{roomId}/present-evidence`.

This is a lightweight MVP action:

- validates the dialogue and clue exist,
- requires the evidence clue to be unlocked,
- logs the presentation,
- broadcasts `EvidencePresented`,
- returns current state,
- does not mutate `gameplayState`.

## Complete Scene

Endpoint: `POST /api/game/rooms/{roomId}/complete-scene`.

Backend evaluates current scene `completeCondition` with:

- inspected item IDs,
- unlocked clue IDs,
- asked dialogue IDs.

`AND` requires every listed requirement. `OR` requires at least one non-empty requirement group to be fully satisfied.

If incomplete, the API returns missing item/clue/dialogue IDs in `errors`.

If complete:

- current scene ID is added to `completedSceneIds`,
- backend advances to the next scene in the same stage, or the first scene of the next stage,
- if the last scene of the last stage is complete, backend stays there and final accusation can become available,
- `version` increments,
- backend broadcasts `SceneChanged` or `StageChanged`, then `GameStateUpdated`.

## Complete Stage

Endpoint: `POST /api/game/rooms/{roomId}/complete-stage`.

Current implementation is an idempotent confirmation. It returns current state without advancing. If the current stage is complete, it confirms that stage. If `complete-scene` has already advanced to the next stage, it can also confirm that the previous stage is complete while the current stage remains in progress. Actual progression happens through `complete-scene`.

## Revisit Scene

Endpoint: `POST /api/game/rooms/{roomId}/go-to-scene`.

Rules:

- target scene must exist,
- target scene must already be in `visitedSceneIds`,
- moving to the current scene is idempotent,
- successful movement updates `currentSceneId` and `currentStageId`,
- backend broadcasts `SceneChanged` and `GameStateUpdated`.

This supports review/backtracking but does not unlock unseen future scenes.

## Final Accusation

Endpoint: `POST /api/game/rooms/{roomId}/accuse`.

Available only when:

- room status is `IN_PROGRESS`,
- `gameStatus` is `IN_PROGRESS`,
- current scene is the last scene of the last ordered stage,
- every `finalLogic.requiredEvidenceIds` clue is unlocked.

Backend rejects:

- unknown culprit IDs,
- evidence IDs not yet unlocked.

Backend marks success when:

- selected culprit equals `finalLogic.culpritId`,
- submitted evidence contains every required evidence clue.

Both correct and wrong accusations complete the room. Correct accusation sets `gameStatus = WON`; wrong accusation sets `gameStatus = FAILED`.

## Realtime And Reconnect

The SignalR client connects to `/hubs/game`, invokes `JoinRoom(roomId)`, and refetches API state after reconnect.

`GameStateUpdated` is the authoritative realtime event. Detail events such as `ItemFound`, `ClueUnlocked`, and `DialogueAnswered` are useful for UI feedback but should not replace the state snapshot.

Player pose events are visual-only:

- `UpdatePlayerPose`
- `PlayerPoseUpdated`
- `PlayerPoseLeft`

They should not unlock clues or advance scenes.

## Backend Authority

Clients never submit full gameplay state. Clients submit commands. The backend validates and persists every state transition.
