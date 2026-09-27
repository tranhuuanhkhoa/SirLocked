# Scene Runtime Schema

Status: implemented optional extension for the 2D scene renderer.

## Goal

`hotspots` stay as gameplay triggers and legacy percent fallback. `runtime` is the renderer source of truth for pixel-accurate placement inside a logical 1600x900 world:

- walk bounds and player spawn points,
- item sprite placement separate from item hitboxes,
- NPC placement separate from character hitboxes,
- scene transition zones.

Existing cases remain valid when `runtime` is missing.

## Scene Field

Each scene may include:

```json
{
  "sceneId": "scene-study",
  "runtime": {
    "width": 1600,
    "height": 900,
    "floorY": 720,
    "walkableArea": { "x": 0, "y": 630, "width": 1600, "height": 135 },
    "spawnPoints": {
      "default": { "x": 240, "y": 720, "anchor": "bottom-center", "direction": "right" },
      "INVESTIGATOR": { "x": 240, "y": 720, "anchor": "bottom-center", "direction": "right" },
      "INTERROGATOR": { "x": 320, "y": 720, "anchor": "bottom-center", "direction": "right" }
    },
    "itemPlacements": [],
    "characterPlacements": [],
    "transitions": []
  }
}
```

## Coordinate Rules

- Origin is top-left.
- `x` grows right, `y` grows down.
- Coordinates are logical scene pixels, independent from browser size.
- The current Lumiere case uses `width: 1600` and `height: 900`.
- `floorY` is the player feet line.
- Characters and most props use `anchor: "bottom-center"` so `position.y` is their feet or bottom edge.
- The renderer scales all runtime coordinates to the actual full-screen Phaser frame.

## Walkable Area

```json
{
  "walkableArea": { "x": 0, "y": 630, "width": 1600, "height": 135 },
  "floorY": 720
}
```

The current movement model is horizontal only (`A` and `D`). `walkableArea.x` and `walkableArea.width` clamp movement; `floorY` fixes the vertical feet position.

## Item Placements

```json
{
  "itemId": "item-ledger",
  "asset": "/assets/items/ledger.png",
  "position": { "x": 712, "y": 558, "anchor": "bottom-center" },
  "size": { "width": 144, "height": 108 },
  "hotspot": { "x": 640, "y": 450, "width": 144, "height": 108 },
  "reservedSlot": { "x": 640, "y": 450, "width": 144, "height": 108 },
  "anchor": "bottom-center",
  "depth": 12
}
```

`reservedSlot` documents the intended visual slot from `asset-prompts.json`. `hotspot` is the click/proximity box and may be larger than the visual sprite when needed, but it should not be used as the only source for sprite placement.

## Character Placements

```json
{
  "characterId": "char-victor",
  "position": { "x": 1112, "y": 702, "anchor": "bottom-center" },
  "size": { "width": 144, "height": 288 },
  "hotspot": { "x": 1040, "y": 414, "width": 144, "height": 288 },
  "reservedSlot": { "x": 1040, "y": 414, "width": 144, "height": 288 },
  "anchor": "bottom-center",
  "direction": "left",
  "depth": 702
}
```

NPC sprite gaps come from `asset-prompts.json` `npcGaps`. The renderer uses `direction` to flip NPC sprites where needed.

## Transition Zones

```json
{
  "transitionId": "exit-office-to-props",
  "targetSceneId": "scene-props-room",
  "label": "Props Room",
  "hotspot": { "x": 1374, "y": 640, "width": 190, "height": 54 },
  "depth": 22
}
```

The frontend only shows a transition when the target scene is already visited, or when the backend says the current scene can proceed and the target is the next scene.

## Validation

Backend validation checks:

- runtime width and height are positive,
- points and boxes fit inside the runtime dimensions,
- item placements reference real items listed in the same scene,
- character placements reference real characters listed in the same scene,
- transitions reference real scenes,
- runtime metadata remains optional for legacy cases.

## Debugging

Open a game URL with `debugLayout=1` or press `F2` in the Phaser view. The debug overlay draws:

- logical frame and 100px grid,
- walkable area and floor line,
- item slots, hotspots, and anchors,
- NPC gaps, hotspots, and anchors,
- transition zones,
- live screen/world pointer coordinates.
