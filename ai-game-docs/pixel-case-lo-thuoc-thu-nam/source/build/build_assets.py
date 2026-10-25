"""Build the public pixel assets + runtime layout for case "Lọ thuốc thứ Năm".

Inputs: PixelLab originals under ../art (never modified).
Outputs:
  out/public/assets/pixel/...           PNGs served by Vite (/assets/pixel/...)
  out/scene-runtime.json                per-scene runtime data (runtime units = native x 4)
  debug/<scene>.png                     review overlays (walk grid, boxes, spawns)
Run:  python3 -I build_assets.py <px-root>
"""
import json, os, sys, glob, hashlib
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '..')
sys.path.insert(0, os.path.join(ROOT, 'build'))
from scenes_spec import HUB, ROOMS, PIXEL_SCALE, GRID_CELL_NATIVE, NATIVE  # noqa: E402

ART = os.path.join(ROOT, 'art')
OUT = os.path.join(ROOT, 'build', 'out')
CASE_DIR = 'pixel/lo-thuoc-thu-nam'
PUB = os.path.join(OUT, 'public', 'assets')
DEBUG = os.path.join(ROOT, 'build', 'debug')
for d in (PUB, DEBUG):
    os.makedirs(d, exist_ok=True)

S = PIXEL_SCALE
CELL = GRID_CELL_NATIVE
G = NATIVE // CELL


def pub(rel):
    path = os.path.join(PUB, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def url(rel):
    return '/assets/' + rel


def rt_box(b):
    x0, y0, x1, y1 = b
    return {'x': x0 * S, 'y': y0 * S, 'width': (x1 - x0) * S, 'height': (y1 - y0) * S}


def rt_pt(p, anchor='bottom-center'):
    return {'x': p[0] * S, 'y': p[1] * S, 'anchor': anchor}


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def poly_mask(points):
    img = Image.new('L', (NATIVE, NATIVE), 0)
    ImageDraw.Draw(img).polygon(points, fill=255)
    return np.array(img) > 0


def rect_set(arr, box, value):
    x0, y0, x1, y1 = box
    arr[max(0, y0):min(NATIVE, y1), max(0, x0):min(NATIVE, x1)] = value


def to_grid(walk_native, need=16):
    blocks = walk_native.reshape(G, CELL, G, CELL).sum(axis=(1, 3))
    return blocks >= need


def erode(grid, dx, dy):
    padded = np.pad(grid, ((dy, dy), (dx, dx)), constant_values=False)
    out = grid.copy()
    for ox in range(-dx, dx + 1):
        out &= padded[dy:dy + G, dx + ox:dx + ox + G]
    for oy in range(-dy, dy + 1):
        out &= padded[dy + oy:dy + oy + G, dx:dx + G]
    return out


def nearest_walkable(grid, pt):
    cx, cy = min(G - 1, max(0, pt[0] // CELL)), min(G - 1, max(0, pt[1] // CELL))
    seen = {(cx, cy)}
    q = deque([(cx, cy)])
    while q:
        x, y = q.popleft()
        if grid[y, x]:
            return (x * CELL + CELL // 2, y * CELL + CELL // 2)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < G and 0 <= ny < G and (nx, ny) not in seen:
                seen.add((nx, ny))
                q.append((nx, ny))
    return None


def component(grid, start):
    sx, sy = start[0] // CELL, start[1] // CELL
    if not grid[sy, sx]:
        return set()
    seen = {(sx, sy)}
    q = deque([(sx, sy)])
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < G and 0 <= ny < G and (nx, ny) not in seen and grid[ny, nx]:
                seen.add((nx, ny))
                q.append((nx, ny))
    return seen


def box_target(box):
    """Approach target: bottom-centre of the hotspot box."""
    return ((box[0] + box[2]) // 2, box[3] - 1)


def debug_overlay(key, image, grid, spec, occluders, approach):
    base = image.convert('RGBA').resize((NATIVE * 2, NATIVE * 2), Image.NEAREST)
    bg = Image.new('RGBA', base.size, (30, 30, 30, 255))
    bg.alpha_composite(base)
    over = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    for gy in range(G):
        for gx in range(G):
            if grid[gy, gx]:
                d.rectangle([gx * CELL * 2, gy * CELL * 2, (gx + 1) * CELL * 2 - 1, (gy + 1) * CELL * 2 - 1], fill=(0, 255, 120, 60))
    for o in occluders:
        x0, y0, x1, y1 = o['nativeBox']
        d.rectangle([x0 * 2, y0 * 2, x1 * 2, y1 * 2], outline=(80, 160, 255, 255))
        d.line([x0 * 2, o['nativeBaseY'] * 2, x1 * 2, o['nativeBaseY'] * 2], fill=(80, 160, 255, 255), width=2)
    for name, b in list(spec['items'].items()) + list(spec['envs'].items()):
        d.rectangle([b[0] * 2, b[1] * 2, b[2] * 2, b[3] * 2], outline=(255, 220, 0, 255), width=2)
        d.text((b[0] * 2 + 2, b[1] * 2 + 2), name, fill=(255, 255, 0, 255))
    for name, b in spec['zones'].items():
        d.rectangle([b[0] * 2, b[1] * 2, b[2] * 2, b[3] * 2], outline=(255, 0, 255, 255), width=2)
        d.text((b[0] * 2 + 2, b[3] * 2 + 2), 'cam:' + name, fill=(255, 120, 255, 255))
    for name, b in spec['transitions'].items():
        d.rectangle([b[0] * 2, b[1] * 2, b[2] * 2, b[3] * 2], outline=(0, 255, 255, 255), width=2)
        d.text((b[0] * 2 + 2, b[1] * 2 - 12), '-> ' + name, fill=(0, 255, 255, 255))
    for name, p in spec['spawns'].items():
        d.ellipse([p[0] * 2 - 4, p[1] * 2 - 4, p[0] * 2 + 4, p[1] * 2 + 4], fill=(255, 60, 60, 255))
    for n in spec['npcs']:
        p = n['feet']
        d.ellipse([p[0] * 2 - 6, p[1] * 2 - 6, p[0] * 2 + 6, p[1] * 2 + 6], outline=(255, 140, 0, 255), width=3)
    for name, p in approach.items():
        if p:
            d.line([p[0] * 2 - 5, p[1] * 2, p[0] * 2 + 5, p[1] * 2], fill=(255, 255, 255, 255), width=2)
            d.line([p[0] * 2, p[1] * 2 - 5, p[0] * 2, p[1] * 2 + 5], fill=(255, 255, 255, 255), width=2)
    bg.alpha_composite(over)
    bg.save(os.path.join(DEBUG, f'{key}.png'))


def grid_rows(grid):
    return [''.join('1' if v else '0' for v in row) for row in grid]


def finish_scene(key, image_path, spec, walk_native, carve=(), occluders=(), erode_xy=(0, 0), need=16):
    for n in spec['npcs']:
        fx, fy = n['feet']
        rect_set(walk_native, (fx - 7, fy - 5, fx + 7, fy + 3), False)
    grid = to_grid(walk_native, need)
    if erode_xy != (0, 0):
        grid = erode(grid, *erode_xy)
    if carve:
        cv = np.zeros_like(walk_native)
        for b in carve:
            rect_set(cv, b, True)
        grid |= to_grid(cv, 16)
    for o in occluders:
        fx0, fy0, fx1, fy1 = o['foot']
        grid[fy0 // CELL:(fy1 + CELL - 1) // CELL, fx0 // CELL:(fx1 + CELL - 1) // CELL] = False
    for n in spec['npcs']:
        fx, fy = n['feet']
        grid[(fy - 5) // CELL:(fy + 3 + CELL - 1) // CELL, (fx - 7) // CELL:(fx + 7 + CELL - 1) // CELL] = False

    main = component(grid, spec['spawns']['default'])
    # keep only the main component so the client never lands on an island
    pruned = np.zeros_like(grid)
    for (x, y) in main:
        pruned[y, x] = True
    problems = []
    for name, p in spec['spawns'].items():
        if (p[0] // CELL, p[1] // CELL) not in main:
            problems.append(f'spawn {name} {p} not in main walk component')
    approach = {}
    for name, b in list(spec['items'].items()) + list(spec['envs'].items()) + [('->' + k, v) for k, v in spec['transitions'].items()]:
        a = nearest_walkable(pruned, box_target(b))
        approach[name] = a
        if not a:
            problems.append(f'approach {name} unreachable')
        else:
            dist = abs(a[0] - box_target(b)[0]) + abs(a[1] - box_target(b)[1])
            if dist > 240:
                problems.append(f'approach {name} far ({dist}px)')
    for n in spec['npcs']:
        a = nearest_walkable(pruned, (n['feet'][0], n['feet'][1] + 8))
        approach['npc:' + n['char']] = a
        if not a or abs(a[0] - n['feet'][0]) + abs(a[1] - n['feet'][1]) > 60:
            problems.append(f'npc {n["char"]} hard to reach ({a})')
    ys, xs = np.nonzero(pruned)
    walk_box = (int(xs.min()) * CELL, int(ys.min()) * CELL, int(xs.max() + 1) * CELL, int(ys.max() + 1) * CELL)
    img = Image.open(image_path).convert('RGBA')
    debug_overlay(key, img, pruned, spec, occluders_meta(occluders), approach)
    return pruned, walk_box, problems, approach


def occluders_meta(occ):
    return [{'nativeBox': o['box'], 'nativeBaseY': o['foot'][3]} for o in occ]


def build_hub():
    spec = HUB
    src = Image.open(os.path.join(ROOT, spec['image'])).convert('RGBA')
    mask = np.array(Image.open(os.path.join(ART, 'mask-v1', 'mask-raw.png')).convert('L')) > 128
    walk = ~mask
    for b in spec['blocked']:
        rect_set(walk, b, False)
    out_occ = []
    for o in spec['occluders']:
        x0, y0, x1, y1 = o['box']
        crop = src.crop((x0, y0, x1, y1))
        alpha = Image.fromarray((mask[y0:y1, x0:x1] * 255).astype('uint8'))
        if o['id'] == 'tree':   # keep the building edge out of the canopy cut-out
            a = np.array(alpha)
            a[:, :max(0, 192 - x0)] = 0
            alpha = Image.fromarray(a)
        crop.putalpha(alpha)
        rel = f'{CASE_DIR}/fg/pho-{o["id"]}.png'
        crop.save(pub(rel))
        # open the object's own silhouette (walk behind it); its foot is re-blocked after erosion
        ox0, oy0, ox1, oy1 = o.get('open', o['box'])
        sub = walk[oy0:oy1, ox0:ox1]
        sub[mask[oy0:oy1, ox0:ox1]] = True
        out_occ.append({**o, 'url': url(rel)})
    grid, walk_box, problems, approach = finish_scene('pho', os.path.join(ROOT, spec['image']), spec, walk,
                                                      carve=spec['carve'], occluders=spec['occluders'],
                                                      erode_xy=(2, 1), need=12)
    rel = f'{CASE_DIR}/scenes/pho.png'
    src.save(pub(rel))
    return spec, grid, walk_box, problems, approach, out_occ, url(rel)


def build_room(spec):
    src = Image.open(os.path.join(ROOT, spec['image'])).convert('RGBA')
    floor = poly_mask(spec['floor'])
    walk = floor.copy()
    for kind, shape in spec['blocks']:
        if kind == 'rect':
            rect_set(walk, shape, False)
        else:
            walk &= ~poly_mask(shape)
    grid, walk_box, problems, approach = finish_scene(spec['key'], os.path.join(ROOT, spec['image']), spec, walk,
                                                      erode_xy=(1, 1), need=16)
    rel = f'{CASE_DIR}/scenes/{spec["key"]}.png'
    src.save(pub(rel))
    return spec, grid, walk_box, problems, approach, [], url(rel)


def build_characters():
    chars = {}
    for k in ['lam-the-bao', 'ly-hanh', 'trinh-luc', 'to-khanh', 'dang-buu', 'hoc-viec']:
        sheet_png = glob.glob(os.path.join(ART, 'chars', k, 'sheet', '*.png'))[0]
        meta = json.load(open(glob.glob(os.path.join(ART, 'chars', k, 'sheet', '*.json'))[0]))['spritesheet']
        cw, ch = meta['cell_size']['width'], meta['cell_size']['height']
        rows = {r['row']: r for r in meta['rows']}
        idle_row = next(r for r in meta['rows'] if r['type'] == 'animation')
        sheet = Image.open(sheet_png).convert('RGBA')
        frames = idle_row['frame_count']
        strip = Image.new('RGBA', (128 * frames, 128), (0, 0, 0, 0))
        off = (128 - cw) // 2
        for i in range(frames):
            cell = sheet.crop((i * cw, idle_row['row'] * ch, (i + 1) * cw, (idle_row['row'] + 1) * ch))
            strip.alpha_composite(cell, (i * 128 + off, off))
        rel = f'{CASE_DIR}/characters/{k}-idle.png'
        strip.save(pub(rel))
        south = Image.open(os.path.join(ART, 'chars', k, 'rot', 'Idle', 'rotations', 'south.png')).convert('RGBA')
        ground = south.split()[3].getbbox()[3] + 16
        portrait = south.resize((288, 288), Image.NEAREST)
        prel = f'{CASE_DIR}/characters/{k}-portrait.png'
        portrait.save(pub(prel))
        chars[k] = {'sheet': url(rel), 'frames': frames, 'ground': ground, 'portrait': url(prel)}
    return chars


def build_players():
    """Player sheets in 128 px cells (pivot = cell centre registration, PixelLab export)."""
    # Sherlock's sheets come from the SceneTest prototype (holmes96-animations-v1); the repo already ships
    # them under src/FE/public/assets/pixel/players, so they are only re-copied when that folder is present.
    st = os.path.join(ROOT, 'scenetest', 'client', 'public', 'assets', 'holmes96-animations-v1')
    if os.path.isdir(st):
        for name in ('normal', 'smoking'):
            Image.open(os.path.join(st, f'{name}.png')).save(pub(f'pixel/players/holmes96-{name}.png'))
    meta = json.load(open(glob.glob(os.path.join(ART, 'chars', 'watson', 'sheet', '*.json'))[0]))['spritesheet']
    cw = meta['cell_size']['width']
    sheet = Image.open(glob.glob(os.path.join(ART, 'chars', 'watson', 'sheet', '*.png'))[0]).convert('RGBA')
    cols = meta['columns']
    nrows = len(meta['rows'])
    out = Image.new('RGBA', (cols * 128, nrows * 128), (0, 0, 0, 0))
    off = (128 - cw) // 2
    for r in range(nrows):
        for c in range(cols):
            out.alpha_composite(sheet.crop((c * cw, r * cw, (c + 1) * cw, (r + 1) * cw)), (c * 128 + off, r * 128 + off))
    out.save(pub('pixel/players/watson96.png'))
    south = out.crop((0, 0, 128, 128)).split()[3].getbbox()
    layout = [{'row': r['row'], 'type': r['type'], 'frames': r['frame_count'], 'direction': r.get('direction'),
               'animation': r.get('animation')} for r in meta['rows']]
    return {'watson': {'columns': cols, 'ground': south[3], 'rows': layout}}


def build_items():
    names = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(ART, 'items', 'icons', '*.png')))
    out = {}
    for n in names:
        rel = f'{CASE_DIR}/items/{n}.png'
        Image.open(os.path.join(ART, 'items', 'icons', f'{n}.png')).save(pub(rel))
        out[n] = url(rel)
    return out


def build_cover():
    src = Image.open(os.path.join(ART, 'map-v1', 'map-512.png')).convert('RGBA').crop((0, 96, 512, 384))
    src = src.resize((1024, 576), Image.NEAREST)
    rel = f'{CASE_DIR}/cover.png'
    src.save(pub(rel))
    return url(rel)


def main():
    scenes = {}
    all_problems = {}
    for builder in [build_hub] + [lambda s=s: build_room(s) for s in ROOMS]:
        spec, grid, walk_box, problems, approach, occ, bg = builder()
        key = spec['key']
        all_problems[key] = problems
        scenes[key] = {
            'backgroundUrl': bg,
            'projection': spec['projection'],
            'cameraZoom': spec['cameraZoom'],
            'actorScale': spec['actorScale'],
            'walkSpeed': spec['walkSpeed'],
            'interactRadius': spec['interactRadius'] * S,
            'walkGrid': {'cellSize': CELL * S, 'cols': G, 'rows': G, 'data': grid_rows(grid)},
            'walkableArea': rt_box(walk_box),
            'foreground': [{'id': o['id'], 'url': o['url'], 'x': o['box'][0] * S, 'y': o['box'][1] * S,
                            'width': (o['box'][2] - o['box'][0]) * S, 'height': (o['box'][3] - o['box'][1]) * S,
                            'baseY': o['foot'][3] * S} for o in occ],
            'spawns': {k: rt_pt(v) for k, v in spec['spawns'].items()},
            'transitions': {k: rt_box(v) for k, v in spec['transitions'].items()},
            'items': {k: rt_box(v) for k, v in spec['items'].items()},
            'envs': {k: rt_box(v) for k, v in spec['envs'].items()},
            'zones': {k: rt_box(v) for k, v in spec['zones'].items()},
            'npcs': [{'char': n['char'], 'feet': rt_pt(n['feet'])} for n in spec['npcs']],
            'approach': {k: (None if v is None else [v[0] * S, v[1] * S]) for k, v in approach.items()},
        }
    result = {'scenes': scenes, 'characters': build_characters(), 'players': build_players(),
              'items': build_items(), 'cover': build_cover(), 'problems': all_problems}
    json.dump(result, open(os.path.join(OUT, 'scene-runtime.json'), 'w'), ensure_ascii=False, indent=1)
    for k, p in all_problems.items():
        print(k, 'OK' if not p else p)


if __name__ == '__main__':
    main()
