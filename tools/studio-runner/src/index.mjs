/**
 * SirLocked studio runner: keeps one connection to /hubs/bridge and runs `claude -p "/tao-vu-an"` when the server says
 * there is work. Nothing is asked on a timer: the server pushes WorkAvailable (on connect, on every new or released
 * request, and when a creator answers a bot question). Start: node tools/studio-runner/src/index.mjs (from the repo).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { buildBotCommand, checkPrerequisites, listMcpIn } from './bot.mjs';
import { createScheduler } from './scheduler.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const logDir = path.join(repoRoot, 'tmp', 'studio-runner');
mkdirSync(logDir, { recursive: true });

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(path.join(logDir, 'runner.log'), `${text}\n`);
}

const api = (process.env.SIRLOCKED_API || 'https://sirlocked.id.vn').replace(/\/+$/, '');
const key = process.env.SIRLOCKED_BRIDGE_KEY || '';
if (key.length < 32) {
  log('Thiếu SIRLOCKED_BRIDGE_KEY (hoặc ngắn hơn 32 ký tự). Đặt biến môi trường cho tài khoản Windows rồi đăng nhập lại.');
  process.exit(2);
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const quote = (arg) => `"${String(arg).replace(/"/g, '""')}"`;

/** One headless bot run; its output goes to tmp/studio-runner/<time>.log. Resolves with the exit code. */
async function runBot() {
  const ready = await checkPrerequisites(listMcpIn(repoRoot));
  if (!ready.ok) {
    log(ready.reason);
    return 3;
  }
  const command = buildBotCommand({ repoRoot });
  const file = path.join(logDir, `${stamp()}.log`);
  log(`Chạy bot: ${command.file} ${command.args.slice(0, 2).join(' ')} (log: ${path.relative(repoRoot, file)})`);
  const out = createWriteStream(file);
  return new Promise((resolve) => {
    // A .cmd file runs through cmd.exe; every argument is quoted so "(", ")" and "*" reach claude untouched.
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${[command.file, ...command.args].map(quote).join(' ')}"`], {
      cwd: command.cwd,
      env: { MCP_TOOL_TIMEOUT: '1800000', ...process.env },
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('error', (error) => { out.end(); log(`Không chạy được claude.cmd: ${error.message}`); resolve(1); });
    child.on('close', (code) => { out.end(); resolve(code ?? 1); });
  });
}

const connection = new HubConnectionBuilder()
  .withUrl(`${api}/hubs/bridge`, { headers: { 'X-Bridge-Key': key } })
  .withAutomaticReconnect([0, 2000, 10000, 30000, 60000])
  .configureLogging(LogLevel.Warning)
  .build();

const scheduler = createScheduler({ pendingCount: () => connection.invoke('PendingCount'), runBot, log });
connection.on('WorkAvailable', () => scheduler.onWorkAvailable());
connection.onreconnecting(() => log('Mất kết nối tới server, đang nối lại...'));
connection.onreconnected(() => { log('Đã nối lại.'); scheduler.onWorkAvailable(); });

/** Only after the connection is lost for good: try again with growing gaps (not a work poll). */
const retryGaps = [5000, 15000, 60000];
async function start(attempt = 0) {
  try {
    await connection.start();
    log(`Đã kết nối ${api}/hubs/bridge. Chờ server báo việc.`);
  } catch (error) {
    const gap = retryGaps[Math.min(attempt, retryGaps.length - 1)];
    log(`Chưa kết nối được (${error instanceof Error ? error.message : String(error)}); thử lại sau ${gap / 1000} giây.`);
    setTimeout(() => start(attempt + 1), gap);
  }
}
connection.onclose(() => { log('Kết nối đã đóng.'); start(); });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { log('Dừng runner.'); await connection.stop().catch(() => {}); process.exit(0); });
}

start();
