"""Rebuild the authored reference JSON. No model/provider/API calls.

The bundled night-ledger seed is used only as the proven runtime-layout contract.
Narrative, IDs, art, camera evidence, second confrontation and stage structure below
belong to this separate reference case. Outputs never go into frontend public.
"""
from pathlib import Path
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ASSET = '/assets/reference-cases/dem-khoa-so/pixel-v2'


def rewrite(value):
    if isinstance(value, dict):
        return {k: rewrite(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rewrite(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r'-vi\b', '-dks', value)
        for old, new in [('char-mara', 'char-mai'),
                         ('char-victor', 'char-vu'), ('char-samuel', 'char-son'),
                         ('Mara Vale', 'Mai Vân'), ('Victor Crane', 'Vũ Khang'),
                         ('Samuel Reed', 'Sơn Lâm'), ('Mara', 'Mai'),
                         ('Victor', 'Khang'), ('Samuel', 'Lâm')]:
            value = value.replace(old, new)
    return value


d = rewrite(json.loads((ROOT / 'src/BE/SeedData/V3/case-point-click-night-ledger-vi.json').read_text(encoding='utf-8-sig')))
d.update(caseId='case-reference-dem-khoa-so-vi', title='Đêm khóa sổ', language='vi',
         summary='22:00, nhà hát Vọng Âm đóng cửa sau đêm diễn cứu trợ. Trong phong bì quỹ, tờ lệnh chi đã bị thay. Sáng mai ngân hàng sẽ trả tiền cho người ghi trên lệnh. Một người khám nghiệm vật chứng, một người gỡ lời khai: hãy tìm ra ai đã đổi hồ sơ trước khi quỹ bị rút.',
         estimatedMinutes=35, status='DRAFT', coverImageUrl=ASSET + '/scenes/ticket-office.png')
office, hall = d['stages'][0]['scenes']
d['stages'] = [dict(stageId='stage-dem-khoa-so-1', title='Hồi I — Quầy vé sau màn hạ', order=1, scenes=[office]),
               dict(stageId='stage-dem-khoa-so-2', title='Hồi II — Hồ sơ trước giờ giải ngân', order=2, scenes=[hall])]
office.update(title='Phòng vé Vọng Âm', backgroundUrl=ASSET+'/scenes/ticket-office.png',
              description='Trên quầy là hai nửa biên nhận và phong bì có dấu sáp đỏ. Chìa ngăn hồ sơ treo trên móc đồng cạnh cửa. Kiểm tra vật chứng, chụp rõ móc treo sau khi lấy chìa và nhờ đồng đội hỏi Mai cùng Khang.')
hall.update(title='Hành lang kiểm sổ', backgroundUrl=ASSET+'/scenes/service-passage.png',
            description='Một hộp hồ sơ khóa số đặt trên bục gỗ; tủ thư dịch vụ ở kệ bên phải. Sơn Lâm chờ cạnh Mai. Dùng biên nhận và chìa đã tìm được để khôi phục dòng thời gian trước khi cùng đối chất.')

characters = {x['characterId']: x for x in d['characters']}
for cid, name, role, desc, visual, file in [
    ('char-mai-dks','Mai Vân','Nhân viên phòng vé','Mai tiếp nhận phong bì lệnh chi quỹ lúc 20:50. Cô nói mình rời nhà hát lúc 21:00.','Phụ nữ Việt khoảng 32 tuổi, tóc búi, áo đỏ rượu, váy dài xám.','mai-van'),
    ('char-son-dks','Sơn Lâm','Bảo vệ đêm','Lâm bắt đầu ca lúc 21:45. Ông nghi có người lạ giật chìa; cần tách điều ông thấy khỏi điều ông suy đoán.','Người Việt khoảng 58 tuổi, mũ vải và đồng phục xanh tối, ria mép mảnh.','son-lam'),
    ('char-vu-dks','Vũ Khang','Thủ quỹ','Khang bàn giao lệnh chi đã niêm phong rồi đi ngân hàng. Phiếu cầm đồ cũ của ông dễ gây hiểu lầm.','Nam Việt khoảng 48 tuổi, kính tròn, bộ vest xanh trầm.','vu-khang')]:
    characters[cid].update(name=name,role=role,description=desc,visualDescription=visual,imageUrl=f'{ASSET}/characters/{file}.png')
    for scene in [office,hall]:
        for placement in scene['runtime']['characterPlacements']:
            if placement['characterId'] == cid:
                placement['asset'] = characters[cid]['imageUrl']
                # Match the shared detectives' 240-unit height and preserve 2:3 alpha canvases.
                placement['size'] = dict(width=160,height=240)
                placement.pop('depth', None)  # Actors sort by their feet, not an item-layer depth.

items = {x['itemId']:x for x in d['items']}
item_specs = [
 ('item-receipt-left-dks','receipt-left','Nửa trái biên nhận','Mảnh trái của phiếu hướng dẫn mở hộp đối soát.','Mũi tên chỉ sang phải; số 21 nằm ở nửa trái. Mép phải bị xé răng cưa. Hãy giữ mảnh để ghép với nửa còn lại.','Giấy kem, cạnh phải xé, số 21 và mũi tên.'),
 ('item-receipt-right-dks','receipt-right','Nửa phải biên nhận','Mảnh phải bị mắc ở mép quầy.','Số 42 nằm ở nửa phải. Hai mép xé khớp nhau, nhưng riêng mảnh này chưa cho biết thứ tự mã.','Giấy kem, cạnh trái xé, số 42.'),
 ('item-locker-key-dks','brass-key','Chìa ngăn hồ sơ','Chìa đồng của ngăn thư dịch vụ.','Thẻ khóa mang biểu tượng ngăn thư. Móc treo còn đó; sau khi lấy chìa, dùng máy ảnh ghi lại tình trạng thật của móc để kiểm chứng lời bảo vệ.','Chìa đồng cũ, thẻ nhỏ có hình ngăn thư.'),
 ('item-sealed-packet-dks','sealed-envelope','Phong bì lệnh chi','Phong bì giấy kem có hai lớp sáp đỏ.','Dưới dấu sáp mới là mép niêm phong cũ đã nứt. Phong bì từng bị mở rồi đóng lại. Vết này chứng minh can thiệp vào hồ sơ, chưa chứng minh ai làm.','Phong bì giấy kem, sáp đỏ chồng lên một vòng sáp đỏ bị nứt.'),
 ('item-restored-receipt-dks','receipt-restored','Biên nhận đã ghép','Hai nửa ghép thành hướng dẫn cho khóa đối soát.','Đọc theo mũi tên từ trái sang phải: 21 | 42. Mã hộp là 2142. Đây chỉ là cách tiếp cận hồ sơ, không phải chứng cứ buộc tội.','Biên nhận giấy kem có đường xé ghép giữa, số 21 và 42 theo thứ tự.'),
 ('item-cashbox-dks','cashbox','Hộp đối soát khóa số','Hộp đồng đen giữ bản sao lệnh chi.','Khóa có bốn vòng số. Biểu tượng biên nhận và mũi tên nhắc đọc hai nửa từ trái sang phải; cần ghép biên nhận trước khi mở.','Hộp kim loại xanh đen nhỏ với khóa bốn số bằng đồng.'),
 ('item-service-locker-dks','service-lockbox','Ngăn thư dịch vụ','Hộp thư khóa chìa nằm trên kệ hậu trường.','Ổ khóa đồng có cùng biểu tượng ngăn thư như thẻ chìa ở quầy. Bên trong giữ cuống giao nhận hồ sơ, không thể lấy chỉ bằng nhìn bên ngoài.','Hộp thư gỗ nhỏ, khóa đồng và biểu tượng phong bì.')]
for iid,file,name,desc,inspect,visual in item_specs:
    items[iid].update(name=name,description=desc,inspectText=inspect,visualDescription=visual,imageUrl=f'{ASSET}/items/{file}.png')
    if items[iid].get('isInteractivePuzzleObject'):
        items[iid]['interactionReason']=inspect
    for scene in [office,hall]:
        for placement in scene['runtime']['itemPlacements']:
            if placement['itemId']==iid: placement['asset']=items[iid]['imageUrl']

# Align coordinates to the actual generated images, whose pixels were inspected.
positions = {'item-receipt-left-dks':(745,504,72,42), 'item-receipt-right-dks':(850,494,64,38),
             'item-locker-key-dks':(444,457,42,68), 'item-sealed-packet-dks':(965,507,94,52),
             'item-cashbox-dks':(400,477,118,90), 'item-service-locker-dks':(1350,499,126,96)}
for scene in [office,hall]:
    for p in scene['runtime']['itemPlacements']:
        x,y,w,h=positions[p['itemId']]
        p['position'].update(x=x,y=y)
        p['size']=dict(width=w,height=h)
        # Navigation projects raised targets to the floor; pointer bounds stay on the prop.
        p['hotspot']=dict(x=x-w/2-8,y=y-h-4,width=w+16,height=h+12)
    for h in scene['hotspots']:
        if h['type']=='ITEM':
            p=next(p for p in scene['runtime']['itemPlacements'] if p['itemId']==h['targetId'])
            box=p['hotspot']; h.update(x=box['x']/16,y=box['y']/9,width=box['width']/16,height=box['height']/9,label=items[h['targetId']]['name'])
        elif h['type']=='CHARACTER':
            h['label']=characters[h['targetId']]['name']+' — '+characters[h['targetId']]['role']
office['runtime']['navigationObstacles']=[dict(x=525,y=620,width=590,height=65)]
hall['runtime']['navigationObstacles']=[dict(x=245,y=620,width=300,height=30),dict(x=1270,y=620,width=265,height=85)]
for scene, actors, spawns, exit_box in [
    (office, {'char-vu-dks':(365,760,'right'),'char-mai-dks':(1250,780,'left')},
     ((635,825),(985,825)), dict(x=155,y=190,width=100,height=440)),
    (hall, {'char-son-dks':(1020,790,'left'),'char-mai-dks':(1235,765,'left')},
     ((670,830),(840,840)), dict(x=685,y=250,width=155,height=370))]:
    runtime=scene['runtime']
    runtime['floorY']=825
    runtime['walkableArea']=dict(x=70,y=620,width=1460,height=240)
    for p in runtime['characterPlacements']:
        x,y,direction=actors[p['characterId']]
        p['position'].update(x=x,y=y); p['direction']=direction
        p['hotspot']=dict(x=x-60,y=y-235,width=120,height=240)
        h=next(h for h in scene['hotspots'] if h['targetId']==p['characterId'])
        box=p['hotspot'];h.update(x=box['x']/16,y=box['y']/9,width=box['width']/16,height=box['height']/9)
    for role,(x,y) in zip(['INVESTIGATOR','INTERROGATOR'],spawns):
        runtime['spawnPoints'][role].update(x=x,y=y)
    runtime['spawnPoints']['default'].update(x=spawns[0][0],y=spawns[0][1])
    runtime['transitions'][0]['hotspot']=exit_box

clues={x['clueId']:x for x in d['clues']}
def set_clue(cid,title,content,meaning=None):
    clues[cid].update(title=title,content=content,inventoryDescription=content,narrativeMeaning=meaning or content)
set_clue('clue-receipt-left-dks','Biên nhận — nửa 21','Nửa trái có số 21, mũi tên sang phải và mép xé răng cưa.','Cho một nửa mã; cần ghép để biết thứ tự.')
set_clue('clue-receipt-right-dks','Biên nhận — nửa 42','Nửa phải có số 42; đường xé khớp nửa 21.','Kết hợp hai mảnh thay vì đoán khóa.')
set_clue('clue-restored-receipt-dks','Mã hộp đối soát: 2142','Hai mảnh ghép thành chỉ dẫn 21 → 42. Nhập 2142 vào hộp đối soát ở hành lang.','Mở đường đến hồ sơ tài chính; không xác định thủ phạm.')
set_clue('evidence-overlapping-wax-dks','Niêm phong đỏ bị chồng lớp','Lớp sáp đỏ mới phủ lên viền sáp cũ đã gãy. Phong bì lệnh chi không nguyên vẹn suốt tối.','Bằng chứng về phương thức mở rồi niêm phong lại; không tự xác định người mở.')
set_clue('evidence-debt-transfer-dks','Bản sao lệnh chi trả nợ','Bản lưu 21:30 mang chữ ký Mai Vân và số khế ước nợ riêng của cô, thay tên đơn vị cứu trợ bằng chủ nợ. Ngân hàng sẽ giải ngân sáng mai; chưa có tiền nào được chuyển.','Cho thấy Mai có lợi ích cá nhân cụ thể và đã sửa người thụ hưởng.')
set_clue('evidence-key-entry-dks','Cuống giao nhận lúc 21:18','Cuống nộp hồ sơ ghi 21:18, chữ ký Mai Vân khớp sổ trực. Ngay dưới có chữ ký đối chứng của nhân viên nhận thư, ghi rõ Mai tự nộp. Lâm chỉ bắt đầu ca lúc 21:45. Chìa dùng chung không tự chứng minh ai vào.','Cơ hội được xác lập bằng chữ ký có đối chứng trên hồ sơ, không bằng suy đoán ai giữ chìa.')
set_clue('reveal-resealed-packet-dks','Mai khai sai về niêm phong','Hai người cùng xác nhận: viền sáp cũ đã gãy bác bỏ câu phong bì nguyên vẹn. Mai thừa nhận từng mở nó nhưng nói chỉ kiểm giấy.','Mở phong bì là sự thật; cần lệnh chi và cuống giao nhận để phân biệt kiểm giấy với đánh tráo.')

def new_clue(cid,title,content,source,stype,scene,**flags):
    c=dict(clueId=cid,title=title,content=content,isEvidence=True,isCritical=False,isRedHerring=False,
           source=source,sourceType=stype,discoverMethod=stype,sceneId=scene,inventoryDescription=content,
           narrativeMeaning=content,hintLevel=2,tags=[],relatedCharacterIds=[])
    c.update(flags); d['clues'].append(c);clues[cid]=c;return c

new_clue('evidence-intact-hook-dks','Ảnh móc chìa nguyên vẹn',
         'Ảnh cận cho thấy móc đồng còn đủ đường cong và đế bắt vít, không hề gãy rời. Nó bác bỏ lời mô tả móc bị bẻ gãy; không chứng minh căn phòng chưa từng có người lạ.',
         office['sceneId'],'camera',office['sceneId'],isCritical=True,
         visualDescription='Móc đồng hình chữ J còn nguyên, gắn vào đế nhỏ trên tường xanh cạnh cửa bên trái.',visualTextPolicy='NO_TEXT')
office['runtime']['clueZones']=[dict(clueId='evidence-intact-hook-dks',label='Móc đồng cạnh cửa',
    bounds=dict(x=426,y=340,width=38,height=66),shape='rect',surface='wall',visibility='clear',detectionDifficulty='easy',
    detectionStatus='FOUND',confidence=0.95,source='manual-visual-review',isFallback=False,requiredClueIds=[],
    reason='Pixel-v2 image visually inspected: intact brass J hook below left poster, approximately 28% width and 42% height. Bounds include its plate and curved tip.')]
office['completeCondition']['requiredClueIds'].append('evidence-intact-hook-dks')
new_clue('reveal-hook-rumour-dks','Một suy đoán đã thành lời khai',
         'Đối diện ảnh chụp, Lâm thừa nhận chỉ thấy chìa đung đưa khi đi qua cửa; ông đã tự suy ra móc gãy. Chưa có vật chứng chứng minh một vụ giật chìa từ bên ngoài.',
         'dlg-samuel-watch-dks','dialogue',hall['sceneId'],isEvidence=False,isCritical=True,relatedCharacterIds=['char-son-dks'])

# Optional, resolvable false lead: an old debt is not proof of this theft.
pawn=dict(itemId='item-pawn-ticket-dks',name='Phiếu cầm đồng hồ cũ',description='Phiếu bị kẹp dưới sổ quầy, mang tên Vũ Khang.',
          inspectText='Phiếu cầm đồng hồ mang tên Vũ Khang, nhưng dấu TẤT TOÁN có ngày từ tuần trước. Ông từng mắc nợ; tờ giấy này không chứng minh động cơ rút quỹ tối nay.',
          imageUrl=ASSET+'/items/pawn-ticket.png',isCollectible=False,unlockClueIds=['clue-old-debt-dks'],renderMode='CUTOUT',
          visualDescription='Phiếu giấy cũ có hình đồng hồ bỏ túi và dấu đỏ gạch chéo đã tất toán.')
d['items'].append(pawn); items[pawn['itemId']]=pawn;office['itemIds'].append(pawn['itemId'])
office['runtime']['itemPlacements'].append(dict(itemId=pawn['itemId'],asset=pawn['imageUrl'],position=dict(x=642,y=486,anchor='bottom-center'),
    size=dict(width=62,height=36),hotspot=dict(x=603,y=446,width=78,height=48),anchor='bottom-center',depth=10))
office['hotspots'].append(dict(hotspotId='hotspot-old-debt-dks',type='ITEM',targetId=pawn['itemId'],x=603/16,y=446/9,width=78/16,height=48/9,zIndex=10,label=pawn['name'],requiredClueIds=[]))
new_clue('clue-old-debt-dks','Khoản nợ đã tất toán','Phiếu cầm đồng hồ của Khang đã tất toán từ tuần trước. Có nợ trong quá khứ không đồng nghĩa đã sửa lệnh chi tối nay.',
         pawn['itemId'],'item',office['sceneId'],isEvidence=False,isRedHerring=True,relatedCharacterIds=['char-vu-dks'])

d['dialogues'][0].update(question='Sau khi nhận phong bì quỹ, chị đã làm gì?',
    answer='Phong bì quỹ được niêm phong nguyên vẹn cả tối. Tôi nhận phong bì lúc 20:50. Ngăn thư dịch vụ dùng chìa đồng. Tôi rời quầy lúc 21:00 rồi về.')
d['dialogues'][1].update(question='Ông thực sự thấy gì ở phòng vé, và ca trực bắt đầu lúc nào?',
    answer='Móc chìa đã bị bẻ gãy. Chắc có người ngoài giật chìa rồi chạy. Tôi bắt đầu tuần tra lúc 21:45; trước giờ đó nhân viên vẫn đi lại. Tôi không tận mắt thấy người nào giật chìa.')
d['dialogues'].append(dict(dialogueId='dlg-vu-handover-dks',characterId='char-vu-dks',question='Ông bàn giao gì và vì sao tên ông trên phiếu cầm đồ?',
    answer='20:50, tôi giao Mai phong bì có lệnh chi cho đơn vị cứu trợ. Sau đó tôi đến ngân hàng; biên nhận có dấu 21:10. Khoản cầm đồng hồ đã tất toán tuần trước. Hãy kiểm tra ngày, đừng chỉ nhìn tên.',
    requiredClueIds=[],unlockClueIds=[],availableSceneIds=[office['sceneId']]))
d['testimonyFragments'][0]['text']='Phong bì quỹ được niêm phong nguyên vẹn cả tối.'
d['testimonyFragments'][1]['text']='Tôi nhận phong bì lúc 20:50.'
d['testimonyFragments'][2]['text']='Ngăn thư dịch vụ dùng chìa đồng.'
d['testimonyFragments'] += [
 dict(id='fragment-hook-broken-dks',dialogueId='dlg-samuel-watch-dks',text='Móc chìa đã bị bẻ gãy.'),
 dict(id='fragment-patrol-start-dks',dialogueId='dlg-samuel-watch-dks',text='Tôi bắt đầu tuần tra lúc 21:45.'),
 dict(id='fragment-no-eyewitness-dks',dialogueId='dlg-samuel-watch-dks',text='Tôi không tận mắt thấy người nào giật chìa.')]

d['conversationNodes'][0]['lines'][0]['text']='Bản lưu lệnh chi nằm trong hộp khóa số. Đọc bản lưu, rồi đối chiếu lời bàn giao và dấu niêm phong; không thể chỉ nhìn tên một người rồi kết tội. Anh chị muốn hỏi gì?'
d['conversationNodes'][1]['lines'][0]['text']='Hai nửa biên nhận ghép theo mép xé. Đọc cặp số trái trước, phải sau. Mã mở hộp là công cụ tìm chứng cứ, không nói ai có tội.'
root=d['conversationNodes'][0]
root['choices'].append(dict(choiceId='choice-vu-bank-dks',label='Dấu ngân hàng 21:10 xác lập điều gì?',requiredClueIds=[],nextNodeId='node-vu-bank-dks'))
d['conversationNodes'].append(dict(nodeId='node-vu-bank-dks',characterId='char-vu-dks',isRoot=False,requiredClueIds=[],availableSceneIds=[office['sceneId']],
    lines=[dict(speaker='NPC',text='Nó xác nhận tôi giao giấy ở ngân hàng lúc 21:10. Nó không tự chứng minh mọi phút sau đó tôi ở đâu. Muốn kết luận, cần ghép hồ sơ 21:18 và bản lệnh 21:30.')],
    unlockClueIds=[],choices=[dict(choiceId='choice-vu-bank-back-dks',label='Quay lại câu chuyện.',requiredClueIds=[],nextNodeId=None)]))
d['conversationNodes'][1]['choices'][0]['nextNodeId']=None

challenge=d['evidenceChallenges'][0]
challenge.update(prompt='Bằng chứng nào trực tiếp bác bỏ câu niêm phong nguyên vẹn?',
    successResponse='Vết gãy dưới lớp sáp mới chứng minh phong bì đã mở. Mai thừa nhận kiểm giấy; hai bạn vẫn phải xác minh động cơ và cơ hội.',
    revealTitle='VẾT SÁP KHÔNG KHỚP LỜI KHAI')
d['evidenceChallenges'].append(dict(challengeId='challenge-intact-hook-dks',order=2,isSignature=False,dialogueId='dlg-samuel-watch-dks',
    testimonyFragmentId='fragment-hook-broken-dks',candidateTestimonyFragmentIds=['fragment-hook-broken-dks','fragment-patrol-start-dks','fragment-no-eyewitness-dks'],
    startRequiredTestimonyFragmentIds=['fragment-hook-broken-dks','fragment-patrol-start-dks'],
    prompt='Tách điều bảo vệ nhìn thấy khỏi điều ông đã suy ra.',correctEvidenceId='evidence-intact-hook-dks',
    candidateEvidenceIds=['evidence-intact-hook-dks','evidence-overlapping-wax-dks','evidence-key-entry-dks'],
    startRequiredEvidenceIds=['evidence-intact-hook-dks','evidence-key-entry-dks'],
    successResponse='Móc còn nguyên, nên nhận định móc đã gãy là sai. Lâm sửa lời: ông không chứng kiến trộm chìa. Đây là loại bỏ một giả thuyết, không phải lời thú tội.',
    failureResponse='Hãy chọn vật chứng kiểm tra đúng câu về móc treo. Hồ sơ tài chính không cho biết móc có gãy hay không.',
    revealTitle='ẢNH CHỤP SỬA LẠI MỘT LỜI KHAI',unlockClueIds=['reveal-hook-rumour-dks']))
hall['completeCondition']['requiredClueIds'].append('reveal-hook-rumour-dks')
ded=d['deductions'][0]
ded.update(prompt='Sau khi sửa cả hai lời khai, dòng thời gian nào giải thích việc đổi người thụ hưởng?',
    requiredClueIds=['reveal-resealed-packet-dks','reveal-hook-rumour-dks','evidence-debt-transfer-dks','evidence-key-entry-dks'],
    requiredChallengeIds=[c['challengeId'] for c in d['evidenceChallenges']],
    options=[dict(id='deduction-ledger-correct-dks',label='Mai còn ở nhà hát lúc 21:18, sửa lệnh chi trả nợ lúc 21:30 rồi niêm phong lại. Chuyện giật chìa là suy đoán.'),
             dict(id='deduction-ledger-wrong-dks',label='Mọi việc do người lạ giật chìa, vì bảo vệ nghĩ móc đã gãy.'),
             dict(id='deduction-ledger-vu-dks',label='Khang từng cầm đồng hồ nên chắc chắn ông đổi lệnh chi tối nay.')],
    successResponse='Vật chứng, mốc giờ có đối chứng và lợi ích cá nhân cùng chỉ về Mai. Bạn đã loại bỏ hai suy đoán thay vì chỉ tìm một người đáng ngờ.',
    failureResponse='Giả thuyết cần giải thích cả chữ ký 21:18, người hưởng lợi trên lệnh 21:30 và vết niêm phong; một suy đoán riêng lẻ chưa đủ.')
d['requiredTeamworkChains'][0]['description']='Điều tra viên tìm vết sáp; thẩm vấn viên chọn câu khai; hai người đối chất và lập dòng thời gian.'
d['requiredTeamworkChains'].append(dict(chainId='chain-camera-hook-dks',investigatorClueId='evidence-intact-hook-dks',interrogatorChallengeId='challenge-intact-hook-dks',
    deductionId=ded['deductionId'],description='Ảnh khám nghiệm phải kết hợp câu khai riêng của bảo vệ mới loại bỏ được giả thuyết giật chìa.'))
d['interactions'][0]['successMessage']='Hai mép xé khớp: 21 → 42. Bạn đã ghép biên nhận hướng dẫn mở hộp đối soát.'
d['interactions'][1]['successMessage']='Chìa mở ngăn thư. Cuống giao nhận 21:18 mang chữ ký Mai và lời xác nhận có ký tên ngay trên giấy của nhân viên nhận thư.'
d['interactions'][1]['failureMessage']='Ngăn thư dịch vụ cần đúng chìa đồng có biểu tượng phong bì.'
d['puzzles'][0].update(prompt='Ghép hai nửa biên nhận, đọc từ trái sang phải rồi nhập bốn số vào hộp đối soát.',
    successMessage='Hộp mở. Bản lưu 21:30 ghi người thụ hưởng là chủ nợ riêng của Mai; lệnh chưa được ngân hàng thực hiện.',
    investigationPurpose='Dùng mã có căn cứ để tìm bằng chứng lợi ích cá nhân và thay đổi người thụ hưởng.')
f=d['finalLogic']
f.update(motive='Chuyển tiền cứu trợ cho chủ nợ riêng để xóa nợ của Mai.',method='Thay người thụ hưởng trên lệnh chi rồi dùng sáp đỏ mới che niêm phong cũ đã gãy.',
    motiveOptions=[dict(id='motive-private-debt-dks',label='Dùng quỹ cứu trợ để trả khoản nợ riêng của Mai'),dict(id='motive-bank-deposit-dks',label='Tất toán khoản cầm đồng hồ cũ của Khang'),dict(id='motive-patrol-dks',label='Che giấu việc Lâm bắt đầu trực muộn')],
    methodOptions=[dict(id='method-reseal-wax-dks',label='Mở phong bì, đổi lệnh chi rồi niêm phong lại bằng sáp đỏ'),dict(id='method-guard-patrol-dks',label='Giật chìa bằng cách bẻ gãy móc treo'),dict(id='method-bank-error-dks',label='Ngân hàng tự ghi sai tên người nhận, phong bì không bị mở')],
    requiredTeamworkChainIds=[x['chainId'] for x in d['requiredTeamworkChains']],
    winEnding='Trước giờ ngân hàng mở cửa, hai thám tử giao nộp hồ sơ: chữ ký giao nhận 21:18, bản lệnh chi 21:30 trả chủ nợ của Mai và lớp sáp che vết niêm phong vỡ. Mai thừa nhận đổi người nhận tiền. Lệnh bị hủy, quỹ cứu trợ được giữ nguyên. Khang không bị kết tội từ khoản nợ cũ; Lâm đính chính lời suy đoán. Vụ án khép lại nhờ cả vật chứng và lời khai được kiểm chứng.',
    failEnding='Cáo buộc chưa liên kết đúng người, lợi ích, phương thức và cơ hội. Một món nợ cũ hay lời đoán về chiếc móc chưa đủ buộc tội. Xem lại phần đối chiếu trong kết quả rồi mở phòng chơi mới để thử lại; hồ sơ này chưa tạo được một kết luận có căn cứ.')
d['hints']=[
 dict(hintId='hint-office-1-dks',contextType='SCENE',targetId=office['sceneId'],order=1,text='Chia việc: một người kiểm tra quầy và chìa, một người ghi lời Mai cùng Khang. Phiếu cầm đồ có ngày cần đọc kỹ.'),
 dict(hintId='hint-office-2-dks',contextType='SCENE',targetId=office['sceneId'],order=2,text='Ghép hai mảnh biên nhận trong túi đồ. Dùng máy ảnh chụp móc đồng trên tường cạnh cửa; lấy chìa trước để nhìn rõ móc.'),
 dict(hintId='hint-hall-1-dks',contextType='SCENE',targetId=hall['sceneId'],order=1,text='Hộp số cần biên nhận đã ghép, ngăn thư cần chìa đồng. Hỏi Lâm và đối chiếu hai câu khai riêng biệt.'),
 dict(hintId='hint-hall-2-dks',contextType='SCENE',targetId=hall['sceneId'],order=2,text='Mỗi người giữ phần thông tin riêng: điều tra viên đề xuất vật chứng, thẩm vấn viên chọn lời khai; cả hai xác nhận cặp đối chất.'),
 dict(hintId='hint-seal-1-dks',contextType='CONFRONTATION',targetId=challenge['challengeId'],order=1,text='Câu khai nói về niêm phong. Chọn dấu vật lý cho thấy niêm phong đã bị mở, không chọn chứng cứ chỉ nói về khoản nợ.'),
 dict(hintId='hint-hook-1-dks',contextType='CONFRONTATION',targetId='challenge-intact-hook-dks',order=1,text='Câu móc đã bị bẻ gãy có thể kiểm tra trực tiếp bằng ảnh móc. Bác câu này không đồng nghĩa bảo vệ lấy quỹ.'),
 dict(hintId='hint-deduction-1-dks',contextType='DEDUCTION',targetId=ded['deductionId'],order=1,text='Xếp 21:18, 21:30, 21:45. Giải thích nào khớp hồ sơ và vết sáp mà không dựa vào lời suy đoán đã bị bác?')]

HERE.mkdir(parents=True,exist_ok=True)
target=HERE/'case.json'
target.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Authored {target}; {len(d["stages"])} stages; {len(d["clues"])} clues; {len(d["evidenceChallenges"])} confrontations.')
