# Database Schema

Use MongoDB. Preserve existing collection names/settings where they already exist in `src/BE/Configurations/MongoDbSettings.cs`.

## Collection Summary And Indexes

| Collection | Purpose | Required indexes |
| --- | --- | --- |
| `users` | Auth accounts and admin/player status | unique `email`, `status` |
| `gameCases` | Published/draft case documents and full case JSON | unique `caseId`, `status`, `updatedAt` |
| `gameRooms` | Lobby, players, room status, embedded gameplay state | unique `roomCode`, `caseId`, `hostUserId`, `status`, `updatedAt` |
| `gameResults` | Completed game outcomes and final accusations | `roomId`, `caseId`, `players`, `createdAt` |
| `gameActionLogs` | Optional audit/action feed | `roomId`, `createdAt`, `userId` |
| `roomChatMessages` | Optional room chat | `roomId`, `createdAt` |
| `aiCaseDrafts` | AI/mock generated case drafts | `status`, `createdAt`, `prompt` text search optional |
| `aiGenerationLogs` | AI provider request/response diagnostics | `draftId`, `provider`, `status`, `createdAt` |
| `generatedAssets` | Optional generated image metadata | `draftId`, `assetType`, `status` |

Index notes:

- Create unique indexes before allowing writes that depend on uniqueness, especially `users.email`, `gameCases.caseId`, and `gameRooms.roomCode`.
- Use case-insensitive normalization for emails and IDs at service level before insert.
- Do not index every nested case field for MVP. Validate nested references when importing/publishing cases instead.
- If querying nested case content becomes necessary later, consider denormalized summary fields rather than indexing deep arrays.

## users

```json
{
  "_id": "ObjectId",
  "fullName": "Ada Player",
  "email": "ada@example.com",
  "passwordHash": "...",
  "role": "PLAYER",
  "status": "ACTIVE",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

Roles:

- `PLAYER`
- `VIP`
- `ADMIN`

Statuses:

- `ACTIVE`
- `LOCKED`
- `DELETED`

## gameCases

Complete playable reference:

- Full example file: `ai-game-docs/samples/sample-case.json`
- This sample should be treated as the canonical MVP shape for the JSON engine.
- AI generation, backend validation, and frontend rendering should all stay compatible with that file.

```json
{
  "_id": "ObjectId",
  "caseId": "case-week2-manor",
  "title": "The Locked Manor Ledger",
  "summary": "A financier is found dead after a private dinner.",
  "status": "PUBLISHED",
  "estimatedMinutes": 35,
  "coverImageUrl": "/assets/cases/locked-manor.jpg",
  "stages": [],
  "characters": [],
  "items": [],
  "clues": [],
  "dialogues": [],
  "finalLogic": {},
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

Important nested gameplay fields:

```json
{
  "scene": {
    "sceneId": "scene-study",
    "title": "Victim's Study",
    "backgroundUrl": "/assets/scenes/study.jpg",
    "description": "Scene description shown to players.",
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
  },
  "item": {
    "itemId": "item-bitter-glass",
    "name": "Bitter Crystal Glass",
    "description": "Short visible description.",
    "inspectText": "Text shown after inspection.",
    "imageUrl": "/assets/items/bitter-glass.png",
    "unlockClueIds": ["clue-poisoned-drink"],
    "isCollectible": true
  },
  "clue": {
    "clueId": "clue-poisoned-drink",
    "title": "Poisoned Drink",
    "content": "The victim was poisoned before the study was locked.",
    "isCritical": true,
    "isEvidence": true,
    "isRedHerring": false,
    "source": "item-bitter-glass",
    "sourceType": "item"
  },
  "finalLogic": {
    "culpritId": "char-edgar",
    "motive": "Hidden debt and fear of financial ruin.",
    "method": "Poisoned drink staged as locked-room death.",
    "requiredEvidenceIds": ["clue-poisoned-drink"],
    "winEnding": "Correct ending text.",
    "failEnding": "Failure ending text."
  }
}
```

Schema rules:

- `completeCondition.logic` defaults to `AND`. `AND` requires all listed item, clue, and dialogue IDs. `OR` is allowed only when at least one non-empty requirement group is satisfied.
- `hotspots` use percentage coordinates and may include `zIndex` to resolve overlap.
- `clue.isCritical` means important for reasoning. `clue.isEvidence` means selectable for final accusation. `clue.isRedHerring` means intentionally misleading but explainable.
- `clue.sourceType` must be `item` or `dialogue`; `source` must reference the matching `itemId` or `dialogueId`.
- `finalLogic.requiredEvidenceIds` must reference clue IDs only. Do not mix item IDs and clue IDs.
- Case validators must check duplicate IDs, missing references, unlock reachability, and cycles in clue/dialogue requirements.

Statuses:

- `DRAFT`
- `PUBLISHED`
- `ARCHIVED`

## gameRooms

```json
{
  "_id": "ObjectId",
  "roomId": "room-id",
  "roomCode": "ABC123",
  "caseId": "case-week2-manor",
  "hostUserId": "user-id",
  "players": [
    {
      "userId": "user-id",
      "username": "Ada Player",
      "role": "INVESTIGATOR",
      "isReady": true
    }
  ],
  "status": "IN_PROGRESS",
  "currentStageId": "stage-locked-study",
  "currentSceneId": "scene-study",
  "gameplayState": {},
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

Room statuses:

- `WAITING`
- `READY`
- `IN_PROGRESS`
- `COMPLETED`

Player game roles:

- `INVESTIGATOR`
- `INTERROGATOR`

## gameplayState

For MVP, embed gameplay state in `gameRooms.Progress`/`gameplayState` so room reads and writes stay simple. Do not create or use a separate `gameplayStates` collection for MVP. Split it into a separate collection only if state becomes large, needs independent version history, or requires separate retention, and only after the storage model is explicitly changed in these docs.

```json
{
  "roomId": "room-id",
  "caseId": "case-week2-manor",
  "currentStageId": "stage-locked-study",
  "currentSceneId": "scene-study",
  "version": 7,
  "visitedSceneIds": ["scene-study"],
  "inspectedItemIds": ["item-bitter-glass"],
  "collectedItemIds": ["item-bitter-glass"],
  "unlockedClueIds": ["clue-poisoned-drink"],
  "askedDialogueIds": ["dlg-edgar-alibi"],
  "completedSceneIds": [],
  "completedStageIds": [],
  "selectedEvidenceIds": [],
  "gameStatus": "IN_PROGRESS",
  "startedAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:10:00Z",
  "completedAt": null
}
```

Update rules:

- Increment `version` on every successful gameplay state mutation.
- Realtime events should include the new version when practical.
- Clients must call `GET /api/game/rooms/{roomId}/state` after reconnect and whenever event order is uncertain.
- Mutating gameplay actions should be idempotent where possible.

Concurrency rules:

- Treat `gameRooms.gameplayState.version` as optimistic concurrency metadata.
- For every gameplay mutation, read current room, validate action against current state, apply mutation, increment version, update `updatedAt`, then broadcast.
- If using MongoDB atomic update filters, include the previous `version` in the update condition so concurrent writes cannot silently overwrite each other.
- If a concurrent update conflict occurs, refetch room state and retry once for idempotent actions such as inspecting an already inspected item.
- Never let the client submit a replacement full state object; clients submit only action commands.

Canonical state mapping:

| Runtime field | Source or meaning |
| --- | --- |
| `currentStageId` | Current playable stage from ordered case stages |
| `currentSceneId` | Current playable scene within stage |
| `visitedSceneIds` | Scenes the room has entered; used for backtracking/review |
| `inspectedItemIds` | Item IDs inspected by investigator |
| `collectedItemIds` | Item IDs that count as inventory/evidence objects |
| `unlockedClueIds` | Clue IDs discovered through item/dialogue unlocks |
| `askedDialogueIds` | Dialogue IDs already asked by interrogator |
| `completedSceneIds` | Scenes whose `completeCondition` is satisfied |
| `completedStageIds` | Stages completed in order |
| `selectedEvidenceIds` | Clue IDs selected for final accusation draft/submission |
| `version` | Incrementing state version for reconnect and stale-event detection |

## gameResults

```json
{
  "_id": "ObjectId",
  "roomId": "room-id",
  "caseId": "case-week2-manor",
  "players": ["user-id-1", "user-id-2"],
  "selectedCulpritId": "char-edgar",
  "selectedEvidenceIds": ["clue-poisoned-drink"],
  "success": true,
  "ending": "The accusation exposes the staged locked room.",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

## gameActionLogs

Optional for MVP. Keep action logs only if they support debugging or the visible action feed; otherwise defer detailed logging until after the playable loop is stable.

```json
{
  "_id": "ObjectId",
  "roomId": "room-id",
  "userId": "user-id",
  "actionType": "INSPECT_ITEM",
  "payloadJson": "{\"itemId\":\"item-bitter-glass\"}",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

## roomChatMessages

Optional for MVP. Chat is useful but not required for the core investigation loop.

```json
{
  "_id": "ObjectId",
  "roomId": "room-id",
  "userId": "user-id",
  "message": "Check the glass first.",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

## aiCaseDrafts

```json
{
  "_id": "ObjectId",
  "prompt": "Locked-room manor mystery",
  "settings": {
    "stageCount": 4,
    "difficulty": "medium",
    "visualStyle": "cinematic detective"
  },
  "status": "DEEPSEEK_GENERATED_VALID",
  "generatedJson": "{...}",
  "jsonFilePath": "src/BE/GeneratedCaseJson/.../case.json",
  "jsonFolderPath": "src/BE/GeneratedCaseJson/...",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

## aiGenerationLogs

```json
{
  "_id": "ObjectId",
  "draftId": "draft-id",
  "provider": "Deepseek",
  "step": "GenerateCaseJson",
  "status": "SUCCESS",
  "prompt": "...",
  "response": "...",
  "error": null,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

## generatedAssets

Optional for MVP.

```json
{
  "_id": "ObjectId",
  "draftId": "draft-id",
  "assetType": "background",
  "prompt": "Detective mystery game background...",
  "url": "/assets/scenes/placeholder.png",
  "provider": "mock",
  "status": "PENDING",
  "createdAt": "2026-01-01T00:00:00Z"
}
```
