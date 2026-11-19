"""Builds case-pixel-tram-hong-ngoc-vi.json — the first OPEN_COOP test case.

Reuses the map, interiors, walk grids and NPC sprites of "Lọ thuốc thứ Năm" (no new PixelLab art) and
places all ten interactive puzzle kinds on objects that exist in the background art. Puzzle content
(documents, names, letters) comes from src/FE/Client/js/game/puzzles/fixtures/<kind>.json when present;
the server fills every per-case answer at seed time (PuzzleKindRegistry.FillMissing).

Run from the repo root:  python3 ai-game-docs/pixel-case-tram-hong-ngoc/build_case.py
"""
import copy, json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'src/BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json')
OUT = os.path.join(ROOT, 'src/BE/SeedData/V3/case-pixel-tram-hong-ngoc-vi.json')
FIXTURES = os.path.join(ROOT, 'src/FE/Client/js/game/puzzles/fixtures')
W = 2048  # runtime size (512 native × 4)

source = json.load(open(SRC, encoding='utf-8'))
src_scenes = {s['sceneId']: s for st in source['stages'] for s in st['scenes']}
src_chars = {c['characterId']: c for c in source['characters']}

SCENES = {  # new id → (source id, title, description)
    'scene-tn-pho': ('scene-px-pho', 'Phố Hàng Đường', 'Quảng trường đồng hồ, sáng thứ Bảy. Ông Bửu vừa báo mất trâm.'),
    'scene-tn-cam-do': ('scene-px-cam-do', 'Tiệm cầm đồ Đặng Bửu', 'Két sắt mở toang, ngăn đựng trâm hồng ngọc trống trơn.'),
    'scene-tn-nha-so-7': ('scene-px-nha-so-7', 'Nhà bà Lâm (số 7)', 'Nhà của bà Lâm — người đã cầm chiếc trâm ở tiệm ông Bửu.'),
    'scene-tn-hieu-thuoc': ('scene-px-hieu-thuoc', 'Hiệu thuốc Hưng Long', 'Quầy cân, sổ gửi đồ và những lọ bột xếp hàng.'),
    'scene-tn-nha-xe': ('scene-px-nha-xe', 'Nhà xe — chỗ ở của Trịnh Lực', 'Bánh xe ngựa đang sửa dở, rương đồ dưới chân giường.'),
    'scene-tn-hieu-anh': ('scene-px-hieu-anh', 'Hiệu ảnh Tô Khánh', 'Phông chụp vẽ cảnh vườn và buồng tối pha thuốc.'),
}
RENAME = {old: new for new, (old, _, _) in SCENES.items()}

def rt_box(x, y, w, h):
    """Percent box → runtime pixel box."""
    return {'x': round(x / 100 * W), 'y': round(y / 100 * W), 'width': round(w / 100 * W), 'height': round(h / 100 * W)}

def hotspot(hid, kind, target, label, x, y, w, h, z=5):
    return {'hotspotId': hid, 'type': kind, 'targetId': target, 'x': x, 'y': y, 'width': w, 'height': h,
            'zIndex': z, 'label': label, 'requiredClueIds': []}

def placement(item_id, x, y, w, h):
    box = rt_box(x, y, w, h)
    return {'itemId': item_id, 'asset': '', 'position': {'x': box['x'] + box['width'] // 2, 'y': box['y'] + box['height'], 'anchor': 'bottom-center'},
            'size': {'width': 160, 'height': 160}, 'hotspot': box, 'anchor': 'bottom-center', 'depth': 5}

def clue(cid, title, content, scene, source_id, source_type, evidence=True, critical=False, meaning=''):
    return {'clueId': cid, 'title': title, 'content': content, 'isCritical': critical, 'isEvidence': evidence,
            'isRedHerring': False, 'source': source_id, 'sourceType': source_type, 'discoverMethod': source_type,
            'sceneId': scene, 'inventoryDescription': content, 'narrativeMeaning': meaning, 'hintLevel': 1,
            'tags': [], 'relatedCharacterIds': []}

def item(iid, name, description, inspect, unlock=(), collectible=False, purpose='operate-mechanism'):
    return {'itemId': iid, 'name': name, 'description': description, 'inspectText': inspect, 'imageUrl': '',
            'unlockClueIds': list(unlock), 'isCollectible': collectible, 'isInteractivePuzzleObject': purpose == 'operate-mechanism',
            'interactionPurpose': purpose}

def fixture(kind):
    path = os.path.join(FIXTURES, f'{kind}.json')
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}

# ---------------------------------------------------------------- puzzles (one per kind)
# (puzzle id, kind, scene, target item, item name, percent box, prompt, evidence clue, reveal title, reveal text, required items, required clues)
PUZZLES = [
    ('puzzle-tn-hom-sat', 'lockpick', 'scene-tn-cam-do', 'item-tn-hom-sat', 'Hòm sắt cạnh cửa', (9, 54, 11, 12),
     'Hòm sắt khóa ổ bi. Nạy từng chốt theo đúng thứ tự để mở.', 'evidence-tn-hop-dong',
     'Hợp đồng bảo hiểm Sao Mai', 'Trong hòm là bản sao hợp đồng bảo hiểm trâm hồng ngọc 3.000 đồng, ông Bửu ký sáng thứ Hai tuần trước.', [], []),
    ('puzzle-tn-giay-xe', 'torn_paper', 'scene-tn-cam-do', 'item-tn-giay-xe', 'Mảnh giấy xé trên quầy', (63, 55, 9, 6),
     'Ghép các mảnh giấy xé để đọc lại lời nhắn.', 'evidence-tn-giay-xe',
     'Mảnh giấy xé: "báo mất"', '"Thứ Sáu · 23 giờ · tự mở két · báo mất · đổ cho L." — chữ ký Đ.B.', [], []),
    ('puzzle-tn-van-tay', 'fingerprint', 'scene-tn-cam-do', 'item-tn-ket-sat', 'Két sắt của tiệm', (36, 30, 14, 18),
     'Rắc bột lên tay nắm két, lấy dấu và đối chiếu với thẻ vân tay.', 'evidence-tn-van-tay',
     'Dấu vân tay trên tay nắm két', 'Chỉ có dấu vân tay của Đặng Bửu. Không có dấu nào của Trịnh Lực.', [], []),
    ('puzzle-tn-so-cam-do', 'doc_forgery', 'scene-tn-cam-do', 'item-tn-so-cam-do', 'Sổ cầm đồ', (51, 50, 9, 6),
     'Soi trang sổ dưới các loại ánh sáng để tìm chỗ bị sửa.', 'evidence-tn-so-cam-do',
     'Sổ cầm đồ bị sửa', 'Giá trị chiếc trâm bị sửa từ 300 đồng thành 3.000 đồng — mực mới, cùng ngày ký hợp đồng bảo hiểm.', [], []),
    ('puzzle-tn-hop-nhac', 'music_box', 'scene-tn-nha-so-7', 'item-tn-hop-nhac', 'Hộp nhạc của bà Lâm', (50, 31, 7, 6),
     'Cắm chốt lên trống để hộp nhạc chơi đúng giai điệu trên tấm bưu thiếp.', 'evidence-tn-cuong-phieu',
     'Cuống phiếu cầm của bà Lâm', 'Ngăn bí mật trong hộp nhạc giữ cuống phiếu: "Trâm hồng ngọc — cầm 300 đồng — Đặng Bửu".', [], []),
    ('puzzle-tn-dong-ho', 'gear_train', 'scene-tn-pho', 'item-tn-dong-ho', 'Đồng hồ cột quảng trường', (51, 33, 6, 18),
     'Lắp lại bộ bánh răng để đồng hồ quảng trường chạy đúng.', 'evidence-tn-dong-ho',
     'Đồng hồ quảng trường chậm 30 phút', 'Tối thứ Sáu đồng hồ quảng trường chạy chậm 30 phút. Ai nói "về lúc 23 giờ theo đồng hồ quảng trường" thật ra về lúc 23:30.', [], []),
    ('puzzle-tn-can', 'balance_scale', 'scene-tn-hieu-thuoc', 'item-tn-can', 'Cân tiểu ly trên quầy', (40, 55, 8, 9),
     'Chín lọ bột giống hệt nhau. Dùng cân để tìm lọ nặng hơn.', 'evidence-tn-tram-trong-lo',
     'Trâm hồng ngọc trong lọ bột', 'Lọ nặng hơn giấu chiếc trâm hồng ngọc, gói trong giấy của tiệm cầm đồ — chính lọ ông Bửu gửi giữ hộ.', [], ['evidence-tn-so-gui']),
    ('puzzle-tn-phong-chup', 'parallax_code', 'scene-tn-hieu-anh', 'item-tn-phong-chup', 'Phông chụp cảnh vườn', (11, 26, 22, 28),
     'Có ký hiệu lẫn trong phông vẽ. Đổi góc nhìn cho các nét khớp lại rồi nhập mã.', 'evidence-tn-anh-tram',
     'Phim chụp chiếc trâm', 'Mã mở ngăn phim: ông Bửu đặt chụp ảnh chiếc trâm chiều thứ Năm "để làm hồ sơ bảo hiểm".', [], []),
    ('puzzle-tn-hop-me-cung', 'tilt_maze', 'scene-tn-nha-xe', 'item-tn-hop-me-cung', 'Hộp mê cung trong rương', (76, 52, 14, 14),
     'Nghiêng hộp cho viên bi lăn vào ổ để mở nắp.', 'evidence-tn-bien-nhan',
     'Biên nhận sửa xe của Lực', '"Sửa bánh xe ngựa cho hiệu ảnh Tô Khánh — xong lúc 23:30 tối thứ Sáu." Có chữ ký ông Khánh.', [], []),
    ('puzzle-tn-thu-muc-an', 'reagent_mix', 'scene-tn-hieu-anh', 'item-tn-ban-pha-thuoc', 'Bàn pha thuốc buồng tối', (60, 34, 16, 10),
     'Pha thuốc thử đúng màu rồi quét lên lá thư trắng.', 'evidence-tn-thu-hai-phong',
     'Thư mực ẩn gửi Hải Phòng', '"Chủ nhật, bến số 3 — mang theo trâm — giá 2.000 đồng — Đ.B." Ông Bửu định bán chiếc trâm.', ['item-tn-la-thu-trang'], []),
]

# ---------------------------------------------------------------- characters
def char(new_id, old_id, role, description):
    c = copy.deepcopy(src_chars[old_id])
    c['characterId'] = new_id
    c['role'] = role
    c['description'] = description
    return c
characters = [
    char('char-tn-dang-buu', 'char-px-dang-buu', 'Chủ tiệm cầm đồ — người báo mất', 'Báo mất chiếc trâm hồng ngọc bà Lâm cầm ở tiệm, đổ cho tài xế Trịnh Lực.'),
    char('char-tn-trinh-luc', 'char-px-trinh-luc', 'Tài xế — bị nghi lấy trâm', 'Nợ ông Bửu mười đồng. Tối thứ Sáu sửa xe ngựa cho hiệu ảnh tới khuya.'),
]

# ---------------------------------------------------------------- clues
clues = [
    clue('evidence-tn-hop-dong', 'Hợp đồng bảo hiểm Sao Mai', 'Bảo hiểm trâm hồng ngọc 3.000 đồng, Đặng Bửu ký sáng thứ Hai tuần trước.', 'scene-tn-cam-do', 'puzzle-tn-hom-sat', 'puzzle', critical=True, meaning='Bửu được lợi nếu trâm "mất".'),
    clue('evidence-tn-giay-xe', 'Mảnh giấy xé: "báo mất"', '"Thứ Sáu · 23 giờ · tự mở két · báo mất · đổ cho L." — chữ ký Đ.B.', 'scene-tn-cam-do', 'puzzle-tn-giay-xe', 'puzzle', critical=True),
    clue('evidence-tn-van-tay', 'Dấu vân tay trên tay nắm két', 'Chỉ có dấu vân tay của Đặng Bửu trên tay nắm két; không có dấu của Trịnh Lực.', 'scene-tn-cam-do', 'puzzle-tn-van-tay', 'puzzle', critical=True),
    clue('evidence-tn-so-cam-do', 'Sổ cầm đồ bị sửa', 'Giá trị chiếc trâm bị sửa từ 300 đồng thành 3.000 đồng bằng mực mới.', 'scene-tn-cam-do', 'puzzle-tn-so-cam-do', 'puzzle'),
    clue('evidence-tn-cuong-phieu', 'Cuống phiếu cầm của bà Lâm', 'Trâm hồng ngọc — cầm 300 đồng — Đặng Bửu nhận.', 'scene-tn-nha-so-7', 'puzzle-tn-hop-nhac', 'puzzle'),
    clue('evidence-tn-dong-ho', 'Đồng hồ quảng trường chậm 30 phút', 'Tối thứ Sáu đồng hồ cột quảng trường chạy chậm đúng 30 phút.', 'scene-tn-pho', 'puzzle-tn-dong-ho', 'puzzle'),
    clue('evidence-tn-tram-trong-lo', 'Trâm hồng ngọc trong lọ bột', 'Chiếc trâm nằm trong lọ bột ông Bửu gửi hiệu thuốc giữ hộ lúc 22:45 tối thứ Sáu.', 'scene-tn-hieu-thuoc', 'puzzle-tn-can', 'puzzle', critical=True),
    clue('evidence-tn-anh-tram', 'Phim chụp chiếc trâm', 'Ông Bửu đặt chụp ảnh chiếc trâm chiều thứ Năm "để làm hồ sơ bảo hiểm".', 'scene-tn-hieu-anh', 'puzzle-tn-phong-chup', 'puzzle'),
    clue('evidence-tn-bien-nhan', 'Biên nhận sửa xe của Lực', 'Sửa bánh xe ngựa cho hiệu ảnh Tô Khánh, xong lúc 23:30 tối thứ Sáu — ông Khánh ký.', 'scene-tn-nha-xe', 'puzzle-tn-hop-me-cung', 'puzzle'),
    clue('evidence-tn-thu-hai-phong', 'Thư mực ẩn gửi Hải Phòng', '"Chủ nhật, bến số 3 — mang theo trâm — giá 2.000 đồng — Đ.B."', 'scene-tn-hieu-anh', 'puzzle-tn-thu-muc-an', 'puzzle'),
    clue('evidence-tn-so-gui', 'Sổ gửi đồ hiệu thuốc', 'Thứ Sáu 22:45 — Đặng Bửu gửi giữ hộ "một lọ bột thuốc ho", hẹn chiều Chủ nhật lấy.', 'scene-tn-hieu-thuoc', 'item-tn-so-gui', 'item', critical=True),
    {**clue('evidence-tn-tu-kinh', 'Tủ kính không bị phá', 'Ngăn đựng trâm trong tủ kính trống, nhưng khóa và mặt kính còn nguyên — không có dấu cạy.', 'scene-tn-cam-do', 'scene-tn-cam-do', 'camera',
            meaning='Không ai phá tủ hay két từ bên ngoài.'),
     'visualDescription': 'Glass display cabinet on the right of the pawnshop counter, lock and glass intact, one velvet slot empty.'},
    clue('evidence-tn-so-sua-xe', 'Sổ sửa xe của Lực', 'Ghi tay: "Thứ Sáu 20:00–23:30 — thay nan bánh xe ngựa hiệu ảnh."', 'scene-tn-nha-xe', 'item-tn-so-sua-xe', 'item'),
    clue('clue-tn-la-thu-trang', 'Lá thư trắng trơn', 'Tờ giấy trắng gấp tư trong thùng gỗ của tiệm cầm đồ, sờ thấy hơi cứng như từng thấm thuốc.', 'scene-tn-cam-do', 'item-tn-la-thu-trang', 'item', evidence=False),
    clue('fact-tn-buu-khai-ve', 'Ông Bửu khai giờ về', 'Ông Bửu khai đóng tiệm lúc 21 giờ, về nhà và không quay lại.', 'scene-tn-cam-do', 'dlg-tn-buu-toi-thu-sau', 'dialogue', evidence=False),
    clue('fact-tn-doi-ma', 'Mã két đổi hôm thứ Hai', 'Theo Lực, ông Bửu tự đổi mã két hôm thứ Hai và không nói cho ai.', 'scene-tn-nha-xe', 'dlg-tn-luc-ma-ket', 'dialogue', evidence=False),
    clue('reveal-tn-buu-lay-tram', 'BỬU TỰ LẤY TRÂM', 'Chiếc trâm rời két trước giờ "trộm" — chính ông Bửu mang nó đi gửi hiệu thuốc lúc 22:45.', 'scene-tn-cam-do', 'dlg-tn-buu-toi-thu-sau', 'dialogue', evidence=False, critical=True),
    clue('reveal-tn-luc-vo-toi', 'LỰC KHÔNG ĐỤNG VÀO KÉT', 'Chỉ có vân tay ông Bửu trên két; lời đổ cho Lực là dựng chuyện.', 'scene-tn-cam-do', 'dlg-tn-buu-ai-biet-ma', 'dialogue', evidence=False, critical=True),
    clue('reveal-tn-gia-that', 'TRÂM CHỈ ĐƯỢC CẦM 300 ĐỒNG', 'Cuống phiếu của bà Lâm ghi 300 đồng; con số 3.000 chỉ có trong sổ đã sửa và hợp đồng bảo hiểm.', 'scene-tn-cam-do', 'dlg-tn-buu-gia-tram', 'dialogue', evidence=False, critical=True),
    clue('fact-tn-gio-that', 'GIỜ THẬT CỦA ĐÊM THỨ SÁU', 'Tiệm đóng 21:00, trâm ra hiệu thuốc 22:45, Lực xong việc 23:30 — "kẻ trộm" chưa từng tồn tại.', 'scene-tn-pho', 'dlg-tn-buu-toi-thu-sau', 'dialogue', evidence=False, critical=True),
]

# Who each piece of evidence points to on the case wall (empty = the brooch card in the middle).
BUU, LUC = 'char-tn-dang-buu', 'char-tn-trinh-luc'
POINTS_TO = {
    'evidence-tn-hop-dong': [BUU], 'evidence-tn-giay-xe': [BUU], 'evidence-tn-van-tay': [BUU],
    'evidence-tn-so-cam-do': [BUU], 'evidence-tn-anh-tram': [BUU], 'evidence-tn-thu-hai-phong': [BUU],
    'evidence-tn-so-gui': [BUU], 'evidence-tn-bien-nhan': [LUC], 'evidence-tn-so-sua-xe': [LUC],
}
for c in clues:
    c['relatedCharacterIds'] = POINTS_TO.get(c['clueId'], [])

board = {
    'centerKicker': 'VẬT BỊ MẤT',
    'centerTitle': 'Trâm hồng ngọc',
    'centerSubtitle': 'của bà Lâm · cầm ở tiệm Đặng Bửu',
    'summary': 'Sáng thứ Bảy, ông Đặng Bửu báo mất chiếc trâm hồng ngọc bà Lâm cầm ở tiệm: két mở toang, tủ kính trống. Ông đổ cho tài xế Trịnh Lực.',
    'links': [
        {'fromId': 'evidence-tn-hop-dong', 'toId': 'evidence-tn-so-cam-do', 'label': 'CÙNG NGÀY THỨ HAI'},
        {'fromId': 'evidence-tn-so-gui', 'toId': 'evidence-tn-tram-trong-lo', 'label': 'GỬI LÚC 22:45'},
        {'fromId': 'evidence-tn-giay-xe', 'toId': 'frag-tn-buu-do-cho-luc', 'label': '"ĐỔ CHO L."'},
        {'fromId': 'evidence-tn-bien-nhan', 'toId': 'evidence-tn-so-sua-xe', 'label': 'XONG 23:30'},
        {'fromId': 'evidence-tn-thu-hai-phong', 'toId': 'evidence-tn-anh-tram', 'label': 'BÁN Ở HẢI PHÒNG'},
        {'fromId': 'frag-tn-luc-doi-ma', 'toId': 'frag-tn-buu-luc-biet-ma', 'label': 'MÃ ĐÃ ĐỔI'},
    ],
}

# ---------------------------------------------------------------- items
items = [
    item('item-tn-la-thu-trang', 'Lá thư trắng trơn', 'Tờ giấy trắng trong thùng gỗ.', 'Một tờ giấy trắng gấp tư, hơi cứng như từng thấm thuốc. Mang nó tới buồng tối hiệu ảnh thử xem.', ['clue-tn-la-thu-trang'], collectible=True, purpose='combine-item'),
    item('item-tn-so-gui', 'Sổ gửi đồ', 'Sổ gửi đồ của hiệu thuốc.', 'Thứ Sáu 22:45 — Đặng Bửu gửi giữ hộ "một lọ bột thuốc ho", hẹn chiều Chủ nhật lấy.', ['evidence-tn-so-gui'], purpose='legacy-evidence'),
    item('item-tn-so-sua-xe', 'Sổ sửa xe', 'Sổ ghi việc của Trịnh Lực.', 'Thứ Sáu 20:00–23:30 — thay nan bánh xe ngựa hiệu ảnh.', ['evidence-tn-so-sua-xe'], purpose='legacy-evidence'),
]
for pid, kind, scene, target, name, box, prompt, ev, rt, rtext, req_items, req_clues in PUZZLES:
    locked_note = ''
    if req_items: locked_note = ' Cần có lá thư trắng trong túi đồ trước.'
    if req_clues: locked_note = ' Đọc sổ gửi đồ trước để biết lọ nào là của ông Bửu.'
    items.append(item(target, name, f'{name}.', f'{name}.{locked_note}'))

# ---------------------------------------------------------------- dialogues & testimony
dialogues = [
    {'dialogueId': 'dlg-tn-buu-chuyen-gi', 'characterId': 'char-tn-dang-buu', 'question': 'Chuyện gì đã xảy ra?',
     'answer': 'Sáng nay tôi mở tiệm thì két mở toang, trâm hồng ngọc của bà Lâm biến mất. Tôi đã báo bảo hiểm rồi. Các ông cứ xem.'},
    {'dialogueId': 'dlg-tn-buu-toi-thu-sau', 'characterId': 'char-tn-dang-buu', 'question': 'Tối thứ Sáu ông làm gì?',
     'answer': 'Chín giờ tôi khóa két, đóng tiệm rồi về nhà ngủ. Tôi không hề quay lại tiệm. Lúc về tôi còn nhìn đồng hồ quảng trường: đúng 23 giờ.', 'unlockClueIds': ['fact-tn-buu-khai-ve']},
    {'dialogueId': 'dlg-tn-buu-ai-biet-ma', 'characterId': 'char-tn-dang-buu', 'question': 'Ai biết mã két?',
     'answer': 'Chỉ tôi và thằng Lực biết mã két — nó từng chở két về cho tôi. Nó còn nợ tôi tiền, chắc chắn là nó lấy.'},
    {'dialogueId': 'dlg-tn-buu-gia-tram', 'characterId': 'char-tn-dang-buu', 'question': 'Chiếc trâm giá bao nhiêu?',
     'answer': 'Bà Lâm cầm trâm với giá ba nghìn đồng. Sổ cầm đồ ghi rõ ràng đấy.'},
    {'dialogueId': 'dlg-tn-luc-toi-thu-sau', 'characterId': 'char-tn-trinh-luc', 'question': 'Tối thứ Sáu anh ở đâu?',
     'answer': 'Tôi thay nan bánh xe ngựa cho hiệu ảnh tới khuya, xong là đi ngủ luôn. Biên nhận tôi cất trong hộp mê cung — trò khóa của tôi, ở trong rương.'},
    {'dialogueId': 'dlg-tn-luc-no', 'characterId': 'char-tn-trinh-luc', 'question': 'Anh có nợ ông Bửu không?',
     'answer': 'Có, mười đồng, tôi trả dần. Nhưng tôi chưa từng mở két của ai.'},
    {'dialogueId': 'dlg-tn-luc-ma-ket', 'characterId': 'char-tn-trinh-luc', 'question': 'Anh có biết mã két không?',
     'answer': 'Không. Hôm thứ Hai ông Bửu tự đổi mã, còn khoe là "giờ chỉ mình tôi biết".', 'unlockClueIds': ['fact-tn-doi-ma']},
]
for d in dialogues:
    d.setdefault('requiredClueIds', []); d.setdefault('unlockClueIds', []); d['statementIds'] = []; d['availableSceneIds'] = []
fragments = [
    {'id': 'frag-tn-buu-khoa-ket', 'dialogueId': 'dlg-tn-buu-toi-thu-sau', 'text': 'Chín giờ tôi khóa két, đóng tiệm rồi về nhà ngủ.'},
    {'id': 'frag-tn-buu-khong-quay-lai', 'dialogueId': 'dlg-tn-buu-toi-thu-sau', 'text': 'Tôi không hề quay lại tiệm.'},
    {'id': 'frag-tn-buu-dong-ho', 'dialogueId': 'dlg-tn-buu-toi-thu-sau', 'text': 'Lúc về tôi còn nhìn đồng hồ quảng trường: đúng 23 giờ.'},
    {'id': 'frag-tn-buu-luc-biet-ma', 'dialogueId': 'dlg-tn-buu-ai-biet-ma', 'text': 'Chỉ tôi và thằng Lực biết mã két.'},
    {'id': 'frag-tn-buu-do-cho-luc', 'dialogueId': 'dlg-tn-buu-ai-biet-ma', 'text': 'Nó còn nợ tôi tiền, chắc chắn là nó lấy.'},
    {'id': 'frag-tn-buu-gia', 'dialogueId': 'dlg-tn-buu-gia-tram', 'text': 'Bà Lâm cầm trâm với giá ba nghìn đồng.'},
    {'id': 'frag-tn-buu-so-ghi', 'dialogueId': 'dlg-tn-buu-gia-tram', 'text': 'Sổ cầm đồ ghi rõ ràng đấy.'},
    {'id': 'frag-tn-luc-sua-xe', 'dialogueId': 'dlg-tn-luc-toi-thu-sau', 'text': 'Tôi thay nan bánh xe ngựa cho hiệu ảnh tới khuya.'},
    {'id': 'frag-tn-luc-tra-dan', 'dialogueId': 'dlg-tn-luc-no', 'text': 'Có, mười đồng, tôi trả dần.'},
    {'id': 'frag-tn-luc-khong-mo-ket', 'dialogueId': 'dlg-tn-luc-no', 'text': 'Tôi chưa từng mở két của ai.'},
    {'id': 'frag-tn-luc-doi-ma', 'dialogueId': 'dlg-tn-luc-ma-ket', 'text': 'Hôm thứ Hai ông Bửu tự đổi mã, khoe chỉ mình ông biết.'},
]
EVIDENCE_POOL = ['evidence-tn-tram-trong-lo', 'evidence-tn-so-gui', 'evidence-tn-van-tay', 'evidence-tn-tu-kinh',
                 'evidence-tn-cuong-phieu', 'evidence-tn-so-cam-do', 'evidence-tn-hop-dong', 'evidence-tn-dong-ho', 'evidence-tn-bien-nhan']
challenges = [
    {'challengeId': 'challenge-tn-quay-lai', 'order': 1, 'isSignature': True, 'dialogueId': 'dlg-tn-buu-toi-thu-sau',
     'testimonyFragmentId': 'frag-tn-buu-khong-quay-lai',
     'candidateTestimonyFragmentIds': ['frag-tn-buu-khoa-ket', 'frag-tn-buu-khong-quay-lai', 'frag-tn-buu-dong-ho'],
     'startRequiredTestimonyFragmentIds': ['frag-tn-buu-khong-quay-lai'],
     'prompt': 'Ông Bửu nói đóng tiệm xong là về, không quay lại. Chứng cứ nào cho thấy chiếc trâm rời két ngay trong đêm, qua tay chính ông?',
     'correctEvidenceId': 'evidence-tn-tram-trong-lo', 'candidateEvidenceIds': ['evidence-tn-tram-trong-lo', 'evidence-tn-so-gui', 'evidence-tn-tu-kinh', 'evidence-tn-dong-ho'],
     'startRequiredEvidenceIds': ['evidence-tn-tram-trong-lo'],
     'successResponse': 'Ông Bửu tái mặt: "Tôi… tôi chỉ gửi lọ thuốc ho thôi mà." Nhưng trong lọ là chiếc trâm.',
     'failureResponse': 'Ông Bửu khoanh tay: "Cái đó thì chứng minh được gì? Tôi về nhà ngủ."',
     'revealTitle': 'PHÁ ÁN: BỬU TỰ LẤY TRÂM', 'unlockClueIds': ['reveal-tn-buu-lay-tram']},
    {'challengeId': 'challenge-tn-do-cho-luc', 'order': 2, 'isSignature': False, 'dialogueId': 'dlg-tn-buu-ai-biet-ma',
     'testimonyFragmentId': 'frag-tn-buu-do-cho-luc',
     'candidateTestimonyFragmentIds': ['frag-tn-buu-luc-biet-ma', 'frag-tn-buu-do-cho-luc'],
     'startRequiredTestimonyFragmentIds': ['frag-tn-buu-do-cho-luc'],
     'prompt': 'Ông Bửu đổ cho Lực mở két. Chứng cứ nào cho thấy Lực chưa từng chạm vào két?',
     'correctEvidenceId': 'evidence-tn-van-tay', 'candidateEvidenceIds': ['evidence-tn-van-tay', 'evidence-tn-tu-kinh', 'evidence-tn-bien-nhan', 'evidence-tn-hop-dong'],
     'startRequiredEvidenceIds': ['evidence-tn-van-tay'],
     'successResponse': 'Ông Bửu im bặt. Trên tay nắm két chỉ có dấu tay của chính ông.',
     'failureResponse': 'Ông Bửu cười nhạt: "Thằng Lực khôn lắm, nó chẳng để lại gì đâu."',
     'revealTitle': 'PHÁ ÁN: LỰC KHÔNG ĐỤNG VÀO KÉT', 'unlockClueIds': ['reveal-tn-luc-vo-toi']},
    {'challengeId': 'challenge-tn-gia-tram', 'order': 3, 'isSignature': False, 'dialogueId': 'dlg-tn-buu-gia-tram',
     'testimonyFragmentId': 'frag-tn-buu-gia',
     'candidateTestimonyFragmentIds': ['frag-tn-buu-gia', 'frag-tn-buu-so-ghi'],
     'startRequiredTestimonyFragmentIds': ['frag-tn-buu-gia'],
     'prompt': 'Ông Bửu nói bà Lâm cầm trâm với giá ba nghìn đồng. Giấy tờ nào của chính bà Lâm nói khác?',
     'correctEvidenceId': 'evidence-tn-cuong-phieu', 'candidateEvidenceIds': ['evidence-tn-cuong-phieu', 'evidence-tn-so-cam-do', 'evidence-tn-hop-dong', 'evidence-tn-anh-tram'],
     'startRequiredEvidenceIds': ['evidence-tn-cuong-phieu'],
     'successResponse': 'Ông Bửu lắp bắp: "Thì… giá trâm lên rồi, tôi ghi lại cho đúng thôi."',
     'failureResponse': 'Ông Bửu gõ vào sổ: "Đấy, giấy trắng mực đen."',
     'revealTitle': 'PHÁ ÁN: TRÂM CHỈ ĐƯỢC CẦM 300 ĐỒNG', 'unlockClueIds': ['reveal-tn-gia-that']},
]

# ---------------------------------------------------------------- timeline (Friday night)
timeline = {
    'title': 'Đêm thứ Sáu',
    'prompt': 'Xếp các mốc vào đúng chỗ. Thẻ có giờ chắc chắn tự ghim lên trục; thẻ chưa rõ giờ thì kéo vào khe.',
    'events': [
        {'eventId': 'tl-tn-dong-tiem', 'label': 'Tiệm cầm đồ đóng cửa', 'detail': 'Ông Bửu khóa két và tắt đèn.', 'dayLabel': 'Thứ Sáu', 'timeLabel': '21:00', 'sortKey': 1260, 'isFixed': True, 'requiredClueIds': ['fact-tn-buu-khai-ve'], 'revealClueIds': []},
        {'eventId': 'tl-tn-gui-lo', 'label': 'Ông Bửu gửi "lọ bột" ở hiệu thuốc', 'detail': 'Theo sổ gửi đồ hiệu thuốc.', 'dayLabel': 'Thứ Sáu', 'timeLabel': '22:45', 'sortKey': 1365, 'isFixed': False, 'requiredClueIds': ['evidence-tn-so-gui'], 'revealClueIds': []},
        {'eventId': 'tl-tn-buu-ve', 'label': 'Ông Bửu thật sự về nhà', 'detail': 'Ông nói 23 giờ "theo đồng hồ quảng trường" — mà đồng hồ chậm 30 phút.', 'dayLabel': 'Thứ Sáu', 'timeLabel': '23:30 (đồng hồ chỉ 23:00)', 'sortKey': 1410, 'isFixed': False, 'requiredClueIds': ['evidence-tn-dong-ho', 'fact-tn-buu-khai-ve'], 'revealClueIds': ['fact-tn-gio-that']},
        {'eventId': 'tl-tn-luc-xong', 'label': 'Lực sửa xong bánh xe', 'detail': 'Biên nhận có chữ ký ông Khánh.', 'dayLabel': 'Thứ Sáu', 'timeLabel': '23:30', 'sortKey': 1411, 'isFixed': True, 'requiredClueIds': ['evidence-tn-bien-nhan'], 'revealClueIds': []},
        {'eventId': 'tl-tn-bao-mat', 'label': 'Ông Bửu báo mất trâm', 'detail': 'Ông gọi bảo hiểm Sao Mai trước khi báo cảnh sát.', 'dayLabel': 'Thứ Bảy', 'timeLabel': '07:00', 'sortKey': 1860, 'isFixed': True, 'requiredClueIds': [], 'revealClueIds': []},
    ],
}

# ---------------------------------------------------------------- scenes
def scene_runtime(new_id):
    src = src_scenes[SCENES[new_id][0]]
    rt = copy.deepcopy(src['runtime'])
    for t in rt.get('transitions', []):
        t['targetSceneId'] = RENAME[t['targetSceneId']]
        t['transitionId'] = t['transitionId'].replace('-px-', '-tn-')
    rt['spawnPoints'] = {(('from:' + RENAME[k[5:]]) if k.startswith('from:') else k): v for k, v in rt['spawnPoints'].items()}
    rt['itemPlacements'] = []
    rt['characterPlacements'] = []
    rt['clueZones'] = []
    return src, rt

scene_items = {sid: [] for sid in SCENES}
scene_hotspots = {sid: [] for sid in SCENES}
scene_runtimes = {}
scene_chars = {sid: [] for sid in SCENES}
for sid in SCENES:
    src, rt = scene_runtime(sid)
    scene_runtimes[sid] = (src, rt)

def add_item(sid, item_id, label, box, kind='ITEM'):
    scene_items[sid].append(item_id) if kind == 'ITEM' else None
    scene_hotspots[sid].append(hotspot(f'hotspot-{item_id[5:]}', kind, item_id, label, *box))
    scene_runtimes[sid][1]['itemPlacements'].append(placement(item_id, *box))

for pid, kind, scene, target, name, box, *_ in PUZZLES:
    add_item(scene, target, name, box)
add_item('scene-tn-cam-do', 'item-tn-la-thu-trang', 'Thùng gỗ cạnh tường', (27, 45, 9, 10))
add_item('scene-tn-hieu-thuoc', 'item-tn-so-gui', 'Sổ gửi đồ trên quầy', (35.9, 58.2, 10.5, 6.2))
add_item('scene-tn-nha-xe', 'item-tn-so-sua-xe', 'Sổ sửa xe trên bàn thợ', (17.6, 49.6, 12.5, 7.8))
# Camera clue: the intact display case in the pawnshop.
scene_runtimes['scene-tn-cam-do'][1]['clueZones'].append({
    'clueId': 'evidence-tn-tu-kinh', 'label': 'Tủ kính còn nguyên khóa', 'bounds': rt_box(64, 58, 12, 10), 'shape': 'rect',
    'surface': 'cabinet', 'visibility': 'clear', 'detectionDifficulty': 'easy', 'detectionStatus': 'FOUND', 'confidence': 0.9,
    'source': 'manual-visual-review', 'isFallback': False, 'requiredClueIds': [], 'reason': 'Tủ kính trưng bày bên phải quầy.'})

# NPCs: reuse the source placements in the pawnshop and the carriage house.
for sid, old_char, new_char in [('scene-tn-cam-do', 'char-px-dang-buu', 'char-tn-dang-buu'), ('scene-tn-nha-xe', 'char-px-trinh-luc', 'char-tn-trinh-luc')]:
    src = scene_runtimes[sid][0]
    cp = copy.deepcopy(next(p for p in src['runtime']['characterPlacements'] if p['characterId'] == old_char))
    cp['characterId'] = new_char
    scene_runtimes[sid][1]['characterPlacements'].append(cp)
    hs = copy.deepcopy(next(h for h in src['hotspots'] if h['targetId'] == old_char))
    hs['targetId'] = new_char
    hs['hotspotId'] = 'hotspot-' + new_char[5:]
    scene_hotspots[sid].append(hs)
    scene_chars[sid].append(new_char)

scenes = []
for sid, (old, title, description) in SCENES.items():
    src, rt = scene_runtimes[sid]
    scenes.append({'sceneId': sid, 'title': title, 'backgroundUrl': src['backgroundUrl'], 'description': description,
                   'itemIds': scene_items[sid], 'characterIds': scene_chars[sid], 'hotspots': scene_hotspots[sid], 'runtime': rt,
                   'completeCondition': {'logic': 'AND', 'requiredItemIds': [], 'requiredClueIds': [], 'requiredDialogueIds': []}})

# ---------------------------------------------------------------- puzzles
puzzles = []
for pid, kind, scene, target, name, box, prompt, ev, rtitle, rtext, req_items, req_clues in PUZZLES:
    fx = fixture(kind)
    puzzles.append({
        'puzzleId': pid, 'type': 'INTERACTIVE_PUZZLE', 'kind': kind, 'difficulty': 'EASY', 'targetId': target,
        'prompt': fx.get('prompt') or prompt, 'options': [], 'correctCode': '', 'correctSequence': [],
        'requiredItemIds': req_items, 'requiredClueIds': req_clues, 'unlockItemIds': [], 'unlockClueIds': [ev], 'unlockSceneIds': [],
        'successMessage': rtitle + '.', 'failureMessage': 'Chưa đúng — thử lại.', 'basedOnTruthIds': [], 'investigationPurpose': rtitle,
        'revealsConclusionIds': [], 'progressionRole': 'OPTIONAL',
        'params': fx.get('params', {}), 'solution': fx.get('solution', {}),
        'reveal': {'title': rtitle, 'text': rtext, **{k: v for k, v in (fx.get('reveal') or {}).items() if k not in ('title', 'text')}},
    })

case = {
    'caseId': 'case-pixel-tram-hong-ngoc-vi',
    'title': 'Trâm hồng ngọc mất tích',
    'summary': 'Sáng thứ Bảy, chủ tiệm cầm đồ Đặng Bửu báo mất chiếc trâm hồng ngọc bà Lâm cầm ở tiệm và đổ cho tài xế Trịnh Lực. Mười bí mật khóa kín quanh phố Hàng Đường — hai thám tử tự do đi khắp nơi, cùng nhau xem chuyện gì thật sự xảy ra đêm thứ Sáu.',
    'language': 'vi', 'status': 'DRAFT', 'mechanicsVersion': 3, 'generationMode': 'PLACEMENT_FIRST', 'ruleSet': 'OPEN_COOP',
    'estimatedMinutes': 20, 'coverImageUrl': '/assets/pixel/lo-thuoc-thu-nam/scenes/cam-do.png',
    'stages': [{'stageId': 'stage-tn-dem-thu-sau', 'title': 'Sáng thứ Bảy', 'order': 1, 'scenes': scenes}],
    'characters': characters, 'items': items, 'clues': clues, 'dialogues': dialogues, 'testimonyFragments': fragments,
    'conversationNodes': [], 'evidenceChallenges': challenges, 'deductions': [], 'requiredTeamworkChains': [], 'hints': [],
    'interactions': [], 'puzzles': puzzles, 'alternateRewardPaths': [], 'timeline': timeline, 'board': board,
    'finalLogic': {
        'culpritId': 'char-tn-dang-buu',
        'motive': 'Ông Bửu mua bảo hiểm trâm 3.000 đồng (thật ra chỉ cầm 300 đồng) rồi dựng vụ mất trộm để ăn tiền bảo hiểm và bán trâm ở Hải Phòng.',
        'method': 'Tự mở két bằng mã chỉ mình biết, giấu trâm trong lọ bột gửi hiệu thuốc lúc 22:45, rồi sáng thứ Bảy báo mất và đổ cho Lực.',
        'requiredEvidenceIds': [],
        'motiveOptions': [
            {'id': 'motive-tn-bao-hiem', 'label': 'Ăn tiền bảo hiểm 3.000 đồng cho một chiếc trâm chỉ cầm 300 đồng'},
            {'id': 'motive-tn-tra-thu', 'label': 'Trả thù Trịnh Lực vì khoản nợ mười đồng'},
            {'id': 'motive-tn-ba-lam', 'label': 'Giúp bà Lâm lấy lại trâm mà không phải chuộc'},
        ],
        'methodOptions': [
            {'id': 'method-tn-tu-mo-ket', 'label': 'Tự mở két, giấu trâm trong lọ bột gửi hiệu thuốc rồi báo mất'},
            {'id': 'method-tn-cay-ket', 'label': 'Thuê người cạy két lúc nửa đêm'},
            {'id': 'method-tn-tu-kinh', 'label': 'Phá tủ kính trưng bày lấy trâm'},
        ],
        'correctMotiveId': 'motive-tn-bao-hiem', 'correctMethodId': 'method-tn-tu-mo-ket',
        'requiredEvidenceLinks': [
            {'claimType': 'MOTIVE', 'evidenceId': 'evidence-tn-hop-dong'},
            {'claimType': 'METHOD', 'evidenceId': 'evidence-tn-tram-trong-lo'},
            {'claimType': 'OPPORTUNITY', 'evidenceId': 'evidence-tn-van-tay'},
        ],
        'requiredDeductionIds': [], 'requiredTeamworkChainIds': [],
        'winEnding': 'Hợp đồng bảo hiểm, chiếc trâm trong lọ bột và dấu tay trên két khép lại vụ án: Đặng Bửu tự dựng vụ trộm để ăn tiền bảo hiểm. Trịnh Lực vô tội.',
        'failEnding': 'Cáo buộc chưa nối được hợp đồng bảo hiểm, chiếc trâm và cái két. Hãy xem lại đêm thứ Sáu.',
    },
}

json.dump(case, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('wrote', OUT, len(json.dumps(case)) // 1024, 'KB;', len(puzzles), 'puzzles;', sum(1 for p in puzzles if p['params']), 'with fixture params')
