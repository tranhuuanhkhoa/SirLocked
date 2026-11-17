"""Màn tân thủ "Ấm men lam": cảnh và vật lấy lại từ thư viện PixelLab đã vẽ; 4 NPC vẽ mới theo chuẩn.

Nguồn:
- Cảnh: thư viện Đợt 0 c-map-ngo-thach-kho-mon (ngõ Thạch Khố Môn), c-room-tra-lau (trà lâu).
- Vật trong cảnh: vẽ vào nền bằng inpaint của PixelLab (sổ khách, hòm gỗ; xem inpaint/recipe.json và
  scene_patches.py). Mảnh thư xé là mấy tờ giấy có sẵn trên quầy. Không dán ảnh vật lên cảnh.
- Icon túi đồ / thẻ vật (items[].imageUrl, không vẽ lên cảnh): all-item-so-cai (sổ khách),
  all-item-phong-bi-niem (thư); ấm men lam vẽ bằng code (draw_teapot.py).
- Nhân vật: 4 NPC PixelLab vẽ theo quy trình chuẩn của ai-game-docs/visual-style-templates/pixellab
  (character-front có ảnh Sherlock làm mẫu -> create_character v3 -> idle thở v3 9 khung), 56 lượt, 17/11/2026.
  NPC Đợt 0 (kiểu chibi đầu to) không dùng nữa. Zip tải ở https://api.pixellab.ai/mcp/characters/<id>/download:
    ong-luu  37964eae-ac4b-4670-9bac-054c95cbf956   co-lan  c6da4ad2-e040-4b87-a051-1f9bb33d2bb1
    hamilton 195b4a5e-b432-4b29-98b6-0eba88d577ea   a-phuc  fdd7b78a-5ce2-416b-a5d9-126f4837e0a4
  Sheet idle như tools/studio-mcp idleSheet: 9 khung theo thứ tự, ô 128, chân ở y=104, khung v3 (canvas 108-116)
  lùi lại nửa phần dư để nhân vật đứng đúng chỗ của sprite south. Chân dung = south 96x96 phóng x3 (288x288).
Chạy: python3 build_assets.py <thư mục files thư viện Đợt 0> <thư mục zip 4 NPC> <src/FE/public/assets/pixel/tan-thu>
"""
import io, json, os, sys, zipfile
import numpy as np
from PIL import Image

LIB, NPC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
for d in ('scenes', 'characters', 'items'):
    os.makedirs(f'{OUT}/{d}', exist_ok=True)

ASSETS = {
    'scenes/ngo.png': 'outdoor_map/c-map-ngo-thach-kho-mon.png',
    'scenes/tra-lau.png': 'interior/c-room-tra-lau.png',
}
for dst, src in ASSETS.items():
    Image.open(f'{LIB}/{src}').convert('RGBA').save(f'{OUT}/{dst}')


def npc_of(slug):
    """South sprite and the 9 idle frames (v3 custom, frame 0 = the rotation) from a PixelLab character zip."""
    z = zipfile.ZipFile(f'{NPC}/{slug}.zip')
    names = z.namelist()
    load = lambda name: Image.open(io.BytesIO(z.read(name))).convert('RGBA')
    south = load([n for n in names if n.endswith('rotations/south.png')][0])
    frames = sorted(n for n in names if '/animations/' in n and 'idle' in n and '/south/' in n and n.endswith('.png'))
    assert len(frames) >= 9, f'{slug}: cần 9 khung idle, có {len(frames)}'
    return south, [load(n) for n in frames[:9]]


def place(cell, frame, x, y):
    """alpha_composite at (x, y), clipped to the cell (PIL refuses negative offsets)."""
    frame = frame.crop((max(0, -x), max(0, -y), min(frame.width, cell.width - x), min(frame.height, cell.height - y)))
    cell.alpha_composite(frame, (max(0, x), max(0, y)))


CHARS = ['ong-luu', 'co-lan', 'hamilton', 'a-phuc']
anchors = {}
for slug in CHARS:
    south, frames = npc_of(slug)
    feet = np.nonzero(np.asarray(south)[..., 3].max(1))[0][-1]
    dy = 104 - feet
    sheet = Image.new('RGBA', (128 * 9, 128), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        ox, oy = round((frame.width - south.width) / 2), round((frame.height - south.height) / 2)
        cell = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
        place(cell, frame, 16 - ox, dy - oy)
        sheet.alpha_composite(cell, (i * 128, 0))
    sheet.save(f'{OUT}/characters/{slug}-idle.png')
    south.resize((288, 288), Image.NEAREST).save(f'{OUT}/characters/{slug}-portrait.png')
    anchors[slug] = round(105 / 128, 4)

# Icon túi đồ / thẻ vật (không vẽ lên cảnh). Hòm gỗ không cần icon: vật nhặt được là chiếc ấm (am-men-lam.png).
for dst, src in {'items/so-khach.png': 'item/all-item-so-cai.png', 'items/thu-xe.png': 'item/all-item-phong-bi-niem.png'}.items():
    Image.open(f'{LIB}/{src}').convert('RGBA').save(f'{OUT}/{dst}')

# Ấm men lam: vẽ bằng code trong draw_teapot.py (ấm trong ảnh trà lâu quá nhỏ để cắt).
import subprocess
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'draw_teapot.py'), f'{OUT}/items/am-men-lam.png'], check=True)

# Vật điều tra vẽ vào cảnh bằng inpaint PixelLab (chỉ chép vùng mask), rồi bìa: ngõ + dải chân dung (0 lượt).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scene_patches import apply_inpaint, make_cover  # noqa: E402
apply_inpaint(OUT)
make_cover(OUT)
print(json.dumps({'anchors': anchors, 'files': sorted(os.listdir(f'{OUT}/characters')) + sorted(os.listdir(f'{OUT}/items'))}))
