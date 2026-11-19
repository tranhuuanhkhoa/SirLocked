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

## Pixel render mode (`runtime.render`)

Chế độ tùy chọn cho cảnh pixel art thuần (ảnh PixelLab). Model C#: `SceneRenderSettings`, `SceneWalkGrid`, `SceneForegroundLayer` trong `src/BE/Models/GameCase.cs`. Validator: `ValidateRenderSettings` trong `src/BE/Services/CaseValidationService.cs`. Renderer: phần "pixel scenes" của `src/FE/Client/js/pages/gamePage.ts`. Case mẫu: [pixel-case-lo-thuoc-thu-nam](pixel-case-lo-thuoc-thu-nam/README.md).

**Cảnh không có `render` giữ nguyên như cũ:** renderer side-view cổ điển, khung logic 1600×900, đi ngang. Validator bỏ qua toàn bộ phần dưới đây khi `render` là `null`. FE cũng dùng renderer cũ khi `mode` khác `pixel`, hoặc khi `pixelScale`/`nativeWidth` không dương.

```json
{
  "runtime": {
    "width": 2048,
    "height": 2048,
    "walkableArea": { "x": 32, "y": 128, "width": 1984, "height": 1904 },
    "navigationObstacles": [],
    "spawnPoints": {
      "default": { "x": 1120, "y": 1248, "anchor": "bottom-center", "direction": "right" },
      "INVESTIGATOR": { "x": 1048, "y": 1248, "anchor": "bottom-center", "direction": "right" },
      "INTERROGATOR": { "x": 1192, "y": 1248, "anchor": "bottom-center", "direction": "right" },
      "from:scene-px-nha-so-7": { "x": 392, "y": 1288, "anchor": "bottom-center", "direction": "right" }
    },
    "render": {
      "mode": "pixel",
      "projection": "topdown",
      "nativeWidth": 512,
      "nativeHeight": 512,
      "pixelScale": 4,
      "cameraZoom": 1.0,
      "actorScale": 1.5,
      "walkSpeed": 300,
      "interactRadius": 120,
      "backdropColor": "#3c4a55",
      "walkGrid": { "cellSize": 16, "cols": 128, "rows": 128, "data": ["0000...", "..."] },
      "foreground": [
        { "id": "lamp-1", "url": "/assets/pixel/lo-thuoc-thu-nam/fg/pho-lamp-1.png",
          "x": 904, "y": 544, "width": 64, "height": 296, "baseY": 840 }
      ]
    }
  }
}
```

### Đơn vị

- Đơn vị runtime vẫn là đơn vị gốc của mọi toạ độ trong `runtime`: spawn, hotspot, placement, transition, clue zone, foreground.
- **1 pixel native của ảnh nền = `pixelScale` đơn vị runtime.** Do đó `runtime.width = nativeWidth × pixelScale` và `runtime.height = nativeHeight × pixelScale`. Ảnh 512 với `pixelScale` 4 cho khung 2048×2048.
- Nền vẽ nearest-neighbour. FE làm tròn sao cho 1 pixel native luôn là số nguyên pixel màn hình: `nativePixel = max(1, round(fit × cameraZoom × pixelScale))`, với `fit = max(canvasWidth/1600, canvasHeight/900)`. Màn hình có `nativePixel / pixelScale` pixel cho mỗi đơn vị runtime.
- Camera bám theo người chơi. Khung nhỏ hơn canvas thì được căn giữa.
- Hotspot phần trăm (`scene.hotspots`) vẫn bắt buộc như trước, tính theo `runtime.width/height`.

### Các trường

| Trường | Kiểu | Đơn vị / ý nghĩa | Quy tắc validator |
| --- | --- | --- | --- |
| `mode` | string | Luôn là `"pixel"` | Phải bằng `pixel` |
| `projection` | string | `topdown` (bản đồ ngoài trời) hoặc `isometric` (phòng 2:1) | Một trong hai giá trị |
| `nativeWidth`, `nativeHeight` | int | Kích thước ảnh nền gốc, pixel native | 1–4096 |
| `pixelScale` | number | Đơn vị runtime trên mỗi pixel native | > 0 và ≤ 16. `nativeWidth × pixelScale` và `nativeHeight × pixelScale` lệch `runtime.width/height` không quá 1 |
| `cameraZoom` | number | Pixel màn hình trên mỗi đơn vị runtime, ở khung tham chiếu 1600×900, trước khi làm tròn | > 0 và ≤ 8 |
| `actorScale` | number | Đơn vị runtime trên mỗi pixel sprite của người chơi và NPC | > 0 và ≤ 16 |
| `walkSpeed` | number | Đơn vị runtime mỗi giây | > 0 và ≤ 5000 |
| `interactRadius` | number | Khoảng cách runtime từ chân người chơi tới điểm tiếp cận của tương tác. FE chọn hotspot/cửa gần nhất trong 1.35 × `interactRadius` | > 0 và ≤ 2000 |
| `backdropColor` | string | Màu nền camera ngoài khung ảnh | Rỗng hoặc `#RRGGBB` |
| `walkGrid` | object \| null | Lưới đi được, xem dưới | Xem dưới |
| `foreground` | array | Cut-out vẽ đè lên nhân vật, xem dưới | Không `null`, tối đa 64 lớp |

Mọi lỗi trên có mã `InvalidRenderSettings`, path `stages[..].scenes[..].runtime.render.<field>`. Riêng spawn nằm trên ô bị chặn có mã `BlockedNavigation`.

### Walk grid

```json
{ "cellSize": 16, "cols": 128, "rows": 128, "data": ["0001110...", "..."] }
```

- `cellSize` là đơn vị runtime mỗi ô. Case mẫu dùng 16 = 4 pixel native.
- `data` có đúng `rows` chuỗi, mỗi chuỗi dài đúng `cols` ký tự. `'1'` là chỗ đặt bàn chân được, `'0'` là bị chặn. Hàng 0 ở trên cùng.
- Điểm (x, y) đi được khi ô `data[floor(y / cellSize)][floor(x / cellSize)]` là `'1'`. Điểm âm, không hữu hạn hoặc ngoài lưới bị coi là chặn (`SceneWalkGrid.IsWalkable`).
- Validator:
  - `cellSize` > 0, `cols`/`rows` trong 1–512.
  - `cols × cellSize = runtime.width` và `rows × cellSize = runtime.height`, khớp đúng.
  - Có ít nhất một ô `'1'`.
  - Mọi `spawnPoints` nằm trên ô đi được.
- Khi có `walkGrid`, FE tìm đường trên lưới và bỏ qua `navigationObstacles`. `walkableArea` vẫn kẹp vị trí người chơi, nên phải bao trọn vùng đi được. Thiếu `walkGrid` thì FE quay về `walkableArea` + `navigationObstacles`.
- Điểm tiếp cận của hotspot và cửa là ô đi được gần nhất với trung điểm cạnh dưới của hộp hotspot (`gridApproachPoint`). Phải để ô đi được sát trước mỗi vật, NPC và cửa.

### Foreground (vật che)

```json
{ "id": "lamp-1", "url": "/assets/pixel/<case>/fg/pho-lamp-1.png", "x": 904, "y": 544, "width": 64, "height": 296, "baseY": 840 }
```

- `x`, `y`, `width`, `height`: hộp runtime nơi vẽ ảnh cut-out. Cut-out có alpha, cắt đúng từ ảnh nền nên trùng khít khi vẽ đè.
- `baseY`: đường vật chạm đất, đơn vị runtime.
- **Quy tắc độ sâu:** bàn chân nhân vật có y < `baseY` (đứng phía sau vật) thì cut-out được vẽ đè lên nhân vật. y > `baseY` thì nhân vật vẽ trước vật. Người chơi, NPC và cut-out cùng dùng độ sâu `30 + clamp(y / runtime.height, 0, 1) × 60`, với y là chân nhân vật hoặc `baseY`.
- Trường hợp y = `baseY` không xác định trước/sau. Chặn vùng chân vật trong `walkGrid` để nhân vật không đứng đúng đường đó.
- Validator:
  - `url` là đường dẫn `/assets/...` an toàn (không `..`, không `\`) hoặc URL http(s).
  - Hộp nằm trọn trong `runtime.width/height`, rộng/cao dương.
  - `baseY` hữu hạn, trong 0–`runtime.height`.

### Cửa và spawn theo cửa

- Cửa là `runtime.transitions` như cảnh thường. Bản đồ có một transition trước mỗi cửa tòa nhà. Mỗi phòng có một transition ở ngưỡng cửa dẫn ra bản đồ.
- Khi người chơi vào cảnh pixel từ cảnh `X`, FE dùng `spawnPoints["from:X"]` nếu có. Ví dụ ra khỏi nhà số 7 dùng `"from:scene-px-nha-so-7"` trên bản đồ. Toạ độ được dùng nguyên, không cộng độ lệch theo vai.
- Không có khóa `from:` phù hợp thì dùng spawn theo vai (`INVESTIGATOR` / `INTERROGATOR`), rồi tới `default`, cộng độ lệch nhỏ theo thứ tự người chơi.
- Cuối cùng vị trí được kéo về điểm đi được gần nhất. Hướng nhìn ban đầu là `south`.
- Khóa `from:` cũng là một spawn point bình thường, nên phải nằm trên ô đi được.

### Các trường runtime khác ở cảnh pixel

- `itemPlacements[].asset` có thể rỗng khi vật đã vẽ sẵn trong ảnh nền. Hotspot vẫn đặt đúng vị trí vật. FE vẽ dấu lấp lánh cho vật chưa xem.
- `characterPlacements[]` dùng điểm chân (`bottom-center`). Kích thước nên là ô sprite × `actorScale`. NPC hiển thị bằng `presentation.spriteSheet` của nhân vật. `direction` (`left`/`right`) không đổi hướng NPC pixel.
- Người chơi dùng sprite sheet pixel cố định ở `/assets/pixel/players/` (8 hướng đứng, animation theo 4 hướng chính).

Kế hoạch tạo ảnh PixelLab cho các cảnh này: `node scripts/build_pixellab_requests.mjs <case.json> <out.json>`. Template ở `ai-game-docs/visual-style-templates/pixellab/`.
