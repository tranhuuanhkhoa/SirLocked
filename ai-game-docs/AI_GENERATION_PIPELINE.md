# AI Generation Pipeline

Last synced with code: 2026-07-14 (`ai-case-prompt-v2`, `story-preview-v2`, `case-logic-v2`).

> Note: the code now uses separate full-logic, scene-layout, and final-asset
> approval gates. See `CURRENT_CASE_AND_GAME_FLOW_VI.md` for the code-synced
> flow as of 2026-06-18.

Current implementation lives in `AiCaseService`, `CaseAutoRepair`, and `CaseValidationService`.

The active code path is OpenAI-only. The creator first approves a spoiler-free story preview. Only after approval does the backend generate the culprit, clue graph, final logic, full case JSON, validation, import, and publish.

## Access Control

- `POST /api/admin/ai-cases`: `ADMIN` or `VIP`; creates the story preview only.
- `POST /api/admin/ai-cases/{draftId}/approve`: `ADMIN` or `VIP`; generates and validates full logic, then waits for explicit logic/layout/final approval.
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
  "difficulty": "medium",
  "generationPreset": "NORMAL_RANDOM",
  "language": "vi"
}
```

Defaults:

- `prompt`: optional; when blank, OpenAI invents an original case or uses loose public-domain mystery inspiration
- `stageCount`: `4`
- `difficulty`: `medium`
- `generationPreset`: `NORMAL_RANDOM`; the other contracts are `SHORT_DEMO`, `PUZZLE_HEAVY`, `DIALOGUE_HEAVY`, and `FULL_FEATURE`
- `language`: `en` by default; `vi` makes all player-facing prose Vietnamese while image art direction remains English/ASCII
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

## Step 2: Approve Full Logic

`POST /api/admin/ai-cases/{draftId}/approve` only accepts drafts in `STORY_AWAITING_APPROVAL`.

The backend then:

1. Calls the Responses API with strict Structured Outputs and the `case-logic-v2` schema.
2. Parses the model-owned `GeneratedCaseLogic` DTO; the model cannot supply asset URLs, runtime, placement, status, timestamps, language, or style fields.
3. Injects the server-owned `pixel_art` / `high_detail_pixel` / `chibi` profile, language, mechanics version, generation mode, and empty runtime/asset fields.
4. Injects `generationMode=CAMERA_EMBEDDED`, matching Glass Meridian: camera clues are small scene-scale environmental details; NPCs and interactive `CUTOUT` items are composited later, while large interactive fixtures remain `EMBEDDED`.
5. Runs deterministic `CaseAutoRepair`, reachability, preset-contract, Vietnamese-language, and visual-safety validation before any image call.
6. If semantic validation fails, retries exactly once with both the invalid JSON checkpoint and validation errors.
7. Stops at `FULL_LOGIC_AWAITING_APPROVAL`; scene layout and final assets have separate approval gates.

After full-logic and scene-layout approval, the asset pipeline:

9. Generates cover art and normalized `1600x900` scene backgrounds containing natural camera evidence. NPCs, CUTOUT items, close-up panels, callouts, split screens, and montages are prohibited in this layer.
10. Uses OpenAI vision over each background and scene JSON to create `scene.placementPlan`.
11. Generates NPC sprites and interactive item cutouts using the full background, a placement-area crop, and the placement metadata as image references, then composites them at runtime.
12. Removes white backgrounds, verifies alpha, and rejects unusable cutouts.
13. Uses OpenAI vision again only to verify scale/alignment within the original slot.
14. Builds `scene.runtime` from the placement plan with final corrections limited to `±40px` and `80%..120%` scale.
15. Writes new generated files under `src/FE/public/assets/ai-generated/v3-placement-first/{caseId-or-safe-suffixed-id}/`. Existing non-empty v3 case folders and all v5 assets are preserved; a suffix prevents overwrite.
16. Re-validates the case after image URLs and runtime metadata are attached.
17. Saves invalid attempts under `GeneratedCaseJson/_invalid-ai`.
18. Exports valid bundles under `src/BE/GeneratedCaseJson/{timestamp}-{caseId}-{draftId}`.
19. Imports the valid JSON with overwrite enabled.
20. Publishes the imported case.
21. Updates the draft status to `PUBLISHED` and sets `importedCaseId`.

## Full Case Contract

OpenAI is instructed to output exactly one strict `GeneratedCaseLogic` object. `GameCase` is assembled by the backend after the response:

- model-owned story and mechanic fields such as `caseId`, `title`, `summary`, `estimatedMinutes`, stages, characters, clues, dialogue, interactions, puzzles, deductions, and `finalLogic`
- server-owned fields such as status, style, language, URLs, placement, and runtime are excluded from the model schema
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

- Attempts are classified as `HTTP_ERROR`, `REFUSAL`, `INCOMPLETE`, `SCHEMA_ERROR`, `SEMANTIC_ERROR`, or `VISUAL_SAFETY_ERROR`.
- Every attempt summary records response ID, model, token usage, schema/prompt version, validation errors, hashes, and the path to the full raw response. Raw bodies are not truncated in storage.
- Preview permits one retry only for an incomplete response. Full logic permits one semantic repair and has no nested parse retry.
- Invalid drafts retain the JSON checkpoint, `failurePhase`, and `failedAssetIds`; they are never advanced to image generation or publication.
- `POST /api/admin/ai-cases/{draftId}/retry-json` repairs the stored JSON checkpoint.
- `POST /api/admin/ai-cases/{draftId}/regenerate-failed-assets` first revalidates JSON, then force-regenerates only failed assets. Prompt-hash and prior-QA markers are required for reuse.
