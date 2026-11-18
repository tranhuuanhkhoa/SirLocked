# Truy cập VPS SirLocked từ máy Windows khác

Hướng dẫn này dành cho **máy của chính anh**. VPS hiện dùng tài khoản Ubuntu `azureuser`, xác thực bằng khóa SSH và truy cập quản trị qua Tailscale.

## Thông tin kết nối

| Mục | Giá trị |
| --- | --- |
| Tên VM | `sirlocked-api` |
| User Ubuntu | `azureuser` |
| IP Tailscale của VM | `100.114.189.15` |
| Khóa riêng trên máy hiện tại | `D:\KiCuoiRoi\sirlocked-api_key.pem` |

Địa chỉ IP công cộng `20.239.65.133` không dùng cho cách kết nối này vì cổng SSH công cộng đã được đóng. Khi VM ở trạng thái **Stopped (deallocated)**, cần vào Azure Portal bật VM trước. Sau khi bật, kiểm tra lại IP Tailscale nếu kết nối tới địa chỉ trên không được.

## 1. Cài và kết nối Tailscale trên máy mới

1. Cài Tailscale từ <https://tailscale.com/download/windows>.
2. Đăng nhập tài khoản Tailscale đang quản lý VM `sirlocked-api`.
3. Mở Tailscale và xác nhận trạng thái **Connected**.

## 2. Chuyển khóa SSH sang máy mới

Chuyển file `sirlocked-api_key.pem` từ máy hiện tại sang **máy riêng của anh** bằng cách an toàn, ví dụ USB cá nhân hoặc kênh truyền tệp được mã hóa. Không dán nội dung khóa vào chat, email hay Git. Sau khi chuyển, lưu tại `C:\Users\<ten-user>\.ssh\sirlocked-api_key.pem` trên máy mới và xóa các bản sao tạm.

Trong PowerShell trên máy mới, đặt quyền đọc khóa cho tài khoản Windows hiện tại. Thay đường dẫn trong biến `$keyPath` theo nơi anh đã lưu:

```powershell
$keyPath = "$env:USERPROFILE\.ssh\sirlocked-api_key.pem"
icacls.exe $keyPath /inheritance:r
icacls.exe $keyPath /remove:g '*S-1-5-11' '*S-1-5-32-545' '*S-1-1-0'
icacls.exe $keyPath /grant:r "${env:USERNAME}:R"
```

Nếu thư mục `.ssh` chưa có, tạo bằng `New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh"` trước khi chép file.

## 3. Kết nối SSH

Mở PowerShell và chạy:

```powershell
ssh -i "$env:USERPROFILE\.ssh\sirlocked-api_key.pem" azureuser@100.114.189.15
```

Lần kết nối đầu, SSH sẽ hỏi xác nhận khóa máy chủ. Chỉ gõ `yes` sau khi đối chiếu fingerprint với bản ghi trên máy đã kết nối trước đó. Fingerprint đã thấy trong lần kết nối trước là `SHA256:jPoeucehg2pZdjDv2iJpxleXtljFXt+FEVFqk88aB4Q`; nếu khác, dừng lại và kiểm tra VM.

Khi thấy dấu nhắc `azureuser@sirlocked-api:~$`, kết nối đã thành công. Có thể kiểm tra dịch vụ bằng:

```bash
systemctl is-active sirlocked-api cloudflared
curl -i http://127.0.0.1:5215/health
```

## Nếu kết nối thất bại

- **Connection timed out / Permission denied trước khi hỏi khóa:** kiểm tra VM đang Running, Tailscale trên máy mới đang Connected và máy `sirlocked-api` hiện trong Tailscale. Không mở cổng 22 công cộng chỉ để khắc phục lỗi này.
- **Permission denied (publickey):** kiểm tra đúng user `azureuser`, đúng file `.pem`, quyền file và khóa có khớp VM.
- **WARNING: UNPROTECTED PRIVATE KEY FILE:** chạy lại các lệnh `icacls` ở bước 2; không cấp quyền đọc khóa cho `Everyone` hay `Authenticated Users`.
- **REMOTE HOST IDENTIFICATION HAS CHANGED:** dừng lại và xác minh fingerprint qua Azure hoặc máy đã tin cậy trước khi sửa `known_hosts`.

## Cho bạn cùng team quản lý VPS

Không gửi cho bạn file `.pem` của anh và không dùng chung tài khoản `azureuser`. Bạn ấy nên tạo cặp khóa SSH riêng, gửi **chỉ khóa công khai `.pub`** cho anh. Sau đó tạo user Ubuntu riêng cho bạn ấy, thêm khóa công khai vào `authorized_keys`, cấp `sudo` nếu thật sự cần toàn quyền, và share riêng máy `sirlocked-api` qua Tailscale. Nếu bạn ấy cần bật/tắt hoặc cấu hình VM trên Azure Portal, cấp thêm quyền Azure IAM tại phạm vi VM hoặc resource group. Quyền IAM không thay thế quyền SSH.
