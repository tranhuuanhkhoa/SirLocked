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
];
const requestedArgs = process.argv.slice(2);
const playwrightArgs = [
  './node_modules/@playwright/test/cli.js',
  'test',
  ...(requestedArgs.length > 0 ? requestedArgs : ['tests/game-ui-smoke.spec.ts', 'tests/admin-ai-language.spec.ts', 'tests/v3-paired-confrontation.spec.ts', 'tests/v3-two-browser-flow.spec.ts']),
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
