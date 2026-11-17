"""Màn tân thủ "Nhập môn: Ấm men lam" — vụ pixel cực dễ để dạy cách chơi (Thượng Hải 1930).

Ghi ra:
- src/BE/SeedData/V3/case-pixel-tan-thu-vi.json
- src/BE/SeedData/Cutscenes/case-pixel-tan-thu-vi.intro.json
Chạy từ gốc repo: python3 ai-game-docs/pixel-case-tan-thu/build_case.py
Ảnh do build_assets.py tạo (src/FE/public/assets/pixel/tan-thu).
Vật điều tra nằm sẵn trong ảnh cảnh (vẽ bằng inpaint PixelLab, xem inpaint/recipe.json): itemPlacements để asset rỗng,
ô bấm phủ đúng chỗ vật trong ảnh. items[].imageUrl chỉ là icon cho túi đồ và thẻ vật.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from walk import walk_ngo, walk_tralau  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
P = '/assets/pixel/tan-thu'
CASE_ID = 'case-pixel-tan-thu-vi'
TRA_LAU, NGO = 'scene-tt-tra-lau', 'scene-tt-ngo'

music_index = json.load(open(os.path.join(ROOT, 'src/FE/public/assets/audio/music/index.json'), encoding='utf-8'))
TRACKS = {track['id']: track for track in music_index['tracks']}
CUES = {
    "dialogue": "/assets/audio/point-click/dialogue.wav", "discovery": "/assets/audio/point-click/discovery.wav",
    "reveal": "/assets/audio/point-click/reveal.wav", "scene": "/assets/audio/point-click/scene.wav",
    "ping": "/assets/audio/point-click/ping.wav", "interact": "/assets/audio/point-click/interact.wav",
    "error": "/assets/audio/point-click/error.wav",
}


def music(track_id, volume):
    t = TRACKS[track_id]
    return {"url": t['file'], "fallbackUrl": t['fallback'], "title": t['title'], "source": t['source'], "license": t['license'],
            "loopStartSec": t['loopStartSec'], "loopEndSec": t['loopEndSec'], "volume": volume}


def pct(v):
    return round(v / 2048 * 100, 2)


def hotspot(hid, typ, target, rx, ry, rw, rh, label, z=5):
    return {"hotspotId": hid, "type": typ, "targetId": target, "x": pct(rx), "y": pct(ry), "width": pct(rw), "height": pct(rh),
            "zIndex": z, "label": label, "requiredClueIds": []}


def grid(walk):
    rows = []
    for gy in range(128):
        rows.append(''.join('1' if walk(gx * 4 + 2, gy * 4 + 2) else '0' for gx in range(128)))
    return {"cellSize": 16, "cols": 128, "rows": 128, "data": rows}


def spawn(x, y, d='right'):
    return {"x": x, "y": y, "anchor": "bottom-center", "direction": d}


def camera(w, h):
    return {"captureRectWidth": w, "captureRectHeight": h, "minClueCoverage": 0.45, "nearMissCoverage": 0.22, "requireCaptureCenterInside": True}


def item_place(item_id, hx, hy, hw, hh):
    """Vật vẽ sẵn trong ảnh cảnh: không có sprite (asset rỗng), ô bấm phủ đúng vật, vị trí = giữa cạnh dưới ô bấm."""
    return {"itemId": item_id, "asset": "", "position": {"x": hx + hw // 2, "y": hy + hh, "anchor": "bottom-center"},
            "size": {"width": hw, "height": hh}, "hotspot": {"x": hx, "y": hy, "width": hw, "height": hh}, "anchor": "bottom-center", "depth": 5}


# Ô bấm của vật (tọa độ runtime 2048 = native 512 x4), phủ đúng chỗ vật trong ảnh.
SO_KHACH = (772, 1300, 92, 72)   # sổ khách bìa đỏ trên quầy, giữa cái cân và khay trà (inpaint)
THU_XE = (452, 1248, 148, 80)    # mấy mảnh giấy trắng trên quầy, cạnh cái cân (có sẵn trong ảnh)
HOM_GO = (1280, 828, 96, 84)     # hòm gỗ đai sắt trên ghế xe kéo (inpaint)


def char_place(char_id, x, y, size, hx, hy, hw, hh, d):
    return {"characterId": char_id, "asset": "", "position": {"x": x, "y": y, "anchor": "bottom-center"}, "size": {"width": size, "height": size},
            "hotspot": {"x": hx, "y": hy, "width": hw, "height": hh}, "anchor": "bottom-center", "direction": d}


# ---------------------------------------------------------------- cảnh 1: trà lâu (phòng isometric)
tra_lau = {
    "sceneId": TRA_LAU,
    "title": "Trà lâu Vọng Nguyệt",
    "backgroundUrl": f"{P}/scenes/tra-lau.png",
    "description": "Trà lâu nhỏ trong ngõ Thạch Khố Môn. Đèn lồng đỏ, mùi trà nhài. Chiếc ấm men lam đời Minh vừa biến mất khỏi khay trà trên quầy.",
    "itemIds": ["item-tt-so-khach", "item-tt-thu-xe"],
    "characterIds": ["char-tt-ong-luu", "char-tt-co-lan"],
    "hotspots": [
        hotspot("hotspot-tt-so-khach", "ITEM", "item-tt-so-khach", *SO_KHACH, "Sổ khách trên quầy"),
        hotspot("hotspot-tt-thu-xe", "ITEM", "item-tt-thu-xe", *THU_XE, "Mấy mảnh thư xé cạnh cái cân"),
        hotspot("hotspot-tt-ong-luu", "CHARACTER", "char-tt-ong-luu", 748, 1372, 144, 344, "Ông Lưu", 6),
        hotspot("hotspot-tt-co-lan", "CHARACTER", "char-tt-co-lan", 1268, 1412, 144, 344, "Cô Tô Mỹ Lan", 6),
    ],
    "runtime": {
        "width": 2048, "height": 2048, "floorY": 1940,
        "walkableArea": {"x": 320, "y": 1320, "width": 1440, "height": 600},
        "navigationObstacles": [],
        "spawnPoints": {"default": spawn(1040, 1800, 'left'), "INVESTIGATOR": spawn(1000, 1800, 'left'),
                        "INTERROGATOR": spawn(1080, 1800, 'left'), f"from:{NGO}": spawn(1040, 1800, 'left')},
        "itemPlacements": [
            item_place("item-tt-so-khach", *SO_KHACH),
            item_place("item-tt-thu-xe", *THU_XE),
        ],
        "characterPlacements": [
            char_place("char-tt-ong-luu", 820, 1712, 512, 748, 1372, 144, 344, "right"),
            char_place("char-tt-co-lan", 1340, 1752, 512, 1268, 1412, 144, 344, "left"),
        ],
        "clueZones": [{
            "clueId": "clue-tt-vong-nuoc", "label": "Khay trà trên quầy", "bounds": {"x": 784, "y": 1192, "width": 216, "height": 112},
            "shape": "rect", "surface": "counter", "visibility": "clear", "detectionDifficulty": "easy", "detectionStatus": "FOUND",
            "confidence": 0.95, "source": "manual-visual-review", "isFallback": False, "requiredClueIds": [],
            "reason": "Khay trà ở đầu quầy, chỗ chiếc ấm men lam vẫn đặt."}],
        "transitions": [{"transitionId": "transition-tt-tra-lau-to-ngo", "targetSceneId": NGO, "label": "Ra ngõ Thạch Khố Môn",
                         "hotspot": {"x": 880, "y": 1780, "width": 320, "height": 160}, "depth": 22}],
        "cameraRules": camera(360, 280),
        "render": {"mode": "pixel", "projection": "isometric", "nativeWidth": 512, "nativeHeight": 512, "pixelScale": 4, "cameraZoom": 0.5,
                   "actorScale": 4, "walkSpeed": 520, "interactRadius": 104, "backdropColor": "#11100e", "walkGrid": grid(walk_tralau)},
        "audio": {"ambienceUrl": "", "cues": CUES, "music": music('thuong-hai-tra-lau', 0.5)},
        "weather": {"type": "NONE", "intensity": 0},
        "indoor": True,
        "timeOfDay": "DAY",
    },
    "completeCondition": {"logic": "AND", "requiredItemIds": [], "requiredClueIds": [], "requiredDialogueIds": []},
}

# ---------------------------------------------------------------- cảnh 2: ngõ Thạch Khố Môn (bản đồ nhìn từ trên)
ngo = {
    "sceneId": NGO,
    "title": "Ngõ Thạch Khố Môn",
    "backgroundUrl": f"{P}/scenes/ngo.png",
    "description": "Ngõ nhà cổng đá lát gạch, mưa phùn lất phất. Xe kéo của A Phúc đỗ ở đầu ngõ phía trên.",
    "itemIds": ["item-tt-hom-go"],
    "characterIds": ["char-tt-a-phuc", "char-tt-hamilton"],
    "hotspots": [
        hotspot("hotspot-tt-hom-go", "ITEM", "item-tt-hom-go", *HOM_GO, "Hòm gỗ trên xe kéo"),
        hotspot("hotspot-tt-a-phuc", "CHARACTER", "char-tt-a-phuc", 1400, 864, 96, 144, "A Phúc", 6),
        hotspot("hotspot-tt-hamilton", "CHARACTER", "char-tt-hamilton", 1040, 1440, 96, 144, "Ngài Hamilton", 6),
    ],
    "runtime": {
        "width": 2048, "height": 2048, "floorY": 2032,
        "walkableArea": {"x": 0, "y": 0, "width": 2048, "height": 2048},
        "navigationObstacles": [],
        "spawnPoints": {"default": spawn(408, 1216), "INVESTIGATOR": spawn(380, 1216), "INTERROGATOR": spawn(440, 1216),
                        f"from:{TRA_LAU}": spawn(408, 1216)},
        "itemPlacements": [item_place("item-tt-hom-go", *HOM_GO)],
        "characterPlacements": [
            char_place("char-tt-a-phuc", 1448, 1008, 192, 1400, 864, 96, 144, "left"),
            char_place("char-tt-hamilton", 1088, 1584, 192, 1040, 1440, 96, 144, "right"),
        ],
        "clueZones": [],
        "transitions": [{"transitionId": "transition-tt-ngo-to-tra-lau", "targetSceneId": TRA_LAU, "label": "Vào trà lâu Vọng Nguyệt",
                         "hotspot": {"x": 328, "y": 928, "width": 144, "height": 224}, "depth": 22}],
        "cameraRules": camera(200, 156),
        "render": {"mode": "pixel", "projection": "topdown", "nativeWidth": 512, "nativeHeight": 512, "pixelScale": 4, "cameraZoom": 1.0,
                   "actorScale": 1.5, "walkSpeed": 300, "interactRadius": 120, "backdropColor": "#2c333d", "walkGrid": grid(walk_ngo)},
        "audio": {"ambienceUrl": "", "cues": CUES, "music": music('thuong-hai-ngo-thach-kho-mon', 0.5)},
        "weather": {"type": "RAIN", "intensity": 0.3},
        "indoor": False,
        "timeOfDay": "DAY",
    },
    "completeCondition": {"logic": "AND", "requiredItemIds": [], "requiredClueIds": [], "requiredDialogueIds": []},
}


def char(cid, name, role, slug, desc, blip):
    return {"characterId": cid, "name": name, "role": role, "imageUrl": f"{P}/characters/{slug}-portrait.png", "description": desc,
            "presentation": {"spriteSheet": {"url": f"{P}/characters/{slug}-idle.png", "frameWidth": 128, "frameHeight": 128, "frameCount": 9,
                                             "fps": 6, "idleFrames": [], "anchorX": 0.5, "anchorY": 0.8203}},
            "voice": {"blip": blip}}


characters = [
    char("char-tt-ong-luu", "Ông Lưu", "Chủ trà lâu Vọng Nguyệt — người báo mất", "ong-luu",
         "Chủ trà lâu Vọng Nguyệt, quý chiếc ấm men lam đời Minh hơn cả quầy trà của mình.",
         {"pitch": 150, "speed": 16, "wave": "triangle", "variance": 0.15}),
    char("char-tt-co-lan", "Cô Tô Mỹ Lan", "Ca sĩ hát ở trà lâu", "co-lan",
         "Ca sĩ hát mỗi chiều ở trà lâu Vọng Nguyệt. Chiều nay tập hát trên sân khấu nhỏ cạnh bàn trà.",
         {"pitch": 560, "speed": 24, "wave": "sine", "variance": 0.25}),
    char("char-tt-a-phuc", "A Phúc", "Phu xe kéo — nhân chứng", "a-phuc",
         "Phu xe kéo đỗ xe ở đầu ngõ, thuộc mặt từng khách quen trong khu.",
         {"pitch": 260, "speed": 22, "wave": "square", "variance": 0.3}),
    char("char-tt-hamilton", "Ngài Hamilton", "Nhà sưu tầm đồ cổ người Anh", "hamilton",
         "Nhà sưu tầm đồ cổ người Anh ở khu tô giới, đội mũ cao, đeo kính một mắt, chống gậy bịt bạc.",
         {"pitch": 120, "speed": 18, "wave": "sawtooth", "variance": 0.2}),
]

items = [
    {"itemId": "item-tt-so-khach", "name": "Sổ khách của trà lâu", "description": "Cuốn sổ bìa đỏ ông Lưu để trên quầy, cạnh khay trà, cho khách quen ký tên.",
     "inspectText": "Trang hôm nay có hai chữ ký. Dòng cuối: \"Hamilton — 3 giờ chiều\", nét mực còn mới.",
     "imageUrl": f"{P}/items/so-khach.png", "unlockClueIds": ["evidence-tt-so-khach"], "isCollectible": False,
     "isInteractivePuzzleObject": False, "interactionPurpose": "legacy-evidence"},
    {"itemId": "item-tt-thu-xe", "name": "Mấy mảnh thư bị xé", "description": "Lá thư bị xé vụn, vứt trên quầy cạnh cái cân.",
     "inspectText": "Lá thư bị xé vụn, vứt trên quầy cạnh cái cân.", "imageUrl": f"{P}/items/thu-xe.png", "unlockClueIds": [],
     "isCollectible": False, "isInteractivePuzzleObject": True, "interactionPurpose": "operate-mechanism"},
    {"itemId": "item-tt-hom-go", "name": "Ấm men lam trong hòm gỗ", "description": "Chiếc hòm gỗ nhỏ khách để trên xe kéo của A Phúc.",
     "inspectText": "Mở hòm ra: chiếc ấm men lam đời Minh bọc trong khăn tay thêu hai chữ cái lồng nhau, mép khăn còn vương lá trà nhài.",
     "imageUrl": f"{P}/items/am-men-lam.png", "unlockClueIds": ["evidence-tt-am-men-lam"], "isCollectible": True,
     "isInteractivePuzzleObject": False, "interactionPurpose": "legacy-evidence"},
]


def clue(cid, title, content, critical, evidence, source, stype, scene, related=(), meaning=""):
    return {"clueId": cid, "title": title, "content": content, "isCritical": critical, "isEvidence": evidence, "isRedHerring": False,
            "source": source, "sourceType": stype, "discoverMethod": stype, "sceneId": scene, "inventoryDescription": content,
            "narrativeMeaning": meaning, "hintLevel": 1, "tags": [], "relatedCharacterIds": list(related)}


HAM = "char-tt-hamilton"
clues = [
    clue("fact-tt-mat-am", "Ấm mất lúc ông Lưu vào kho", "Khoảng 3 giờ 20 chiều ông Lưu vào kho lấy trà; mười phút sau quay ra thì khay trà trên quầy trống, ấm men lam không còn.",
         False, False, "dlg-tt-luu-chuyen-gi", "dialogue", TRA_LAU, ["char-tt-ong-luu"]),
    clue("fact-tt-hoi-mua", "Hai người ghé trà lâu chiều nay", "Chiều nay chỉ có cô Mỹ Lan tập hát và ngài Hamilton. Hôm qua ngài Hamilton hỏi mua ấm men lam, ông Lưu không bán.",
         False, False, "dlg-tt-luu-ai-den", "dialogue", TRA_LAU, [HAM, "char-tt-co-lan"]),
    clue("fact-tt-lan-thay", "Cô Mỹ Lan thấy ai bên quầy", "Lúc ông Lưu vào kho, cô Mỹ Lan thấy ngài Hamilton đứng một mình bên quầy, rồi ôm một chiếc hòm gỗ nhỏ đi vội ra ngõ.",
         False, False, "dlg-tt-lan-thay-gi", "dialogue", TRA_LAU, [HAM]),
    clue("evidence-tt-so-khach", "Chữ ký trong sổ khách", "Sổ khách trà lâu hôm nay ghi: \"Hamilton — 3 giờ chiều\". Ngài Hamilton đã ở trà lâu chiều nay.",
         True, True, "item-tt-so-khach", "item", TRA_LAU, [HAM], "Ngài Hamilton có mặt ở trà lâu đúng buổi chiều chiếc ấm biến mất."),
    clue("clue-tt-vong-nuoc", "Vòng nước trà trên khay", "Trên khay trà ở quầy còn một vòng nước ướt hình đáy ấm: chiếc ấm vừa bị nhấc đi chưa lâu.",
         False, True, TRA_LAU, "camera", TRA_LAU, [], "Chiếc ấm bị lấy ngay chiều nay, không phải từ hôm trước."),
]
clues[4]["visualDescription"] = "Tea tray at the right end of the teahouse counter with small cups and an empty wet ring where a teapot stood."
clues += [
    clue("evidence-tt-thu-tra-gia", "Thư trả giá của ngài Hamilton", "Thư ngài Hamilton gửi ông Lưu xin mua ấm men lam 500 đồng bạc; ông Lưu ghi \"không bán\" bên lề rồi xé bỏ.",
         True, True, "puzzle-tt-thu-xe", "puzzle", TRA_LAU, [HAM], "Ngài Hamilton muốn có chiếc ấm mà ông Lưu không chịu bán."),
    clue("fact-tt-phuc-cho", "A Phúc chờ chở ngài Hamilton", "Ngài Hamilton thuê A Phúc chở ra bến tàu, đặt chiếc hòm gỗ nhỏ lên xe rồi dặn chờ, nói sẽ quay lại ngay.",
         False, False, "dlg-tt-phuc-cho-ai", "dialogue", NGO, [HAM]),
    clue("evidence-tt-am-men-lam", "Ấm men lam trong hòm của ngài Hamilton", "Chiếc ấm men lam mất ở trà lâu nằm trong hòm gỗ ngài Hamilton để trên xe kéo, bọc khăn tay thêu chữ lồng của ngài.",
         True, True, "item-tt-hom-go", "item", NGO, [HAM], "Người cất chiếc ấm vào hòm là ngài Hamilton."),
    clue("fact-tt-ham-khai", "Lời khai của ngài Hamilton", "Ngài Hamilton khai đi dạo phố tô giới cả chiều, chưa hề vào trà lâu nào, rồi gọi xe kéo ra bến tàu.",
         False, False, "dlg-tt-ham-chieu-nay", "dialogue", NGO, [HAM]),
    clue("reveal-tt-ham-o-tra-lau", "NGÀI HAMILTON ĐÃ Ở TRÀ LÂU", "Chữ ký 3 giờ chiều trong sổ khách cho thấy ngài Hamilton nói dối: ngài đã ở trà lâu đúng lúc chiếc ấm biến mất.",
         True, False, "dlg-tt-ham-chieu-nay", "dialogue", NGO, [HAM]),
]


def dialogue(did, cid, q, a, unlock=()):
    return {"dialogueId": did, "characterId": cid, "question": q, "answer": a, "requiredClueIds": [], "unlockClueIds": list(unlock),
            "statementIds": [], "availableSceneIds": []}


HAM_ANSWER = ("Tôi đi dạo phố tô giới suốt buổi chiều, ngắm mấy cửa hiệu đồ cổ ở đường Nam Kinh. "
              "Tôi chưa hề bước chân vào trà lâu nào hôm nay. "
              "Mưa phùn bắt đầu thì tôi gọi xe kéo ra bến tàu, tối nay tàu đi Hồng Kông.")
dialogues = [
    dialogue("dlg-tt-luu-chuyen-gi", "char-tt-ong-luu", "Chuyện gì đã xảy ra?",
             "Chiếc ấm men lam đời Minh của trà lâu biến mất rồi! Ba giờ hai mươi tôi vào kho lấy trà nhài, mười phút sau quay ra thì khay trà trên quầy trống trơn.",
             ["fact-tt-mat-am"]),
    dialogue("dlg-tt-luu-ai-den", "char-tt-ong-luu", "Chiều nay ai ghé trà lâu?",
             "Chỉ có cô Mỹ Lan tập hát và ngài Hamilton, ông người Anh mê đồ cổ. Hôm qua ông ấy hỏi mua ấm men lam, tôi không bán.",
             ["fact-tt-hoi-mua"]),
    dialogue("dlg-tt-lan-thay-gi", "char-tt-co-lan", "Chiều nay cô thấy gì?",
             "Tôi tập hát suốt buổi. Lúc ông Lưu vào kho, tôi thấy ngài Hamilton đứng một mình bên quầy, rồi ôm một chiếc hòm gỗ nhỏ đi vội ra ngõ.",
             ["fact-tt-lan-thay"]),
    dialogue("dlg-tt-phuc-cho-ai", "char-tt-a-phuc", "Anh đang chờ chở ai?",
             "Ông Tây đội mũ cao đấy ạ. Ông ấy thuê tôi chở ra bến tàu, đặt cái hòm gỗ lên xe rồi dặn chờ, nói quay lại ngay.",
             ["fact-tt-phuc-cho"]),
    dialogue("dlg-tt-ham-chieu-nay", HAM, "Chiều nay ngài ở đâu?", HAM_ANSWER, ["fact-tt-ham-khai"]),
    dialogue("dlg-tt-ham-hom-go", HAM, "Hòm gỗ trên xe là của ngài?",
             "Chỉ là vài món quà lưu niệm mua ở đường Nam Kinh. Đồ riêng của tôi, các anh không có quyền lục."),
]

fragments = [
    {"id": "frag-tt-ham-di-dao", "dialogueId": "dlg-tt-ham-chieu-nay", "text": "Tôi đi dạo phố tô giới suốt buổi chiều, ngắm mấy cửa hiệu đồ cổ ở đường Nam Kinh."},
    {"id": "frag-tt-ham-chua-vao", "dialogueId": "dlg-tt-ham-chieu-nay", "text": "Tôi chưa hề bước chân vào trà lâu nào hôm nay."},
    {"id": "frag-tt-ham-ra-ben", "dialogueId": "dlg-tt-ham-chieu-nay", "text": "Mưa phùn bắt đầu thì tôi gọi xe kéo ra bến tàu, tối nay tàu đi Hồng Kông."},
]
for fragment in fragments:
    assert fragment["text"] in HAM_ANSWER, fragment

challenges = [{
    "challengeId": "challenge-tt-chua-vao", "order": 1, "isSignature": True, "dialogueId": "dlg-tt-ham-chieu-nay",
    "testimonyFragmentId": "frag-tt-ham-chua-vao",
    "candidateTestimonyFragmentIds": [f["id"] for f in fragments],
    "startRequiredTestimonyFragmentIds": ["frag-tt-ham-chua-vao"],
    "prompt": "Ngài Hamilton nói chưa hề bước chân vào trà lâu hôm nay. Chứng cứ nào cho thấy ngài đã ở đó?",
    "correctEvidenceId": "evidence-tt-so-khach",
    "candidateEvidenceIds": ["evidence-tt-so-khach", "evidence-tt-am-men-lam", "evidence-tt-thu-tra-gia"],
    "startRequiredEvidenceIds": ["evidence-tt-so-khach"],
    "successResponse": "Ngài Hamilton chỉnh lại kính một mắt, giọng chùng xuống: \"Thôi được… tôi có ghé uống một chén trà.\"",
    "failureResponse": "Ngài Hamilton nhún vai: \"Cái đó thì chứng minh được gì về chuyện tôi đi dạo?\"",
    "revealTitle": "PHÁ ÁN: NGÀI HAMILTON ĐÃ Ở TRÀ LÂU", "unlockClueIds": ["reveal-tt-ham-o-tra-lau"],
}]

puzzles = [{
    "puzzleId": "puzzle-tt-thu-xe", "type": "INTERACTIVE_PUZZLE", "kind": "torn_paper", "difficulty": "EASY", "targetId": "item-tt-thu-xe",
    "prompt": "Kéo từng mảnh vào khung. Nhấp đúp (hoặc phím R) để xoay mảnh bị ngược. Mảnh đặt đúng sẽ tự khớp.",
    "options": [], "correctCode": "", "correctSequence": [], "requiredItemIds": [], "requiredClueIds": [], "unlockItemIds": [],
    "unlockClueIds": ["evidence-tt-thu-tra-gia"], "unlockSceneIds": [],
    "successMessage": "Thư trả giá của ngài Hamilton.", "failureMessage": "Chưa khớp — thử lại.",
    "basedOnTruthIds": [], "investigationPurpose": "Ai muốn có chiếc ấm men lam", "revealsConclusionIds": [], "progressionRole": "OPTIONAL",
    "params": {
        "find": {"tag": "VẬT CHỨNG · TRÀ LÂU", "title": "Trên quầy, cạnh cái cân", "text": "Mấy mảnh thư bị xé vụn vứt trên quầy trà lâu Vọng Nguyệt, cạnh cái cân."},
        "doc": {"head": "THƯ TRẢ GIÁ", "sub": "GỬI CHỦ TRÀ LÂU VỌNG NGUYỆT", "meta": "[[NGÀY]] HÔM QUA · [[NGÕ]] THẠCH KHỐ MÔN",
                "to": "[[VIỆC:]] ẤM MEN LAM ĐỜI MINH", "lines": ["XIN MUA ẤM MEN LAM", "TRẢ 500 ĐỒNG BẠC"], "sign": "KÝ: HAMILTON",
                "stamp": ["TÔ GIỚI", "H.", "THƯỢNG HẢI"], "circle": "500 ĐỒNG", "underline": "MUA ẤM MEN LAM"},
        "note": {"text": "không bán", "mark": "Lưu"},
    },
    "solution": {"hints": ["Bắt đầu từ mảnh có tiêu đề in hoa, đặt nó lên trên cùng.",
                           "Mảnh nào chữ bị ngược thì nhấp đúp (hoặc bấm R) để xoay lại.",
                           "Mảnh có chữ ký Hamilton nằm ở góc dưới; ghép xong sẽ đọc được giá 500 đồng."]},
    "reveal": {"title": "Thư trả giá của ngài Hamilton", "text": "\"Xin mua ấm men lam · trả 500 đồng bạc\" — ký Hamilton. Bên lề, ông Lưu viết: \"không bán\"."},
}]

timeline = {"title": "Chiều mưa phùn ở trà lâu", "prompt": "Xếp các mốc vào đúng chỗ. Thẻ có giờ chắc chắn tự ghim lên trục; thẻ chưa rõ giờ thì kéo vào khe.",
            "events": [
                {"eventId": "tl-tt-ky-so", "label": "Ngài Hamilton ký sổ khách", "detail": "Dòng cuối trong sổ khách.", "dayLabel": "Chiều nay",
                 "timeLabel": "15:00", "sortKey": 900, "isFixed": True, "requiredClueIds": ["evidence-tt-so-khach"], "revealClueIds": []},
                {"eventId": "tl-tt-vao-kho", "label": "Ông Lưu vào kho lấy trà", "detail": "Quầy vắng mười phút.", "dayLabel": "Chiều nay",
                 "timeLabel": "15:20", "sortKey": 920, "isFixed": True, "requiredClueIds": ["fact-tt-mat-am"], "revealClueIds": []},
                {"eventId": "tl-tt-mat-am", "label": "Ấm men lam rời khỏi quầy", "detail": "Trong mười phút quầy vắng.", "dayLabel": "Chiều nay",
                 "timeLabel": "15:20–15:30", "sortKey": 925, "isFixed": False, "requiredClueIds": ["fact-tt-lan-thay"], "revealClueIds": []},
                {"eventId": "tl-tt-phat-hien", "label": "Ông Lưu thấy khay trà trống", "detail": "Quay ra từ kho.", "dayLabel": "Chiều nay",
                 "timeLabel": "15:30", "sortKey": 930, "isFixed": True, "requiredClueIds": [], "revealClueIds": []},
            ]}

board = {"centerKicker": "VẬT BỊ MẤT", "centerTitle": "Ấm men lam đời Minh", "centerSubtitle": "của trà lâu Vọng Nguyệt · ngõ Thạch Khố Môn",
         "summary": "Chiều mưa phùn, chiếc ấm men lam đời Minh biến mất khỏi khay trà trên quầy trong mười phút ông Lưu vào kho. Chiều nay chỉ có cô Mỹ Lan và ngài Hamilton ghé trà lâu.",
         "links": [{"fromId": "evidence-tt-thu-tra-gia", "toId": "evidence-tt-am-men-lam", "label": "CÙNG CHIẾC ẤM"},
                   {"fromId": "frag-tt-ham-ra-ben", "toId": "evidence-tt-am-men-lam", "label": "HÒM TRÊN XE KÉO"}]}

final = {
    "culpritId": HAM,
    "motive": "Ngài Hamilton muốn có chiếc ấm men lam đời Minh; hôm qua trả 500 đồng nhưng ông Lưu không bán.",
    "method": "Lúc ông Lưu vào kho, ngài Hamilton nhấc ấm khỏi khay trà, cất vào hòm gỗ rồi đặt lên xe kéo của A Phúc chờ ra bến tàu.",
    "requiredEvidenceIds": [],
    "motiveOptions": [{"id": "motive-tt-muon-am", "label": "Muốn có chiếc ấm mà ông Lưu không chịu bán"},
                      {"id": "motive-tt-tra-thu", "label": "Muốn trả thù ông Lưu vì trà lâu ồn ào"},
                      {"id": "motive-tt-giu-ho", "label": "Cầm giữ hộ cho khỏi bị mất"}],
    "methodOptions": [{"id": "method-tt-luc-vao-kho", "label": "Lúc ông Lưu vào kho, nhấc ấm khỏi quầy, cất vào hòm gỗ rồi đặt lên xe kéo"},
                      {"id": "method-tt-nho-phuc", "label": "Nhờ A Phúc vào trà lâu lấy hộ"},
                      {"id": "method-tt-dem-qua", "label": "Lẻn vào trà lâu từ đêm qua"}],
    "correctMotiveId": "motive-tt-muon-am", "correctMethodId": "method-tt-luc-vao-kho",
    "requiredEvidenceLinks": [{"claimType": "MOTIVE", "evidenceId": "evidence-tt-thu-tra-gia"},
                              {"claimType": "METHOD", "evidenceId": "evidence-tt-am-men-lam"},
                              {"claimType": "OPPORTUNITY", "evidenceId": "evidence-tt-so-khach"}],
    "requiredDeductionIds": [], "requiredTeamworkChainIds": [],
    "winEnding": "Sổ khách, lá thư trả giá và chiếc ấm trong hòm gỗ khép lại vụ án: ngài Hamilton lấy chiếc ấm mà ông Lưu không chịu bán. Ấm men lam về lại khay trà, và bạn đã sẵn sàng cho vụ án thật.",
    "failEnding": "Cáo buộc chưa nối được ai có mặt ở trà lâu, vì sao muốn chiếc ấm và chiếc ấm đang ở đâu. Xem lại hồ sơ rồi thử lại nhé.",
}


def hint(hid, ctx, target, order, text):
    return {"hintId": hid, "contextType": ctx, "targetId": target, "order": order, "text": text}


hints = [
    hint("hint-tt-tra-lau-1", "SCENE", TRA_LAU, 1, "Hỏi ông Lưu chuyện gì đã xảy ra và chiều nay ai ghé trà lâu."),
    hint("hint-tt-tra-lau-2", "SCENE", TRA_LAU, 2, "Xem sổ khách bìa đỏ trên quầy và mấy mảnh thư xé cạnh cái cân."),
    hint("hint-tt-tra-lau-3", "SCENE", TRA_LAU, 3, "Sổ khách có chữ ký lúc 3 giờ chiều; ghép lá thư xé để biết ai muốn mua chiếc ấm."),
    hint("hint-tt-ngo-1", "SCENE", NGO, 1, "Người kéo xe ở đầu ngõ thấy hết khách ra vào."),
    hint("hint-tt-ngo-2", "SCENE", NGO, 2, "Hỏi A Phúc đang chờ ai, rồi xem chiếc hòm trên xe kéo."),
    hint("hint-tt-ngo-3", "SCENE", NGO, 3, "Mở hòm gỗ trên xe kéo của A Phúc."),
    hint("hint-tt-doi-chat-1", "CONFRONTATION", "challenge-tt-chua-vao", 1, "Có người nói mình không hề vào trà lâu."),
    hint("hint-tt-doi-chat-2", "CONFRONTATION", "challenge-tt-chua-vao", 2, "Vật nào ghi lại ai đã ghé trà lâu chiều nay?"),
    hint("hint-tt-doi-chat-3", "CONFRONTATION", "challenge-tt-chua-vao", 3, "Đặt câu \"chưa hề bước chân vào trà lâu\" cạnh chữ ký trong sổ khách."),
]

case = {
    "caseId": CASE_ID, "title": "Nhập môn: Ấm men lam",
    "summary": "Thượng Hải, 1930. Chiếc ấm men lam đời Minh của trà lâu Vọng Nguyệt biến mất khỏi quầy giữa buổi chiều mưa phùn. Màn tân thủ: vừa phá án vừa học cách chơi.",
    "language": "vi", "status": "DRAFT", "mechanicsVersion": 3, "generationMode": "PLACEMENT_FIRST", "ruleSet": "OPEN_COOP", "estimatedMinutes": 10,
    "coverImageUrl": f"{P}/cover.png",
    "stages": [{"stageId": "stage-tt-chieu-mua", "title": "Chiều mưa phùn", "order": 1, "scenes": [tra_lau, ngo]}],
    "characters": characters, "items": items, "clues": clues, "dialogues": dialogues, "testimonyFragments": fragments,
    "conversationNodes": [], "evidenceChallenges": challenges, "deductions": [], "requiredTeamworkChains": [], "hints": hints,
    "interactions": [], "puzzles": puzzles, "alternateRewardPaths": [], "timeline": timeline, "board": board, "finalLogic": final,
}

cutscene = {
    "format": "motion-comic-v1", "caseId": CASE_ID, "language": "vi",
    "title": {"eyebrow": "Hồ sơ nhập môn", "title": "Ấm men lam", "subtitle": "Thượng Hải, 1930. Vụ án đầu tiên của bạn."},
    "mood": "fog-morning",
    "pages": [
        {"layout": "wide-top-two-bottom", "panels": [
            {"art": {"kind": "scene", "id": NGO, "focus": [0.05, 0.08, 0.9, 0.84]}, "weather": "rain", "enter": "top",
             "beats": [{"type": "caption", "speakerId": "", "text": "Thượng Hải, 1930. Ngõ Thạch Khố Môn, chiều mưa phùn.", "style": ""},
                       {"type": "caption", "speakerId": "", "text": "Hai thám tử mới vào nghề nhận vụ án đầu tiên.", "style": ""}], "audio": []},
            {"art": {"kind": "scene", "id": TRA_LAU, "focus": [0.05, 0.08, 0.9, 0.84]}, "weather": "none", "enter": "left",
             "beats": [{"type": "speech", "speakerId": "char-tt-ong-luu", "text": "Ấm men lam đời Minh của tôi mất rồi!", "style": ""},
                       {"type": "sfx", "speakerId": "", "text": "CHOANG!", "style": "impact"}], "audio": []},
            {"art": {"kind": "character", "id": HAM, "focus": [0.1, 0.05, 0.8, 0.85]}, "weather": "none", "enter": "right",
             "beats": [{"type": "caption", "speakerId": "", "text": "Ngoài ngõ, một quý ông người Anh đang chờ xe kéo.", "style": ""}], "audio": []},
        ]},
        {"layout": "splash-inset", "panels": [
            {"art": {"kind": "cover", "id": "cover", "focus": [0, 0, 1, 1]}, "weather": "rain", "enter": "none",
             "beats": [{"type": "caption", "speakerId": "", "text": "Hỏi chuyện, tìm chứng cứ, vạch lời nói dối và gọi tên thủ phạm.", "style": ""},
                       {"type": "caption", "speakerId": "", "text": "Đừng lo: mũi tên vàng sẽ chỉ từng bước.", "style": ""}], "audio": []},
            {"art": {"kind": "character", "id": "char-tt-co-lan", "focus": [0.1, 0.05, 0.8, 0.85]}, "weather": "none", "enter": "right",
             "beats": [{"type": "speech", "speakerId": "char-tt-co-lan", "text": "Hai vị thám tử tới rồi! Mời vào trà lâu.", "style": ""}], "audio": []},
        ]},
    ],
}

out_case = os.path.join(ROOT, 'src/BE/SeedData/V3', CASE_ID + '.json')
out_cut = os.path.join(ROOT, 'src/BE/SeedData/Cutscenes', CASE_ID + '.intro.json')
with open(out_case, 'w', encoding='utf-8') as handle:
    json.dump(case, handle, ensure_ascii=False, indent=1)
    handle.write('\n')
with open(out_cut, 'w', encoding='utf-8') as handle:
    json.dump(cutscene, handle, ensure_ascii=False, indent=1)
    handle.write('\n')
walk_cells = [sum(row.count('1') for row in scene['runtime']['render']['walkGrid']['data']) for scene in (tra_lau, ngo)]
print('ok', out_case, 'walk cells', walk_cells)
