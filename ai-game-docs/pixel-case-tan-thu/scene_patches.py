"""Vật điều tra vẽ thêm vào cảnh màn tân thủ bằng inpaint của PixelLab, và ảnh bìa.

Theo inpaint/recipe.json: lấy ảnh PixelLab trả về (inpaint/<output>), chỉ chép đúng vùng mask vào cảnh tại
crop + mask. Pixel ngoài mask của cảnh giữ nguyên. Chạy lại nhiều lần vẫn ra cùng kết quả.
build_assets.py gọi sau khi chép cảnh thư viện. Chạy riêng:
    python3 ai-game-docs/pixel-case-tan-thu/scene_patches.py src/FE/public/assets/pixel/tan-thu
"""
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def apply_inpaint(out):
    recipe = json.load(open(os.path.join(HERE, 'inpaint', 'recipe.json'), encoding='utf-8'))
    for patch in recipe['patches']:
        scene_path = os.path.join(out, patch['scene'])
        scene = Image.open(scene_path).convert('RGBA')
        result = Image.open(os.path.join(HERE, 'inpaint', patch['output'])).convert('RGBA')
        crop, mask = patch['crop'], patch['mask']
        assert result.size == (crop['size'], crop['size']), f"{patch['output']}: cần {crop['size']}x{crop['size']}"
        region = result.crop((mask['x'], mask['y'], mask['x'] + mask['width'], mask['y'] + mask['height']))
        scene.paste(region, (crop['x'] + mask['x'], crop['y'] + mask['y']))
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
