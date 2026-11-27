# studio-runner

Runner nhận tín hiệu WorkAvailable từ /hubs/bridge khi có việc hoặc khi vừa kết nối. Với đơn Dễ AUTO, runner nhận từng yêu cầu kịch bản qua MCP, chuyển prompt và schema cho một phiên Codex riêng rồi nộp JSON cho server kiểm tra. STORY và LOGIC có thêm lượt biên tập. Thám tử mù chỉ nhận đề từ server dành cho người giải. Các việc còn lại chạy theo skill $tao-vu-an. Mỗi lúc có tối đa một lượt Codex. Nếu sau ba lượt hàng chờ vẫn không đổi, runner đợi tín hiệu mới.

## Cài và chạy trên Windows

1. Đặt SIRLOCKED_BRIDGE_KEY trong biến môi trường người dùng. Đăng nhập Codex trong cùng tài khoản Windows và kiểm tra `codex mcp list` thấy `sirlocked-studio` và `pixellab`. Nếu thiếu cấu hình project, mở Codex ở gốc SirLocked và đặt repo là trusted.
2. Từ gốc repo, chạy `powershell -ExecutionPolicy Bypass -File scripts/install-studio-runner.ps1`. Script build MCP và đăng ký tác vụ `SirLocked Studio Runner` lúc đăng nhập.
3. Nếu tác vụ đang `Disabled`, chạy `Enable-ScheduledTask -TaskName 'SirLocked Studio Runner'`. Chạy `Start-ScheduledTask -TaskName 'SirLocked Studio Runner'` để bắt đầu nhận đơn. Runner cần máy bật, có mạng và tài khoản Windows còn đăng nhập.

Phiên Codex tự động chỉ dùng các tool của SirLocked và PixelLab. Các tool workspace ghi dữ liệu vụ trong `tmp/`. Nhật ký và bản sao thư viện nằm trong `tmp/studio-runner/`. Đơn VIP trả xu đi vào luồng API riêng của server.

## Kiểm tra và theo dõi

- Từ gốc repo, chạy `node tools/studio-runner/src/index.mjs --check` để đọc hàng chờ, kiểm tra số dư PixelLab và đọc lại một file thử trong `tmp/`.
- `Get-Content tmp/studio-runner/runner.log -Encoding UTF8 -Tail 30 -Wait` theo dõi kết nối, bước đang chạy và kết quả nộp. Mỗi lượt có log tool trong cùng thư mục.
- `Stop-ScheduledTask -TaskName 'SirLocked Studio Runner'` dừng runner. `scripts/uninstall-studio-runner.ps1` gỡ tác vụ.

Biến tùy chọn gồm `SIRLOCKED_API` (mặc định `https://sirlocked.id.vn`), `SIRLOCKED_CODEX_MODEL` (mặc định `gpt-6.2-sol`) và `SIRLOCKED_CODEX_BIN` để chỉ định đường dẫn Codex CLI. Launcher Windows tự tìm bản Codex đã cài mỗi khi tác vụ chạy.
