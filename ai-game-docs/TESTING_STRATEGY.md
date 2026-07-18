# Testing Strategy

Last synced with code: 2026-07-18.

## Test Layers

| Layer | Current coverage |
| --- | --- |
| Backend unit tests | xUnit tests for complete condition and case validation |
| Backend integration/smoke | `scripts/e2e_smoke.py` exercises auth, admin seed/publish, room flow, gameplay, accusation, AI mock; GitHub Actions runs it against MongoDB |
| Frontend static checks | `npm run typecheck`, `npm run build` in GitHub Actions |
| Frontend browser smoke | Playwright smoke coverage for the gameplay UI; manual QA remains required for Phaser rendering and realtime interaction |

## Commands

From repository root:

```powershell
dotnet test SirLocked.sln
```

From frontend folder:

```powershell
cd src/FE
npm run typecheck
npm run build
```

With backend running at `http://localhost:5215`:

```powershell
python scripts/e2e_smoke.py --base http://localhost:5215
```

## Backend Unit Tests

`CompleteConditionTests` verifies:

- `AND` requires every listed item, clue, and dialogue.
- `OR` accepts one fully satisfied non-empty group.
- empty `OR` is never satisfied.
- empty `AND` is satisfied.

`CaseValidationServiceTests` verifies:

- sample case is valid,
- sample shape stays within expected demo ranges,
- duplicate IDs are rejected,
- missing scene item references are rejected,
- final evidence cannot use item IDs,
- final evidence clues must set `isEvidence`,
- unreachable unlock cycles are rejected,
- undiscoverable final evidence is rejected,
- invalid complete condition logic is rejected,
- `MockCaseFactory` produces valid cases for multiple stage counts.

## Smoke Test Coverage

The Python smoke test:

- logs in as seeded admin,
- seeds and publishes sample case,
- validates a broken case,
- registers two players,
- creates and joins a room,
- verifies duplicate roles fail,
- starts a game,
- verifies role enforcement,
- plays through scenes by inspecting/asking/completing,
- verifies accusation availability,
- submits correct accusation,
- retrieves result from partner account,
- verifies wrong accusation creates a fail result in a second room,
- generates and publishes an AI/mock draft.

## Manual QA Checklist

- Login/register form errors render clearly.
- Admin can seed and publish cases.
- Two separate browser sessions can join the same room.
- Lobby updates after role and ready changes.
- Start button is host-only.
- Game screen renders background, hotspots, dialogue, clue board, action log, and players.
- Investigator cannot ask dialogue.
- Interrogator cannot inspect items.
- Locked hotspots/dialogues show an understandable disabled state.
- Scene progression opens the next location.
- Reconnect refetches state.
- Final accusation shows win and fail endings.

## Gaps

- No automated SignalR reconnect test.
- The API smoke test uses a real MongoDB service in CI, but the xUnit suite has no reusable MongoDB integration fixture.
- No load/performance test.
- No visual regression testing for Phaser/canvas.
