# Mẫu xây case dài từ Chuyến tàu số 7

Mẫu này bổ sung cho case ngắn Đêm khóa sổ. Dùng cấu trúc và quy trình kiểm chứng, không chỉ tăng số câu thoại. Mỗi hồi phải thay đổi điều người chơi biết và yêu cầu một thao tác hoặc suy luận mới.

## Cấu trúc cần giữ

| Lớp | Quy tắc |
| --- | --- |
| Sự thật | Viết timeline trước. Phân biệt thời điểm ký nhận, di chuyển vật lý, giờ trên đồng hồ và giờ chuẩn |
| Chứng cứ | Mỗi kết luận quan trọng có nguồn kiểm tra riêng; ảnh chỉ khẳng định chi tiết thực sự nhìn thấy |
| Hồi | Hai cảnh thu thập → đối chất → suy luận → clue mở hồi. `completeCondition` yêu cầu clue thưởng từ suy luận |
| Hai vai trò | Điều tra viên giữ vật chứng, thẩm vấn viên giữ lời khai; giải bằng cặp được hai người xác nhận |
| Nghi ngờ sai | Có cách kiểm chứng để bác/giới hạn, không chỉ đưa chi tiết gây nhiễu vô nghĩa |
| Puzzle | Mã, ký hiệu và thứ tự có quy tắc đọc được trong game; không dựa vào đoán hoặc chữ li ti trên ảnh |
| NPC lặp lại | Chỉ mở câu hậu kỳ bằng `requiredClueIds`. Contract nhập thủ công 1 không dùng `availableSceneIds` để khóa lời thoại |
| Kết thúc | Nối động cơ, hành vi và cơ hội bằng ba chứng cứ. Một lời nói dối không tự chứng minh cả vụ án |

## Những ràng buộc runtime đã gặp

1. `completeCondition.requiredItemIds` là các vật đã khám, không phải vật đang trong inventory. Vật thưởng của puzzle cần mở clue để dùng làm điều kiện tiến trình.
2. Mỗi clue thưởng hồi có `sourceType/discoverMethod: deduction`, `source` là ID suy luận thật, và ID clue phải nằm trong `unlockClueIds` của suy luận. Validator trong thay đổi này hỗ trợ và kiểm tra nguồn này.
3. Reveal của đối chất chỉ được trao bởi đối chất. Không để khám đồ hoặc hỏi lại NPC trao cùng reveal và vô tình bỏ qua phối hợp.
4. Các mảng readiness rỗng có thể dùng toàn bộ candidates làm mặc định. Ghi rõ tập cần thiết, tối thiểu hai chứng cứ/hai mảnh lời khai. Không đưa vật chỉ ở hồi sau vào điều kiện mở đối chất hồi trước.
5. Một NPC có một root hội thoại chung, các topic theo bằng chứng. Mẫu dùng nhánh một cấp, có nút quay lại và đóng rõ ràng.
6. `unlockSceneIds` có thể mở đường đi sớm. Mẫu không dùng chúng để vượt chuỗi cảnh; clue gate và điều kiện hoàn tất đảm nhiệm tiến trình chính.
7. Hai cửa chuyển phòng không được trùng hotspot. Vùng ảnh camera phải khớp chi tiết đã xem trong PNG và đủ lớn so với khung chụp.
8. Dùng đường dẫn tài nguyên mới và ID mới. Không đưa JSON chứa đáp án hoặc lời giải vào `public`.

## Quy trình cho case tiếp theo

Viết sự thật → gắn nguồn cho từng kết luận → thiết kế chốt cuối mỗi hồi → khai báo puzzle/interaction/reward → đặt readiness đúng hồi → soạn lời khai có một mệnh đề sai cụ thể → viết phản hồi không tiết lộ đáp án khi sai → tạo ảnh theo cùng reference → xem từng ảnh để đặt vật/NPC/vùng chụp → validate → chạy hai trình duyệt qua toàn bộ case → xem ảnh desktop/laptop → playtest người thật.

Prompt ảnh cụ thể và reference đã dùng nằm trong `asset-prompts.json`. Giữ tỷ lệ NPC, độ cao camera, bảng màu gỗ/đồng/xanh đêm và lối đi phía trước. Nền chỉ có đồ trang trí và chi tiết camera; vật có thể nhặt là cutout riêng. Không để bộ sinh ảnh tự quyết định nội dung chứng cứ hoặc cài đáp án vào cảnh sai.

Test point-and-click dùng vòng tiến trình theo từng cảnh: hỏi/khám → ghép/dùng → giải đố → đối chất/suy luận → quay lại câu hỏi vừa mở. Dừng khi không còn trạng thái thay đổi và kiểm tra điều kiện hoàn tất. Test chỉ gọi API để thiết lập phòng và đọc trạng thái; hành động điều tra đều qua giao diện. Các case dài không thể dùng bài test “đi hết cảnh rồi mới giải tất cả đối chất”.

Chỉ ghi PASS cho bằng chứng đã thực thi. Thời gian test tự động không phải thời lượng người chơi; không dùng nó để quảng bá độ dài hoặc độ khó.
