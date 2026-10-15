import { gameIcon } from './gameShell.js';

type Translator = (en: string, vi: string) => string;
export type TeamPing = { kind: string; senderUserId: string; expiresAt: string };
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const kinds = ['DISCOVERY', 'COMPARE', 'WAITING'] as const;
const kindIcon: Record<string, string> = { DISCOVERY: 'search', COMPARE: 'compare', WAITING: 'wait' };
function label(kind: string, tr: Translator) {
  return kind === 'DISCOVERY' ? tr('I found something', 'Có phát hiện')
    : kind === 'COMPARE' ? tr('Let’s compare', 'Cần đối chiếu')
      : kind === 'WAITING' ? tr('Waiting for you', 'Đang chờ bạn') : '';
}
/** "Gọi đồng đội" tool of the tray: a summary button and its small menu; the sent confirmation sits beside it. */
export function renderPingControls(tr: Translator): string {
  return `<details class="team-ping-controls"><summary aria-keyshortcuts="Escape">${gameIcon('call')}<span class="bpa-g-lbl">${escape(tr('Team ping', 'Gọi đồng đội'))}</span></summary>
    <div class="team-ping-options bpa-g-pop is-end" role="group" aria-label="${escape(tr('Call your partner', 'Gọi đồng đội'))}">
      <div class="bpa-g-kick" aria-hidden="true">${escape(tr('Call your partner', 'Gọi đồng đội'))}</div>
      ${kinds.map((kind) => `<button type="button" class="bpa-g-mi" data-team-ping="${kind}">${gameIcon(kindIcon[kind])}${escape(label(kind, tr))}</button>`).join('')}
    </div></details>
    <span class="bpa-g-called-wrap"><span class="bpa-g-called" data-ping-feedback data-sent-label="${escape(tr('Partner called', 'Đã gọi đồng đội'))}" role="status" aria-live="polite"></span></span>`;
}
export function bindPingControls(root: ParentNode, send: (kind: string) => Promise<unknown>): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-team-ping]'));
  const details = root.querySelector<HTMLDetailsElement>('.team-ping-controls');
  const feedback = root.querySelector<HTMLElement>('[data-ping-feedback]');
  for (const button of buttons) button.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    buttons.forEach((item) => item.disabled = true);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    try {
      await send(button.dataset.teamPing!);
      const summary = details?.querySelector<HTMLElement>('summary');
      details?.removeAttribute('open');
      summary?.focus({ preventScroll: true });
      if (feedback) {
        feedback.innerHTML = `${gameIcon('check')}<span>${escape(`${feedback.dataset.sentLabel ?? ''} · ${button.textContent?.trim() ?? ''}`)}</span>`;
        feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 2600);
      }
    } catch (error) {
      if (feedback) feedback.textContent = error instanceof Error ? error.message : 'Ping unavailable';
      feedbackTimer = setTimeout(() => { if (feedback) feedback.textContent = ''; }, 4000);
    }
    if (signal.aborted) return;
    timer = setTimeout(() => { pending = false; buttons.forEach((item) => item.disabled = false); }, 3000);
  }, { signal });
  // Menu keys: arrows move between calls, Escape closes and returns to the tool.
  details?.addEventListener('keydown', (event) => {
    if (!details.open) return;
    if (event.key === 'Escape') {
      details.open = false;
      details.querySelector<HTMLElement>('summary')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const enabled = buttons.filter((button) => !button.disabled);
    if (!enabled.length) return;
    let index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') index = (index + 1) % enabled.length;
    else if (event.key === 'ArrowUp') index = (index - 1 + enabled.length) % enabled.length;
    else index = event.key === 'Home' ? 0 : enabled.length - 1;
    enabled[index].focus();
    event.preventDefault();
  }, { signal });
  details?.addEventListener('toggle', () => {
    if (details.open) requestAnimationFrame(() => buttons.find((button) => !button.disabled)?.focus({ preventScroll: true }));
  }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
  }, { signal, capture: true });
  // The partner's ping card can be dismissed before it expires.
  (root as unknown as EventTarget).addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-partner-ping-dismiss]') : null;
    target?.closest('.partner-ping')?.remove();
  }, { signal });
  return () => { controller.abort(); clearTimeout(timer); clearTimeout(feedbackTimer); };
}
export function renderPartnerPing(payload: TeamPing, tr: Translator): string {
  if (!kinds.includes(payload.kind as typeof kinds[number]) || !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= Date.now()) return '';
  return `<div class="partner-ping bpa-g-ping" role="status" aria-live="polite">
    <span class="bpa-g-mono is-rust" aria-hidden="true">${gameIcon(kindIcon[payload.kind])}</span>
    <span class="bpa-g-ping-txt"><span class="bpa-g-kick">${escape(tr('Team ping', 'Gọi đồng đội'))}</span><span><strong>${escape(tr('Your partner', 'Đồng đội'))}</strong> · <span>${escape(label(payload.kind, tr))}</span></span></span>
    <button type="button" class="bpa-g-x" data-partner-ping-dismiss aria-label="${escape(tr('Hide your partner’s call', 'Ẩn lời gọi của đồng đội'))}">${gameIcon('x')}</button>
  </div>`;
}
