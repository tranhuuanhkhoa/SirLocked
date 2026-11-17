def inr(x, y, r): return r[0] <= x <= r[2] and r[1] <= y <= r[3]

def walk_ngo(x, y):
    ok = (inr(x, y, (0, 290, 228, 318)) or inr(x, y, (318, 290, 511, 318)) or inr(x, y, (226, 290, 320, 511))
          or inr(x, y, (324, 0, 376, 290)))
    blocked = any(inr(x, y, r) for r in [(316, 190, 348, 254), (262, 284, 312, 302), (318, 300, 334, 420),
                                         (384, 262, 432, 298), (195, 255, 238, 300), (376, 0, 390, 300),
                                         (318, 30, 346, 78), (316, 88, 336, 172), (222, 338, 246, 420),
                                         (220, 425, 242, 475), (486, 262, 511, 300)])
    return ok and not blocked

def walk_tralau(x, y):
    inside = abs(x - 255) / 220 + abs(y - 378) / 112 <= 0.92 and y >= 330
    counter = x < 262 and y < 386 + (x - 40) * 0.12
    tables = x > 288 and y < 438 - (x - 288) * 0.08
    return inside and not counter and not tables
