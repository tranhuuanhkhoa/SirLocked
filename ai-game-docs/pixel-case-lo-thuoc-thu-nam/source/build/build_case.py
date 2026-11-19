"""Assemble the hand-authored pixel case JSON from the story below + out/scene-runtime.json.

Usage: python3 -I build_case.py <px-root>  ->  out/case-pixel-lo-thuoc-thu-nam-vi.json
"""
import json, os, sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '..')
OUT = os.path.join(ROOT, 'build', 'out')
RT = json.load(open(os.path.join(OUT, 'scene-runtime.json')))
CASE_ID = 'case-pixel-lo-thuoc-thu-nam-vi'
AUDIO = '/assets/audio/point-click/'
CUES = {k: f'{AUDIO}{k}.wav' for k in ('dialogue', 'discovery', 'reveal', 'scene', 'ping', 'interact', 'error')}
ICON = RT['items']


def sid(key):
    return f'scene-px-{key}'


# ---------------------------------------------------------------- characters
CHARS = {
    'lam-the-bao': ('Lâm Thế Bảo', 'Cháu ruột ông Vinh',
                    'Ba mươi tư tuổi, từng học việc ba năm ở hiệu ảnh Tô Khánh. Đang nợ tiệm cầm đồ Đặng Bửu.'),
    'ly-hanh': ('Lý Hạnh', 'Người giúp việc 22 năm',
                'Giữ chìa khóa nhà số 7. Mỗi tối chín giờ mang lọ thuốc lên phòng trưng bày cho ông Vinh.'),
    'trinh-luc': ('Trịnh Lực', 'Tài xế nhà họ Lâm',
                  'Lái xe cho ông Vinh bốn năm, ở căn phòng cạnh nhà xe và giữ sổ xe.'),
    'to-khanh': ('Tô Khánh', 'Thợ ảnh, hiệu ảnh số 22',
                 'Chụp bản sao di chúc cho văn phòng công chứng hồi tháng Ba. Thầy dạy nghề ảnh của Bảo.'),
    'dang-buu': ('Đặng Bửu', 'Chủ tiệm cầm đồ',
                 'Chủ nợ của Bảo. Sáng thứ Sáu vừa nhận cầm một chiếc nhẫn ngọc bích.'),
    'hoc-viec': ('Phạm Tùng', 'Học việc Hiệu thuốc Hưng Long',
                 'Ghi sổ giao nhận và dán tem niêm cho mọi hộp thuốc tuần của hiệu.'),
}
NPC_SCENE = {'ly-hanh': 'pho', 'lam-the-bao': 'nha-so-7', 'hoc-viec': 'hieu-thuoc', 'trinh-luc': 'nha-xe',
             'dang-buu': 'cam-do', 'to-khanh': 'hieu-anh'}


def cid(key):
    return f'char-px-{key}'


characters = []
for key, (name, role, desc) in CHARS.items():
    c = RT['characters'][key]
    characters.append({
        'characterId': cid(key), 'name': name, 'role': role, 'imageUrl': c['portrait'], 'description': desc,
        'presentation': {'spriteSheet': {'url': c['sheet'], 'frameWidth': 128, 'frameHeight': 128,
                                         'frameCount': c['frames'], 'fps': 6, 'idleFrames': [],
                                         'anchorX': 0.5, 'anchorY': round(c['ground'] / 128, 4)}},
    })

# ---------------------------------------------------------------- items
# itemId -> (scene, name, description, inspectText, icon, collectible, unlockClueIds, purpose)
ITEMS = {
    'dong-ho': ('pho', 'Đồng hồ quảng trường', 'Đồng hồ cột giữa quảng trường, mặt kính còn đọng sương.',
                'Kim đồng hồ chạy đúng. Bạn có thể dùng mặt đồng hồ để sắp lại các mốc giờ của vụ án.',
                '', False, [], 'operate-mechanism'),
    'lo-thu-nam': ('nha-so-7', 'Lọ thuốc "Thứ Năm"', 'Lọ thuốc nước nhỏ trên bàn nước cạnh ghế bành.',
                   'Lọ rỗng, đáy còn lớp cặn đặc sệt. Các lọ khác trong hộp thuốc tuần trong vắt.',
                   'lo-thu-nam', False, ['evidence-px-lo-thu-nam'], 'legacy-evidence'),
    'kinh-lup': ('nha-so-7', 'Kính lúp của ông Vinh', 'Kính lúp tay cầm gỗ nằm giữa xấp giấy trên bàn làm việc.',
                 'Kính lúp nhà sưu tập dùng để soi tem và đồ cổ. Có thể dùng để soi kỹ một vật.',
                 'kinh-lup', True, [], 'combine-item'),
    'hop-nu-trang': ('nha-so-7', 'Hộp nữ trang', 'Hộp gỗ lót nhung đỏ trên bàn trang điểm, nắp mở toang.',
                     'Mọi thứ còn nguyên, chỉ thiếu chiếc nhẫn ngọc bích ông Vinh hay đeo.',
                     'hop-nu-trang', False, ['evidence-px-hop-nu-trang'], 'legacy-evidence'),
    'tu-kinh': ('nha-so-7', 'Tủ kính khóa số', 'Tủ kính trưng đồ sứ, khóa bằng bốn vòng số bằng đồng.',
                'Khóa bốn vòng số. Bên trong có một cuốn sổ tay bìa da đen.',
                '', False, [], 'operate-mechanism'),
    'so-tay': (None, 'Sổ tay của ông Vinh', 'Cuốn sổ tay bìa da đen lấy từ tủ kính.',
               'Trang cuối: "Thứ Ba — Bảo đến xin vay lần thứ ba. Ta từ chối. Nó ở lại rất lâu trong phòng làm việc."',
               'so-tay', True, [], 'legacy-evidence'),
    'so-giao-nhan': ('hieu-thuoc', 'Sổ giao nhận thuốc', 'Cuốn sổ mở trên quầy Hiệu thuốc Hưng Long.',
                     'Thứ Hai 17:05 — "Lâm Thế Bảo nhận giùm hộp thuốc tuần của ông Vinh." Chữ ký nghiêng hẳn sang trái.',
                     'phieu-nhan-thuoc', False, ['evidence-px-phieu-nhan'], 'legacy-evidence'),
    'khay-tem': ('hieu-thuoc', 'Khay tem niêm và hồ dán', 'Khay tem giấy và bát hồ bột gạo cạnh quầy.',
                 'Tem niêm của hiệu dán bằng hồ bột gạo: khô lại thì đục, cứng, không bao giờ bóng.',
                 'hop-thuoc-tuan', False, ['evidence-px-ho-bot'], 'legacy-evidence'),
    'so-xe': ('nha-xe', 'Sổ xe', 'Sổ ghi lộ trình của Trịnh Lực trên bàn thợ.',
              'Thứ Hai 16:30–18:40: chở ông Vinh đi khám. Thứ Năm 22:10: cất xe vào nhà xe.',
              'so-xe', True, ['evidence-px-so-xe'], 'legacy-evidence'),
    'so-no': ('cam-do', 'Sổ nợ của tiệm', 'Cuốn sổ bìa xanh mở trên quầy cầm đồ.',
              'Dòng ghi: "Lâm Thế Bảo — hạn chót thứ Hai." Khoản nợ đã khất ba lần.',
              'so-no', False, ['evidence-px-so-no'], 'legacy-evidence'),
    'phieu-cam': ('cam-do', 'Phiếu cầm nhẫn ngọc bích', 'Phiếu cầm đồ buộc dây đỏ cạnh cuốn sổ.',
                  '08:10 sáng thứ Sáu. Vật cầm: nhẫn vàng mặt ngọc bích. Người cầm: Trịnh Lực.',
                  'phieu-cam', True, ['evidence-px-phieu-cam'], 'legacy-evidence'),
    'la-thu-trang': ('hieu-anh', 'Lá thư trắng trơn', 'Tờ giấy kẹp trên dây phơi ảnh trong buồng tối.',
                     'Nhìn bằng mắt thường không có chữ, nhưng mặt giấy hơi cứng như từng thấm thuốc.',
                     'la-thu-trang', True, ['clue-px-la-thu-trang'], 'combine-item'),
    'thuoc-hien': ('hieu-anh', 'Lọ thuốc hiện ảnh', 'Lọ thủy tinh nâu có ống nhỏ giọt trên bàn buồng tối.',
                   'Thuốc hiện ảnh của hiệu Tô Khánh. Chạm vào giấy đã thấm thuốc sẽ làm hiện nét.',
                   'thuoc-hien-anh', True, [], 'combine-item'),
    'keo-ep-anh': ('hieu-anh', 'Hũ keo ép ảnh', 'Hũ keo trên kệ bên phải buồng tối.',
                   'Keo ép ảnh: khô lại thì bóng, dẻo và có mùi giấm. Chỉ thợ ảnh mới dùng loại này.',
                   'keo-ep-anh', False, ['evidence-px-keo-ep-anh'], 'legacy-evidence'),
    'thu-hien-chu': (None, 'Lá thư đã hiện chữ', 'Lá thư trắng sau khi nhỏ thuốc hiện ảnh.',
                     '"Thứ Năm, 21 giờ — bến đò Hàn — mang theo phim âm bản." Nét chữ nghiêng hẳn sang trái.',
                     'la-thu-hien-chu', True, [], 'legacy-evidence'),
}
items = []
for key, (scene, name, desc, inspect, icon, coll, unlock, purpose) in ITEMS.items():
    items.append({'itemId': f'item-px-{key}', 'name': name, 'description': desc, 'inspectText': inspect,
                  'imageUrl': ICON.get(icon, '') if icon else '', 'unlockClueIds': unlock,
                  'isCollectible': coll, 'isInteractivePuzzleObject': purpose == 'operate-mechanism',
                  'interactionPurpose': purpose})

# ---------------------------------------------------------------- clues
def clue(cid_, title, content, source, stype, scene, evidence=True, critical=False, red=False, chars=(),
         meaning='', inv='', tags=(), hint=2, visual=None):
    c = {'clueId': cid_, 'title': title, 'content': content, 'isCritical': critical, 'isEvidence': evidence,
         'isRedHerring': red, 'source': source, 'sourceType': stype, 'discoverMethod': stype,
         'sceneId': sid(scene) if scene else '', 'inventoryDescription': inv or content,
         'narrativeMeaning': meaning, 'hintLevel': hint, 'tags': list(tags),
         'relatedCharacterIds': [cid(c) for c in chars]}
    if visual:
        c['visualDescription'] = visual
        c['visualTextPolicy'] = 'NO_TEXT'
    return c


clues = [
    clue('evidence-px-lo-thu-nam', 'Lọ thuốc "Thứ Năm"', 'Chỉ lọ "Thứ Năm" có cặn đặc ở đáy; các lọ khác trong hộp thuốc tuần trong vắt.',
         'item-px-lo-thu-nam', 'item', 'nha-so-7', critical=True, meaning='Thuốc bị pha đặc trong đúng một lọ — không phải hiệu thuốc pha nhầm cả hộp.', tags=['thuoc']),
    clue('evidence-px-tem-niem', 'Tem niêm rạch hai lần', 'Tem giấy qua nắp lọ có một vết xé mới, bên dưới là vết cắt thẳng bằng dao lam đã được dán lại.',
         sid('nha-so-7'), 'camera', 'nha-so-7', critical=True, meaning='Lọ thuốc đã bị mở trước khi tới tay ông Vinh.',
         visual='A tiny glass medicine vial on a round side table, its paper seal strip torn and re-glued', tags=['tem']),
    clue('evidence-px-keo-la', 'Lớp keo lạ dưới tem', 'Dưới kính lúp: lớp keo dán lại tem bóng, dẻo, thoang thoảng mùi giấm — không giống hồ dán của hiệu thuốc.',
         'interaction-px-soi-tem', 'interaction', 'nha-so-7', critical=True, meaning='Người dán lại tem dùng một loại keo không có trong nhà số 7.', tags=['keo']),
    clue('evidence-px-hop-nu-trang', 'Hộp nữ trang bị mở', 'Hộp nữ trang trên bàn trang điểm mở toang; chỉ chiếc nhẫn ngọc bích biến mất.',
         'item-px-hop-nu-trang', 'item', 'nha-so-7', meaning='Có người lấy nhẫn trong đêm — một vụ trộm chồng lên vụ án mạng.', tags=['nhan']),
    clue('evidence-px-di-chuc', 'Di chúc bị sửa', 'Trong ngăn kéo: tờ di chúc và bản sao công chứng tháng Ba. Bản sao ghi người thừa kế Lý Hạnh 30%; tờ di chúc bị tẩy thành "Lâm Thế Bảo — 80%, kể cả căn nhà số 7", mực khác màu.',
         'interaction-px-ngan-keo', 'interaction', 'nha-so-7', critical=True, chars=['lam-the-bao'],
         meaning='Ai đó sửa di chúc có lợi cho Bảo sau khi công chứng.', tags=['di-chuc']),
    clue('evidence-px-so-tay', 'Sổ tay trong tủ kính', 'Trang cuối sổ tay ông Vinh: "Thứ Ba — Bảo đến xin vay lần thứ ba. Ta từ chối. Nó ở lại rất lâu trong phòng làm việc."',
         'puzzle-px-tu-kinh', 'puzzle', 'nha-so-7', chars=['lam-the-bao'], meaning='Bảo có lúc một mình trong phòng làm việc — nơi cất di chúc.', tags=['di-chuc']),
    clue('clue-px-ma-tu-kinh', 'Mã tủ kính', 'Bà Hạnh: ông chủ hay đùa rằng mã tủ kính chính là giờ ông uống thuốc mỗi tối.',
         'dlg-px-hanh-tu-kinh', 'dialogue', 'pho', evidence=False, chars=['ly-hanh'], meaning='Giờ uống thuốc: 21:00.', tags=['ma']),
    clue('evidence-px-phieu-nhan', 'Phiếu nhận thuốc hộ', 'Sổ giao nhận Hiệu thuốc Hưng Long, thứ Hai 17:05: "Lâm Thế Bảo nhận giùm hộp thuốc tuần của ông Vinh." Chữ ký nghiêng hẳn sang trái.',
         'item-px-so-giao-nhan', 'item', 'hieu-thuoc', critical=True, chars=['lam-the-bao'],
         meaning='Bảo cầm hộp thuốc từ 17:05.', tags=['thoi-gian']),
    clue('evidence-px-ho-bot', 'Hồ dán của hiệu thuốc', 'Tem niêm của Hưng Long dán bằng hồ bột gạo: khô lại thì đục, cứng, không bao giờ bóng.',
         'item-px-khay-tem', 'item', 'hieu-thuoc', meaning='Lớp keo bóng dưới tem lọ "Thứ Năm" không phải của hiệu thuốc.', tags=['keo']),
    clue('testimony-px-tung', 'Lời cậu Tùng', 'Cậu Tùng: "Chiều thứ Hai cậu Bảo nhận giùm lúc năm giờ năm phút, ký bằng tay trái."',
         'dlg-px-tung-nhan-thuoc', 'dialogue', 'hieu-thuoc', evidence=False, chars=['hoc-viec', 'lam-the-bao']),
    clue('evidence-px-so-xe', 'Sổ xe của Trịnh Lực', 'Thứ Hai 16:30–18:40: chở ông Vinh đi khám. Thứ Năm 22:10: cất xe vào nhà xe.',
         'item-px-so-xe', 'item', 'nha-xe', chars=['trinh-luc'], meaning='Lực không thể chạm vào hộp thuốc chiều thứ Hai.', tags=['thoi-gian']),
    clue('evidence-px-chia-cua-sau', 'Chìa khóa cửa sau', 'Trong rương của Lực: quần áo, xấp vé xe và một chìa khóa cửa sau nhà số 7.',
         'interaction-px-ruong', 'interaction', 'nha-xe', chars=['trinh-luc'], red=True,
         meaning='Lực vào được nhà số 7 ban đêm — nhưng có chìa khóa chưa chứng minh anh đã vào.', tags=['nhan']),
    clue('evidence-px-so-no', 'Sổ nợ của tiệm cầm đồ', 'Dòng ghi: "Lâm Thế Bảo — hạn chót thứ Hai." Khoản nợ đã khất ba lần.',
         'item-px-so-no', 'item', 'cam-do', chars=['lam-the-bao', 'dang-buu'], meaning='Bảo cần tiền gấp trước thứ Hai tới.', tags=['no']),
    clue('evidence-px-phieu-cam', 'Phiếu cầm nhẫn ngọc bích', '08:10 sáng thứ Sáu, Trịnh Lực mang nhẫn vàng mặt ngọc bích tới cầm.',
         'item-px-phieu-cam', 'item', 'cam-do', critical=True, chars=['trinh-luc'], meaning='Chiếc nhẫn mất ở nhà số 7 qua tay Lực.', tags=['nhan']),
    clue('evidence-px-nhan-trong-tu', 'Nhẫn ngọc bích trong tủ kính', 'Chiếc nhẫn ngọc bích của ông Vinh đang nằm trong tủ kính tiệm cầm đồ.',
         sid('cam-do'), 'camera', 'cam-do', meaning='Nhẫn đã được cầm — người cầm ghi trong phiếu.',
         visual='A small gold ring with a green jade stone inside a glass display case among pocket watches', tags=['nhan']),
    clue('clue-px-la-thu-trang', 'Lá thư trắng trơn', 'Tờ giấy kẹp trên dây phơi trong buồng tối; mặt giấy hơi cứng như từng thấm thuốc.',
         'item-px-la-thu-trang', 'item', 'hieu-anh', evidence=False),
    clue('evidence-px-keo-ep-anh', 'Keo ép ảnh của hiệu Tô Khánh', 'Keo ép ảnh khô lại bóng, dẻo, có mùi giấm — giống hệt lớp keo dưới tem lọ "Thứ Năm".',
         'item-px-keo-ep-anh', 'item', 'hieu-anh', critical=True, chars=['to-khanh'], meaning='Tem niêm được dán lại bằng keo của hiệu ảnh.', tags=['keo']),
    clue('evidence-px-thu-hen', 'Lá thư mực ẩn', '"Thứ Năm, 21 giờ — bến đò Hàn — mang theo phim âm bản." Nét chữ nghiêng sang trái — người viết thuận tay trái.',
         'interaction-px-hien-thu', 'interaction', 'hieu-anh', critical=True, chars=['lam-the-bao', 'to-khanh'],
         meaning='Bảo tự hẹn 21:00 ở bến đò để có người làm chứng.', tags=['ngoai-pham']),
    clue('testimony-px-buong-toi', 'Bảo mượn buồng tối', 'Ông Khánh: chiều thứ Hai khoảng 17:15, Bảo mượn buồng tối gần nửa tiếng, tay cầm một hộp giấy nhỏ.',
         'dlg-px-khanh-buong-toi', 'dialogue', 'hieu-anh', evidence=False, chars=['to-khanh', 'lam-the-bao']),
    clue('testimony-px-luc-22h15', 'Lực vào phòng lúc 22:15', 'Lực: "22:15 tôi vào lấy nhẫn. Ông chủ ngồi bất động trên ghế bành, tôi tưởng ông ngủ."',
         'dlg-px-luc-thu-nhan', 'dialogue', 'nha-xe', evidence=False, chars=['trinh-luc']),
    clue('reveal-px-mot-gio', 'MỘT GIỜ KHÔNG AI THẤY HỘP THUỐC', 'Bảo nhận hộp thuốc lúc 17:05 nhưng 18:10 mới giao cho bà Hạnh — quãng đường chỉ năm phút.',
         'dlg-px-bao-thu-hai', 'dialogue', 'nha-so-7', evidence=False, critical=True, chars=['lam-the-bao']),
    clue('reveal-px-ke-trom-nhan', 'KẺ TRỘM NHẪN', 'Lực đã lấy chiếc nhẫn ngọc bích ở phòng trưng bày rồi mang cầm sáng thứ Sáu.',
         'dlg-px-luc-dem-thu-nam', 'dialogue', 'nha-xe', evidence=False, critical=True, chars=['trinh-luc']),
    clue('fact-px-luc-loai-tru', 'Lực là kẻ trộm, không phải hung thủ', 'Thứ Hai Lực đang chở ông Vinh; tối thứ Năm anh vào phòng lúc 22:15 khi ông đã bất động.',
         'deduction-px-luc', 'deduction', None, evidence=False),
    clue('fact-px-thuoc-bi-pha-thu-hai', 'Thuốc bị pha từ chiều thứ Hai', 'Tem lọ "Thứ Năm" dán lại bằng keo ép ảnh — thứ mà người từng học nghề ảnh là Bảo dùng thành thạo, trong một giờ không ai thấy hộp thuốc.',
         'deduction-px-keo', 'deduction', None, evidence=False),
    clue('fact-px-ngoai-pham', 'NGOẠI PHẠM DỰNG SẴN', 'Thuốc đã bị pha từ chiều thứ Hai; việc Bảo có mặt ở bến đò lúc 21:00 thứ Năm không chứng minh được gì.',
         'puzzle-px-hanh-trinh', 'puzzle', None, evidence=False),
]

# ---------------------------------------------------------------- dialogues and conversation
dialogues = [
    {'dialogueId': 'dlg-px-hanh-sang-nay', 'characterId': cid('ly-hanh'),
     'question': 'Bà phát hiện ông Vinh lúc nào?',
     'answer': 'Sáu giờ bốn mươi sáng nay. Ông ngồi bất động trên ghế bành, lọ thuốc "Thứ Năm" rỗng trên bàn nước. Cửa nhà số 7 tôi mở sẵn rồi, các ông cứ vào.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-hanh-thuoc', 'characterId': cid('ly-hanh'),
     'question': 'Hộp thuốc tuần này đến tay bà thế nào?',
     'answer': 'Thứ Hai cậu Bảo mang hộp thuốc tới lúc sáu giờ mười, đúng lúc tôi dọn cơm. Tối thứ Năm, chín giờ, tôi mang lọ "Thứ Năm" lên, ông uống trước mặt tôi.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-hanh-tu-kinh', 'characterId': cid('ly-hanh'),
     'question': 'Tủ kính trong phòng trưng bày khóa bằng gì?',
     'answer': 'Bốn vòng số. Ông chủ hay đùa: mã tủ kính chính là giờ ông uống thuốc mỗi tối.',
     'requiredClueIds': [], 'unlockClueIds': ['clue-px-ma-tu-kinh']},
    {'dialogueId': 'dlg-px-bao-thu-hai', 'characterId': cid('lam-the-bao'),
     'question': 'Chiều thứ Hai anh làm gì?',
     'answer': 'Chiều thứ Hai tôi đi nhận thuốc giùm chú. Tôi lấy hộp thuốc ở hiệu Hưng Long lúc gần sáu giờ. Rồi tôi mang thẳng tới nhà số 7, chưa tới mười phút. Cả buổi tôi không ghé đâu khác.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-bao-thu-nam', 'characterId': cid('lam-the-bao'),
     'question': 'Tối thứ Năm anh ở đâu?',
     'answer': 'Ở bến đò Hàn từ trước chín giờ, cách đây gần hai cây số. Ông Khánh thợ ảnh làm chứng cho tôi.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-tung-nhan-thuoc', 'characterId': cid('hoc-viec'),
     'question': 'Ai đã nhận hộp thuốc tuần của ông Vinh?',
     'answer': 'Chiều thứ Hai cậu Bảo tới nhận giùm, lúc năm giờ năm phút. Cậu ký bằng tay trái, tôi nhớ vì cậu phải xoay cả cuốn sổ.',
     'requiredClueIds': [], 'unlockClueIds': ['testimony-px-tung']},
    {'dialogueId': 'dlg-px-tung-tem', 'characterId': cid('hoc-viec'),
     'question': 'Tem niêm của hiệu dán bằng gì?',
     'answer': 'Bằng hồ bột gạo, chính tay tôi dán. Hồ khô thì đục và cứng, chẳng bao giờ bóng.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-luc-dem-thu-nam', 'characterId': cid('trinh-luc'),
     'question': 'Tối thứ Năm anh ở đâu?',
     'answer': 'Tối thứ Năm tôi cất xe lúc mười giờ mười rồi về phòng ngủ luôn. Tôi chưa từng bước vào phòng trưng bày của ông chủ. Chiếc nhẫn ngọc bích thì tôi chưa thấy bao giờ.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-luc-thu-hai', 'characterId': cid('trinh-luc'),
     'question': 'Chiều thứ Hai anh làm gì?',
     'answer': 'Bốn rưỡi tôi chở ông chủ đi khám tim, gần bảy giờ mới về. Sổ xe ghi cả đấy.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-luc-thu-nhan', 'characterId': cid('trinh-luc'),
     'question': 'Chiếc nhẫn ngọc bích ở tiệm cầm đồ là sao?',
     'answer': 'Tôi khai thật. Mười giờ mười lăm tôi lên lấy chiếc nhẫn. Ông chủ ngồi bất động trên ghế bành, tôi tưởng ông ngủ nên lấy xong là đi ngay.',
     'requiredClueIds': ['reveal-px-ke-trom-nhan'], 'unlockClueIds': ['testimony-px-luc-22h15']},
    {'dialogueId': 'dlg-px-buu-no', 'characterId': cid('dang-buu'),
     'question': 'Lâm Thế Bảo nợ ông bao nhiêu?',
     'answer': 'Một khoản lớn, đã khất ba lần. Hạn chót là sáng thứ Hai tới; quá hạn tôi cho người tới tận nhà số 7.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-buu-nhan', 'characterId': cid('dang-buu'),
     'question': 'Ai mang chiếc nhẫn ngọc bích tới?',
     'answer': 'Trịnh Lực, tám giờ mười sáng thứ Sáu. Tay anh ta run, cứ nhìn ra cửa suốt.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-khanh-ben-do', 'characterId': cid('to-khanh'),
     'question': 'Tối thứ Năm ông gặp Lâm Thế Bảo ở đâu?',
     'answer': 'Ở bến đò Hàn. Cậu ấy tới lúc chín giờ kém năm, cứ hỏi giờ và dặn tôi nhớ là cậu có mặt ở đó đúng chín giờ.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-khanh-nghe', 'characterId': cid('to-khanh'),
     'question': 'Ai biết dùng thuốc hiện ảnh và keo ép ảnh của tiệm ông?',
     'answer': 'Người trong nghề. Bảo học việc ở đây ba năm, cậu ấy pha thuốc hiện và dùng keo ép ảnh còn khéo hơn tôi.',
     'requiredClueIds': [], 'unlockClueIds': []},
    {'dialogueId': 'dlg-px-khanh-buong-toi', 'characterId': cid('to-khanh'),
     'question': 'Chiều thứ Hai Bảo có ghé tiệm ông không?',
     'answer': 'Có. Khoảng năm giờ mười lăm cậu ấy mượn buồng tối gần nửa tiếng, tay cầm một hộp giấy nhỏ. Tôi cứ tưởng cậu tráng phim.',
     'requiredClueIds': ['reveal-px-mot-gio'], 'unlockClueIds': ['testimony-px-buong-toi']},
]
for d in dialogues:
    d['statementIds'] = []
    d['availableSceneIds'] = []

testimony = [
    {'id': 'frag-px-bao-gan-sau-gio', 'dialogueId': 'dlg-px-bao-thu-hai', 'text': 'Tôi lấy hộp thuốc ở hiệu Hưng Long lúc gần sáu giờ.'},
    {'id': 'frag-px-bao-mang-thang', 'dialogueId': 'dlg-px-bao-thu-hai', 'text': 'Rồi tôi mang thẳng tới nhà số 7, chưa tới mười phút.'},
    {'id': 'frag-px-bao-khong-ghe', 'dialogueId': 'dlg-px-bao-thu-hai', 'text': 'Cả buổi tôi không ghé đâu khác.'},
    {'id': 'frag-px-luc-ngu-luon', 'dialogueId': 'dlg-px-luc-dem-thu-nam', 'text': 'Tối thứ Năm tôi cất xe lúc mười giờ mười rồi về phòng ngủ luôn.'},
    {'id': 'frag-px-luc-chua-vao', 'dialogueId': 'dlg-px-luc-dem-thu-nam', 'text': 'Tôi chưa từng bước vào phòng trưng bày của ông chủ.'},
    {'id': 'frag-px-luc-chua-thay-nhan', 'dialogueId': 'dlg-px-luc-dem-thu-nam', 'text': 'Chiếc nhẫn ngọc bích thì tôi chưa thấy bao giờ.'},
]


def node(nid, char, root, lines, choices, source=None, required=(), unlock=(), challenge=None):
    src = next((d for d in dialogues if d['dialogueId'] == source), None) if source else None
    return {'nodeId': nid, 'characterId': cid(char), 'sourceDialogueId': source, 'isRoot': root,
            'requiredClueIds': list(src['requiredClueIds']) if src else list(required),
            'lines': lines, 'unlockClueIds': list(src['unlockClueIds']) if src else list(unlock),
            'challengeId': challenge, 'choices': choices, 'statementIds': [], 'availableSceneIds': []}


def choice(cid_, label, nxt, required=()):
    return {'choiceId': cid_, 'label': label, 'requiredClueIds': list(required), 'nextNodeId': nxt}


def back(char):
    return [choice(f'choice-px-{char}-back-' + str(len(conversation)), 'Quay lại.', None)]


conversation = []
conversation.append(node('node-px-bao-root', 'lam-the-bao', True,
    [{'speaker': 'NPC', 'text': 'Chú tôi mất rồi. Các anh còn muốn hỏi gì nữa?'}],
    [choice('choice-px-bao-thu-hai', 'Chiều thứ Hai anh làm gì?', 'node-px-bao-thu-hai'),
     choice('choice-px-bao-thu-nam', 'Tối thứ Năm anh ở đâu?', 'node-px-bao-thu-nam'),
     choice('choice-px-bao-mot-gio', 'Một giờ đồng hồ với hộp thuốc, anh ở đâu?', 'node-px-bao-mot-gio', ['reveal-px-mot-gio'])]))
conversation.append(node('node-px-bao-thu-hai', 'lam-the-bao', False,
    [{'speaker': 'DETECTIVE', 'text': 'Chiều thứ Hai anh làm gì?'},
     {'speaker': 'NPC', 'text': dialogues[3]['answer']}], back('bao'), source='dlg-px-bao-thu-hai',
    challenge='challenge-px-gio-nhan-thuoc'))
conversation.append(node('node-px-bao-thu-nam', 'lam-the-bao', False,
    [{'speaker': 'DETECTIVE', 'text': 'Tối thứ Năm anh ở đâu?'},
     {'speaker': 'NPC', 'text': dialogues[4]['answer']}], back('bao'), source='dlg-px-bao-thu-nam'))
conversation.append(node('node-px-bao-mot-gio', 'lam-the-bao', False,
    [{'speaker': 'DETECTIVE', 'text': 'Anh nhận thuốc lúc năm giờ năm phút, sáu giờ mười mới tới nhà. Một giờ đó anh ở đâu?'},
     {'speaker': 'NPC', 'text': 'Tôi… ghé chỗ thầy Khánh một lát. Chuyện riêng, không liên quan gì tới chú tôi.'}],
    back('bao'), required=['reveal-px-mot-gio']))
conversation.append(node('node-px-luc-root', 'trinh-luc', True,
    [{'speaker': 'NPC', 'text': 'Tôi lái xe cho ông chủ bốn năm nay. Các anh cần hỏi gì?'}],
    [choice('choice-px-luc-dem', 'Tối thứ Năm anh ở đâu?', 'node-px-luc-dem-thu-nam'),
     choice('choice-px-luc-thu-hai', 'Chiều thứ Hai anh làm gì?', 'node-px-luc-thu-hai'),
     choice('choice-px-luc-nhan', 'Chiếc nhẫn ngọc bích ở tiệm cầm đồ là sao?', 'node-px-luc-thu-nhan', ['reveal-px-ke-trom-nhan'])]))
conversation.append(node('node-px-luc-dem-thu-nam', 'trinh-luc', False,
    [{'speaker': 'DETECTIVE', 'text': 'Tối thứ Năm anh ở đâu?'},
     {'speaker': 'NPC', 'text': dialogues[7]['answer']}], back('luc'), source='dlg-px-luc-dem-thu-nam',
    challenge='challenge-px-ke-trom-nhan'))
conversation.append(node('node-px-luc-thu-hai', 'trinh-luc', False,
    [{'speaker': 'DETECTIVE', 'text': 'Chiều thứ Hai anh làm gì?'},
     {'speaker': 'NPC', 'text': dialogues[8]['answer']}], back('luc'), source='dlg-px-luc-thu-hai'))
conversation.append(node('node-px-luc-thu-nhan', 'trinh-luc', False,
    [{'speaker': 'DETECTIVE', 'text': 'Chiếc nhẫn ngọc bích ở tiệm cầm đồ là sao?'},
     {'speaker': 'NPC', 'text': dialogues[9]['answer']}], back('luc'), source='dlg-px-luc-thu-nhan'))

challenges = [
    {'challengeId': 'challenge-px-gio-nhan-thuoc', 'order': 1, 'isSignature': True,
     'dialogueId': 'dlg-px-bao-thu-hai', 'testimonyFragmentId': 'frag-px-bao-gan-sau-gio',
     'candidateTestimonyFragmentIds': ['frag-px-bao-gan-sau-gio', 'frag-px-bao-mang-thang', 'frag-px-bao-khong-ghe'],
     'startRequiredTestimonyFragmentIds': ['frag-px-bao-gan-sau-gio', 'frag-px-bao-mang-thang'],
     'prompt': 'Bảo nói anh nhận thuốc lúc gần sáu giờ rồi mang thẳng tới nhà. Bằng chứng nào cho thấy giờ nhận thuốc khác hẳn?',
     'correctEvidenceId': 'evidence-px-phieu-nhan',
     'candidateEvidenceIds': ['evidence-px-phieu-nhan', 'evidence-px-tem-niem', 'evidence-px-ho-bot', 'evidence-px-lo-thu-nam'],
     'startRequiredEvidenceIds': ['evidence-px-phieu-nhan', 'evidence-px-lo-thu-nam'],
     'successResponse': 'Bảo im lặng một lúc lâu. "Được rồi… tôi nhận thuốc lúc năm giờ năm phút. Nhưng tôi chỉ đi lòng vòng thôi."',
     'failureResponse': 'Bảo nhún vai: "Cái đó thì liên quan gì tới giờ tôi nhận thuốc?"',
     'revealTitle': 'PHÁ ÁN: MỘT GIỜ KHÔNG AI THẤY HỘP THUỐC',
     'unlockClueIds': ['reveal-px-mot-gio']},
    {'challengeId': 'challenge-px-ke-trom-nhan', 'order': 2, 'isSignature': False,
     'dialogueId': 'dlg-px-luc-dem-thu-nam', 'testimonyFragmentId': 'frag-px-luc-chua-thay-nhan',
     'candidateTestimonyFragmentIds': ['frag-px-luc-ngu-luon', 'frag-px-luc-chua-vao', 'frag-px-luc-chua-thay-nhan'],
     'startRequiredTestimonyFragmentIds': ['frag-px-luc-chua-thay-nhan', 'frag-px-luc-chua-vao'],
     'prompt': 'Lực khẳng định chưa từng thấy chiếc nhẫn ngọc bích. Vật chứng nào cho thấy anh ta nói dối?',
     'correctEvidenceId': 'evidence-px-phieu-cam',
     'candidateEvidenceIds': ['evidence-px-phieu-cam', 'evidence-px-so-xe', 'evidence-px-chia-cua-sau', 'evidence-px-nhan-trong-tu'],
     'startRequiredEvidenceIds': ['evidence-px-phieu-cam', 'evidence-px-so-xe'],
     'successResponse': 'Lực cúi gằm mặt. "Tôi lấy nó… nhưng tôi không giết ông chủ. Khi tôi vào, ông đã ngồi bất động rồi."',
     'failureResponse': 'Lực khoanh tay: "Cái đó chẳng nói lên điều gì về tôi cả."',
     'revealTitle': 'PHÁ ÁN: KẺ TRỘM NHẪN',
     'unlockClueIds': ['reveal-px-ke-trom-nhan']},
]

deductions = [
    {'deductionId': 'deduction-px-luc', 'prompt': 'Lực là kẻ trộm nhẫn. Anh ta có phải người đã pha thuốc?',
     'requiredClueIds': ['reveal-px-ke-trom-nhan', 'evidence-px-so-xe', 'testimony-px-luc-22h15'],
     'requiredChallengeIds': ['challenge-px-ke-trom-nhan'],
     'options': [{'id': 'deduction-px-luc-a', 'label': 'Không. Chiều thứ Hai Lực đang chở ông Vinh, còn tối thứ Năm anh vào phòng lúc 22:15 khi lọ thuốc đã được uống từ 21:00.'},
                 {'id': 'deduction-px-luc-b', 'label': 'Có. Lực đổi lọ thuốc khi vào lấy nhẫn lúc 22:15.'},
                 {'id': 'deduction-px-luc-c', 'label': 'Có. Lực pha thuốc trong nhà xe rồi nhờ bà Hạnh mang lên.'}],
     'correctOptionId': 'deduction-px-luc-a',
     'successResponse': 'Lực là kẻ trộm, nhưng lọ thuốc đã nằm trong bụng ông Vinh trước khi anh ta bước vào.',
     'failureResponse': 'Hãy đối chiếu giờ Lực vào phòng với giờ ông Vinh uống thuốc, và nơi Lực ở chiều thứ Hai.',
     'unlockClueIds': ['fact-px-luc-loai-tru']},
    {'deductionId': 'deduction-px-keo', 'prompt': 'Lớp keo bóng dưới tem lọ "Thứ Năm" từ đâu ra, và ai đủ ngón nghề dùng nó?',
     'requiredClueIds': ['evidence-px-keo-la', 'evidence-px-keo-ep-anh', 'reveal-px-mot-gio'],
     'requiredChallengeIds': ['challenge-px-gio-nhan-thuoc'],
     'options': [{'id': 'deduction-px-keo-a', 'label': 'Keo ép ảnh của hiệu Tô Khánh — Bảo từng học nghề ở đó và giữ hộp thuốc suốt một giờ không ai thấy.'},
                 {'id': 'deduction-px-keo-b', 'label': 'Hồ bột gạo của Hiệu thuốc Hưng Long — hiệu thuốc dán nhầm tem.'},
                 {'id': 'deduction-px-keo-c', 'label': 'Keo dán sách trong phòng làm việc — bà Hạnh dán lại tem trước khi mang lên.'}],
     'correctOptionId': 'deduction-px-keo-a',
     'successResponse': 'Tem niêm bị rạch và dán lại bằng keo ép ảnh trong chiều thứ Hai — khi hộp thuốc còn trong tay Bảo.',
     'failureResponse': 'So lớp keo dưới kính lúp với hồ dán của hiệu thuốc và hũ keo trong buồng tối.',
     'unlockClueIds': ['fact-px-thuoc-bi-pha-thu-hai']},
]

chains = [
    {'chainId': 'chain-px-gio-nhan-thuoc', 'investigatorClueId': 'evidence-px-phieu-nhan',
     'interrogatorChallengeId': 'challenge-px-gio-nhan-thuoc', 'deductionId': 'deduction-px-keo',
     'description': 'Điều tra viên tìm sổ giao nhận, Thẩm vấn viên bắt Bảo nói dối giờ nhận thuốc, cả hai lần ra nguồn keo.'},
    {'chainId': 'chain-px-ke-trom-nhan', 'investigatorClueId': 'evidence-px-phieu-cam',
     'interrogatorChallengeId': 'challenge-px-ke-trom-nhan', 'deductionId': 'deduction-px-luc',
     'description': 'Phiếu cầm đồ phá lời Lực, rồi cả hai loại Lực khỏi vụ án mạng.'},
]

interactions = [
    {'interactionId': 'interaction-px-soi-tem', 'type': 'USE_ITEM_ON_TARGET', 'targetId': 'item-px-lo-thu-nam',
     'requiredItemIds': ['item-px-kinh-lup'], 'requiredClueIds': [], 'unlockItemIds': [],
     'unlockClueIds': ['evidence-px-keo-la'], 'unlockSceneIds': [], 'consumeItemIds': [],
     'successMessage': 'Dưới kính lúp, lớp keo dán lại tem bóng lên và dẻo, có mùi giấm — không phải hồ bột.',
     'failureMessage': 'Cần một thứ phóng to được mép tem.', 'singleUse': True},
    {'interactionId': 'interaction-px-hien-thu', 'type': 'COMBINE_ITEMS', 'targetId': '',
     'requiredItemIds': ['item-px-la-thu-trang', 'item-px-thuoc-hien'], 'requiredClueIds': ['clue-px-la-thu-trang'],
     'unlockItemIds': ['item-px-thu-hien-chu'], 'unlockClueIds': ['evidence-px-thu-hen'], 'unlockSceneIds': [],
     'consumeItemIds': ['item-px-la-thu-trang', 'item-px-thuoc-hien'],
     'successMessage': 'Nét chữ nâu từ từ hiện lên: "Thứ Năm, 21 giờ — bến đò Hàn — mang theo phim âm bản."',
     'failureMessage': 'Hai thứ này không phản ứng với nhau.', 'singleUse': True},
    {'interactionId': 'interaction-px-ngan-keo', 'type': 'INSPECT_ENVIRONMENT', 'targetId': 'interaction-px-ngan-keo',
     'requiredItemIds': [], 'requiredClueIds': [], 'unlockItemIds': [], 'unlockClueIds': ['evidence-px-di-chuc'],
     'unlockSceneIds': [], 'consumeItemIds': [],
     'successMessage': 'Dưới xấp hóa đơn là tờ di chúc gấp đôi và bản sao công chứng tháng Ba.',
     'failureMessage': 'Ngăn kéo kẹt.', 'singleUse': True},
    {'interactionId': 'interaction-px-ruong', 'type': 'INSPECT_ENVIRONMENT', 'targetId': 'interaction-px-ruong',
     'requiredItemIds': [], 'requiredClueIds': [], 'unlockItemIds': [], 'unlockClueIds': ['evidence-px-chia-cua-sau'],
     'unlockSceneIds': [], 'consumeItemIds': [],
     'successMessage': 'Trong rương có quần áo, xấp vé xe và một chìa khóa cửa sau nhà số 7.',
     'failureMessage': 'Rương khóa.', 'singleUse': True},
]

puzzles = [
    {'puzzleId': 'puzzle-px-tu-kinh', 'type': 'CODE_PUZZLE', 'targetId': 'item-px-tu-kinh',
     'prompt': 'Tủ kính khóa bằng bốn vòng số. Bà Hạnh nói mã tủ là giờ ông Vinh uống thuốc mỗi tối.',
     'options': [], 'correctCode': '2100', 'correctSequence': [], 'requiredItemIds': [],
     'requiredClueIds': ['clue-px-ma-tu-kinh'], 'unlockItemIds': ['item-px-so-tay'],
     'unlockClueIds': ['evidence-px-so-tay'], 'unlockSceneIds': [],
     'successMessage': 'Bốn vòng số khớp 2-1-0-0. Cửa tủ bật mở, bên trong là cuốn sổ tay bìa da đen.',
     'failureMessage': 'Khóa không nhúc nhích. Ông Vinh uống thuốc lúc mấy giờ?',
     'basedOnTruthIds': [], 'investigationPurpose': 'Mở tủ kính để đọc sổ tay ông Vinh.', 'revealsConclusionIds': [],
     'progressionRole': 'REQUIRED'},
    {'puzzleId': 'puzzle-px-hanh-trinh', 'type': 'SEQUENCE_PUZZLE', 'targetId': 'item-px-dong-ho',
     'prompt': 'Dựa vào đồng hồ quảng trường, xếp lại hành trình của hộp thuốc tuần từ hiệu thuốc tới tay ông Vinh.',
     'options': ['Bà Hạnh nhận hộp thuốc 18:10', 'Bảo ký nhận ở Hưng Long 17:05', 'Ông Vinh uống lọ Thứ Năm lúc 21:00',
                 'Bảo mượn buồng tối hiệu ảnh'],
     'correctCode': '',
     'correctSequence': ['Bảo ký nhận ở Hưng Long 17:05', 'Bảo mượn buồng tối hiệu ảnh', 'Bà Hạnh nhận hộp thuốc 18:10',
                         'Ông Vinh uống lọ Thứ Năm lúc 21:00'],
     'requiredItemIds': [], 'requiredClueIds': ['evidence-px-phieu-nhan', 'testimony-px-buong-toi', 'evidence-px-thu-hen'],
     'unlockItemIds': [], 'unlockClueIds': ['fact-px-ngoai-pham'], 'unlockSceneIds': [],
     'successMessage': 'Các mốc giờ khớp nhau: thuốc đã bị pha từ chiều thứ Hai. Lời ngoại phạm 21:00 ở bến đò là dựng sẵn.',
     'failureMessage': 'Thứ tự này mâu thuẫn với sổ giao nhận hoặc lời ông Khánh.',
     'basedOnTruthIds': [], 'investigationPurpose': 'Dựng lại tuần cuối của hộp thuốc.', 'revealsConclusionIds': [],
     'progressionRole': 'REQUIRED'},
]

hints = [
    ('SCENE', sid('pho'), 'Thẩm vấn viên hỏi bà Hạnh ở cổng nhà số 7. Đồng hồ quảng trường dùng sau, khi đã có đủ các mốc giờ.'),
    ('SCENE', sid('nha-so-7'), 'Soi lọ thuốc bằng máy ảnh và kính lúp, mở ngăn kéo bàn làm việc. Mã tủ kính nằm trong lời bà Hạnh.'),
    ('SCENE', sid('hieu-thuoc'), 'Đọc sổ giao nhận trên quầy và xem khay tem niêm. Cậu Tùng nhớ rõ người nhận thuốc.'),
    ('SCENE', sid('nha-xe'), 'Sổ xe nằm trên bàn thợ. Hỏi Lực về tối thứ Năm.'),
    ('SCENE', sid('cam-do'), 'Sổ nợ và phiếu cầm nằm trên quầy; chụp chiếc nhẫn trong tủ kính.'),
    ('SCENE', sid('hieu-anh'), 'Ghép lá thư trắng với thuốc hiện ảnh trong túi đồ. Hũ keo trên kệ đáng soi kỹ.'),
    ('CONFRONTATION', 'challenge-px-gio-nhan-thuoc', 'So giờ Bảo khai với giờ ghi trong sổ giao nhận của hiệu thuốc.'),
    ('CONFRONTATION', 'challenge-px-ke-trom-nhan', 'Ai đứng tên trên phiếu cầm chiếc nhẫn?'),
    ('DEDUCTION', 'deduction-px-luc', 'Lực vào phòng lúc mấy giờ, còn ông Vinh uống thuốc lúc mấy giờ?'),
    ('DEDUCTION', 'deduction-px-keo', 'Keo bóng, dẻo, mùi giấm — loại đó có ở đâu?'),
]
hints = [{'hintId': f'hint-px-{i + 1}', 'contextType': t, 'targetId': tgt, 'order': 1, 'text': txt}
         for i, (t, tgt, txt) in enumerate(hints)]

final_logic = {
    'culpritId': cid('lam-the-bao'),
    'motive': 'Bảo nợ tiệm cầm đồ Đặng Bửu, hạn chót thứ Hai; anh đã sửa di chúc để hưởng 80% và căn nhà số 7.',
    'method': 'Chiều thứ Hai Bảo giữ hộp thuốc tuần hơn một giờ, mượn buồng tối hiệu ảnh, rạch tem lọ "Thứ Năm", pha đặc thuốc rồi dán lại bằng keo ép ảnh.',
    'requiredEvidenceIds': [],
    'motiveOptions': [{'id': 'motive-px-di-chuc', 'label': 'Trả món nợ hạn chót thứ Hai bằng phần thừa kế trong tờ di chúc đã bị sửa'},
                      {'id': 'motive-px-tra-thu', 'label': 'Trả thù vì ông Vinh từ chối cho vay lần thứ ba'},
                      {'id': 'motive-px-che-trom', 'label': 'Che giấu việc chiếc nhẫn ngọc bích bị lấy trộm'}],
    'methodOptions': [{'id': 'method-px-keo-ep-anh', 'label': 'Rạch tem lọ "Thứ Năm", pha đặc thuốc trong buồng tối hiệu ảnh rồi dán lại bằng keo ép ảnh từ chiều thứ Hai'},
                      {'id': 'method-px-doi-lo', 'label': 'Đổi lọ thuốc khi bà Hạnh mang lên lúc 21:00 thứ Năm'},
                      {'id': 'method-px-22h15', 'label': 'Lẻn vào phòng trưng bày lúc 22:15 khi ông Vinh đã ngủ'}],
    'correctMotiveId': 'motive-px-di-chuc', 'correctMethodId': 'method-px-keo-ep-anh',
    'requiredEvidenceLinks': [{'claimType': 'MOTIVE', 'evidenceId': 'evidence-px-di-chuc'},
                              {'claimType': 'METHOD', 'evidenceId': 'evidence-px-keo-la'},
                              {'claimType': 'OPPORTUNITY', 'evidenceId': 'evidence-px-phieu-nhan'}],
    'requiredDeductionIds': ['deduction-px-luc', 'deduction-px-keo'],
    'requiredTeamworkChainIds': ['chain-px-gio-nhan-thuoc', 'chain-px-ke-trom-nhan'],
    'winEnding': 'Phiếu nhận thuốc 17:05, lớp keo ép ảnh dưới tem và tờ di chúc bị sửa khép lại vụ án: Lâm Thế Bảo đã pha đặc lọ thuốc "Thứ Năm" từ chiều thứ Hai rồi tự dựng lời ngoại phạm ở bến đò Hàn. Trịnh Lực vẫn phải trả lại chiếc nhẫn.',
    'failEnding': 'Cáo buộc chưa nối được hộp thuốc, lớp keo và tờ di chúc. Hãy xem lại các mốc giờ của chiều thứ Hai.',
}

# ---------------------------------------------------------------- scenes
SCENES = [
    ('pho', 'Phố Hàng Đường', 'Quảng trường đồng hồ trước nhà số 7, sáng thứ Sáu.', ['ly-hanh'], ['dong-ho'], [],
     {'logic': 'AND', 'requiredItemIds': [], 'requiredClueIds': [], 'requiredDialogueIds': ['dlg-px-hanh-sang-nay']},
     None),
    ('nha-so-7', 'Nhà số 7 — phòng trưng bày', 'Phòng trưng bày và làm việc của ông Lâm Thế Vinh trên lầu.', ['lam-the-bao'],
     ['lo-thu-nam', 'kinh-lup', 'hop-nu-trang', 'tu-kinh'], ['ngan-keo'],
     {'logic': 'AND', 'requiredItemIds': ['item-px-lo-thu-nam', 'item-px-hop-nu-trang'],
      'requiredClueIds': ['evidence-px-di-chuc', 'evidence-px-so-tay'], 'requiredDialogueIds': ['dlg-px-bao-thu-hai']},
     AUDIO + 'ambience-study.wav'),
    ('hieu-thuoc', 'Hiệu thuốc Hưng Long', 'Hiệu thuốc cách nhà số 7 năm phút đi bộ.', ['hoc-viec'],
     ['so-giao-nhan', 'khay-tem'], [],
     {'logic': 'AND', 'requiredItemIds': ['item-px-so-giao-nhan', 'item-px-khay-tem'], 'requiredClueIds': [],
      'requiredDialogueIds': ['dlg-px-tung-nhan-thuoc']},
     AUDIO + 'ambience-hall.wav'),
    ('nha-xe', 'Nhà xe và phòng Trịnh Lực', 'Nhà xe ngựa sau nhà số 7, chỗ tài xế ăn ngủ.', ['trinh-luc'],
     ['so-xe'], ['ruong'],
     {'logic': 'AND', 'requiredItemIds': ['item-px-so-xe'], 'requiredClueIds': [],
      'requiredDialogueIds': ['dlg-px-luc-dem-thu-nam']},
     AUDIO + 'ambience-garden.wav'),
    ('cam-do', 'Tiệm cầm đồ Đặng Bửu', 'Tiệm cầm đồ ngõ Chợ Gạo.', ['dang-buu'],
     ['so-no', 'phieu-cam'], [],
     {'logic': 'AND', 'requiredItemIds': ['item-px-so-no', 'item-px-phieu-cam'], 'requiredClueIds': [],
      'requiredDialogueIds': ['dlg-px-buu-no']},
     AUDIO + 'ambience-hall.wav'),
    ('hieu-anh', 'Hiệu ảnh Tô Khánh', 'Hiệu ảnh số 22, có buồng tối sau rèm.', ['to-khanh'],
     ['la-thu-trang', 'thuoc-hien', 'keo-ep-anh'], [],
     {'logic': 'AND', 'requiredItemIds': ['item-px-la-thu-trang', 'item-px-thuoc-hien', 'item-px-keo-ep-anh'],
      'requiredClueIds': ['evidence-px-thu-hen', 'fact-px-ngoai-pham'], 'requiredDialogueIds': ['dlg-px-khanh-ben-do']},
     AUDIO + 'ambience-study.wav'),
]
ENV_INTERACTION = {'ngan-keo': 'interaction-px-ngan-keo', 'ruong': 'interaction-px-ruong'}
ZONE_CLUE = {'tem-niem': 'evidence-px-tem-niem', 'nhan': 'evidence-px-nhan-trong-tu'}
ZONE_LABEL = {'tem-niem': 'Tem niêm trên lọ thuốc', 'nhan': 'Nhẫn ngọc bích trong tủ kính'}
TRANSITION_LABEL = {'pho': 'Ra phố Hàng Đường', 'nha-so-7': 'Vào nhà số 7', 'hieu-thuoc': 'Vào Hiệu thuốc Hưng Long',
                    'nha-xe': 'Vào nhà xe', 'cam-do': 'Vào tiệm cầm đồ', 'hieu-anh': 'Vào hiệu ảnh Tô Khánh'}
W = 2048


def pct(box):
    return {'x': round(box['x'] / W * 100, 3), 'y': round(box['y'] / W * 100, 3),
            'width': round(box['width'] / W * 100, 3), 'height': round(box['height'] / W * 100, 3)}


def small(box):
    return {'width': min(160, box['width']), 'height': min(160, box['height'])}


stages = [{'stageId': 'stage-px-hien-truong', 'title': 'Sáng thứ Sáu', 'order': 1, 'scenes': []},
          {'stageId': 'stage-px-hop-thuoc', 'title': 'Lần theo hộp thuốc', 'order': 2, 'scenes': []}]
for i, (key, title, desc, npcs, item_keys, env_keys, cond, ambience) in enumerate(SCENES):
    rt = RT['scenes'][key]
    hotspots, item_pl, char_pl, zones, transitions = [], [], [], [], []
    for k in item_keys:
        box = rt['items'][k]
        hotspots.append({'hotspotId': f'hotspot-px-{k}', 'type': 'ITEM', 'targetId': f'item-px-{k}', **pct(box),
                         'zIndex': 5, 'label': ITEMS[k][1], 'requiredClueIds': []})
        item_pl.append({'itemId': f'item-px-{k}', 'asset': '',
                        'position': {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'], 'anchor': 'bottom-center'},
                        'size': small(box), 'hotspot': box, 'anchor': 'bottom-center', 'depth': 5})
    for k in env_keys:
        box = rt['envs'][k]
        hotspots.append({'hotspotId': f'hotspot-px-{k}', 'type': 'ENVIRONMENT', 'targetId': ENV_INTERACTION[k], **pct(box),
                         'zIndex': 5, 'label': {'ngan-keo': 'Ngăn kéo bàn làm việc', 'ruong': 'Rương dưới chân giường'}[k],
                         'requiredClueIds': []})
    for n in rt['npcs']:
        f = n['feet']
        scale = rt['actorScale']
        body = {'x': f['x'] - 18 * scale, 'y': f['y'] - 84 * scale, 'width': 36 * scale, 'height': 86 * scale}
        body['y'] = max(0, body['y'])
        hotspots.append({'hotspotId': f'hotspot-px-{n["char"]}', 'type': 'CHARACTER', 'targetId': cid(n['char']), **pct(body),
                         'zIndex': 6, 'label': CHARS[n['char']][0], 'requiredClueIds': []})
        char_pl.append({'characterId': cid(n['char']), 'asset': '', 'position': f,
                        'size': {'width': 128 * scale, 'height': 128 * scale}, 'hotspot': body,
                        'anchor': 'bottom-center', 'direction': 'left'})
    for k, box in rt['zones'].items():
        zones.append({'clueId': ZONE_CLUE[k], 'label': ZONE_LABEL[k], 'bounds': box, 'shape': 'rect',
                      'surface': 'table', 'visibility': 'clear', 'detectionDifficulty': 'medium',
                      'detectionStatus': 'FOUND', 'confidence': 0.9, 'source': 'manual-visual-review',
                      'isFallback': False, 'requiredClueIds': [], 'reason': 'Vùng đặt tay theo ảnh PixelLab gốc.'})
    for target, box in rt['transitions'].items():
        transitions.append({'transitionId': f'transition-px-{key}-to-{target}', 'targetSceneId': sid(target),
                            'label': TRANSITION_LABEL[target], 'hotspot': box, 'depth': 22})
    spawns = {}
    for name, p in rt['spawns'].items():
        if name.startswith('from:'):
            name = 'from:' + sid(name[5:])
        spawns[name] = {**p, 'direction': 'right'}
    indoor = rt['projection'] == 'isometric'
    runtime = {
        'width': W, 'height': W, 'floorY': rt['walkableArea']['y'] + rt['walkableArea']['height'],
        'walkableArea': rt['walkableArea'], 'navigationObstacles': [],
        'spawnPoints': spawns, 'itemPlacements': item_pl, 'characterPlacements': char_pl,
        'clueZones': zones, 'transitions': transitions,
        'cameraRules': {'captureRectWidth': 360 if indoor else 200, 'captureRectHeight': 280 if indoor else 156,
                        'minClueCoverage': 0.45, 'nearMissCoverage': 0.22, 'requireCaptureCenterInside': True},
        'render': {'mode': 'pixel', 'projection': rt['projection'], 'nativeWidth': 512, 'nativeHeight': 512,
                   'pixelScale': 4, 'cameraZoom': rt['cameraZoom'], 'actorScale': rt['actorScale'],
                   'walkSpeed': rt['walkSpeed'], 'interactRadius': rt['interactRadius'],
                   'backdropColor': '#11100e' if indoor else '#3c4a55',
                   'walkGrid': rt['walkGrid'],
                   'foreground': rt['foreground']},
    }
    if ambience:
        runtime['audio'] = {'ambienceUrl': ambience, 'cues': CUES}
    else:
        runtime['audio'] = {'ambienceUrl': '', 'cues': CUES}
    scene = {'sceneId': sid(key), 'title': title, 'backgroundUrl': rt['backgroundUrl'], 'description': desc,
             'itemIds': [f'item-px-{k}' for k in item_keys], 'characterIds': [cid(c) for c in npcs],
             'hotspots': hotspots, 'runtime': runtime, 'completeCondition': cond}
    stages[0 if i < 2 else 1]['scenes'].append(scene)

case = {
    'caseId': CASE_ID,
    'title': 'Lọ thuốc thứ Năm',
    'summary': '06:40 sáng thứ Sáu, bà Lý Hạnh thấy ông Lâm Thế Vinh bất động trên ghế bành ở nhà số 7 phố Hàng Đường, sau một liều thuốc tim đặc bất thường. Hộp nữ trang mở toang, tờ di chúc có dấu bị sửa. Hai thám tử có một buổi sáng để lần theo hộp thuốc tuần qua năm căn nhà quanh quảng trường.',
    'language': 'vi', 'status': 'DRAFT', 'mechanicsVersion': 3, 'generationMode': 'PLACEMENT_FIRST',
    'estimatedMinutes': 30, 'coverImageUrl': RT['cover'],
    'stages': stages, 'characters': characters, 'items': items, 'clues': clues, 'dialogues': dialogues,
    'testimonyFragments': testimony, 'conversationNodes': conversation, 'evidenceChallenges': challenges,
    'deductions': deductions, 'requiredTeamworkChains': chains, 'hints': hints, 'interactions': interactions,
    'puzzles': puzzles, 'alternateRewardPaths': [], 'finalLogic': final_logic,
}
path = os.path.join(OUT, f'{CASE_ID}.json')
json.dump(case, open(path, 'w'), ensure_ascii=False, indent=1)
print(path, os.path.getsize(path))
