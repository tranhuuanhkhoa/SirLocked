import { roomApi } from '../api/roomApi.js';
import { render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderJoinRoomPage(app) {
  render(app, `
  <div class="page page-narrow">
    <h2>Join a Room</h2>
    <p class="muted">Enter the 6-character code your partner shared with you.</p>
    <form id="join-form" class="join-form">
      <input class="field-input room-code-input" name="code" maxlength="6" required
             placeholder="ABC123" autocomplete="off" spellcheck="false">
      <button class="btn btn-primary" type="submit">Join room</button>
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
      toast(`Joined room ${room.roomCode}.`, 'success');
      window.location.hash = room.status === 'IN_PROGRESS' ? `#/game/${room.roomId}` : `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}
