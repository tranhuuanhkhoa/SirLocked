/** Test helpers: a fake Sir Locked bridge over real HTTP, a throwaway repo root, tiny pictures. */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StudioConfig } from '../src/config.js';
import { blank, type Rgba } from '../src/image/raster.js';
import { createContext, type ToolContext } from '../src/tools/context.js';

export const KEY = 'test-bridge-key-0123456789abcdef0123456789';

export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json?: any;
}

export type Route = (request: Recorded) => { status?: number; body?: unknown } | undefined;

export interface FakeBridge {
  url: string;
  requests: Recorded[];
  routes: Map<string, Route>;
  close(): Promise<void>;
}

/** Routes are keyed "METHOD /path"; the key check mirrors the server (401 without the right X-Bridge-Key). */
export async function startFakeBridge(routes: Record<string, Route> = {}, key = KEY): Promise<FakeBridge> {
  const requests: Recorded[] = [];
  const table = new Map(Object.entries(routes));
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const body = Buffer.concat(chunks);
      const recorded: Recorded = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, body };
      if ((req.headers['content-type'] ?? '').includes('application/json')) {
        try { recorded.json = JSON.parse(body.toString('utf8')); } catch { /* keep raw */ }
      }
      requests.push(recorded);
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.headers['x-bridge-key'] !== key) {
        return send(401, { success: false, message: 'A valid X-Bridge-Key header is required.', errors: { code: 'BRIDGE_KEY_INVALID' } });
      }
      const route = table.get(`${recorded.method} ${url.pathname}`);
      const answer = route?.(recorded);
      if (!answer) return send(404, { success: false, message: 'not found' });
      const status = answer.status ?? 200;
      return send(status, status < 400 ? { success: true, message: 'ok', data: answer.body } : answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    routes: table,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function tempRepo(): { root: string; cleanup(): void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'studio-mcp-test-'));
  mkdirSync(path.join(root, 'tools', 'studio-mcp', 'library'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'FE', 'public', 'assets'), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function testConfig(root: string, apiBase: string, bridgeKey = KEY): StudioConfig {
  return {
    repoRoot: root,
    apiBase,
    bridgeKey,
    tmpRoot: path.join(root, 'tmp'),
    libraryIndexPath: path.join(root, 'tools', 'studio-mcp', 'library', 'index.json'),
    httpTimeoutMs: 5000,
  };
}

export function testContext(root: string, apiBase: string, bridgeKey = KEY): ToolContext {
  return createContext(testConfig(root, apiBase, bridgeKey));
}

/** A picture filled by a function of (x, y). */
export function paint(width: number, height: number, color: (x: number, y: number) => [number, number, number, number]): Rgba {
  const image = blank(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.data.set(color(x, y), (y * width + x) * 4);
  return image;
}

export function pixel(image: Rgba, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
}

/** Repo root of the real checkout (for fixtures that live in the repo). */
export function realRepoRoot(): string {
  // dist/test/helpers.js -> tools/studio-mcp -> repo
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}
