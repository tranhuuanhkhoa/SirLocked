import '../../../css/30-bpa-rooms.css';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { clearRoomInvite, inviteCodeFromHash } from '../services/roomInvites.js';

// Decorative envelope for the main join card (#/join only).
const ENVELOPE_ART = `
  <svg class="bpa-rooms-envelope" viewBox="0 0 200 150" aria-hidden="true" focusable="false">
    <g transform="translate(18 26) rotate(-7 82 50)">
      <rect width="164" height="100" fill="#e9dcc0"></rect>
      <path d="M0 0L82 56L164 0" fill="none" stroke="#b9a77f" stroke-width="2"></path>
      <path d="M0 100L64 44M164 100L100 44" fill="none" stroke="#cdb789" stroke-width="1.5"></path>
      <circle cx="82" cy="56" r="16" fill="#b8382b"></circle>
      <circle cx="82" cy="56" r="11" fill="none" stroke="#8c2a20" stroke-width="1.5"></circle>
      <path d="M76 56h12M82 50v12" stroke="#f3c7b8" stroke-width="2" stroke-linecap="round"></path>
    </g>
    <g transform="translate(112 6) rotate(9)">
      <rect width="74" height="44" fill="#fbf6ed"></rect>
      <path d="M8 13H54M8 22H44" stroke="#8f8676" stroke-width="2"></path>
      <path d="M8 33H22M27 33H33M38 33H52M57 33H63" stroke="#9e3f2a" stroke-width="3"></path>
    </g>
  </svg>`;

const ICON_KEY = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <circle cx="8" cy="12" r="4"></circle><path d="M12 12h9M18 12v3.5M21 12v2.5"></path>
  </svg>`;

/**
 * The "Join with a code" card. #/join shows it as the main element and
 * #/create-room reuses it, so the ids below exist once per page.
 * `form#join-form` holds exactly one button (tests click `#join-form button`).
 */
export function joinCardHtml({ inviteCode = '', lead = false } = {}) {
  return `
  <section class="bpa-paper bpa-rooms-card bpa-rooms-join${lead ? ' is-lead' : ''}" aria-labelledby="rooms-join-h">
    <span class="bpa-pin" aria-hidden="true"></span>
    ${lead ? ENVELOPE_ART : ''}
    ${lead ? `<p class="bpa-kicker bpa-rooms-kick">${tr('Accept an invitation', 'Nhận lời mời')}</p>` : ''}
    <h2 id="rooms-join-h" class="bpa-rooms-h2">${tr('Join with a code', 'Vào bằng mã')}</h2>
    <p class="bpa-rooms-note" id="join-room-hint">${tr('Enter the 6-character code your partner shared with you.', 'Nhập mã 6 ký tự mà đồng đội đã chia sẻ.')}</p>
    ${inviteCode ? `<p class="bpa-rooms-invite" id="invite-ready" role="status">${ICON_KEY}<span>${tr('Your invitation is ready. Choose Join room to continue.', 'Đã điền mã từ lời mời. Bấm Vào phòng để tiếp tục.')}</span></p>` : ''}
    <form id="join-form" class="bpa-rooms-joinform">
      <label class="bpa-rooms-codelabel" for="join-room-code">${tr('Room code', 'Mã phòng')}</label>
      <div class="bpa-rooms-coderow">
        <input class="bpa-code bpa-rooms-code" id="join-room-code" name="code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" required
               value="${escapeHtml(inviteCode)}" placeholder="ABC123" autocomplete="off" spellcheck="false" autocapitalize="characters"
               aria-describedby="join-room-hint">
        <button class="bpa-btn bpa-btn--red bpa-rooms-joinbtn" type="submit">${tr('Join room', 'Vào phòng')}</button>
      </div>
    </form>
  </section>`;
}

/** Wires the card above: uppercase filter, then roomApi.join → clear invite → toast → lobby/game. */
export function bindJoinForm(app) {
  const input = qs('#join-room-code', app);
  const form = qs('#join-form', app);
  if (!input || !form) return;

  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const room = await roomApi.join(input.value.trim());
      if (!app.isConnected) return;
      clearRoomInvite();
      toast(tr(`Joined room ${room.roomCode}.`, `Đã vào phòng ${room.roomCode}.`), 'success');
      window.location.hash = room.status === 'IN_PROGRESS' ? `#/game/${room.roomId}` : `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}

export async function renderJoinRoomPage(app) {
  const inviteCode = inviteCodeFromHash();
  render(app, `
  <div class="bpa-container bpa-rooms-page bpa-rooms-page--join">
    <div class="bpa-rooms-top">
      <div class="bpa-label bpa-rooms-label">
        <p class="bpa-kicker">${tr('File 04 · Rooms', 'Hồ sơ 04 · Phòng')}</p>
        <h1 class="bpa-rooms-h1">${tr('Join a Room', 'Vào phòng')}</h1>
      </div>
      <p class="bpa-rooms-lead">${tr('Your partner has opened the file. Enter their room code to take the second seat at the table.', 'Đồng đội đã mở hồ sơ. Nhập mã phòng của họ để ngồi vào ghế thứ hai.')}</p>
    </div>

    <div class="bpa-rooms-cols bpa-rooms-cols--join">
      ${joinCardHtml({ inviteCode, lead: true })}

      <div class="bpa-rooms-side">
        <section class="bpa-paper bpa-paper--kraft bpa-rooms-card bpa-rooms-create" aria-labelledby="rooms-create-h">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <p class="bpa-kicker bpa-rooms-kick">${tr('No code yet?', 'Chưa có mã?')}</p>
          <h2 id="rooms-create-h" class="bpa-rooms-h2">${tr('Create a room', 'Tạo phòng')}</h2>
          <p class="bpa-rooms-note">${tr('Pick a published case, open a lobby, then send the code to your partner.', 'Chọn một vụ án đã xuất bản, mở phòng chờ rồi gửi mã cho đồng đội.')}</p>
          <a class="bpa-btn bpa-btn--ink bpa-btn--block bpa-rooms-cta" href="#/create-room">${tr('Create a room', 'Tạo phòng')}</a>
        </section>

        <aside class="bpa-paper bpa-paper--note bpa-rooms-steps" aria-labelledby="rooms-steps-h">
          <span class="bpa-tape bpa-rooms-steps-tape" aria-hidden="true"></span>
          <h2 id="rooms-steps-h" class="bpa-kicker bpa-rooms-steps-h">${tr('How to join', 'Cách vào phòng')}</h2>
          <ol class="bpa-rooms-steplist">
            <li>${tr('Your partner creates a room from a case.', 'Đồng đội tạo phòng từ một vụ án.')}</li>
            <li>${tr('They send you the 6-character code or the invite link.', 'Họ gửi cho bạn mã 6 ký tự hoặc liên kết mời.')}</li>
            <li>${tr('Enter the code, then pick your role in the lobby.', 'Nhập mã, rồi chọn vai trò trong phòng chờ.')}</li>
          </ol>
        </aside>
      </div>
    </div>
  </div>`);

  bindJoinForm(app);
}
