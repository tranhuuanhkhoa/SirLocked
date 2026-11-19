// The "Thoát" tray tool: leaving a case asks first, in the page (never a browser dialog). Leaving only disconnects:
// the server keeps the room, and the player can come back from the home page until the reconnect limit
// (RoomRecoveryRules.DisconnectTimeout, 5 minutes) ends the game.
import { tr } from '../services/i18n.js';
import { escapeHtml } from '../utils/dom.js';

export interface LeaveGameOptions {
  /** Another detective is in the room: they will see this player go offline. */
  withPartner: boolean;
  /** Closes the dialog as "stay" when the page goes away while it is open. */
  signal?: AbortSignal;
}

/** Resolves true when the player confirms leaving, false for Stay, Escape or the page going away. */
export function confirmLeaveGame({ withPartner, signal }: LeaveGameOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(false); return; }
    const text = withPartner
      ? tr('The case is kept for 5 minutes: come back from the home page with “Resume your open case” to carry on. Your partner sees you go offline, and after 5 minutes away the game ends.',
        'Ván được giữ 5 phút: quay lại từ trang chủ bằng nút “Tiếp tục ván đang chơi” để chơi tiếp. Đồng đội sẽ thấy bạn mất kết nối, và vắng quá 5 phút thì ván tự kết thúc.')
      : tr('The case is kept for 5 minutes: come back from the home page to carry on. After 5 minutes away the game ends.',
        'Ván được giữ 5 phút: quay lại từ trang chủ để chơi tiếp. Vắng quá 5 phút thì ván tự kết thúc.');
    const dialog = document.createElement('dialog');
    dialog.className = 'game-leave-dialog';
    dialog.setAttribute('aria-labelledby', 'game-leave-title');
    dialog.setAttribute('aria-describedby', 'game-leave-text');
    dialog.innerHTML = `
      <h2 id="game-leave-title">${escapeHtml(tr('Leave the case?', 'Thoát khỏi vụ án?'))}</h2>
      <p id="game-leave-text">${escapeHtml(text)}</p>
      <div class="game-leave-actions">
        <button type="button" class="bpa-btn bpa-btn--ink" data-leave="stay">${escapeHtml(tr('Stay', 'Ở lại'))}</button>
        <button type="button" class="bpa-btn bpa-btn--red" data-leave="go">${escapeHtml(tr('Leave', 'Thoát'))}</button>
      </div>`;
    document.body.append(dialog);
    const finish = (leave: boolean) => {
      signal?.removeEventListener('abort', onAbort);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(leave);
    };
    const onAbort = () => finish(false);
    signal?.addEventListener('abort', onAbort);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    // Keys pressed in the dialog must not reach the game's shortcuts or Phaser's keyboard (both listen on window).
    // Escape still closes it: the dialog's own cancel is the key's default action, not a listener.
    for (const type of ['keydown', 'keyup'] as const) dialog.addEventListener(type, (event) => event.stopPropagation());
    dialog.querySelector('[data-leave="stay"]')?.addEventListener('click', () => finish(false));
    dialog.querySelector('[data-leave="go"]')?.addEventListener('click', () => finish(true));
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-leave="stay"]')?.focus();
  });
}
