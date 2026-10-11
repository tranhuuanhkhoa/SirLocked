import { escapeHtml } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { PresentationMedia, type CasePresentation, type Cutscene } from './presentationMedia.js';

/** Plays only content already authorized by the server; completion is local UI state. */
export class CutsceneController {
  private host: HTMLElement | null = null;
  private queue: { scene: Cutscene; key: string }[] = [];
  private current: { scene: Cutscene; key: string } | null = null;
  private panel = 0;
  private consumed = new Set<string>();
  private media = new PresentationMedia();
  private previousFocus: HTMLElement | null = null;
  private storageKey: string;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private onMotionChange = () => { if (this.current) this.render(); };

  constructor(roomId: string, playerId: string, private onChange: () => void = () => {}) {
    this.storageKey = `sirlocked.presentation.${encodeURIComponent(roomId)}.${encodeURIComponent(playerId)}`;
    try { this.consumed = new Set(JSON.parse(localStorage.getItem(this.storageKey) || '[]')); } catch { /* storage is optional */ }
    this.motion.addEventListener('change', this.onMotionChange);
  }

  get active() { return Boolean(this.current); }

  update(host: HTMLElement, presentation: CasePresentation | undefined, triggers: Cutscene['trigger'][]) {
    this.host = host;
    for (const scene of presentation?.cutscenes ?? []) {
      if (!scene.id || !scene.panels?.length || !triggers.includes(scene.trigger)) continue;
      const key = `${presentation?.version ?? '1'}:${scene.id}`;
      if (this.consumed.has(key) || this.current?.key === key || this.queue.some((queued) => queued.key === key)) continue;
      this.queue.push({ scene, key });
    }
    if (!this.current && this.queue.length) this.startNext();
    else if (this.current) this.prepareMedia();
  }

  private startNext() {
    this.current = this.queue.shift() ?? null;
    this.panel = 0;
    if (this.current) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.render();
    } else {
      this.media.clear();
      if (this.host) this.host.innerHTML = '';
      this.previousFocus?.focus(); this.previousFocus = null;
    }
    this.onChange();
  }

  private prepareMedia() {
    if (!this.current) return;
    const current = this.current.scene.panels[this.panel];
    const next = this.current.scene.panels[this.panel + 1] ?? this.queue[0]?.scene.panels[0];
    this.media.retain([current.imageUrl, this.motion.matches ? undefined : current.videoUrl,
      next?.imageUrl, this.motion.matches ? undefined : next?.videoUrl]);
    if (next?.imageUrl) void this.media.preload(next.imageUrl);
    if (next?.videoUrl && !this.motion.matches) void this.media.preload(next.videoUrl);
  }

  private render() {
    if (!this.host || !this.current) return;
    this.prepareMedia();
    const panels = this.current.scene.panels;
    const panel = panels[this.panel];
    this.host.innerHTML = `<div class="comic-overlay" role="dialog" aria-modal="true" aria-label="${tr('Case cinematic', 'Truyện cảnh vụ án')}"><section class="comic-stage panel panel--dossier">
      <div class="comic-media"><img alt=""><video muted playsinline preload="metadata" hidden></video><div class="comic-no-art" aria-hidden="true">SIR LOCKED</div></div>
      <div class="comic-caption">${panel.speaker ? `<strong>${escapeHtml(panel.speaker)}</strong>` : ''}<p>${escapeHtml(panel.caption || tr('The investigation continues…', 'Cuộc điều tra tiếp tục…'))}</p></div>
      <footer class="comic-controls"><span>${this.panel + 1} / ${panels.length}</span><button class="btn btn-ghost" data-comic-skip>${tr('Skip', 'Bỏ qua')} <kbd>Esc</kbd></button><button class="btn btn-ghost" data-comic-back ${this.panel === 0 ? 'disabled' : ''}>${tr('Back', 'Trước')}</button><button class="btn btn-gold" data-comic-next>${this.panel === panels.length - 1 ? tr('Continue', 'Tiếp tục') : tr('Next', 'Tiếp')}</button></footer>
    </section></div>`;
    const image = this.host.querySelector<HTMLImageElement>('img')!;
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    image.addEventListener('load', () => this.host?.querySelector('.comic-no-art')?.setAttribute('hidden', ''), { once: true });
    if (panel.imageUrl) void this.media.attach(image, panel.imageUrl); else image.hidden = true;
    const video = this.host.querySelector<HTMLVideoElement>('video')!;
    if (panel.videoUrl && !this.motion.matches) {
      video.addEventListener('loadeddata', () => { video.hidden = false; this.host?.querySelector('.comic-no-art')?.setAttribute('hidden', ''); }, { once: true });
      video.addEventListener('error', () => { video.hidden = true; }, { once: true });
      void this.media.attach(video, panel.videoUrl);
    }
    this.host.querySelector('[data-comic-skip]')?.addEventListener('click', () => this.finish());
    this.host.querySelector('[data-comic-next]')?.addEventListener('click', () => this.next());
    this.host.querySelector('[data-comic-back]')?.addEventListener('click', () => { if (this.panel > 0) { this.panel--; this.render(); } });
    this.host.querySelector<HTMLButtonElement>('[data-comic-next]')?.focus();
  }

  private next() { if (!this.current) return; if (this.panel + 1 >= this.current.scene.panels.length) this.finish(); else { this.panel++; this.render(); } }
  private finish() {
    if (!this.current) return;
    this.consumed.add(this.current.key);
    try { localStorage.setItem(this.storageKey, JSON.stringify([...this.consumed].slice(-256))); } catch { /* no gameplay depends on persistence */ }
    this.current = null; this.startNext();
  }

  handleKey(event: KeyboardEvent) {
    if (!this.current) return false;
    if (event.key === 'Escape') { event.preventDefault(); this.finish(); return true; }
    if ((event.key === ' ' || event.key === 'ArrowRight') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); this.next(); return true; }
    if (event.key === 'Tab') {
      const buttons = [...(this.host?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    }
    return true;
  }

  dispose() { this.motion.removeEventListener('change', this.onMotionChange); this.media.clear(); if (this.host) this.host.innerHTML = ''; this.host = null; this.queue = []; this.current = null; }
}
