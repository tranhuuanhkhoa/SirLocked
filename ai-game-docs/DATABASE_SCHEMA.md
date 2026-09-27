# Database Schema

Last synced with code: 2026-09-20.

MongoDB documents use camelCase element names through the global MongoDB convention pack in `MongoDbContext`.

## Collections

| Collection | Code property | Purpose | Indexes created at startup |
| --- | --- | --- | --- |
| `users` | `Users` | Auth accounts | unique `email`, `status` |
| `gameCases` | `Cases` | Full case JSON documents | unique `caseId`, `status`, descending `updatedAt` |
| `gameRooms` | `Rooms` | Lobby plus embedded gameplay state | unique `roomCode`, `caseId`, `hostUserId`, `status` |
| `gameResults` | `GameResults` | Final accusation outcomes | `roomId`, `caseId`, descending `createdAt` |
| `gameActionLogs` | `ActionLogs` | Gameplay audit/action feed | compound `roomId`, descending `createdAt` |
| `aiCaseDrafts` | `AiCaseDrafts` | AI/mock generated drafts | `status`, descending `createdAt` |
| `aiGenerationLogs` | `AiGenerationLogs` | Provider diagnostics | compound `draftId`, descending `createdAt` |
| `aiBudgetLedger` | `AiBudgetLedger` | Atomic global AI reservation/spend ceiling | singleton `_id=global` |

`roomChatMessages` and `generatedAssets` exist as configuration names but are not used by current services.

## users

```json
{
  "_id": "ObjectId",
  "fullName": "Ada Player",
  "email": "ada@example.com",
  "passwordHash": "bcrypt",
  "role": "PLAYER",
  "status": "ACTIVE",
  "authorizationVersion": 3,
  "refreshTokenHash": "sha256",
  "createdAt": "2026-06-12T00:00:00Z",
  "updatedAt": "2026-06-12T00:00:00Z"
}
```

Published case content is immutable while a room is `WAITING` or
`IN_PROGRESS`; an import that would replace it is rejected with
`CASE_IMMUTABLE_WHILE_ACTIVE`. New authored content must use a new `caseId`.

AI drafts carry `idempotencyKey`, `quotaDay`, `activeQuotaKey`,
`dailyQuotaKey`, and `reservedBudgetUsd`. The active key is cleared when a
draft is cancelled or imported; the daily key remains to enforce one accepted
create per user and Vietnam calendar day. `aiBudgetLedger` atomically tracks
`reservedUsd`, `spentUsd`, and the configured `limitUsd` before a paid provider
call is admitted.

Roles:

- `PLAYER`
- `VIP`
- `ADMIN`

Statuses:

- `ACTIVE`
- `LOCKED`
- `DELETED`

## gameCases

Canonical sample: `ai-game-docs/samples/sample-case.json`.

Current required schema is the clue/dialogue case model below. The next 2D movement direction adds optional scene runtime metadata documented in `SCENE_RUNTIME_SCHEMA.md`; do not require that metadata for legacy/current cases until validation and renderer support are implemented.

```json
{
  "_id": "ObjectId",
  "caseId": "case-week2-manor",
  "title": "The Locked Manor Ledger",
  "summary": "A financier dies inside a locked study.",
  "status": "DRAFT",
  "estimatedMinutes": 35,
  "coverImageUrl": "/assets/cases/locked-manor.jpg",
  "stages": [],
  "characters": [],
  "items": [],
  "clues": [],
  "dialogues": [],
  "finalLogic": {},
  "createdAt": "2026-06-12T00:00:00Z",
  "updatedAt": "2026-06-12T00:00:00Z"
}
```

Case statuses:

- `DRAFT`
- `PUBLISHED`
- `ARCHIVED`

Nested shape required by the engine:

```json
{
  "stages": [
    {
      "stageId": "stage-locked-study",
      "title": "Death in the Locked Study",
      "order": 1,
      "scenes": [
        {
          "sceneId": "scene-study",
          "title": "Victim's Study",
          "backgroundUrl": "/assets/scenes/study.jpg",
          "description": "Scene text.",
          "itemIds": ["item-bitter-glass"],
          "characterIds": ["char-edgar"],
          "hotspots": [
            {
              "hotspotId": "hotspot-bitter-glass",
              "type": "ITEM",
              "targetId": "item-bitter-glass",
              "x": 46,
              "y": 61,
              "width": 8,
              "height": 10,
              "zIndex": 1,
              "label": "Crystal glass",
              "requiredClueIds": []
            }
          ],
          "completeCondition": {
            "logic": "AND",
            "requiredItemIds": ["item-bitter-glass"],
            "requiredClueIds": ["clue-poisoned-drink"],
            "requiredDialogueIds": ["dlg-edgar-alibi"]
          }
        }
      ]
    }
  ],
  "characters": [
    {
      "characterId": "char-edgar",
      "name": "Edgar Voss",
      "role": "Business partner",
      "imageUrl": "/assets/characters/edgar-voss.png",
      "description": "Suspect description."
    }
  ],
  "items": [
    {
      "itemId": "item-bitter-glass",
      "name": "Bitter Crystal Glass",
      "description": "Visible item description.",
      "inspectText": "Text returned after inspection.",
      "imageUrl": "/assets/items/bitter-glass.png",
      "unlockClueIds": ["clue-poisoned-drink"],
      "isCollectible": true
    }
  ],
  "clues": [
    {
      "clueId": "clue-poisoned-drink",
      "title": "Poisoned Drink",
      "content": "The victim was poisoned.",
      "isCritical": true,
      "isEvidence": true,
      "isRedHerring": false,
      "source": "item-bitter-glass",
      "sourceType": "item"
    }
  ],
  "dialogues": [
    {
      "dialogueId": "dlg-edgar-alibi",
      "characterId": "char-edgar",
      "question": "Where were you?",
      "answer": "I was elsewhere.",
      "requiredClueIds": [],
      "unlockClueIds": []
    }
  ],
  "finalLogic": {
    "culpritId": "char-edgar",
    "motive": "Hidden debt.",
    "method": "Poisoned drink.",
    "requiredEvidenceIds": ["clue-poisoned-drink"],
    "winEnding": "Correct ending.",
    "failEnding": "Failure ending."
  }
}
```

Validation rules implemented in `CaseValidationService`:

- Required `caseId`, `title`, and at least one stage.
- Each stage needs `stageId` and at least one scene.
- Stage `order` values must be unique.
- Scene `completeCondition.logic` must be `AND` or `OR`.
- `OR` conditions require at least one non-empty requirement group.
- Duplicate stage, scene, character, item, clue, dialogue, and hotspot IDs are rejected.
- Scene item/character references must exist.
- Hotspot type must be `ITEM` or `CHARACTER`.
- Item hotspots must target an item in the same scene.
- Hotspot percent coordinates must be valid.
- Item/dialogue unlock and requirement clue IDs must exist.
- Clue `sourceType` must be `item` or `dialogue`; `source` must exist.
- Final culprit must be a character.
- Final evidence must use clue IDs, not item IDs.
- Final evidence clues must set `isEvidence: true`.
- A greedy linear playthrough must be able to complete every scene.
- Final evidence must be discoverable.
- Orphan clues not unlocked by any item/dialogue are rejected.

## gameRooms

```json
{
  "_id": "ObjectId",
  "roomCode": "ABC123",
  "caseId": "case-week2-manor",
  "hostUserId": "user-host",
  "players": [
    {
      "userId": "user-host",
      "username": "Ada Player",
      "role": "INVESTIGATOR",
      "isReady": true
    }
  ],
  "status": "IN_PROGRESS",
  "gameplayState": {
    "currentStageId": "stage-locked-study",
    "currentSceneId": "scene-study",
    "version": 1,
    "visitedSceneIds": ["scene-study"],
    "inspectedItemIds": [],
    "collectedItemIds": [],
    "unlockedClueIds": [],
    "askedDialogueIds": [],
    "completedSceneIds": [],
    "completedStageIds": [],
    "selectedEvidenceIds": [],
    "gameStatus": "IN_PROGRESS",
    "startedAt": "2026-06-12T00:00:00Z",
    "updatedAt": "2026-06-12T00:00:00Z",
    "completedAt": null
  },
  "createdAt": "2026-06-12T00:00:00Z",
  "updatedAt": "2026-06-12T00:00:00Z"
}
```

Room statuses:

- `WAITING`
- `READY`
- `IN_PROGRESS`
- `COMPLETED`

Player roles:

- `INVESTIGATOR`
- `INTERROGATOR`

Game statuses:

- `IN_PROGRESS`
- `WON`
- `FAILED`

Concurrency rule: gameplay mutations update the whole `GameRoom` document only when the stored `gameplayState.version` equals the version that was read. Successful mutations increment the version by one.

## gameResults

```json
{
  "_id": "ObjectId",
  "roomId": "room-id",
  "caseId": "case-week2-manor",
  "players": ["user-1", "user-2"],
  "selectedCulpritId": "char-edgar",
  "selectedEvidenceIds": ["clue-hidden-debt"],
  "success": true,
  "ending": "Ending text.",
  "createdAt": "2026-06-12T00:00:00Z"
}
```

## gameActionLogs

```json
{
  "_id": "ObjectId",
  "roomId": "room-id",
  "userId": "user-id",
  "actionType": "INSPECT_ITEM",
  "payloadJson": "{\"itemId\":\"item-bitter-glass\"}",
  "message": "Ada inspected Bitter Crystal Glass.",
  "createdAt": "2026-06-12T00:00:00Z"
}
```

Only the latest 40 entries are returned in `GameStateResponse.actionLog`.

## aiCaseDrafts

```json
{
  "_id": "ObjectId",
  "prompt": "Locked-room mystery",
  "settings": {
    "stageCount": 4,
    "difficulty": "medium",
    "visualStyle": "SirLocked Victorian gaslight pixel-art detective game"
  },
  "status": "PUBLISHED",
  "provider": "OpenAI",
  "storyPreview": {
    "title": "Generated Preview",
    "summary": "Spoiler-free creator-approved premise"
  },
  "assetManifest": {
    "assetRootUrl": "/assets/ai-generated/case-ai-20260612000000",
    "logicModel": "gpt-5.5",
    "imageModel": "gpt-image-2",
    "assets": []
  },
  "generatedJson": "{...}",
  "caseId": "case-ai-20260612000000",
  "caseTitle": "Generated Case",
  "jsonFilePath": "src/BE/GeneratedCaseJson/.../case.json",
  "jsonFolderPath": "src/BE/GeneratedCaseJson/...",
  "validationErrors": [],
  "importedCaseId": null,
  "createdAt": "2026-06-12T00:00:00Z",
  "updatedAt": "2026-06-12T00:00:00Z"
}
```

AI draft statuses:

- `GENERATED_INVALID`
- `GENERATING_STORY`
- `STORY_AWAITING_APPROVAL`
- `GENERATING_FULL_CASE`
- `OPENAI_GENERATED_VALID`
- `GENERATING_ASSETS`
- `ASSETS_GENERATED`
- `IMPORTED`
- `PUBLISHED`

## aiGenerationLogs

```json
{
  "_id": "ObjectId",
  "draftId": "draft-id",
  "provider": "OpenAI",
  "step": "GenerateCaseJson",
  "status": "SUCCESS",
  "prompt": "Prompt text truncated to 4000 chars",
  "response": "Response text truncated to 8000 chars",
  "error": null,
  "createdAt": "2026-06-12T00:00:00Z"
}
```
