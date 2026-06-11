# Implementation Plan

This plan is for a coding agent working in the existing repo. Implement a runnable MVP first.

## Suggested Timeline

This timeline assumes a small student/team project and prioritizes a playable demo.

| Week | Focus | Main output |
| --- | --- | --- |
| Week 1 | Repository review, environment, backend foundation | Backend/frontend run locally, MongoDB/JWT config verified |
| Week 2 | Case schema, validation, sample seed | `sample-case.json` validates and can be seeded/published |
| Week 3 | Room/lobby and SignalR baseline | Two players can create/join/select role/ready/start |
| Week 4 | Runtime gameplay backend | State, inspect item, ask dialogue, complete scene/stage, accuse |
| Week 5 | Gameplay frontend | Scene renderer, hotspots, dialogue, investigation notebook/map, objective/hints, final modal |
| Week 6 | Admin and AI MVP | Admin case tools, AI/mock draft generation, import/publish |
| Week 7 | Testing and polish | Two-browser E2E, reconnect test, README/demo walkthrough |

If time is shorter, merge Weeks 6-7 and keep AI as mock-only.

## Suggested Team Ownership

| Role | Responsibilities |
| --- | --- |
| Backend owner | Auth, MongoDB models, case validator, gameplay state service, API responses |
| Realtime owner | SignalR hub, room groups, event payloads, reconnect state sync |
| Frontend owner | Routes/pages, API client, gameplay renderer, responsive UI |
| Case/content owner | Sample case JSON, clue graph, red herrings, endings, AI prompt constraints |
| QA/docs owner | Test cases, manual E2E, README, deployment/config checks |

For a smaller team, one person can own multiple rows, but avoid splitting the case schema and validator across different people without frequent sync.

## Phase 1: Repository Review

- Inspect current backend and frontend.
- Identify existing models/services/controllers/routes.
- Do not rewrite working code.
- Note route names before adding new endpoints.

## Phase 2: Backend Foundation

- Ensure backend starts.
- Ensure MongoDB config works.
- Ensure JWT config works.
- Ensure Swagger/dev configuration works.
- Ensure `UserStatusMiddleware` still blocks locked/deleted users.

## Phase 3: Case Schema And Validation

- Extend `GameCase` model with gameplay fields if missing:
  - scene description
  - hotspots
  - complete condition
  - item inspect text
  - clue source
  - win/fail endings
- Extend validation rules.
- Enforce final evidence as clue IDs only.
- Validate clue flags: `isEvidence`, `isRedHerring`, `source`, `sourceType`.
- Validate hotspot and `completeCondition` references.
- Add unlock-chain reachability/cycle checks to avoid deadlocks.
- Keep backward compatibility with existing sample cases.

## Phase 4: Sample Playable Case

- Seed `The Locked Manor Ledger`.
- Include complete stages/scenes/items/characters/clues/dialogues/final logic.
- Ensure it validates.
- Ensure it can be published.
- Seed admin account if none exists:
  - `admin@sirlocked.local`
  - `Admin123!`
- Keep `ai-game-docs/samples/sample-case.json` in sync with the seeded sample shape.

## Phase 5: Room And Lobby

- Complete create/join/select-role/ready/start.
- Enforce max 2 players.
- Enforce non-duplicate roles.
- Enforce role actions for normal co-op rooms:
  - `INVESTIGATOR`: inspect item/hotspot actions.
  - `INTERROGATOR`: dialogue/interrogation actions.
- Broadcast SignalR lobby events.

## Phase 6: Runtime Gameplay Backend

- Create or complete authoritative runtime state.
- Implement:
  - get state
  - inspect item
  - ask dialogue
  - complete scene
  - accuse
- Save logs/results.
- Increment state version on every mutation.
- Broadcast gameplay events.
- On reconnect, clients must rejoin the hub group and fetch `GET /api/game/rooms/{roomId}/state`.

## Phase 7: Gameplay Frontend

- Build actual scene renderer.
- Render background and hotspots.
- Add case intro/briefing.
- Add item inspection panel.
- Add dialogue panel.
- Add investigation notebook/clue board.
- Add investigation map for current, visited, and unlocked scenes.
- Add player-facing investigation progress instead of prominent raw stage labels.
- Add current objective/hint panel from scene completion requirements.
- Add final accusation modal with review/confirm step.
- Add role-aware disabled states for investigator/interrogator actions.
- Add persistent action log for unlocks and realtime partner actions.
- Connect SignalR updates.
- Use `GameStateUpdated` or refetch state after detail events to avoid stale state.

## Phase 8: Admin MVP

- Dashboard counts.
- Case list.
- Case detail.
- Seed sample.
- Import JSON.
- Validate JSON.
- Publish/unpublish.

## Phase 9: AI Case Generator MVP

- Use existing Deepseek service if present.
- Generate one full `GameCase` JSON.
- Validate.
- Save draft.
- Export bundle.
- Add mock fallback.
- Add frontend admin page.

## Phase 10: Polish And Documentation

- Loading states.
- Clear errors.
- Placeholder images.
- README setup.
- Demo walkthrough.
- Run build/test commands.
- Document SignalR reconnect and demo flow.

## Test Scope

Minimum backend checks:

- Auth register/login/me.
- Admin seed sample.
- Case validation accepts `sample-case.json`.
- Case validation rejects duplicate IDs and missing references.
- Case validation rejects final evidence that is not a clue ID.
- Case validation rejects unreachable/cyclic unlock chains for required progress.
- Room create/join/select role/ready/start.
- Inspect item unlocks clue once.
- Locked dialogue fails until required clue is available.
- Scene completion returns missing requirements when incomplete.
- Correct accusation returns success.
- Wrong accusation returns fail result.
- SignalR reconnect refetches state and preserves current scene/clues.

Minimum frontend/manual E2E:

- Login as admin, seed/publish sample case.
- Login as player A, create room.
- Login as player B in another browser/session, join room.
- Select non-duplicate roles, ready, start.
- Inspect first scene item and see clue board update.
- Ask dialogue and see answer/unlock.
- Progress through game enough to submit final accusation.
- See result page.

## Priority Rule

If the project becomes too large, stop expanding scope and make the sample case playable from login to final result.
