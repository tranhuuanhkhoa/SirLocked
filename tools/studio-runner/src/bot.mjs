/** Builds the unattended Codex command with only the studio tool servers. */
import { execFile } from 'node:child_process';

const studioServers = ['sirlocked-studio', 'pixellab'];
const disabledFeatures = ['apps', 'plugins', 'hooks'].flatMap((feature) => ['--disable', feature]);
const pixelLabTools = [
  'get_balance', 'search_help', 'get_upload_url', 'get_image', 'get_character', 'wait_for_jobs',
  'create_image_pro', 'create_character', 'animate_character', 'animate_image', 'edit_image', 'inpaint_image',
];
const botPrompt = 'Studio runner đã nhận sự kiện WorkAvailable. Dùng skill $tao-vu-an để xử lý việc đang chờ qua bridge. ' +
  'Đọc .agents/skills/tao-vu-an/SKILL.md bằng studio_read, rồi làm theo. Chỉ dùng tool studio, PixelLab và các vai trò kiểm định của skill. ' +
  'Ghi answer.json và report.md bằng studio_write. Trước khi kết thúc, xử lý hoặc trả lại các yêu cầu đã nhận.';
const checkPrompt = 'Chỉ kiểm tra runner. Gọi bridge_list status PENDING limit 1, get_balance của PixelLab, và studio_read đọc .agents/skills/tao-vu-an/SKILL.md. ' +
  'Dùng studio_write ghi {"ok":true} vào tmp/bridge/runner-smoke/answer.json rồi studio_read lại file local đó. Không nhận hay sửa yêu cầu trên server, không tạo ảnh. Báo kết quả ngắn.';

export function buildBotCommand({ repoRoot, executable = 'codex', model = 'gpt-6.2-sol', servers = [], check = false }) {
  const args = ['--ask-for-approval', 'never', 'exec', '--ephemeral', '--json', '--sandbox', 'read-only', '-m', model,
    '--disable', 'shell_tool', ...disabledFeatures,
    '-c', 'web_search="disabled"', '-c', 'model_reasoning_effort="high"',
    '-c', 'mcp_servers.sirlocked-studio.default_tools_approval_mode="approve"',
    '-c', 'mcp_servers.sirlocked-studio.required=true',
    '-c', 'mcp_servers.pixellab.default_tools_approval_mode="approve"',
    '-c', 'mcp_servers.pixellab.required=true', '-c', 'mcp_servers.pixellab.tool_timeout_sec=660',
    '-c', `mcp_servers.pixellab.enabled_tools=${JSON.stringify(pixelLabTools)}`,
  ];
  for (const name of servers) {
    if (!studioServers.includes(name)) args.push('-c', `mcp_servers.${name}.enabled=false`);
  }
  return { file: executable, cwd: repoRoot, args: [...args, check ? checkPrompt : botPrompt] };
}

export async function checkPrerequisites(listMcp) {
  try {
    const servers = JSON.parse(await listMcp()).filter((server) => server.enabled).map((server) => server.name);
    if (servers.some((name) => !/^[A-Za-z0-9_-]+$/.test(name))) {
      return { ok: false, reason: 'Tên MCP không thể được giới hạn an toàn cho lượt chạy nền.' };
    }
    const missing = studioServers.filter((name) => !servers.includes(name));
    if (!missing.length) return { ok: true, servers };
    return { ok: false, reason: `Thiếu MCP ${missing.join(', ')}. Kiểm .codex/config.toml và đặt repo SirLocked là trusted.` };
  } catch (error) {
    return { ok: false, reason: `Không đọc được codex mcp list: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function listMcpIn(repoRoot, executable) {
  return () => new Promise((resolve, reject) => {
    execFile(executable, ['mcp', 'list', '--json', ...disabledFeatures], { cwd: repoRoot, timeout: 20_000, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}
