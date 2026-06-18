# AI Generation Pipeline

Last synced with code: 2026-06-14.

> Note: the code now uses separate full-logic, scene-layout, and final-asset
> approval gates. See `CURRENT_CASE_AND_GAME_FLOW_VI.md` for the code-synced
> flow as of 2026-06-18.

Current implementation lives in `AiCaseService`, `CaseAutoRepair`, and `CaseValidationService`.

The active code path is OpenAI-only. The creator first approves a spoiler-free story preview. Only after approval does the backend generate the culprit, clue graph, final logic, full case JSON, validation, import, and publish.

## Access Control

- `POST /api/admin/ai-cases`: `ADMIN` or `VIP`; creates the story preview only.
- `POST /api/admin/ai-cases/{draftId}/approve`: `ADMIN` or `VIP`; generates the full case and publishes it automatically.
- Draft listing/detail and legacy import endpoints remain `ADMIN` only.

## Configuration

```env
OpenAI__ApiKey=
OpenAI__LogicModel=gpt-5.5
OpenAI__ImageModel=gpt-image-2
OpenAI__BaseUrl=https://api.openai.com/v1
OpenAI__TimeoutSeconds=900
```

`OpenAI__ApiKey` is required for AI case creation. Real keys must stay in local `.env` files or deployment secrets.

## Input

```json
{
  "prompt": "A jewel heist during a thunderstorm at the observatory",
  "stageCount": 4,
  "difficulty": "medium"
}
```

Defaults:

- `prompt`: optional; when blank, OpenAI invents an original case or uses loose public-domain mystery inspiration
- `stageCount`: `4`
- `difficulty`: `medium`
- visual style is not creator-controlled; all assets use the fixed SirLocked Victorian gaslight chibi pixel-art contract

## Step 1: Story Preview

`POST /api/admin/ai-cases` inserts an `AiCaseDraft`, calls OpenAI, and stores `storyPreview`.

The preview JSON contains:

- `title`
- `summary`
- `setting`
- `openingIncident`
- `tone`
- `playerPromise`
- `estimatedScenes`
- `keyLocations`
- `suspectTeasers`

Preview rules:

- No culprit.
- No method.
- No solution.
- No final evidence.
- Only player-facing premise and vibe.

The draft status becomes `STORY_AWAITING_APPROVAL`.

## Step 2: Approve And Publish

`POST /api/admin/ai-cases/{draftId}/approve` only accepts drafts in `STORY_AWAITING_APPROVAL`.

The backend then:

1. Calls OpenAI to generate a full `GameCase` JSON object.
2. Strips markdown fences if present.
3. Parses JSON into `GameCase`.
4. Forces status to `DRAFT`.
5. Fills missing `caseId` with `case-ai-{timestamp}`.
6. Runs deterministic `CaseAutoRepair`.
7. Validates through `CaseValidationService`.
8. Retries once with validation feedback if needed.
9. Generates cover art and normalized `1600x900` scene backgrounds.
10. Uses OpenAI vision over each background and scene JSON to create `scene.placementPlan`.
11. Generates scene-specific NPC sprites and item cutouts using the full background, a placement-area crop, and the placement metadata as image references.
12. Removes white backgrounds, verifies alpha, and rejects unusable cutouts.
13. Uses OpenAI vision again only to verify scale/alignment within the original slot.
14. Builds `scene.runtime` from the placement plan with final corrections limited to `±40px` and `80%..120%` scale.
15. Writes generated files under `src/FE/public/assets/ai-generated/v3-placement-first/{caseId}/`.
16. Re-validates the case after image URLs and runtime metadata are attached.
17. Saves invalid attempts under `GeneratedCaseJson/_invalid-ai`.
18. Exports valid bundles under `src/BE/GeneratedCaseJson/{timestamp}-{caseId}-{draftId}`.
19. Imports the valid JSON with overwrite enabled.
20. Publishes the imported case.
21. Updates the draft status to `PUBLISHED` and sets `importedCaseId`.

## Full Case Contract

OpenAI is instructed to output exactly one JSON object using the current `GameCase` shape:

- `caseId`, `title`, `summary`, `status`, `estimatedMinutes`, `coverImageUrl`
- `stages` with scenes and hotspots
- `characters`
- `items`
- `clues`
- `dialogues`
- `finalLogic`

Important constraints:

- IDs use type prefixes such as `case-`, `stage-`, `scene-`, `char-`, `item-`, `clue-`, `dlg-`, `hotspot-`.
- Every item appears in exactly one scene and has one `ITEM` hotspot.
- Every scene character has a `CHARACTER` hotspot.
- Every clue is unlocked by an item or dialogue.
- Dialogue/hotspot/scene requirements must be reachable in linear play order.
- Final evidence IDs are clue IDs with `isEvidence: true`.
- Status is always `DRAFT` before import/publish.

## Export Bundle

Valid drafts write:

- `case.json`
- `manifest.json`
- `stages.json`
- `scenes.json`
- `characters.json`
- `items.json`
- `clues.json`
- `dialogues.json`
- `final-logic.json`
- `asset-manifest.json`
- `asset-prompts.json`
- `validation-report.json`

`asset-manifest.json` records the generated asset URLs, file paths, prompts, and image model. `asset-prompts.json` records the prompt set used for cover/background/character/item images.

## Image And Runtime Generation

After the full case JSON passes validation, the pipeline:

1. Generates scene backgrounds with prompts that reserve open floor/surface space.
2. Normalizes each background to `1600x900`.
3. Sends each background plus scene JSON to OpenAI vision before generating any scene assets.
4. Stores `scene.placementPlan`, including coordinates, size, anchor, facing, surface, lighting, perspective, depth, and placement reason.
5. Generates shared dialogue portraits.
6. Generates a separate NPC sprite for each scene appearance using the full background and a crop around the planned slot.
7. Generates each item using the same background-reference and placement-context approach.
8. Removes white backgrounds with edge-connected flood fill, trims transparent space, and verifies alpha.
9. Sends the real cutouts and original plan to OpenAI vision for verification only.
10. Limits final corrections to `±40px` and `80%..120%` scale without moving an entity to a different surface.
11. Builds `scene.runtime` directly from the verified placement plan and re-validates.

Runtime metadata must not become a second source of gameplay truth. Backend rules still decide whether an item/dialogue/scene transition is allowed.

## Failure Behavior

- OpenAI HTTP errors are logged to `aiGenerationLogs` and surfaced as `502`.
- Parse errors are retried once through OpenAI repair.
- Validation errors are retried once with deterministic validator feedback.
- Invalid drafts keep generated JSON and validation errors but are not published.
