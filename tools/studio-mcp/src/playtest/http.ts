/** Small JSON client for the local game API (ApiResponse envelope: { success, message, data, ... }). */
import type { Json } from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export interface CallOptions {
  token?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Retry on HTTP 429 up to this long in total (sign-ins are limited to 5 a minute per address). */
  rateLimitWaitMs?: number;
}

export class GameApi {
  constructor(readonly baseUrl: string) {
    if (!isLoopbackUrl(baseUrl)) throw new Error(`The playtest only runs against a loopback API, not ${baseUrl}.`);
  }

  async call<T = any>(method: string, path: string, options: CallOptions = {}): Promise<T> {
    const deadline = Date.now() + (options.rateLimitWaitMs ?? 0);
    for (;;) {
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      let body: any;
      if (options.form) body = options.form;
      else if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
      }
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers, body });
      const text = await response.text();
      if (response.status === 429 && Date.now() < deadline) {
        const retryAfter = Number(response.headers.get('retry-after')) || 15;
        await sleep(Math.min(retryAfter * 1000, Math.max(1000, deadline - Date.now())));
        continue;
      }
      let json: Json | null = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!response.ok) {
        const errors = json?.errors ?? json?.details ?? json?.data;
        const code = String(json?.errorCode ?? json?.code ?? json?.error?.code ?? errors?.code ?? '');
        const detail = errors ? ` ${JSON.stringify(errors).slice(0, 400)}` : '';
        throw new ApiError(`${method} ${path} -> HTTP ${response.status}: ${json?.message ?? text.slice(0, 300)}${detail}`,
          response.status, code, text.slice(0, 2000));
      }
      return (json && 'data' in json ? json.data : json) as T;
    }
  }

  async healthy(timeoutMs = 3000): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export async function urlAnswers(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return check();
}

export { sleep };
