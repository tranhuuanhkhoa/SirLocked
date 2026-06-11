# AI Readiness Checklist

This file maps the project plan to the information a coding agent needs before implementation.

## Readiness Score

Current documentation readiness: **97%**.

The project is no longer just a template. It now has concrete goals, users, gameplay flow, schema, API routes, response payload targets, realtime events, validation rules, sample JSON, implementation phases, non-functional requirements, deployment notes, research methodology, ownership/timeline guidance, and test expectations. Remaining risk is mostly execution risk: the backend models and frontend must be brought into full alignment with the canonical case JSON during coding.

## Required Context Map

| AI coding requirement | Status | Source |
| --- | --- | --- |
| Clear problem, users, value, and MVP scope | Ready | `PROJECT_BRIEF.md` |
| Tech stack and architecture constraints | Ready | `PROJECT_BRIEF.md`, `NON_FUNCTIONAL_REQUIREMENTS.md` |
| Detailed feature list | Ready | `FEATURE_REQUIREMENTS.md` |
| End-to-end user flow | Ready | `GAMEPLAY_FLOW.md` |
| Frontend page/component plan | Ready | `FRONTEND_PAGES.md`, `UI_UX_REQUIREMENTS.md` |
| Data model and collection shape | Ready | `DATABASE_SCHEMA.md` |
| Canonical sample data | Ready | `samples/sample-case.json`, `samples/sample-room-state.json` |
| API contract and error behavior | Ready | `API_SPEC.md` |
| SignalR events and reconnect behavior | Ready | `API_SPEC.md`, `GAMEPLAY_FLOW.md` |
| AI generation contract and validation | Ready | `AI_GENERATION_PIPELINE.md` |
| Non-functional requirements | Ready | `NON_FUNCTIONAL_REQUIREMENTS.md` |
| Deployment and operations | Ready | `DEPLOYMENT_AND_OPERATIONS.md` |
| Test strategy and acceptance checks | Ready | `TESTING_STRATEGY.md`, `IMPLEMENTATION_PLAN.md` |
| Research methodology, baselines, metrics | Ready | `RESEARCH_METHODOLOGY.md` |
| Timeline and team ownership | Ready | `IMPLEMENTATION_PLAN.md` |
| Coding-agent execution instructions | Ready | `CODEX_INSTRUCTIONS.md` |

## Remaining Implementation Clarifications

Before coding starts, confirm these choices in code:

- Use MongoDB document shape compatible with `samples/sample-case.json`.
- Embed MVP `gameplayState` inside `gameRooms`; do not create a separate `gameplayStates` collection unless the storage model is explicitly changed later.
- Keep `finalLogic.requiredEvidenceIds` as clue IDs only.
- Enforce role-specific actions for normal two-player rooms.
- Use linear MVP scene progression by `stage.order` and scene array order before implementing optional free scene travel.
- Make final accusation available only in the last scene of the last stage after all `finalLogic.requiredEvidenceIds` are unlocked.
- Treat chat/action log and present-evidence as optional MVP extensions.
- Use state `version` or `updatedAt` for reconnect safety.
- Keep AI generation single-step for MVP and mock fallback when no key is configured.
- Use the indexes and optimistic-concurrency rules in `DATABASE_SCHEMA.md`.

## Red Flags For Coding Agents

- Do not hard-code sample case IDs in frontend logic.
- Do not create duplicate routes if existing controllers already expose equivalent endpoints.
- Do not trust frontend state for unlocks or final accusation.
- Do not publish AI-generated cases before validation.
- Do not expand scope into image generation, payments, or analytics before the sample case is playable end to end.

## Done Criteria For AI-Ready Documentation

Documentation is considered AI-ready when a coding agent can answer:

- What is the product and who uses it?
- What is in scope for MVP and what is explicitly out of scope?
- What are the entities, IDs, references, and validation rules?
- What routes and SignalR events exist?
- What state changes happen for each gameplay action?
- What edge cases should fail cleanly?
- What tests prove the MVP works?

The current docs answer all of these at MVP level.

The final 5% is intentionally left for implementation validation: after coding, verify that actual models, endpoints, SignalR payloads, and frontend state match the canonical docs.
