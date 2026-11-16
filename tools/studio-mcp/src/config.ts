/**
 * Configuration of the studio MCP server. Everything comes from environment variables that Yen sets herself;
 * the bridge key is only ever read from SIRLOCKED_BRIDGE_KEY and never written to a file, a log or a tool result.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_API = 'https://sirlocked.id.vn';

export interface StudioConfig {
  /** Absolute path of the repository root (holds tools/studio-mcp, src/BE, src/FE). */
  repoRoot: string;
  /** Base URL of the Sir Locked API, without a trailing slash. */
  apiBase: string;
  /** The bridge key, or an empty string when it is not set. Never print it. */
  bridgeKey: string;
  /** <repo>/tmp: every large file the tools write lives under it (git ignores tmp/). */
  tmpRoot: string;
  /** <repo>/tools/studio-mcp/library/index.json: the committed library index. */
  libraryIndexPath: string;
  /** Timeout of one HTTP call to the API, in ms. */
  httpTimeoutMs: number;
}

/** tools/studio-mcp/dist/src/config.js -> repo root. Falls back to CLAUDE_PROJECT_DIR or SIRLOCKED_REPO_ROOT. */
export function findRepoRoot(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [env.SIRLOCKED_REPO_ROOT, env.CLAUDE_PROJECT_DIR];
  for (const candidate of candidates) {
    if (candidate && existsSync(path.join(candidate, 'tools', 'studio-mcp', 'package.json'))) return path.resolve(candidate);
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(path.join(dir, 'tools', 'studio-mcp', 'package.json')) && existsSync(path.join(dir, 'src', 'BE'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Only https:// URLs, or plain http:// to this machine (local API for tests and the e2e run). The key must never
 * travel over plain HTTP to another host.
 */
export function normalizeApiBase(raw: string | undefined): string {
  const value = (raw ?? '').trim() || DEFAULT_API;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SIRLOCKED_API="${value}" không phải địa chỉ hợp lệ. Ví dụ: https://sirlocked.id.vn hoặc http://localhost:5000.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`SIRLOCKED_API phải là https:// (hoặc http:// tới máy này): "${value}".`);
  }
  if (url.username || url.password) throw new Error('SIRLOCKED_API không được chứa tên đăng nhập hay mật khẩu.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function isLoopback(apiBase: string): boolean {
  const host = new URL(apiBase).hostname;
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StudioConfig {
  const repoRoot = findRepoRoot(env);
  return {
    repoRoot,
    apiBase: normalizeApiBase(env.SIRLOCKED_API),
    bridgeKey: (env.SIRLOCKED_BRIDGE_KEY ?? '').trim(),
    tmpRoot: path.join(repoRoot, 'tmp'),
    // SIRLOCKED_LIBRARY_INDEX: another index file (the e2e run works on a copy so local URLs never reach git).
    libraryIndexPath: env.SIRLOCKED_LIBRARY_INDEX
      ? path.resolve(repoRoot, env.SIRLOCKED_LIBRARY_INDEX)
      : path.join(repoRoot, 'tools', 'studio-mcp', 'library', 'index.json'),
    httpTimeoutMs: Number(env.SIRLOCKED_STUDIO_HTTP_TIMEOUT_MS) > 0 ? Number(env.SIRLOCKED_STUDIO_HTTP_TIMEOUT_MS) : 120_000,
  };
}

/** How Yen sets the key herself, shown whenever a tool needs it and it is missing or refused. */
export const KEY_HELP = [
  'Biến môi trường SIRLOCKED_BRIDGE_KEY chưa có (hoặc sai). Yen tự đặt, không dán khóa vào chat hay file trong repo:',
  '- Windows: Start > "Edit environment variables for your account" > New > SIRLOCKED_BRIDGE_KEY = <khóa>; rồi đóng hẳn VS Code/terminal và mở lại Claude Code.',
  '- Linux (VPS studio): thêm dòng export SIRLOCKED_BRIDGE_KEY=... vào ~/.config/sirlocked/env (chmod 600), file này được ~/.bashrc nạp; mở phiên mới.',
  '- Khóa phải giống Bridge__Key trên server (đặt bằng bash scripts/set-bridge-key.sh). Server khác: đặt thêm SIRLOCKED_API (mặc định https://sirlocked.id.vn).',
].join('\n');
