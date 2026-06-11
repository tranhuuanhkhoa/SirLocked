# Research Methodology And Evaluation Metrics

This project is primarily an implementation MVP, but the team can still evaluate it with a lightweight research methodology.

## Research Questions

1. Can a structured JSON case drive a complete cooperative detective game without hard-coded frontend scene logic?
2. Does role separation between `INVESTIGATOR` and `INTERROGATOR` improve co-op coordination compared with cosmetic roles?
3. Can single-step AI generation plus deterministic validation produce importable case drafts?
4. Does state versioning and refetch-on-reconnect keep two clients synchronized during gameplay?

## Dataset

Primary dataset:

- `ai-game-docs/samples/sample-case.json`
- `ai-game-docs/samples/sample-room-state.json`
- `ai-game-docs/samples/sample-final-accusation.json`
- `ai-game-docs/samples/sample-ai-request.json`

Generated dataset:

- AI/mock generated `GameCase` JSON files saved under `src/BE/GeneratedCaseJson`.
- Invalid AI outputs saved under `GeneratedCaseJson/_invalid-ai`.

Manual test dataset:

- At least one successful final accusation run.
- At least one failed final accusation run.
- At least one reconnect/browser refresh during active gameplay.
- At least one invalid imported case for validator testing.

## Baselines

Use these baselines to compare implementation quality:

- Static CRUD baseline: case list/detail/admin screens without playable scene logic.
- Single-player baseline: one user can inspect and ask everything without role separation.
- No-reconnect baseline: clients rely only on SignalR events and do not refetch authoritative state.
- No-validator baseline: imported case JSON is accepted without reference/deadlock validation.

SirLocked MVP should outperform these baselines by demonstrating playable co-op, server-authoritative validation, and reconnect-safe state.

## Metrics

AI-readiness metrics:

- Documentation coverage: all checklist rows in `AI_READINESS_CHECKLIST.md` marked ready.
- Contract consistency: no conflicting route names, event names, or evidence reference rules across docs.
- Sample validity: all JSON samples parse and match documented schema.

Gameplay metrics:

- Time to complete sample case in demo: 20-40 minutes target.
- Gameplay action latency: under 1 second in local/demo environment.
- Reconnect recovery: client refetches correct state after refresh/reconnect.
- State consistency: both clients show same current scene, clue IDs, and completion status.
- Idempotency: repeated inspect/dialogue actions do not duplicate clues.

AI generation metrics:

- Mock fallback success rate: 100% valid draft when no API key is configured.
- AI valid output rate: percentage of provider outputs passing deterministic validation.
- Invalid output capture rate: 100% of invalid provider outputs saved for debugging.

Testing metrics:

- Backend build passes.
- Frontend build passes.
- Case validator accepts canonical sample.
- Minimum E2E demo path passes in two browsers.

## Evaluation Procedure

1. Validate documentation consistency with keyword scans and JSON parsing.
2. Build backend and frontend.
3. Seed/publish the sample case.
4. Run the two-player manual E2E demo from `TESTING_STRATEGY.md`.
5. Test reconnect by refreshing one browser after at least one clue unlock.
6. Submit correct and incorrect final accusations.
7. Generate or mock an AI case draft and validate before import.
8. Record failures as implementation defects or documentation gaps.

## Acceptance Threshold

The MVP is successful when:

- All required docs are present and consistent.
- Sample case validates and plays from login to result.
- Two clients stay synchronized through normal gameplay and reconnect.
- AI generation has a valid mock fallback.
- Critical tests in `TESTING_STRATEGY.md` pass or have documented known issues.
