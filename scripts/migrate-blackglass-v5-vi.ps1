param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
if ($source.caseId -ne 'case-bell-beneath-blackglass') {
    throw "Expected case-bell-beneath-blackglass, got '$($source.caseId)'."
}

function By-Id($values, [string]$property, [string]$id) {
    $match = @($values | Where-Object { $_.$property -eq $id })
    if ($match.Count -ne 1) { throw "Expected one $property '$id', found $($match.Count)." }
    return $match[0]
}

function Set-Text($target, [hashtable]$values) {
    foreach ($entry in $values.GetEnumerator()) {
        $target | Add-Member -MemberType NoteProperty -Name $entry.Key -Value $entry.Value -Force
    }
}

function Structural-Projection($case) {
    return [ordered]@{
        caseId = $case.caseId
        culpritId = $case.finalLogic.culpritId
        stages = @($case.stages | ForEach-Object { [ordered]@{
            stageId = $_.stageId; order = $_.order
            sceneIds = @($_.scenes | ForEach-Object sceneId)
            sceneItems = @($_.scenes | ForEach-Object { [ordered]@{ sceneId = $_.sceneId; ids = @($_.itemIds) } })
            sceneCharacters = @($_.scenes | ForEach-Object { [ordered]@{ sceneId = $_.sceneId; ids = @($_.characterIds) } })
        } })
        characterIds = @($case.characters | ForEach-Object characterId)
        itemIds = @($case.items | ForEach-Object itemId)
        clueIds = @($case.clues | ForEach-Object clueId)
        dialogues = @($case.dialogues | ForEach-Object { [ordered]@{
            id = $_.dialogueId; characterId = $_.characterId
            required = @($_.requiredClueIds); unlock = @($_.unlockClueIds)
        } })
        interactions = @($case.interactions | ForEach-Object { [ordered]@{
            id = $_.interactionId; type = $_.type; targetId = $_.targetId
            items = @($_.requiredItemIds); clues = @($_.requiredClueIds); unlock = @($_.unlockClueIds)
        } })
        puzzles = @($case.puzzles | ForEach-Object { [ordered]@{
            id = $_.puzzleId; type = $_.type; targetId = $_.targetId
            items = @($_.requiredItemIds); clues = @($_.requiredClueIds); unlock = @($_.unlockClueIds)
            correctCode = $_.correctCode; correctSequence = @($_.correctSequence)
        } })
        finalEvidence = @($case.finalLogic.requiredEvidenceIds)
        finalDeductions = @($case.finalLogic.requiredDeductionIds)
        finalChains = @($case.finalLogic.requiredTeamworkChainIds)
        correctMotiveId = $case.finalLogic.correctMotiveId
        correctMethodId = $case.finalLogic.correctMethodId
    }
}

$before = Structural-Projection $source | ConvertTo-Json -Depth 20 -Compress
Set-Text $source @{
    language = 'vi'; art_style = 'pixel_art'; sub_style = 'high_detail_pixel'; character_style = 'chibi'
    title = 'Tiếng Chuông Dưới Blackglass'
    summary = 'Vào đêm trước nhật thực thủy triều ở Veymar, nhà bảo trợ Alaric Vale biến mất khỏi phòng chiếu bị khóa kín của Đài thiên văn Blackglass. SirLocked và cộng sự phải lần theo bộ máy đồng hồ tưởng như bất khả thi, hồ sơ thủy triều mâu thuẫn, lời khai bị chôn vùi và một âm mưu bắt nguồn từ thảm họa năm xưa của đài thiên văn.'
    coverImageUrl = ''
}

$stageText = @{
    'stage-1' = @{ title = 'Chín Mươi Giây Trong Bóng Tối' }
    'stage-2' = @{ title = 'Mệnh Lệnh Của Thủy Triều' }
    'stage-3' = @{ title = 'Mô Hình Dối Trá' }
    'stage-4' = @{ title = 'Xưởng Lantern' }
    'stage-5' = @{ title = 'Cỗ Máy Dưới Tiếng Chuông' }
    'stage-6' = @{ title = 'Lời Giải Của Tiếng Chuông' }
}
$sceneText = @{
    'scene-1' = @{ title = 'Phòng Chiếu'; description = 'Căn phòng niêm kín của Vale chứa một sai lệch đồng hồ được đồng bộ, thiết bị chiếu bị xáo trộn và những nhân chứng đã tranh cãi về điều xảy ra trong lúc mất điện.' }
    'scene-2' = @{ title = 'Kho Lưu Trữ Ngập Nước'; description = 'Khi thủy triều rút, hồ sơ tòa thị chính hé lộ ai có thể thay đổi tuyến đường và tín hiệu của Veymar trong lúc Vale biến mất.' }
    'scene-3' = @{ title = 'Dinh Thự Vale'; description = 'Một mô hình đài thiên văn sai lệch cùng lời khai dè dặt của Mara Vale phơi bày kế hoạch có từ trước vụ biến mất của cha cô.' }
    'scene-4' = @{ title = 'Tầng Quang Học Bỏ Hoang'; description = 'Nhà máy đổ nát nối các cơ cấu của đài thiên văn với tài sản nhà Wren và kỹ thuật bị đánh cắp của một ảo thuật gia.' }
    'scene-5' = @{ title = 'Sảnh Tròn Kỹ Thuật Blackglass'; description = 'Một bàn điều khiển bí mật vận hành phanh đồng hồ, bức tường xoay, hệ thống chiếu và lối xuống hầm dưới của căn phòng.' }
    'scene-6' = @{ title = 'Hầm Chiếu'; description = 'Bên dưới căn phòng, công tác chuẩn bị cuối cùng của kẻ chủ mưu và hồ sơ còn sót lại về vụ bê bối năm xưa đang chờ được tái dựng.' }
}
$transitionLabels = @{
    'transition-scene-1' = 'Phòng Chiếu'; 'transition-scene-2' = 'Kho Lưu Trữ Ngập Nước'
    'transition-scene-3' = 'Dinh Thự Vale'; 'transition-scene-4' = 'Tầng Quang Học Bỏ Hoang'
    'transition-scene-5' = 'Sảnh Tròn Kỹ Thuật Blackglass'; 'transition-scene-6' = 'Hầm Chiếu'
}
foreach ($stage in $source.stages) {
    Set-Text $stage $stageText[$stage.stageId]
    foreach ($scene in $stage.scenes) {
        Set-Text $scene $sceneText[$scene.sceneId]
        $scene.backgroundUrl = ''
        $scene.placementPlan = $null
        $scene.runtime = $null
    }
}

$characterText = @{
    'char-rook' = @{
        role = 'Giám đốc Đài thiên văn Blackglass'; description = 'Một nhà thiên văn lỗi lạc đã tháo một bộ phận đồng hồ trước khi các nhân chứng bị thẩm vấn.'
        visualDescription = 'Middle-aged thin stern man, long angular face, narrow tired eyes, swept-back iron-gray hair, deep teal astronomer coat with brass fasteners, dark waistcoat, ink-stained gloves, distinctive crescent clock-governor pin.'
    }
    'char-mara' = @{
        role = 'Con gái xa cách của Alaric Vale'; description = 'Một nữ sử gia kiến trúc nghiêm nghị từng giúp cha nghiên cứu những không gian không được ghi chép của Blackglass.'
        visualDescription = 'Tall sharp-featured woman in her late thirties, lean upright build, high cheekbones, black hair in a severe braided bun, oxblood historian coat over charcoal field clothes, rolled plans case, distinctive silver drafting compass brooch.'
    }
    'char-flint' = @{
        role = 'Cảng trưởng kiêm điều phối viên nhật thực'; description = 'Người phụ trách cổng thủy triều, đường ven vách đá, tín hiệu cảng và những hồ sơ được cho là bảo mật của chúng.'
        visualDescription = 'Older strong harbor captain, broad shoulders and weathered square face, cropped steel-white hair, sun-darkened skin, navy greatcoat with brass captain bars, heavy sea boots, rope-scarred hands, distinctive tide-gauge whistle.'
    }
    'char-quill' = @{
        role = 'Ảo thuật gia của dạ tiệc'; description = 'Một kỹ sư trẻ đậm chất sân khấu; kỹ thuật trình chiếu bị đánh cắp của anh giải thích một phần điều tưởng như bất khả thi.'
        visualDescription = 'Young theatrical mechanical illusionist, slim agile build, expressive oval face, tousled auburn hair, plum tailcoat with teal lining, tool harness and compact brass projector pieces, distinctive star-shaped lens monocle worn above one eye.'
    }
    'char-wren' = @{
        role = 'Nghị viên thành phố kiêm ủy viên đài thiên văn'; description = 'Một chính khách lớn tuổi có vẻ tận tụy, nhưng gia sản nhà ông bắt đầu từ thảm họa đã khiến Blackglass đóng cửa.'
        visualDescription = 'Older stocky councilor, heavy rounded build, broad jowled face, neatly parted silver hair and trimmed mustache, expensive black council coat with burgundy sash, gold signet ring, distinctive Wren crest chain and guarded smile.'
    }
}
foreach ($character in $source.characters) {
    Set-Text $character $characterText[$character.characterId]
    $character.imageUrl = ''
}

$itemText = @{
    'item-tide-key' = @{
        name = 'Chìa Khóa Thủy Triều Bằng Đồng'; description = 'Một chìa khóa cảng có hai ngạnh, được tìm thấy cạnh bộ điều khiển cổng lưu trữ.'
        inspectText = 'Răng chìa khớp với chuẩn kỹ thuật từng dùng cho cả cổng thủy triều lẫn máy móc Blackglass đời đầu.'
        interactionReason = 'Người chơi phải tra đúng chìa khóa cảng vào ổ khóa của bàn điều khiển kỹ thuật.'
        visualDescription = 'A genuinely small palm-sized forked brass harbor service key, worn teeth, compact bow, salt patina, isolated complete object, no machinery or console attached.'
        renderMode = 'CUTOUT'
    }
    'item-lens-half' = @{
        name = 'Nửa Thấu Kính Tiêu Sắc'; description = 'Một mảnh vỡ của cụm quang học lắp ghép, được giấu trong mô hình đài thiên văn sai lệch.'
        inspectText = 'Một rãnh hiệu chuẩn hình chữ W chạy qua cạnh gãy của mảnh kính.'
        interactionReason = 'Người chơi phải ghép mảnh thấu kính này với nửa lăng kính tương ứng.'
        visualDescription = 'One small palm-sized broken achromatic lens fragment only, irregular jagged fracture edge with a precise W-shaped calibration notch crossing the break, brass rim remnant, visibly incomplete; never a full lens frame, optical device or complete instrument.'
        renderMode = 'CUTOUT'
    }
    'item-prism-half' = @{
        name = 'Nửa Lăng Kính Chiếu'; description = 'Một mảnh quang học tương ứng được tìm thấy giữa các bàn thợ của Lantern Works.'
        inspectText = 'Cạnh gãy và rãnh hình chữ W của nó khớp với mảnh thấu kính từ Dinh thự Vale.'
        interactionReason = 'Người chơi phải ghép lăng kính này với mảnh thấu kính để lộ dấu hiệu chuẩn chung.'
        visualDescription = 'One small palm-sized broken projection-prism fragment only, irregular jagged fracture edge and exact W-shaped notch matching another missing piece, faint spectral glint, visibly incomplete; never a full prism assembly, projector frame or complete instrument.'
        renderMode = 'CUTOUT'
    }
    'item-service-console' = @{
        name = 'Bàn Điều Khiển Kỹ Thuật Blackglass'; description = 'Một bàn điều khiển bằng đồng có khóa, vận hành hệ thống máy móc bí mật của phòng chiếu.'
        inspectText = 'Nó có ổ khóa hai ngạnh, vòng mã đồng hồ, ray trình tự vận chuyển và các phiến biểu tượng theo cặp.'
        interactionReason = 'Người chơi phải mở khóa và vận hành các bộ điều khiển cơ khí hữu hạn của bàn máy.'
        visualDescription = 'Large built-in Victorian brass service console integrated into the rotunda wall, forked keyway, clock-code wheel, transit sequence rail and paired symbol plates; draw exactly once as part of the scene architecture, with no readable text.'
        renderMode = 'EMBEDDED'
    }
}
foreach ($item in $source.items) {
    Set-Text $item $itemText[$item.itemId]
    $item.imageUrl = ''
}

$clueText = @{
    'clue-clock-brake' = @{
        title = 'Vết Phanh Đồng Bộ'; content = 'Mỗi chiếc đồng hồ dừng lại đều có một vết xước hình lưỡi liềm còn mới tại cùng vị trí bánh răng; mặt số thiên văn đã bị hãm bằng cơ khí, không phải do mất điện.'
        inventoryDescription = 'Ảnh chụp các kim đồng hồ đồng bộ và những vết phanh mới trùng khớp.'; narrativeMeaning = 'Một cơ cấu trung tâm đã cố ý dừng các đồng hồ để tạo ra thời điểm bất khả thi và che giấu chuyển động của căn phòng.'
    }
    'clue-tide-authorization' = @{
        title = 'Lệnh Điều Tiết Thủy Triều Của Wren'; content = 'Bảng cổng trong kho lưu trữ cho thấy mục ghi của Flint đã bị xóa và thay bằng lệnh của ủy viên Wren, cho phép đổi tuyến ven vách đá trong chín mươi giây.'
        inventoryDescription = 'Ảnh chụp lệnh điều tiết thủy triều đã bị sửa, mang gia huy Wren.'; narrativeMeaning = 'Wren có cơ hội hành chính để cô lập đài thiên văn và đồng bộ tuyến tẩu thoát.'
    }
    'clue-vale-model' = @{
        title = 'Trục Bí Mật Trong Mô Hình Của Vale'; content = 'Mô hình của Vale có một bức tường tháo rời và trục được phác bằng bút chì nhưng không xuất hiện trong bản vẽ chính thức; chữ viết tắt của Mara đánh dấu chỗ sửa.'
        inventoryDescription = 'Ảnh chụp trục bí mật và chữ viết tắt của Mara Vale trên mô hình đã sửa.'; narrativeMeaning = 'Mara và Vale đã biết về lối đi kín trước buổi xem thử và định lợi dụng nó.'
    }
    'clue-undercroft-hush-draft' = @{
        title = 'Bản Thỏa Thuận Bịt Miệng Mới Của Wren'; content = 'Một bản bồi thường bị xé hứa trả tiền để Vale im lặng, còn lớp mỡ quang học mới cạnh vòng trói mang dấu nhẫn của Bram Wren.'
        inventoryDescription = 'Ảnh chụp nối thỏa thuận bịt miệng và dấu nhẫn Wren trực tiếp với nơi giam giữ đã được chuẩn bị.'; narrativeMeaning = 'Wren đích thân chuẩn bị nơi bắt cóc để ngăn Vale chứng minh nhà Wren gây ra vụ bê bối ban đầu.'
    }
    'clue-service-shaft' = @{
        title = 'Trục Kỹ Thuật Đã Mở'; content = 'Chìa khóa thủy triều mở bàn điều khiển và giải phóng bức tường xoay nối phòng chiếu với hầm dưới.'
        inventoryDescription = 'Chìa khóa cảng đã mở lối kỹ thuật bí mật của Blackglass.'; narrativeMeaning = 'Vale có thể bị đưa khỏi căn phòng khóa kín mà không cần qua cửa ra vào hay cửa sổ.'
    }
    'clue-calibrated-optic' = @{
        title = 'Cụm Quang Học Hiệu Chuẩn Wren'; content = 'Thấu kính và lăng kính sau khi ghép thành một bộ phận máy chiếu Blackglass, khắc dấu hiệu chuẩn của xưởng Wren.'
        inventoryDescription = 'Một cụm quang học máy chiếu được tái tạo, do Lantern Works thuộc nhà Wren hiệu chuẩn.'; narrativeMeaning = 'Nhà máy của Wren đã cung cấp hệ thống chiếu bí mật, trái với lời ông phủ nhận rằng quang cụ của họ có thể lắp vào Blackglass.'
    }
    'clue-corrected-time' = @{
        title = 'Thời Điểm Nhật Thực Chính Xác'; content = 'Mã đồng hồ cho thấy thời điểm mất điện thật là 23:47, sớm hơn mười bốn phút so với màn hiển thị thiên văn đã dàn dựng.'
        inventoryDescription = 'Thời điểm mất điện thật là 23:47.'; narrativeMeaning = 'Giờ đồng hồ giả đã che giấu một đợt đổi tuyến thủy triều theo lịch và tạo ra lời khai sai lệch về thời gian.'
    }
    'clue-transit-sequence' = @{
        title = 'Trình Tự Vận Chuyển Chín Mươi Giây'; content = 'Trình tự trên bàn điều khiển cho thấy tường mở, sàn phòng hạ xuống, chuông vang và tường đóng lại trong vòng chín mươi giây.'
        inventoryDescription = 'Trình tự cơ khí chứng minh việc đưa người khỏi phòng khóa kín vừa khít khoảng thời gian nhân chứng quan sát.'; narrativeMeaning = 'Vụ biến mất là một quy trình vận chuyển cơ khí có tính giờ, không chỉ là ảo ảnh.'
    }
    'clue-illusion-overlay' = @{
        title = 'Lớp Chiếu Phủ Của Quill'; content = 'Các biểu tượng khớp nhau hé lộ một lớp chiếu phủ sao chép từ Quill, dùng để tạo dấu chân đứng yên và lời cảnh báo của nhà thiên văn đã chết.'
        inventoryDescription = 'Một kỹ thuật ảo ảnh bị đánh cắp giải thích dấu chân và bóng ma được ghi lại.'; narrativeMeaning = 'Kỹ thuật của Quill tạo ra màn đánh lạc hướng, nhưng không thể di chuyển Vale hay vận hành tuyến thủy triều.'
    }
    'clue-flint-override' = @{
        title = 'Lời Thừa Nhận Của Flint'; content = 'Khi đối chất bằng lệnh điều tiết, Flint thừa nhận Wren đã viện đặc quyền khẩn cấp của ủy viên và ra lệnh bà che giấu việc đổi tuyến cho đến sau dạ tiệc.'
        inventoryDescription = 'Flint thừa nhận Wren đích thân ra lệnh đổi tuyến trong chín mươi giây.'; narrativeMeaning = 'Hồ sơ thủy triều bị sửa là mệnh lệnh cố ý của Wren, không phải hoạt động thường lệ ở cảng.'
    }
    'clue-mara-plan' = @{
        title = 'Kế Nghi Binh Của Vale'; content = 'Mara thừa nhận cô đã giúp Vale lên kế hoạch biến mất giả trong chốc lát để dụ kẻ đã thay thế hồ sơ gốc của đài thiên văn lộ diện.'
        inventoryDescription = 'Vale định thực hiện một màn nghi binh có kiểm soát, không phải biến mất kéo dài.'; narrativeMeaning = 'Kẻ thủ ác đã cướp lấy kế hoạch của Vale sau khi biết chuyện, biến màn kịch thành vụ bắt cóc.'
    }
    'clue-wren-access' = @{
        title = 'Quyền Tiếp Cận Quang Học Của Wren'; content = 'Trước cụm quang học được tái tạo, Wren buộc phải thừa nhận gia đình ông vẫn giữ các phiến hiệu chuẩn và quyền tiếp cận không hạn chế vào hệ thống kỹ thuật Blackglass.'
        inventoryDescription = 'Wren vừa có kiến thức kỹ thuật vừa có quyền tiếp cận máy móc bí mật.'; narrativeMeaning = 'Wren nói dối về mối liên hệ giữa nhà máy và Blackglass, đồng thời có phương tiện để chuẩn bị cơ cấu.'
    }
}
foreach ($clue in $source.clues) { Set-Text $clue $clueText[$clue.clueId] }

$dialogueText = @{
    'dlg-rook-clock' = @{ question = 'Tại sao ông tháo một bộ phận của đồng hồ thiên văn?'; answer = 'Tôi tháo bộ điều tốc sau khi thấy vết phanh mới. Tôi sợ lần kích hoạt thứ hai sẽ phá hủy bằng chứng rằng mọi chiếc đồng hồ đều bị dừng từ trung tâm.' }
    'dlg-quill-recording' = @{ question = 'Anh có thể tái tạo giọng nói của nhà thiên văn đã chết không?'; answer = 'Nếu có chuẩn bị thì được. Nhưng dấu chân và giọng nói đã dùng hình học lớp phủ bị đánh cắp từ màn trình diễn nhật thực riêng của tôi.' }
    'dlg-flint-tides' = @{ question = 'Những tuyến nào được mở trong lúc mất điện?'; answer = 'Theo hồ sơ, cống ven vách đá đã đóng. Bảng thủy triều phải chứng minh không có hoạt động cảng nào được cấp phép.' }
    'dlg-flint-seal' = @{ question = 'Bà nói chỉ con dấu của bà mới cho phép đổi tuyến. Vậy bà giải thích mục ghi này thế nào?'; answer = 'Wren đã viện đặc quyền khẩn cấp của các ủy viên. Ông ta ra lệnh dọn tuyến trong chín mươi giây và bắt tôi giấu bản ghi trùng.' }
    'dlg-mara-model' = @{ question = 'Tại sao mô hình này có một trục không xuất hiện trong bản vẽ chính thức?'; answer = 'Cha tôi tìm thấy nhắc đến một khoang bảo trì. Tôi dựng lại nó, nhưng chúng tôi chưa từng chứng minh bức tường thật vẫn còn di chuyển.' }
    'dlg-mara-father' = @{ question = 'Chữ viết tắt chứng minh cô biết lối đi. Vale đã lên kế hoạch gì?'; answer = 'Một màn nghi binh chín mươi giây. Ông định vào trục, nghe ngóng kẻ thù rồi trở lại. Có người đã ngăn ông quay về.' }
    'dlg-wren-factory' = @{ question = 'Tại sao gia đình ông vẫn giữ Lantern Works?'; answer = 'Vì tình cảm và trách nhiệm công dân. Những dụng cụ lỗi thời ở đó không còn liên hệ vận hành nào với Blackglass.' }
    'dlg-quill-copy' = @{ question = 'Ai có thể sao chép kỹ thuật trình chiếu của anh?'; answer = 'Một ủy viên đã kiểm tra thiết bị của tôi trước dạ tiệc. Wren gọi đó là rà soát an toàn và tự tay cầm các phiến căn chỉnh.' }
    'dlg-wren-interface' = @{ question = 'Quang cụ Lantern Works có thể vận hành máy chiếu của đài thiên văn không?'; answer = 'Không thể. Hiệu chuẩn không tương thích, và gia đình tôi đã từ bỏ mọi đặc quyền kỹ thuật từ nhiều thập kỷ trước.' }
    'dlg-rook-console' = @{ question = 'Bàn điều khiển này vận hành những hệ thống nào?'; answer = 'Phanh trung tâm, tường xoay của căn phòng, sàn vận chuyển, chuông và máy chiếu. Giải được các bộ điều khiển thì toàn bộ vụ biến mất sẽ có mốc thời gian.' }
    'dlg-mara-confession' = @{ question = 'Cha cô trông đợi tìm thấy gì dưới căn phòng?'; answer = 'Lời thú nhận gốc chứng minh các ủy viên Wren gây ra những cái chết năm xưa rồi đổ tội cho các nhà thiên văn. Ông tin Bram đã đề nghị tiền bịt miệng để lấy lại nó.' }
    'dlg-wren-final' = @{ question = 'Tại sao dấu nhẫn của ông lại nằm cạnh vòng trói?'; answer = 'Vale đã ép tôi phải hành động. Một cái tên bị hủy hoại có thể kéo theo hội đồng Veymar và sinh kế của nửa thành phố.' }
}
foreach ($dialogue in $source.dialogues) { Set-Text $dialogue $dialogueText[$dialogue.dialogueId] }

$conversationLines = @{
    'conv-rook-root' = 'Blackglass được thiết kế để biến thiên văn học thành sân khấu. Chính điều đó khiến các hệ thống bí mật của nó dễ bị lợi dụng.'
    'conv-rook-clock-node' = 'Những vết xước giống hệt nhau nghĩa là một phanh từ xa đã chặn mọi bộ truyền đồng hồ cùng lúc. Thời gian hiển thị đã được dàn dựng.'
    'conv-wren-root' = 'Gia đình tôi đã tài trợ cho Veymar qua nhiều thế hệ. Những cáo buộc cũ không nên che mờ sự phụng sự hiện tại.'
    'conv-wren-access-node' = 'Các phiến của nhà máy chỉ là di vật nghi lễ. Không thứ gì ở đó có thể vận hành Blackglass.'
}
$conversationChoices = @{
    'conv-rook-topic' = 'Hỏi về những chiếc đồng hồ đã dừng'; 'conv-rook-leave' = 'Rời đi'
    'conv-rook-clock-end' = 'Trở lại điều tra'; 'conv-wren-topic' = 'Hỏi về quyền tiếp cận Lantern Works'
    'conv-wren-leave' = 'Rời đi'; 'conv-wren-access-end' = 'Kết thúc thẩm vấn'
}
foreach ($node in $source.conversationNodes) {
    if ($conversationLines.ContainsKey($node.nodeId)) { $node.lines[0].text = $conversationLines[$node.nodeId] }
    foreach ($choice in $node.choices) { $choice.label = $conversationChoices[$choice.choiceId] }
}

$challengeText = @{
    'challenge-flint-seal' = @{ prompt = 'Bằng chứng nào bác bỏ lời Flint rằng không có lệnh đổi tuyến?'; successResponse = 'Lệnh mang tên Wren buộc Flint thừa nhận việc đổi tuyến bị che giấu.'; failureResponse = 'Hãy tìm hồ sơ ghi rõ ai đã ra lệnh đổi tuyến.' }
    'challenge-mara-route' = @{ prompt = 'Bằng chứng nào chứng minh Mara biết lối đi bí mật trước buổi xem thử?'; successResponse = 'Chữ viết tắt trên mô hình đã sửa phơi bày màn nghi binh Vale định thực hiện.'; failureResponse = 'Hãy tìm một vật thể kiến trúc có dấu riêng của Mara.' }
    'challenge-wren-optics' = @{ prompt = 'Bằng chứng nào mâu thuẫn với lời Wren rằng quang cụ nhà máy không tương thích?'; successResponse = 'Cụm quang học đã ghép buộc Wren thừa nhận quyền tiếp cận kỹ thuật.'; failureResponse = 'Hãy tái tạo hai mảnh quang học và kiểm tra dấu hiệu chuẩn.' }
}
foreach ($challenge in $source.evidenceChallenges) { Set-Text $challenge $challengeText[$challenge.challengeId] }

$deductionText = @{
    'deduction-locked-room-method' = @{
        prompt = 'Chuỗi sự kiện nào giải thích cách Vale rời phòng chiếu khóa kín trong chín mươi giây?'
        successResponse = 'Phanh đồng hồ và trình tự vận chuyển tái dựng cách Vale bị đưa khỏi căn phòng khóa kín.'
        failureResponse = 'Hãy tách màn đánh lạc hướng bằng hình chiếu khỏi bộ máy thực sự di chuyển Vale.'
        options = @{
            'deduce-method-shaft' = 'Phanh trung tâm dàn dựng thời gian, còn tường xoay và sàn máy đưa Vale xuống hầm.'
            'deduce-method-window' = 'Vale thoát qua cửa sổ bị niêm kín trong lúc đồng hồ hỏng tự nhiên.'
            'deduce-method-illusion' = 'Vale chưa từng bước vào; Quill đã chiếu toàn bộ hình ảnh của ông.'
        }
    }
    'deduction-hijacked-feint' = @{
        prompt = 'Chuỗi sự kiện nào xác định cách kế hoạch của Vale biến thành một vụ bắt cóc?'
        successResponse = 'Vale lên kế hoạch cho ảo ảnh mở đầu, nhưng Wren đã biến nó thành một vụ bắt cóc thật.'
        failureResponse = 'Hãy xác định ai có quang cụ sao chép, quyền tiếp cận kỹ thuật và lý do để bịt miệng Vale.'
        options = @{
            'deduce-feint-hijacked' = 'Wren biết màn nghi binh của Vale, sao chép lớp phủ của Quill, đổi hướng cơ cấu rồi giam Vale bên dưới.'
            'deduce-feint-mara' = 'Mara bắt cóc Vale để thừa kế gia sản và đổ tội cho các ủy viên đài thiên văn.'
            'deduce-feint-rook' = 'Rook bịa ra lối đi bí mật sau vụ biến mất để bảo vệ chức giám đốc.'
        }
    }
}
foreach ($deduction in $source.deductions) {
    $text = $deductionText[$deduction.deductionId]
    $deduction.prompt = $text.prompt
    $deduction.successResponse = $text.successResponse
    $deduction.failureResponse = $text.failureResponse
    foreach ($option in $deduction.options) { $option.label = $text.options[$option.id] }
}

$chainText = @{
    'chain-clock-and-tide' = 'Một điều tra viên chụp lệnh đã bị sửa, người còn lại đối chất Flint và ghép việc đổi tuyến vào dòng thời gian cơ khí.'
    'chain-optic-and-access' = 'Một điều tra viên tái tạo cụm quang học, người còn lại dùng nó phá lời phủ nhận của Wren và xác lập quyền tiếp cận của ông ta.'
}
foreach ($chain in $source.requiredTeamworkChains) { $chain.description = $chainText[$chain.chainId] }

$hintText = @{
    'hint-scene-1' = 'Hãy so sánh các bánh răng lộ ra, không chỉ thời gian trên mặt đồng hồ.'
    'hint-scene-2' = 'Kiểm tra bảng lệnh xem có nét chữ nào bên dưới mục ghi chính thức.'
    'hint-scene-3' = 'So sánh bức tường phòng chiếu trong mô hình với các bản vẽ còn lại.'
    'hint-scene-4' = 'Tìm trên bàn quang học một mảnh khớp với mảnh từ Dinh thự Vale.'
    'hint-scene-5' = 'Mở bàn điều khiển, tái tạo cụm quang học rồi giải các bộ điều khiển từ thời gian đến biểu tượng.'
    'hint-scene-6' = 'Chụp thỏa thuận và dấu mới cạnh vòng trói trong cùng một bức ảnh.'
    'hint-challenge-flint' = 'Dùng hồ sơ đã bị sửa có gia huy của một ủy viên.'
    'hint-challenge-mara' = 'Chữ viết tắt của Mara nằm trên mô hình vật lý của lối đi bí mật.'
    'hint-challenge-wren' = 'Lời tuyên bố không tương thích của Wren sụp đổ khi hai mảnh quang học được ghép lại.'
    'hint-deduction-method' = 'Ảo ảnh giải thích thứ người ta nhìn thấy; trình tự trên bàn điều khiển giải thích chuyển động.'
    'hint-deduction-feint' = 'Vale chỉ định rời đi chín mươi giây, vì vậy hãy xác định ai có thể ngăn ông quay lại.'
}
foreach ($hint in $source.hints) { $hint.text = $hintText[$hint.hintId] }

$interactionText = @{
    'interaction-combine-optics' = @{ successMessage = 'Hai mảnh khóa khít vào nhau và lộ dấu hiệu chuẩn Wren.'; failureMessage = 'Những mảnh này không tạo thành một cụm quang học hoàn chỉnh.' }
    'interaction-use-tide-key' = @{ successMessage = 'Chìa khóa thủy triều xoay, bức tường kỹ thuật bí mật cũng xoay mở.'; failureMessage = 'Bàn điều khiển cần một chìa kỹ thuật Veymar đời đầu có hai ngạnh.' }
}
foreach ($interaction in $source.interactions) { Set-Text $interaction $interactionText[$interaction.interactionId] }

$puzzleText = @{
    'puzzle-clock-code' = @{ prompt = 'Nhập thời điểm mất điện thật dựa trên vết phanh đồng hồ và lệnh điều tiết thủy triều.'; successMessage = 'Bàn điều khiển hiện thời điểm mất điện đã được hiệu chỉnh.'; failureMessage = 'Vòng mã bật về vị trí cũ với một tiếng kim loại.' }
    'puzzle-transit-sequence' = @{ prompt = 'Sắp xếp các cơ cấu của căn phòng theo trình tự vận hành trong chín mươi giây.'; successMessage = 'Bàn điều khiển tái diễn hành trình chín mươi giây.'; failureMessage = 'Cơ cấu mắc kẹt trước khi hoàn tất lộ trình.' }
    'puzzle-symbol-overlay' = @{ prompt = 'Ghép từng biểu tượng đài thiên văn với biểu tượng trình chiếu tương ứng của Lantern Works.'; successMessage = 'Các phiến khớp nhau làm lộ lớp chiếu phủ bị sao chép.'; failureMessage = 'Các phiến biểu tượng tối đi rồi nhả ra.' }
}
foreach ($puzzle in $source.puzzles) { Set-Text $puzzle $puzzleText[$puzzle.puzzleId] }

$source.finalLogic.motive = 'Bram Wren bắt cóc Vale để ngăn bằng chứng cho thấy gia đình Wren gây ra thảm họa Blackglass ban đầu và dựng nên gia sản từ việc che đậy.'
$source.finalLogic.method = 'Wren cướp lấy màn nghi binh của Vale, dùng hiệu ứng chiếu sao chép và phanh đồng hồ trung tâm để đánh lạc hướng, rồi đổi hướng tường xoay cùng sàn máy để giam Vale dưới hầm.'
$source.finalLogic.winEnding = 'SirLocked tái dựng hành trình chín mươi giây và vạch mặt Wren trước khi thủy triều nhật thực tràn vào hầm. Vale được cứu sống, Flint mở tuyến đường bị niêm kín và lời thú nhận gốc của Blackglass được công bố.'
$source.finalLogic.failEnding = 'Lời buộc tội không nối được động cơ, máy móc và quyền tiếp cận. Wren niêm kín hầm khi thủy triều dâng, hủy lời thú nhận còn sót lại và biến vụ mất tích của Vale thành một trò lừa riêng đầy liều lĩnh.'
$motiveLabels = @{
    'motive-suppress-scandal' = 'Bịt miệng Vale trước khi ông phơi bày trách nhiệm của nhà Wren trong thảm họa ban đầu.'
    'motive-steal-estate' = 'Ép Mara từ bỏ quyền kiểm soát gia sản Vale.'
    'motive-destroy-observatory' = 'Làm mất uy tín ngành thiên văn và đóng cửa vĩnh viễn Đài thiên văn Blackglass.'
}
$methodLabels = @{
    'method-hijacked-mechanism' = 'Cướp màn nghi binh của Vale, dàn dựng đồng hồ và hình chiếu rồi chuyển sàn bí mật xuống hầm.'
    'method-window-escape' = 'Đưa Vale qua một cửa sổ ven vách đá được tháo niêm phong tạm thời trong lúc mất điện.'
    'method-total-projection' = 'Chiếu hình ảnh giả của Vale bước vào trong khi Vale thật ở nơi khác.'
}
foreach ($option in $source.finalLogic.motiveOptions) { $option.label = $motiveLabels[$option.id] }
foreach ($option in $source.finalLogic.methodOptions) { $option.label = $methodLabels[$option.id] }

$after = Structural-Projection $source | ConvertTo-Json -Depth 20 -Compress
if ($before -ne $after) { throw 'Structural projection changed during Vietnamese migration.' }

$parent = Split-Path -Parent $OutputPath
if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$source | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host "Blackglass v5 Vietnamese JSON written to $OutputPath"
Write-Host 'Structural projection verified: IDs, culprit, references, stage order, puzzle answers and final logic links are unchanged.'
