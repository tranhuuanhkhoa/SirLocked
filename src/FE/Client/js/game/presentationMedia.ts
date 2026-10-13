import { apiFetchBlob } from '../api/http.js';

/** Only same-origin presentation endpoints receive the player's bearer token. */
export function presentationUrl(value?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export class PresentationMedia {
  private cache = new Map<string, { controller: AbortController; promise: Promise<string>; objectUrl?: string }>();
  private revision = 0;

  clear() {
    this.revision++;
    this.retain([]);
  }

  /** At most two panel pairs: current poster/video and next permitted poster/video. */
  retain(sources: (string | undefined)[]) {
    const retained = new Set(sources.map(presentationUrl).filter(Boolean).slice(0, 4));
    for (const [key, entry] of this.cache) {
      if (retained.has(key)) continue;
      entry.controller.abort();
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      this.cache.delete(key);
    }
  }

  async preload(source?: string) {
    const safe = presentationUrl(source);
    if (!safe) return;
    try { await this.resolve(safe); } catch { /* speculative media never blocks playback */ }
  }

  private resolve(safe: string): Promise<string> {
    const cached = this.cache.get(safe);
    if (cached) return cached.promise;
    const controller = new AbortController();
    const url = new URL(safe);
    const protectedMedia = url.origin === window.location.origin && url.pathname.startsWith('/api/');
    const entry = { controller, promise: Promise.resolve(''), objectUrl: undefined as string | undefined };
    entry.promise = (async () => {
      let blob: Blob;
      try {
        if (protectedMedia) blob = await apiFetchBlob(url.pathname + url.search, controller.signal);
        else {
          const response = await fetch(safe, { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) throw new Error('Presentation media unavailable.');
          blob = await response.blob();
        }
      } catch (error) {
        // Public image hosts may allow embedding without CORS. Keep that fallback.
        if (!protectedMedia && !controller.signal.aborted) return safe;
        throw error;
      }
      if (controller.signal.aborted) throw new DOMException('Presentation media cancelled.', 'AbortError');
      entry.objectUrl = URL.createObjectURL(blob);
      return entry.objectUrl;
    })();
    this.cache.set(safe, entry);
    return entry.promise;
  }

  async attach(element: HTMLImageElement | HTMLVideoElement, source?: string) {
    const safe = presentationUrl(source);
    if (!safe) return;
    const revision = this.revision;
    try {
      const resolved = await this.resolve(safe);
      if (revision !== this.revision || !element.isConnected) return;
      element.src = resolved;
      if (element instanceof HTMLVideoElement) {
        element.muted = true;
        void element.play().catch(() => { element.hidden = true; });
      }
    } catch { element.hidden = true; }
  }
}

export type CharacterPresentation = {
  portraitUrl?: string;
  portraitVideoUrl?: string;
  spriteSheet?: { url: string; frameWidth: number; frameHeight: number; frameCount: number; fps?: number; idleFrames?: number[]; anchorX?: number; anchorY?: number };
};

export type Cutscene = {
  id: string;
  trigger: 'INTRO' | 'REVEAL' | 'ENDING';
  triggerId?: string;
  panels: { id?: string; imageUrl?: string; videoUrl?: string; caption?: string; speaker?: string; durationMs?: number }[];
};
export type CasePresentation = { version?: string | number; cutscenes?: Cutscene[] };
