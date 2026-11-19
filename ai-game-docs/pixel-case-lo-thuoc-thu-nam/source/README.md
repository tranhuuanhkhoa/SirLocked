# Nguồn dựng case pixel "Lọ thuốc thứ Năm"

- `art/` — ảnh gốc PixelLab (không sửa) cùng `*.request.json` / `*receipt.json` của từng lượt gọi: bản đồ `map-v1/`, mask `mask-v1/`, nội thất `interiors/` (`*-512.png` gốc, `*-cut.png` đã xóa nền phẳng bằng flood-fill), nhân vật `chars/` (4 ứng viên mặt trước, xoay 8 hướng trong `rot/`, sprite sheet PixelLab trong `sheet/`), tấm icon `items/`.
- `build/scenes_spec.py` — bố cục từng cảnh theo pixel gốc 512: sàn/đồ đạc chặn, cửa, điểm xuất hiện, hotspot, vùng chụp ảnh, cut-out che người.
- `build/build_assets.py` — xử lý cục bộ (không gọi AI): lưới đi bộ từ mask + khối chặn, cut-out RGB gốc + alpha mask, dải NPC 128 px, sprite sheet Watson 128 px, icon túi đồ, ảnh bìa; xuất ảnh kiểm tra vào `build/debug/`.
- `build/build_case.py` — ghép nội dung vụ án (tiếng Việt) với bố cục thành case JSON.

Dựng lại (Python 3 + Pillow + NumPy):

```bash
cd ai-game-docs/pixel-case-lo-thuoc-thu-nam/source
python3 -I build/build_assets.py "$(pwd)"
python3 -I build/build_case.py "$(pwd)"
# chép kết quả vào game
cp -r build/out/public/assets/pixel/lo-thuoc-thu-nam ../../../src/FE/public/assets/pixel/
cp -r build/out/public/assets/pixel/players/watson96.png ../../../src/FE/public/assets/pixel/players/
cp build/out/case-pixel-lo-thuoc-thu-nam-vi.json ../../../src/BE/SeedData/V3/
```

`build/out/` và `build/debug/` là đầu ra tạm, không cần commit.
