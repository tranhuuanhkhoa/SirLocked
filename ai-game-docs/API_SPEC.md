# API Specification

Last synced with code: 2026-06-12.

Base backend URL in local development: `http://localhost:5215`.

All controller responses use this envelope:

```json
{
  "success": true,
  "message": "Optional message.",
  "data": {},
  "errors": null
}
```

Authenticated endpoints require:

```http
Authorization: Bearer <jwt>
```

## Auth

| Method | Route | Auth | Body | Data |
| --- | --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Anonymous | `{ "fullName": "...", "email": "...", "password": "..." }` | `AuthResponse` |
| `POST` | `/api/auth/login` | Anonymous | `{ "email": "...", "password": "..." }` | `AuthResponse` |
| `GET` | `/api/auth/me` | User | none | `UserResponse` |
| `POST` | `/api/auth/logout` | User | none | `{ "loggedOut": true }` |

`AuthResponse`:

```json
{
  "token": "jwt",
  "expiresAt": "2026-06-12T00:00:00Z",
  "user": {
    "userId": "user-id",
    "fullName": "Ada Player",
    "email": "ada@example.com",
    "role": "PLAYER",
    "status": "ACTIVE",
    "createdAt": "2026-06-12T00:00:00Z"
  }
}
```

## Player Cases

| Method | Route | Auth | Data |
| --- | --- | --- | --- |
| `GET` | `/api/cases/published` | User | `CaseSummaryResponse[]` |
| `GET` | `/api/cases/{caseId}` | User | `CasePublicDetailResponse` |

Public detail includes summary fields plus `characters`. It does not expose full stages/items/clues/dialogues.

## Rooms

| Method | Route | Auth | Body | Data |
| --- | --- | --- | --- | --- |
| `POST` | `/api/rooms` | User | `{ "caseId": "case-week2-manor" }` | `RoomResponse` |
| `POST` | `/api/rooms/join` | User | `{ "roomCode": "ABC123" }` | `RoomResponse` |
| `GET` | `/api/rooms/{roomId}` | Room member | none | `RoomResponse` |
| `POST` | `/api/rooms/{roomId}/leave` | Room member | none | `RoomResponse` or `null` |
| `POST` | `/api/rooms/{roomId}/select-role` | Room member | `{ "role": "INVESTIGATOR" }` | `RoomResponse` |
| `POST` | `/api/rooms/{roomId}/ready` | Room member | `{ "isReady": true }` | `RoomResponse` |
| `POST` | `/api/rooms/{roomId}/start` | Host | none | `RoomResponse` |

`RoomResponse`:

```json
{
  "roomId": "room-id",
  "roomCode": "ABC123",
  "caseId": "case-week2-manor",
  "caseTitle": "The Locked Manor Ledger",
  "hostUserId": "user-host",
  "status": "WAITING",
  "players": [
    {
      "userId": "user-host",
      "username": "Ada Player",
      "role": "INVESTIGATOR",
      "isReady": false
    }
  ],
  "createdAt": "2026-06-12T00:00:00Z"
}
```

## Gameplay

Route prefix: `/api/game/rooms/{roomId}`.

| Method | Route | Auth | Body | Data |
| --- | --- | --- | --- | --- |
| `GET` | `/state` | Room member | none | `GameStateResponse` |
| `POST` | `/inspect-item` | `INVESTIGATOR` | `{ "itemId": "item-bitter-glass" }` | `GameActionResponse` |
| `POST` | `/ask-dialogue` | `INTERROGATOR` | `{ "dialogueId": "dlg-edgar-alibi" }` | `GameActionResponse` |
| `POST` | `/present-evidence` | Room member | `{ "dialogueId": "dlg-1", "evidenceId": "clue-1" }` | `GameActionResponse` |
| `POST` | `/complete-scene` | Room member | none | `GameActionResponse` |
| `POST` | `/complete-stage` | Room member | none | `GameActionResponse` |
| `POST` | `/go-to-scene` | Room member | `{ "sceneId": "scene-study" }` | `GameActionResponse` |
| `POST` | `/accuse` | Room member | `{ "culpritId": "char-edgar", "motive": "...", "method": "...", "evidenceIds": ["clue-hidden-debt"] }` | `GameResultResponse` |
| `GET` | `/result` | Room member | none | `GameResultResponse` |

`GameStateResponse` includes:

```json
{
  "roomId": "room-id",
  "roomCode": "ABC123",
  "caseId": "case-week2-manor",
  "caseTitle": "The Locked Manor Ledger",
  "caseSummary": "Summary.",
  "roomStatus": "IN_PROGRESS",
  "currentStageId": "stage-locked-study",
  "currentSceneId": "scene-study",
  "version": 7,
  "players": [],
  "visitedSceneIds": ["scene-study"],
  "inspectedItemIds": ["item-bitter-glass"],
  "collectedItemIds": ["item-bitter-glass"],
  "unlockedClueIds": ["clue-poisoned-drink"],
  "askedDialogueIds": ["dlg-edgar-alibi"],
  "completedSceneIds": [],
  "completedStageIds": [],
  "selectedEvidenceIds": [],
  "gameStatus": "IN_PROGRESS",
  "availableForAccusation": false,
  "currentObjective": "Investigate Victim's Study.",
  "visibleScene": {
    "sceneId": "scene-study",
    "title": "Victim's Study",
    "description": "Scene description.",
    "backgroundUrl": "/assets/scenes/study.jpg",
    "hotspots": [],
    "items": [],
    "characters": [],
    "availableDialogues": []
  },
  "sceneMap": [],
  "unlockedClues": [],
  "evidenceClues": [],
  "suspects": [],
  "actionLog": []
}
```

`GameActionResponse`:

```json
{
  "state": {},
  "changed": true,
  "unlockedClueIds": ["clue-poisoned-drink"],
  "message": "New clue discovered.",
  "detail": "Optional item text or dialogue answer."
}
```

`GameResultResponse`:

```json
{
  "roomId": "room-id",
  "caseId": "case-week2-manor",
  "caseTitle": "The Locked Manor Ledger",
  "selectedCulpritId": "char-edgar",
  "selectedCulpritName": "Edgar Voss",
  "selectedEvidenceIds": ["clue-hidden-debt"],
  "success": true,
  "ending": "Ending text.",
  "correctCulpritId": "char-edgar",
  "correctCulpritName": "Edgar Voss",
  "motive": "Hidden debt.",
  "method": "Poisoned drink.",
  "requiredEvidenceIds": ["clue-hidden-debt"],
  "completedAt": "2026-06-12T00:00:00Z"
}
```

## Admin

All routes require `ADMIN`.

| Method | Route | Body | Data |
| --- | --- | --- | --- |
| `GET` | `/api/admin/dashboard` | none | counts object |
| `GET` | `/api/admin/users` | none | `UserResponse[]` |
| `PATCH` | `/api/admin/users/{userId}/lock` | none | `UserResponse` |
| `PATCH` | `/api/admin/users/{userId}/unlock` | none | `UserResponse` |
| `PATCH` | `/api/admin/users/{userId}/role` | `{ "role": "PLAYER" }` | `UserResponse` |
| `GET` | `/api/admin/cases` | none | `CaseSummaryResponse[]` |
| `GET` | `/api/admin/cases/{caseId}` | none | full `GameCase` |
| `POST` | `/api/admin/cases/validate` | `{ "caseJson": { ... }, "overwrite": false }` | `CaseValidationResponse` |
| `POST` | `/api/admin/cases/import-json` | `{ "caseJson": { ... }, "overwrite": false }` | `CaseSummaryResponse` |
| `PATCH` | `/api/admin/cases/{caseId}/publish` | none | `CaseSummaryResponse` |
| `PATCH` | `/api/admin/cases/{caseId}/unpublish` | none | `CaseSummaryResponse` |
| `POST` | `/api/admin/cases/seed-sample?publish=true` | none | `CaseSummaryResponse` |
| `POST` | `/api/admin/cases/seed-demo` | none | `CaseSummaryResponse[]` |

## AI Case Drafts

| Method | Route | Auth | Body/Query | Data |
| --- | --- | --- | --- | --- |
| `POST` | `/api/admin/ai-cases` | `ADMIN` or `VIP` | `{ "prompt": "...", "stageCount": 4, "difficulty": "medium", "visualStyle": "cinematic detective" }` | `AiDraftResponse` |
| `GET` | `/api/admin/ai-cases` | `ADMIN` | none | `AiDraftResponse[]` without generated JSON |
| `GET` | `/api/admin/ai-cases/{draftId}` | `ADMIN` | none | `AiDraftResponse` with generated JSON |
| `POST` | `/api/admin/ai-cases/{draftId}/import?overwrite=false` | `ADMIN` | query | `CaseSummaryResponse` |
| `POST` | `/api/admin/ai-cases/{draftId}/publish?overwrite=false` | `ADMIN` | query | `CaseSummaryResponse` |

AI statuses:

- `GENERATED_INVALID`
- `MOCK_GENERATED_VALID`
- `DEEPSEEK_GENERATED_VALID`
- `IMPORTED`

## Health

| Method | Route | Auth | Data |
| --- | --- | --- | --- |
| `GET` | `/health` | Anonymous | `{ "status": "ok" }` |

## SignalR

Hub URL: `/hubs/game`

JWT is passed by the browser client as `?access_token=...`.

Client methods:

- `JoinRoom(roomId)`
- `LeaveRoom(roomId)`
- `UpdatePlayerPose(roomId, { sceneId, x, y, direction, moving })`

`UpdatePlayerPose` is for transient 2D character presentation. It is not persisted to `gameplayState` and must not be used as proof that a gameplay interaction is allowed unless server-side proximity validation is added later.

Server events currently emitted:

- `PlayerJoined`
- `PlayerLeft`
- `RolesUpdated`
- `ReadyUpdated`
- `GameStarted`
- `GameStateUpdated`
- `ItemFound`
- `ClueUnlocked`
- `DialogueAnswered`
- `EvidencePresented`
- `SceneChanged`
- `StageChanged`
- `GameCompleted`
- `SystemMessage`
- `RoomError`
- `PlayerPoseUpdated`
- `PlayerPoseLeft`

Reconnect rule: after reconnect, call `JoinRoom(roomId)` again and refetch `GET /api/game/rooms/{roomId}/state`.

Movement/sync design details are documented in `PLAYER_MOVEMENT_SYSTEM.md` and `REALTIME_CHARACTER_SYNC.md`.

## Status Codes

| Status | Meaning |
| --- | --- |
| `400` | Invalid state transition or invalid body |
| `401` | Missing/invalid JWT |
| `403` | Role, room membership, locked account, or admin permission failure |
| `404` | Missing room, case, item, dialogue, draft, or result |
| `409` | Conflict such as duplicate email, full room, duplicate role, concurrent state write |
| `422` | Valid JSON payload that cannot be parsed/processed as a valid case |
| `502` | Deepseek/provider failure |
