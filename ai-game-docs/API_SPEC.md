# API Specification

Prefer existing routes in the repository. Do not create duplicate equivalent routes.

## Auth

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/auth/register` | Register a `PLAYER` account |
| POST | `/api/auth/login` | Login and return JWT |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/logout` | Logout if supported |

## Player Cases

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/cases/published` | List published cases |
| GET | `/api/cases/{caseId}` | Get case detail |

## Admin Cases

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/admin/cases` | List all cases |
| GET | `/api/admin/cases/{caseId}` | Get case detail |
| POST | `/api/admin/cases/import-json` | Import a `GameCase` JSON |
| POST | `/api/admin/cases/validate` | Validate a `GameCase` JSON |
| PATCH | `/api/admin/cases/{caseId}/publish` | Publish case |
| PATCH | `/api/admin/cases/{caseId}/unpublish` | Unpublish case |
| POST | `/api/admin/cases/seed-sample` | Seed main sample case |
| POST | `/api/admin/cases/seed-demo` | Seed demo cases |

## Rooms

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/rooms` | Create room for a published case |
| POST | `/api/rooms/join` | Join room by code |
| GET | `/api/rooms/{roomId}` | Get room state |
| POST | `/api/rooms/{roomId}/leave` | Leave room |
| POST | `/api/rooms/{roomId}/select-role` | Select `INVESTIGATOR` or `INTERROGATOR` |
| POST | `/api/rooms/{roomId}/ready` | Toggle or set ready |
| POST | `/api/rooms/{roomId}/start` | Host starts game |

## Gameplay

Use the existing route style in this repository: `/api/game/rooms/{roomId}/...`.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/game/rooms/{roomId}/state` | Get authoritative runtime state; call after page load and SignalR reconnect |
| POST | `/api/game/rooms/{roomId}/inspect-item` | `INVESTIGATOR` inspects item in current scene |
| POST | `/api/game/rooms/{roomId}/ask-dialogue` | `INTERROGATOR` asks character dialogue |
| POST | `/api/game/rooms/{roomId}/present-evidence` | Present evidence during dialogue, optional MVP |
| POST | `/api/game/rooms/{roomId}/complete-scene` | Complete current scene |
| POST | `/api/game/rooms/{roomId}/complete-stage` | Complete current stage when all scenes are complete |
| POST | `/api/game/rooms/{roomId}/go-to-scene` | Move to unlocked/visited scene, optional MVP |
| POST | `/api/game/rooms/{roomId}/accuse` | Submit final accusation |

Recommended request/response conventions:

- `inspect-item` body: `{ "itemId": "item-bitter-glass" }`
- `ask-dialogue` body: `{ "dialogueId": "dlg-edgar-alibi" }`
- `present-evidence` body: `{ "dialogueId": "dlg-edgar-alibi", "evidenceId": "clue-hidden-debt" }`
- `accuse` body: `{ "culpritId": "char-edgar", "motive": "...", "method": "...", "evidenceIds": ["clue-hidden-debt"] }`
- Runtime state responses include `version`; clients should discard realtime updates older than their current version and refetch state if versions diverge.
- `finalLogic.requiredEvidenceIds` and accusation `evidenceIds` should be clue IDs only.

### Gameplay Response Schemas

Use the existing project response wrapper if one already exists. The `data` payload should still match these shapes so frontend and SignalR code can share one contract.

`GET /api/game/rooms/{roomId}/state` returns `GameStateResponse`:

```json
{
  "roomId": "room-id",
  "roomCode": "ABC123",
  "caseId": "case-week2-manor",
  "caseTitle": "The Locked Manor Ledger",
  "roomStatus": "IN_PROGRESS",
  "currentStageId": "stage-locked-study",
  "currentSceneId": "scene-study",
  "version": 7,
  "players": [
    {
      "userId": "user-id",
      "username": "Ada Player",
      "role": "INVESTIGATOR",
      "isReady": true
    }
  ],
  "visitedSceneIds": ["scene-study"],
  "inspectedItemIds": ["item-bitter-glass"],
  "collectedItemIds": ["item-bitter-glass"],
  "unlockedClueIds": ["clue-poisoned-drink"],
  "askedDialogueIds": ["dlg-edgar-alibi"],
  "completedSceneIds": [],
  "completedStageIds": [],
  "selectedEvidenceIds": [],
  "availableForAccusation": false,
  "currentObjective": "Find the cause of death.",
  "visibleScene": {
    "sceneId": "scene-study",
    "title": "Victim's Study",
    "description": "Scene description shown to players.",
    "backgroundUrl": "/assets/scenes/study.jpg",
    "hotspots": [],
    "items": [],
    "characters": [],
    "availableDialogues": []
  },
  "unlockedClues": [],
  "evidenceClues": [],
  "actionLog": []
}
```

Mutation responses such as `inspect-item`, `ask-dialogue`, `complete-scene`, and `go-to-scene` should return the updated `GameStateResponse` plus action-specific metadata when useful:

```json
{
  "state": {},
  "changed": true,
  "unlockedClueIds": ["clue-poisoned-drink"],
  "message": "New clue discovered."
}
```

`complete-scene` failure response:

```json
{
  "message": "Scene requirements are not complete.",
  "missing": {
    "requiredItemIds": ["item-bitter-glass"],
    "requiredClueIds": ["clue-poisoned-drink"],
    "requiredDialogueIds": ["dlg-edgar-alibi"]
  }
}
```

`POST /api/game/rooms/{roomId}/accuse` returns `GameResultResponse`:

```json
{
  "roomId": "room-id",
  "caseId": "case-week2-manor",
  "selectedCulpritId": "char-edgar",
  "selectedEvidenceIds": ["clue-hidden-debt"],
  "success": true,
  "ending": "Correct ending text.",
  "correctCulpritId": "char-edgar",
  "requiredEvidenceIds": ["clue-hidden-debt"],
  "completedAt": "2026-01-01T00:00:00Z"
}
```

Case validation responses should include all errors, not just the first error:

```json
{
  "isValid": false,
  "errors": [
    {
      "code": "MissingReference",
      "path": "stages[0].scenes[0].itemIds[1]",
      "message": "Item does not exist.",
      "refId": "item-missing"
    }
  ]
}
```

## Error Handling And Edge Cases

Use consistent API responses matching the existing project response wrapper if present.

Recommended status codes:

| Status | When |
| --- | --- |
| 400 | Invalid request body, invalid state transition, missing required fields |
| 401 | Missing/invalid JWT |
| 403 | User is not allowed, locked/deleted user, non-room player action |
| 404 | Room/case/item/dialogue/character not found |
| 409 | Conflict such as duplicate room role, room already started, case ID exists |
| 422 | Valid JSON shape but case/gameplay validation failed |
| 502 | AI provider failed |

Gameplay edge-case responses:

- Inspecting an already inspected item should be idempotent: return current item result and no duplicate clues.
- Inspecting an item not in current scene must fail with a clear message.
- Inspecting a locked hotspot must return missing `requiredClueIds`.
- Inspecting an item should require `INVESTIGATOR` role in normal co-op rooms.
- Asking a dialogue already asked should return its answer and current unlock state, not duplicate logs/clues.
- Asking locked dialogue must return missing `requiredClueIds`.
- Asking dialogue should require `INTERROGATOR` role in normal co-op rooms.
- Completing an incomplete scene must return missing item/clue/dialogue IDs.
- Accusing before game is in progress or after completed must fail.
- Accusing with wrong culprit/evidence should complete game with fail result, not server error.
- Joining a full room must return conflict.
- Selecting a role already taken must return conflict.
- Starting without both players ready must return bad request with missing player info.

## Admin Dashboard

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/admin/dashboard` | Dashboard counts |
| GET | `/api/admin/users` | List users |
| PATCH | `/api/admin/users/{userId}/lock` | Lock user |
| PATCH | `/api/admin/users/{userId}/unlock` | Unlock user |

## AI Case Generator

Required MVP:

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/admin/ai-cases` | Generate valid AI/mock case draft |

If feasible:

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/admin/ai-cases` | List AI drafts |
| GET | `/api/admin/ai-cases/{draftId}` | Get AI draft detail |
| POST | `/api/admin/ai-cases/{draftId}/import` | Import draft as case |
| POST | `/api/admin/ai-cases/{draftId}/publish` | Import and publish draft |

## SignalR

Hub:

```txt
/hubs/game
```

Lobby events:

- `PlayerJoined`
- `PlayerLeft`
- `RolesUpdated`
- `ReadyUpdated`
- `GameStarted`
- `RoomMessageReceived` (optional after core sync)
- `RoomError`

Gameplay events:

- `GameStateUpdated`
- `SceneChanged`
- `ItemFound`
- `ClueUnlocked`
- `DialogueAnswered`
- `EvidencePresented` (optional with `present-evidence`)
- `StageChanged`
- `GameCompleted`
- `SystemMessageReceived`

Payload rules:

- Lobby events should include `roomId`, affected `userId` when available, and enough room snapshot data for the lobby UI to rerender.
- `GameStateUpdated` sends the full `GameStateResponse`, including `roomId`, `currentStageId`, `currentSceneId`, `version`, found IDs, completed IDs, and visible scene data. This is the canonical realtime sync event for MVP.
- `ItemFound`: `{ roomId, itemId, userId, version? }`
- `ClueUnlocked`: `{ roomId, clueId, sourceId?, itemId?, userId, version? }`
- `DialogueAnswered`: `{ roomId, dialogueId, userId, version? }`
- `EvidencePresented`: `{ roomId, dialogueId, evidenceId, userId, version? }`
- `SceneChanged`: `{ roomId, previousSceneId, currentSceneId, userId, version? }`
- `StageChanged`: `{ roomId, previousStageId, currentStageId, previousSceneId, currentSceneId, isFinalStageCompleted, userId, version? }`
- `GameCompleted` sends `GameResultResponse`.

Reconnect policy:

1. Client connects to `/hubs/game` and calls `JoinRoom(roomId)`.
2. Client subscribes to `GameStateUpdated` and detail events.
3. On `onreconnected`, client calls `JoinRoom(roomId)` again, then `GET /api/game/rooms/{roomId}/state`.
4. If any detail event is missing `version` or has a version gap, client calls `GET /api/game/rooms/{roomId}/state`.
5. API state replaces local state; detail events only drive toasts/log messages.
