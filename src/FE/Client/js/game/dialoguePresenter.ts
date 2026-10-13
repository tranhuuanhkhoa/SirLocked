import { escapeHtml } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { PresentationMedia, type CharacterPresentation } from './presentationMedia.js';

type Line = { speaker: 'SIRLOCKED' | 'NPC'; text: string };
type DialogueView = {
  character: { characterId: string; name: string; role: string; description: string; imageUrl?: string; presentation?: CharacterPresentation };
  lines: Line[];
  topicsHtml: string;
  challengeHtml: string;
  newLeadHtml: string;
  readonly: boolean;
};

/** Local reading progress survives unrelated room updates; never changes game state. */
export class DialoguePresenter {
  private host: HTMLElement | null = null;
  private view: DialogueView | null = null;
  private signature = '';
  private index = 0;
  private revealed = 0;
  private history = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private media = new PresentationMedia();
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private returnFocus: HTMLElement | null = null;
  private portraitKey = '';
  private onMotionChange = () => {
    if (!this.motion.matches || !this.view) return;
    this.stopTimer();
    this.revealed = this.view.lines[this.index]?.text.length ?? 0;
    this.paint();
    const video = this.host?.querySelector<HTMLVideoElement>('video');
    if (video) { video.pause(); video.hidden = true; }
  };

  constructor(private onClose: () => void) { this.motion.addEventListener('change', this.onMotionChange); }

  update(host: HTMLElement, view: DialogueView) {
    const opening = this.view?.character.characterId !== view.character.characterId;
    const previousLines = this.view?.lines ?? [];
    const previousLength = previousLines.length;
    const firstChangedLine = view.lines.findIndex((line, index) =>
      line.text !== previousLines[index]?.text || line.speaker !== previousLines[index]?.speaker);
    this.host = host;
    if (opening) {
      this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : document.querySelector('canvas');
      if (this.returnFocus instanceof HTMLCanvasElement) this.returnFocus.tabIndex = 0;
      this.index = Math.max(0, view.lines.length - 1);
      this.revealed = view.lines[this.index]?.text.length ?? 0;
      this.history = false;
    } else if (firstChangedLine >= 0 && (firstChangedLine < previousLength || this.index >= previousLength - 1)) {
      this.index = firstChangedLine;
      this.revealed = 0;
    }
    this.index = Math.min(this.index, Math.max(0, view.lines.length - 1));
    this.view = view;
    const signature = JSON.stringify(view);
    if (signature === this.signature && !opening) return false;
    this.signature = signature;
    this.render();
    if (opening) host.querySelector<HTMLElement>('#vn-character-name')?.focus();
    return true;
  }

  private render() {
    if (!this.host || !this.view) return;
    this.stopTimer();
    const { character, lines } = this.view;
    const portraitKey = JSON.stringify([character.characterId, character.imageUrl, character.presentation?.portraitUrl, character.presentation?.portraitVideoUrl, this.motion.matches]);
    const preservedPortrait = this.portraitKey === portraitKey ? this.host.querySelector('.vn-portrait-stage') : null;
    this.portraitKey = portraitKey;
    if (!preservedPortrait) this.media.clear();
    const focused = this.host.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset : null;
    const line = lines[this.index];
    this.host.innerHTML = `<div class="overlay dialogue-overlay vn-overlay" role="dialog" aria-modal="true" aria-labelledby="vn-character-name">
      <section class="conversation-box vn-conversation">
        <div class="vn-portrait-stage" aria-hidden="true"><div class="vn-portrait-fallback">${escapeHtml(character.name.slice(0, 1))}</div><img class="vn-portrait-image" alt=""><video class="vn-portrait-video" muted loop playsinline preload="metadata" hidden></video></div>
        <header class="vn-character-heading"><span>${escapeHtml(character.role)}</span><h2 id="vn-character-name" tabindex="-1">${escapeHtml(character.name)}</h2><p>${escapeHtml(character.description)}</p></header>
        <div class="vn-toolbar"><button class="btn btn-ghost btn-sm" data-vn-history aria-expanded="${this.history}">${tr('History', 'Lịch sử')}</button><button class="btn btn-ghost btn-sm" data-vn-close>${tr('Leave', 'Rời đi')} <kbd>Esc</kbd></button></div>
        <section class="vn-speech-box panel panel--dossier">
          <span class="vn-speaker">${escapeHtml(line?.speaker === 'SIRLOCKED' ? 'SirLocked' : character.name)}</span>
          <button class="vn-line-button" data-vn-advance aria-label="${tr('Reveal or continue dialogue', 'Hiện hết hoặc tiếp tục hội thoại')}" aria-describedby="vn-full-line"><span class="conv-text vn-current-text" aria-hidden="true"></span><span class="vn-continue-hint" aria-hidden="true">${tr('Space / click to continue', 'Space / bấm để tiếp tục')} ▸</span></button><span id="vn-full-line" class="sr-only" aria-live="polite" aria-atomic="true"></span>
          <div class="conversation-choices">${this.view.topicsHtml}</div>
          ${this.view.challengeHtml ? `<div class="conversation-challenges">${this.view.challengeHtml}</div>` : ''}${this.view.newLeadHtml}
          ${this.view.readonly ? `<p class="muted small">${tr('The Interrogator controls questioning.', 'Thẩm vấn viên điều khiển cuộc hỏi.')}</p>` : ''}
        </section>
        <section class="vn-history panel panel--dossier" ${this.history ? '' : 'hidden'} aria-label="${tr('Conversation history', 'Lịch sử hội thoại')}"><div class="conversation-log">${lines.map((entry) => `<article class="conv-turn"><strong>${escapeHtml(entry.speaker === 'SIRLOCKED' ? 'SirLocked' : character.name)}</strong><p>${escapeHtml(entry.text)}</p></article>`).join('') || `<p>${tr('No testimony yet.', 'Chưa có lời khai.')}</p>`}</div></section>
      </section></div>`;
    if (preservedPortrait) this.host.querySelector('.vn-portrait-stage')?.replaceWith(preservedPortrait);
    else {
      const image = this.host.querySelector<HTMLImageElement>('.vn-portrait-image')!;
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      void this.media.attach(image, character.presentation?.portraitUrl || character.imageUrl);
      const video = this.host.querySelector<HTMLVideoElement>('video')!;
      if (character.presentation?.portraitVideoUrl && !this.motion.matches) {
        video.addEventListener('loadeddata', () => { video.hidden = false; }, { once: true });
        video.addEventListener('error', () => { video.hidden = true; }, { once: true });
        void this.media.attach(video, character.presentation.portraitVideoUrl);
      }
    }
    this.host.querySelector('[data-vn-advance]')?.addEventListener('click', () => this.advance());
    this.host.querySelector('[data-vn-close]')?.addEventListener('click', () => this.onClose());
    this.host.querySelector('[data-vn-history]')?.addEventListener('click', () => {
      this.history = !this.history;
      const panel = this.host?.querySelector<HTMLElement>('.vn-history');
      if (panel) panel.hidden = !this.history;
      this.host?.querySelector('[data-vn-history]')?.setAttribute('aria-expanded', String(this.history));
    });
    if (this.motion.matches) this.revealed = line?.text.length ?? 0;
    this.paint();
    this.timer = setInterval(() => {
      const text = this.view?.lines[this.index]?.text ?? '';
      if (this.revealed >= text.length) { this.stopTimer(); return; }
      this.revealed += 2;
      this.paint();
    }, 28);
    if (focused) this.host.querySelector<HTMLButtonElement>(focused.vnHistory !== undefined ? '[data-vn-history]' : '[data-vn-advance]')?.focus();
  }

  private paint() {
    if (!this.view) return;
    const line = this.view.lines[this.index];
    const el = this.host?.querySelector<HTMLElement>('.vn-current-text');
    if (el) el.textContent = line ? line.text.slice(0, this.revealed) : tr('Choose a topic to question this witness.', 'Chọn một chủ đề để hỏi nhân chứng.');
    const spoken = this.host?.querySelector<HTMLElement>('#vn-full-line');
    const full = line?.text ?? tr('Choose a topic to question this witness.', 'Chọn một chủ đề để hỏi nhân chứng.');
    if (spoken && spoken.textContent !== full) spoken.textContent = full;
    const speaker = this.host?.querySelector<HTMLElement>('.vn-speaker');
    if (speaker) speaker.textContent = line?.speaker === 'SIRLOCKED' ? 'SirLocked' : this.view.character.name;
  }

  advance() {
    if (!this.view) return;
    const line = this.view.lines[this.index];
    if (!line) return;
    if (this.revealed < line.text.length) { this.revealed = line.text.length; this.paint(); return; }
    if (this.index < this.view.lines.length - 1) {
      this.index++;
      this.revealed = this.motion.matches ? this.view.lines[this.index].text.length : 0;
      this.stopTimer();
      this.paint();
      this.timer = setInterval(() => { this.revealed += 2; this.paint(); if (this.revealed >= (this.view?.lines[this.index]?.text.length ?? 0)) this.stopTimer(); }, 28);
    } else this.host?.querySelector<HTMLButtonElement>('.conversation-choices button')?.focus();
  }

  handleKey(event: KeyboardEvent) {
    if (!this.view) return false;
    if (event.key === 'Escape') { event.preventDefault(); this.onClose(); return true; }
    if ((event.key === ' ' || event.key === 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); this.advance(); return true; }
    if (event.key === 'Tab' && this.host) {
      const controls = [...this.host.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].filter((el) => !el.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (!controls.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return false;
  }

  private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  clear() {
    if (!this.view) return;
    this.stopTimer(); this.media.clear(); this.signature = ''; this.portraitKey = ''; this.view = null;
    if (this.host) this.host.innerHTML = '';
    this.returnFocus?.focus(); this.returnFocus = null;
  }
  dispose() { this.clear(); this.motion.removeEventListener('change', this.onMotionChange); }
}
