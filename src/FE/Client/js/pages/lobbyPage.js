import { roomApi } from '../api/roomApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

// The server owns the room lifecycle; the lobby only reacts to the status/code it is told.
const TERMINAL_STATUSES = new Set(['COMPLETED', 'ABANDONED']);
const ROOM_ENDED_CODE = 'ROOM_ENDED';

const ROLES = [
  { id: 'INVESTIGATOR', title: 'Investigator', viTitle: 'Điều tra viên', blurb: 'Examines the scene: inspects items and gathers physical evidence.', viBlurb: 'Khám nghiệm hiện trường: kiểm tra vật phẩm và thu thập chứng cứ vật lý.' },
  { id: 'INTERROGATOR', title: 'Interrogator', viTitle: 'Thẩm vấn viên', blurb: 'Questions suspects: asks dialogue and exposes contradictions.', viBlurb: 'Thẩm vấn nghi phạm: đặt câu hỏi và vạch ra mâu thuẫn.' },
];

export async function renderLobbyPage(app, roomId) {
  render(app, `<div class="page"><p class="muted">${tr('Loading lobby…', 'Đang tải phòng chờ…')}</p></div>`);

  let room;
  let leaving = false;
  let endedMessage = null;
  const me = session.user();

  const refresh = async () => {
    room = await roomApi.get(roomId);
    if (room.status === 'IN_PROGRESS') {
      window.location.hash = `#/game/${roomId}`;
      return;
    }
    draw();
  };

  // A terminal room is a dead end: show what the server said and offer the way out
  // instead of leaving the player clicking buttons that can only fail.
  const handleActionError = (err) => {
    if (err?.errors?.code === ROOM_ENDED_CODE) {
      endedMessage = err.message;
      draw();
      return;
    }
    toast(err.message, 'error');
  };

  const hub = createRoomConnection(roomId, {
    PlayerJoined: ({ room: r }) => { room = r; draw(); toast('Your partner joined the room.', 'info'); },
    PlayerLeft: ({ room: r }) => { room = r; draw(); toast('A player left the room.', 'info'); },
    RolesUpdated: ({ room: r }) => { room = r; draw(); },
    ReadyUpdated: ({ room: r }) => { room = r; draw(); },
    GameStarted: () => { window.location.hash = `#/game/${roomId}`; },
    RoomError: ({ message }) => toast(message, 'error'),
  }, { onReconnected: () => refresh().catch(() => {}) });

  try {
    await refresh();
    if (!room) return undefined;
    await hub.start();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return () => hub.stop();
  }

  function drawEnded(message) {
    render(app, `
    <div class="page page-narrow">
      <div class="lobby-head"><h2>${tr('Room closed', 'Phòng đã đóng')}</h2></div>
      <div class="empty-state">
        <p>${escapeHtml(message)}</p>
        <p class="muted small">${tr('Start a new room from the case list to play again.', 'Hãy mở phòng mới từ danh sách vụ án để chơi lại.')}</p>
        <button class="btn btn-primary" id="back-to-cases">${tr('Back to cases', 'Về danh sách vụ án')}</button>
      </div>
    </div>`);

    qs('#back-to-cases', app)?.addEventListener('click', () => {
      window.location.hash = '#/cases';
    });
  }

  function draw() {
    if (!room || leaving) return;
    if (endedMessage) {
      drawEnded(endedMessage);
      return;
    }
    if (TERMINAL_STATUSES.has(room.status)) {
      drawEnded(tr('This room has already ended and cannot be reused.', 'Phòng này đã kết thúc và không thể dùng lại.'));
      return;
    }
    const my = room.players.find((p) => p.userId === me.userId);
    const isHost = room.hostUserId === me.userId;
    const bothReady = room.players.length === 2 && room.players.every((p) => p.isReady && p.role);

    const playerRows = room.players.map((p) => `
      <div class="lobby-player ${p.isReady ? 'is-ready' : ''}">
        <span class="lobby-player-name">${escapeHtml(p.username)}
          ${p.userId === room.hostUserId ? `<span class="chip chip-gold">${tr('HOST', 'CHỦ PHÒNG')}</span>` : ''}
          ${p.userId === me.userId ? `<span class="chip">${tr('YOU', 'BẠN')}</span>` : ''}
        </span>
        <span class="chip ${p.role ? 'chip-role' : ''}">${p.role ?? tr('choosing role…', 'đang chọn vai…')}</span>
        <span class="ready-dot" title="${p.isReady ? tr('Ready', 'Sẵn sàng') : tr('Not ready', 'Chưa sẵn sàng')}">${p.isReady ? tr('READY', 'SẴN SÀNG') : tr('WAITING', 'ĐANG CHỜ')}</span>
      </div>`).join('');

    const roleCards = ROLES.map((role) => {
      const takenBy = room.players.find((p) => p.role === role.id);
      const mine = my?.role === role.id;
      const blocked = takenBy && takenBy.userId !== me.userId;
      return `
      <button class="role-card ${mine ? 'is-mine' : ''} ${blocked ? 'is-taken' : ''}"
              data-role="${role.id}" ${blocked ? 'disabled' : ''}>
        <strong>${tr(role.title, role.viTitle)}</strong>
        <p>${tr(role.blurb, role.viBlurb)}</p>
        ${blocked ? `<span class="muted small">${tr('Taken by', 'Đã được chọn bởi')} ${escapeHtml(takenBy.username)}</span>` : ''}
        ${mine ? `<span class="chip chip-gold">${tr('YOUR ROLE', 'VAI CỦA BẠN')}</span>` : ''}
      </button>`;
    }).join('');

    render(app, `
    <div class="page page-narrow">
      <div class="lobby-head">
        <h2>${tr('Room Lobby', 'Phòng chờ')}</h2>
        <div class="room-code-box">
          <span class="muted small">${tr('ROOM CODE', 'MÃ PHÒNG')}</span>
          <strong class="room-code">${escapeHtml(room.roomCode)}</strong>
          <button class="btn btn-ghost btn-sm" id="copy-code">${tr('Copy', 'Sao chép')}</button>
        </div>
      </div>
      <p class="muted">${tr('Case:', 'Vụ án:')} <strong>${escapeHtml(room.caseTitle)}</strong> — ${tr('waiting for two ready detectives.', 'đang chờ hai thám tử sẵn sàng.')}</p>

      <h3 class="section-title">${tr('Detectives', 'Thám tử')} (${room.players.length}/2)</h3>
      <div class="lobby-players">${playerRows}</div>

      <h3 class="section-title">${tr('Pick your role', 'Chọn vai trò')}</h3>
      <div class="role-grid">${roleCards}</div>

      <div class="lobby-actions">
        <button class="btn ${my?.isReady ? 'btn-ghost' : 'btn-primary'}" id="ready-btn" ${my?.role ? '' : 'disabled title="Pick a role first"'}>
          ${my?.isReady ? tr('Cancel ready', 'Hủy sẵn sàng') : tr('Ready up', 'Sẵn sàng')}
        </button>
        ${isHost ? `<button class="btn btn-gold" id="start-btn" ${bothReady ? '' : `disabled title="${tr('Both players must pick different roles and ready up', 'Cả hai người phải chọn vai khác nhau và sẵn sàng')}"`}>${tr('Start investigation', 'Bắt đầu điều tra')}</button>` : `<span class="muted small">${tr('The host starts the game when everyone is ready.', 'Chủ phòng sẽ bắt đầu khi mọi người đã sẵn sàng.')}</span>`}
        <button class="btn btn-ghost" id="leave-btn">${tr('Leave room', 'Rời phòng')}</button>
      </div>
    </div>`);

    qs('#copy-code', app)?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(room.roomCode);
        toast('Room code copied.', 'success');
      } catch {
        toast(`Room code: ${room.roomCode}`, 'info');
      }
    });

    app.querySelectorAll('[data-role]').forEach((card) =>
      card.addEventListener('click', async () => {
        try {
          room = await roomApi.selectRole(roomId, card.dataset.role);
          draw();
        } catch (err) {
          handleActionError(err);
        }
      }));

    qs('#ready-btn', app)?.addEventListener('click', async () => {
      try {
        room = await roomApi.ready(roomId, !my?.isReady);
        draw();
      } catch (err) {
        handleActionError(err);
      }
    });

    qs('#start-btn', app)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await roomApi.start(roomId);
        window.location.hash = `#/game/${roomId}`;
      } catch (err) {
        handleActionError(err);
        draw();
      }
    });

    qs('#leave-btn', app)?.addEventListener('click', async () => {
      leaving = true;
      try {
        await roomApi.leave(roomId);
      } catch {
        /* leaving anyway */
      }
      window.location.hash = '#/cases';
    });
  }

  return () => hub.stop();
}
