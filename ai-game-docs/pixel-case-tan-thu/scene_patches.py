"""Vật điều tra vẽ vào cảnh màn tân thủ bằng inpaint của PixelLab, và ảnh bìa.

Theo inpaint/recipe.json: lấy ảnh PixelLab trả về (inpaint/<output>), chỉ chép đúng pixel trong mask vào cảnh tại
crop (mask tự do: maskFile trắng = vẽ lại; hoặc mask chữ nhật). Pixel ngoài mask của cảnh giữ nguyên, trừ các bước
cleanup ghi rõ trong recipe. Chạy trên cảnh thư viện mới chép (build_assets.py), chạy lại nhiều lần vẫn ra cùng kết quả.
Chạy riêng (cảnh trong OUT phải là bản thư viện chưa vá):
    python3 ai-game-docs/pixel-case-tan-thu/scene_patches.py src/FE/public/assets/pixel/tan-thu
"""
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def load_recipe():
    return json.load(open(os.path.join(HERE, 'inpaint', 'recipe.json'), encoding='utf-8'))


def apply_inpaint(out):
    for patch in load_recipe()['patches']:
        scene_path = os.path.join(out, patch['scene'])
        scene = Image.open(scene_path).convert('RGBA')
        result = Image.open(os.path.join(HERE, 'inpaint', patch['output'])).convert('RGBA')
        crop = patch['crop']
        size = crop['size']
        assert result.size == (size, size), f"{patch['output']}: cần {size}x{size}"
        if 'maskFile' in patch:
            mask = Image.open(os.path.join(HERE, 'inpaint', patch['maskFile'])).convert('L')
            assert mask.size == (size, size), f"{patch['maskFile']}: cần {size}x{size}"
            mask = mask.point(lambda value: 255 if value > 127 else 0)
        else:
            rect = patch['mask']
            mask = Image.new('L', (size, size), 0)
            ImageDraw.Draw(mask).rectangle([rect['x'], rect['y'], rect['x'] + rect['width'] - 1, rect['y'] + rect['height'] - 1], fill=255)
        region = scene.crop((crop['x'], crop['y'], crop['x'] + size, crop['y'] + size))
        region.paste(result, (0, 0), mask)
        scene.paste(region, (crop['x'], crop['y']))
        # Leftovers of old objects just outside the mask (cleanup in the recipe): copy a row of the background down,
        # only on pixels the mask did not repaint.
        for step in patch.get('cleanup', []):
            x0, y0, x1, y1 = step['rect']
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    if mask.getpixel((x - crop['x'], y - crop['y'])) == 0:
                        scene.putpixel((x, y), scene.getpixel((x, step['copyRow'])))
        scene.save(scene_path)


def make_cover(out):
    """Bìa: ngõ + dải chân dung (0 lượt)."""
    cover = Image.open(f'{out}/scenes/ngo.png').convert('RGBA')
    shade = Image.new('RGBA', cover.size, (0, 0, 0, 0))
    ImageDraw.Draw(shade).rectangle([0, 340, 512, 512], fill=(10, 12, 20, 170))
    cover.alpha_composite(shade)
    for i, slug in enumerate(['ong-luu', 'co-lan', 'a-phuc', 'hamilton']):
        portrait = Image.open(f'{out}/characters/{slug}-portrait.png').resize((150, 150), Image.NEAREST)
        cover.alpha_composite(portrait, (i * 124 + 6, 356))
    cover.convert('RGB').save(f'{out}/cover.png')


if __name__ == '__main__':
    apply_inpaint(sys.argv[1])
    make_cover(sys.argv[1])
    print('ok')
