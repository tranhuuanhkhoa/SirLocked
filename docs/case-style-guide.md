# Hướng dẫn viết vụ án (style guide của bot)

Tài liệu cho bot Claude khi chạy `/tao-vu-an`, cho agent phụ `bien-tap-vien` (soát chữ) và `tham-tu-mu` (thử phá án). Áp dụng cho mọi thế giới. Chi tiết từng thế giới nằm ở `docs/worlds/`:

- `docs/worlds/hang-duong.md`: Phố Hàng Đường (`HANG_DUONG_VICTORIAN`).
- `docs/worlds/taisho.md`: Nhật Bản thời Taishō (`TAISHO_JAPAN`).
- `docs/worlds/thuong-hai-1930.md`: Thượng Hải thập niên 1930 (`SHANGHAI_1930`).

Đơn "Thế giới mới" (`NEW_WORLD`) vẫn giữ công nghệ khoảng 1900–1935 để 11 loại giải đố còn hợp lý; thư viện chưa có hình cho nó, nên bot báo số lượt PixelLab cần vẽ trước khi làm.

Ghi chú nguồn: mục nào ghi **luật** là luật code đang kiểm (có đường dẫn file). Mục ghi **khuyến nghị** là rút từ 3 vụ có sẵn, code không chặn.

## 1. Giọng văn

- **Cụ thể, có hình.** Nêu giờ, nơi, đồ vật, thời tiết: "Chín giờ tôi ra sau pha ấm trà, mười phút sau quay lại thì khay trống trơn!" thay vì "Tôi rời đi một lúc thì đồ bị mất".
- **Câu ngắn.** Mỗi câu một ý. Lời thoại nghe như người thật nói, có ngập ngừng khi nhân vật giấu điều gì ("Tôi… ghé chỗ thầy Khánh một lát.").
- **Hơi cổ, không hiện đại.** Không dùng từ lóng hay từ mượn kiểu mới ("ok", "check", "deal", "chill"). Không nhắc đồ vật ra đời sau 1935 (xem mục "Đồ lỗi thời" trong sổ tay từng thế giới).
- **Giờ giấc như người thời đó nói.** Trong thoại: "chín giờ kém mười", "sáu giờ bốn mươi sáng nay". Trên dòng thời gian: "20:45".
- **Người kể** (tóm tắt, mô tả cảnh): ngôi thứ ba, giọng trung tính, không lộ hung thủ, không đánh giá ai đáng ngờ.
- **Câu hỏi của thám tử** (`question`, nhãn lựa chọn): hỏi thẳng, ngắn: "Tối thứ Năm anh ở đâu?", "Chiếc nhẫn ngọc bích ở tiệm cầm đồ là sao?".
- **Không đùa trên cái chết hay nỗi đau.** Có thể dí dỏm ở nhân vật phụ, không chế giễu nạn nhân.

### Mỗi nhân vật một giọng

Bảng mẫu từ vụ "Đồng hồ bỏ túi đêm mưa" và "Lọ thuốc thứ Năm":

| Nhân vật | Giọng | Dấu hiệu trong câu |
| --- | --- | --- |
| Ông Tư Lành, thợ đồng hồ già | Chậm, kỹ, kể theo trình tự | Nêu giờ chính xác, chữ "tôi" đều đặn, câu cảm thán khi mất đồ |
| Cô Hạnh, bán hoa | Nhỏ nhẹ, lễ phép | Xưng "em", kể điều mình thấy, không suy diễn |
| Anh Bảy Sóng, thủy thủ | Cộc, chống chế | Câu ngắn, phủ nhận mạnh: "Nợ nần gì!" |
| Lâm Thế Bảo, cháu nạn nhân | Gượng, khó chịu khi bị hỏi | "Các anh còn muốn hỏi gì nữa?", né "chuyện riêng" |
| Lý Hạnh, người giúp việc lâu năm | Chu đáo, nhớ giờ giấc nếp nhà | Kể việc nhà theo giờ, gọi "ông chủ", "cậu Bảo" |

Agent `bien-tap-vien` kiểm: che tên đi vẫn đoán được ai đang nói.

## 2. Độ dài

### Luật code đang kiểm

| Thứ | Giới hạn | Nguồn |
| --- | --- | --- |
| Câu trả lời của thoại nguồn cho Phá Vỡ Lời Dối (Crack) | 45–100 từ (đếm theo khoảng trắng) | `src/BE/Services/AiV3GenerationProfile.cs` (kiểm `WordCount(dialogue.Answer)`), `src/BE/Services/AiCaseBlueprintPolicy.cs`; prompt ở `src/BE/Services/AiCaseService.cs` |
| Mỗi mảnh lời khai (`testimonyFragments[].text`) | 5–25 từ, phải là **đoạn trích nguyên văn** trong câu trả lời đó | Cùng hai file trên; prompt: "every 5-25 word testimony fragment must be a distinct exact substring of that dialogue answer" |
| Mô tả trong sổ sự thật (bước truth) | tối đa 400 ký tự mỗi trường mô tả; id tối đa 96 ký tự | `src/BE/Services/AiTruthGenerationBudget.cs` (`MaxDescriptionLength`, `MaxIdLength`) |
| Lý lẽ trong `claimProofs[].reasoning`, `findings[].message` | tối đa 800 ký tự | `src/BE/Services/AiGenerationSchemas.cs` |
| Giải đố cổ điển: `options` | tối đa 12 lựa chọn (SEQUENCE, SYMBOL_MATCH cần 2–12) | `src/BE/Services/CaseValidationService.cs` |
| Giải đố cổ điển: `correctSequence` | tối đa 8 bước, mỗi bước phải nằm trong `options` | `src/BE/Services/CaseValidationService.cs` |
| Giải đố cổ điển: `correctCode` (CODE_PUZZLE) | 1–32 ký tự | `src/BE/Services/CaseValidationService.cs` |
| Ô "Ý tưởng" của đơn | tối đa 2.000 ký tự | `docs/AI_CASE_SETUP_VI.md` |
| `characterNotes` của đơn | tối đa 600 ký tự | `src/BE/Models/AiCaseOrder.cs` (`MaxCharacterNotes`) |

Khung thoại trong game (`src/FE/Client/js/game/dialoguePresenter.ts`) **không cắt và không chia trang**: chữ hiện dần 2 ký tự mỗi 28 ms (khoảng 70 ký tự mỗi giây), người chơi bấm để qua câu. Câu quá dài không lỗi, chỉ làm người chơi ngồi đọc lâu và tràn khung trên điện thoại.

### Khuyến nghị (rút từ 3 vụ có sẵn, code không chặn)

Số đo thực tế: "Lọ thuốc thứ Năm" (`case-pixel-lo-thuoc-thu-nam-vi.json`), "Trâm hồng ngọc mất tích" (`case-pixel-tram-hong-ngoc-vi.json`), vụ mẫu "Đồng hồ bỏ túi đêm mưa".

| Thứ | Khuyến nghị | Số thực tế trong 3 vụ |
| --- | --- | --- |
| Câu hỏi của thám tử (`dialogues[].question`) | ≤ 50 ký tự | dài nhất 55, trung vị 19–33 |
| Một câu trả lời thường (`dialogues[].answer`) | 15–40 từ, ≤ 200 ký tự | dài nhất 215 ký tự (48 từ), trung vị 103–146 ký tự |
| Một dòng NPC trong cây hội thoại (`conversationNodes[].lines[].text`) | ≤ 180 ký tự, tách thành 2 dòng nếu dài hơn | dài nhất 178, trung vị 65 |
| Nhãn lựa chọn (`choices[].label`) | ≤ 40 ký tự, viết như câu hỏi | dài nhất 42, trung vị 16 |
| Tiêu đề vụ | ≤ 30 ký tự | 16–23 |
| Tóm tắt vụ (`summary`) | ≤ 300 ký tự | 176–282 |
| Nhãn dòng thời gian (`timeline.events[].label`) | ≤ 40 ký tự | vụ mẫu ≤ 34 |
| Nhãn dây bảng tường (`board.links[].label`) | ≤ 20 ký tự, chữ in hoa | "CÙNG TÀU HẢI ÂU", "NỢ 40 ĐỒNG" |

Câu trả lời Crack (45–100 từ) dài hơn câu thường là đúng luật: nó phải chứa đủ các mảnh lời khai.

## 3. Luật fair play

Thám tử mù áp dụng các luật này (mục 5 kế hoạch):

1. Mọi manh mối cần cho kết luận đều xuất hiện **trước** lúc buộc tội.
2. Hung thủ xuất hiện sớm, gặp được ở chặng đầu.
3. Không có yếu tố siêu nhiên.
4. Lời nói dối nào cũng có chứng cứ bác bỏ.
5. Nghi phạm giả nào cũng có lời giải thích.
6. Thám tử mù phải nêu đúng hung thủ, động cơ, phương thức, chứng cứ và chứng minh **không nghi phạm nào khác** cũng khớp.

## 4. Bảng kiểm fair play trước khi đưa thám tử mù

Bot tự soát từng dòng, ghi "đạt" hoặc "đã sửa" vào `report.md`. Các dòng rút từ 7 góp ý của thám tử mù ở vụ mẫu.

| # | Điểm kiểm | Cách kiểm | Ví dụ đúng (vụ mẫu) |
| --- | --- | --- | --- |
| 1 | Ngoại hình trong chứng cứ khớp mô tả nhân vật | Ảnh trên thẻ, dấu giày, cỡ găng, tay thuận, vết sẹo… phải khớp `characters[].description` và sprite | Ảnh trên thẻ thủy thủ phải là người đội mũ len xanh, râu quai nón như mô tả anh Bảy; dấu tay có sẹo chỉ khớp thẻ vân tay của anh Bảy |
| 2 | Chi tiết lạ có lời giải thích | Nửa tấm thẻ, vết nứt, mép giấy cháy, vết ướt: ai gây ra, lúc nào | Thẻ thủy thủ rơi dưới gầm bàn lúc giật đồng hồ khỏi khay |
| 3 | Động cơ làm được | Đồ đáng bao nhiêu, bán hay cầm ở đâu, hung thủ cần bao nhiêu | Nợ 40 đồng tiền trọ; đồng hồ mạ vàng giá chừng 60 đồng, đủ trả nợ |
| 4 | Mốc giờ trong thoại khớp dòng thời gian | Mọi giờ nhắc trong thoại có trên `timeline` hoặc suy ra được, không mâu thuẫn | "Chín giờ kém mười em mang hoa vào" khớp mốc 20:50 |
| 5 | Lời khai trích đúng nguyên văn | `testimonyFragments[].text` là đoạn chép y nguyên câu trả lời (code kiểm với thoại Crack; bot tự kiểm thêm mọi trích dẫn khác) | "Tôi chưa hề bước chân vào tiệm." có nguyên văn trong câu trả lời của anh Bảy |
| 6 | Nhãn dòng thời gian không nói thẳng kết luận | Nhãn tả sự việc, không nêu tên hung thủ ở mốc gây án | "Đồng hồ biến mất khỏi khay" (không phải "Anh Bảy lấy đồng hồ") |
| 7 | Dây bảng tường không lộ cặp đối chất | `board.links` chỉ nối chứng cứ hoặc lời khai; **không** nối đúng cặp (lời khai, chứng cứ) của một Crack | Dây "NỢ 40 ĐỒNG" nối giấy đòi nợ với lời "không nợ ai", còn cặp Crack đúng (thẻ thủy thủ và "chưa hề vào tiệm") để người chơi tự ghép |
| 8 | Phương án gây nhiễu nghe hợp lý | Mỗi `motiveOptions`, `methodOptions` sai vẫn là điều một người có thể tin lúc đầu | "Lấy đồng hồ lúc cô Hạnh đang bày hoa trong tiệm" |
| 9 | Dấu vết của chính chủ nhà được giải thích | Vân tay, dấu giày của chủ nhà trên đồ của mình là bình thường; nói rõ vì sao không tính | Ông Tư luôn đeo găng vải khi cầm đồng hồ đã sửa, nên dấu tay trần trên mép khay là của người khác |
| 10 | Tên gọi thống nhất | Một vật một tên trong mọi chỗ (thoại, vật phẩm, bảng, buộc tội) | Thống nhất "thẻ thủy thủ" thay vì lúc "vé tàu" lúc "thẻ" |
| 11 | Nghi phạm giả được gỡ | Mỗi nghi phạm không phải hung thủ có ít nhất một chứng cứ hoặc lời khai gỡ tội | Cô Hạnh bày hoa lúc 20:50 khi đồng hồ còn trên khay rồi ra ngay; đồng hồ mất trong khoảng 21:00–21:10; dấu tay trên khay không phải của cô |
| 12 | Gợi ý đủ 3 mức, không lộ hung thủ sớm (VUAN-6) | Mỗi cảnh, mỗi lần đối chất, mỗi suy luận có `hints` ở `order` 1, 2, 3; mỗi câu đố tương tác có ít nhất 3 `solution.hints`. Mức 1: hướng chung; mức 2: chỉ chỗ cần xem; mức 3: gần như đáp án. Mức 1, 2 không nêu tên hay ám chỉ hung thủ. Server từ chối bản nháp AI và vụ mới thiếu mức nào (`MissingHintLevel`, `MissingPuzzleHints`) | Tiệm đồng hồ: 1 "Hỏi ông Tư trước"; 2 "Nhìn xuống sàn quanh bàn"; 3 "Dưới gầm bàn thợ có một tấm thẻ còn ướt nước mưa" |
| 13 | Ô chứng cứ nhận mọi đáp án hợp lý (VUAN-6) | Với mỗi ô buộc tội (động cơ, phương thức, cơ hội…), chứng cứ nào khác cũng chứng minh đúng ô đó thì liệt kê trong `acceptedEvidenceIds`; không dùng chứng cứ chính của ô khác | Ô cơ hội nhận thẻ thủy thủ và cả dấu tay trên mép khay (đều chứng minh anh Bảy đã ở cạnh bàn) |

## 5. Tham số giải đố: điền đủ, không trông vào bước tự điền

Lúc import, `CaseService` gọi `PuzzleKindRegistry.FillMissing` (`src/BE/Services/CaseService.cs`) để tự điền phần còn thiếu của giải đố tương tác. Phần tự điền **ngẫu nhiên và chung chung** (ví dụ thẻ vân tay "Người A", "Người B", "Người C"; nhãn "HỘP KIM LOẠI"), không khớp truyện. Vì vậy bot **tự viết đủ** mọi tham số dưới đây, nhất là phần chữ người chơi nhìn thấy, và luôn có `solution.hints`: **ít nhất 3** gợi ý tiếng Việt theo thứ tự hướng chung → chỗ cần xem → gần như đáp án (bước tự điền chỉ cho 2 câu chung chung, không đủ luật gợi ý của VUAN-6).

Giải đố tương tác: `type = "INTERACTIVE_PUZZLE"`, `kind` là một trong 10 loại sau, kèm `params` (người chơi thấy), `solution` (bí mật), `reveal` (hiện sau khi giải). Hợp đồng từng loại ở đầu file `src/BE/Services/PuzzleKinds/<Tên>Kind.cs`.

| `kind` | Tên trong game | `params` phải tự viết | `solution` | Ràng buộc code kiểm |
| --- | --- | --- | --- | --- |
| `fingerprint` | Dấu vân tay | `cards[{id,mono,name,role,pattern,scar}]`, `print.pattern`, `threshold`, `plate`, `edge`, `surface`, `place`, nên có `note{title,text,tag}`, `testimony{mono,text,tag}` | `card`, `hints` | 2–4 thẻ, id không trùng, mỗi thẻ có `name`; `pattern` là `loop`/`whorl`/`arch`; đúng **một** thẻ (thẻ đáp án) vừa cùng `pattern` với `print` vừa `scar: true`; `threshold` 0,3–0,9 |
| `lockpick` | Nạy khóa ổ bi | `pinCount`, `needs[]`, `win`, `over`, `liftMax`, nên có `chest{title,text}` | `order[]`, `hints` | 3–6 chốt; mỗi `needs` 10–34; `win` 2–10; `over` 4–24; `order` là hoán vị 1…`pinCount` |
| `torn_paper` | Ghép mảnh giấy | `pieceCount`, `tearSeed`, `flipped[]`, `partnerPiece`, `doc{head,sub,meta,to,lines[],sign,stamp[]}`, `note{text,mark}`, `find{title,text,tag}` | `hints` | 4–5 mảnh; `tearSeed` > 0; `partnerPiece` 0 hoặc id một mảnh; ít nhất một mảnh không lật; `doc.lines` 1–3 dòng |
| `doc_forgery` | Soi tài liệu bị sửa | `doc{label,title,sub}`, `ref{label,title,sub}`, `fields[{id,label,value,ref,trace,light,ghost}]`, `signers[{label,name}]`, `seal{ring,top,bottom}`, `need` | `marks{fieldId:"rake"\|"uv"}`, `hints` | 2–6 trường, vừa trang (khoảng 6 dòng); ít nhất một trường bị sửa; `need` bằng số trường bị sửa |
| `music_box` | Hộp nhạc lên dây | `beats`, `notes`, `known[]` (0 = nốt bị nhòe), `quote` (lời nhân chứng ngân phần nhòe), `beatMs` | `melody[]`, `hints` | 4–8 nhịp; nốt là hàng 1 (LA) – 5 (ĐỒ); `known` đủ một ô mỗi nhịp, nốt đầu đọc được, ít nhất 1 nốt nhòe, ít nhất 2 nốt rõ; bắt buộc có `quote` |
| `gear_train` | Bộ bánh răng đồng hồ | `pegs[{id,x,y}]`, `tray[{id,teeth,bent}]`, `targetMin`, `startMin` (bánh dẫn và bánh kim cố định) | `mount{peg:gearId}`, `hints` | 2–6 chốt trong vùng x 60–740, y 60–480; khay 1–5 bánh 10/16/24 răng; chỉ bánh 16 răng được cong; bánh dẫn 20 răng, bánh kim 12 răng; phải có cách lắp chạy xuôi; `targetMin` 1–719 |
| `balance_scale` | Cân đối chứng | `vials`, `tokens`, `perPan`, chữ trên thẻ (tiệm, lô hàng, khối lượng) | `heavy`, `hints` | 3–9 lọ; 1–5 lượt cân; 1–4 lọ mỗi đĩa; số lượt cân phải luôn đủ tìm ra lọ nặng; **không** để `heavy` trong `params` |
| `parallax_code` | Góc nhìn đúng | `slots[{id,name,short,at}]` (3 chỗ), `views[]`, `order[]`, `paint{d1…d4}`, chữ của câu đố | `code` (3 ký tự), `hints` | Ký tự lấy trong bộ `3 4 7 A E F H K L M N T V X Y`, không trùng; điểm nhìn x −1…1, y −0,4…1; **không** để `code` trong `params` |
| `tilt_maze` | Hộp mê cung nghiêng | `size`, `start`, `socket`, `lever`, `holes[]`, `gate`, `walls[]` | `moves`, `hints` | Bàn 4–9 ô; hố không trùng điểm đầu, ổ, cần gạt; tường nối hai ô kề; phải có lời giải ≤ 20 lần nghiêng |
| `reagent_mix` | Pha thuốc thử | `reagents[{key,name,low,rgb}]` (đủ y, b, r), `cube`, `target`, `targetName`, `tolerance`, `maxDrops`, nên có `testimony` | `recipe{y,b,r}`, `hints` | `maxDrops` 3–12; `tolerance` trong (0, 10]; `target` là [r,g,b] 0–255; công thức phải đạt màu đích (ΔE nhỏ hơn `tolerance`); `reveal.letter` là chữ hiện ra |

Giải đố cổ điển (không có `kind`): `CODE_PUZZLE` (`correctCode`), `SEQUENCE_PUZZLE` và `SYMBOL_MATCH_PUZZLE` (`options`, `correctSequence`). Luật độ dài ở mục 2.

Mọi giải đố đều cần: `prompt` tiếng Việt, `targetId` có trong cảnh, `successMessage`, `failureMessage`, phần thưởng (`unlockClueIds`, `unlockItemIds` hoặc `unlockSceneIds`). Giải đố `OPTIONAL` phải có phần thưởng điều tra riêng (code báo `OptionalWithoutPayoff` nếu không có).

Chữ trong `params` (tên trên thẻ, dòng thư, nhãn tem) phải khớp truyện và khớp tên nhân vật, như vụ mẫu: thẻ vân tay ghi "Ông Tư Lành", "Cô Hạnh", "Anh Bảy Sóng" chứ không phải "Người A".

## 6. Mức nội dung

Server đưa mức nội dung vào khối `CREATOR ORDER` của mọi prompt (`src/BE/Services/AiCaseOrderPolicy.cs`): `LIGHT` là "no blood or gore, suitable for every age"; `STANDARD` không kèm mô tả. Mặc định là `STANDARD`.

| | `LIGHT` (hợp mọi tuổi) | `STANDARD` |
| --- | --- | --- |
| Loại vụ hợp | Trộm, mất tích có kết thúc an toàn, lừa đảo, giả mạo giấy tờ, phá hoại | Như LIGHT, thêm án mạng |
| Cái chết | Tránh; nếu đơn là án mạng thì chỉ nói đã mất, không tả thi thể | Được có nạn nhân; tả kín đáo, không chi tiết vết thương |
| Máu, thương tích | Không có | Chỉ nhắc ngắn khi là chứng cứ ("vết máu khô trên mép bàn"), không tả kỹ |
| Hung khí | Không dùng dao, súng làm chứng cứ chính | Được, tả như vật chứng |
| Thuốc độc | Tránh; dùng "thuốc ngủ", "thuốc pha nhầm" | Được (như "Lọ thuốc thứ Năm") |
| Rượu, cờ bạc, nợ nần | Chỉ là bối cảnh, không cổ vũ | Được làm động cơ |
| Ngôn ngữ | Không chửi thề | Có thể gắt, không tục |
| Luôn tránh ở cả hai mức | Bạo lực với trẻ em, bạo lực tình dục, tự hại, tra tấn, chi tiết cách chế chất độc thật | |

## 7. Quy ước tên

- **Không dùng tên người thật**, kể cả nhân vật lịch sử, người nổi tiếng thời đó, hay tên trùng hẳn một người đang sống được biết đến. Không dùng tên công ty, cửa hiệu, khách sạn có thật.
- **Dễ đọc.** Ưu tiên tên 2–3 âm tiết. Vụ tiếng Việt: viết tên có dấu đúng chính tả; tên Nhật để dạng Latinh không dấu (xem `docs/worlds/taisho.md`).
- **Không trùng.** Trong một vụ không có hai nhân vật cùng tên gọi. Cố gắng để chữ cái đầu tên gọi của nghi phạm khác nhau (Tư, Hạnh, Bảy), vì thẻ vân tay, bảng tường dùng chữ viết tắt (`mono`: "TL", "CH", "BS").
- **Tên gọi trong thoại** là cách người ta thật sự gọi nhau: "cậu Bảo", "ông chủ", "anh Bảy". Tên đầy đủ để ở `name` và mô tả.
- **Vai trò** (`role`) ngắn, nói nghề và quan hệ với vụ: "Thợ đồng hồ — người báo mất".
- **Id** dùng tiền tố riêng của vụ, chữ thường, gạch nối, không dấu: `char-dh-ong-tu`, `item-dh-ve-tau`, `evidence-dh-giay-no`.
- **Một gương mặt một vai** trong cùng vụ. NPC thư viện được đóng vai khác ở vụ khác (đổi tên, đổi vai).

## 8. Giọng bíp (`characters[].voice.blip`)

Khoảng giá trị (luật, `docs/case-audio-weather.md`): `pitch` 80–1200 Hz, `speed` 10–40 chữ mỗi giây, `wave` là `square` | `triangle` | `sine` | `sawtooth`, `variance` 0–1.

Gợi ý theo kiểu nhân vật (khuyến nghị):

| Kiểu nhân vật | `pitch` | `speed` | `wave` | `variance` |
| --- | --- | --- | --- | --- |
| Ông lão, người chậm rãi | 140–200 | 12–16 | `triangle` | 0,10–0,20 |
| Đàn ông trung niên điềm tĩnh | 180–260 | 16–20 | `triangle` | 0,15–0,25 |
| Đàn ông thô, cộc, lao động | 120–170 | 18–22 | `square` | 0,30–0,40 |
| Người nóng nảy, láu táu | 250–400 | 26–32 | `square` | 0,35–0,50 |
| Phụ nữ trẻ, nhỏ nhẹ | 450–600 | 20–26 | `sine` | 0,20–0,30 |
| Phụ nữ đứng tuổi, đĩnh đạc | 320–420 | 16–20 | `sine` | 0,10–0,20 |
| Trẻ em | 650–900 | 26–32 | `sine` | 0,35–0,50 |
| Người quyền thế, kiêu | 220–300 | 14–18 | `sawtooth` | 0,05–0,15 |

Vụ mẫu: ông Tư 170 Hz, 15, `triangle`, 0,15; cô Hạnh 520 Hz, 24, `sine`, 0,25; anh Bảy 140 Hz, 20, `square`, 0,35. Trong một vụ, hai nhân vật nên cách nhau ít nhất 60 Hz hoặc khác `wave`.

## 9. Hình: nhân vật và vật phẩm không vẽ chữ

- AI vẽ chữ thường ra chữ vô nghĩa. Prompt PixelLab cho nhân vật, vật phẩm, đồ trang trí luôn ghi "no text or letters". Thư, sổ, vé chỉ vẽ dòng kẻ, không vẽ chữ.
- Chữ người chơi cần đọc (nội dung thư, số trên vé, tên trên thẻ) đặt trong dữ liệu vụ (mô tả vật phẩm, `params` của giải đố), không nằm trong hình.
- Hình lỡ có chữ vô nghĩa thì xóa bằng `asset_process` (`clean_text`), như thẻ thủy thủ của vụ mẫu. Hai vật phẩm thư viện bị hỏng (`all-item-manh-thu-xe` vẽ ra chữ "K", `all-item-trang-giay-trang` gần như vô hình) đã đánh dấu `retired`, không dùng.
- `visualDescription` gửi cho bước hình viết bằng tiếng Anh, chỉ ký tự ASCII; chứng cứ chụp ảnh dùng `visualTextPolicy: NO_TEXT` (yêu cầu của prompt trong `src/BE/Services/AiCaseService.cs`).

## 10. Thời tiết, thời điểm, trong nhà

Theo `docs/case-audio-weather.md`: cảnh trong nhà để `indoor: true` và không có thời tiết; chỉ cảnh ngoài trời có `weather`. Thoại và mô tả phải khớp: đêm mưa thì áo ướt, đèn khí, vũng nước; cảnh trong nhà nghe tiếng mưa gõ cửa kính là được, không có mưa trong phòng.
