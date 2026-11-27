# Kế hoạch pipeline v4

Nhánh `feature/pipeline-v4` bắt đầu từ `c1bf2cea`, bản đang chạy khi ghi nhận các lỗi. Dùng vụ **Phong bì ở Bãi Vỏ Sò** làm ca hồi quy.

## Những gì đã xác nhận

- Trang Tạo vụ án lấy phần trăm cố định theo `status`. Polling cập nhật thanh tiến độ nhưng chỉ vẽ lại chi tiết khi đạt trạng thái dừng. Vì vậy, thay đổi trong một bước lớn và các trạng thái phụ có thể xuất hiện chậm.
- Bộ đếm lấy thời điểm mở bản nháp trong trình duyệt. Khi mở lại trang, `Date.now()` thay thế mốc cũ nên thời gian hiển thị bị đặt lại.
- API và bản import lưu một ngôn ngữ. Vụ đã tạo có `language = vi`. Seed, hash, schema và tên bước nội bộ đang xuất hiện trực tiếp trong giao diện.
- Runner xử lý đơn production trong 23 phút 18 giây. `runner.log` có dòng bắt đầu và kết thúc. Log riêng của lượt có hoạt động bridge, PixelLab, import và playtest. Mốc 55% chỉ biểu thị giai đoạn dựng gameplay và chưa cho biết lượng công việc đã hoàn thành.
- Màu tím có trong ảnh nền PNG gốc của PixelLab. Bot đã tạo PNG thay thế có alpha, nhưng tải lên sau khi import bị từ chối với HTTP 409 `BRIDGE_DRAFT_CLOSED`. Bản import vẫn dùng ảnh lỗi.
- Yêu cầu `CutsceneScript` đã được bridge chấp nhận. Báo cáo ghi đã lưu intro ba trang. Game chỉ lấy bản intro đã duyệt và bỏ qua khi truy vấn quá 2,5 giây. Cần kiểm chứng trạng thái bản intro đã lưu, điều kiện API và thời điểm game mở màn.

## Thứ tự triển khai

### 1. Trạng thái, thời gian và giao diện người đặt đơn

- Backend trả giai đoạn, bước hiện tại, trạng thái chờ hoặc đang làm và mốc bắt đầu/kết thúc đã lưu. Tách thời gian toàn đơn khỏi thời gian bước hiện tại. Với bản nháp cũ, suy mốc từ lịch sử trạng thái hoặc ngày tạo.
- `adminAiPage.js` cập nhật cả thanh tiến độ, bước hiện tại và hành động trên bản nháp khi có dữ liệu mới. Tự hồi phục sau lỗi mạng ngắn. Trạng thái hoàn tất chốt bộ đếm.
- Màn chính dùng tên bước dễ hiểu, thí dụ **Đang viết cốt truyện**, **Đang kiểm tra lời khai**, **Đang tạo ảnh**. Dùng mốc thực tế khi xác định được tiến độ. Khi chưa có số đo, hiển thị trạng thái đang xử lý. Chuyển seed, hash, schema và chi tiết sửa theo artifact vào mục **Chi tiết kỹ thuật**.
- Ghi các mốc nhận yêu cầu, đang làm, đã nộp và đang chờ PixelLab vào `runner.log` cho cả hai đường xử lý. Gắn mỗi mốc với mã đơn và mã yêu cầu. Giữ log tool chi tiết trong tệp riêng.

### 2. Kiểm ảnh trước khi import

- Gửi `no_background: true` cho tài nguyên cần nền trong suốt, gồm sprite, vật thể tách rời và cảnh isometric yêu cầu alpha. Giữ cấu hình phù hợp cho map cần phủ kín khung hình.
- Dùng ảnh nhà trực làm mẫu kiểm PNG. Phát hiện vùng chroma tím bão hòa liền mạch ở lỗ cửa, kiểm tra alpha và giữ màu tím hợp lệ trong nội thất. Nếu cần tạo lại, chỉ trả về slot ảnh lỗi. Kiểm đủ các vùng bị che và cửa trước khi import.
- Khi lỗi phát hiện sau import, dùng đường chỉnh vụ trong editor hoặc thiết kế quyền cập nhật có giới hạn cho bản chưa xuất bản. Gắn phát hiện với slot ảnh để người dùng biết cần sửa gì.

### 3. Intro đầu game

- Theo dõi riêng các mốc xếp hàng, đã tạo, đã duyệt và có thể phát. Cập nhật trạng thái từ kết quả intro thực tế thay vì chỉ từ kết quả import.
- Playtest mở màn từ một phiên mới và xác nhận intro thật sự xuất hiện trước khi đánh dấu mục này hoàn tất. Kiểm tra tải chậm, chơi lại, và song ngữ. Khi cần xử lý lỗi, chạy lại riêng intro trên vụ đã có.

### 4. Nội dung tiếng Việt và tiếng Anh

- Một vụ dùng chung dữ kiện, ID, lời giải, ảnh và layout. Sinh ngôn ngữ gốc một lần, rồi tạo bản ngôn ngữ thứ hai từ lớp text đã qua LOGIC.
- Bao phủ tên, mô tả, lời thoại, vật chứng, gợi ý, cáo buộc, kết thúc và intro. Kiểm đủ trường, giữ khóa tham chiếu và đối chiếu các đoạn trích lời khai với lời thoại đã dịch. Chỉ gửi lại các trường dịch lỗi.
- Nối lựa chọn ngôn ngữ từ web đến nội dung trong game. Giữ cơ chế mở các vụ cũ chỉ có một ngôn ngữ.

## Kiểm thử trước khi triển khai

- Đặt một đơn Dễ qua web, tải lại trang giữa hai bước, kiểm tra tiến độ, bộ đếm và khả năng nối log với đúng đơn. Đo riêng từ lúc bấm nút đến hết LOGIC để so với mục tiêu 10–15 phút, rồi ghi riêng thời gian song ngữ, ảnh, intro và playtest.
- Dùng lại PNG gốc và PNG đã sửa để kiểm tra bộ lọc, vùng alpha và màu hợp lệ. Mô phỏng lỗi ở một slot và xác nhận luồng vẫn dùng các ảnh đã đạt.
- Mở vụ ở cả tiếng Việt lẫn tiếng Anh, kiểm intro, chạy một lượt đối chất và buộc tội. Xác nhận hai bản dùng chung lời giải và ảnh.
