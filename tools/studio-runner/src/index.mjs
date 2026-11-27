/**
 * SirLocked studio runner: keeps one connection to /hubs/bridge and runs Codex when the server says
 * there is work. Nothing is asked on a timer: the server pushes WorkAvailable (on connect, on every new or released
 * request, and when a creator answers a bot question). Start: node tools/studio-runner/src/index.mjs (from the repo).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { buildBotCommand, checkPrerequisites, listMcpIn } from './bot.mjs';
import { createScheduler } from './scheduler.mjs';
import { isScriptStep, runScriptRequest } from '../../studio-mcp/scripts/easy-text.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const logDir = path.resolve(repoRoot, process.env.SIRLOCKED_RUNNER_LOG_DIR || 'tmp/studio-runner');
mkdirSync(logDir, { recursive: true });
const executable = process.env.SIRLOCKED_CODEX_BIN || 'codex';
const model = process.env.SIRLOCKED_CODEX_MODEL || 'gpt-6.2-sol';
const checkOnly = process.argv.includes('--check');
const scriptOnly = process.argv.includes('--script-only');
const library = path.join(logDir, 'library.json');
if (!existsSync(library)) copyFileSync(path.join(repoRoot, 'tools', 'studio-mcp', 'library', 'index.json'), library);

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
const hideSecrets = (message) => String(message).replaceAll(key, '[redacted]')
  .replace(/https:\/\/api\.pixellab\.ai\/v2\/uploads\S*/g, '[PixelLab upload URL]');

/** One headless bot run; its output goes to tmp/studio-runner/<time>.log. Resolves with the exit code. */
async function runBot(state) {
  const ready = await checkPrerequisites(listMcpIn(repoRoot, executable));
  if (!ready.ok) {
    log(ready.reason);
    return 3;
  }
  if (!checkOnly && state?.scriptRequest) {
    const { step, draftId, requestId } = state.scriptRequest;
    log(`Codex ${model} · ${step} · ${requestId} · đơn ${draftId}`);
    try {
      await runScriptRequest({ repo: repoRoot, row: state.scriptRequest, executable, model, servers: ready.servers, log,
        env: { ...process.env, SIRLOCKED_API: api, SIRLOCKED_BRIDGE_KEY: key, SIRLOCKED_REPO_ROOT: repoRoot } });
      log(`Đã nộp · ${step} · ${requestId} · đơn ${draftId}`);
      return 0;
    } catch (error) {
      log(hideSecrets(error.message));
      return 1;
    }
  }
  const command = buildBotCommand({ repoRoot, executable, model, servers: ready.servers, check: checkOnly, easyScript: state?.easyScript });
  const file = path.join(logDir, `${stamp()}${checkOnly ? '-check' : ''}.log`);
  const first = state?.first;
  const work = first?.step ? ` · ${first.step} · ${first.requestId} · ${first.draftId ? 'đơn ' + first.draftId : first.caseId ?? '—'}` : '';
  log(`${checkOnly ? 'Kiểm tra' : 'Chạy bot'} Codex (${model})${work} — ${path.relative(repoRoot, file)}`);
  const out = createWriteStream(file);
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      env: { ...process.env, SIRLOCKED_API: api, SIRLOCKED_BRIDGE_KEY: key,
        SIRLOCKED_STUDIO_UNATTENDED: '1', SIRLOCKED_LIBRARY_INDEX: library },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const passed = new Set();
    let active = first;
    let stderr = '';
    const maxRunMs = (checkOnly ? 3 : 100) * 60_000;
    const timer = setTimeout(() => {
      out.write('Codex quá thời gian của một lượt.\n');
      child.kill();
    }, maxRunMs);
    createInterface({ input: child.stdout }).on('line', (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.item?.type === 'mcp_tool_call' && ['item.started', 'item.completed'].includes(event.type)) {
        const item = event.item;
        const name = `${item.server}.${item.tool}`;
        if (event.type === 'item.started') {
          if (item.server === 'pixellab' && /^(wait_for_jobs|create_|animate_|inpaint_)/.test(item.tool))
            log(`PixelLab đang xử lý · ${item.tool}${active?.draftId ? ` · đơn ${active.draftId}` : ''}`);
          return;
        }
        const ok = item.status === 'completed' && !item.error && !item.result?.is_error && !item.result?.isError;
        if (ok) passed.add(name);
        out.write(`${new Date().toISOString()} ${name}: ${ok ? 'OK' : 'FAILED'}${item.error?.message ? ' — ' + hideSecrets(item.error.message).slice(0, 400) : ''}\n`);
        if (item.server === 'sirlocked-studio' && /^(bridge_take|bridge_submit|bridge_release|assets_complete|draft_import|playtest)$/.test(item.tool)) {
          let data;
          try { data = JSON.parse(item.result?.content?.find(part => part.type === 'text')?.text ?? '{}'); } catch { data = {}; }
          if (item.tool === 'bridge_take' && ok) active = data;
          const id = item.arguments?.requestId ?? item.arguments?.draftId ?? data.requestId ?? data.draftId;
          const identification = typeof id === 'string' && /^[\w-]+$/.test(id) ? ` · ${id}` : '';
          const step = typeof data.step === 'string' && /^[\w:-]+$/.test(data.step) ? ` · ${data.step}` : '';
          const draft = data.draftId ?? item.arguments?.draftId
            ?? (id === active?.requestId ? active?.draftId : null);
          log(`${item.tool}: ${ok && data.accepted !== false ? 'OK' : 'Chưa đạt'}${step}${identification}${draft && draft !== id ? ` · đơn ${draft}` : ''}`);
        }
      } else if (event.type === 'turn.failed' || event.type === 'error') {
        out.write(`${event.type}: ${hideSecrets(event.error?.message ?? event.message ?? '').slice(0, 600)}\n`);
      }
    });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
    child.on('error', (error) => log(`Không chạy được Codex: ${error.message}`));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code && stderr) out.write(hideSecrets(stderr));
      const checkTools = ['sirlocked-studio.bridge_list', 'pixellab.get_balance', 'sirlocked-studio.studio_read', 'sirlocked-studio.studio_write'];
      const failed = checkOnly ? checkTools.filter((tool) => !passed.has(tool)) : [];
      if (failed.length) log(`Kiểm tra Codex chưa đạt: ${failed.join(', ')}.`);
      else if (checkOnly && code === 0) log('Codex, bridge, PixelLab và file local OK.');
      out.end(() => resolve((code ?? 1) || (failed.length ? 4 : 0)));
    });
  });
}

if (checkOnly) process.exit(await runBot());

const connection = new HubConnectionBuilder()
  .withUrl(`${api}/hubs/bridge`, { headers: { 'X-Bridge-Key': key } })
  .withAutomaticReconnect([0, 2000, 10000, 30000, 60000])
  .configureLogging(LogLevel.Warning)
  .build();

async function pendingSnapshot() {
  try {
    const response = await fetch(`${api}/api/bridge/requests?status=PENDING&limit=100`, {
      headers: { 'X-Bridge-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const payload = await response.json();
      const pending = Array.isArray(payload?.data) ? payload.data : [];
      const rows = scriptOnly ? pending.filter(row => isEasyScriptRequest(row)) : pending;
      const ids = rows.map((row) => String(row?.requestId ?? '')).filter(Boolean).sort();
      const easyScript = rows.length > 0 && rows.every(row => row.kind === 'JSON' && row.difficulty === 'easy' && row.reviewMode === 'AUTO');
      const first = rows[0];
      const scriptRequest = isEasyScriptRequest(first) ? first : undefined;
      return { count: rows.length, signature: ids.join(','), easyScript, scriptRequest, first };
    }
  } catch {
    // Fall back to SignalR PendingCount below.
  }
  if (scriptOnly) throw new Error('Không đọc được yêu cầu kịch bản qua bridge.');
  const count = await connection.invoke('PendingCount');
  return { count, signature: null };
}

function isEasyScriptRequest(row) {
  return row?.kind === 'JSON' && row.difficulty === 'easy' && row.reviewMode === 'AUTO' && isScriptStep(row.step);
}

const scheduler = createScheduler({ pendingSnapshot, runBot, log });
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
