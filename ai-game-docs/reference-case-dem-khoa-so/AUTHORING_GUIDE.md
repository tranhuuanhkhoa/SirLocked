# Dùng case này làm chuẩn cho case sau

## Quy trình tạo

1. Viết sự thật, động cơ, cách làm, cơ hội và timeline trước. Mỗi kết luận cần có nguồn mà người chơi thật sự đọc, thấy hoặc nghe được.
2. Lập bảng đường đi của từng chứng cứ: nguồn → vai trò nhìn thấy → điều kiện mở → suy luận/đối chất sử dụng.
3. Chia cảnh theo nhịp điều tra. Điều kiện xong cảnh không được yêu cầu thứ chỉ có ở cảnh chưa mở.
4. Giữ `mechanicsVersion: 3`, `PLACEMENT_FIRST`, `logicContractVersion: 1` cho luồng Admin import hiện tại. Thay case ID và toàn bộ ID nội dung bằng một namespace mới.
5. Viết lời thoại, đáp án sai hợp lý và hướng nghi ngờ sai có cách bác. Mỗi màn đối chất chỉ có một cặp đúng về cả logic lẫn cấu hình.
6. Viết gợi ý từ nhẹ đến rõ. Câu đố phải phục vụ việc tìm chứng cứ; không lấy tên thủ phạm làm mã khóa tùy tiện.
7. Lấy sprite Sherlock/Watson và nền pixel đang có làm tham chiếu trước khi tạo ảnh. Tạo nền không chứa NPC hoặc đồ nhặt để tránh hiển thị trùng. Tạo từng sprite riêng có alpha; giữ cùng phong cách và hướng sáng.
8. Đặt tọa độ theo ảnh đã tạo, không gắn tọa độ đoán vào JSON rồi tuyên bố đã kiểm chứng. Chỉ đánh dấu camera `FOUND` sau khi quan sát vùng thật.
9. Validate với backend, kiểm tra toàn bộ tệp ảnh/âm thanh, chơi hai vai đến kết quả. Thử ít nhất một mã sai và một cặp đối chất sai.
10. Chỉ dùng case đã có bằng chứng kiểm thử làm mẫu tiếp theo. Giữ JSON đáp án ngoài frontend public.

## Những hợp đồng cần giữ

| Hợp đồng | Lý do |
| --- | --- |
| `scene.itemIds`/`characterIds`, hotspots và runtime placements cùng tham chiếu đúng ID | Thiếu một phần có thể làm vật tồn tại trong JSON nhưng không click được |
| Hotspot legacy theo %, runtime theo pixel 1600×900 | Hai đơn vị không thể thay thế trực tiếp |
| `item.imageUrl` và placement `asset` đều trỏ đúng ảnh | Renderer và bộ đóng gói có thể đọc hai trường khác nhau |
| Kích thước cutout item tối đa 160×160 | Phù hợp giới hạn validator hiện tại |
| Camera có đúng một zone, source scene, nội dung hình ảnh và tọa độ quan sát thật | Ảnh chụp phải chứng minh được điều clue mô tả |
| Nhánh hội thoại có lựa chọn quay về với `nextNodeId: null` | Giữ đường thoát theo hợp đồng hội thoại chuẩn |
| Mỗi đối chất có 2–4 câu từ cùng dialogue và 3–6 chứng cứ | Khớp mô hình V3; chỉ một cặp được engine coi đúng |
| Reveal đối chất không đồng thời được item/dialogue tự cấp | Bảo toàn vai trò của phối hợp |
| Phần thưởng puzzle bắt buộc được yêu cầu bởi gate/suy luận/cáo buộc | Contract 1 không dựa riêng vào `progressionRole` để chặn thắng |
| Mỗi chứng cứ cuối hỗ trợ một luận điểm cụ thể | Không dùng “đáng ngờ” thay cho chứng minh động cơ/phương thức/cơ hội |
| Không tự điền metadata truth/projection đã duyệt của AI | Import thủ công sẽ xóa metadata đó; đừng gọi nó là server-verified |

## Prompt khởi đầu cho phiên Codex sau

Chuẩn hình ảnh của bản `pixel-v2`:

- Nền phiêu lưu pixel, màu xanh tối/vàng đồng/đỏ rượu; NPC đầu lớn khoảng ba đầu chiều cao. Không ghép NPC hiện thực với người chơi chibi.
- NPC và người chơi cao khoảng 240 đơn vị trong cảnh 1600×900. Giữ tỷ lệ canvas và chừa sàn trống khoảng một phần ba cảnh.
- Bố trí spawn cách NPC và mép màn hình; kiểm tra cả 1440×960 lẫn laptop 1366×768. Không đặt đồ bắt buộc sau thanh công cụ bên phải.
- Giấy nằm trên mặt bàn, hộp đặt trên kệ, chìa treo vào móc. Hotspot bám vật thể với đệm nhỏ; navigation tự chiếu điểm tiếp cận xuống sàn, không cần cột bấm kéo dài hàng trăm pixel.
- Bỏ `depth` cố định ở NPC nếu muốn renderer xếp trước/sau theo bàn chân. Đừng dùng độ sâu của lớp vật phẩm cho nhân vật.
- Chụp cảnh khi đang chơi, trước và sau khi nhặt đồ. Kiểm tra giấy đã ghép không xuất hiện lại, nhân vật không chồng spawn, camera nhắm đúng chi tiết thật. Test đi đến kết thúc không thay thế việc nhìn screenshot.

Prompt của từng ảnh và đường dẫn nguồn nằm trong `asset-prompts.json`; `refresh_asset_manifest.py` kiểm tra alpha và cập nhật hash mà không sửa pixel.

> Đọc `ai-game-docs/reference-case-dem-khoa-so/README.md`, `AUTHORING_GUIDE.md`, `SOLUTION.md` và `case.json` trong repository này. Tạo một case tiếng Việt mới với chủ đề [CHỦ ĐỀ], thời lượng [SỐ PHÚT], dùng cơ chế V3 hiện có. Dùng case tham chiếu làm chuẩn schema và chất lượng, nhưng viết sự thật, nhân vật, timeline, chứng cứ và câu đố riêng. Soạn JSON trong phiên Codex và tạo ảnh bằng ImageGen tích hợp, không gọi API sinh nội dung của ứng dụng hoặc dịch vụ trả phí riêng. Không dùng lại đáp án/nội dung vụ án cũ chỉ bằng đổi tên. Lưu bộ case riêng cùng prompt ảnh, lời giải tác giả, manifest và báo cáo kiểm thử. Kiểm tra không có vòng khóa, cặp đối chất hợp lý khác bị chấm sai, ảnh không khớp hotspot hoặc tài nguyên thiếu. Validate với `tools/ValidateCase`, kiểm tra asset closure, chạy hai vai từ đầu đến kết quả trong database tạm. Giữ nguyên các sửa đổi khác của workspace.

Thay số lượng cảnh và chức năng theo nhịp truyện. Một case hoàn chỉnh không cần nhét mọi loại puzzle; cần mọi bước bắt buộc có mục đích, có lời giải và chơi đến cuối được.

## Hạn mức sinh ảnh

ImageGen tích hợp sử dụng hạn mức chung của Codex theo [tài liệu OpenAI](https://learn.chatgpt.com/docs/image-generation). Chi phí hạn mức phụ thuộc kích thước/chất lượng; không có số ảnh cố định được bảo đảm. Không tự chuyển sang API key, mua credit hoặc dùng lượt reset khi chưa có yêu cầu của chủ tài khoản.
