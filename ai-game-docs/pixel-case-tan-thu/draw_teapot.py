"""Vẽ icon ấm men lam 64x64 bằng code (pixel 32x32 phóng x2), 0 lượt PixelLab."""
import sys
from PIL import Image

W = 32
img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
px = img.load()
OUT, WHITE, SHADE, BLUE, DARK = (24, 22, 34, 255), (240, 243, 250, 255), (196, 204, 222, 255), (44, 78, 168, 255), (28, 46, 112, 255)


def body(x, y):
    return ((x - 15.5) / 9.5) ** 2 + ((y - 19.5) / 7.5) ** 2 <= 1


def lid(x, y):
    return ((x - 15.5) / 5.5) ** 2 + ((y - 11.5) / 2.2) ** 2 <= 1


def knob(x, y):
    return ((x - 15.5) / 1.6) ** 2 + ((y - 8.5) / 1.4) ** 2 <= 1


def spout(x, y):
    return 24 <= x <= 29 and 19 - (x - 24) <= y <= 21 - (x - 24) * 0.6


def handle(x, y):
    d = ((x - 5.5) / 3.6) ** 2 + ((y - 18.5) / 4.6) ** 2
    return 0.45 <= d <= 1 and x <= 7


shape = lambda x, y: body(x, y) or lid(x, y) or knob(x, y) or spout(x, y) or handle(x, y)
for y in range(W):
    for x in range(W):
        if not shape(x, y):
            continue
        color = WHITE
        if body(x, y):
            if y >= 23:
                color = SHADE
            if 17 <= y <= 18 or (y in (20, 21) and x % 4 in (0, 1)) or (y == 24 and x % 3 == 0):
                color = BLUE
            if 15 <= y <= 16 and x % 5 == 2:
                color = DARK
        elif lid(x, y) and y >= 12:
            color = BLUE
        elif knob(x, y) or handle(x, y) or spout(x, y):
            color = BLUE if (x + y) % 2 else DARK
        px[x, y] = color
# viền đen 1 px quanh hình
edge = img.copy()
for y in range(W):
    for x in range(W):
        if img.getpixel((x, y))[3]:
            continue
        if any(0 <= x + dx < W and 0 <= y + dy < W and img.getpixel((x + dx, y + dy))[3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            edge.putpixel((x, y), OUT)
edge.resize((64, 64), Image.NEAREST).save(sys.argv[1])
