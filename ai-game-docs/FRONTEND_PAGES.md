# Frontend Pages

Use the existing React + Vite JavaScript/JSX structure. Do not migrate to TypeScript for MVP.

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
  - main playable scene renderer
  - background
  - hotspots
  - enforce role-specific UI affordances: investigator item actions, interrogator dialogue actions
  - characters
  - item inspection
  - dialogue
  - investigation notebook / clue board
  - investigation map for current, visited, and unlocked scenes
  - current objective/hint panel
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

## Game Components

Place reusable game components under `src/FE/src/components/game` if feasible:

- `GameScene`
- `SceneBackground`
- `HotspotLayer`
- `CharacterPanel`
- `DialoguePanel`
- `ItemInspectPanel`
- `InvestigationNotebook`
- `ClueBoard`
- `EvidenceBoard`
- `CharacterNotebook`
- `InvestigationMap`
- `ObjectiveHintPanel`
- `StageProgress`
- `FinalAccusationModal`
- `AccusationReview`
- `GameLogPanel`

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

Use a shared gameplay state store if the component tree becomes non-trivial. React Context is enough for MVP; Zustand is acceptable if already added. The store should keep:

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
