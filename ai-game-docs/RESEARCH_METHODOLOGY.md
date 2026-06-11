# Research Methodology

Last synced with code: 2026-06-12.

## Purpose

Research for this project should support a working cooperative detective game MVP. Prefer evidence that helps validate:

- data-driven case design,
- two-player role split,
- clue reachability,
- realtime room sync,
- AI-generated content quality,
- player comprehension of evidence and accusation flow.

## Evaluation Questions

1. Can two players understand their distinct roles without explanation outside the UI?
2. Can players progress through a case without deadlocking?
3. Does the clue/evidence distinction make sense?
4. Does final accusation require enough evidence to feel earned?
5. Can AI-generated cases pass strict validation and still read coherently?
6. Does realtime state recover after refresh/reconnect?

## Current Evidence Sources

- Backend validation rules in `CaseValidationService`.
- Canonical sample case in `src/BE/SeedData/sample-case.json`.
- Backend xUnit tests.
- End-to-end API smoke test.
- Manual two-browser playthrough.
- AI generated draft validation results.

## Test Method

For each demo case:

1. Validate JSON through admin endpoint.
2. Publish the case.
3. Run a two-player playthrough with separate browser sessions.
4. Record points where players are unsure what to do.
5. Confirm no frontend-only action bypasses backend rules.
6. Confirm wrong and correct accusations produce expected endings.

## AI Case Review Rubric

Score generated cases on:

- structural validity,
- reachability,
- clue clarity,
- suspect differentiation,
- red herring quality,
- final evidence relevance,
- dialogue usefulness,
- estimated play length.

## Metrics Worth Tracking Later

- time to create/join/start room,
- number of failed complete-scene attempts,
- number of locked hotspot/dialogue attempts,
- time to final accusation,
- win/fail ratio,
- AI draft validation failure reasons.

## Current Limitations

- No formal user study.
- No analytics collection.
- No automated browser journey.
- No qualitative survey built into app.

For this MVP, manual observation plus strict validation is enough.
