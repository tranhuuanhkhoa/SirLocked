/**
 * Starts a throwaway local game stack (MongoDB + API + Vite) with Node only, on Windows and Ubuntu.
 * No .ps1 (the Windows machine blocks scripts), no shell wrappers (so stop() really ends each process).
 *
 * The API is built into and run from a folder OUTSIDE the repository: it loads a `.env` from its working
 * directory upwards (EnvFileLoader), and the repository root holds the owner's real `.env`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameApi, urlAnswers, waitFor } from './http.js';

export const DEFAULT_PORTS = { api: 5231, web: 5232, mongo: 27031 };
/** Local-only credentials of the throwaway playtest database (never used for hosting). */
export const STACK_ADMIN_EMAIL = 'admin@playtest.sirlocked.local';
export const STACK_PASSWORD = 'StudioPlaytest123!';

export interface StackOptions {
  repoRoot: string;
  apiPort?: number;
  webPort?: number;
  mongoPort?: number;
  /** Bridge mode for the e2e script: the Claude bridge is on, mock answers are exposed (never Production). */
  bridge?: boolean;
  /** Force a rebuild of the API even when the build is newer than the sources. */
  rebuild?: boolean;
  /** Folder outside the repo for the build, data and logs. Default: <os tmp>/sirlocked-studio-playtest. */
  workDir?: string;
  /** Extra environment for the API (wins over the defaults). Values are never logged. */
  apiEnv?: Record<string, string>;
  /** Spawn detached so the stack can outlive this process (keepStack); see LocalStack.detach(). */
  detached?: boolean;
  /** Start Vite too (default true). */
  web?: boolean;
  log?: (line: string) => void;
}

export interface LocalStack {
  apiUrl: string;
  webUrl: string;
  mongoUrl: string;
  adminEmail: string;
  adminPassword: string;
  workDir: string;
  logs: { mongo: string; api: string; web: string };
  stop(): Promise<void>;
  /** Leave the processes running after this process exits; returns their PIDs (also in <workDir>/pids.json). */
  detach(): number[];
}

export function portsFromEnv(): { api: number; web: number; mongo: number } {
  const read = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 1023 && value < 65536 ? value : fallback;
  };
  return {
    api: read('PLAYTEST_API_PORT', DEFAULT_PORTS.api),
    web: read('PLAYTEST_WEB_PORT', DEFAULT_PORTS.web),
    mongo: read('PLAYTEST_MONGO_PORT', DEFAULT_PORTS.mongo),
  };
}

/** mongod: MONGOD_PATH, then PATH, then <repo>/.tools/mongodb-* (portable install on the Windows machine). */
export function findMongod(repoRoot: string): string | null {
  const exe = process.platform === 'win32' ? 'mongod.exe' : 'mongod';
  if (process.env.MONGOD_PATH && existsSync(process.env.MONGOD_PATH)) return process.env.MONGOD_PATH;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  const tools = path.join(repoRoot, '.tools');
  if (existsSync(tools)) {
    for (const entry of readdirSync(tools).filter((name) => name.startsWith('mongodb')).sort().reverse()) {
      for (const candidate of [path.join(tools, entry, exe), path.join(tools, entry, 'bin', exe)]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function newestSource(dir: string, newest = 0): number {
  let result = newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['bin', 'obj', 'Tests', 'IntegrationTests', 'GeneratedCaseJson', 'node_modules'].includes(entry.name)) continue;
      result = newestSource(path.join(dir, entry.name), result);
    } else if (/\.(cs|csproj|json)$/i.test(entry.name)) {
      result = Math.max(result, statSync(path.join(dir, entry.name)).mtimeMs);
    }
  }
  return result;
}

/** Builds the API into <workDir>/api unless that build is newer than every source file. */
export function buildApi(repoRoot: string, buildDir: string, rebuild: boolean, log: (line: string) => void): string {
  const dll = path.join(buildDir, 'SirLocked.Api.dll');
  const project = path.join(repoRoot, 'src', 'BE', 'SirLocked.Api.csproj');
  if (!existsSync(project)) throw new Error(`API project not found: ${project}`);
  const upToDate = existsSync(dll) && statSync(dll).mtimeMs > newestSource(path.join(repoRoot, 'src', 'BE'));
  if (upToDate && !rebuild) {
    log('API build is up to date.');
    return dll;
  }
  log('Building the API (dotnet build, about 1-2 minutes)...');
  const result = spawnSync('dotnet', ['build', project, '-c', 'Debug', '-o', buildDir, '--nologo', '-v', 'q'], {
    cwd: path.dirname(buildDir), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || !existsSync(dll)) {
    const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split(/\r?\n/).filter((line) => /error|Error/.test(line)).slice(0, 12).join('\n');
    throw new Error(`dotnet build failed (exit ${result.status ?? 'none'}${result.error ? `, ${result.error.message}` : ''}).\n${tail}`);
  }
  return dll;
}

function apiEnvironment(options: StackOptions, ports: { api: number; web: number; mongo: number }, databaseName: string): Record<string, string> {
  const webUrl = `http://127.0.0.1:${ports.web}`;
  const env: Record<string, string> = {
    ASPNETCORE_ENVIRONMENT: 'Development',
    DOTNET_ENVIRONMENT: 'Development',
    MongoDb__ConnectionString: `mongodb://127.0.0.1:${ports.mongo}/?serverSelectionTimeoutMS=10000`,
    MongoDb__DatabaseName: databaseName,
    Jwt__Secret: randomBytes(48).toString('base64'),
    Auth__SeedDefaultAdmin: 'true',
    Auth__SeedAdminEmail: STACK_ADMIN_EMAIL,
    Auth__SeedAdminPassword: STACK_PASSWORD,
    Auth__AutoVerifyRegistrations: 'true',
    Email__FrontendUrl: webUrl,
    Email__SmtpHost: '127.0.0.1',
    Email__SmtpPort: '1',
    Email__SenderEmail: '',
    Email__Username: '',
    Email__Password: '',
    Cors__AllowedOrigins__0: webUrl,
    Cors__AllowedOrigins__1: `http://localhost:${ports.web}`,
    MOCK_AI_RESPONSES: 'true',
    SKIP_ASSET_GENERATION: 'true',
    AiGeneration__MockAiResponses: 'true',
    AiGeneration__SkipAssetGeneration: 'true',
    AiQuota__Enabled: 'false',
    PresentationVideo__Enabled: 'false',
    Cloudinary__Enabled: 'false',
    Cloudinary__CloudName: '',
    Cloudinary__ApiKey: '',
    Cloudinary__ApiSecret: '',
    PayOs__Enabled: 'false',
    PayOS__Enabled: 'false',
    GameplayV3__Enabled: 'true',
    GameplayV3__PlaytestInstrumentationEnabled: 'false',
    CaseCatalog__PixelOnly: 'false',
    CaseCatalog__SeedPixelOnStartup: 'false',
    Google__ClientId: 'playtest-placeholder.apps.googleusercontent.com',
    Google__ClientSecret: 'playtest-placeholder',
    OpenAI__ApiKey: '',
    OPENAI_API_KEY: '',
    Bridge__Key: '',
  };
  if (options.bridge) {
    const key = process.env.SIRLOCKED_BRIDGE_KEY ?? '';
    if (key.length < 32) throw new Error('Bridge mode needs SIRLOCKED_BRIDGE_KEY (32+ characters) in the environment.');
    delete env.MOCK_AI_RESPONSES;
    delete env.SKIP_ASSET_GENERATION;
    env.AiGeneration__MockAiResponses = 'false';
    env.AiGeneration__SkipAssetGeneration = 'false';
    env.Bridge__Key = key;
    env.Bridge__ExposeMockResponses = 'true';
    env.Bridge__AllowLocalAssetStorage = 'true';
    env.Bridge__LocalAssetRoot = path.join(options.repoRoot, 'src', 'FE', 'public', 'assets');
  }
  return { ...env, ...(options.apiEnv ?? {}) };
}

function start(name: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, logFile: string, detached = false): ChildProcess {
  // Output goes straight to a log file: no pipe keeps this process alive or breaks when it exits.
  const fd = openSync(logFile, 'a');
  // On Windows libuv puts children in a job killed with this process; detached ones break away from it.
  const child = spawn(command, args, { cwd, env, windowsHide: true, detached, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.on('error', (error) => appendFileSync(logFile, `\n[${name}] failed to start: ${error.message}\n`));
  return child;
}

async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000).unref();
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
}

async function portFree(port: number): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export async function startStack(options: StackOptions): Promise<LocalStack> {
  const log = options.log ?? (() => undefined);
  const envPorts = portsFromEnv();
  const ports = { api: options.apiPort ?? envPorts.api, web: options.webPort ?? envPorts.web, mongo: options.mongoPort ?? envPorts.mongo };
  if (new Set([ports.api, ports.web, ports.mongo]).size !== 3) throw new Error('API, web and MongoDB ports must differ.');
  const workDir = options.workDir ?? path.join(os.tmpdir(), 'sirlocked-studio-playtest');
  const repoRoot = path.resolve(options.repoRoot);
  if (path.resolve(workDir).toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep)) {
    throw new Error('The stack work folder must be outside the repository (the API would load the repository .env).');
  }
  for (const [name, port] of Object.entries(ports)) {
    if (name === 'web' && options.web === false) continue;
    if (!(await portFree(port))) throw new Error(`Port ${port} (${name}) is busy. Set PLAYTEST_${name.toUpperCase()}_PORT or stop what listens there.`);
  }
  const mongod = findMongod(repoRoot);
  if (!mongod) throw new Error('mongod not found: install MongoDB, put mongod on PATH or set MONGOD_PATH.');
  const viteJs = path.join(repoRoot, 'src', 'FE', 'node_modules', 'vite', 'bin', 'vite.js');
  if (options.web !== false && !existsSync(viteJs)) throw new Error('Frontend dependencies are missing: run npm ci in src/FE.');

  const runId = `${Date.now().toString(36)}-${process.pid}`;
  const runDir = path.join(workDir, 'runs', runId);
  const dataDir = path.join(runDir, 'mongo-data');
  mkdirSync(dataDir, { recursive: true });
  const logs = { mongo: path.join(runDir, 'mongo.log'), api: path.join(runDir, 'api.log'), web: path.join(runDir, 'web.log') };
  const children: ChildProcess[] = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const child of children.reverse()) await killTree(child);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* mongod may still hold a file for a moment */ }
  };
  const onExit = () => {
    for (const child of children) {
      if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        else child.kill('SIGKILL');
      }
    }
  };
  process.once('exit', onExit);
  const detach = () => {
    process.removeListener('exit', onExit);
    const pids = children.map((child) => child.pid).filter((pid): pid is number => typeof pid === 'number');
    for (const child of children) child.unref();
    writeFileSync(path.join(runDir, 'pids.json'), JSON.stringify({ pids, ports }, null, 2));
    return pids;
  };

  try {
    const buildDir = path.join(workDir, 'api-build');
    mkdirSync(buildDir, { recursive: true });
    const dll = buildApi(repoRoot, buildDir, options.rebuild ?? false, log);

    log(`Starting MongoDB on 127.0.0.1:${ports.mongo}...`);
    children.push(start('mongo', mongod, ['--bind_ip', '127.0.0.1', '--port', String(ports.mongo), '--dbpath', dataDir, '--quiet'],
      runDir, process.env, logs.mongo, options.detached));
    const net = await import('node:net');
    const mongoUp = await waitFor(() => new Promise<boolean>((resolve) => {
      const socket = net.connect(ports.mongo, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    }), 30_000);
    if (!mongoUp) throw new Error(`MongoDB did not start; see ${logs.mongo}`);

    const apiUrl = `http://127.0.0.1:${ports.api}`;
    const databaseName = `SirLockedStudioPlaytest${options.bridge ? 'Bridge' : ''}`;
    const env = { ...process.env, ...apiEnvironment({ ...options, repoRoot }, ports, databaseName) };
    log(`Starting the API on ${apiUrl}${options.bridge ? ' (bridge mode)' : ''}...`);
    children.push(start('api', 'dotnet', [dll, '--urls', apiUrl], buildDir, env, logs.api, options.detached));
    const api = new GameApi(apiUrl);
    if (!(await waitFor(() => api.healthy(), 120_000, 1000))) throw new Error(`The API did not answer /health; see ${logs.api}`);

    const webUrl = `http://127.0.0.1:${ports.web}`;
    if (options.web !== false) {
      log(`Starting Vite on ${webUrl}...`);
      children.push(start('web', process.execPath, [viteJs, '--host', '127.0.0.1', '--port', String(ports.web), '--strictPort'],
        path.join(repoRoot, 'src', 'FE'), { ...process.env, VITE_API_URL: apiUrl }, logs.web, options.detached));
      if (!(await waitFor(() => urlAnswers(webUrl), 60_000, 1000))) throw new Error(`Vite did not start; see ${logs.web}`);
    }
    process.removeListener('exit', onExit);
    process.once('exit', onExit);
    return {
      apiUrl, webUrl, mongoUrl: `mongodb://127.0.0.1:${ports.mongo}`,
      adminEmail: STACK_ADMIN_EMAIL, adminPassword: STACK_PASSWORD, workDir: runDir, logs, stop, detach,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
