# Sổ tay thế giới: Thượng Hải thập niên 1930

Đọc cùng `docs/case-style-guide.md`. Thế giới này dùng chung bộ máy vụ án và 11 loại giải đố với Phố Hàng Đường; chỉ khác tên người, cách xưng hô, trang phục, kiến trúc và đồ vật.

## 1. Mã và phạm vi

| | |
| --- | --- |
| Mã thế giới trong đơn | `SHANGHAI_1930` |
| Thư viện | key tiền tố `c-` (đợt 0 mới có 3 bản đồ ngoài trời); vật phẩm `all-` dùng chung |
| Thời gian | 1930–1935: giữ trong khoảng 1900–1935 chung của các thế giới và tránh xa các năm chiến tranh |
| Không khí | Phố tô giới đèn neon, bến sông có ngân hàng đá và tháp đồng hồ, ngõ thạch khố môn, trà lâu, tiệm cầm đồ; nhạc đĩa hát, xe kéo cạnh tàu điện; giàu nghèo sát vách |

Đặt vụ ở phố, ngõ, cửa hiệu hư cấu ("ngõ Phúc An", "trà lâu Vọng Giang"). Có thể nói chung "phố tô giới", không nêu tên nước quản lý tô giới và không gắn vào sự kiện có thật.

## 2. Thư viện mỏng: báo lượt trước khi làm

Đợt 0 chưa có phòng và NPC nào của Thượng Hải (kế hoạch ghi 8 phòng, 14 NPC; manifest đợt 0 chỉ có 3 bản đồ `c-`). Không mượn NPC Hàng Đường hay Taishō: trang phục sai thời, sai nơi, phạm luật fair play số 1 (ngoại hình phải khớp mô tả).

Bot tính lượt trước khi viết truyện, theo bảng giá của skill `/tao-vu-an` (ảnh 512 là 25 lượt, nhân vật V3 3 lượt, hoạt ảnh đứng yên 1 lượt, vật phẩm 1 lượt; hoạt ảnh thở bằng code 0 lượt):

| Đơn | Cách làm gọn | Lượt ước tính |
| --- | --- | --- |
| Trần 30 lượt | Cả vụ ở 3 bản đồ ngoài trời có sẵn (có thể thêm biến thể đêm, sau mưa), 3–4 NPC mới dùng hoạt ảnh thở bằng code, vài vật phẩm mới | NPC 9–12, vật phẩm 3–6: khoảng 12–18 |
| Trần 60 lượt | Như trên, thêm 1 phòng mới (ví dụ trà lâu); hoặc 2 phòng mới với 3 NPC và 1 vật phẩm | 1 phòng: khoảng 40–45; 2 phòng: 59–60 |
| Cần hơn trần | Hỏi Yen trước, không tự vượt | |

Ảnh mới luôn lấy ảnh `c-` làm tham chiếu phong cách để kho đồng bộ, rồi vào thư viện cho vụ sau. Gợi ý thứ tự vẽ (theo kế hoạch): phòng trà lâu, tiệm thuốc bắc, tiệm cầm đồ, phòng hát, hiệu may sườn xám, nhà in, văn phòng thám tử, sòng mạt chược; NPC ca sĩ, chủ trà lâu, phu xe, cảnh sát tô giới, thương gia, thầy lang, phóng viên, bé bán báo.

## 3. Tên người

Vụ tiếng Việt dùng tên **Hán Việt** (người Việt quen đọc tên Hoa theo cách này); vụ tiếng Anh dùng phiên âm pinyin của cùng tên (Thẩm Ngọc Lan → Shen Yulan). Chọn tên khác chữ cái đầu trong cùng vụ.

| Kiểu | Ví dụ hư cấu |
| --- | --- |
| Họ | Thẩm, Lục, Châu, Kiều, Mạnh, Tiêu, Giang, Phó, Nhan, Lạc, Úc, Hạ, Tần, Diêu |
| Tên nam | Thiếu Khanh, Văn Uyên, Kế Đường, Bá Lâm, Tử Kiện, Gia Hựu, Hạo Nhiên |
| Tên nữ | Ngọc Lan, Mạn Lệ, Uyển Thanh, Tú Phương, Bích Vân, Tố Cầm |
| Nghệ danh ca sĩ | Lam Điệp, Tử Yên, Kim Oanh |
| Tên gọi thân | A Phúc, A Quý (gọi người làm, bạn thân), Tiểu Mai (người trẻ), lão Châu (ông già, ông chủ) |
| Tên cửa hiệu | Trà lâu Vọng Giang, Tiệm cầm đồ Hằng Phong, Tiệm thuốc Bảo An Đường, Hiệu may Cẩm Tú, Nhà in Tân Văn |

Tránh tên người thật nổi tiếng thời đó: ca sĩ, minh tinh, nhà văn, trùm băng đảng, chính khách, nhà tài phiệt; tránh cả tên trùng phát âm với họ.

## 4. Xưng hô

- Người làm gọi chủ: "ông chủ", "bà chủ", "cậu chủ", "tiểu thư".
- Lịch sự với đàn ông có học, khách sang: "tiên sinh" (Thẩm tiên sinh) hoặc "ông Thẩm".
- Thầy lang, thợ cả: "thầy", "sư phụ".
- Người ngang hàng: "anh", "chị", "chú", "cô"; người già: "lão", "bà cụ".
- Nhân chứng nói với thám tử: "tôi", gọi "các anh", "các ông".
- Không chêm từ Hoa phiên âm vào thoại tiếng Việt, trừ tên món, tên đồ không dịch được.

## 5. Trang phục

- Nữ: sườn xám ôm dáng (lụa với người khá giả, vải in hoa với người thường), tóc uốn sóng, khuyên tai ngọc; ca sĩ mặc váy dạ hội hoặc sườn xám lụa óng.
- Nam: trường sam dài, áo khoác ngắn mã quái, mũ phớt; người làm ăn mặc com lê kiểu Tây, cà vạt, đồng hồ bỏ túi.
- Lao động, phu xe: áo cộc vải thô, quần vải, khăn vắt vai, nón.
- Cảnh sát tô giới: đồng phục kiểu Tây, mũ có lưỡi trai.

Khi đã vẽ NPC mới, mô tả trong truyện phải khớp đúng hình đã vẽ.

## 6. Kiến trúc và địa điểm

- Ngõ thạch khố môn: dãy nhà gạch xám liền nhau, khung cổng đá, cửa gỗ sơn đen, sân trời nhỏ, ban công phơi đồ.
- Phố tô giới: nhà nhiều tầng kiểu Tây, biển hiệu dọc, đèn neon buổi tối, đường ray tàu điện.
- Bến sông: tòa ngân hàng bằng đá có hàng cột, tháp đồng hồ, lối đi dạo có đèn, bến tàu thủy và kho hàng.
- Trong nhà: trà lâu bàn tròn và lồng chim, tiệm cầm đồ quầy cao có song gỗ, tiệm thuốc bắc tủ trăm ngăn kéo, phòng hát có sân khấu nhỏ và máy hát.

## 7. Đồ vật đúng thời

| Hợp thời (1930–1935) | Lỗi thời, tránh |
| --- | --- |
| Đèn neon trên phố tô giới, đèn điện, đèn dầu trong ngõ | Màn hình, đèn LED |
| Điện thoại để bàn, điện tín, máy chữ, radio, máy hát đĩa | Điện thoại di động, máy ghi âm cầm tay, tivi |
| Bàn tính, sổ cái, con dấu triện mực đỏ, phiếu cầm đồ, khế ước nhà | Máy tính, thẻ ngân hàng |
| Tiền giấy ngân hàng, đồng bạc | Mệnh giá hiện đại |
| Tàu điện, xe kéo, xe đạp, ô tô của nhà giàu, tàu thủy | Máy bay chở khách như chuyện thường ngày |
| Quân mạt chược, ấm trà đất nung, quạt lụa, lịch treo tường có tranh quảng cáo, đĩa hát | Đồ nhựa, bút bi |
| Thuốc bắc gói giấy, lọ thủy tinh, cân tiểu ly | Vỉ thuốc, viên nang hiện đại |

## 8. Giải đố trong thế giới này

| Loại | Đồ vật hợp với Thượng Hải 1930 |
| --- | --- |
| `fingerprint` Dấu vân tay | Ly rượu ở phòng hát, mép bàn mạt chược, tay nắm két |
| `lockpick` Nạy khóa ổ bi | Hòm gỗ ở tiệm cầm đồ, ngăn kéo bàn làm việc |
| `torn_paper` Ghép mảnh giấy | Phiếu cầm đồ bị xé, thư tình, vé tàu thủy |
| `doc_forgery` Soi tài liệu bị sửa | Khế ước nhà, phiếu cầm đồ, sổ sách trà lâu đóng triện đỏ |
| `music_box` Hộp nhạc lên dây | Hộp nhạc của ca sĩ, giai điệu bài hát trên đĩa |
| `gear_train` Bộ bánh răng đồng hồ | Tháp đồng hồ bến sông, đồng hồ để bàn trong văn phòng |
| `balance_scale` Cân đối chứng | Gói thuốc bắc, cân tiểu ly vàng bạc ở tiệm cầm đồ |
| `parallax_code` Góc nhìn đúng | Biển hiệu neon nhiều lớp, tranh lồng kính, bình phong khắc |
| `tilt_maze` Hộp mê cung nghiêng | Hộp gỗ mê cung đồ chơi, hộp đựng nữ trang có bẫy |
| `reagent_mix` Pha thuốc thử | Mực ẩn, thang thuốc bắc bị tráo, thuốc nhuộm vải |
| `CODE_PUZZLE` | Két sắt ngân hàng, hộp thư khóa số |
| `SEQUENCE_PUZZLE` | Lịch tàu thủy, thứ tự bài hát trong đêm diễn |
| `SYMBOL_MATCH_PUZZLE` | Quân mạt chược, ký hiệu mã hàng trên kiện hàng ở bến |

## 9. Thư viện hình

Key và đường dẫn hình nằm trong `tools/studio-mcp/library/index.json`; tìm bằng `library_search` với `world = SHANGHAI_1930`.

### 9.1. Bản đồ ngoài trời

| Key | Tên | Gợi ý dùng |
| --- | --- | --- |
| `c-map-pho-to-gioi` | Phố tô giới có tàu điện | Đêm đèn neon, móc túi, người đi tàu điện làm chứng |
| `c-map-ben-song` | Bến sông có ngân hàng và tháp đồng hồ | Giờ tàu thủy, vụ ở ngân hàng, giải đố tháp đồng hồ |
| `c-map-ngo-thach-kho-mon` | Ngõ thạch khố môn | Hàng xóm sát vách, tiếng động lúc nửa đêm, cổng đá khóa |

Ba bản đồ này làm được biến thể miễn phí (`asset_variant`: đêm có đèn và cửa sổ sáng, hoàng hôn, sau mưa, lật gương) để có cảnh khác giờ mà không tốn lượt.

### 9.2. Phòng và NPC

Chưa có (xem mục 2).

### 9.3. Vật phẩm

Dùng bộ `all-` (bảng đầy đủ ở `docs/worlds/hang-duong.md`, mục 8.4). Không dùng `all-item-manh-thu-xe` và `all-item-trang-giay-trang` (retired). Hợp với Thượng Hải: chìa khóa đồng, két sắt nhỏ, hộp khóa số, phong bì niêm, ảnh chân dung cũ, sổ cái, biên lai, lá bài, sổ tay nhỏ, lọ thuốc nâu, gói bột (thuốc bắc tán), cối chày đá, kính lúp, lọ nước hoa.

Đồ riêng (quân mạt chược, phiếu cầm đồ, quạt lụa, đĩa hát, con dấu triện) chưa có: vẽ mới bằng PixelLab (vật phẩm 1 lượt), ảnh tham chiếu lấy từ ảnh `c-`, prompt luôn ghi "no text or letters".

## 10. Điều cần tránh

- Tên người thật, tên ngân hàng, khách sạn, vũ trường, cửa hiệu có thật; tên băng đảng và trùm băng đảng có thật.
- Sự kiện lịch sử, chính trị có thật: các trận đánh và cuộc chiến ở Thượng Hải, xung đột giữa các đảng phái, chuyện chính quyền tô giới.
- Thuốc phiện và tiệm hút làm tình tiết (ở mọi mức nội dung); mại dâm.
- Khuôn sáo và định kiến: "kẻ phương Đông bí hiểm", "mỹ nhân rắn rết", người nước ngoài hay người Hoa mặc định là kẻ xấu, người nghèo mặc định là kẻ trộm.
- Bắt chước giọng nói lơ lớ, chế giễu tiếng Hoa, tiếng bồi.
- Đồ vật lỗi thời ở mục 7.
