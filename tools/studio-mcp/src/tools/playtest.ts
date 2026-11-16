/**
 * playtest: plays the case by its solution on a LOCAL game stack (never production) in a child process
 * (dist/src/playtest/cli.js), so a long run never blocks the MCP connection.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioError } from '../bridge-client.js';
import { display, requireFile, safeId, tmpDir } from '../files.js';
import { fetchCaseJson } from './draft.js';
import type { ToolContext } from './context.js';

export interface PlaytestArgs {
  draftId?: string;
  casePath?: string;
  apiUrl?: string;
  webUrl?: string;
  screenshots?: boolean;
  reimport?: boolean;
  timeoutMinutes?: number;
}

function cliPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'playtest', 'cli.js');
}

function assertLoopback(url: string | undefined, label: string): void {
  if (!url) return;
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new StudioError('PLAYTEST_NOT_LOCAL', `${label} phải là máy này (127.0.0.1/localhost): playtest không bao giờ chạy trên server thật.`);
  }
}

export async function playtest(ctx: ToolContext, args: PlaytestArgs) {
  assertLoopback(args.apiUrl, 'apiUrl');
  assertLoopback(args.webUrl, 'webUrl');
  let casePath: string;
  let runId: string;
  if (args.casePath) {
    casePath = requireFile(ctx.config, args.casePath);
    runId = path.basename(casePath).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60);
  } else if (args.draftId) {
    const draftId = safeId(args.draftId, 'draftId');
    casePath = (await fetchCaseJson(ctx, draftId)).file;
    runId = draftId;
  } else {
    throw new StudioError('BAD_ARGS', 'Cần draftId (lấy case JSON qua bridge) hoặc casePath (file case JSON).');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = tmpDir(ctx.config, 'playtest', runId, stamp);
  const cli = cliPath();
  if (!existsSync(cli)) throw new StudioError('NOT_BUILT', 'Chưa build studio-mcp: chạy npm ci trong tools/studio-mcp.');
  const argv = [cli, '--case', casePath, '--out', outDir];
  if (args.apiUrl) argv.push('--api', args.apiUrl);
  if (args.webUrl) argv.push('--web', args.webUrl);
  if (args.screenshots === false) argv.push('--no-screens');
  if (args.reimport) argv.push('--reimport');
  const timeoutMinutes = Math.max(2, Math.min(60, args.timeoutMinutes ?? 25));
  argv.push('--timeout-min', String(timeoutMinutes));
  const env: NodeJS.ProcessEnv = { ...process.env, SIRLOCKED_REPO_ROOT: ctx.config.repoRoot };
  // The bridge key is not needed by the local game; keep it out of the child process.
  delete env.SIRLOCKED_BRIDGE_KEY;
  const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd: ctx.config.repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; if (err.length > 400_000) err = err.slice(-200_000); });
    const timer = setTimeout(() => child.kill(), (timeoutMinutes + 5) * 60_000);
    child.on('error', reject);
    child.on('close', (exitCode) => { clearTimeout(timer); resolve({ code: exitCode ?? 1, stdout: out, stderr: err }); });
  });
  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  let summary: any = null;
  try { summary = JSON.parse(lastLine); } catch { summary = null; }
  const reportFile = path.join(outDir, 'report.json');
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  return {
    ok: code === 0 && Boolean(summary?.ok),
    caseFile: display(ctx.config, casePath),
    outDir: display(ctx.config, outDir),
    report: existsSync(reportFile) ? display(ctx.config, reportFile) : null,
    summary,
    screenshots: (report?.screenshots ?? []).slice(0, 40).map((shot: any) => ({ sceneId: shot.sceneId, role: shot.role, file: display(ctx.config, shot.file) })),
    stuck: report?.stuck ?? null,
    consoleErrors: (report?.consoleErrors ?? []).slice(0, 10),
    pageErrors: (report?.pageErrors ?? []).slice(0, 10),
    audioChecks: report?.audioChecks ?? null,
    estimatedMinutes: report?.estimatedMinutes ?? null,
    error: report?.error ?? (summary ? undefined : stderr.trim().split(/\r?\n/).slice(-8).join('\n')),
    hint: 'Mở vài ảnh trong screenshots để tự nhìn; ghi kết quả vào lớp 5 của report.md.',
  };
}
