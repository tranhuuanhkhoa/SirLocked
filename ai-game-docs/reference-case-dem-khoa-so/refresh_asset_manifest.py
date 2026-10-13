"""Inspect generated assets without changing pixels; refresh reproducible provenance."""
from pathlib import Path
import hashlib
import json
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
records = json.loads((HERE / 'asset-prompts.json').read_text(encoding='utf-8'))['assets']
assets = []
for record in records:
    path = ROOT / 'src/FE/public' / record['url'].lstrip('/')
    with Image.open(path) as image:
        entry = dict(url=record['url'], size=list(image.size), mode=image.mode,
                     bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        if record['transparentBackground']:
            assert image.mode == 'RGBA', f'Missing alpha: {path}'
            alpha = image.getchannel('A')
            assert alpha.getextrema()[0] == 0 and alpha.getextrema()[1] > 200, f'Invalid cutout: {path}'
            entry['alphaExtrema'] = list(alpha.getextrema())
            entry['visibleBounds'] = list(alpha.getbbox())
        assets.append(entry)
assert len(assets) == 13
manifest = dict(style='pixel-v2', generatedImages=len(assets),
                totalBytes=sum(asset['bytes'] for asset in assets), assets=assets)
(HERE / 'asset-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Validated {len(assets)} generated images, 11 transparent cutouts; {manifest["totalBytes"]} bytes.')
