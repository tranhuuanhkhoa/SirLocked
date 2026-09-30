type Translator = (en: string, vi: string) => string;
export type TeamPing = { kind: string; senderUserId: string; expiresAt: string };
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const kinds = ['DISCOVERY', 'COMPARE', 'WAITING'] as const;
function label(kind: string, tr: Translator) {
  return kind === 'DISCOVERY' ? tr('I found something', 'Có phát hiện')
    : kind === 'COMPARE' ? tr('Let’s compare', 'Cần đối chiếu')
      : kind === 'WAITING' ? tr('Waiting for you', 'Đang chờ bạn') : '';
}
export function renderPingControls(tr: Translator): string {
  return `<details class="team-ping-controls"><summary>${escape(tr('Team ping', 'Gọi đồng đội'))}</summary>
    <div class="team-ping-options">${kinds.map((kind) => `<button type="button" class="btn btn-sm" data-team-ping="${kind}">${escape(label(kind, tr))}</button>`).join('')}</div>
    <span data-ping-feedback role="status" aria-live="polite"></span></details>`;
}
export function bindPingControls(root: ParentNode, send: (kind: string) => Promise<unknown>): () => void {
  const controller = new AbortController();
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-team-ping]'));
  for (const button of buttons) button.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    buttons.forEach((item) => item.disabled = true);
    const feedback = root.querySelector<HTMLElement>('[data-ping-feedback]');
    try {
      await send(button.dataset.teamPing!);
      button.closest('details')?.removeAttribute('open');
      if (feedback) feedback.textContent = '';
    } catch (error) {
      if (feedback) feedback.textContent = error instanceof Error ? error.message : 'Ping unavailable';
    }
    if (controller.signal.aborted) return;
    timer = setTimeout(() => { pending = false; buttons.forEach((item) => item.disabled = false); }, 3000);
  }, { signal: controller.signal });
  return () => { controller.abort(); clearTimeout(timer); };
}
export function renderPartnerPing(payload: TeamPing, tr: Translator): string {
  if (!kinds.includes(payload.kind as typeof kinds[number]) || !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= Date.now()) return '';
  return `<div class="partner-ping" role="status" aria-live="polite"><strong>${escape(tr('Your partner', 'Đồng đội'))}</strong><span>${escape(label(payload.kind, tr))}</span></div>`;
}
