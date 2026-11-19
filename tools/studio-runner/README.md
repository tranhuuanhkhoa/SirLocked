# studio-runner

Chương trình chạy nền trên máy chạy bot. Nó giữ một kết nối tới `https://sirlocked.id.vn/hubs/bridge` (khóa trong header `X-Bridge-Key`). Server báo `WorkAvailable` khi máy vừa kết nối, khi có đơn hoặc yêu cầu mới, và khi người đặt đơn trả lời câu hỏi của bot. Runner không hỏi server theo chu kỳ.

Có việc thì runner chạy:

```
claude.cmd -p "/tao-vu-an" --permission-mode dontAsk --allowedTools mcp__sirlocked-studio mcp__pixellab Read Glob Grep "Write(tmp/**)" "Edit(tmp/**)" Agent
```

Mỗi lúc một bot. Bot không có quyền shell. Nếu một việc cứ còn đó sau 3 lần chạy liền, runner chờ sự kiện mới thay vì chạy tiếp.

## Cài một lần

1. Đặt `SIRLOCKED_BRIDGE_KEY` cho tài khoản Windows (khóa giống `Bridge__Key` trên server).
2. Mở cmd ở thư mục repo, chạy `claude.cmd` một lần: tin cậy thư mục, đồng ý dùng các MCP server trong `.mcp.json`, rồi `/exit`. Kiểm bằng `claude.cmd mcp list`: `sirlocked-studio` phải `Connected`.
3. `powershell -ExecutionPolicy Bypass -File scripts/install-studio-runner.ps1`

Từ lần đăng nhập Windows sau, runner tự chạy. Muốn chạy ngay: `Start-ScheduledTask -TaskName 'SirLocked Studio Runner'`.

## Xem và gỡ

- Log chung: `tmp/studio-runner/runner.log`. Mỗi lần chạy bot: `tmp/studio-runner/<thời điểm>.log`.
- Chạy tay để xem trực tiếp: `node tools/studio-runner/src/index.mjs` (từ gốc repo).
- Gỡ: `powershell -ExecutionPolicy Bypass -File scripts/uninstall-studio-runner.ps1`

Biến tùy chọn: `SIRLOCKED_API` (mặc định `https://sirlocked.id.vn`; thử trên máy: `http://localhost:5000`).
