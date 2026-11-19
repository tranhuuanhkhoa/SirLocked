"""Native-pixel (512x512) layout of the six pixel scenes of case "Lọ thuốc thứ Năm".

All coordinates are NATIVE map/room pixels. The runtime world is native x PIXEL_SCALE.
Boxes are (x0, y0, x1, y1), exclusive of x1/y1. Points are (x, y) = feet / ground point.
"""

PIXEL_SCALE = 4
GRID_CELL_NATIVE = 4          # one walk-grid cell = 4 native px = 16 runtime units
NATIVE = 512

HUB = {
    'key': 'pho',
    'image': 'art/map-v1/map-512.png',
    'projection': 'topdown',
    'cameraZoom': 1.0,
    'actorScale': 1.5,
    'walkSpeed': 300,
    'interactRadius': 30,      # native px from feet to the approach point
    # walkability = object mask black, minus these blocked boxes, plus these carved boxes
    'blocked': [
        (0, 0, 512, 84),          # river, river fence and the strip behind it
    ],
    'carve': [
        (310, 32, 352, 94),       # wooden pier deck (walkable)
        (86, 282, 110, 318),      # nhà số 7 front steps between the two garden fences
        (436, 278, 456, 298),     # hiệu thuốc threshold
        (8, 468, 80, 490),        # behind the carriage, in front of the carriage-house door
        (42, 456, 70, 476),       # carriage-house doorway bottom
        (148, 482, 174, 500),     # tiệm cầm đồ threshold
        (402, 488, 428, 504),     # hiệu ảnh threshold
        (192, 128, 230, 198),     # pavement under the tree canopy beside nhà số 7
    ],
    # tall objects drawn above the player when the player's feet are behind (above) baseY
    'occluders': [
        {'id': 'lamp-1', 'box': (226, 136, 242, 210), 'foot': (229, 201, 239, 210)},
        {'id': 'lamp-2', 'box': (308, 136, 324, 210), 'foot': (311, 201, 322, 210)},
        {'id': 'lamp-3', 'box': (225, 256, 242, 330), 'foot': (228, 320, 239, 330)},
        {'id': 'lamp-4', 'box': (315, 331, 331, 403), 'foot': (318, 393, 328, 403)},
        {'id': 'clock', 'box': (262, 172, 294, 259), 'foot': (264, 240, 292, 259), 'open': (269, 198, 288, 240)},
        {'id': 'tree', 'box': (186, 124, 232, 214), 'foot': (200, 198, 216, 214), 'open': (192, 124, 232, 214)},
        {'id': 'cart', 'box': (279, 440, 312, 480), 'foot': (281, 466, 310, 480)},
        {'id': 'carriage', 'box': (0, 446, 84, 512), 'foot': (0, 488, 84, 512)},
    ],
    'npcs': [
        {'char': 'ly-hanh', 'feet': (62, 324)},
    ],
    'spawns': {
        'default': (280, 312), 'INVESTIGATOR': (262, 312), 'INTERROGATOR': (298, 312),
        'from:nha-so-7': (98, 322), 'from:hieu-thuoc': (446, 306), 'from:nha-xe': (92, 494),
        'from:cam-do': (161, 504), 'from:hieu-anh': (415, 500),
    },
    'transitions': {
        'nha-so-7': (80, 226, 116, 300),
        'hieu-thuoc': (430, 226, 462, 296),
        'nha-xe': (38, 406, 74, 478),
        'cam-do': (142, 434, 180, 500),
        'hieu-anh': (398, 446, 432, 504),
    },
    'items': {
        'dong-ho': (262, 170, 294, 262),
    },
    'envs': {},
    'zones': {},
}

def room(key, floor, blocks, npcs, spawn, exit_box, items, envs=None, zones=None, image=None):
    return {
        'key': key,
        'image': image or f'art/interiors/{key}-cut.png',
        'projection': 'isometric',
        'cameraZoom': 0.5,
        'actorScale': 4,
        'walkSpeed': 520,
        'interactRadius': 26,
        'floor': floor,
        'blocks': blocks,
        'occluders': [],
        'npcs': npcs,
        'spawns': {'default': spawn, 'INVESTIGATOR': (spawn[0] - 14, spawn[1]),
                   'INTERROGATOR': (spawn[0] + 14, spawn[1]), 'from:pho': spawn},
        'transitions': {'pho': exit_box},
        'items': items,
        'envs': envs or {},
        'zones': zones or {},
    }

ROOMS = [
    room('nha-so-7',
         floor=[(256, 262), (28, 374), (256, 472), (484, 360)],
         blocks=[('rect', (36, 210, 172, 342)),          # fireplace
                 ('rect', (100, 290, 214, 432)),         # glass cabinet (tủ kính)
                 ('rect', (226, 160, 304, 254)),         # dressing table
                 ('rect', (266, 186, 384, 308)),         # writing desk
                 ('rect', (370, 128, 494, 354)),         # bookshelf
                 ('rect', (304, 298, 430, 404))],        # armchair + side table
         npcs=[{'char': 'lam-the-bao', 'feet': (250, 344)}],
         spawn=(256, 444),
         exit_box=(212, 432, 300, 482),
         items={'lo-thu-nam': (320, 336, 364, 374), 'kinh-lup': (298, 196, 352, 230),
                'hop-nu-trang': (256, 162, 292, 192), 'tu-kinh': (108, 288, 206, 422)},
         envs={'ngan-keo': (334, 238, 378, 298)},
         zones={'tem-niem': (324, 342, 356, 370)}),
    room('hieu-thuoc',
         floor=[(256, 244), (36, 352), (256, 466), (476, 354)],
         blocks=[('poly', [(30, 352), (252, 240), (252, 292), (124, 352), (92, 374)]),   # wall shelves
                 ('rect', (118, 278, 302, 414)),         # counter
                 ('rect', (168, 382, 214, 430)),         # crate in front of the counter
                 ('rect', (40, 322, 114, 378)),          # crates left
                 ('rect', (258, 196, 358, 298)),         # back cabinet
                 ('rect', (316, 246, 442, 354)),         # work table
                 ('rect', (414, 298, 470, 366))],        # barrel
         npcs=[{'char': 'hoc-viec', 'feet': (334, 398)}],
         spawn=(256, 440),
         exit_box=(212, 424, 300, 472),
         items={'so-giao-nhan': (184, 298, 238, 330), 'khay-tem': (230, 268, 284, 306)}),
    room('nha-xe',
         floor=[(262, 208), (46, 326), (256, 440), (462, 324)],
         blocks=[('poly', [(52, 282), (150, 232), (208, 262), (208, 300), (98, 354), (52, 332)]),   # workbench
                 ('rect', (166, 262, 232, 296)),         # cart wheel (upright, footprint only)
                 ('rect', (218, 200, 314, 268)),         # hay + crate
                 ('rect', (284, 190, 344, 254)),         # nightstand
                 ('rect', (288, 224, 418, 318)),         # bed
                 ('rect', (392, 266, 464, 338)),         # chest
                 ('poly', [(214, 372), (270, 346), (340, 346), (396, 350), (398, 386), (300, 434), (256, 448), (212, 434)])],  # hay, crates, barrel
         npcs=[{'char': 'trinh-luc', 'feet': (254, 308)}],
         spawn=(160, 370),
         exit_box=(98, 352, 186, 404),
         items={'so-xe': (90, 254, 154, 294)},
         envs={'ruong': (388, 266, 462, 338)}),
    room('cam-do',
         image='art/interiors/tiem-cam-do-cut.png',
         floor=[(256, 268), (36, 350), (256, 470), (476, 352)],
         blocks=[('rect', (198, 158, 318, 284)),         # safe
                 ('rect', (248, 252, 368, 384)),         # counter
                 ('rect', (268, 168, 450, 302)),         # iron grille
                 ('rect', (350, 266, 478, 394)),         # display case
                 ('rect', (42, 280, 138, 368)),          # trunk
                 ('rect', (122, 220, 224, 338))],        # boxes and crates
         npcs=[{'char': 'dang-buu', 'feet': (226, 374)}],
         spawn=(256, 444),
         exit_box=(212, 424, 300, 472),
         items={'so-no': (286, 268, 336, 300), 'phieu-cam': (328, 290, 364, 314)},
         zones={'nhan': (390, 316, 424, 344)}),
    room('hieu-anh',
         floor=[(256, 250), (24, 348), (256, 474), (488, 346)],
         blocks=[('rect', (64, 236, 214, 332)),          # painted backdrop and stand
                 ('rect', (30, 278, 94, 360)),           # crates
                 ('rect', (128, 260, 208, 328)),         # posing chair
                 ('rect', (182, 208, 220, 288)),         # side table with vase
                 ('rect', (212, 168, 278, 304)),         # stacked boxes
                 ('rect', (224, 288, 304, 394)),         # camera on tripod
                 ('rect', (296, 188, 410, 304)),         # darkroom table
                 ('rect', (396, 128, 494, 302)),         # shelves
                 ('rect', (370, 280, 478, 374))],        # barrels and stool
         npcs=[{'char': 'to-khanh', 'feet': (334, 350)}],
         spawn=(256, 446),
         exit_box=(212, 428, 300, 476),
         items={'la-thu-trang': (302, 96, 406, 162), 'thuoc-hien': (354, 168, 404, 224),
                'keo-ep-anh': (438, 138, 478, 180)}),
]
