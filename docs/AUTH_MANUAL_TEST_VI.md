# Checklist tự kiểm thử authentication

## Môi trường demo đang chạy

- Giao diện: http://127.0.0.1:5174/#/login
- API health: http://127.0.0.1:5216/health
- Tài khoản mẫu: `player1@demo.sirlocked.local`, `player2@demo.sirlocked.local`, `admin@sirlocked.local`.
- Mật khẩu mẫu: `LocalDemo123!`.
- Dữ liệu demo nằm trên MongoDB cục bộ tại cổng 27020, tách khỏi MongoDB Atlas trong `.env`.
- Demo tự xác minh email khi đăng ký. Luồng xác minh email thật cần môi trường riêng với `Auth__AutoVerifyRegistrations=false`.

## Kiểm thử trên giao diện

Đánh dấu từng mục sau khi nhìn thấy kết quả mong đợi.

### Đăng ký

- [ ] Bỏ trống từng ô tên, email, mật khẩu rồi bấm Tạo tài khoản: lỗi hiện ngay dưới ô tương ứng, ô được đánh dấu và nhận focus.
- [ ] Nhập tên một ký tự, email sai định dạng, mật khẩu thiếu chữ hoặc thiếu số: form không gửi và báo lỗi tương ứng.
- [ ] Đăng ký bằng email đã tồn tại: báo email trùng ngay dưới ô email.
- [ ] Đăng ký bằng email mới, mật khẩu hợp lệ: tạo tài khoản và vào trang tiếp theo. Trong demo, email được tự xác minh.
- [ ] Đổi ngôn ngữ Việt/Anh rồi thử lỗi nhập liệu: thông báo trên form đổi ngôn ngữ.

### Đăng nhập và phiên

- [ ] Đăng nhập `player1@demo.sirlocked.local` bằng mật khẩu mẫu: vào được menu.
- [ ] Nhập sai mật khẩu hoặc email chưa tồn tại: thấy lỗi đăng nhập, không vào menu.
- [ ] Để trống email hoặc mật khẩu: lỗi hiện trên form trước khi gửi.
- [ ] Mở trang cần đăng nhập khi chưa có phiên: được đưa về trang đăng nhập.
- [ ] Mở hai tab cùng tài khoản, để phiên hết hạn rồi thao tác: tab còn đăng nhập tự làm mới phiên hoặc yêu cầu đăng nhập lại rõ ràng.
- [ ] Bấm Đăng xuất: trở về đăng nhập; dùng nút Back không truy cập được nội dung cần phiên.

### Đặt lại và đổi mật khẩu

- [ ] Nhập mật khẩu mới thiếu chữ/số, quá ngắn hoặc xác nhận không khớp: lỗi xuất hiện cạnh ô cần sửa.
- [ ] Mở liên kết reset rồi nhập đúng mật khẩu đang dùng: báo lỗi tại ô mật khẩu mới; liên kết vẫn dùng được để nhập một mật khẩu khác.
- [ ] Nếu dùng email thật để thử Quên mật khẩu: thư đến hộp thư; liên kết dùng một lần, hết hạn hoặc đã dùng lại phải bị từ chối.
- [ ] Sau khi đặt lại hoặc đổi mật khẩu: mật khẩu cũ và các phiên cũ không còn dùng được; mật khẩu mới đăng nhập được.

### Google và email thật (cần cấu hình nhà cung cấp)

- [ ] Đăng nhập Google thành công: trở về ứng dụng, không còn token trên thanh địa chỉ.
- [ ] Hủy hoặc từ chối Google: về trang đăng nhập với hướng dẫn thử lại.
- [ ] Khi tắt tự xác minh email: tài khoản mới nhận thư, liên kết xác minh hợp lệ dùng được một lần; trước khi xác minh không vào được game.
- [ ] Gửi lại thư xác minh: liên kết mới hoạt động, liên kết cũ không còn dùng được.

## Lưu ý

Không dùng email của các tài khoản `@demo.sirlocked.local` để kiểm thử nhận thư thật. Muốn dừng dịch vụ demo, chạy `./scripts/stop-local-demo.ps1` tại thư mục gốc dự án.
