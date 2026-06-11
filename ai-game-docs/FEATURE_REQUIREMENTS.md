# Feature Requirements

## Authentication

- Register with full name, email, password.
- Public registration always creates `PLAYER`.
- Login returns JWT.
- `GET /api/auth/me` returns current user profile.
- Password minimum length for MVP: 6 characters.
- No email verification for MVP.
- Locked or deleted users cannot access protected APIs.
- Seed admin account if none exists:
  - Email: `admin@sirlocked.local`
  - Password: `Admin123!`
  - Role: `ADMIN`

## Case Management

Player:

- View published cases.
- View case detail.
- Create room from a published case.

Admin:

- View all cases.
- Import case JSON.
- Validate case JSON.
- Publish/unpublish case.
- Seed sample/demo case.
- Generate AI case draft.
- Import/publish generated AI case.
- Promote/demote non-admin users between `PLAYER` and `VIP`.

VIP:

- Generate AI case draft.
- Admin review/import/publish remains required before a generated draft becomes playable.

## Gameplay

The game must render a continuous scene-based investigation flow.

Required gameplay:

- Load first stage and first scene when game starts.
- Render scene background.
- Render clickable hotspots by percent coordinates.
- `INVESTIGATOR` inspects item in current scene.
- Unlock clues from inspected items.
- `INTERROGATOR` talks to characters in current scene.
- Dialogue can require clues.
- Dialogue can unlock clues.
- Scene completes only when its completion condition is satisfied.
- Stage progresses in order.
- MVP scene progression is linear by `stage.order` and scene array order; free scene travel is deferred unless explicitly implemented.
- Final accusation checks culprit and required evidence.
- Final accusation is available only in the last scene of the last stage after all `finalLogic.requiredEvidenceIds` have been unlocked.
- Final required evidence IDs are clue IDs only.
- Correct accusation returns win ending.
- Wrong accusation returns fail ending.
- Current objective/hints show missing progress categories to reduce deadlocks.

## Realtime

Use SignalR to synchronize:

- player joined/left
- role selection
- ready status
- game started
- current scene/stage
- item inspected
- clue unlocked
- dialogue answered
- game completed
- room chat or action log, optional after core gameplay sync is stable
- reconnect by refetching `GET /api/game/rooms/{roomId}/state`
- state version/timestamp to avoid stale client state

## AI Case Generation

MVP:

- Admin or VIP submits a prompt.
- Backend calls Deepseek if configured.
- If Deepseek key is missing, use validated mock fallback.
- Generated JSON must parse into `GameCase`.
- Generated case status must be `DRAFT`.
- Validate before import or publish.
- Export JSON bundle to `src/BE/GeneratedCaseJson`.
- Store AI draft in MongoDB.

Optional future:

- multi-step AI pipeline
- AI validator using another model
- real image generation
- Cloudinary upload
- richer VIP generation history and quotas

## Admin Dashboard

MVP dashboard should show:

- total users
- total cases
- total rooms
- total results or completed games
- quick actions:
  - seed sample case
  - view cases
  - create AI case

## Quality Requirements

- Do not rewrite the project.
- Extend existing backend services/controllers/repositories.
- Keep controllers thin.
- Put business logic in services.
- Validate all gameplay actions server-side.
- Frontend must not hard-code sample case logic.
- Use placeholders for missing images.
- Update README with run/demo instructions.
