# Player Movement System

Status: target design for the next SirLocked 2D co-op direction. Current code already has a Phaser gameplay renderer and SignalR pose broadcast, but movement collision/interaction validation is still primarily client-side.

## Goal

Move SirLocked from a UI-only point-and-click investigation toward a 2D co-op scene where Sherlock and Watson can move independently inside the same location, approach objects, and interact in context.

## Playable Characters

| Role | Character fantasy | Gameplay responsibility |
| --- | --- | --- |
| `INVESTIGATOR` | Sherlock-style physical evidence specialist | Walk to evidence, inspect objects, collect item clues |
| `INTERROGATOR` | Watson-style witness/social specialist | Walk to characters, ask questions, unlock testimony clues |

The exact visual names may be Sherlock/Watson in UI and assets, but backend role IDs should remain `INVESTIGATOR` and `INTERROGATOR` unless a migration is explicitly planned.

## Movement Model

Initial movement scope:

- Horizontal movement: left/right.
- Optional vertical lane movement later if scene design needs it.
- Idle and walk animation states.
- Facing direction: `left` or `right`.
- Local player input is immediate.
- Remote player is rendered from SignalR pose events.

Recommended local movement fields:

```json
{
  "sceneId": "scene-study",
  "x": 420,
  "y": 680,
  "direction": "right",
  "moving": true
}
```

Current SignalR method already accepts this shape through `UpdatePlayerPose`.

## Controls

Minimum desktop controls:

- `A` or left arrow: move left.
- `D` or right arrow: move right.
- `E` or primary action button: interact with nearby object/character.

Minimum mobile controls:

- left/right touch buttons or joystick.
- interact button appears when near an interactable.

## Animation States

Required states:

- `idle-left`
- `idle-right`
- `walk-left`
- `walk-right`

Optional future states:

- `inspect`
- `talk`
- `point`
- `thinking`
- `accuse`

Animation state is derived from direction and movement. It does not need to be stored by the backend for MVP; it can be computed by clients.

## Scene Bounds And Collision

The client should clamp movement to the current scene walkable range.

Minimum scene runtime fields:

```json
{
  "sceneId": "scene-study",
  "runtime": {
    "width": 1600,
    "height": 900,
    "floorY": 720,
    "walkBounds": {
      "minX": 120,
      "maxX": 1480
    }
  }
}
```

For the first movement version, horizontal clamping is enough. Polygon collision can be added later in `SCENE_RUNTIME_SCHEMA.md`.

## Interaction Rules

Movement should change how interactions are triggered, not the backend gameplay rules.

Current backend commands remain:

- `inspect-item`
- `ask-dialogue`
- `present-evidence`
- `complete-scene`
- `go-to-scene`
- `accuse`

New client-side rule:

- Player must be near an interactable before the UI enables the action.

Interaction proximity uses scene runtime metadata:

```json
{
  "interactionZone": {
    "x": 460,
    "y": 700,
    "radius": 90
  }
}
```

Backend still validates role, current scene, clue requirements, and progression. Proximity can start client-side; move it server-side only if cheating matters for the course/demo.

## Local And Remote Players

Local player:

- receives keyboard/touch input,
- updates immediately,
- periodically sends pose to SignalR.

Remote player:

- never uses local input,
- updates from `PlayerPoseUpdated`,
- interpolates between received positions,
- disappears or fades after `PlayerPoseLeft`.

## Recommended Send Rate

- Send pose at 8-12 times per second while moving.
- Send one final pose when movement stops.
- Do not send every animation frame.

## Relationship To Current Gameplay

The existing clue/dialogue/progression logic stays valid. The movement system adds spatial presentation:

- Instead of clicking an item in a static list, the investigator walks near it and presses interact.
- Instead of opening all dialogue from a side panel only, the interrogator walks near a character and opens available questions.
- Scene completion still calls the backend once the current objective is satisfied.

## Implementation Notes

- Keep movement as a frontend/runtime layer first.
- Keep backend commands unchanged until server-side movement authority is required.
- Use `sceneId` in every pose to avoid rendering a remote player in the wrong scene.
- Ignore remote poses for a different scene unless the UI intentionally shows off-screen teammate indicators.
