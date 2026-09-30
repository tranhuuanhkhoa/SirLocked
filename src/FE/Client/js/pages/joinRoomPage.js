import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { clearRoomInvite, inviteCodeFromHash } from '../services/roomInvites.js';

export async function renderJoinRoomPage(app) {
  const inviteCode = inviteCodeFromHash();
  render(app, `
  <div class="page page-narrow">
    <h2>${tr('Join a Room', 'Vào phòng')}</h2>
    <p class="muted">${tr('Enter the 6-character code your partner shared with you.', 'Nhập mã 6 ký tự mà đồng đội đã chia sẻ.')}</p>
    ${inviteCode ? `<p class="muted" id="invite-ready">${tr('Your invitation is ready. Choose Join room to continue.', 'Đã điền mã từ lời mời. Bấm Vào phòng để tiếp tục.')}</p>` : ''}
    <label class="field-label" for="join-room-code">${tr('Room code', 'Mã phòng')}</label>
    <form id="join-form" class="join-form">
      <input class="field-input room-code-input" id="join-room-code" name="code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" required
             value="${escapeHtml(inviteCode)}" placeholder="ABC123" autocomplete="off" spellcheck="false">
      <button class="btn btn-primary" type="submit">${tr('Join room', 'Vào phòng')}</button>
    </form>
  </div>`);

  const input = qs('.room-code-input', app);
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  qs('#join-form', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const room = await roomApi.join(input.value.trim());
      if (!app.isConnected) return;
      clearRoomInvite();
      toast(`Joined room ${room.roomCode}.`, 'success');
      window.location.hash = room.status === 'IN_PROGRESS' ? `#/game/${room.roomId}` : `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}
