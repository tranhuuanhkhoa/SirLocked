# AI Generation Pipeline

Last synced with code: 2026-06-12.

Current implementation lives in `AiCaseService`, `MockCaseFactory`, `CaseAutoRepair`, and `CaseValidationService`.

## Access Control

- `POST /api/admin/ai-cases`: `ADMIN` or `VIP`.
- Draft listing/detail/import/publish: `ADMIN` only.

## Input

```json
{
  "prompt": "A jewel heist during a thunderstorm at the observatory",
  "stageCount": 4,
  "difficulty": "medium",
  "visualStyle": "cinematic detective"
}
```

Defaults:

- `stageCount`: `4`
- `difficulty`: `medium`
- `visualStyle`: `cinematic detective`

## Provider Selection

If `AI__DeepseekApiKey` is configured:

- provider starts as `Deepseek`,
- backend calls `{DeepseekBaseUrl}/chat/completions`,
- model comes from `AI__DeepseekModel`,
- timeout is clamped from `AI__DeepseekTimeoutSeconds`.

If no Deepseek key is configured:

- provider is `mock`,
- backend uses `MockCaseFactory`.

## Deepseek Prompt Contract

Deepseek is instructed to output exactly one JSON object using the current `GameCase` shape:

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
- Every clue is unlocked by an item or dialogue.
- Dialogue/hotspot/scene requirements must be reachable in linear play order.
- Final evidence IDs are clue IDs with `isEvidence: true`.
- Status is always `DRAFT`.

## Pipeline Steps

1. Insert `AiCaseDraft`.
2. Generate raw JSON through Deepseek or mock.
3. Strip markdown fences if present.
4. Parse JSON into `GameCase`.
5. Force generated case status to `DRAFT`.
6. Fill missing `caseId` with `case-ai-{timestamp}`.
7. Run deterministic `CaseAutoRepair`.
8. Validate through `CaseValidationService`.
9. If Deepseek validation fails, retry once with validation errors as feedback.
10. If Deepseek still fails or cannot parse, fall back to mock.
11. Save invalid attempts under `GeneratedCaseJson/_invalid-ai`.
12. Export valid bundle under `src/BE/GeneratedCaseJson/{timestamp}-{caseId}-{draftId}`.
13. Update draft status, generated JSON, case summary fields, and export paths.

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
- `asset-prompts.json`
- `validation-report.json`

`asset-prompts.json` contains prompt text for future cover/background/character/item image generation. No image generation or upload is performed in current code.

## Import And Publish

`POST /api/admin/ai-cases/{draftId}/import?overwrite=false`:

- imports generated JSON as a case,
- leaves it as draft.

`POST /api/admin/ai-cases/{draftId}/publish?overwrite=false`:

- imports generated JSON,
- publishes the case.

Both update draft status to `IMPORTED` and set `importedCaseId`.

## Failure Behavior

- Provider HTTP errors are logged to `aiGenerationLogs` and surfaced as `502`.
- Parse errors mark the draft invalid unless Deepseek fallback succeeds.
- Invalid drafts keep generated JSON and validation errors but cannot be imported.
- Mock fallback exists so the demo can continue without a live AI provider.
