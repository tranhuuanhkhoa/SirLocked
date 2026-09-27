# Position Audit: Case JSON vs Scene Runtime

Ngay lap tuc co the ket luan: loi dat item/character/hotspot khong on khong den tu mot bug rieng le. Goc loi la du an dang co nhieu he toa do va nhieu source-of-truth khac nhau:

- `case.json` runtime dung hotspot percent `x/y/width/height` theo background.
- `asset-prompts.json` dung `reservedSlots`, `npcGaps`, `walkwayPx` bang pixel tren canvas 1600x900.
- Renderer Phaser hien dung hotspot nhu ca hitbox va ca slot dat sprite item.
- Model backend chi luu hotspot percent, khong luu `reservedSlot`, `item position`, `character feet`, `walkableArea`, `floorY`, hay `depth` co y nghia runtime ro rang.
- Runtime scale background theo cover-scale vao viewport, nhung UI overlay/inventory nam tren canvas va khong duoc tinh vao layout metadata.

Da chay app local va chup runtime screenshots tai:

- `analysis/position-audit/screenshots/01-scene-dressing-room.png`
- `analysis/position-audit/screenshots/02-scene-backstage-hallway.png`
- `analysis/position-audit/screenshots/03-scene-owners-office.png`
- `analysis/position-audit/screenshots/04-scene-props-room.png`
- `analysis/position-audit/screenshots/05-scene-theater-lobby.png`
- `analysis/position-audit/screenshots/runtime-capture-summary.json`

## 1. Tong Quan Loi Vi Tri Lon Nhat

### 1.1 `case.json` va `asset-prompts.json` khong khop

`asset-prompts.json` noi background va item overlay duoc tao theo canvas 1600x900, voi `reservedSlots` va `npcGaps` la pixel box. Nhung `case.json` lai chua cac hotspot percent khac dang ke. Khi convert hotspot percent ve pixel 1600x900 bang cong thuc:

```text
pixelX = percentX * 16
pixelY = percentY * 9
pixelWidth = percentWidth * 16
pixelHeight = percentHeight * 9
```

nhieu object lech hang tram pixel so voi slot/gap thiet ke.

Vi du nghiem trong:

- `scene-props-room / item-pawn-ticket`: JSON px `(176,450,112,72)`, design slot `(1088,495,128,90)`, lech `-912px` theo truc X.
- `scene-props-room / char-victor`: JSON px `(208,432,144,288)`, npcGap `(880,414,144,288)`, lech `-672px` theo X.
- `scene-backstage-hallway / item-scratched-photo`: JSON px `(192,234,128,90)`, reservedSlot `(608,360,112,81)`, lech `-416px, -126px`.
- `scene-owners-office / char-eleanor`: JSON px `(736,315,144,288)`, npcGap `(832,414,144,288)`, lech `-96px, -99px`.

Day la data drift giua design metadata va runtime metadata, khong phai chi la loi scale.

### 1.2 Hotspot dang bi dung lam item placement

Trong `src/FE/Client/js/pages/gamePage.ts`, item duoc render tai tam hotspot:

```ts
this.add.image(x + w / 2, y + h / 2, itemKey).setOrigin(0.5)
image.setScale(Math.min(w / image.width, h / image.height))
```

Nghia la neu hotspot duoc lam rong hon de click de hon, sprite item cung bi phong to/doi tam theo hotspot. Khong co truong rieng cho:

- visual position,
- visual size,
- anchor,
- hotspot click area,
- reserved slot,
- depth.

Day la ly do rat de thay item "dung hitbox nhung sai cho", hoac nguoc lai.

### 1.3 Character va player khong dung cung ground line

NPC co logic "feet at rect bottom-center" tu CHARACTER hotspot. Player lai dung `walkBounds()` hardcode:

```ts
laneY = frame.y + frame.height * 0.82
```

Trong khi `asset-prompts.json` co `walkwayPx: { yTopPx: 630, yBottomPx: 765 }`, va `npcGaps` thuong co bottom y `702`. Runtime khong doc `walkwayPx`, khong co `floorY`, va khong co walkable polygon. Ket qua la player, NPC va item co the dung tren nhung duong san khac nhau.

### 1.4 Background scale cover dung, nhung chua co chuan QA viewport

Renderer dung cover-scale:

```ts
scale = Math.max(viewportWidth / assetWidth, viewportHeight / assetHeight)
```

Ve mat ky thuat, hotspot/item cung scale theo `sceneFrame`, nen neu JSON dung cung he toa do background thi khong lech. Nhung voi viewport khong dung ti le 16:9, background bi crop. Neu QA so sanh bang screen pixel truc tiep ma khong tru `frame.x/frame.y`, se thay lech. Hien report nay doi chieu tren logical 1600x900 de tranh nham lan.

### 1.5 Backend validation chua bat loi placement

`CaseValidationService` chi check hotspot trong range 0-100 va reference ton tai. No khong check:

- item co hotspot khop `reservedSlot` khong,
- character co `npcGap` / placement khong,
- hotspot co nam ngoai background khong,
- object co de len nhau khong,
- item co nam trong walkable area khong,
- box co trung furniture/surface mong muon khong,
- background 1600x900 co dung voi case metadata khong.

## 2. File Da Kiem Tra Va Vai Tro

| File | Vai tro |
| --- | --- |
| `ai-game-docs/demo-case/case.json` | Case runtime cua "The Gaslight Curtain Call"; chua scene, itemIds, characterIds, hotspot percent. |
| `ai-game-docs/demo-case/asset-prompts.json` | Design/compositing metadata 1600x900; chua `reservedSlots`, `npcGaps`, `walkwayPx`, item overlay target slot. |
| `src/BE/Models/GameCase.cs` | Backend model hien tai; `SceneHotspot` chi co percent coordinates, khong co placement schema. |
| `src/BE/Services/CaseValidationService.cs` | Validation chi validate reference va percent range, chua validate layout/coordinate alignment. |
| `src/BE/Services/GameStateBuilder.cs` | Build `visibleScene` dua vao scene hotspots/items/characters; khong them runtime placement metadata. |
| `src/FE/Client/js/pages/gamePage.ts` | Phaser renderer: background cover-scale, hotspotRect, item image placement, NPC/player placement, scene navigation. |
| `src/FE/css/09-app.css` | Fullscreen game layout; HUD/inventory overlay nam tren canvas. |
| `ai-game-docs/SCENE_RUNTIME_SCHEMA.md` | Tai lieu target schema co `width`, `height`, `floorY`, `walkBounds`, `interactables`, `characterPlacements`; chua duoc persist vao current case model. |
| `src/FE/public/assets/**` | Asset thuc te; background la 1600x900, item sprite sizes khop target slot, nhung mot so PNG co transparent padding lon. |

## 3. Bang Doi Chieu Object Theo Scene

Ghi chu: "JSON px" la hotspot percent trong `case.json` duoc convert ve canvas 1600x900. "Design slot/gap" lay tu `asset-prompts.json`.

### Celeste's Dressing Room

Screenshot: `analysis/position-audit/screenshots/01-scene-dressing-room.png`

| Object | JSON px from hotspot | Design slot/gap px | Delta | Danh gia |
| --- | ---: | ---: | ---: | --- |
| ITEM `item-celeste-body` | `(80,441,384,198)` | `(192,405,128,90)` | `(-112,+36,+256,+108)` | Nghiem trong: hotspot qua rong va lech trai/duoi so voi slot. |
| ITEM `item-makeup-kit` | `(800,477,144,99)` | `(880,432,144,108)` | `(-80,+45,0,-9)` | Lech ro: runtime dat tren vanity nhung thap hon va trai hon design. |
| ITEM `item-threatening-letter` | `(1312,468,112,81)` | `(1200,450,160,108)` | `(+112,+18,-48,-27)` | Nghiem trong: slot design ben trai hon, JSON day qua phai. |

Nhan xet runtime:

- Body hien tren chaise nhung JSON hotspot dung nhu mot vung lon bao ca chaise/body, khong phai visual slot cua body.
- Makeup kit va letter dung duoc ve mat gameplay, nhung khong co anchor/position rieng nen vi tri bi rang buoc vao hotspot.
- Khong co character scene nay, nen loi ground line chua xuat hien.

Nguyen nhan kha nghi:

- `asset-prompts.json` co reservedSlot pixel nhung khong duoc import vao `case.json`.
- Body la object nam ngang; chuan bottom-center cho tat ca item can them `size` va `anchor`, neu khong se can exception/box fit theo reservedSlot.

### Backstage Hallway

Screenshot: `analysis/position-audit/screenshots/02-scene-backstage-hallway.png`

| Object | JSON px from hotspot | Design slot/gap px | Delta | Danh gia |
| --- | ---: | ---: | ---: | --- |
| ITEM `item-love-letter` | `(160,513,128,81)` | `(192,495,128,90)` | `(-32,+18,0,-9)` | Lech nhe/ro. |
| ITEM `item-scratched-photo` | `(192,234,128,90)` | `(608,360,112,81)` | `(-416,-126,+16,+9)` | Nghiem trong: design metadata va runtime khong cung vi tri. |
| CHARACTER `char-mona` | `(336,432,144,288)` | `(400,414,144,288)` | `(-64,+18,0,0)` | Lech trai va thap hon gap. |
| CHARACTER `char-victor` | `(1024,432,144,288)` | `(1040,414,144,288)` | `(-16,+18,0,0)` | Gan dung X, thap hon 18px. |

Nhan xet runtime:

- Mona va Victor nhin dung scene, nhung feet line khong duoc lay tu `walkwayPx` hay `npcGaps`; no lay tu bottom cua CHARACTER hotspot.
- Photo co mismatch rat lon voi design slot. Neu design slot la source-of-truth, JSON sai. Neu runtime screenshot la source-of-truth, `asset-prompts.json` da cu va khong con tin cay.

Nguyen nhan kha nghi:

- Metadata sau khi generate background da bi chinh tay trong `case.json` nhung `asset-prompts.json` khong duoc dong bo.
- NPC placement dang la hotspot box, khong co `characterPlacements`.

### Theater Owner's Office

Screenshot: `analysis/position-audit/screenshots/03-scene-owners-office.png`

| Object | JSON px from hotspot | Design slot/gap px | Delta | Danh gia |
| --- | ---: | ---: | ---: | --- |
| ITEM `item-ledger` | `(640,450,144,90)` | `(640,450,144,108)` | `(0,0,0,-18)` | X/Y dung, height nho hon 18px. |
| ITEM `item-spare-key` | `(240,405,80,63)` | `(160,405,96,72)` | `(+80,0,-16,-9)` | Lech phai 80px. |
| CHARACTER `char-eleanor` | `(736,315,144,288)` | `(832,414,144,288)` | `(-96,-99,0,0)` | Nghiem trong: box runtime cao va trai hon design gap. |

Nhan xet runtime:

- Eleanor dung sau/gan desk trong screenshot, nhung JSON gap top `315` khac rat xa design top `414`.
- Code dat feet tai bottom hotspot; voi JSON `(35+32)% = 67%`, feet o y=603 tren canvas goc, trong khi design gap bottom la 702. Do do neu dung design gap, Eleanor dang cao hon san/khu vuc dung gan 99px.
- Ledger on-screen co ve dung mat ban, nhung item height bi nho hon reserved slot.

Nguyen nhan kha nghi:

- Character placement va furniture depth khong duoc khai bao. Eleanor dang can biet dung sau desk hay truoc desk, nhung runtime chi co mot sprite depth = feetY.
- Key rack vi tri trong actual background va reservedSlot khong ro source nao la chuan.

### Props Room

Screenshot: `analysis/position-audit/screenshots/04-scene-props-room.png`

| Object | JSON px from hotspot | Design slot/gap px | Delta | Danh gia |
| --- | ---: | ---: | ---: | --- |
| ITEM `item-cyanide-bottle` | `(704,378,96,90)` | `(448,360,112,90)` | `(+256,+18,-16,0)` | Nghiem trong. |
| ITEM `item-pawn-ticket` | `(176,450,112,72)` | `(1088,495,128,90)` | `(-912,-45,-16,-18)` | Nghiem trong nhat trong case. |
| CHARACTER `char-samuel` | `(608,432,144,288)` | `(240,414,144,288)` | `(+368,+18,0,0)` | Nghiem trong. |
| CHARACTER `char-victor` | `(208,432,144,288)` | `(880,414,144,288)` | `(-672,+18,0,0)` | Nghiem trong. |

Nhan xet runtime:

- Runtime screenshot cho thay Victor o ben trai gan workbench, Samuel o giua, cyanide bottle giua shelf. Trong `asset-prompts.json`, Samuel/Victor va item slots lai nam o cac vi tri khac.
- Day la scene co bang chung manh nhat ve data drift: co kha nang prompt/design ban dau va JSON runtime da di theo hai huong khac nhau.
- Player Sherlock spawn chong len Victor vi player spawn lane khong co collision/avoid NPC gap.

Nguyen nhan kha nghi:

- Khong co collision/occupancy giua `walkableArea`, `npcGaps`, item slots va player spawn.
- Khong co validation "player spawn must not overlap NPC".
- Scene navigation buttons cung nam theo UI heuristic, khong theo door/exit zone.

### Theater Lobby

Screenshot: `analysis/position-audit/screenshots/05-scene-theater-lobby.png`

| Object | JSON px from hotspot | Design slot/gap px | Delta | Danh gia |
| --- | ---: | ---: | ---: | --- |
| CHARACTER `char-mona` | `(144,441,144,288)` | `(160,414,144,288)` | `(-16,+27,0,0)` | Lech doc 27px. |
| CHARACTER `char-victor` | `(1056,441,144,288)` | `(1200,414,144,288)` | `(-144,+27,0,0)` | Lech X nghiem trong. |
| CHARACTER `char-samuel` | `(528,441,144,288)` | `(560,414,144,288)` | `(-32,+27,0,0)` | Lech vua. |
| CHARACTER `char-eleanor` | `(816,441,144,288)` | `(880,414,144,288)` | `(-64,+27,0,0)` | Lech ro. |

Nhan xet runtime:

- Tat ca NPC lobby dung thap hon `npcGaps` 27px vi JSON y=49 thay vi design y=46.
- Victor lech trai 144px so voi design.
- Player spawn chong len Mona o ben trai. Khong co spawn point theo scene va khong co collision voi NPC.

Nguyen nhan kha nghi:

- Lobby can explicit `characterPlacements` va `spawnPoints`, khong nen tu suy dien bang hotspot.
- `walkwayPx` co trong prompt nhung runtime khong doc.

## 4. Asset Padding / Anchor Audit

Mot so sprite PNG co transparent padding lon. Neu renderer scale theo full PNG size, visual silhouette co the nho hon slot va tao cam giac lech.

| Asset | Canvas | Non-transparent bbox | Padding |
| --- | ---: | ---: | --- |
| `items/cyanide-bottle.png` | `112x90` | `39x82` | `L36 T4 R37 B4` |
| `items/makeup-kit.png` | `144x108` | `78x100` | `L33 T4 R33 B4` |
| `items/pawn-ticket.png` | `128x90` | `73x82` | `L27 T4 R28 B4` |
| `items/letter.png` | `160x108` | `100x100` | `L30 T4 R30 B4` |
| `characters/victor-sprite.png` | `256x384` | `136x364` | `L60 T10 R60 B10` |
| `characters/eleanor-sprite.png` | `256x384` | `133x364` | `L61 T10 R62 B10` |

Ket luan:

- Character sprite da dung `setOrigin(0.5,1)`, nhung bottom padding 10px lam chan thuc te cach anchor khoang 6px khi scale ve height 235.
- Item sprite dang `setOrigin(0.5)` va scale theo full PNG canvas. Voi item co padding ngang lon, silhouette se nho hon hitbox va trong nhu nam sai surface.
- Nen trim alpha khi export asset, hoac them `visualBounds`/`anchorOffset` vao metadata.

## 5. Nguyen Nhan Goc

### Root cause A: Chua co single source-of-truth cho placement

`asset-prompts.json` la design/compositing source, nhung runtime chi doc `case.json`. Khi 2 file khac nhau, app khong the tu biet cai nao dung.

### Root cause B: Schema hien tai tron lan hitbox va visual slot

Hotspot trong `case.json` vua la:

- clickable area,
- visual placement,
- visual size,
- interaction range,
- sometimes character standing gap.

Mot field khong nen gan nhieu nghia nhu vay. Hitbox nen co the rong hon sprite; sprite nen co anchor rieng; reservedSlot nen la QA/design box rieng.

### Root cause C: Renderer item anchor sai voi target standard

Target standard cua user: item/character dung anchor bottom-center. Runtime item hien tai dung center-center:

```ts
setOrigin(0.5)
```

Neu item nam tren ban, ghe, ke, san, viec center anchor co the tam chap nhan khi hotspot == visual slot. Nhung khi hotspot khac visual slot, item se bi lech tam/thap/cao.

### Root cause D: Character placement khong co feet coordinate rieng

NPC dung bottom cua CHARACTER hotspot lam feet. Neu hotspot can cao hon character de click, feet bi day xuong. Neu hotspot la visual gap tu prompt, van phai biet no la top-left box hay feet box. Hien khong co metadata `anchor`.

### Root cause E: Walkable area/pedestrian lane khong nam trong case JSON

`asset-prompts.json` co `walkwayPx`, nhung backend model khong co field nay. Runtime hardcode `0.82` frame height. Khong co collision voi item, NPC, furniture hay exits.

### Root cause F: Scale/crop duoc xu ly trong renderer nhung khong co debug overlay

`sceneFrame()` cover-scale background vao viewport. Day la huong dung neu moi object cung scale qua frame, nhung QA khong co grid/mouse/box overlay de biet toa do dang tinh theo canvas goc hay screen pixel.

### Root cause G: Scene navigation/stage exits khong co layout metadata

Scene transition button hien dat heuristic:

```ts
x = 92 or width - 92
y = height * 0.52
```

No khong lien ket voi cua, ban, props room, hay exit zone trong JSON. Vi vay "stage/location button" nhin nhu lech voi background.

## 6. Chuan Toa Do Nen Dung

Nen chot 1 chuan duy nhat:

- Background canvas logical co dinh: `1600x900`.
- Moi toa do layout trong JSON la world coordinate theo canvas goc, khong dung percent cho authoring nua.
- `item.position` va `character.position` la anchor point.
- Item va character mac dinh dung `anchor: "bottom-center"`.
- Hotspot/reservedSlot dung box top-left: `x,y,width,height`.
- Khi background scale/crop, tat ca world boxes scale bang cung he so va offset `sceneFrame.x/y`.
- Character feet luon nam tren `floorY`/`groundLine` hoac explicit placement y.
- Hotspot khong duoc dong vai tro visual placement.
- Player spawn point phai nam trong walkable band va khong overlap NPC/item.

Schema de xuat:

```json
{
  "id": "item-id",
  "asset": "path.png",
  "position": { "x": 0, "y": 0, "anchor": "bottom-center" },
  "size": { "width": 0, "height": 0 },
  "hotspot": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "reservedSlot": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "depth": 0
}
```

Scene runtime nen co:

```json
{
  "runtime": {
    "width": 1600,
    "height": 900,
    "floorY": 720,
    "walkableArea": { "x": 0, "y": 630, "width": 1600, "height": 135 },
    "spawnPoints": {
      "INVESTIGATOR": { "x": 220, "y": 720, "direction": "right" },
      "INTERROGATOR": { "x": 300, "y": 720, "direction": "right" }
    },
    "items": [],
    "characters": [],
    "transitions": []
  }
}
```

## 7. Cach Sua De Xuat

### Data pipeline

1. Chon `case.json` la source-of-truth runtime.
2. Import `reservedSlots`, `npcGaps`, `walkwayPx` tu `asset-prompts.json` vao `case.json` duoi `scene.runtime`.
3. Sau khi background duoc approve, cap nhat `case.json` runtime metadata; khong de `asset-prompts.json` tro thanh file design cu.
4. Them validator so sanh `reservedSlot` va `hotspot`:
   - item co placement + hotspot,
   - character co placement + hotspot,
   - hotspot trong bounds 1600x900,
   - visual size > 0,
   - spawn khong overlap NPC/item,
   - walkableArea khong bi reservedSlot/large furniture che.

### Renderer

1. Background:
   - Giu `sceneFrame()` lam scale/offset duy nhat.
   - Moi world coord convert bang:

```ts
screenX = frame.x + worldX * frame.width / 1600
screenY = frame.y + worldY * frame.height / 900
```

2. Item:
   - Render visual bang `position` + `size`, khong dung hotspot.
   - Neu source chi co `reservedSlot`, render tam thoi:

```ts
sprite.x = slot.x + slot.width / 2
sprite.y = slot.y + slot.height
sprite.setOrigin(0.5, 1)
sprite.setDisplaySize(slot.width, slot.height)
```

3. Hotspot:
   - Dung `hotspot` box rieng.
   - Co the lon hon sprite de click de hon, nhung khong anh huong item visual.

4. Character:
   - Dung `characterPlacement.position` feet.
   - Sprite `setOrigin(0.5,1)`.
   - Depth = feetY hoac explicit `depth`.
   - Bo clamp `Math.min(y + h, height - 112)` neu clamp lam sai world coordinate; neu can tranh UI, dung spawn/walkableArea thay vi sua y runtime.

5. Player:
   - Dung `scene.runtime.spawnPoints`.
   - Dung `walkableArea/floorY` tu JSON thay vi hardcode `0.82`.
   - Khong spawn de len NPC gap.

6. Transitions/stage:
   - Dung `transitions` world boxes gan voi cua/duong di trong background.
   - Khong dat button transition bang heuristic `x=92/right-92` neu muon no khop map.

### Asset authoring

1. Trim transparent padding cua PNG khi export, hoac generate `visualBounds`.
2. Ghi anchor metadata trong asset prompt/result.
3. Item nam ngang nhu body can explicit `anchor`/`fitMode`:
   - `anchor: "center"` hoac `anchor: "bottom-center"` tuy visual.
   - Khong ep tat ca item nam ngang theo item dung.

## 8. Debug Overlay Can Them

Nen them toggle QA, vi du phim `F2` hoac query `?debugLayout=1`, hien:

- grid 1600x900, major line moi 100px,
- toa do chuot: world x/y va screen x/y,
- background `sceneFrame` crop/scale outline,
- item visual bounding box,
- hotspot box,
- reservedSlot box,
- npcGap / character feet point,
- walkableArea,
- ground line / floorY,
- spawn points,
- transition boxes,
- depth labels,
- anchor point sprite.

Mau de nghi:

- reservedSlot: cyan dashed,
- hotspot: yellow solid,
- item visual: green,
- character feet: magenta cross,
- walkableArea: blue translucent,
- collision/furniture blocked area: red translucent.

## 9. Fix Plan Theo Phase

### Phase 1: Chot chuan toa do

- Dinh nghia world coordinate 1600x900 trong docs va validator.
- Doi `case.json` authoring tu percent sang world pixel cho runtime placement.
- Giu backward compatibility: legacy hotspot percent co the duoc convert khi import.

### Phase 2: Chuan hoa origin/anchor item va character

- Item va character dung `anchor: "bottom-center"` mac dinh.
- Body/object nam ngang co metadata rieng.
- Trim PNG alpha padding hoac them `anchorOffset`.

### Phase 3: Chuan hoa scale theo canvas 1600x900

- Tat ca item/hotspot/reservedSlot/walkable/transition dung cung `sceneFrame`.
- QA overlay hien both world coord va screen coord.
- PC fullscreen co the dung cover-scale, nhung debug phai hien crop offset.

### Phase 4: Dong bo position, hotspot, reservedSlot

- Import `reservedSlots`/`npcGaps` tu `asset-prompts.json` vao `case.json`.
- Tao script migration:
  - percent hotspot -> world hotspot,
  - reservedSlot -> item placement,
  - npcGap -> character placement.
- Sua cac scene co delta nghiem trong, uu tien `scene-props-room`, `scene-owners-office`, `scene-backstage-hallway`.

### Phase 5: Them debug overlay

- Toggle overlay trong Phaser.
- Hien grid, mouse coordinate, boxes, anchor point, ground line.
- Export screenshot co overlay de QA so sanh.

### Phase 6: Chup lai screenshot va so sanh truoc/sau

- Chup lai 5 scene:
  - dressing room,
  - backstage hallway,
  - owner's office,
  - props room,
  - theater lobby.
- Moi scene can co screenshot:
  - normal runtime,
  - debug overlay.
- Acceptance:
  - item visual nam trong reservedSlot,
  - hotspot cover object nhung khong lam object doi vi tri,
  - NPC feet nam dung ground line,
  - player spawn khong chong NPC,
  - transition box khop door/exit,
  - khong object nao nam ngoai scene hoac bi UI che bat hop ly.

## 10. Ket Luan

De lam item/character/hotspot dat dung cho va khong lech giua JSON, anh thiet ke va runtime, can dung mot chuan duy nhat: `1600x900 world coordinate` trong `case.json`, trong do visual placement, hotspot, reservedSlot, walkableArea va transition la cac field rieng. Renderer khong nen lay hotspot de dat sprite. `asset-prompts.json` chi nen la input generation/authoring, hoac phai duoc import dong bo vao `case.json` sau moi lan update background.

Neu chi tiep tuc sua tung x/y percent bang tay, loi se lap lai vi khong co debug overlay, khong co validator layout, va khong co separation giua hitbox voi visual placement.
