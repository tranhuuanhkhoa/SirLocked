# Feature Requirements

Last synced with code: 2026-06-12.

## Authentication

- Public users can register with `fullName`, `email`, and `password`.
- Email is normalized to lowercase before storage.
- Public registration always creates an active `PLAYER`.
- Login returns a JWT and user profile.
- Locked or deleted users cannot log in.
- Logout is stateless; the client discards the JWT.
- Backend startup seeds one default `ADMIN` when no admin exists.

## Case Browsing

- Authenticated users can list `PUBLISHED` cases.
- Authenticated users can open public case detail including characters and summary counts.
- Full case JSON is only exposed through admin case detail.

## Admin User Management

- `ADMIN` can view dashboard counts.
- `ADMIN` can list users.
- `ADMIN` can lock/unlock users.
- `ADMIN` can set non-admin roles to `PLAYER` or `VIP`.

## Admin Case Management

- `ADMIN` can list all cases.
- `ADMIN` can view full case documents.
- `ADMIN` can validate a case JSON without importing it.
- `ADMIN` can import a valid case JSON as draft.
- `ADMIN` can publish/unpublish cases.
- `ADMIN` can seed the canonical sample case and demo cases.

## Room Requirements

- Rooms are created only from published cases.
- A room has exactly one host and a maximum of two players.
- Room code is a random six-character code using `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Joining is idempotent for an existing member.
- Joining an in-progress, completed, or full room fails.
- Players cannot leave a room after the game starts.
- If the host leaves a waiting room, host ownership moves to the remaining player.

## Lobby Requirements

- Players select one of two roles:
  - `INVESTIGATOR`
  - `INTERROGATOR`
- Duplicate role selection is rejected.
- Changing role resets that player's ready state.
- A player cannot ready up without a role.
- Room status becomes `READY` only when two players are present and both are ready.
- Only the host can start.
- Start requires two players, two different roles, and both ready.

## Gameplay Requirements

- Starting initializes `gameplayState` with version `1`, first ordered stage, and first scene.
- `INVESTIGATOR` can inspect items in the current scene.
- `INTERROGATOR` can ask dialogue for characters in the current scene.
- Item and dialogue actions are idempotent if repeated.
- Hotspots and dialogues may be locked by `requiredClueIds`.
- Inspecting an item can add inspected/collected item IDs and unlock clues.
- Asking dialogue can add asked dialogue IDs and unlock clues.
- Presenting evidence logs and broadcasts the action but does not mutate core state.
- Completing a scene checks `completeCondition`.
- Successful scene completion advances to the next scene, next stage, or final accusation readiness.
- `complete-stage` is an idempotent confirmation endpoint.
- `go-to-scene` only allows revisiting already visited scenes.
- Gameplay mutations use optimistic concurrency through `gameplayState.version`.

## Final Accusation Requirements

- Final accusation is allowed only when:
  - room status is `IN_PROGRESS`,
  - `gameStatus` is `IN_PROGRESS`,
  - current scene is the last scene of the last ordered stage,
  - all `finalLogic.requiredEvidenceIds` are unlocked clues.
- Unknown culprit IDs are rejected.
- Evidence IDs must be unlocked clues.
- Success requires correct culprit and every required evidence clue.
- Wrong culprit or missing evidence completes the room with a failed result.

## AI Case Requirements

- `ADMIN` and `VIP` can generate spoiler-free story previews.
- `ADMIN` and `VIP` can approve a preview to generate full logic and publish the case automatically.
- Only `ADMIN` can list and inspect all AI drafts.
- Missing OpenAI configuration fails the AI request instead of using a mock fallback.
- OpenAI full-case generation is parsed, mechanically repaired, validated, and retried once on validation failure.
- Generated cases receive OpenAI image assets and OpenAI-vision runtime placement before publish.
- Valid drafts are exported under `src/BE/GeneratedCaseJson/`.
- Generated cases are imported and published automatically after approval.
