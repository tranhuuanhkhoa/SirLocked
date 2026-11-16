/**
 * Thin client of /api/bridge/*. Sends the key in X-Bridge-Key only, never logs it, and turns every failure into a
 * StudioError with a short Vietnamese explanation the tool can show as is.
 */
import { KEY_HELP, type StudioConfig } from './config.js';

export class StudioError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0, public readonly details?: unknown) {
    super(message);
  }
}

export interface BridgeResponse<T = any> {
  status: number;
  data: T;
  message: string;
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  /** Extra statuses that are returned instead of thrown. */
  allow?: number[];
}

export class BridgeClient {
  constructor(private readonly config: StudioConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  get apiBase(): string {
    return this.config.apiBase;
  }

  get hasKey(): boolean {
    return this.config.bridgeKey.length > 0;
  }

  requireKey(): void {
    if (!this.hasKey) throw new StudioError('BRIDGE_KEY_MISSING', KEY_HELP);
    if (this.config.bridgeKey.length < 32) {
      throw new StudioError('BRIDGE_KEY_INVALID', `SIRLOCKED_BRIDGE_KEY quá ngắn (cần 32–256 ký tự).\n${KEY_HELP}`);
    }
  }

  url(pathname: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.config.apiBase}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async call<T = any>(method: string, pathname: string, options: RequestOptions = {}): Promise<BridgeResponse<T>> {
    this.requireKey();
    const headers: Record<string, string> = { 'X-Bridge-Key': this.config.bridgeKey, Accept: 'application/json' };
    let body: FormData | string | undefined;
    if (options.form) body = options.form;
    else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(pathname, options.query), {
        method, headers, body, signal: AbortSignal.timeout(this.config.httpTimeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StudioError('API_UNREACHABLE',
        `Không gọi được ${this.config.apiBase}${pathname} (${reason}). Kiểm mạng, SIRLOCKED_API, hoặc server đang chạy chưa.`);
    }
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const message = String(parsed?.message ?? '');
    if (response.ok || options.allow?.includes(response.status)) {
      return { status: response.status, data: (parsed && 'data' in parsed ? parsed.data : parsed) as T, message };
    }
    const code = String(parsed?.errors?.code ?? parsed?.code ?? '') || `HTTP_${response.status}`;
    if (response.status === 401) {
      throw new StudioError('BRIDGE_KEY_INVALID', `Server từ chối khóa bridge (401).\n${KEY_HELP}`, 401);
    }
    if (response.status === 503 && code === 'BRIDGE_NOT_CONFIGURED') {
      throw new StudioError(code, 'Server chưa bật bridge (thiếu Bridge__Key). Yen chạy: bash scripts/set-bridge-key.sh', 503);
    }
    if (response.status === 429) {
      throw new StudioError('RATE_LIMITED', 'Gọi bridge quá nhanh (429). Đợi một phút rồi thử lại.', 429);
    }
    const detail = parsed?.errors ?? (text && !parsed ? text.slice(0, 300) : undefined);
    throw new StudioError(code, `${method} ${pathname} -> HTTP ${response.status}${message ? `: ${message}` : ''}`, response.status, detail);
  }

  /** Downloads a public file (library picture). Relative /assets/ URLs resolve against the API host. */
  async download(fileUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
    const absolute = fileUrl.startsWith('/') ? `${new URL(this.config.apiBase).origin}${fileUrl}` : fileUrl;
    const url = new URL(absolute);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new StudioError('UNSAFE_URL', `Chỉ tải ảnh qua https:// (${fileUrl}).`);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.config.httpTimeoutMs) });
    } catch (error) {
      throw new StudioError('DOWNLOAD_FAILED', `Không tải được ${fileUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new StudioError('DOWNLOAD_FAILED', `Tải ${fileUrl} -> HTTP ${response.status}`, response.status);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.startsWith('text/html')) {
      throw new StudioError('DOWNLOAD_FAILED', `${fileUrl} trả về trang HTML, không phải ảnh (đường dẫn sai?).`);
    }
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
  }
}
