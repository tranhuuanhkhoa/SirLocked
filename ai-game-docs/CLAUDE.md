# CLAUDE.md

You are Claude Code working as a senior full-stack coding agent inside this repository.

This is an implementation task, not only a planning discussion. Your goal is to build a runnable MVP for SirLocked, an AI-powered cooperative detective web game, by following the documentation in this folder.

## Source Of Truth

Read these files before making substantial changes:

- `PROJECT_BRIEF.md`
- `CODEX_INSTRUCTIONS.md`
- `IMPLEMENTATION_PLAN.md`
- `FEATURE_REQUIREMENTS.md`
- `GAMEPLAY_FLOW.md`
- `DATABASE_SCHEMA.md`
- `API_SPEC.md`
- `FRONTEND_PAGES.md`
- `UI_UX_REQUIREMENTS.md`
- `AI_GENERATION_PIPELINE.md`
- `NON_FUNCTIONAL_REQUIREMENTS.md`
- `DEPLOYMENT_AND_OPERATIONS.md`
- `TESTING_STRATEGY.md`
- `AI_READINESS_CHECKLIST.md`
- `samples/sample-case.json`

Treat `CODEX_INSTRUCTIONS.md` as the most detailed implementation contract. This `CLAUDE.md` is the quick-start instruction layer for Claude Code.

## Project Context

Expected main repository:

```txt
prn232-su26-ai-audit-project-prn232_se18d07_group-01
```

Expected backend:

```txt
src/BE
```

Expected frontend:

```txt
src/FE
```

Current stack:

- Backend: ASP.NET Core Web API, C#, MongoDB, SignalR, JWT.
- Frontend: React + Vite using JavaScript/JSX.
- Database: MongoDB.
- Realtime: SignalR.
- AI: Deepseek for case JSON generation, with mock fallback.

Do not migrate the frontend to TypeScript unless explicitly requested.

## Main MVP Goal

Build a playable 2-player cooperative detective demo:

1. Admin seeds/imports/validates/publishes a case.
2. Players register/login.
3. Player A creates a room from a published case.
4. Player B joins.
5. Players select non-duplicate roles and ready up.
6. Host starts the game.
7. Game renders a real point-and-click scene with hotspots.
8. Investigator inspects items and unlocks clues.
9. Interrogator asks dialogue and unlocks clues.
10. Players progress through scenes/stages.
11. Players submit a final accusation.
12. Backend returns win/fail result.

The game must feel like a continuous visual novel / point-and-click detective game, not disconnected CRUD screens.

## Implementation Order

Work in this order unless the existing code strongly suggests a safer path:

1. Inspect the current repo structure, backend, frontend, routes, models, services, and sample data.
2. Make `samples/sample-case.json` compatible with backend models and validation.
3. Complete backend case schema, validator, seed/import/publish flow.
4. Complete room create/join/select-role/ready/start.
5. Complete runtime gameplay APIs: state, inspect item, ask dialogue, complete scene/stage, accuse.
6. Add SignalR lobby/gameplay sync and reconnect behavior.
7. Build frontend gameplay renderer from backend data without hard-coded sample IDs.
8. Complete admin case tools.
9. Complete AI case generator with Deepseek if configured and mock fallback if not.
10. Update README and run available verification commands.

Prioritize the playable demo over advanced AI/image features.

## Guardrails

Do:

- Inspect existing code before editing.
- Preserve working behavior.
- Extend existing models/controllers/services instead of creating duplicate routes.
- Keep controllers thin and business rules in services.
- Use DTOs for API boundaries.
- Validate server-side.
- Keep API errors clear and consistent.
- Keep sample case, backend validation, AI output, and frontend renderer compatible.
- Run backend/frontend builds or tests when available.

Do not:

- Rewrite the whole project.
- Migrate frameworks.
- Add unrelated features such as VIP, payments, analytics, leaderboards, replay, ratings, or subscriptions for MVP.
- Hard-code sample case IDs, scene IDs, clue IDs, item IDs, dialogue IDs, or character IDs in frontend logic.
- Publish generated or imported cases before deterministic validation passes.
- Require real image generation or Cloudinary for MVP.
- Store real secrets in code or docs.

## Required Demo Case

The canonical sample case is:

```txt
The Locked Manor Ledger
```

It should include:

- 3 or 4 stages.
- 4 to 6 scenes.
- 4 to 5 characters.
- 8 to 10 items.
- 10 to 12 clues.
- 10 to 16 dialogues.
- Clear culprit, motive, method, final evidence, win ending, and fail ending.
- Placeholder image URLs.
- Hotspot coordinates.
- Scene/stage completion logic.

## Definition Of Done

The MVP is done when:

- Backend starts.
- Frontend starts.
- MongoDB connection works.
- User can register/login.
- Admin account exists or can be seeded.
- Admin can seed and publish the sample case.
- Player can see published cases.
- Two players can create/join a room.
- Players can select roles, ready up, and start.
- Game page renders scene background and hotspots.
- Item inspection unlocks clues.
- Dialogue respects clue requirements and can unlock clues.
- Scene/stage progression works.
- Final accusation produces win/fail result.
- AI case creator can produce a valid mock or Deepseek draft.
- README explains setup and demo walkthrough.

After changes, report:

- What was implemented.
- What commands were run.
- What passed or failed.
- Any remaining manual demo steps.

