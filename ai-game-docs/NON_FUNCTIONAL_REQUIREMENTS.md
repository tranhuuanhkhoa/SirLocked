# Non-Functional Requirements

These requirements keep the MVP implementable while making the project clear enough for AI-assisted coding.

## Architecture

- Use the existing monolith-style ASP.NET Core Web API backend and Vite frontend. App screens remain JavaScript modules; gameplay rendering uses Phaser 4 + TypeScript.
- Keep the backend as the authority for auth, room membership, role permissions, clue unlocks, scene completion, and accusation results.
- Keep MongoDB as the primary database for MVP because the case schema is document-oriented.
- Use SignalR only for realtime synchronization; HTTP APIs remain the source of truth after reconnect or refresh.
- Avoid microservices for MVP.

## Performance

- Published case list should load within 2 seconds on a normal local/dev environment.
- Gameplay actions such as inspect item, ask dialogue, complete scene, and accuse should return within 1 second under normal demo load.
- SignalR events should broadcast after the database state is updated.
- Case JSON should stay small enough for direct API delivery in MVP. If cases become large, split state responses into summary and detail later.

## Scalability

- MVP target is classroom/demo scale: a small number of rooms and two players per room.
- Use indexes for `users.email`, `gameCases.caseId`, `gameRooms.roomCode`, and room/case result lookups.
- If scaling beyond MVP, add horizontal app instances, SignalR backplane/Azure SignalR, cache published case metadata, and split long-lived action logs from room state.

## Security

- Use JWT for protected APIs.
- Public registration must always create `PLAYER`; clients must never choose `ADMIN`.
- Admin routes must require `ADMIN`.
- Locked/deleted users must be blocked by middleware.
- JWT secret must be at least 32 characters and must not be committed.
- Store API keys in user secrets or environment variables.
- Validate all gameplay actions server-side, even if the UI hides locked actions.
- Never trust frontend state for clue unlock, scene completion, role permission, or final accusation.

## Reliability

- Gameplay mutations should be idempotent where practical:
  - inspecting an already inspected item should not duplicate clues
  - asking an already asked dialogue should not duplicate clues
  - repeated SignalR events should not corrupt client state
- Runtime state should include `version` or `updatedAt`.
- Clients must refetch authoritative state after reconnect.
- Invalid AI output must be saved for debugging and must not be imported or published.

## Observability

- Log auth failures, validation failures, AI provider failures, and gameplay state transition failures.
- For MVP, console/app logs are enough.
- Action logs and room chat are optional product features, not required for operational logging.
- Return clear API error messages with enough context for debugging, but do not expose secrets.

## Data Retention

- Keep users, cases, rooms, results, and AI drafts in MongoDB.
- Keep generated AI JSON bundles under `src/BE/GeneratedCaseJson` during local/dev MVP.
- Do not rely on generated local files as the only database source after import.
- Future production deployment should move generated files/assets to object storage.

## Accessibility

- Hotspots need labels/tooltips.
- Important unlock/progress messages should be visible in persistent UI, not only transient toasts.
- Keyboard navigation should reach core gameplay actions.
- Text must remain readable on common laptop screen sizes.
