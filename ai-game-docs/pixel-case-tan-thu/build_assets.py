"""Màn tân thủ "Ấm men lam": ảnh lấy lại từ thư viện PixelLab đã vẽ (0 lượt mới).

Nguồn: thư viện Đợt 0 (manifest thu-vien-dot0), khóa ghi trong ASSETS dưới đây.
- Cảnh: c-map-ngo-thach-kho-mon (ngõ Thạch Khố Môn), c-room-tra-lau (trà lâu).
- Nhân vật (96x96, 8 hướng): c-npc-02-chu-tra-lau, c-npc-01-ca-si, v-npc-15-quy-ong, j-npc-02-phu-xe-keo.
  Không có hoạt ảnh idle trong thư viện: thở bằng code (dịch nửa trên 1 px), khung 96 đặt giữa ô 128.
  Chân dung = hướng south 96x96 phóng x3 nearest-neighbour (288x288).
- Vật: all-item-so-cai (sổ khách), all-item-phong-bi-niem (thư), all-item-hom-go (hòm gỗ); ấm men lam vẽ bằng
  code (draw_teapot.py).
Chạy: python3 build_assets.py <thư mục thư viện files> <thư mục đích src/FE/public/assets/pixel/tan-thu>
"""
import io, json, os, sys, zipfile
import numpy as np
from PIL import Image, ImageDraw

LIB, OUT = sys.argv[1], sys.argv[2]
for d in ('scenes', 'characters', 'items'):
    os.makedirs(f'{OUT}/{d}', exist_ok=True)

ASSETS = {
    'scenes/ngo.png': 'outdoor_map/c-map-ngo-thach-kho-mon.png',
    'scenes/tra-lau.png': 'interior/c-room-tra-lau.png',
}
for dst, src in ASSETS.items():
    Image.open(f'{LIB}/{src}').convert('RGBA').save(f'{OUT}/{dst}')


def south_of(key):
    z = zipfile.ZipFile(f'{LIB}/npc/{key}.zip')
    name = [n for n in z.namelist() if n.endswith('rotations/south.png')][0]
    return Image.open(io.BytesIO(z.read(name))).convert('RGBA')


def breathe(south):
    a = np.asarray(south)
    ys = np.nonzero(a[..., 3].max(1))[0]
    top, bot = ys[0], ys[-1]
    hip = int(top + (bot - top) * 0.55)
    frames = []
    for off in [0, 0, 1, 1, 1, 1, 0, 0, 0]:
        im = Image.new('RGBA', south.size, (0, 0, 0, 0))
        im.alpha_composite(south.crop((0, hip, south.width, south.height)), (0, hip))
        im.alpha_composite(south.crop((0, 0, south.width, hip)), (0, off))
        frames.append(im)
    return frames


CHARS = {'ong-luu': 'c-npc-02-chu-tra-lau', 'co-lan': 'c-npc-01-ca-si', 'hamilton': 'v-npc-15-quy-ong', 'a-phuc': 'j-npc-02-phu-xe-keo'}
anchors = {}
for slug, key in CHARS.items():
    south = south_of(key)
    a = np.asarray(south)
    feet = np.nonzero(a[..., 3].max(1))[0][-1]
    dy = 104 - feet
    sheet = Image.new('RGBA', (128 * 9, 128), (0, 0, 0, 0))
    for i, frame in enumerate(breathe(south)):
        sheet.alpha_composite(frame, (i * 128 + 16, dy))
    sheet.save(f'{OUT}/characters/{slug}-idle.png')
    south.resize((288, 288), Image.NEAREST).save(f'{OUT}/characters/{slug}-portrait.png')
    anchors[slug] = round(105 / 128, 4)

for dst, src in {'items/so-khach.png': 'item/all-item-so-cai.png', 'items/thu-xe.png': 'item/all-item-phong-bi-niem.png',
                 'items/hom-go.png': 'item/all-item-hom-go.png'}.items():
    Image.open(f'{LIB}/{src}').convert('RGBA').save(f'{OUT}/{dst}')

# Ấm men lam: vẽ bằng code trong draw_teapot.py (ấm trong ảnh trà lâu quá nhỏ để cắt).
import subprocess
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'draw_teapot.py'), f'{OUT}/items/am-men-lam.png'], check=True)

# Bìa: ngõ + dải chân dung (0 lượt).
cover = Image.open(f'{OUT}/scenes/ngo.png').convert('RGBA')
shade = Image.new('RGBA', cover.size, (0, 0, 0, 0))
ImageDraw.Draw(shade).rectangle([0, 340, 512, 512], fill=(10, 12, 20, 170))
cover.alpha_composite(shade)
for i, slug in enumerate(['ong-luu', 'co-lan', 'a-phuc', 'hamilton']):
    portrait = Image.open(f'{OUT}/characters/{slug}-portrait.png').resize((150, 150), Image.NEAREST)
    cover.alpha_composite(portrait, (i * 124 + 6, 356))
cover.convert('RGB').save(f'{OUT}/cover.png')
print(json.dumps({'anchors': anchors, 'files': sorted(os.listdir(f'{OUT}/characters')) + sorted(os.listdir(f'{OUT}/items'))}))
