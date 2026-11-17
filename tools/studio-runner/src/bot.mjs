/** The bot command and the one-time checks before running it. */
import { execFile } from 'node:child_process';

/**
 * `claude -p "/tao-vu-an"` without a person: only the studio and PixelLab tools, reading anywhere, writing only under
 * tmp/, and the skill's sub-agents. No shell: the bot reads orders written by VIP players. `claude.cmd`, not
 * `claude.ps1`, because this machine blocks PowerShell scripts.
 */
export function buildBotCommand({ repoRoot }) {
  return {
    file: 'claude.cmd',
    cwd: repoRoot,
    args: [
      '-p', '/tao-vu-an', '--permission-mode', 'dontAsk', '--allowedTools',
      'mcp__sirlocked-studio', 'mcp__pixellab', 'Read', 'Glob', 'Grep', 'Write(tmp/**)', 'Edit(tmp/**)', 'Agent',
    ],
  };
}

const HOW_TO_APPROVE = 'Mở cmd ở thư mục repo, chạy claude.cmd một lần, tin cậy thư mục và đồng ý dùng các MCP server trong .mcp.json, rồi /exit.';

/** `listMcp` returns the output of `claude.cmd mcp list` in the repo. */
export async function checkPrerequisites(listMcp) {
  let output;
  try {
    output = await listMcp();
  } catch (error) {
    return { ok: false, reason: `Không chạy được "claude.cmd mcp list": ${error instanceof Error ? error.message : String(error)}` };
  }
  const line = String(output).split(/\r?\n/).find((item) => item.startsWith('sirlocked-studio:'));
  if (line && /Connected/.test(line)) return { ok: true };
  return {
    ok: false,
    reason: line
      ? `MCP sirlocked-studio chưa sẵn sàng (${line.split(' - ').pop()?.trim()}). ${HOW_TO_APPROVE}`
      : `Không thấy MCP sirlocked-studio trong "claude.cmd mcp list". ${HOW_TO_APPROVE}`,
  };
}

/** The real `claude.cmd mcp list` (through cmd.exe: a .cmd file cannot be spawned directly). */
export function listMcpIn(repoRoot) {
  return () => new Promise((resolve, reject) => {
    execFile('cmd.exe', ['/d', '/s', '/c', 'claude.cmd mcp list'], { cwd: repoRoot, timeout: 120_000, windowsHide: true },
      (error, stdout, stderr) => (error && !stdout ? reject(error) : resolve(`${stdout}\n${stderr}`)));
  });
}
