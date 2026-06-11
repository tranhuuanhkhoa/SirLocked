# Realtime Character Sync

Status: target design layered on the current SignalR hub. Current implementation has `UpdatePlayerPose`, `PlayerPoseUpdated`, and `PlayerPoseLeft`.

## Goal

Keep both players visible in the same 2D scene without making movement traffic interfere with authoritative gameplay state updates.

## Current SignalR Contract

Hub:

```txt
/hubs/game
```

Client invokes:

```txt
JoinRoom(roomId)
LeaveRoom(roomId)
UpdatePlayerPose(roomId, pose)
```

Pose payload:

```json
{
  "sceneId": "scene-study",
  "x": 420,
  "y": 680,
  "direction": "right",
  "moving": true
}
```

Server clamps:

- `x`: `0..5000`
- `y`: `0..5000`
- `direction`: `left` or `right`

Server broadcasts to other group members:

- `PlayerPoseUpdated`
- `PlayerPoseLeft`

## Authority Model

Recommended model for the next iteration:

- Gameplay rules are server-authoritative.
- Character movement is client-authoritative with server relay.
- Server validates membership and clamps extreme coordinates.
- Clients ignore impossible or stale movement data.

This is pragmatic for a classroom MVP because movement is presentation and does not decide clue unlocks. If future puzzles depend on exact position, add server-side position validation before unlock commands.

## Event Payloads

`PlayerPoseUpdated`:

```json
{
  "roomId": "room-id",
  "userId": "user-id",
  "username": "Player Name",
  "role": "INVESTIGATOR",
  "sceneId": "scene-study",
  "x": 420,
  "y": 680,
  "direction": "right",
  "moving": true,
  "updatedAt": "2026-06-12T00:00:00Z"
}
```

`PlayerPoseLeft`:

```json
{
  "roomId": "room-id",
  "userId": "user-id"
}
```

## Client Send Rules

- Send after `JoinRoom(roomId)` succeeds.
- Send at 8-12 Hz while moving.
- Send immediately when direction changes.
- Send immediately when movement stops.
- Send immediately after scene transition.
- Stop sending when leaving the game page.

## Client Receive Rules

- Do not render a remote pose if `sceneId` differs from the local visible scene.
- Store the latest pose per `userId`.
- Interpolate remote x/y toward target position over 100-200 ms.
- Snap if distance is very large or after reconnect.
- Use `moving` and `direction` to pick animation.
- Remove or fade remote player on `PlayerPoseLeft`.

## Reconnect Flow

1. SignalR reconnects.
2. Client invokes `JoinRoom(roomId)`.
3. Client refetches `GET /api/game/rooms/{roomId}/state`.
4. Client sends current local pose.
5. Remote pose cache is treated as temporary; stale poses expire.

## Stale Pose Handling

Each remote pose should have a local received timestamp. If no update arrives for 5-10 seconds:

- keep the teammate visible but idle, or
- fade them and show a reconnect indicator.

Do not use stale pose data for gameplay decisions.

## Relationship To GameStateUpdated

`GameStateUpdated` remains authoritative for puzzle state:

- current scene,
- unlocked clues,
- inspected items,
- asked dialogue,
- final accusation readiness.

Pose events are visual-only. They should not mutate clue or progression state.

## Future Server-Side Position Storage

Only add persistent position to `gameplayState` when needed for:

- reconnecting exactly where players stood,
- puzzles requiring both players to stand in locations,
- server-side proximity validation,
- replay/history.

Until then, pose sync can stay transient through SignalR.
