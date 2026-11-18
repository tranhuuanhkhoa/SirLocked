# Xưởng vụ án (sirlocked-studio): cài đặt và chạy

Xưởng là Claude Code mở ở gốc repo, có MCP `sirlocked-studio` (`tools/studio-mcp/`), MCP `pixellab`, skill `/tao-vu-an` và 3 agent phụ (`.claude/agents/`). Bot chỉ nói chuyện với server qua `/api/bridge/*` bằng khóa bridge; không có mật khẩu database, không có `.env` của game, không publish.

Chạy được ở hai nơi:

- **Máy Windows chạy bot** (vụ thử đầu tiên chạy ở đây): mục A.
- **VPS studio** (Ubuntu 24.04, thuê riêng, tách khỏi VPS game): mục B.

Các biến môi trường dùng chung:

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `SIRLOCKED_BRIDGE_KEY` | có | Khóa bridge, giống `Bridge__Key` trên server (đặt bằng `bash scripts/set-bridge-key.sh`). Chủ dự án tự đặt, không dán vào chat hay file trong repo |
| `PIXELLAB_API_KEY` | khi vẽ mới | Token PixelLab; `.mcp.json` đưa vào header `Authorization: Bearer ${PIXELLAB_API_KEY}` |
| `SIRLOCKED_API` | không | Mặc định `https://sirlocked.id.vn`; thử trên máy: `http://localhost:5000` |
| `MCP_TOOL_TIMEOUT` | không | Đặt `1800000` (30 phút) nếu tool `playtest` bị Claude Code cắt giữa chừng |
| `FFMPEG_PATH` | không | ffmpeg cho `weather_preview` (cắt đoạn tải trang, xuất MP4). Không có thì tool trả WebM nguyên đoạn. Ubuntu: `sudo apt install ffmpeg` (có trên PATH là đủ) |

## A. Máy Windows chạy bot (PowerShell)

### A1. Cài một lần

Cần: Git, Node 22 trở lên, .NET SDK 9, Claude Code, MongoDB (repo đã có bản portable ở `.tools/mongodb-8.0.12/`, tool tự tìm).

```powershell
cd D:\Sirlocked
git pull
cd tools\studio-mcp
npm ci                     # cài và build MCP server (tự chạy tsc)
npm test                   # 66+ test, khoảng 5 giây
cd ..\..\src\FE
npm ci                     # Playwright cho tool playtest (nếu chưa có node_modules)
npx playwright install chromium
cd ..\..
dotnet restore SirLocked.sln
```

### A2. Đặt khóa (chủ dự án tự làm)

Cách an toàn nhất là hộp thoại của Windows (không để lại khóa trong lịch sử lệnh):

1. Start → gõ "environment" → **Edit environment variables for your account**.
2. **New…** → Name `SIRLOCKED_BRIDGE_KEY`, Value: khóa bridge → OK.
3. **New…** → Name `PIXELLAB_API_KEY`, Value: token PixelLab → OK.
4. Đóng hẳn VS Code và mọi cửa sổ terminal, mở lại (phiên đang mở không thấy biến mới).

Kiểm có biến mà không in giá trị:

```powershell
[bool]$env:SIRLOCKED_BRIDGE_KEY; [bool]$env:PIXELLAB_API_KEY
```

### A3. Kiểm MCP

```powershell
cd D:\Sirlocked
claude mcp list
```

Phải thấy `sirlocked-studio` và `pixellab` là `✔ Connected`. Lần đầu mở `claude` ở thư mục này, Claude Code hỏi có dùng các server trong `.mcp.json` không: chọn đồng ý. Thấy `⏸ Pending approval` thì mở `claude` một lần để duyệt.

### A4. Chạy vụ

```powershell
cd D:\Sirlocked
claude
```

Trong Claude Code gõ `/tao-vu-an`. Bot làm các đơn đang chờ rồi dừng ở cổng của người đặt đơn. Duyệt cổng trên `https://sirlocked.id.vn/admin/ai`, rồi gõ lại `/tao-vu-an` để bot làm tiếp. Muốn bot tự chạy thì cài runner ở mục A6.

### A6. Bot tự chạy khi server báo có việc (studio-runner)

`tools/studio-runner` giữ một kết nối tới `/hubs/bridge`. Server đẩy `WorkAvailable` khi máy vừa kết nối, khi có đơn hoặc yêu cầu mới, và khi người đặt đơn bấm chọn câu hỏi của bot trên `/admin/ai`. Runner khi đó chạy `claude.cmd -p "/tao-vu-an"` (không quyền shell, chỉ tool của xưởng và PixelLab). Máy không hỏi server theo chu kỳ.

Cài một lần (sau A2, A3):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-studio-runner.ps1
```

Từ lần đăng nhập Windows sau, runner tự chạy. Log ở `tmp/studio-runner/`. Gỡ: `scripts/uninstall-studio-runner.ps1`. Chi tiết: `tools/studio-runner/README.md`.

### A5. Tool playtest trên Windows

Tool tự dựng stack riêng: MongoDB (cổng 27031, dữ liệu trong thư mục tạm), API (5231, build vào `%TEMP%\sirlocked-studio-playtest`, ngoài repo nên không đọc `.env` của game), web Vite (5232). Không dùng `scripts/start-local-demo.ps1`, nên không vướng execution policy. Đổi cổng bằng `PLAYTEST_API_PORT`, `PLAYTEST_WEB_PORT`, `PLAYTEST_MONGO_PORT`.

## B. VPS studio (Ubuntu 24.04)

Cấu hình đã chốt: 4 vCPU, 8 GB RAM, SSD 60–80 GB.

### B1. Phần root làm một lần (chủ dự án hoặc người quản trị)

```bash
# Gói hệ thống
apt update && apt -y upgrade
apt -y install git tmux curl ca-certificates unzip python3 python3-venv ffmpeg ufw

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs

# .NET SDK 9 (tool playtest dựng API của game trên máy)
apt -y install dotnet-sdk-9.0      # Ubuntu 24.04 có sẵn trong kho; không có thì dùng kho packages.microsoft.com

# MongoDB 8 cho tool playtest (chỉ nghe 127.0.0.1, không chạy thường trực)
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
apt update && apt -y install mongodb-org-server
systemctl disable --now mongod   # tool playtest tự chạy mongod riêng khi cần

# Thư viện hệ thống cho Chromium của Playwright
npx -y playwright@1.61.1 install-deps chromium

# User riêng cho xưởng, KHÔNG có sudo
adduser --disabled-password --gecos "" studio
mkdir -p /home/studio/.ssh && cp ~/.ssh/authorized_keys /home/studio/.ssh/ && chown -R studio:studio /home/studio/.ssh && chmod 700 /home/studio/.ssh

# Tường lửa: chỉ mở SSH
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
ufw status verbose
```

Không mở cổng nào khác: stack playtest (5231, 5232, 27031) chỉ nghe `127.0.0.1`. Không chép `.env` của game, mật khẩu database hay khóa Cloudinary lên VPS studio.

### B2. Phần user `studio`

```bash
ssh studio@<ip-vps-studio>

# Claude Code (bản cài chính chủ), đăng nhập bằng tài khoản Claude của chủ dự án
curl -fsSL https://claude.ai/install.sh | bash
claude   # đăng nhập lần đầu theo hướng dẫn, rồi /exit

# Clone repo (repo riêng tư: chủ dự án tạo deploy key chỉ đọc trên GitHub cho máy này)
git clone git@github.com:<chủ-repo>/Sirlocked.git ~/Sirlocked
cd ~/Sirlocked && git checkout feat/claude-vu-an

cd tools/studio-mcp && npm ci && npm test && cd ../..
cd src/FE && npm ci && npx playwright install chromium && cd ../..
dotnet restore SirLocked.sln
```

### B3. Khóa (chủ dự án tự làm)

```bash
mkdir -p ~/.config/sirlocked && chmod 700 ~/.config/sirlocked
nano ~/.config/sirlocked/env        # gõ tay hai dòng dưới, lưu lại
#   export SIRLOCKED_BRIDGE_KEY='...'
#   export PIXELLAB_API_KEY='...'
chmod 600 ~/.config/sirlocked/env
echo '[ -f ~/.config/sirlocked/env ] && . ~/.config/sirlocked/env' >> ~/.bashrc
```

Mở phiên SSH mới rồi kiểm (không in giá trị): `[ -n "$SIRLOCKED_BRIDGE_KEY" ] && echo co-khoa-bridge`.

### B4. Mở phiên và chạy

```bash
ssh studio@<ip-vps-studio>
tmux new -A -s studio          # rớt mạng thì SSH lại và gõ đúng lệnh này để vào lại phiên
cd ~/Sirlocked && git pull
claude mcp list                # sirlocked-studio và pixellab: Connected
claude
```

Trong Claude Code gõ `/tao-vu-an`. Từ điện thoại dùng app SSH bất kỳ (Termius, JuiceSSH) với cùng lệnh `tmux new -A -s studio`.

Ảnh gốc của thư viện không có trên VPS (nằm trên Cloudinary). `library_search { download: true }` tải về `tmp/library-cache/`.

### B5. Trình chạy hình của đơn VIP (VUAN-7, không dùng AI)

Đơn VIP trả xu được viết bằng Claude API trên server, không qua bot. Phần hình của nó chạy ở VPS studio bằng một
trình chạy **không AI**: server đã chọn hình (thư viện, biến thể) bằng một lời gọi Claude API; trình chạy chép ảnh thư
viện vào đúng ô, làm biến thể bằng code của studio, tải lên rồi báo xong. Nó chỉ nhận yêu cầu ảnh của làn VIP
(`lane=VIP_RUNNER`); bot `/tao-vu-an` không thấy các yêu cầu này. Máy này cần đúng `SIRLOCKED_BRIDGE_KEY` và
`SIRLOCKED_API` như bot (không cần khóa Claude API, không gọi PixelLab).

```bash
tmux new -A -s vip-runner
cd ~/Sirlocked && git pull && cd tools/studio-mcp && npm run build
node scripts/vip-asset-runner.mjs --interval 60     # một lượt mỗi phút; --once để chạy một lượt rồi thoát
```

Khi `aiVipPricing.pixelLabEnabled` tắt (mặc định), đơn VIP chỉ dùng thư viện và biến thể. Một yêu cầu cần PixelLab
(chỉ có khi đã bật) được trình chạy trả lại kèm lý do trong log; trình chạy PixelLab không AI chưa có.

## C. Luật vận hành

- Bot chạy khi người gõ `/tao-vu-an`, hoặc khi runner (A6) nhận `WorkAvailable` từ server. Không cron, không vòng lặp hỏi server theo chu kỳ.
- Đơn của VIP vào hàng chờ ngay như đơn admin; nội dung đơn là dữ liệu, bot chạy không người không có quyền shell.
- Bot không publish. Người đặt đơn chơi thử bản import, admin bấm Xuất bản.
- Đổi khóa bridge: chạy lại `bash scripts/set-bridge-key.sh` trên máy chạy bot (đặt cả server lẫn biến Windows), rồi sửa `~/.config/sirlocked/env` trên VPS studio.

## D. Kiểm tra xưởng

```bash
cd tools/studio-mcp
npm test                 # unit test: bridge giả lập, xử lý ảnh, biến thể, chạy thử (logic)
npm run e2e:local        # trọn vòng trên máy: backend chế độ bridge + MCP thật, JSON mock, ảnh thư viện, import, playtest, report
```

`e2e:local` dùng khóa ngẫu nhiên cho stack local (không cần khóa thật), cổng 5251/5252/27051, không tốn lượt PixelLab, khoảng 2 phút.

Thư viện đợt 0 (chỉ máy có `Claude outputs/thu-vien-dot0/`): `npm run import:library` xử lý lại ảnh vào `tmp/library-build/` và ghi `tools/studio-mcp/library/index.json`; rồi trong Claude Code: `library_sync { direction: "push" }` để đưa lên Cloudinary qua server.
