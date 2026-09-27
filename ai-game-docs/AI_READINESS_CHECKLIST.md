# AI Readiness Checklist

Last synced with code: 2026-06-14.

Use this before relying on generated cases in a demo.

## Environment

- `.env` exists at repository root.
- `Jwt__Secret` is at least 32 characters.
- MongoDB is reachable.
- `OpenAI__ApiKey` is set through local `.env` or deployment secrets.
- `OpenAI__BaseUrl` is `https://api.openai.com/v1` unless testing a compatible gateway.
- `OpenAI__LogicModel` and `OpenAI__ImageModel` match the intended deployment models.
- `src/BE/GeneratedCaseJson/` is writable and ignored by git.
- `src/FE/public/assets/ai-generated/` is writable and ignored by git-generated review rules if needed.

## Prompt Quality

- The prompt describes the setting, crime, suspect pool, tone, and red herring direction.
- The story preview does not reveal culprit, method, solution, or final evidence.
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

## Generated Assets And Runtime Must Pass

- Cover, scene background, item, character portrait, and character sprite files exist.
- Generated URLs start with `/assets/ai-generated/{caseId}/`.
- Scene backgrounds do not contain baked-in NPCs or evidence items.
- Item/character images have no UI frame or visible label.
- Each scene has `runtime.width`, `runtime.height`, `spawnPoints`, item placements, character placements, and transition zones where applicable.
- Runtime coordinates pass `CaseValidationService`.
- In the game, background loads full screen and item/NPC overlays appear in plausible places.

## Backend Checks Already Implemented

- Duplicate ID rejection.
- Missing reference rejection.
- Invalid hotspot type/coordinate rejection.
- Invalid complete condition rejection.
- Final evidence item-ID rejection.
- Missing final evidence flag rejection.
- Greedy reachability simulation.
- Orphan clue rejection.
- OpenAI repair pass for unparseable JSON.
- OpenAI retry with validation feedback.

## Manual Review

Before approving the story preview, the creator should check:

- story makes sense,
- it does not expose the culprit or solution,
- locations fit the intended map count,
- suspect teasers are playable,
- tone matches the requested scenario.

After automatic publish, admin can still review:

- culprit is not obvious too early,
- required evidence explains motive and method,
- red herrings are explainable,
- clue names are readable to players,
- image paths are placeholder-safe,
- runtime item/NPC placement matches the generated background,
- estimated minutes is appropriate.

## Publish Gate

Do not publish when:

- validation errors exist,
- generated JSON is empty,
- final accusation cannot be reached,
- required evidence is vague or unrelated,
- the case depends on image assets that do not exist and the UI cannot tolerate placeholders.
