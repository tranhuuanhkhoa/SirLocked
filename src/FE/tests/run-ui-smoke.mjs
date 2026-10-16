import { spawn } from 'node:child_process';

const baseUrl = process.env.SIRLOCKED_PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsedBaseUrl.hostname)) {
  throw new Error(`UI tests require a loopback HTTP base URL, received ${baseUrl}.`);
}
const viteArgs = [
  './node_modules/vite/bin/vite.js',
  '--host', parsedBaseUrl.hostname,
  '--port', parsedBaseUrl.port || '5173',
  '--strictPort',
];
const requestedArgs = process.argv.slice(2);
const outputArgs = requestedArgs.some((arg) => arg === '--output' || arg.startsWith('--output='))
  ? []
  : [`--output=test-results/run-${Date.now()}-${process.pid}`];
// Two-browser Phaser specs time out under Playwright's default of half the cores; keep a caller's choice.
const workerArgs = requestedArgs.some((arg) => arg === '--workers' || arg.startsWith('--workers=') || /^-j/.test(arg))
  ? []
  : ['--workers=2'];
const playwrightArgs = [
  './node_modules/@playwright/test/cli.js',
  'test',
  ...outputArgs,
  ...workerArgs,
  ...(requestedArgs.length > 0 ? requestedArgs : ['tests/game-ui-smoke.spec.ts', 'tests/navigation.spec.ts', 'tests/route-lifecycle.spec.ts', 'tests/invites-resume.spec.ts', 'tests/auth-refresh.spec.ts', 'tests/google-login.spec.ts', 'tests/admin-ai-language.spec.ts', 'tests/admin-ai-creation-errors.spec.ts', 'tests/admin-ai-truth-repair.spec.ts', 'tests/presentation-admin.spec.ts', 'tests/admin-v3-case-gates.spec.ts', 'tests/v3-accusation-consensus.spec.ts', 'tests/v3-paired-confrontation.spec.ts', 'tests/v3-two-browser-flow.spec.ts']),
];

let server;

try {
  server = spawn(process.execPath, viteArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  server.stdout.on('data', (chunk) => {
    if (process.env.SIRLOCKED_VERBOSE_UI_TEST === '1') process.stdout.write(chunk);
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await waitForServer(baseUrl, 30_000);
  await warmGamePage(baseUrl);

  const exitCode = await runPlaywright(playwrightArgs);
  process.exitCode = exitCode;
} finally {
  if (server && !server.killed) {
    server.kill();
  }
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    if (server?.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready with code ${server.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}. Last error: ${lastError?.message ?? 'unknown'}`);
}

// A fresh Vite needs seconds to transform the game page (and Phaser); do it before the first test waits on it.
async function warmGamePage(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL('/Client/js/pages/gamePage.ts', url), { signal: AbortSignal.timeout(120_000) });
    await response.arrayBuffer();
    if (!response.ok) console.warn(`Warming /Client/js/pages/gamePage.ts returned ${response.status}.`);
    else if (process.env.SIRLOCKED_VERBOSE_UI_TEST === '1') console.log(`Warmed gamePage.ts in ${Date.now() - startedAt} ms.`);
  } catch (error) {
    console.warn(`Could not warm /Client/js/pages/gamePage.ts: ${error.message}`);
  }
}

function runPlaywright(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER: '1',
      },
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`Playwright exited with signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
