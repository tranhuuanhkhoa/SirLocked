# Testing Strategy

## Test Priority

Test the shortest path that proves SirLocked is a playable game:

1. Auth works.
2. Sample case validates.
3. Room/lobby works for two players.
4. Gameplay actions mutate server state correctly.
5. SignalR keeps both clients synchronized.
6. Final accusation returns correct win/fail result.
7. AI generation creates or falls back to a valid draft.

## Backend Unit Tests

Case validation:

- Accepts `ai-game-docs/samples/sample-case.json`.
- Rejects duplicate IDs.
- Rejects missing item/character/clue/dialogue references.
- Rejects final evidence that is not a clue ID.
- Rejects final evidence clues without `isEvidence: true`.
- Rejects invalid hotspot target IDs.
- Rejects invalid `completeCondition` IDs.
- Rejects unlock chains that make required progress unreachable.

Gameplay service:

- Starts at first stage and first scene.
- `INVESTIGATOR` can inspect item.
- Non-investigator cannot inspect item in normal co-op mode.
- Inspecting the same item twice is idempotent.
- Item inspection unlocks clue IDs once.
- `INTERROGATOR` can ask unlocked dialogue.
- Non-interrogator cannot ask dialogue in normal co-op mode.
- Locked dialogue returns missing required clue IDs.
- Dialogue unlocks clue IDs once.
- Incomplete scene returns missing requirements.
- Complete scene advances to the next scene or stage.
- Accusation succeeds only with correct culprit and all required clue evidence IDs.
- Wrong accusation completes with fail result, not server error.

## Backend Integration Tests

- Register/login/me.
- Locked/deleted user cannot access protected endpoints.
- Admin seed sample case.
- Admin publish/unpublish case.
- Player list published cases.
- Create/join room by code.
- Reject third player in a two-player room.
- Reject duplicate game role.
- Ready/start requires two ready players with different roles.
- `GET /api/game/rooms/{roomId}/state` returns authoritative state.
- Reconnect flow can fetch current state after gameplay mutation.

## SignalR Tests

Manual MVP test is acceptable if automated SignalR tests are too costly.

Required manual checks:

- Player join updates the other client.
- Role/ready changes update both clients.
- Game start navigates both players to gameplay.
- Item inspection updates clue board on both clients.
- Dialogue answer updates both clients.
- Scene/stage change updates both clients.
- Browser refresh/reconnect refetches current state.
- Final game completion updates both clients.

## Frontend Tests

Minimum:

- Build succeeds.
- Login/register forms handle success and failure.
- Case list renders published cases from API.
- Lobby renders players, roles, ready state, and start button correctly.
- Game page renders from API data, not hard-coded sample IDs.
- Game page can show the case intro before the first scene.
- Hotspots scale with scene image.
- Role-specific UI disables item inspection for non-investigators and dialogue actions for non-interrogators.
- Investigation notebook groups evidence, critical clues, and red herrings without revealing final required evidence.
- Investigation map shows current/visited/unlocked locations without acting like a raw stage select screen.
- Objective/hint panel reflects missing requirements.
- Final accusation includes a review/confirm step and only submits clue evidence IDs.

## Manual End-To-End Demo

1. Start MongoDB, backend, and frontend.
2. Login as admin.
3. Seed and publish sample case.
4. Login as Player A and create room.
5. Login as Player B in another browser/profile and join by room code.
6. Select `INVESTIGATOR` and `INTERROGATOR`.
7. Ready both players and start.
8. Investigator inspects an item and sees a clue unlock.
9. Interrogator asks a dialogue gated by clue progress.
10. Complete enough investigation objectives to unlock final accusation.
11. Submit a correct accusation and confirm win ending.
12. Start another run or submit wrong evidence and confirm fail ending.

## AI Generation Tests

- Missing Deepseek key returns validated mock fallback.
- Invalid AI JSON is saved to `_invalid-ai`.
- Generated case status is forced to `DRAFT`.
- Generated case validates before import/publish.
- Generated bundle includes case, stages, scenes, characters, items, clues, dialogues, final logic, asset prompts, and validation report.
