#!/usr/bin/env node
/**
 * node dist/src/playtest/cli.js --case <file.json> --out <dir> [--api URL --web URL] [--no-stack] [--no-screens]
 *   [--headed] [--keep-stack] [--reimport] [--timeout-min N]
 * Writes <out>/report.json, prints one JSON summary line on stdout, progress on stderr; exit 0 when ok.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlaytest } from './autoplay.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

function repoRoot(): string {
  if (process.env.SIRLOCKED_REPO_ROOT) return path.resolve(process.env.SIRLOCKED_REPO_ROOT);
  // dist/src/playtest/cli.js -> tools/studio-mcp -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
}

async function main(): Promise<number> {
  const casePath = arg('--case');
  const outArg = arg('--out');
  if (!casePath || !outArg) {
    process.stderr.write('Usage: cli.js --case <file.json> --out <dir> [--api URL] [--web URL] [--no-stack] [--no-screens] [--headed] [--keep-stack] [--reimport] [--timeout-min N]\n');
    return 2;
  }
  const raw = readFileSync(path.resolve(casePath), 'utf8').replace(/^﻿/, '');
  const parsed = JSON.parse(raw);
  // Accept a bare case or a wrapper such as { caseJson: {...} } / { data: {...} }.
  const caseJson = parsed?.caseId ? parsed : parsed?.caseJson?.caseId ? parsed.caseJson : parsed?.data?.caseId ? parsed.data : parsed;
  const timeoutMin = Number(arg('--timeout-min'));
  const report = await runPlaytest({
    repoRoot: repoRoot(),
    caseJson,
    outDir: path.resolve(outArg),
    apiUrl: arg('--api'),
    webUrl: arg('--web'),
    startStack: !flag('--no-stack'),
    keepStack: flag('--keep-stack'),
    reuseExistingCase: !flag('--reimport'),
    screenshots: !flag('--no-screens'),
    headless: !flag('--headed'),
    timeoutMs: Number.isFinite(timeoutMin) && timeoutMin > 0 ? timeoutMin * 60_000 : undefined,
    log: (line) => process.stderr.write(`[playtest] ${line}\n`),
  });
  const summary = {
    ok: report.ok,
    caseId: report.caseId,
    accusationSuccess: report.accusationSuccess,
    scenesVisited: report.scenesVisited.length,
    screenshots: report.screenshots.length,
    steps: report.steps.length,
    failedSteps: report.steps.filter((entry) => !entry.ok).length,
    consoleErrors: report.consoleErrors.length,
    pageErrors: report.pageErrors.length,
    failedRequests: report.failedRequests.length,
    pageApiErrors: report.pageApiErrors.length,
    estimatedMinutes: report.estimatedMinutes,
    durationSec: Math.round(report.durationMs / 1000),
    stuck: report.stuck ?? null,
    error: report.error ?? null,
    report: path.join(path.resolve(outArg), 'report.json'),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return report.ok ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`[playtest] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
