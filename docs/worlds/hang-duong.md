# Sổ tay thế giới: Phố Hàng Đường

Thế giới chính của Sir Locked, đúng chất 2 vụ pixel đang chạy ("Lọ thuốc thứ Năm", "Trâm hồng ngọc mất tích") và vụ mẫu "Đồng hồ bỏ túi đêm mưa". Đọc cùng `docs/case-style-guide.md`.

## 1. Mã và phạm vi

| | |
| --- | --- |
| Mã thế giới trong đơn | `HANG_DUONG_VICTORIAN` |
| Thư viện | key tiền tố `v-`, cùng `map-ben-cang`, `room-tiem-dong-ho`, `npc-01-co-ban-hoa`; cộng 6 bối cảnh và 6 nhân vật của 2 vụ pixel; vật phẩm `all-` dùng chung |
| Thời gian | Khoảng 1900–1935. Đèn khí và đèn dầu là chính; điện thoại, máy chữ, ô tô mới có ở nhà giàu và công sở |
| Không khí | Thành phố cảng hư cấu kiểu Victoria (phố gạch, đèn khí, bến cảng, đường sắt) mang hồn phố Việt: tên người, cách xưng hô, nếp buôn bán của phố hàng |

Phố Hàng Đường **không phải** Hà Nội hay một thành phố có thật. Không gắn vào sự kiện lịch sử Việt Nam có thật.

Ghi chú: prompt của server tả thế giới này là "English-style names and dress unless the creator asks otherwise" (`src/BE/Services/AiCaseOrderPolicy.cs`). Cả 3 vụ có sẵn đều dùng **tên Việt** với trang phục kiểu Victoria. Sổ tay này theo 3 vụ có sẵn: vụ tiếng Việt dùng tên Việt; vụ tiếng Anh có thể giữ tên Việt không dấu hoặc dùng tên kiểu Anh nếu đơn yêu cầu.

## 2. Tên người

Cách đặt tên của 3 vụ có sẵn: họ + tên Hán Việt ngắn (Lâm Thế Bảo, Lý Hạnh, Trịnh Lực, Tô Khánh, Đặng Bửu, Phạm Tùng), hoặc tên gọi dân dã theo thứ trong nhà và nghề (Ông Tư Lành, Cô Hạnh, Anh Bảy Sóng).

| Kiểu | Ví dụ hư cấu |
| --- | --- |
| Họ hay dùng | Lâm, Lý, Trịnh, Tô, Đặng, Phạm, Lương, Quách, Mạc, Hứa, Châu, Diệp, Tạ, Kha, Bạch, Văn |
| Tên nam | Thế Bảo, Hữu Định, Quang Thịnh, Văn Cẩn, Đức Lâm, Minh Khiêm, Tấn Phát, Gia Huân |
| Tên nữ | Thu Cúc, Ngọc Trâm, Bích Liên, Mỹ Dung, Tố Nga, Hồng Diệp, Thanh Vân, Kim Thoa |
| Tên gọi dân dã | Ông Tư Lành, Bà Ba Nước, Chú Sáu Xe, Anh Bảy Sóng, Thím Năm, Cô Út Hoa |
| Tên cửa hiệu | Hiệu thuốc Hưng Long, Tiệm vàng Phúc Thịnh, Hiệu may Vạn Xuân, Nhà in Đức Thành, Khách sạn Hải Vọng |
| Tên tàu, xe | Tàu Hải Âu, tàu Sao Mai, chuyến tàu đêm số 7 |

Tránh tên người thật nổi tiếng (nhà văn, chính khách, nhà cách mạng, doanh nhân có thật) và tên cửa hiệu có thật.

## 3. Xưng hô

- Nhân chứng nói với thám tử: "tôi", gọi "các anh", "các ông"; người trẻ, người làm thuê xưng "em", "cháu".
- Người làm trong nhà gọi chủ: "ông chủ", "bà chủ", "cậu Bảo", "cô Hai".
- Thầy trò: "thầy Khánh", "con", "trò".
- Giữa người buôn bán: "anh", "chị", "chú", "bác", gọi theo thứ ("anh Bảy", "chị Ba").
- Không dùng "bạn", "mình" kiểu hiện đại; không dùng "ngài" trừ khi nhân vật cố tỏ ra kiểu cách.

## 4. Trang phục

Hình nhân vật trong thư viện vẽ theo kiểu Victoria. Mô tả trong truyện phải khớp sprite (luật fair play số 1).

- Đàn ông khá giả: áo đuôi tôm hoặc áo khoác dài, gi lê, mũ chóp cao hoặc mũ quả dưa, gậy chống, đồng hồ bỏ túi có dây.
- Người lao động: áo vải thô, tạp dề da, mũ lưỡi trai vải, khăn quàng cổ, ống tay xắn.
- Phụ nữ: váy dài, áo cổ cao, khăn choàng len, tạp dề trắng (người làm), mũ ren hoặc mũ rộng vành (quý bà), áo tang đen (bà góa).
- Thủy thủ: mũ len, áo len dày, râu quai nón.

## 5. Kiến trúc và địa điểm

Phố gạch đỏ, mái đá đen, cửa hiệu có tủ kính bày hàng, đèn khí hai bên đường, mặt đường lát đá có vũng nước khi mưa. Bến cảng có cầu tàu gỗ, kho gạch, trạm hải quan. Ga tàu có đồng hồ lớn. Khu biệt thự có vườn và hàng rào sắt. Trong nhà: sàn gỗ, giấy dán tường, lò sưởi, đèn dầu treo.

## 6. Đồ vật đúng thời

| Hợp thời (1900–1935) | Lỗi thời, tránh |
| --- | --- |
| Đồng hồ bỏ túi, đồng hồ quả lắc, đồng hồ cột ở quảng trường | Đồng hồ đeo tay điện tử, đồng hồ số |
| Đèn khí, đèn dầu, nến; đèn điện ở nơi sang | Đèn neon, đèn huỳnh quang |
| Thư niêm sáp, điện tín, điện thoại quay tay ở công sở | Điện thoại di động, máy fax |
| Máy ảnh hộp, phim kính, thuốc hiện ảnh, buồng tối | Phim cuộn màu, ảnh chụp tức thì |
| Máy chữ, bút máy, mực, giấy than, con dấu | Bút bi, máy tính, máy photocopy |
| Xe ngựa, xe đạp, tàu hơi nước, tàu hỏa; ô tô hiếm | Xe buýt, máy bay chở khách |
| Lọ thuốc thủy tinh nâu, xanh có nút bần; cân tiểu ly | Vỉ thuốc nhựa, ống tiêm nhựa |
| Sổ cái, phiếu cầm đồ, biên lai, vé tàu bằng bìa | Thẻ ngân hàng, vé in máy hiện đại |
| Tiền tính bằng "đồng" (vụ mẫu: nợ 40 đồng, đồng hồ giá chừng 60 đồng) | Tiền tệ hiện đại có mệnh giá lớn |

## 7. Giải đố trong thế giới này

| Loại | Đồ vật hợp với Hàng Đường |
| --- | --- |
| `fingerprint` Dấu vân tay | Mép khay đồng, tay nắm tủ kính, ly rượu trong quán, hộp nữ trang |
| `lockpick` Nạy khóa ổ bi | Hòm sắt cạnh cửa, ngăn kéo bàn giấy thư phòng, rương trên gác xép |
| `torn_paper` Ghép mảnh giấy | Thư xé trong lò sưởi, vé tàu rách, tờ báo bị xé |
| `doc_forgery` Soi tài liệu bị sửa | Di chúc, sổ nợ, phiếu cầm đồ, sổ khách sạn |
| `music_box` Hộp nhạc lên dây | Hộp nhạc của quý bà, đàn trong hậu trường nhà hát |
| `gear_train` Bộ bánh răng đồng hồ | Đồng hồ quả lắc, đồng hồ quảng trường, đồng hồ ga tàu |
| `balance_scale` Cân đối chứng | Lọ thuốc ở hiệu thuốc, cân tiểu ly hiệu vàng |
| `parallax_code` Góc nhìn đúng | Phông chụp hiệu ảnh, kính màu, bức tranh nhiều lớp trong thư phòng |
| `tilt_maze` Hộp mê cung nghiêng | Hộp mê cung đồ chơi của trẻ, hộp bí mật trong rương |
| `reagent_mix` Pha thuốc thử | Thuốc hiện ảnh, mực hóa học ở phòng khám, thuốc thử ở hiệu thuốc |
| `CODE_PUZZLE` | Tủ kính khóa số, két sắt có núm số |
| `SEQUENCE_PUZZLE` | Hành trình theo lịch tàu, thứ tự giao hàng trong sổ |
| `SYMBOL_MATCH_PUZZLE` | Ký hiệu trên thùng hàng bến cảng, dấu xưởng trên đồng hồ |

## 8. Thư viện hình

Key và đường dẫn hình nằm trong `tools/studio-mcp/library/index.json` sau khi nhập thư viện; tìm bằng `library_search` với `world = HANG_DUONG_VICTORIAN`.

### 8.1. Bản đồ ngoài trời (top-down, 512×512)

| Key | Tên | Gợi ý dùng |
| --- | --- | --- |
| `map-ben-cang` | Bến cảng | Cầu tàu, kho hàng, trạm hải quan; trộm hàng, tàu sắp nhổ neo. Đã có biến thể đêm mưa ở vụ mẫu |
| `v-map-ga-tau` | Ga tàu và quảng trường | Hành khách, vé tàu, giờ tàu chạy; chứng cứ ngoại phạm |
| `v-map-cho` | Phố chợ | Hàng quán, đông người qua lại; người bán rong làm nhân chứng |
| `v-map-cong-vien-ho` | Công viên bờ hồ | Hẹn gặp bí mật, dạo đêm, vật rơi xuống hồ |
| `v-map-biet-thu` | Khu biệt thự | Nhà giàu, gia sản, người hầu |

Bản đồ có sẵn trong 2 vụ pixel: **Phố Hàng Đường** (`/assets/pixel/lo-thuoc-thu-nam/scenes/pho.png`, có 8 đồ tiền cảnh: xe ngựa, xe đẩy, đồng hồ quảng trường, 4 cột đèn, cây). Đã có vùng đi được trong 2 vụ đó.

### 8.2. Phòng (isometric, 512×512)

| Key | Tên | Gợi ý dùng |
| --- | --- | --- |
| `room-tiem-dong-ho` | Tiệm đồng hồ | Giải đố bánh răng; đã có biến thể lật gương, tường đỏ rượu |
| `v-room-hieu-vang` | Hiệu vàng | Trộm trang sức, cân vàng, sổ cầm cố |
| `v-room-hieu-may` | Hiệu may | Vải, khuy áo, đo người: chứng cứ về vóc dáng |
| `v-room-hieu-sach` | Hiệu sách | Thư kẹp trong sách, sách hiếm |
| `v-room-xuong-in` | Xưởng in | Giấy tờ giả, bản in, mực |
| `v-room-quan-ruou` | Quán rượu | Nhân chứng say, nợ nần, đánh bài |
| `v-room-phong-tra` | Phòng trà | Hẹn gặp, tách trà, hầu bàn làm chứng |
| `v-room-sanh-khach-san` | Sảnh khách sạn | Sổ khách, bảng chìa khóa phòng |
| `v-room-phong-khach-san` | Phòng khách sạn | Hành lý, khách lạ, cửa khóa trong |
| `v-room-so-canh-sat` | Sở cảnh sát | Hồ sơ, tang vật, điện thoại |
| `v-room-toa-soan` | Tòa soạn báo | Bài báo, máy chữ, tin đồn |
| `v-room-phong-kham` | Phòng khám | Thuốc, đơn thuốc, giờ khám |
| `v-room-hau-truong` | Hậu trường nhà hát | Diễn viên, phục trang, gương đèn |
| `v-room-thu-phong` | Thư phòng | Di chúc, két, bàn giấy |
| `v-room-phong-ngu` | Phòng ngủ | Bàn trang điểm, nước hoa, tủ áo |
| `v-room-gac-xep` | Gác xép | Rương cũ, đồ phủ vải, chỗ trốn |
| `v-room-ham-ruou` | Hầm rượu | Thùng rượu, lối đi bí mật |

Phòng có sẵn trong 2 vụ pixel (`/assets/pixel/lo-thuoc-thu-nam/scenes/`): **Nhà số 7, phòng trưng bày** (`nha-so-7.png`), **Hiệu thuốc Hưng Long** (`hieu-thuoc.png`), **Nhà xe và phòng tài xế** (`nha-xe.png`), **Tiệm cầm đồ** (`cam-do.png`), **Hiệu ảnh** (`hieu-anh.png`).

### 8.3. Nhân vật (NPC)

"Có hoạt ảnh": PixelLab đã làm hoạt ảnh đứng yên. NPC khác dùng hoạt ảnh thở làm bằng code (`asset_process`, `idle_breathe`, 0 lượt).

| Key | Tên | Ghi chú |
| --- | --- | --- |
| `npc-01-co-ban-hoa` | Cô bán hoa | Có hoạt ảnh. Vụ mẫu: cô Hạnh |
| `v-npc-02-quan-gia` | Quản gia già | Có hoạt ảnh |
| `v-npc-03-hau-gai` | Hầu gái trẻ | Có hoạt ảnh |
| `v-npc-04-canh-sat` | Cảnh sát tuần phố | Có hoạt ảnh |
| `v-npc-05-thanh-tra` | Thanh tra | |
| `v-npc-06-nha-bao` | Nhà báo trẻ | |
| `v-npc-07-bac-si` | Bác sĩ già | |
| `v-npc-08-y-ta` | Y tá | |
| `v-npc-09-ca-si-opera` | Nữ ca sĩ opera | |
| `v-npc-10-nhac-cong` | Nhạc công vĩ cầm | |
| `v-npc-11-thuy-thu` | Thủy thủ | Vụ mẫu: anh Bảy Sóng |
| `v-npc-12-phu-ben-cang` | Phu bến cảng | |
| `v-npc-13-tre-ban-bao` | Bé bán báo | Nhân chứng nhỏ tuổi; ở mức LIGHT không cho làm hung thủ |
| `v-npc-14-quy-ba` | Quý bà | |
| `v-npc-15-quy-ong` | Quý ông (mũ chóp, kính một mắt) | |
| `v-npc-16-ong-lao` | Ông lão chống gậy | |
| `v-npc-17-ba-goa` | Bà góa áo tang | |
| `v-npc-18-tho-dong-ho` | Thợ đồng hồ | Vụ mẫu: ông Tư Lành |
| `v-npc-19-chu-quan-ruou` | Chủ quán rượu | |
| `v-npc-20-hau-ban-tra` | Cô hầu bàn phòng trà | |
| `v-npc-21-linh-muc` | Linh mục | Chỉ làm nhân chứng; tôn trọng tôn giáo |
| `v-npc-22-tho-anh-rong` | Thợ ảnh rong | |
| `v-npc-23-giao-su` | Giáo sư | |
| `v-npc-24-xa-phu` | Xà ích xe ngựa | |
| `v-npc-25-ke-moc-tui` | Kẻ móc túi | Dễ thành nghi phạm giả; đừng để "trông gian" là chứng cứ |

Dàn nhân vật của 2 vụ pixel (`/assets/pixel/lo-thuoc-thu-nam/characters/`, mỗi người có sprite đứng yên 9 khung và chân dung): **Lâm Thế Bảo** (cháu nhà họ Lâm), **Lý Hạnh** (người giúp việc lâu năm), **Trịnh Lực** (tài xế), **Tô Khánh** (thợ ảnh), **Đặng Bửu** (chủ tiệm cầm đồ), **Phạm Tùng** (học việc hiệu thuốc). Có thể quay lại như nhân vật quen; giữ đúng nghề, tính cách và quá khứ đã kể.

### 8.4. Vật phẩm

Vật phẩm thử nghiệm của Hàng Đường (tiền tố `item-`):

| Key | Tên | Ghi chú |
| --- | --- | --- |
| `item-dong-ho-bo-tui-vo` | Đồng hồ bỏ túi vỡ mặt kính | Dây đứt ngắn |
| `item-ve-tau-rach` | Vé tàu rách | Có dấu in: chạy `clean_text` trước khi dùng (vụ mẫu đã xóa chữ vô nghĩa) |
| `item-lo-thuoc-doc` | Lọ thuốc độc thủy tinh xanh | Có nhãn giấy: kiểm chữ trên nhãn; ở mức LIGHT đổi thành lọ thuốc ngủ |

Vật phẩm dùng chung mọi thế giới (tiền tố `all-`, đều vẽ không chữ):

| Key | Tên | Gợi ý dùng |
| --- | --- | --- |
| `all-item-chia-khoa-dong` | Chìa khóa đồng chạm trổ | Chìa két, chìa hộp nữ trang |
| `all-item-chia-khoa-sat` | Chìa khóa sắt cổ | Cửa hầm, cửa sau |
| `all-item-chum-chia-khoa` | Chùm ba chìa khóa | Người giữ chìa của nhà |
| `all-item-o-khoa-vo` | Ổ khóa gãy càng | Dấu phá khóa |
| `all-item-hop-khoa-so` | Hộp sắt khóa số | Đích của giải đố mã số |
| `all-item-bo-mo-khoa` | Cuộn đồ mở khóa | Chứng cứ phương thức |
| `all-item-ket-sat-nho` | Két sắt nhỏ có núm số | Đích của giải đố |
| `all-item-hom-go` | Hòm gỗ đai sắt | Chỗ giấu đồ (vụ mẫu) |
| `all-item-phong-bi-niem` | Phong bì niêm sáp đỏ | Thư bí mật, di chúc |
| `all-item-manh-thu-xe` | Mảnh thư xé | **Retired, không dùng** (vẽ ra chữ "K") |
| `all-item-ban-do-gap` | Bản đồ gấp | Đường đi, chỗ hẹn |
| `all-item-anh-chan-dung` | Ảnh chân dung cũ trong khung | Quan hệ, thân phận; người trong ảnh phải khớp mô tả nhân vật |
| `all-item-so-cai` | Sổ cái bìa da | Sổ sách, nợ nần |
| `all-item-nhat-ky-khoa` | Nhật ký có khóa đồng | Bí mật cá nhân |
| `all-item-bien-lai` | Biên lai | Mốc giờ, số tiền (vụ mẫu: giấy đòi nợ) |
| `all-item-the-bai` | Lá bài át bích | Cờ bạc, ám hiệu |
| `all-item-quan-co-ma` | Quân mã cờ vua | Ám hiệu, vật kỷ niệm |
| `all-item-trang-giay-trang` | Tờ giấy trắng | **Retired, không dùng** (gần như vô hình) |
| `all-item-so-tay-nho` | Sổ tay nhỏ kèm bút chì | Ghi chép của nạn nhân |
| `all-item-lo-thuoc-nau` | Lọ thuốc thủy tinh nâu | Thuốc thường, thuốc bị tráo |
| `all-item-goi-bot` | Gói bột trắng | Thuốc ngủ, thuốc thử; không gợi ma túy |
| `all-item-ong-tiem` | Ống tiêm thủy tinh cổ | Phòng khám; mức STANDARD |
| `all-item-hop-thuoc-thiec` | Hộp thuốc thiếc | Thuốc uống hằng ngày |
| `all-item-coi-chay` | Cối chày đá | Nghiền thuốc |
| `all-item-binh-thuy-tinh` | Bình thí nghiệm nước xanh | Thuốc thử |
| `all-item-gia-ong-nghiem` | Giá ba ống nghiệm | Phòng thí nghiệm, pha thuốc thử |
| `all-item-kinh-lup` | Kính lúp đồng | Dụng cụ soi |
| `all-item-binh-nuoc-hoa` | Lọ nước hoa pha lê | Mùi hương để lại, quà tặng |

Thiếu thứ gì thì theo luật dùng lại của skill `/tao-vu-an`: có sẵn đúng chỗ thì dùng lại; trùng ý tưởng thì làm biến thể (`asset_variant`); mới hẳn thì vẽ PixelLab với ảnh tham chiếu của Hàng Đường (phong cách `pho.png`, `hieu-thuoc.png`), trong trần lượt của đơn.

## 9. Điều cần tránh

- Tên người thật, tên cửa hiệu, khách sạn, tờ báo có thật.
- Gắn vụ vào sự kiện lịch sử, chính trị có thật (chiến tranh, phong trào, nhân vật lịch sử).
- Định kiến: không cho người nghèo, người làm thuê, người nước ngoài hay người theo đạo nào mặc định là kẻ xấu; kẻ móc túi trông gian không phải chứng cứ.
- Ma quỷ, lời nguyền thật (được có tin đồn, nhưng lời giải luôn là chuyện người làm).
- Đồ vật lỗi thời ở mục 6.
- Nhân vật mặc hoặc làm điều trái với sprite đã chọn.
