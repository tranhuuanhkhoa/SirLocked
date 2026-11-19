# Nạp xu qua payOS

Triển khai theo cấu trúc hiện tại: ASP.NET Core 9 / MongoDB standalone / Vite SPA dùng địa chỉ thật (không còn `#`).
Trang người chơi: `/payments`, chi tiết đơn: `/payments/{orderCode}`; đơn tạo trước khi bỏ `#` có return URL `/#/payments/{orderCode}` và vẫn được chuyển đúng trang; lối vào **Chợ đồ → Nạp xu**.

## Gói mẫu và bật tính năng

| Gói | Tiền chuyển khoản (VND) | Xu nhận |
|---|---:|---:|
| starter | 10.000 | 1.000 |
| detective | 50.000 | 5.000 |
| master | 100.000 | 10.000 |

Đây là gói mẫu được chủ dự án cho phép dùng khi phát triển, chưa phải bảng giá thương mại đã chốt.
Mặc định `PayOS:Enabled=false`: trang vẫn xem được nhưng không tạo đơn hay gọi payOS.
Giá và số xu được lấy từ server; frontend chỉ gửi `packageId` và `requestId`.
Mỗi đơn lưu lại giá/số xu lúc tạo, không thay đổi khi sửa bảng giá sau đó.

1. Tạo **kênh thanh toán riêng cho SirLocked** trên https://my.payos.vn. Không dùng lại kênh đang nhận webhook của website khác.
2. Sao chép các dòng trong `config/payos.env.example` vào `.env` hiện có ở gốc repo; không ghi đè các cấu hình DB/JWT khác.
3. Điền `PayOS__ClientId`, `PayOS__ApiKey`, `PayOS__ChecksumKey` trên máy/server. Không đưa các khóa này vào frontend, Git hay chat.
4. Khi sẵn sàng kết nối, đổi `PayOS__Enabled=true`, giữ `PayOS__FrontendUrl=http://localhost:5173` cho thử local.
5. Khởi động lại backend sau khi sửa `.env`.

## Thử local

Chạy backend theo cấu hình database hiện tại của dự án:

```powershell
dotnet run --project src/BE/SirLocked.Api.csproj --urls http://localhost:5215
```

Trong terminal khác:

```powershell
cd src/FE
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite mặc định proxy `/api` tới `http://localhost:5215` (xem `src/FE/config/apiUrls.js`). Nếu backend dùng cổng khác, đặt `VITE_API_URL` tương ứng trước khi chạy Vite.
Đăng nhập bằng tài khoản người chơi và mở `http://localhost:5173/payments`.

### Webhook về máy local

payOS không gọi được `localhost` trên máy của bạn. Dùng tunnel HTTPS (ví dụ Cloudflare Tunnel hoặc ngrok) trỏ tới backend `http://localhost:5215`.
Nếu đã cài Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:5215`.
Sau khi có URL HTTPS, cấu hình webhook của **kênh SirLocked** tại payOS:

```text
https://<domain-tunnel>/api/payments/payos/webhook
```

Không đặt webhook thành địa chỉ frontend, return URL, hoặc thêm `/#/`.
Khi lưu webhook, payOS gửi giao dịch mẫu có chữ ký. Backend xác minh chữ ký, trả HTTP 200 cho mã đơn không tồn tại và không cộng xu.
Không bật CDN challenge, đăng nhập hay xác thực trình duyệt trước endpoint webhook. Endpoint chỉ tin chữ ký và dữ liệu truy vấn lại từ payOS.
Nếu URL tunnel thay đổi, cập nhật webhook trên payOS.

payOS hiện **không có sandbox riêng**, nên chuyển khoản thử là tiền thật. Các kiểm thử tự động trong repo dùng provider giả và MongoDB riêng, không gọi API payOS hay chuyển tiền.
Nguồn: https://payos.vn/docs/moi-truong-test/ .

Sau khi anh cấu hình xong, thử một đơn nhỏ và xác nhận:

- Trang hiện QR, số tài khoản, nội dung và thời hạn. Có nút mở trang payOS chính thức.
- Chuyển đúng số tiền/nội dung; webhook trả 2xx; trạng thái chuyển sang `CREDITED` và ví tăng đúng số xu.
- Tải lại, quay lại URL kết quả hoặc gửi lại webhook không tăng thêm xu.
- Hủy đơn/hết hạn không cộng xu; thanh toán một phần chờ đủ tiền; thừa tiền chuyển `REVIEW` để đối soát thủ công.

## Luồng và tính nhất quán

- `paymentOrders._id` là mã số trong giới hạn số nguyên an toàn của JavaScript, suy ra từ user + requestId. Cùng yêu cầu luôn quay về cùng đơn; xung đột caller/gói bị từ chối.
- Ghi đơn `CREATING` trước khi gọi payOS. Khi timeout, giữ đơn và truy vấn lại cùng mã trước khi thử tạo lại.
- Chữ ký HMAC-SHA256 theo tài liệu payOS được kiểm tra bằng so sánh constant-time. Response API cũng được kiểm tra chữ ký.
- Webhook là thông báo để backend truy vấn trạng thái payOS. Chỉ `PAID`, đúng mã/link/số tiền và `amountPaid == amount` mới được cấp xu.
- Tham số `status`, `code`, `cancel` trong URL trình duyệt không có quyền đánh dấu thanh toán.
- Trạng thái đơn: `CREATING → PENDING → PAID → CREDITED`; nhánh khác: `CANCELLED`, `EXPIRED`, `REVIEW`.
- Số dư và `marketAccounts.paidTopUpIds` ghi cùng một cập nhật Mongo nguyên tử. Dấu nạp tiền **không bị cắt** theo cửa sổ `ops` của chợ đồ. Worker khôi phục `PAID` nếu server dừng giữa bước cộng ví và cập nhật đơn.
- Worker chạy mỗi 30 giây, tối đa 30 đơn/lượt; truy vấn lại đơn chưa hoàn tất trong 7 ngày, và mọi đơn `PAID` chưa cấp xu. Mở chi tiết đơn cũng kích hoạt đối soát, có giới hạn tần suất.
- Các thao tác đọc/hủy đơn kiểm tra chủ sở hữu; webhook không cần JWT nhưng bắt buộc chữ ký hợp lệ. API người dùng giới hạn 60 request/phút/người.
- Tiền sử chuyển khoản chỉ hiển thị 50 đơn gần nhất; dữ liệu gốc không tự xóa và không đặt TTL.

## API

| Endpoint | Quyền | Tác dụng |
|---|---|---|
| `GET /api/payments/packages` | Đăng nhập | Gói nạp và trạng thái mở/tắt |
| `POST /api/payments/orders` | Đăng nhập | `{packageId, requestId}` tạo hoặc lấy lại đơn |
| `GET /api/payments/orders` | Đăng nhập | 50 đơn gần nhất của người gọi |
| `GET /api/payments/orders/{code}` | Chủ đơn | Đọc và đối soát trạng thái |
| `POST /api/payments/orders/{code}/cancel` | Chủ đơn | Hủy tại payOS, xử lý nếu tiền đã đến trước |
| `POST /api/payments/payos/webhook` | Chữ ký payOS | Nhận thông báo và xác nhận lại tiền |

## Kiểm thử tự động

```powershell
dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter FullyQualifiedName~PayOsTests
$env:SIRLOCKED_RUN_MONGO_IT='true'
$env:SIRLOCKED_TEST_MONGO='mongodb://127.0.0.1:27028'
dotnet test src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj --filter FullyQualifiedName~MongoPaymentTests
cd src/FE
npx playwright test tests/payments.spec.ts --workers=1
npm run typecheck
npm run build
```

Mongo integration tests chỉ chấp nhận loopback và tạo/xóa database riêng có tiền tố `sirlocked_it_payments_`.

Kết quả kiểm tra ngày 05/11/2026: 8 unit tests payOS, 8 integration tests Mongo/API và 5 bài Playwright đều đạt;
frontend typecheck đạt. Đã xem ảnh desktop 1280px và mobile 390px, QR không tràn màn hình.
Build backend vẫn báo các cảnh báo có sẵn về ImageSharp 3.1.11 và nullable trong `CaseValidationService`;
phần triển khai thanh toán không nâng cấp các dependency không liên quan.

## Vận hành và giới hạn

- Chưa xác thực giao dịch payOS thật cho tới khi có kênh, khóa, tunnel/webhook và một chuyển khoản do chủ tài khoản thực hiện.
- `REVIEW` và chuyển khoản sai nội dung cần đối soát thủ công trên dashboard payOS cùng `paymentOrders`. Không có nút admin tự đánh dấu đã trả tiền.
- Chưa triển khai chi hộ/hoàn tiền tự động. Nạp xu không phải mua VIP/vụ án; không đổi role tài khoản.
- Giữ cả `paymentOrders` và `paidTopUpIds` khi backup/restore. Không xóa hoặc cắt danh sách receipt của ví; nếu lượng nạp rất lớn cần thiết kế lại ledger trước khi chạm giới hạn kích thước document MongoDB.
- Dùng HTTPS cho frontend triển khai thật; backend chỉ cho phép HTTP loopback khi phát triển.
- Tài liệu API/signature: https://payos.vn/docs/api/ và https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/ .
