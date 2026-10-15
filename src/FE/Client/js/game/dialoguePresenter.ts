import { escapeHtml, initials } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { PresentationMedia, type CharacterPresentation } from './presentationMedia.js';
import { rememberFocusedControl, restoreFocusedControl } from './modalFocus.js';
import { gameIcon } from './gameShell.js';

type Line = { speaker: 'SIRLOCKED' | 'NPC'; text: string };
type DialogueView = {
  character: { characterId: string; name: string; role: string; description: string; imageUrl?: string; presentation?: CharacterPresentation };
  lines: Line[];
  topicsHtml: string;
  challengeHtml: string;
  newLeadHtml: string;
  readonly: boolean;
  /** Small caps line in the card header, e.g. the location of the conversation. */
  context?: string;
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
  private returnFocusId = '';
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
      this.returnFocusId = this.returnFocus?.id ?? '';
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

  private speakerLabel(line: Line | undefined) {
    return line?.speaker === 'SIRLOCKED' ? tr('Detective', 'Thám tử') : this.view?.character.name ?? '';
  }

  private render() {
    if (!this.host || !this.view) return;
    this.stopTimer();
    const { character, lines } = this.view;
    const portraitKey = JSON.stringify([character.characterId, character.imageUrl, character.presentation?.portraitUrl, character.presentation?.portraitVideoUrl, this.motion.matches]);
    const preservedPortrait = this.portraitKey === portraitKey ? this.host.querySelector('.vn-portrait-stage') : null;
    this.portraitKey = portraitKey;
    if (!preservedPortrait) this.media.clear();
    const focused = rememberFocusedControl(this.host);
    const line = lines[this.index];
    const who = `${character.name}${character.role ? ` · ${character.role}` : ''}`;
    const monogram = escapeHtml(initials(character.name));
    this.host.innerHTML = `<div class="overlay dialogue-overlay vn-overlay bpa-g-dlg-overlay" role="dialog" aria-modal="true" aria-labelledby="vn-character-name">
      <div class="bpa-g-shade" aria-hidden="true"></div>
      <section class="conversation-box vn-conversation bpa-g-dlg">
        <div class="vn-portrait-stage bpa-g-plate" aria-hidden="true">
          <span class="bpa-pin" aria-hidden="true"></span>
          <div class="bpa-g-plate-frame"><div class="vn-portrait-fallback">${monogram}</div><img class="vn-portrait-image" alt=""><video class="vn-portrait-video" muted loop playsinline preload="metadata" hidden></video></div>
          <span class="bpa-g-mono bpa-g-plate-mono">${monogram}</span>
          <span class="bpa-g-plate-name">${escapeHtml(who)}</span>
        </div>
        <div class="vn-speech-box bpa-g-card ${this.history ? 'is-history' : ''}">
          <header class="vn-character-heading bpa-g-card-hd">
            <span class="bpa-g-card-who"><span class="bpa-g-mono" aria-hidden="true">${monogram}</span><h2 id="vn-character-name" tabindex="-1">${escapeHtml(who)}</h2></span>
            <span class="bpa-g-card-kick">${escapeHtml(this.view.context ? `${tr('Conversation', 'Hội thoại')} · ${this.view.context}` : tr('Conversation', 'Hội thoại'))}</span>
            <div class="vn-toolbar bpa-g-card-act">
              <button class="bpa-btn bpa-btn--ink bpa-btn--sm" type="button" data-vn-history aria-expanded="${this.history}">${tr('History', 'Lịch sử')}</button>
              <button class="bpa-btn bpa-btn--ink bpa-btn--sm" type="button" data-vn-close aria-keyshortcuts="Escape">${tr('Leave', 'Rời đi')} <kbd>Esc</kbd></button>
            </div>
          </header>
          <div class="bpa-g-say">
            <p class="bpa-g-q" hidden><span></span><span class="bpa-g-q-text"></span></p>
            <span class="vn-speaker"></span>
            <button class="vn-line-button" type="button" data-vn-advance aria-label="${tr('Reveal or continue dialogue', 'Hiện hết hoặc tiếp tục hội thoại')}" aria-describedby="vn-full-line"><span class="conv-text vn-current-text" aria-hidden="true"></span><span class="bpa-g-caret" aria-hidden="true"></span></button>
            <span id="vn-full-line" class="sr-only" aria-live="polite" aria-atomic="true"></span>
          </div>
          ${this.view.readonly || /<button/.test(this.view.topicsHtml) ? `<p class="bpa-g-choose">${this.view.readonly
            ? tr('The Interrogator controls questioning.', 'Thẩm vấn viên điều khiển cuộc hỏi.')
            : tr('Choose a topic to question the witness.', 'Chọn một chủ đề để hỏi nhân chứng.')}</p>` : ''}
          <div class="conversation-choices">${this.view.topicsHtml}</div>
          ${this.view.challengeHtml ? `<div class="conversation-challenges">${this.view.challengeHtml}</div>` : ''}${this.view.newLeadHtml}
          <section class="vn-history" ${this.history ? '' : 'hidden'} aria-label="${tr('Conversation history', 'Lịch sử hội thoại')}">
            <h3>${tr('Conversation history', 'Lịch sử hội thoại')}</h3>
            <div class="conversation-log">${lines.map((entry) => `<article class="conv-turn ${entry.speaker === 'SIRLOCKED' ? 'is-q' : ''}"><strong>${escapeHtml(this.speakerLabel(entry))}</strong><p>${escapeHtml(entry.text)}</p></article>`).join('') || `<p>${tr('No testimony yet.', 'Chưa có lời khai.')}</p>`}</div>
          </section>
          <div class="bpa-g-card-ft"><span class="vn-continue-hint" aria-hidden="true"><kbd>Space</kbd> ${tr('/ click to continue', '/ bấm để tiếp tục')}${gameIcon('next')}</span></div>
        </div>
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
      this.host?.querySelector('.bpa-g-card')?.classList.toggle('is-history', this.history);
      this.host?.querySelector('[data-vn-history]')?.setAttribute('aria-expanded', String(this.history));
    });
    this.host.querySelectorAll<HTMLButtonElement>('.conversation-choices button').forEach((button, index) => {
      if (index < 9) button.setAttribute('aria-keyshortcuts', String(index + 1));
    });
    if (this.motion.matches) this.revealed = line?.text.length ?? 0;
    this.paint();
    this.timer = setInterval(() => {
      const text = this.view?.lines[this.index]?.text ?? '';
      if (this.revealed >= text.length) { this.stopTimer(); return; }
      this.revealed += 2;
      this.paint();
    }, 28);
    restoreFocusedControl(this.host, focused, '[data-vn-advance]');
  }

  private paint() {
    if (!this.view) return;
    const line = this.view.lines[this.index];
    const speaking = line?.speaker === 'NPC' && this.revealed < line.text.length && !this.motion.matches;
    this.host?.querySelector('.vn-overlay')?.classList.toggle('is-npc-speaking', speaking);
    const el = this.host?.querySelector<HTMLElement>('.vn-current-text');
    if (el) el.textContent = line ? line.text.slice(0, this.revealed) : tr('Choose a topic to question this witness.', 'Chọn một chủ đề để hỏi nhân chứng.');
    const spoken = this.host?.querySelector<HTMLElement>('#vn-full-line');
    const full = line?.text ?? tr('Choose a topic to question this witness.', 'Chọn một chủ đề để hỏi nhân chứng.');
    if (spoken && spoken.textContent !== full) spoken.textContent = full;
    const speaker = this.host?.querySelector<HTMLElement>('.vn-speaker');
    if (speaker) speaker.textContent = this.speakerLabel(line);
    // The detective's question stays above the witness's answer while it is typed out.
    const previous = this.view.lines[this.index - 1];
    const question = this.host?.querySelector<HTMLElement>('.bpa-g-q');
    if (question) {
      const asked = line?.speaker === 'NPC' && previous?.speaker === 'SIRLOCKED' ? previous.text : '';
      question.hidden = !asked;
      const labelEl = question.firstElementChild as HTMLElement | null;
      const textEl = question.querySelector<HTMLElement>('.bpa-g-q-text');
      if (labelEl) labelEl.textContent = tr('Detective', 'Thám tử');
      if (textEl && textEl.textContent !== asked) textEl.textContent = asked;
    }
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
    // Number keys pick the matching question, as the key caps on the choices show.
    if (/^[1-9]$/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey && !this.history) {
      const choice = [...(this.host?.querySelectorAll<HTMLButtonElement>('.conversation-choices button') ?? [])][Number(event.key) - 1];
      if (choice && !choice.disabled) { event.preventDefault(); choice.click(); return true; }
    }
    if (event.key === 'Tab' && this.host) {
      const controls = [...this.host.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
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
    const returnTarget = this.returnFocusId ? document.getElementById(this.returnFocusId) : this.returnFocus;
    if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    this.returnFocus = null; this.returnFocusId = '';
  }
  dispose() { this.clear(); this.motion.removeEventListener('change', this.onMotionChange); }
}
