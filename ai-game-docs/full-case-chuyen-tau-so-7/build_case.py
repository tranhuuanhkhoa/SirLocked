"""Author a standalone six-scene V3 case. Offline; no provider/database calls."""
from pathlib import Path
from copy import deepcopy
import json

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ASSET='/assets/reference-cases/chuyen-tau-so-7'
def ident(kind,key): return f'{kind}-{key}-t7'
def ids(kind,keys): return [ident(kind,k) for k in keys]
def asset(kind,name): return f'{ASSET}/{kind}/{name}.png'
audio={'ambienceUrl': '/assets/audio/point-click/ambience-study.wav',
 'cues': {'dialogue': '/assets/audio/point-click/dialogue.wav',
          'discovery': '/assets/audio/point-click/discovery.wav',
          'reveal': '/assets/audio/point-click/reveal.wav',
          'scene': '/assets/audio/point-click/scene.wav',
          'ping': '/assets/audio/point-click/ping.wav',
          'interact': '/assets/audio/point-click/interact.wav',
          'error': '/assets/audio/point-click/error.wav'}}
d=dict(caseId='case-full-chuyen-tau-so-7-vi',title='Hồ sơ chuyến tàu số 7',language='vi',status='DRAFT',
       mechanicsVersion=3,logicContractVersion=1,generationMode='PLACEMENT_FIRST',estimatedMinutes=80,
       art_style='pixel_art',sub_style='high_detail_pixel',character_style='chibi',
       summary='23:10, ga Lạc Hải, năm 1932. Hồ sơ kiểm định cầu phải theo chuyến tàu số 7 lúc 00:15 đã biến mất. Một bức điện hủy giao nhận, chiếc đồng hồ sai giờ và kiện hàng chờ ra bến sông khiến năm lời khai lệch nhau. Hai thám tử có chưa đầy một đêm để tìm bản gốc trước khi nó rời ga. Hãy lần theo giấy tờ, kiểm tra hiện trường và cùng đối chất; đừng nhầm một lời nói dối với toàn bộ tội trạng.',
       coverImageUrl=asset('scenes','station-hall'))
for key in ['stages','characters','items','clues','dialogues','conversationNodes','testimonyFragments','interactions','puzzles','evidenceChallenges','deductions','requiredTeamworkChains','hints']:
    d[key]=[]
scenes={}; items={}; clues={}; dialogues={}

for key,name,role,description,visual in [
 ('vy','Trần Tường Vy','Phó trưởng ga','Điều phối hồ sơ kiểm định và các hợp đồng vật tư. Vy yêu cầu điều tra kín để không ảnh hưởng chuyến tàu đêm.','Vietnamese woman age42, navy tailored jacket, cream silk scarf, low bun, composed sharp eyes'),
 ('hanh','Đỗ Hạnh','Nhân viên vé và giao nhận','Giữ sổ nhận hồ sơ. Cô nhớ tiếng chuông xe hàng nhưng dựa vào đồng hồ sảnh để kể lại thời điểm.','Vietnamese woman age28, burgundy waistcoat, cream blouse, charcoal trousers, short black bob'),
 ('an','Lê Quốc An','Thợ đồng hồ và tín hiệu','Đang bị nhắc nhở vì bảo dưỡng ngoài lịch. An sợ mất việc và không muốn nhắc đến nắp máy đồng hồ.','Vietnamese man age35, dark teal work coat, rolled cream sleeves, charcoal flat cap, no spectacles'),
 ('minh','Bùi Minh','Phóng viên đường sắt','Đến viết về cuộc kiểm định cầu. Anh giấu danh tính nguồn tin và lặp lại một thông báo chưa tự kiểm chứng.','Vietnamese man age33, tobacco brown suit, round spectacles, short dark hair, slim dark tie'),
 ('nghi','Phạm Nghi','Nhân viên chuyển hàng','Chuyển kiện giữa kho và sân tập kết. Một khoản tiền công thêm khiến ông bị nghi nhận hối lộ.','Vietnamese man age57, ochre railway porter jacket and cap, grey moustache, dark trousers')]:
    d['characters'].append(dict(characterId=ident('char',key),name=name,role=role,description=description,visualDescription=visual,imageUrl=asset('characters',key)))
chars={c['characterId']:c for c in d['characters']}

scene_specs=[
 ('hall','Sảnh ga Lạc Hải','station-hall',['hanh','vy'],'Chiếc đồng hồ lớn đã được chỉnh lại trước khi hai thám tử tới. Mốc giờ trong lời kể vẫn chưa chắc đúng. Xem lịch giao nhận, sổ nhận kiện và mảnh điện tín trên quầy; hỏi Hạnh cô đã xác định giờ bằng cách nào.'),
 ('dispatch','Phòng điện tín','dispatch-office',['an','hanh'],'Máy điện báo đã im. Ghép hai phần bản nháp, mở hộp trực bằng quy ước giờ bàn giao và đối chiếu nhật ký chuẩn. Muốn vào kho, hai người phải thống nhất lại mốc thời gian qua đối chất và suy luận.'),
 ('warehouse','Kho hành lý','luggage-warehouse',['nghi','minh'],'Hòm gỗ ngoài có dải xanh còn ở mép kho; túi hồ sơ bên trong đã chuyển sang sân tập kết. Chụp dấu nhận dạng để đối chiếu sổ tiếp nhận. Chìa hộp trực mở ngăn điều vận; ký hiệu trên tủ tuyến dẫn tới nơi nhận thực sự.'),
 ('signal','Buồng trực tín hiệu','signal-cabin',['an','minh'],'Cần tách hai việc: sửa đồng hồ và tạo điện hủy. Chụp nắp bảo dưỡng đang mở, lấy nhật ký điện đến rồi đối chất với An và Minh. Chỉ kết luận điều chứng cứ thực sự xác lập.'),
 ('archive','Phòng lưu trữ kế toán','accounts-archive',['vy','hanh'],'Quyền kiểm tra sổ được mở sau khi điện hủy bị bác. Tìm người hưởng lợi, chứng từ giao hồ sơ và vết hằn trên giấy lót. Hỏi lại Vy và Hạnh với những gì đã biết.'),
 ('platform','Sân tập kết chuyến số 7','freight-platform',['nghi','vy'],'Xe tay ra bến hẹn 00:05 nhưng vẫn đang bị giữ tại sân có mái che. Mở rương sắt chứa túi chứng từ và hồ sơ gốc, đối chiếu lệnh có ký nhận, rồi cùng hoàn tất cáo buộc trước giờ tàu chạy.')]
for index,(key,title,bg,actor_keys,description) in enumerate(scene_specs):
    sid=ident('scene',key)
    runtime=dict(width=1600,height=900,floorY=820,walkableArea=dict(x=80,y=630,width=1440,height=230),
                 navigationObstacles=[dict(x=520,y=630,width=590,height=45)],
                 spawnPoints={role:dict(x=x,y=830,anchor='bottom-center',direction='right' if x<800 else 'left') for role,x in [('default',640),('INVESTIGATOR',640),('INTERROGATOR',920)]},
                 itemPlacements=[],characterPlacements=[],clueZones=[],audio=deepcopy(audio),
                 cameraRules=dict(captureRectWidth=180,captureRectHeight=140,minClueCoverage=.45,nearMissCoverage=.22,requireCaptureCenterInside=True),transitions=[])
    scene=dict(sceneId=sid,title=title,backgroundUrl=asset('scenes',bg),description=description,itemIds=[],characterIds=ids('char',actor_keys),hotspots=[],runtime=runtime,
               completeCondition=dict(logic='AND',requiredItemIds=[],requiredClueIds=[],requiredDialogueIds=[]))
    for j,ckey in enumerate(actor_keys):
        x,y=(355,775) if j==0 else (1220,775)
        box=dict(x=x-58,y=y-235,width=116,height=240)
        runtime['characterPlacements'].append(dict(characterId=ident('char',ckey),asset=asset('characters',ckey),position=dict(x=x,y=y,anchor='bottom-center'),size=dict(width=160,height=240),hotspot=box,anchor='bottom-center',direction='right' if j==0 else 'left'))
        scene['hotspots'].append(dict(hotspotId=ident('hotspot',key+'-'+ckey),type='CHARACTER',targetId=ident('char',ckey),x=box['x']/16,y=box['y']/9,width=box['width']/16,height=box['height']/9,zIndex=14,label=chars[ident('char',ckey)]['name'],requiredClueIds=[]))
    scenes[key]=scene
for i,title in enumerate(['Hồi I — Mười hai phút bị mất','Hồi II — Bức điện chưa từng đến','Hồi III — Người nhận cuối cùng']):
    d['stages'].append(dict(stageId=ident('stage',str(i+1)),title=title,order=i+1,scenes=[scenes[scene_specs[i*2][0]],scenes[scene_specs[i*2+1][0]]]))

def clue(key,title,text,scene,source,stype='item',evidence=True,critical=False,red=False):
    value=dict(clueId=ident('ev',key),title=title,content=text,inventoryDescription=text,narrativeMeaning=text,source=source,sourceType=stype,discoverMethod=stype,
               sceneId=ident('scene',scene),isEvidence=evidence,isCritical=critical,isRedHerring=red,hintLevel=2,tags=[],relatedCharacterIds=[])
    d['clues'].append(value);clues[key]=value
    return value['clueId']

def item(key,name,scene,file,position,text,clue_title=None,collectible=False,evidence=True,critical=False,red=False,mechanism=False):
    value=dict(itemId=ident('item',key),name=name,description=text.split('. ')[0]+'.',inspectText=text,visualDescription=f'{name}: isolated pixel-art {file}, warm brass and paper palette, transparent background.',imageUrl=asset('items',file),isCollectible=collectible,renderMode='CUTOUT',unlockClueIds=[])
    if mechanism: value.update(isInteractivePuzzleObject=True,interactionReason=text)
    if clue_title: value['unlockClueIds']=[clue(key,clue_title,text,scene,value['itemId'],evidence=evidence,critical=critical,red=red)]
    d['items'].append(value);items[key]=value
    if scene:
        s=scenes[scene];s['itemIds'].append(value['itemId'])
        x,y,w,h=position;box=dict(x=x-w/2-7,y=y-h-3,width=w+14,height=h+10)
        s['runtime']['itemPlacements'].append(dict(itemId=value['itemId'],asset=value['imageUrl'],position=dict(x=x,y=y,anchor='bottom-center'),size=dict(width=w,height=h),hotspot=box,anchor='bottom-center',depth=10))
        s['hotspots'].append(dict(hotspotId=ident('hotspot',key),type='ITEM',targetId=value['itemId'],x=box['x']/16,y=box['y']/9,width=box['width']/16,height=box['height']/9,zIndex=10,label=name,requiredClueIds=[]))
    return value

# Every descriptive document is readable through inspect; tiny scene lettering is never the sole clue.
item('timetable','Lịch bàn giao đêm','hall','timetable',(710,471,82,52),'Chuyến bàn giao hàng cuối trước nửa đêm chạy lúc 23:40. Dòng quy ước của hộp trực: dùng giờ của chuyến bàn giao cuối, theo HHMM, bỏ dấu hai chấm. Tàu khách số 7 đi lúc 00:15 là chuyến khác; không dùng giờ đó làm mã.','Quy ước hộp trực: giờ bàn giao cuối')
item('telegram-top','Nửa đầu điện tín','hall','telegram-top',(845,470,69,42),'Mảnh giấy có đầu dòng BẢN NHÁP TẠI GA và phần lệnh ngừng giao hồ sơ. Mép dưới bị xé; phần định tuyến và dấu truyền không còn. Giữ lại để tìm nửa khớp.','Nửa đầu bản nháp',collectible=True,evidence=False)
item('intake','Sổ tiếp nhận kiện','hall','ledger',(965,472,88,54),'21:50, Hạnh nhận hồ sơ kiểm định cầu từ đoàn kỹ sư và niêm vào hòm gỗ: dải xanh chéo, hai đai đồng, một vết khuyết tam giác trên góc nắp. Sổ mô tả đây là kiện duy nhất trong ga có đủ ba dấu ấy. Hồ sơ gồm bản kiểm định có chữ ký gốc, phụ lục thanh toán và thư gửi thanh tra.','Hồ sơ và dấu nhận dạng riêng',critical=True)
item('telegram-bottom','Nửa cuối điện tín','dispatch','telegram-bottom',(780,461,69,42),'Nửa giấy còn dòng: chuyển kiện sang khu tập kết, chờ xe tay ra bến; ô MÃ NHẬN ĐƯỜNG DÂY để trống. Mép xé khớp mảnh tìm ở sảnh. Ghép đủ để đọc trọn yêu cầu chuyển hàng và đối chiếu ô mã truyền với nhãn bản nháp.','Nửa cuối bản nháp',collectible=True,evidence=False)
item('sync','Nhật ký đối giờ','dispatch','ledger',(924,463,92,60),'Trạm chuẩn đường sắt gửi mốc 22:30; nhân viên trực đầu xa ghi 22:30, còn đồng hồ sảnh Lạc Hải chỉ 22:18. Bản giấy có mã kiểm tra và chữ ký hai đầu, không do Hạnh hay An tự xác nhận. Ghi chú sau đó: đồng hồ sảnh chạy chậm đều 12 phút, đã đặt đúng lúc 22:45. Chiếc đồng hồ trong cảnh hiện tại vì thế không còn giữ giờ sai của lời kể.','22:30 giờ chuẩn = 22:18 ở sảnh',critical=True)
item('duty-box','Hộp trực khóa bốn số','dispatch','codebox',(231,447,116,86),'Hộp giữ chìa ngăn điều vận và cuống xuất kho. Mã tuân theo giờ chuyến bàn giao hàng cuối, dạng HHMM như lịch ở sảnh.',mechanism=True)
item('telegram','Bản nháp đã ghép',None,'telegram-full',None,'Bản đầy đủ là lệnh soạn ngay tại ga, chưa có mã tiếp nhận từ đường dây. Lệnh dự kiến ngừng giao hồ sơ kiểm định và chuyển nó qua khu tập kết sang bến sông. Giấy này cho hướng điều tra, chưa chứng minh ai ra lệnh.',collectible=True)
item('warehouse-key','Chìa ngăn điều vận',None,'key',None,'Chìa đồng thẻ bánh răng, lấy từ hộp trực. Chỉ mở ngăn điều vận trong kho; người giữ chìa không mặc nhiên là người lấy hồ sơ.',collectible=True)
item('dispatch-cabinet','Ngăn điều vận khóa chìa','warehouse','keyedbox',(272,501,110,86),'Ổ khóa có dấu bánh răng khớp thẻ chìa trong hộp trực. Ngăn chứa phiếu giao hàng và bản kê nhiệm vụ xe tay.',mechanism=True)
item('route-rule','Thẻ quy ước tủ tuyến','warehouse','routecard',(723,502,88,52),'Tủ lưu bản điều chỉnh, tra theo ba mục: CA → ĐƯỜNG ĐI → ĐƠN VỊ NHẬN THEO HỒ SƠ GỐC. Ô thứ ba là mã phân loại hồ sơ, không xác nhận người thực nhận sau khi sửa lệnh. TRĂNG là ca đêm; SÓNG là bến sông; SAO là đoàn thanh tra; BÁNH RĂNG là xưởng sửa. Phiếu điều vận yêu cầu ca đêm, qua bến sông, hồ sơ dành cho thanh tra. Chọn đúng ba ký hiệu để mở ngăn lưu tuyến.','Quy ước ca – đường – người nhận')
item('route-box','Tủ tuyến ba ký hiệu','warehouse','symbolbox',(890,505,124,92),'Ba ô trên mặt tủ lần lượt là ca, đường đi và đơn vị nhận theo hồ sơ gốc; không phải nơi nhận sau khi điều chỉnh. Cần thẻ quy ước và ảnh nhận dạng kiện để chọn tuyến đúng, không suy từ màu áo của một nhân viên.',mechanism=True)
item('porter-fee','Phiếu công xe tay','warehouse','receipt',(1010,507,62,38),'Phiếu công có đóng dấu thu ngân: Nghi được thêm tiền cho ca chờ hàng sau nửa đêm, mức cố định áp dụng cho tất cả người trực. Đây là khoản đã ghi vào bảng lương, không phải tiền mặt không rõ nguồn. Nó giải thích khoản tiền đáng ngờ, không chứng minh mọi hành động của ông đều vô can.','Tiền công thêm có chứng từ',red=True)
item('trunk-key','Chìa rương chứng từ',None,'key',None,'Chìa thẻ ngôi sao trong tủ tuyến. Kẹp theo phiếu báo: rương chứng từ ở sân tập kết chờ xe tay lúc 00:05; chưa được phép đưa ra bến nếu thiếu chữ ký bàn giao.',collectible=True)
item('filing-rule','Quy trình lưu phiếu tín hiệu','signal','ledger',(740,503,84,54),'Ngăn nhật ký dùng bốn thẻ công việc theo đúng trình tự lưu hồ sơ: NHẬN PHIẾU → ĐỐI GIỜ → KIỂM SỐ → LƯU SỔ. Chỉ là thứ tự sắp chứng từ, không điều khiển đường ray hay tín hiệu đang hoạt động. Sau khi nhập đủ, ngăn lộ cuộn điện đến đã niêm lưu.','Thứ tự lưu chứng từ bốn bước')
item('service-card','Phiếu công tác của An','signal','receipt',(875,500,76,44),'Tổ điện ký đối chứng An có mặt trong buồng trực từ 22:25 đến 22:38 để chỉnh cơ cấu đồng hồ, chưa ghi đủ phiếu xin phép. Nó giải thích việc giấu sửa chữa; không cấp cho An một ngoại phạm cho cả đêm và không tự chứng minh ai đã lấy hồ sơ.','Một việc sửa ngoài lịch',red=True)
item('incoming-box','Ngăn lưu điện đến','signal','sequencebox',(1015,504,119,89),'Bốn nút mang tên các bước lưu chứng từ. Dùng trình tự trong quy trình, không nhập thứ tự các giờ xuất hiện trong lời khai.',mechanism=True)
item('commission','Sổ thanh toán vật tư','archive','ledger',(676,501,93,58),'Ba khoản hoa hồng từ nhà cung cấp Hưng Phát đi vào tài khoản đứng tên Trần Tường Vy; tờ xác nhận chủ tài khoản có dấu ngân hàng. Phụ lục kiểm định cầu yêu cầu đối soát chính ba khoản này vào sáng mai. Nếu hồ sơ gốc không tới thanh tra, Vy có thêm thời gian che khoản hưởng lợi; đây là động cơ cụ thể, không chỉ một khoản nợ chung chung.','Vy hưởng lợi từ khoản sẽ bị kiểm tra',critical=True)
item('carbon','Tờ giấy lót có vết hằn','archive','carbon',(805,500,77,44),'Giấy lót dưới tập lệnh điều vận có vết bút hằn nhưng quá nhạt. Dùng ruột chì mềm quét nhẹ lên mặt sau để đọc; cần giữ cả giấy và dụng cụ trong túi đồ.','Vết hằn chưa đọc được',collectible=True,evidence=False)
item('pencil','Bút chì mềm','archive','pencil',(900,495,65,30),'Bút chì mềm dùng sao vết hằn. Ghép với giấy lót trong túi đồ; việc này chỉ làm nổi nét đã có, không tạo thêm chữ mới.','Dụng cụ sao vết hằn',collectible=True,evidence=False)
item('custody','Sổ bàn giao hồ sơ gốc','archive','ledger',(1000,504,88,57),'22:30 giờ chuẩn đường sắt, Trần Tường Vy ký nhận hòm hồ sơ từ Hạnh. Hạnh ký đối chứng và ghi rõ nhìn thấy Vy nhận trực tiếp; cùng trang có mẫu chữ ký đã xác nhận trong ca. Người nhận có quyền tiếp cận từ 22:30, nhưng riêng quyền tiếp cận chưa đủ chứng minh đã đổi tuyến.','Vy nhận trực tiếp lúc 22:30',critical=True)
item('rubbing','Bản sao vết hằn',None,'rubbing',None,'Nét hằn ghi một lệnh thay đơn vị nhận: từ thanh tra cầu sang kho tư Hưng Phát tại bến sông, gắn đúng số kiện và mã hồ sơ gốc. Vết sửa nằm trên giấy lót còn kẹp trong tập điều vận của Vy. Phải đối chiếu bản lệnh gốc và chữ ký trước khi kết luận người thực hiện.',collectible=True)
item('freight-trunk','Rương chứng từ ở sân tập kết','platform','trunk',(1300,550,146,108),'Rương sắt giữ túi chứng từ và hồ sơ lấy từ hòm gỗ dải xanh. Thẻ ngôi sao khớp chìa tủ tuyến. Xe tay chưa được nhận rương vì chuyến ra bến hẹn 00:05 vẫn chưa tới giờ.',mechanism=True)
item('holding-log','Sổ giữ hàng trước cổng','platform','ledger',(793,505,92,60),'23:05, trưởng ca giữ lại toàn bộ lô kiểm định tại sân có mái che để chờ xác minh. Xe tay đi bến được hẹn 00:05; không có chữ ký xuất cổng. Vì thế đường đi dự kiến ra bến không mâu thuẫn với việc hồ sơ vẫn ở ga. Nghi ký vị trí rương, nhân viên cổng ký xác nhận chưa cho hàng đi.','Hàng chưa rời ga',critical=True)

# Additional acquisition sources are explicit; no reward is silently granted by two mechanics.
clue('draft','Bản nháp hủy giao nhận tại ga',items['telegram']['inspectText'],'dispatch',ident('interaction','restore-telegram'),'interaction',critical=True)
clue('internal-transfer','Cuống xuất kho lúc 22:36','22:36 giờ chuẩn, hòm dải xanh được chuyển nội bộ từ quầy sang kho, không đưa lên chuyến tàu nào. Người thực hiện nhận phiếu điều vận từ phòng điện tín. Chìa ngăn điều vận được kẹp cùng cuống.','dispatch',ident('puzzle','duty-code'),'puzzle',critical=True)
clue('cargo-order','Phiếu điều vận xe tay','Phiếu ghi rõ: sau khi phân tuyến, chuyển hòm kiểm định sang sân có mái che; xe tay chờ lúc 00:05 mới đi bến sông. Bản kho là bản sao chưa có chữ ký người thay nơi nhận; bản gốc phải nằm trong rương chứng từ.','warehouse',ident('interaction','open-dispatch'),'interaction',critical=True)
clue('blue-crate','Ảnh hòm có dải xanh','Ảnh ghi đủ dấu nhận dạng của kiện trong sổ tiếp nhận: dải xanh chéo và hai đai đồng trên cùng một hòm ở kho. Vết khuyết ở góc phải giúp đối chiếu nếu nhìn gần. Đây là nhận dạng kiện hàng, không phải nhận dạng thủ phạm.','warehouse',ident('scene','warehouse'),'camera',critical=True)
clue('wharf-route','Tuyến đêm qua bến sông','Ngăn tuyến xác nhận hồ sơ kiểm định được phân sang bến sông thay vì đi cùng tàu số 7. Chìa rương chứng từ có thẻ sao nằm trong ngăn. Phiếu kèm chìa nhắc rương còn ở sân tập kết đến 00:05.','warehouse',ident('puzzle','route-symbols'),'puzzle',critical=True)
clue('open-hatch','Ảnh khoang máy đang hở','Ảnh hiện trường cho thấy nắp bảo dưỡng lệch sang bên và bánh răng lộ rõ; phần máy hiện không được che kín. Ảnh chỉ chứng minh hiện trạng khi chụp, không tự định giờ đã mở và không chứng minh người lấy hồ sơ.','signal',ident('scene','signal'),'camera',critical=True)
clue('message-47','Điện đến 47 là bản tin thời tiết','Cuộn điện đến lưu liên tục, đối chiếu bản lưu đầu gửi: số 47 báo mưa ở nhánh phía bắc; số 48 là kiểm tra đường dây. Không có điện hủy hồ sơ trong khung 21:50–22:45. Vì số 47 mang nội dung khác, không thể gọi nó là điện hủy.','signal',ident('puzzle','filing-sequence'),'puzzle',critical=True)
clue('meeting','Dấu giờ cuộc gọi của Minh','Bản lưu tổng đài và nhân viên trực xác nhận Minh gọi tòa soạn từ phòng chờ phía đông lúc 22:27–22:34. Nó làm yếu giả thuyết Minh trực tiếp nhận hòm ở quầy lúc 22:30; không xóa mọi khả năng đồng phạm. Nội dung cuộc gọi bàn bảo vệ danh tính một nguồn tin.','signal',ident('puzzle','filing-sequence'),'puzzle',red=True)
clue('altered-order','Vết đổi người nhận trên lệnh',items['rubbing']['inspectText'],'archive',ident('interaction','rub-order'),'interaction',critical=True)
clue('signed-order','Lệnh gốc đổi nơi nhận có ký chứng','Lệnh gốc số 19 đổi nơi nhận hồ sơ kiểm định sang kho tư Hưng Phát ở bến sông. Trần Tường Vy ký, Hạnh ký chứng thực đã nhìn thấy Vy ký; mẫu chữ ký trên sổ ca khớp. Nội dung trùng vết hằn, số kiện trùng sổ tiếp nhận. Đây là hành vi thay tuyến được xác lập, không chỉ quyền giữ chìa.','platform',ident('interaction','open-trunk'),'interaction',critical=True)
clue('original-report','Hồ sơ kiểm định gốc được giữ lại','Túi trong rương có bản kiểm định ký gốc và phụ lục yêu cầu thanh tra đối soát ba khoản hoa hồng Hưng Phát. Các số trang liên tục khớp biên bản 21:50. Trưởng ca niêm giữ rương sau khi hai thám tử lập biên bản; không có tài liệu được đưa ra bến.','platform',ident('interaction','open-trunk'),'interaction',critical=True)

def interaction(key,kind,target,requires,reward_items,reward_clues,required_clues=(),consume=(),message=''):
    d['interactions'].append(dict(interactionId=ident('interaction',key),type=kind,targetId=ident('item',target) if target else '',
        requiredItemIds=ids('item',requires),requiredClueIds=ids('ev',required_clues),unlockItemIds=ids('item',reward_items),unlockClueIds=ids('ev',reward_clues),
        consumeItemIds=ids('item',consume),unlockSceneIds=[],singleUse=True,successMessage=message,failureMessage='Các vật này chưa đáp ứng cách sử dụng. Đọc mô tả mục tiêu và kiểm tra chứng cứ cần có trước.'))
interaction('restore-telegram','COMBINE_ITEMS','',['telegram-top','telegram-bottom'],['telegram'],['draft'],['telegram-top','telegram-bottom'],['telegram-top','telegram-bottom'],'Hai mép khớp: đây là bản nháp tại ga, chưa có mã điện đến. Lệnh dự kiến đổi đường đi của hồ sơ.')
interaction('open-dispatch','USE_ITEM_ON_TARGET','dispatch-cabinet',['warehouse-key'],[],['cargo-order'],message='Chìa mở ngăn điều vận: lô hàng phải chờ ở sân tập kết đến 00:05 mới giao xe tay ra bến.')
interaction('rub-order','COMBINE_ITEMS','',['carbon','pencil'],['rubbing'],['altered-order'],['carbon','pencil'],['carbon'],'Vết hằn hiện dòng sửa người nhận sang kho tư Hưng Phát. Bút chì được giữ lại; bản sao cần đối chiếu lệnh gốc.')
interaction('open-trunk','USE_ITEM_ON_TARGET','freight-trunk',['trunk-key'],[],['signed-order','original-report'],['holding-log'],message='Trong rương là lệnh đổi nơi nhận có ký chứng và hồ sơ kiểm định gốc. Người trực niêm giữ lại toàn bộ để chờ hai thám tử kết luận.')

def puzzle(key,kind,target,prompt,options,answer,required,reward_clues,reward_items=()):
    d['puzzles'].append(dict(puzzleId=ident('puzzle',key),type=kind,targetId=ident('item',target),prompt=prompt,options=options,
        correctCode=answer if kind=='CODE_PUZZLE' else '',correctSequence=[] if kind=='CODE_PUZZLE' else answer,
        requiredItemIds=[],requiredClueIds=ids('ev',required),unlockItemIds=ids('item',reward_items),unlockClueIds=ids('ev',reward_clues),unlockSceneIds=[],
        successMessage='Ngăn lưu đã mở. Chứng từ bên trong bổ sung một phần đường đi của hồ sơ.',failureMessage='Chưa đúng quy ước. Xem lại tài liệu hướng dẫn, xóa lựa chọn rồi thử lại.',
        progressionRole='REQUIRED',investigationPurpose=prompt))
puzzle('duty-code','CODE_PUZZLE','duty-box','Nhập giờ HHMM của chuyến bàn giao HÀNG cuối trước nửa đêm; đọc lịch ở sảnh, phân biệt với tàu khách số 7.',[],'2340',['timetable'],['internal-transfer'],['warehouse-key'])
puzzle('route-symbols','SYMBOL_MATCH_PUZZLE','route-box','Chọn CA → ĐƯỜNG ĐI → NGƯỜI NHẬN của kiện kiểm định theo thẻ quy ước và phiếu điều vận.',['TRĂNG','SÓNG','SAO','BÁNH RĂNG'],['TRĂNG','SÓNG','SAO'],['route-rule','cargo-order','blue-crate'],['wharf-route'],['trunk-key'])
puzzle('filing-sequence','SEQUENCE_PUZZLE','incoming-box','Sắp bốn bước lưu chứng từ theo quy trình; đây là ngăn hồ sơ đã ngắt khỏi thiết bị điều khiển.',['KIỂM SỐ','LƯU SỔ','NHẬN PHIẾU','ĐỐI GIỜ'],['NHẬN PHIẾU','ĐỐI GIỜ','KIỂM SỐ','LƯU SỔ'],['filing-rule'],['message-47','meeting'])

def dialogue(key,character,scene,question,answer,required=(),fragments=()):
    value=dict(dialogueId=ident('dlg',key),characterId=ident('char',character),question=question,answer=answer,requiredClueIds=ids('ev',required),unlockClueIds=[],availableSceneIds=[ident('scene',scene)])
    d['dialogues'].append(value);dialogues[key]=value
    for index,text in enumerate(fragments):
        d['testimonyFragments'].append(dict(id=ident('fragment',key+'-'+str(index+1)),dialogueId=value['dialogueId'],text=text))

time_fragments=['22:18 tôi kể là giờ chuẩn đường sắt.','Tôi nhìn đồng hồ sảnh ngay khi chuông xe hàng vang.','Tôi đứng tại quầy vé lúc đó.']
dialogue('hanh-time','hanh','hall','Chị xác định lúc bàn giao quyền giữ hòm bằng cách nào?',
    '22:18 tôi kể là giờ chuẩn đường sắt. Tôi nhìn đồng hồ sảnh ngay khi chuông xe hàng vang. Tôi đứng tại quầy vé lúc đó. Người chuyển hàng chỉ vào lấy sau khi có phiếu. Tôi không mang đồng hồ riêng, nhưng vẫn nghĩ chiếc đồng hồ lớn của ga phải đúng.',fragments=time_fragments)
dialogue('vy-first','vy','hall','Vì sao hồ sơ này phải lên chuyến số 7?',
    'Thanh tra cầu chờ bản ký gốc sáng mai. Bản sao đủ cho công việc trong ga nhưng không thay được hồ sơ kiểm định. Tôi được giao điều phối, còn Hạnh giữ sổ và Nghi chuyển kiện. Tin điện hủy đến khiến tôi yêu cầu mọi người bình tĩnh. Xin kiểm tra giấy tờ trước khi làm chậm cả nhà ga.')
dialogue('an-duty','an','dispatch','Vì sao nhật ký điện và đồng hồ sảnh cần đối chiếu?',
    'Đường dây dùng giờ chuẩn từ trạm xa; đồng hồ sảnh là máy cơ tại ga. Hai nguồn không phải lúc nào cũng trùng. Tôi phụ trách bảo dưỡng nhưng giấy công tác nằm ở buồng trực. Hộp trực dùng quy ước lịch bàn giao, không dùng giờ trên chiếc đồng hồ lúc anh chị đang nhìn.',required=['intake'])
dialogue('hanh-correct','hanh','dispatch','Sau khi đối giờ, chị muốn sửa điều gì trong lời kể?',
    'Tôi sửa lại: chuông xe hàng vang lúc 22:30 giờ chuẩn. 22:18 chỉ là số trên mặt đồng hồ sảnh khi ấy. Việc tôi đứng tại quầy không đổi; phần tôi đã nói chắc quá là gọi giờ đó là giờ chuẩn. Phiếu ký nhận chi tiết nằm trong lưu trữ kế toán.',required=['reveal-time'])
dialogue('nghi-cargo','nghi','warehouse','Ông đã chuyển kiện nào và tiền công thêm ở đâu ra?',
    'Tôi chuyển hòm dải xanh theo phiếu từ phòng điện tín, rồi chờ phân tuyến. Tiền ca muộn có phiếu thu ngân, không có người lạ dúi cho tôi. Công việc của tôi là chuyển kiện, chưa phải giao ra ngoài cổng. Nếu muốn biết ai đổi người nhận, hãy tìm lệnh gốc, đừng suy từ người đẩy xe.',required=['gate-act1'])
telegram_fragments=['Điện đến số 47 hủy việc giao hồ sơ.','Tôi nghe thông báo hủy từ phòng điều hành.','Tôi chưa đọc bản ký gốc của hồ sơ cầu.']
dialogue('minh-telegram','minh','warehouse','Anh dựa vào đâu để nói thanh tra đã hủy nhận hồ sơ?',
    'Điện đến số 47 hủy việc giao hồ sơ. Tôi nghe thông báo hủy từ phòng điều hành. Tôi chưa đọc bản ký gốc của hồ sơ cầu. Có người yêu cầu tôi chưa đăng báo trong đêm; tôi tưởng số điện đã đủ để xác nhận tin. Tôi không muốn kéo nguồn tin của mình vào chuyện này.',required=['gate-act1'],fragments=telegram_fragments)
hatch_fragments=['Phần máy đồng hồ hiện vẫn được nắp che kín.','Tôi phụ trách bảo dưỡng đồng hồ của ga.','Phiếu công tác có thể lập chậm sau ca.']
dialogue('an-hatch','an','signal','Anh có thể nói rõ tình trạng máy và ca bảo dưỡng không?',
    'Phần máy đồng hồ hiện vẫn được nắp che kín. Tôi phụ trách bảo dưỡng đồng hồ của ga. Phiếu công tác có thể lập chậm sau ca. Tôi hiểu anh chị đang tìm một người sửa giờ để giấu việc lấy kiện, nhưng hai việc ấy không nhất thiết là một.',required=['wharf-route'],fragments=hatch_fragments)
dialogue('minh-source','minh','signal','Điện 47 là thời tiết; nguồn thông báo hủy là ai?',
    'Tường Vy đọc số 47 cho tôi. Tôi đã biến lời truyền đạt thành điều chắc chắn mà chưa xem sổ. Nguồn tin tôi gặp là người báo sai lệch vật tư, không phải người bảo tôi lấy hồ sơ. Dấu tổng đài chỉ kiểm tra được lúc tôi gọi báo, không tự miễn cho tôi mọi nghi ngờ.',required=['reveal-telegram'])
dialogue('an-admit','an','signal','Ảnh thấy bánh răng lộ ra; anh đã làm gì?',
    'Tôi đã mở nắp và sửa máy mà chưa đủ phiếu xin phép. Tôi sợ lại bị đình ca. Nhật ký đầu xa mới xác định được 22:30 tương ứng 22:18 ở sảnh; tôi không thể dùng lời mình để tự xác nhận. Tôi chỉnh đúng lúc 22:45, còn lệnh đổi hồ sơ không do tôi soạn.',required=['reveal-hatch'])
vy_fragments=['Tôi chưa từng ký lệnh đưa hồ sơ ra bến sông.','Tôi được phân công điều phối hồ sơ kiểm định.','Sổ giao nhận phải có người ký đối chứng.']
dialogue('vy-denial','vy','archive','Ai có quyền thay nơi nhận, và bà có ký lệnh đó không?',
    'Tôi chưa từng ký lệnh đưa hồ sơ ra bến sông. Tôi được phân công điều phối hồ sơ kiểm định. Sổ giao nhận phải có người ký đối chứng. Việc tôi ký nhận giữ hộ không có nghĩa tôi thay tuyến. Một bản hằn trên giấy lót cũng cần so với lệnh gốc, anh chị chắc hiểu điều đó.',required=['gate-act2'],fragments=vy_fragments)
dialogue('hanh-custody','hanh','archive','Chữ ký đối chứng của chị trên sổ xác nhận điều gì?',
    'Tôi tận mắt thấy Vy ký nhận hòm lúc 22:30 giờ chuẩn ghi từ trạm điện. Tôi cũng chứng kiến chữ ký trên lệnh điều vận số 19 rồi đặt lệnh vào túi chứng từ; lúc đó tôi chỉ kiểm số kiện, không nhận ra tên người nhận đã bị sửa. Hãy lấy bản gốc ra đối chiếu, đừng chỉ dựa vào trí nhớ của tôi.',required=['custody'])
dialogue('nghi-hold','nghi','platform','Vì sao hàng đi bến mà vẫn ở sân ga?',
    '00:05 xe tay mới nhận hàng. 23:05 trưởng ca giữ cả lô ở đây, có nhân viên cổng ký. Theo phiếu đóng kiện, hồ sơ và túi chứng từ được chuyển từ hòm gỗ sang rương sắt trước mặt hai người kiểm hàng; số niêm túi giữ nguyên. Tôi chưa ký giao ra cổng. Cái hòm lớn vẫn ở kho, nhưng bản gốc ở rương này.',required=['holding-log'])
dialogue('vy-last','vy','platform','Bản lệnh có ký chứng đã xuất hiện. Bà còn muốn đính chính gì?',
    'Tôi không còn phủ nhận chữ ký trên lệnh số 19. Tôi muốn chặn hồ sơ trước buổi đối soát. Nhưng kết luận của anh chị phải nối được cả khoản hưởng lợi, lệnh đổi nơi nhận và lúc tôi giữ hồ sơ. Đừng đổ việc tôi làm sang người sửa đồng hồ hay người chỉ chuyển kiện.',required=['reveal-vy'])

def confrontation(key,order,dialogue_key,correct,candidates,required,reveal,title,text):
    fragment_ids=[ident('fragment',dialogue_key+'-'+str(i)) for i in [1,2,3]]
    d['evidenceChallenges'].append(dict(challengeId=ident('challenge',key),order=order,isSignature=order==4,dialogueId=ident('dlg',dialogue_key),
        testimonyFragmentId=fragment_ids[0],candidateTestimonyFragmentIds=fragment_ids,startRequiredTestimonyFragmentIds=fragment_ids[:2],
        prompt=title,correctEvidenceId=ident('ev',correct),candidateEvidenceIds=ids('ev',candidates),startRequiredEvidenceIds=ids('ev',required),
        successResponse=text,failureResponse='Cặp này chưa bác đúng mệnh đề. Chọn chứng cứ trực tiếp kiểm tra nội dung câu nói, không chỉ làm người nói đáng ngờ.',revealTitle=title.upper(),unlockClueIds=[ident('ev',reveal)]))
    scene={'time':'dispatch','telegram':'signal','hatch':'signal','vy':'platform'}[key]
    clue(reveal,title,text,scene,ident('dlg',dialogue_key),'dialogue',evidence=False,critical=True)
confrontation('time',1,'hanh-time','sync',['sync','intake','timetable'],['sync','intake'],'reveal-time','Mười hai phút bị bỏ quên','Nhật ký chuẩn bác đúng việc gọi 22:18 là giờ đường sắt. Hạnh vẫn có thể nhớ đúng tiếng chuông và vị trí đứng; phải sửa mốc giờ, không xóa sạch lời cô.')
confrontation('telegram',2,'minh-telegram','message-47',['message-47','wharf-route','cargo-order'],['message-47','wharf-route'],'reveal-telegram','Số điện đúng, nội dung sai','Điện đến 47 là thời tiết. Minh thừa nhận chưa tự đọc nó và đã lặp lời thông báo của Vy. Bản nháp tại ga không biến thành chỉ thị của thanh tra chỉ vì có một số điện được nhắc tới.')
confrontation('hatch',3,'an-hatch','open-hatch',['open-hatch','service-card','internal-transfer'],['open-hatch','service-card'],'reveal-hatch','Một lỗi sửa chữa, một vụ chuyển hồ sơ','Ảnh bác câu phần máy hiện còn che kín. An nhận đã mở máy ngoài lịch; thời gian sửa cần đối chiếu phiếu công tác và nhật ký chuẩn. Việc nói dối này chưa đủ quy anh là người lấy hồ sơ.')
confrontation('vy',4,'vy-denial','signed-order',['signed-order','commission','custody'],['signed-order','custody'],'reveal-vy','Người thay nơi nhận','Lệnh gốc, chữ ký có đối chứng và số kiện khớp nhau bác lời Vy chưa từng ký đưa hồ sơ ra bến. Hai người đã xác lập hành vi đổi tuyến, cần ghép tiếp động cơ và quyền tiếp cận để hoàn tất cáo buộc.')

def deduction(key,prompt,required,challenge_keys,options,correct,reward,success):
    did=ident('deduction',key)
    d['deductions'].append(dict(deductionId=did,prompt=prompt,requiredClueIds=ids('ev',required),requiredChallengeIds=ids('challenge',challenge_keys),
        options=[dict(id=ident('option',key+'-'+str(i)),label=label) for i,label in enumerate(options)],correctOptionId=ident('option',key+'-'+str(correct)),
        successResponse=success,failureResponse='Giả thuyết chưa giải thích đủ các nguồn độc lập. Phân biệt điều đã được xác lập với điều mới chỉ nghi ngờ.',unlockClueIds=[ident('ev',reward)]))
    clue(reward,prompt,success,{'act1':'dispatch','act2':'signal','act3':'platform'}[key],did,'deduction',evidence=False,critical=True)
deduction('act1','Hồ sơ biến mất khi nào, theo đường nào?',
    ['sync','internal-transfer','draft','reveal-time'],['time'],
    ['Hồ sơ đã rời ga lúc 22:18 vì đồng hồ lớn luôn đúng.','Mốc đúng là 22:30; kiện còn được chuyển nội bộ lúc 22:36, nên cần kiểm kho và lệnh tại ga.','Ai sửa đồng hồ thì chắc chắn là người lấy hồ sơ.'],1,'gate-act1',
    'Hai thám tử thống nhất mốc giờ chuẩn và đường chuyển nội bộ. Trưởng ca mở kho hành lý cho kiểm tra, giữ nguyên hiện trường buồng trực để đối chiếu sau.')
deduction('act2','Hai lời nói dối có cùng chứng minh một thủ phạm không?',
    ['gate-act1','wharf-route','blue-crate','message-47','reveal-telegram','reveal-hatch'],['telegram','hatch'],
    ['An giấu sửa đồng hồ nên không cần xem thêm lệnh điều vận.','Minh nói sai số điện nên chắc chắn tự chuyển kiện ra bến.','An giấu một lần sửa máy; điện hủy không đến từ trạm ngoài. Kiện vẫn ở ga theo tuyến bị đổi, cần kiểm người hưởng lợi và người ký lệnh.'],2,'gate-act2',
    'Hai việc được tách rõ: lỗi giờ gây nhầm thời gian, còn lệnh nội bộ đổi hướng hồ sơ. Trưởng ca cho đối soát sổ tài chính và giữ xe hàng tại sân tập kết; cuộc điều tra bước vào người nhận cuối cùng.')
deduction('act3','Chuỗi nào giải thích đủ động cơ, hành vi và cơ hội?',
    ['gate-act1','gate-act2','commission','altered-order','custody','signed-order','original-report','holding-log','reveal-vy'],['vy'],
    ['Vy nhận hồ sơ lúc 22:30, đổi nơi nhận bằng lệnh số 19 để trì hoãn việc lộ hoa hồng; hồ sơ bị giữ lại trước chuyến xe ra bến.','Nghi có tiền công thêm nên đã tự soạn điện hủy và giả mọi chữ ký.','Toàn bộ chỉ là lỗi đồng hồ; không có ai thay nơi nhận.'],0,'gate-act3',
    'Hồ sơ gốc, lệnh có ký chứng và chứng từ thanh toán nối thành cùng một chuỗi. Việc sửa máy và tiền công hợp lệ không thay thế bằng chứng về hành vi của Vy. Hai thám tử đủ căn cứ lập cáo buộc chung.')
for key,ev,challenge_key,dedkey in [('clock','sync','time','act1'),('wire','message-47','telegram','act2'),('photo','open-hatch','hatch','act2'),('order','signed-order','vy','act3')]:
    d['requiredTeamworkChains'].append(dict(chainId=ident('chain',key),investigatorClueId=ident('ev',ev),interrogatorChallengeId=ident('challenge',challenge_key),deductionId=ident('deduction',dedkey),description='Vật chứng riêng của điều tra viên phải ghép đúng lời khai riêng của thẩm vấn viên, được cả hai xác nhận rồi sử dụng trong suy luận.'))

topics={
 'hanh': [('Một ký ức đúng có thể mang giờ sai không?',[], 'Tôi nhớ tiếng chuông xe hàng và người ra vào, nhưng con số giờ lấy từ mặt đồng hồ. Nếu nguồn giờ sai, không thể vì thế bảo tất cả điều tôi thấy đều sai. Anh chị cần so đúng phần có thể kiểm chứng.'),
          ('Ký nhận khác ký lệnh như thế nào?',['custody'],'Sổ ký nhận xác nhận người cầm hòm. Lệnh điều vận xác nhận người yêu cầu đưa nó đi đâu. Tôi ký đối chứng hai việc ấy ở hai tờ khác nhau. Ghép chúng với số kiện sẽ tránh lấy quyền tiếp cận thay cho bằng chứng hành vi.')],
 'vy': [('Vì sao cần bản gốc thay vì bản sao?',[],'Bản gốc có chữ ký đoàn kiểm định và phụ lục niêm cùng bộ. Sáng mai thanh tra đối soát ngay với chứng từ mua vật tư. Bản sao ở ga có thể cho biết nội dung, nhưng không đủ thay cuộc bàn giao chính thức.'),
        ('Khoản hoa hồng có liên quan gì tới hồ sơ?',['commission'],'Một khoản tiền có thể có nhiều cách giải thích. Anh chị cần chứng minh nó vào đúng tài khoản của tôi, do đúng nhà cung cấp trả và sẽ bị cuộc kiểm định này xem xét. Sổ và xác nhận ngân hàng mới trả lời được, không phải màu áo hay chức vụ.')],
 'an': [('Máy cơ và giờ đường dây khác nhau ở đâu?',[],'Đồng hồ cơ có thể chạy lệch. Mốc giờ điện đến được ghi cả ở trạm xa và ở đây, nên phải tìm nguồn độc lập. Tôi là người có lý do giấu việc sửa; dùng mỗi lời tôi để chứng minh tôi nói thật sẽ thành vòng tròn.'),
        ('Một lỗi bảo dưỡng có đủ kết tội trộm hồ sơ?',['reveal-hatch'],'Không. Nó giải thích được phần giờ sai và lời tôi né tránh, chứ không giải thích ai ký đổi người nhận hoặc ai hưởng lợi từ việc giữ hồ sơ. Tôi chịu trách nhiệm về bảo dưỡng ngoài lịch; phần vụ án còn lại hãy để giấy tờ trả lời.')],
 'minh': [('Giữ bí mật nguồn tin khác xác minh tin ra sao?',[],'Tôi có thể không nêu tên người báo tin cho mình, nhưng vẫn phải kiểm nội dung trước khi coi đó là sự thật. Một số điện đọc qua miệng người khác chưa phải bản điện gốc. Trong đêm vội, tôi đã quên ranh giới ấy.'),
          ('Dấu tổng đài có gỡ hết nghi ngờ không?',['meeting'],'Nó chỉ đặt tôi ở một nơi trong một quãng cụ thể. Nó không biết tôi nói gì trước đó, giúp ai sau đó hay có nhận lợi ích gì không. Nếu anh chị loại được một hành động trực tiếp, hãy chỉ ghi đúng hành động đó được loại.')],
 'nghi': [('Nhìn hòm bằng dấu gì để khỏi lẫn?',[],'Màu xanh riêng lẻ chưa đủ. Sổ còn tả hai đai đồng, và cả kho chỉ có một hòm kiểm định ghép đúng hai dấu ấy. Chụp được hiện trạng rồi so sổ sẽ vững hơn việc tôi chỉ nói trông giống.'),
          ('Vì sao hồ sơ chuyển sang rương nhỏ?',['holding-log'],'Hòm gỗ là kiện chứa ngoài dùng trong kho. Khi ra sân, tổ đóng kiện cho túi hồ sơ và lệnh gốc vào rương sắt có khóa, ghi vào phiếu kiểm hàng trước mặt hai người. Hòm gỗ không chạy theo rương; số hồ sơ và niêm túi mới nối được hai chặng.')]
}
for char_key,entries in topics.items():
    root_id=ident('node',char_key+'-root')
    available=[s['sceneId'] for s in scenes.values() if ident('char',char_key) in s['characterIds']]
    root=dict(nodeId=root_id,characterId=ident('char',char_key),isRoot=True,requiredClueIds=[],availableSceneIds=available,
              lines=[dict(speaker='NPC',text='Tôi có thể giải thích thêm về phần việc của mình. Anh chị muốn làm rõ điều gì?')],unlockClueIds=[],choices=[])
    for n,(label,req,text) in enumerate(entries):
        key=char_key+'-topic-'+str(n+1); node_id=ident('node',key)
        root['choices'].append(dict(choiceId=ident('choice',key),label=label,requiredClueIds=ids('ev',req),nextNodeId=node_id))
        d['conversationNodes'].append(dict(nodeId=node_id,characterId=ident('char',char_key),isRoot=False,requiredClueIds=ids('ev',req),availableSceneIds=available,
            lines=[dict(speaker='NPC',text=text)],unlockClueIds=[],choices=[dict(choiceId=ident('choice',key+'-back'),label='Quay lại câu chuyện.',requiredClueIds=[],nextNodeId=None)]))
    d['conversationNodes'].append(root)

# Coordinates below follow visual review of the actual 1672x941 generated rooms.
adjusted={'dispatch-cabinet':(415,435),'route-rule':(715,462),'route-box':(885,466),'porter-fee':(1010,471),
          'filing-rule':(710,480),'service-card':(842,480),'incoming-box':(965,485),
          'freight-trunk':(1365,454),'holding-log':(812,442)}
items['trunk-key']['imageUrl']=asset('items','star-key')
for scene in scenes.values():
    for p in scene['runtime']['itemPlacements']:
        key=next(key for key,value in items.items() if value['itemId']==p['itemId'])
        if key in adjusted:
            x,y=adjusted[key];p['position'].update(x=x,y=y)
            w,h=p['size']['width'],p['size']['height']
            p['hotspot']=dict(x=x-w/2-7,y=y-h-3,width=w+14,height=h+10)
            hot=next(hot for hot in scene['hotspots'] if hot['targetId']==p['itemId'])
            box=p['hotspot'];hot.update(x=box['x']/16,y=box['y']/9,width=box['width']/16,height=box['height']/9)
    # The last platform bench is entirely behind the walking lane.
    if scene['sceneId']==ident('scene','platform'): scene['runtime']['navigationObstacles']=[]
for key,ev,label,box,reason in [
    ('warehouse','blue-crate','Dải xanh và hai đai đồng',dict(x=1270,y=344,width=220,height=220),'Observed in generated warehouse: blue diagonal stripe across front between two brass bands, at right rear of room.'),
    ('signal','open-hatch','Khoang bánh răng đang hở',dict(x=314,y=266,width=171,height=150),'Observed in generated signal cabin: open left-hinged hatch and exposed gears under the round clock, left wall.')]:
    scenes[key]['runtime']['clueZones'].append(dict(clueId=ident('ev',ev),label=label,bounds=box,shape='rect',surface='wall' if key=='signal' else 'crate',visibility='clear',detectionDifficulty='easy',detectionStatus='FOUND',confidence=.95,source='manual-visual-review',isFallback=False,requiredClueIds=[],reason=reason))
    clues[ev].update(visualDescription=label,visualTextPolicy='NO_TEXT')
# Only visible identifying features are asserted: the generated crate has no reliable notch.
for value in [items['intake'],clues['intake'],clues['blue-crate']]:
    for k,v in list(value.items()):
        if isinstance(v,str):
            value[k]=v.replace(', một vết khuyết tam giác trên góc nắp','').replace('ba dấu ấy','hai dấu ấy').replace(' Vết khuyết ở góc phải giúp đối chiếu nếu nhìn gần.','')

requirements={
 'hall':(['timetable','telegram-top','intake'],[],['hanh-time','vy-first']),
 'dispatch':(['telegram-bottom','sync'],['draft','internal-transfer','gate-act1'],['an-duty','hanh-correct']),
 'warehouse':(['route-rule'],['cargo-order','blue-crate','wharf-route'],['nghi-cargo','minh-telegram']),
 'signal':(['filing-rule','service-card'],['message-47','open-hatch','gate-act2'],['an-hatch','an-admit','minh-source']),
 'archive':(['commission','carbon','pencil','custody'],['altered-order'],['vy-denial','hanh-custody']),
 'platform':(['holding-log'],['signed-order','original-report','gate-act3'],['nghi-hold','vy-last'])}
for key,(item_keys,clue_keys,dialogue_keys) in requirements.items():
    scenes[key]['completeCondition'].update(requiredItemIds=ids('item',item_keys),requiredClueIds=ids('ev',clue_keys),requiredDialogueIds=ids('dlg',dialogue_keys))
ordered=list(scenes.values())
for i,scene in enumerate(ordered):
    box=dict(x=1355,y=220,width=105,height=380) if i==1 else dict(x=145,y=220,width=100,height=385)
    # One real doorway may lead to the previous room or along the same corridor.
    neighbors=[]
    if i>0: neighbors.append(ordered[i-1])
    if i+1<len(ordered): neighbors.append(ordered[i+1])
    for n,neighbor in enumerate(neighbors):
        target_box=dict(box,y=box['y']+n*195,height=180) if len(neighbors)>1 else dict(box)
        scene['runtime']['transitions'].append(dict(transitionId=ident('transition',str(i)+'-'+neighbor['sceneId']),targetSceneId=neighbor['sceneId'],label=neighbor['title'],hotspot=target_box,depth=22))

hints={
 'hall':['Hỏi Hạnh nguồn của con số giờ. Lịch tàu khách và lịch bàn giao hàng không phải cùng một lịch.','Giữ nửa điện tín. Đọc quy ước HHMM của chuyến bàn giao hàng cuối: 23:40, khác tàu số 7 lúc 00:15.'],
 'dispatch':['Ghép hai mảnh điện tín; dùng lịch sảnh mở hộp trực. Đối chiếu lời Hạnh với nguồn giờ không do cô hay An tự lập.','Điều tra viên chọn nhật ký 22:30 = 22:18; thẩm vấn viên chọn câu gọi 22:18 là giờ chuẩn. Cả hai xác nhận, làm suy luận hồi I rồi hỏi Hạnh câu vừa mở.'],
 'warehouse':['Chụp hòm dải xanh trước khi mở tủ tuyến. Chìa hộp trực mở ngăn điều vận; phiếu công xe tay có cách kiểm chứng riêng.','Tủ tuyến tra CA → ĐƯỜNG → ĐƠN VỊ NHẬN THEO HỒ SƠ GỐC: đêm, bến sông, thanh tra tương ứng TRĂNG → SÓNG → SAO.'],
 'signal':['Một lời nói dối nói về hiện trạng nắp máy; lời kia nói về nội dung điện số 47. Tìm chứng cứ riêng cho từng câu.','Chụp khoang bánh răng đang hở. Ngăn điện đến dùng NHẬN PHIẾU → ĐỐI GIỜ → KIỂM SỐ → LƯU SỔ. Hoàn tất cả hai đối chất, câu hỏi mới và suy luận hồi II.'],
 'archive':['Quyền cầm hồ sơ, cách sửa lệnh và người hưởng lợi là ba vấn đề riêng. Giấy lót cần một dụng cụ trong phòng để đọc.','Ghép giấy lót với bút chì. Đọc sổ hoa hồng và sổ bàn giao, hỏi Hạnh về ký đối chứng. Lệnh có chữ ký gốc vẫn ở rương sân tập kết.'],
 'platform':['Đọc sổ giữ hàng để giải thích vì sao lô đi bến còn ở ga. Chìa thẻ sao mở rương, nhưng quyền giữ chìa chưa đủ buộc tội.','Đối chất câu Vy chưa ký đưa hồ sơ ra bến bằng lệnh gốc có ký chứng. Hỏi lại Vy, hoàn tất suy luận và gắn đúng động cơ–phương thức–cơ hội khi cả hai cáo buộc.']}
for key,texts in hints.items():
    for order,text in enumerate(texts,1): d['hints'].append(dict(hintId=ident('hint',key+'-'+str(order)),contextType='SCENE',targetId=ident('scene',key),order=order,text=text))
for challenge in d['evidenceChallenges']:
    d['hints'].append(dict(hintId=challenge['challengeId']+'-hint',contextType='CONFRONTATION',targetId=challenge['challengeId'],order=1,text='Chọn đúng một câu có thể kiểm chứng. Vật chứng về tiền không bác câu về giờ; ảnh hiện trạng không tự xác định ai ký lệnh.'))
for ded in d['deductions']:
    d['hints'].append(dict(hintId=ded['deductionId']+'-hint',contextType='DEDUCTION',targetId=ded['deductionId'],order=1,text='Giữ lại phần lời khai đã được kiểm chứng, sửa đúng phần sai. Phương án đúng phải giải thích tất cả chứng cứ bắt buộc mà không biến sự đáng ngờ thành kết tội.'))

d['finalLogic']=dict(culpritId=ident('char','vy'),motive='Ngăn hồ sơ tới thanh tra để che khoản hoa hồng từ nhà cung cấp Hưng Phát.',method='Dùng thông báo hủy sai làm cớ, ký đổi người nhận trên lệnh điều vận và chuyển hồ sơ sang lô chờ ra bến sông.',requiredEvidenceIds=[],
    motiveOptions=[dict(id=ident('motive','repair'),label='Che việc An sửa đồng hồ ngoài lịch'),dict(id=ident('motive','commission'),label='Che hoa hồng Hưng Phát vào tài khoản của Vy trước buổi kiểm định'),dict(id=ident('motive','porter'),label='Nhận khoản công ca muộn của Nghi')],correctMotiveId=ident('motive','commission'),
    methodOptions=[dict(id=ident('method','order'),label='Đổi nơi nhận bằng lệnh nội bộ giả danh hủy giao, chuyển hồ sơ vào lô chờ ra bến'),dict(id=ident('method','clock'),label='Chỉ sửa đồng hồ là đủ làm hồ sơ tự biến mất'),dict(id=ident('method','outside'),label='Thanh tra thực sự gửi điện 47 hủy nhận, mọi người làm đúng')],correctMethodId=ident('method','order'),
    requiredEvidenceLinks=[dict(claimType=claim,evidenceId=ident('ev',ev)) for claim,ev in [('MOTIVE','commission'),('METHOD','altered-order'),('OPPORTUNITY','custody')]],
    requiredDeductionIds=ids('deduction',['act1','act2','act3']),requiredTeamworkChainIds=[c['chainId'] for c in d['requiredTeamworkChains']],
    winEnding='Lệnh giao ra bến bị đình lại trước 00:05. Hồ sơ gốc được niêm bàn giao cho trưởng đoàn thanh tra trên chuyến số 7. Ba khoản hoa hồng, lệnh đổi nơi nhận có ký chứng và sổ nhận lúc 22:30 cùng quy về Trần Tường Vy; bà thừa nhận muốn trì hoãn cuộc đối soát. An chịu trách nhiệm riêng về sửa máy ngoài lịch. Minh đính chính tin điện hủy và bảo vệ nguồn tin bằng việc kiểm chứng thay vì lặp lời. Hạnh sửa mốc giờ, Nghi nhận lại danh dự trong phạm vi chứng cứ đã làm rõ. Hai thám tử đóng hồ sơ bằng một chuỗi chứng minh chung, không bằng việc chọn người nói dối đầu tiên.',
    failEnding='Cáo buộc chưa nối đúng người hưởng lợi, hành vi thay tuyến và lúc nhận hồ sơ. Việc An giấu sửa máy, Minh lặp tin sai hoặc Nghi có tiền công không thay cho ba liên kết chứng cứ. Hồ sơ vẫn được trưởng ca giữ an toàn, nhưng kết luận buộc tội của hai thám tử chưa được chấp nhận. Xem phần đối chiếu kết quả và mở phòng mới để điều tra lại.')

target=HERE/'case.json'
target.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'file':str(target),'scenes':len(scenes),**{key:len(d[key]) for key in ['stages','characters','items','clues','dialogues','conversationNodes','evidenceChallenges','deductions','puzzles','interactions','hints']}},ensure_ascii=False))
