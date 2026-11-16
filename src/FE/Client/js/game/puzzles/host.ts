import '../../../../css/42-puzzle-sheet.css';
import { findPuzzleKind } from './registry';
import type { PuzzleContext, PuzzleKindHandle, PuzzleProbeResult, PuzzleRunView, PuzzleSubmitResult, PuzzleTone } from './types';

/** What the game page knows about the open interactive puzzle. */
export interface PuzzleHostModel {
  puzzleId: string;
  kind: string;
  title: string;
  prompt: string;
  params: any;
  run: Partial<PuzzleRunView> | null;
  reveal: any | null;
  solved: boolean;
  hintsAvailable: number;
  hintsUsed: number;
}

export interface PuzzleHostOptions {
  slot: HTMLElement;
  tr: (en: string, vi: string) => string;
  reducedMotion?: () => boolean;
  submit: (puzzleId: string, answer: Record<string, unknown>) => Promise<PuzzleSubmitResult>;
  probe: (puzzleId: string, payload: Record<string, unknown>) => Promise<PuzzleProbeResult>;
  onClose: () => void;
  /**
   * Puzzle sounds (CC0 pack, one set per kind): `tap` when the player handles the puzzle, `probe` for a server query,
   * `solve` and `wrong` for the verdict of an answer. Optional: the lab and older callers stay silent.
   */
  sound?: (kind: string, event: 'tap' | 'probe' | 'solve' | 'wrong') => void;
}

export interface PuzzleHost {
  /** Mount, update or unmount (null) the sheet. Never rebuilds a mounted kind for the same puzzle. */
  sync(model: PuzzleHostModel | null): void;
  isOpen(): boolean;
  destroy(): void;
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/**
 * The shared puzzle sheet (header label, hint sticky note, footer status, success stamp) around one
 * kind module. It lives in its own slot outside the game's re-rendered overlay, so partner state
 * pushes never wipe drag, timer or animation state inside a kind.
 */
export function createPuzzleHost(options: PuzzleHostOptions): PuzzleHost {
  const { slot, tr } = options;
  let model: PuzzleHostModel | null = null;
  let handle: PuzzleKindHandle | null = null;
  let root: HTMLElement | null = null;
  let winShown = false;
  let hintBusy = false;
  let lastFocus: Element | null = null;
  // While our own answer is in flight the state push marks the puzzle solved first; the submit
  // wrapper then shows the win card after the kind's success animation, not the partner delay.
  let localSubmit = false;

  const reduced = () => Boolean(options.reducedMotion?.() ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  // A drag or a held key must not rattle: one tap sound per 90 ms at most.
  let lastTap = 0;
  const sound = (event: 'tap' | 'probe' | 'solve' | 'wrong') => {
    if (!model) return;
    try { options.sound?.(model.kind, event); } catch { /* sound never breaks a puzzle */ }
  };
  const tap = () => {
    const now = performance.now();
    if (now - lastTap < 90) return;
    lastTap = now;
    sound('tap');
  };
  const onBodyPointer = (event: PointerEvent) => { if (event.isPrimary !== false) tap(); };
  const onBodyKey = (event: KeyboardEvent) => {
    if (!event.repeat && /^(Enter| |Arrow(Up|Down|Left|Right))$/.test(event.key)) tap();
  };

  function runView(m: PuzzleHostModel): PuzzleRunView {
    return { attempts: 0, probesUsed: 0, hints: [], ...(m.run ?? {}) } as PuzzleRunView;
  }

  function context(m: PuzzleHostModel): PuzzleContext {
    return {
      puzzleId: m.puzzleId,
      kind: m.kind,
      title: m.title,
      prompt: m.prompt,
      params: m.params ?? {},
      run: runView(m),
      reveal: m.reveal ?? null,
      solved: m.solved,
      reducedMotion: reduced(),
      tr,
      submit: async (answer) => {
        localSubmit = true;
        try {
          const result = await options.submit(m.puzzleId, answer);
          sound(result.solved ? 'solve' : 'wrong');
          if (result.solved) window.setTimeout(showWin, reduced() ? 0 : 1600);
          return result;
        } finally {
          localSubmit = false;
        }
      },
      probe: (payload) => { sound('probe'); return options.probe(m.puzzleId, payload); },
      setStatus,
    };
  }

  function setStatus(text: string, tone: PuzzleTone = 'info') {
    const status = root?.querySelector<HTMLElement>('.pz-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function hintsHtml(m: PuzzleHostModel) {
    const bought = runView(m).hints ?? [];
    if (!bought.length) return '';
    return `<aside class="pz-hint pzh-hint" aria-live="polite">${bought.map((hint, index) =>
      `<b>${tr('HINT', 'GỢI Ý')} ${index + 1}/${m.hintsAvailable}</b><p>${esc(hint)}</p>`).join('')}</aside>`;
  }

  function headerActions(m: PuzzleHostModel) {
    const left = Math.max(0, m.hintsAvailable - m.hintsUsed);
    const hintButton = m.hintsAvailable > 0 && !m.solved
      ? `<button type="button" class="s-btn s-btn-gold s-btn-sm" data-pzh-hint ${left === 0 ? 'disabled' : ''}>${tr('Hint', 'Gợi ý')} ${m.hintsUsed}/${m.hintsAvailable}</button>`
      : '';
    return `${hintButton}<button type="button" class="s-btn s-btn-gold s-btn-sm" data-pzh-close aria-keyshortcuts="Escape">${tr('Close', 'Đóng')} <span class="pz-kbd">Esc</span></button>`;
  }

  function mount(m: PuzzleHostModel) {
    const kind = findPuzzleKind(m.kind);
    lastFocus = document.activeElement;
    winShown = false;
    const label = kind ? tr(kind.label.en, kind.label.vi) : m.kind;
    slot.innerHTML = `
      <div class="pz-veil pzh-veil" role="dialog" aria-modal="true" aria-labelledby="pzh-title" data-pzh-kind="${esc(m.kind)}" data-pzh-puzzle="${esc(m.puzzleId)}">
        <section class="pz-sheet pzh-sheet" tabindex="-1">
          <header class="pz-head">
            <div class="pz-label"><span class="pz-kick">${tr('PUZZLE', 'GIẢI ĐỐ')} · ${esc(label.toUpperCase())}</span><h2 id="pzh-title">${esc(m.title)}</h2></div>
            ${m.prompt ? `<p class="pz-sub">${esc(m.prompt)}</p>` : ''}
            <div class="pz-head-act" data-pzh-actions>${headerActions(m)}</div>
          </header>
          <div data-pzh-hints>${hintsHtml(m)}</div>
          <div class="pz-body pzh-body" data-pzh-body></div>
          <footer class="pz-foot"><p class="pz-status" role="status" aria-live="polite"></p></footer>
          <div data-pzh-win></div>
        </section>
      </div>`;
    root = slot.firstElementChild as HTMLElement;
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    const body = root.querySelector<HTMLElement>('[data-pzh-body]')!;
    body.addEventListener('pointerdown', onBodyPointer);
    body.addEventListener('keydown', onBodyKey);
    if (!kind) {
      body.innerHTML = `<p class="pzh-missing">${tr('This puzzle needs a newer game version.', 'Câu đố này cần bản game mới hơn.')} (${esc(m.kind)})</p>`;
      handle = null;
    } else {
      handle = kind.mount(body, context(m));
    }
    root.querySelector<HTMLElement>('.pzh-sheet')?.focus({ preventScroll: true });
    if (m.solved) showWin();
  }

  function refreshChrome(m: PuzzleHostModel) {
    if (!root) return;
    const actions = root.querySelector('[data-pzh-actions]');
    if (actions) actions.innerHTML = headerActions(m);
    const hints = root.querySelector('[data-pzh-hints]');
    if (hints) hints.innerHTML = hintsHtml(m);
  }

  function showWin() {
    if (!root || !model || winShown) return;
    winShown = true;
    const reveal = model.reveal ?? {};
    const title = reveal.title || tr('Solved', 'Đã giải');
    const text = reveal.text || tr('The clue has been added to the case board.', 'Manh mối đã được ghim lên sơ đồ vụ án.');
    const win = root.querySelector('[data-pzh-win]');
    if (!win) return;
    win.innerHTML = `
      <div class="pz-win pzh-win">
        <div class="pz-win-card" role="alertdialog" aria-labelledby="pzh-win-title">
          <span class="pz-stamp">${tr('SOLVED', 'ĐÃ GIẢI')}</span>
          <h3 id="pzh-win-title" class="pzh-win-title">${esc(title)}</h3>
          <p class="pzh-win-text">${esc(text)}</p>
          <button type="button" class="s-btn s-btn-red" data-pzh-close>${tr('Back to the investigation', 'Tiếp tục điều tra')}</button>
        </div>
      </div>`;
    win.querySelector<HTMLElement>('[data-pzh-close]')?.focus({ preventScroll: true });
  }

  async function buyHint() {
    if (!model || hintBusy) return;
    hintBusy = true;
    try {
      const result = await options.probe(model.puzzleId, { $hint: true });
      if (result.feedback?.hint) setStatus(tr('Hint added to the note.', 'Đã thêm gợi ý vào giấy ghi chú.'));
    } catch (error: any) {
      setStatus(error?.message || tr('Could not get a hint.', 'Không lấy được gợi ý.'), 'bad');
    } finally {
      hintBusy = false;
    }
  }

  function onClick(event: Event) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-pzh-close]')) { event.preventDefault(); options.onClose(); return; }
    if (target.closest('[data-pzh-hint]')) { event.preventDefault(); void buyHint(); }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.onClose();
    }
  }

  function unmount() {
    try { handle?.unmount(); } catch { /* a kind must never break closing */ }
    handle = null;
    root?.removeEventListener('click', onClick);
    root?.removeEventListener('keydown', onKeydown);
    const body = root?.querySelector<HTMLElement>('[data-pzh-body]');
    body?.removeEventListener('pointerdown', onBodyPointer);
    body?.removeEventListener('keydown', onBodyKey);
    root = null;
    slot.innerHTML = '';
    if (lastFocus instanceof HTMLElement && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  return {
    sync(next) {
      if (!next) {
        if (model) unmount();
        model = null;
        return;
      }
      if (!model || model.puzzleId !== next.puzzleId || !root) {
        if (model) unmount();
        model = next;
        mount(next);
        return;
      }
      const solvedNow = next.solved && !model.solved;
      model = next;
      refreshChrome(next);
      handle?.update?.(context(next));
      if (solvedNow && !localSubmit) window.setTimeout(showWin, reduced() ? 0 : 900);
    },
    isOpen: () => Boolean(model && root),
    destroy() {
      unmount();
      model = null;
    },
  };
}
