# Non-Functional Requirements

Last synced with code: 2026-06-12.

## Reliability

- Backend must remain authoritative for gameplay state.
- Gameplay mutations must use optimistic concurrency with `gameplayState.version`.
- Repeated inspect/dialogue actions must be idempotent.
- SignalR reconnect must be recoverable by refetching API state.
- MongoDB startup/index failures should be logged clearly.
- AI provider failure must not block the demo when mock fallback is available.

## Security

- JWT secret must be at least 32 characters.
- JWT validates issuer, audience, lifetime, and signing key.
- SignalR accepts JWT via query token only for `/hubs`.
- Public registration creates only `PLAYER`.
- Admin-only endpoints must stay protected by role authorization.
- Locked/deleted users cannot log in.
- Client route guards are not security boundaries.
- `.env` and generated outputs must not be committed.

## Performance

- Room reads should remain simple by embedding gameplay state in `gameRooms`.
- Action log returned in game state is capped at 40 entries.
- Do not add deep MongoDB indexes for nested case arrays until query patterns justify them.
- Frontend should update from `GameStateUpdated` snapshots rather than replaying every detail event as state.

## Maintainability

- Keep controller routes aligned with frontend API wrappers.
- Keep case JSON camelCase.
- Keep AI prompt sample synchronized with `GameCase` model.
- Keep validation stricter than frontend assumptions.
- Preserve concise services and avoid duplicating game rules in the frontend.

## Observability

- AI generation attempts are logged in `aiGenerationLogs`.
- Gameplay actions are logged in `gameActionLogs`.
- Startup logs include MongoDB/index/admin seed results.
- API errors use the common response envelope.

## Compatibility

- Local frontend origins:
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - `http://localhost:4173`
- Backend target framework: `net9.0`.
- Frontend package manager: npm.

## Data Integrity

- Unique indexes enforce user email, case ID, and room code.
- Case import validates references and playthrough reachability.
- Final evidence must be clue IDs with `isEvidence: true`.
- Clients must never submit replacement full gameplay state.
