# CODEX INSTRUCTIONS

You are a senior full-stack coding agent working inside an existing repository.

This is a coding task, not an architecture discussion. Implement a runnable MVP in the current repo. Do not rewrite the whole project. Do not migrate frameworks broadly. Inspect the existing code first, preserve working behavior, and extend the current patterns.

## Repository Context

Main project folder:

```txt
prn232-su26-ai-audit-project-prn232_se18d07_group-01
```

Backend root:

```txt
src/BE
```

Frontend root:

```txt
src/FE
```

Current stack:

- Backend: ASP.NET Core Web API, C#, MongoDB, SignalR, JWT.
- Frontend: React-free Vite JavaScript SPA, with Phaser 4 + TypeScript for the gameplay renderer.
- Database: MongoDB.
- Realtime: SignalR.
- AI: Deepseek for case JSON generation.
- Image/storage providers may exist as placeholders. Real image generation and Cloudinary are optional for MVP.

Do not migrate the whole frontend to TypeScript unless explicitly requested. TypeScript is currently used only for the Phaser gameplay renderer.

## Before Coding

Inspect:

```txt
README.md
docker-compose.yml
ai-game-docs/PROJECT_BRIEF.md
ai-game-docs/FEATURE_REQUIREMENTS.md
ai-game-docs/GAMEPLAY_FLOW.md
ai-game-docs/DATABASE_SCHEMA.md
ai-game-docs/API_SPEC.md
ai-game-docs/FRONTEND_PAGES.md
ai-game-docs/UI_UX_REQUIREMENTS.md
ai-game-docs/AI_GENERATION_PIPELINE.md
ai-game-docs/NON_FUNCTIONAL_REQUIREMENTS.md
ai-game-docs/DEPLOYMENT_AND_OPERATIONS.md
ai-game-docs/TESTING_STRATEGY.md
ai-game-docs/RESEARCH_METHODOLOGY.md
ai-game-docs/AI_READINESS_CHECKLIST.md
src/BE/Program.cs
src/BE/appsettings.json
src/BE/appsettings.Development.json
src/BE/Models
src/BE/DTOs
src/BE/Controllers
src/BE/Services
src/BE/Repositories
src/BE/Hubs
src/FE/Client/js/main.js
src/FE/Client/js/pages
src/FE/Client/js/api
src/FE/Client/js/services
src/FE/css/09-app.css
```

The project already has parts of auth, case management, room flow, gameplay, SignalR, AI draft generation, and generated JSON export. Extend those pieces. Do not create duplicate controllers/routes when an existing one can be completed.

## Main Goal

Build a playable MVP for an AI-powered cooperative detective web game.

The platform must allow:

1. Admin seeds/imports/publishes a case.
2. Player sees published cases.
3. Player creates a room from a case.
4. Second player joins.
5. Players select roles and ready up.
6. Host starts the game.
7. Game renders a real point-and-click scene.
8. `INVESTIGATOR` inspects hotspots/items.
9. Items unlock clues.
10. `INTERROGATOR` talks to characters.
11. Dialogue respects clue requirements and unlocks clues.
12. Players progress through scenes/stages.
13. Players make final accusation.
14. Backend validates final accusation.
15. Result page shows win/fail ending.

The game must not feel like isolated CRUD screens. It must feel like a continuous visual novel / point-and-click detective game.

## MVP Priority

Implement in this order:

1. Fix/complete backend data model and validation.
2. Add/complete sample playable case.
3. Complete runtime gameplay APIs.
4. Complete room flow and SignalR sync.
5. Build frontend gameplay renderer with background, hotspots, characters, dialogue, clues.
6. Complete admin case management: seed, import, validate, publish/unpublish.
7. Complete AI JSON generation with Deepseek and mock fallback.
8. Update README and run verification.

If time is limited, prioritize the playable demo over advanced AI/image features.

## Implementation Guardrails

Do first:

1. Make `ai-game-docs/samples/sample-case.json` validate against the backend model and validator.
2. Make backend gameplay APIs work against `sample-case.json`.
3. Make the two-player room flow work from create/join through start.
4. Make the frontend render the sample case from backend data without hard-coded sample IDs.
5. Only then add AI generation, admin polish, optional logs, or optional navigation features.

Do not:

- create or use a separate `gameplayStates` collection for MVP; embed `gameplayState` inside `gameRooms`
- hard-code sample case IDs, scene IDs, clue IDs, item IDs, or dialogue IDs in frontend logic
- implement free scene navigation before linear scene progression works
- implement real image generation or Cloudinary upload before the playable loop works
- add VIP, payment, analytics, leaderboard, ratings, or replay systems for MVP
- publish generated or imported cases before deterministic validation succeeds

## Non-Goals For MVP

Do not block MVP on:

- real AI image generation
- Cloudinary upload
- multi-step AI pipeline
- AI validator using another LLM
- whole-frontend TypeScript migration
- complex animations
- full production-grade admin portal
- refresh token rotation unless already implemented

Use placeholders when needed.

## Roles

Required:

- `PLAYER`
- `ADMIN`

Optional existing roles such as `HOST` may remain if already used.

For MVP, AI case generation can be admin-only. Do not add `VIP` unless it is easy and does not break existing auth/role code.

Public registration must create `PLAYER` only.

Seed an admin account if none exists:

```txt
Email: admin@sirlocked.local
Password: Admin123!
Role: ADMIN
```

## Case JSON Schema

Use/extend the existing backend `GameCase` model. Keep property names compatible with the current C# model.

Do not use generic `id` fields for core entities. Use:

- `caseId`
- `stageId`
- `sceneId`
- `characterId`
- `itemId`
- `clueId`
- `dialogueId`

If the current model lacks fields such as `hotspots`, `completeCondition`, `inspectText`, `description`, `coverImageUrl`, `winEnding`, or `failEnding`, add them in a backward-compatible way.

## Sample Playable Case

Seed at least one complete case:

```txt
The Locked Manor Ledger
```

Requirements:

- 3 or 4 stages.
- 4 to 6 scenes.
- 4 to 5 characters.
- 8 to 10 items.
- 10 to 12 clues.
- 10 to 16 dialogues.
- Clear culprit.
- Clear motive.
- Clear method.
- Required final evidence.
- Win ending and fail ending.
- Placeholder image URLs.
- Hotspot coordinates for each scene.
- Scene/stage completion logic.

The case must be playable from start to finish.

## Validation Requirements

Validate:

- required fields exist
- no duplicate IDs
- scene item IDs exist
- scene character IDs exist
- hotspot target IDs exist
- hotspot required clue IDs exist
- item unlock clue IDs exist
- dialogue character ID exists
- dialogue required/unlocked clue IDs exist
- final culprit ID exists
- final required evidence IDs exist as clue IDs only
- final evidence clues set `isEvidence: true`
- red herring clues set `isRedHerring: true`
- final required evidence is discoverable through item or dialogue unlocks
- scene complete condition IDs exist
- unlock chains do not contain cycles that can block required progress
- first stage is reachable
- stage order is valid

Return clear validation errors. Do not publish invalid cases.

Use `ai-game-docs/samples/sample-case.json` as the canonical MVP example for the `GameCase` JSON shape. Keep backend validation, sample seed data, AI prompt output, and frontend renderer compatible with that file.

## Backend API Requirements

Prefer existing routes if already implemented. Avoid duplicate equivalent endpoints.

Auth:

```txt
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me
POST /api/auth/logout
```

Cases:

```txt
GET /api/cases/published
GET /api/cases/{caseId}
GET /api/admin/cases
GET /api/admin/cases/{caseId}
POST /api/admin/cases/import-json
POST /api/admin/cases/validate
PATCH /api/admin/cases/{caseId}/publish
PATCH /api/admin/cases/{caseId}/unpublish
POST /api/admin/cases/seed-sample
POST /api/admin/cases/seed-demo
```

Rooms:

```txt
POST /api/rooms
POST /api/rooms/join
GET /api/rooms/{roomId}
POST /api/rooms/{roomId}/leave
POST /api/rooms/{roomId}/select-role
POST /api/rooms/{roomId}/ready
POST /api/rooms/{roomId}/start
```

Gameplay:

```txt
GET /api/game/rooms/{roomId}/state
POST /api/game/rooms/{roomId}/inspect-item
POST /api/game/rooms/{roomId}/ask-dialogue
POST /api/game/rooms/{roomId}/present-evidence
POST /api/game/rooms/{roomId}/complete-scene
POST /api/game/rooms/{roomId}/complete-stage
POST /api/game/rooms/{roomId}/go-to-scene
POST /api/game/rooms/{roomId}/accuse
```

AI:

```txt
POST /api/admin/ai-cases
```

If feasible:

```txt
GET /api/admin/ai-cases
GET /api/admin/ai-cases/{draftId}
POST /api/admin/ai-cases/{draftId}/import
POST /api/admin/ai-cases/{draftId}/publish
```

## Error Handling Rules

Use the existing API response wrapper if present.

Expected behavior:

- Invalid request or state transition: `400`.
- Missing/invalid JWT: `401`.
- Non-admin or non-room-player action: `403`.
- Missing case/room/item/dialogue/character: `404`.
- Duplicate role, full room, duplicate case ID: `409`.
- Case validation failure: `400` or `422`, but include all validation errors.
- AI provider failure: `502`.
- Repeated inspect/dialogue actions should be idempotent where reasonable and must not duplicate clues/logs.
- Wrong final accusation should produce a fail game result, not a server error.
- Locked dialogue/hotspot responses should include missing required clue IDs.

## SignalR Requirements

Use existing hub if available:

```txt
/hubs/game
```

Lobby events:

- `PlayerJoined`
- `PlayerLeft`
- `RolesUpdated`
- `ReadyUpdated`
- `GameStarted`
- `RoomMessageReceived`, optional after core lobby/gameplay sync
- `RoomError`

Gameplay events:

- `GameStateUpdated`
- `SceneChanged`
- `ItemFound`
- `ClueUnlocked`
- `DialogueAnswered`
- `EvidencePresented`
- `StageChanged`
- `GameCompleted`
- `SystemMessageReceived`

Reconnect:

- Client should call `JoinRoom(roomId)` after reconnect.
- Client should then call `GET /api/game/rooms/{roomId}/state` and replace local gameplay state.
- Use state `version` from API/events to detect stale or out-of-order updates.

## Frontend Requirements

Use the existing Vite JavaScript module app for app screens. Use Phaser 4 + TypeScript for the gameplay renderer.

Required pages or equivalent existing pages:

- Login page
- Register page
- Published case list page
- Case detail page
- Create/join room page
- Room lobby page
- Game page
- Result page
- Admin dashboard
- Admin case list/detail
- Admin import JSON
- AI case creator page

Game page must render:

- scene background on the Phaser canvas
- hotspots rendered by percent coordinates on the Phaser canvas
- clickable item hotspots
- character interactables or fallback canvas figures
- dialogue HTML overlay
- item inspection HTML overlay
- clue inventory/evidence board
- current objective/hint panel
- stage/scene progress
- room chat or action log, optional after core gameplay is stable
- final accusation modal/form

Frontend must not hard-code the sample case. It must render any valid case JSON from the backend.

Recommended gameplay layout:

```txt
Top: case title, progress, room code, players
Center: Phaser scene canvas with background, hotspots, characters, and scene navigation
Right/bottom overlays: case file, map, log, dialogue, item inspection
Bottom: inventory bar
Modal: final accusation
```

Accessibility:

- Keep dark detective UI readable with sufficient contrast.
- Hotspots need labels/tooltips.
- Important unlock messages must appear in both toast/notice and action log.
- Major controls should be keyboard reachable.

## AI Case Generator Rules

- Admin-only for MVP.
- Use Deepseek if configured.
- If no Deepseek key, return validated mock fallback.
- Strip markdown code fences from AI response.
- Parse into `GameCase`.
- Force generated case status to `DRAFT`.
- Validate before saving/importing.
- Save invalid AI attempts to `GeneratedCaseJson/_invalid-ai`.
- Save valid draft to MongoDB.
- Export JSON bundle to `src/BE/GeneratedCaseJson/{timestamp}-{caseId}-{draftId}`.
- Do not publish invalid AI case.

## Configuration

Support existing ASP.NET config style:

```txt
MongoDb__ConnectionString
MongoDb__DatabaseName
Jwt__Secret
Jwt__Issuer
Jwt__Audience
AI__DeepseekApiKey
AI__DeepseekModel
AI__DeepseekTimeoutSeconds
AI__GeminiApiKey
AI__ChatGptApiKey
Cloudinary__CloudName
Cloudinary__ApiKey
Cloudinary__ApiSecret
```

JWT secret must be at least 32 characters.

If optional AI/image config is missing, the app must still run.

## Code Quality Rules

- Keep changes scoped and practical.
- Use existing patterns.
- Avoid unrelated refactors.
- Avoid duplicate route definitions.
- Keep controllers thin.
- Put business rules in services.
- Use DTOs for API requests/responses.
- Validate input server-side.
- Return consistent API responses.
- Add clear error messages.
- Preserve user changes.
- Do not commit secrets.
- Do not hard-code real API keys.
- Do not rely on frontend for security/game rules.

## README Requirements

Update `README.md` with:

- Required tools.
- How to run MongoDB.
- How to configure backend.
- How to configure JWT.
- Optional AI and Cloudinary keys.
- How to run backend.
- How to run frontend.
- How to seed sample/demo cases.
- Demo admin account.
- Full demo walkthrough.
- AI fallback behavior when no API key is configured.

## Documentation Requirements

Keep these docs synchronized when changing scope or contracts:

- `PROJECT_BRIEF.md`: product goal, users, value, MVP scope.
- `FEATURE_REQUIREMENTS.md`: feature behavior and edge cases.
- `GAMEPLAY_FLOW.md`: player/gameplay sequence and role responsibilities.
- `DATABASE_SCHEMA.md`: MongoDB document shape and validation rules.
- `API_SPEC.md`: routes, payloads, errors, SignalR events, reconnect.
- `FRONTEND_PAGES.md`: page/component responsibilities and state management.
- `UI_UX_REQUIREMENTS.md`: gameplay layout, clue board, objective/hints, accessibility.
- `AI_GENERATION_PIPELINE.md`: AI prompt/output/validation/bundle rules.
- `NON_FUNCTIONAL_REQUIREMENTS.md`: security, performance, reliability, observability.
- `DEPLOYMENT_AND_OPERATIONS.md`: config, CI checks, deployment, backup.
- `TESTING_STRATEGY.md`: unit, integration, SignalR, frontend, E2E, AI tests.
- `RESEARCH_METHODOLOGY.md`: dataset, baselines, metrics, evaluation procedure.
- `AI_READINESS_CHECKLIST.md`: readiness summary and source map for AI coding.

## Test Expectations

At minimum, verify:

- Backend builds.
- Frontend builds.
- Sample case JSON parses.
- Case validation accepts the sample case.
- Case validation rejects missing references.
- Room create/join/start works.
- Inspect item unlocks clue.
- Dialogue respects required clues.
- Final accusation returns win/fail correctly.

## Definition Of Done

The MVP is done only when this works:

1. Backend starts.
2. Frontend starts.
3. MongoDB connection works.
4. User can register/login.
5. Admin account exists or can be seeded.
6. Admin can seed sample case.
7. Admin can publish sample case.
8. Player can see published case.
9. Player A creates room.
10. Player B joins room.
11. Players select non-duplicate roles.
12. Players ready up.
13. Host starts game.
14. Game page renders a scene with background and hotspots.
15. Inspecting an item unlocks clue.
16. Asking dialogue respects required clues.
17. Dialogue can unlock clue.
18. Scene/stage can progress.
19. Final accusation can be submitted.
20. Correct accusation produces win ending.
21. Wrong accusation produces fail ending.
22. AI case creator can generate valid mock or Deepseek case JSON.
23. Generated AI case can be imported/published.
24. README explains how to run and demo.

After coding, run available build/test commands and report what passed or failed.
