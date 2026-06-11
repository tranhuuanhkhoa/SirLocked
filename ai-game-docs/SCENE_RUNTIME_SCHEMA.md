# Scene Runtime Schema

Status: target schema for the 2D movement direction. Current `GameCase` supports scenes, hotspots, items, characters, and backgrounds, but does not yet persist full movement layout metadata.

## Goal

Add enough scene runtime metadata for a 2D co-op scene:

- spawn points,
- walk bounds,
- interaction zones,
- object positions,
- character positions,
- transition zones.

The schema should extend the current case JSON without breaking existing cases.

## Extension Strategy

Use optional fields. Existing cases remain valid when runtime metadata is missing.

Recommended new field on each scene:

```json
{
  "sceneId": "scene-study",
  "runtime": {
    "width": 1600,
    "height": 900,
    "cameraMode": "side-scroller",
    "floorY": 720,
    "walkBounds": {
      "minX": 120,
      "maxX": 1480
    },
    "spawnPoints": {},
    "interactables": [],
    "transitions": []
  }
}
```

## Scene Runtime

| Field | Type | Purpose |
| --- | --- | --- |
| `width` | number | Internal scene coordinate width |
| `height` | number | Internal scene coordinate height |
| `cameraMode` | string | `side-scroller` for initial left/right movement |
| `floorY` | number | Default y coordinate for character feet |
| `walkBounds` | object | Simple horizontal movement clamp |
| `walkPolygons` | array | Optional future polygon walkable areas |
| `spawnPoints` | object | Role-based entry positions |
| `interactables` | array | Runtime hitboxes/zones mapped to item/character/dialogue targets |
| `transitions` | array | Doors/exits mapped to scene IDs |

## Spawn Points

```json
{
  "spawnPoints": {
    "default": { "x": 180, "y": 720, "direction": "right" },
    "INVESTIGATOR": { "x": 160, "y": 720, "direction": "right" },
    "INTERROGATOR": { "x": 230, "y": 720, "direction": "right" }
  }
}
```

Use role-specific spawn points when present. Fall back to `default`.

## Interactables

Interactables connect movement proximity to existing gameplay IDs.

```json
{
  "interactableId": "int-bitter-glass",
  "type": "ITEM",
  "targetId": "item-bitter-glass",
  "label": "Crystal glass",
  "x": 460,
  "y": 700,
  "width": 90,
  "height": 80,
  "interactionRadius": 90,
  "requiredClueIds": [],
  "allowedRoles": ["INVESTIGATOR"]
}
```

Types:

- `ITEM`
- `CHARACTER`
- `EXIT`
- `CLUE_AREA`

For compatibility, current `hotspots` can be transformed into `interactables` by scaling percentage coordinates into scene pixels.

## Character Placement

Characters in a scene can optionally have runtime positions:

```json
{
  "characterPlacements": [
    {
      "characterId": "char-edgar",
      "x": 1080,
      "y": 720,
      "direction": "left",
      "interactionRadius": 120
    }
  ]
}
```

If missing, the renderer can auto-place characters based on scene layout.

## Transition Zones

```json
{
  "transitionId": "door-to-corridor",
  "targetSceneId": "scene-servants-corridor",
  "x": 1450,
  "y": 700,
  "width": 90,
  "height": 180,
  "requiredClueIds": ["clue-staged-lock"],
  "label": "Servants' corridor"
}
```

Transition zones should not bypass backend progression. The client may show them only when the target scene is already visited or when backend progression has opened it.

## Coordinate Conventions

- Origin is top-left.
- `x` grows right.
- `y` grows down.
- Character feet stand at `y`.
- Scene sizes are logical coordinates independent of rendered CSS pixels.
- Renderer scales logical coordinates to viewport.

## AI Generation Requirements

When AI supports runtime layouts, it should generate:

- scene width/height,
- role spawn points,
- floorY,
- walk bounds,
- item interactable positions,
- character placement,
- transition zones,
- UI-safe areas if needed.

AI must keep generated `targetId` values aligned with existing `itemIds`, `characterIds`, and scene progression.

## Validation Requirements

Future backend validation should check:

- runtime dimensions are positive,
- spawn points are inside walk bounds,
- interactable target IDs exist,
- interactable roles are valid,
- transition target scenes exist,
- interactable boxes fit inside scene dimensions,
- required clue IDs exist.

Do not require runtime metadata for legacy cases until the renderer depends on it.
