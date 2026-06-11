# AI Readiness Checklist

Last synced with code: 2026-06-12.

Use this before relying on generated cases in a demo.

## Environment

- `.env` exists at repository root.
- `Jwt__Secret` is at least 32 characters.
- MongoDB is reachable.
- `AI__DeepseekApiKey` is set only when a real provider call is desired.
- `AI__DeepseekBaseUrl` is `https://api.deepseek.com` unless testing another compatible endpoint.
- `src/BE/GeneratedCaseJson/` is writable and ignored by git.

## Prompt Quality

- The prompt describes the setting, crime, suspects, culprit, method, motive, and red herring direction.
- Requested stage count is realistic for the demo.
- Visual style is concise and reusable for asset prompts.

## Generated JSON Must Pass

- Valid JSON object, no markdown wrapper after cleanup.
- Required top-level fields exist.
- Status is `DRAFT`.
- Stage orders are unique.
- Every scene has at least one reachable completion path.
- Every item reference exists.
- Every character reference exists.
- Every hotspot target exists.
- Hotspot coordinates are percentage values.
- Every clue source exists and matches `sourceType`.
- Every clue is unlocked by an item or dialogue.
- Final culprit is a character.
- Final evidence IDs are clue IDs, not item IDs.
- Final evidence clues set `isEvidence: true`.
- Final evidence is discoverable before the accusation.

## Backend Checks Already Implemented

- Duplicate ID rejection.
- Missing reference rejection.
- Invalid hotspot type/coordinate rejection.
- Invalid complete condition rejection.
- Final evidence item-ID rejection.
- Missing final evidence flag rejection.
- Greedy reachability simulation.
- Orphan clue rejection.
- Deepseek retry with validation feedback.
- Deepseek-to-mock fallback for demo reliability.

## Manual Review

Before publishing an AI draft, admin should check:

- story makes sense,
- culprit is not obvious too early,
- required evidence explains motive and method,
- red herrings are explainable,
- clue names are readable to players,
- image paths are placeholder-safe,
- estimated minutes is appropriate.

## Publish Gate

Do not publish when:

- validation errors exist,
- generated JSON is empty,
- final accusation cannot be reached,
- required evidence is vague or unrelated,
- the case depends on image assets that do not exist and the UI cannot tolerate placeholders.
