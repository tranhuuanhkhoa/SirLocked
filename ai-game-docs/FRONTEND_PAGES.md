# Frontend Pages

Last synced with code: 2026-06-12.

Frontend stack: Vite SPA, JavaScript modules, hash routing, SignalR client, Phaser/TypeScript gameplay renderer.

## Routes

Routes are defined in `src/FE/Client/js/main.js`.

| Hash route | Page module | Access |
| --- | --- | --- |
| `#/login` | `loginPage.js` | Anonymous |
| `#/cases` | `casesPage.js` | Logged-in user |
| `#/cases/{caseId}` | `caseDetailPage.js` | Logged-in user |
| `#/create-room` | `createRoomPage.js` | Logged-in user |
| `#/join` | `joinRoomPage.js` | Logged-in user |
| `#/lobby/{roomId}` | `lobbyPage.js` | Room member |
| `#/game/{roomId}` | `gamePage.ts` | Room member |
| `#/result/{roomId}` | `resultPage.js` | Room member |
| `#/admin` | `adminDashboardPage.js` | `ADMIN` |
| `#/admin/cases` | `adminCasesPage.js` | `ADMIN` |
| `#/admin/cases/{caseId}` | `adminCaseDetailPage.js` | `ADMIN` |
| `#/admin/import` | `adminImportPage.js` | `ADMIN` |
| `#/admin/ai` | `adminAiPage.js` | `ADMIN` or `VIP` |

Default redirect:

- Anonymous user: `#/login`
- `ADMIN`: `#/admin`
- `VIP`: `#/admin/ai`
- `PLAYER`: `#/cases`

## Navigation

Logged-in users see:

- brand link to `#/cases`,
- Cases,
- Create Room,
- Join Room,
- logout.

`ADMIN` also sees Dashboard and Manage Cases.

`ADMIN` and `VIP` see AI Creator.

## API Client

`src/FE/Client/js/api/http.js`:

- adds `Content-Type: application/json`,
- adds JWT bearer token when present,
- unwraps backend `{ success, message, data, errors }`,
- redirects to `#/login` on `401` if a session exists,
- throws `{ status, message, errors }` on failure.

API wrappers:

- `authApi.js`
- `caseApi.js`
- `roomApi.js`
- `gameApi.js`
- `adminApi.js`
- `aiCaseApi.js`

## Realtime Client

`src/FE/Client/js/services/signalrClient.js`:

- connects to `/hubs/game`,
- sends JWT through `accessTokenFactory`,
- uses reconnect delays `[0, 1000, 3000, 5000, 10000]`,
- invokes `JoinRoom(roomId)` after connect and reconnect,
- leaves state recovery to the page by refetching API state.

## Required Page Behavior

### Login

- Register/login through `/api/auth`.
- Store token and user in session.
- Redirect based on role.

### Cases

- Call `GET /api/cases/published`.
- Show case title, summary, cover, counts, and estimated minutes.
- Allow opening detail or creating a room from a case.

### Create Room

- Select a published case.
- Call `POST /api/rooms`.
- Navigate to `#/lobby/{roomId}`.

### Join Room

- Accept room code.
- Call `POST /api/rooms/join`.
- Navigate to lobby.

### Lobby

- Fetch room by `GET /api/rooms/{roomId}`.
- Connect SignalR and join room group.
- Render players, roles, ready state, host actions.
- Call select-role, ready, start, and leave endpoints.
- Move to game route after game starts.

### Game

- Fetch `GET /api/game/rooms/{roomId}/state` on load and reconnect.
- Render visible scene background, hotspots, characters, dialogues, clue board, objective, scene map, players, action log.
- Investigator item clicks call `inspect-item`.
- Interrogator dialogue clicks call `ask-dialogue`.
- Complete action calls `complete-scene`.
- Scene map calls `go-to-scene` only for visited scenes.
- Final accusation uses `accuse` when `availableForAccusation` is true.

For the next 2D co-op direction, this page should also render Sherlock/Watson-style player sprites that move independently inside the current scene:

- local player movement from keyboard/touch input,
- remote player movement from `PlayerPoseUpdated`,
- pose sending through `UpdatePlayerPose`,
- interaction prompts only when near item/character zones,
- movement/runtime metadata from `SCENE_RUNTIME_SCHEMA.md` when available.

The existing API gameplay commands remain authoritative. Movement only changes how the player reaches an interaction.

### Result

- Fetch `GET /api/game/rooms/{roomId}/result`.
- Show win/fail ending, selected culprit, correct culprit, method, motive, and required evidence.

### Admin

- Dashboard calls `/api/admin/dashboard`.
- Users list supports lock/unlock and role changes.
- Cases pages support list/detail/publish/unpublish.
- Import page validates/imports JSON.
- AI page generates draft JSON and, for admin, lists/imports/publishes drafts.

## Current Limitations

- Frontend route protection is client-side convenience; backend still enforces authorization.
- Persistent chat UI is not implemented.
- Image upload/generation UI is not implemented.
- Scene runtime layout metadata is target design, not required for all current cases.
- Public case detail intentionally hides full puzzle logic.
