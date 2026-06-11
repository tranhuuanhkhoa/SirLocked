# UI/UX Requirements

Last synced with code: 2026-06-12.

## Product Feel

SirLocked should feel like a focused detective game tool, not a marketing site. The UI should prioritize:

- readable mystery content,
- fast room coordination,
- clear role boundaries,
- visible evidence progress,
- low-friction final deduction.

## Global Layout

- Authenticated app shows a persistent top nav.
- Navigation adapts by user role.
- Game route may use a more immersive layout but must keep important controls visible.
- Avoid nested cards and oversized hero sections inside operational screens.

## Case Browsing

Case cards should show:

- title,
- summary,
- estimated minutes,
- cover image or safe placeholder,
- stage/scene/character/item/clue/dialogue counts when available,
- clear action to view or create room.

Players should not see hidden final logic in public case pages.

## Lobby UX

Lobby must make these states obvious:

- room code,
- host,
- player list,
- selected roles,
- ready state,
- missing second player,
- duplicate role prevention,
- host-only start.

Role controls should be explicit segmented/button choices:

- Investigator: physical evidence.
- Interrogator: witness questioning.

## Game UX

Game screen should show:

- current objective,
- current scene title and description,
- scene background,
- clickable hotspots,
- characters in current scene,
- available dialogue,
- clue/evidence notebook,
- visited scene map,
- players/roles,
- action log,
- final accusation panel when available.

The frontend may show locked hotspots/dialogues as disabled with missing requirement hints, but it must not reveal hidden final logic too early.

## Role-Specific UX

Investigator:

- can interact with item hotspots,
- sees item inspect text and unlocked clues.

Interrogator:

- can ask dialogue questions,
- sees answers and unlocked clues.

Wrong-role actions should be visually disabled where practical, but backend errors must still be handled cleanly.

## Progression UX

Do not show the game as disconnected "stage complete" screens. Translate progression into investigation language:

- new location opened,
- new objective available,
- all leads in this room are exhausted,
- final confrontation is ready.

Scene map should allow only visited scenes. Future scenes must not be clickable.

## Final Accusation UX

Final accusation appears only when `availableForAccusation` is true.

Panel should include:

- suspect selection,
- evidence clue selection,
- optional motive/method text fields,
- confirmation before submit,
- clear win/fail result.

Evidence selection must use clue IDs from `evidenceClues`, not item IDs.

## Realtime UX

- Lobby and game screens should react to SignalR events.
- On reconnect, show a lightweight reconnecting state and refetch API state.
- Treat `GameStateUpdated` as source of truth.
- Detail events can drive toast messages.

## Accessibility

- All buttons need visible text or accessible labels.
- Hotspots need labels.
- Color cannot be the only indicator for locked/ready/success/fail.
- Text must remain readable over scene imagery.
- Keyboard users should be able to reach primary controls.

## Current UI Limitations

- Persistent room chat is not required.
- Image generation/upload workflow is not required.
- Full admin case editing is not implemented.
- Phaser/canvas rendering needs manual visual QA.
