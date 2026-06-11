# Frontend Pages

Use the existing React-free Vite JavaScript module structure for app screens. The gameplay page is implemented with Phaser 4 + TypeScript in `src/FE/Client/js/pages/gamePage.ts`.

## Public/Auth Pages

- `LoginPage`
  - email/password form
  - login API call
  - redirect by role

- `RegisterPage`
  - full name/email/password form
  - creates `PLAYER`

## Player Pages

- `CaseListPage`
  - shows published cases
  - title, summary, estimated minutes, cover image fallback

- `CaseDetailPage`
  - case overview
  - create room button
  - join room option/link

- `CreateRoomPage`
  - select case or use case from detail
  - creates room
  - redirects to lobby

- `JoinRoomPage`
  - room code input
  - joins room

- `RoomLobbyPage`
  - room code
  - copy code
  - player list
  - role selection
  - ready button
  - host start button
  - chat or messages, optional after MVP core flow
  - SignalR updates

- `GamePage`
  - case intro/briefing before the first playable scene if the room has just started
  - main playable scene renderer powered by Phaser
  - scene background rendered on the Phaser canvas
  - hotspots rendered from percent coordinates on the Phaser canvas
  - enforce role-specific UI affordances: investigator item actions, interrogator dialogue actions
  - characters rendered as scene interactables or fallback canvas figures
  - item inspection through HTML overlay panels
  - dialogue through HTML overlay panels
  - case file / clue board
  - investigation map for current, visited, and unlocked scenes
  - current objective/hint panel in the HUD
  - player-facing investigation progress, not prominent raw stage labels
  - final accusation with review/confirm step
  - persistent action log for unlocks, errors, and realtime partner actions
  - realtime updates
  - refetch state after SignalR reconnect

- `ResultPage`
  - win/fail result
  - culprit
  - selected evidence
  - ending text
  - optional case truth summary, clue counts, and replay/back actions

## Admin Pages

- `AdminDashboardPage`
  - total users/cases/rooms/results
  - quick actions

- `AdminCaseListPage`
  - all cases
  - status
  - publish/unpublish
  - detail link

- `AdminCaseDetailPage`
  - full JSON-ish case view
  - validation errors
  - publish/unpublish

- `ImportCaseJsonPage`
  - paste/upload JSON
  - validate
  - import

- `AiCaseCreatorPage`
  - prompt input
  - stage count/visual style if easy
  - create draft
  - show status
  - show generated JSON
  - show saved file paths
  - import generated case

## Game Renderer Structure

The current frontend does not use React components. Keep reusable gameplay code near the current page/module structure unless the app is intentionally migrated later:

- `src/FE/Client/js/pages/gamePage.ts`: Phaser game scene, room state binding, gameplay overlays.
- `src/FE/Client/js/api/gameApi.js`: gameplay HTTP actions.
- `src/FE/Client/js/services/signalrClient.js`: room SignalR connection and reconnect handling.
- `src/FE/css/09-app.css`: shared app styles plus Phaser canvas host and gameplay overlays.

If the renderer grows, split `gamePage.ts` into focused TypeScript modules such as `PhaserGameScene`, `gameOverlayTemplates`, and `gameTypes`.

## Gameplay UX Rules

- Treat backend stage/scene data as implementation state. Player-facing UI should describe the current investigation objective and open locations instead of emphasizing `Stage 1`, `Stage 2`, or `Next Stage`.
- Use the investigation map instead of a stage-select screen. If free scene travel is not implemented, render it as a read-only overview until `go-to-scene` is safe.
- Character UI can use cards/panels for MVP. Do not require scene sprite placement unless the schema later adds character coordinates.
- Role-disabled actions should remain understandable: investigators can inspect items; interrogators can ask dialogue; both can view shared state and final evidence.
- Evidence selected for accusation must be clue IDs where `isEvidence: true`; never submit item IDs as final evidence.
- Every meaningful unlock should be reflected both as a toast/notice and as a persistent log entry.
- The final accusation must include a review/confirm step because a wrong accusation can finish the room with a fail result.

## Required UI States

Gameplay components should handle:

- loading state
- empty state
- missing image fallback
- locked hotspot/dialogue
- wrong-role action
- already inspected item
- already asked dialogue
- API error
- SignalR reconnecting/refetching
- completed room/result state

## API Clients

Use or extend:

- `authApi.js`
- `caseApi.js`
- `roomApi.js`
- `gameApi.js`
- `adminApi.js`
- `aiCaseApi.js`
- `signalrClient.js`

JWT must be attached by the shared API client.

## State Management

Use module-local state while the gameplay page remains a single Phaser/HTML hybrid page. If the renderer becomes non-trivial, introduce a small TypeScript gameplay store before adding a new framework. The store should keep:

- latest `GameStateResponse`
- current `version`
- connection status
- transient toast/log messages
- selected final evidence clue IDs
- whether the case intro has been dismissed for this room/session
- selected notebook tab
- selected/current character or item panel
- final accusation draft before review/submit

SignalR detail events should update toasts/logs. `GameStateUpdated` or `GET /api/game/rooms/{roomId}/state` should replace canonical gameplay state.
