import '../../../css/36-bpa-public-rooms.css';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { navigate } from '../services/navigation.js';

/**
 * The public / private choice and the case dropdown of "Tạo phòng" (Rooms.dc.html), shared by
 * /rooms and /create-room. Private stays the default: the room is reachable only by its code.
 */
export const VISIBILITY = Object.freeze({ PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' });

const ICON_EYE = `
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const ICON_LOCK = `
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="10.5" width="14" height="10" rx="1.5"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path><path d="M12 14.5v2.5"></path></svg>`;
const ICON_PULSE = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12h4l3 7 4-14 3 7h4"></path></svg>`;
const ICON_CHEVRON = `
  <svg class="bpa-rooms-selarrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"></path></svg>`;

export const caseOptionLabel = (c) => `${c.title} · ${c.estimatedMinutes} ${tr('min', 'phút')}`;

/** Stamp in the card corner; the colour follows the mode. */
export function visibilityStampHtml(visibility) {
  const isPublic = visibility === VISIBILITY.PUBLIC;
  return `<span class="bpa-stamp bpa-rooms-visstamp${isPublic ? ' bpa-stamp--teal' : ''}" id="room-visibility-stamp" aria-hidden="true">${isPublic ? tr('Public', 'Công khai') : tr('Private', 'Riêng tư')}</span>`;
}

export function visibilityToggleHtml(visibility) {
  const option = (value, icon, title, note, tone) => `
    <button type="button" class="bpa-rooms-vis bpa-rooms-vis--${tone}" data-visibility="${value}" aria-pressed="${visibility === value}">
      ${icon}
      <strong>${title}</strong>
      <span>${note}</span>
    </button>`;
  return `
    <div class="bpa-rooms-visgroup" role="group" aria-label="${tr('Room visibility', 'Chế độ phòng')}">
      ${option(VISIBILITY.PUBLIC, ICON_EYE, tr('Public', 'Công khai'), tr('Listed for everyone, anyone can join', 'Hiện trong danh sách, ai cũng vào được'), 'teal')}
      ${option(VISIBILITY.PRIVATE, ICON_LOCK, tr('Private', 'Riêng tư'), tr('Hidden from the list, invite code only', 'Ẩn khỏi danh sách, chỉ vào bằng mã mời'), 'rust')}
    </div>`;
}

/** What happens after creation, swapped with the mode (Rooms.dc.html "rm-swap"). */
export function visibilityNoteHtml(visibility) {
  if (visibility === VISIBILITY.PUBLIC) {
    return `
      <p class="bpa-rooms-pubnote" role="status">${ICON_PULSE}<span>${tr(
        'The room appears in the public list right away; you can still share its code.',
        'Phòng sẽ xuất hiện ngay trong danh sách công khai — vẫn có thể gửi mã mời.',
      )}</span></p>`;
  }
  return `
    <div class="bpa-rooms-codeslot" role="status">
      <span class="bpa-rooms-codeslot-k">${tr('Invite code — send it to your partner', 'Mã mời — gửi cho đồng đội')}</span>
      <span class="bpa-rooms-codeslot-t">${tr('Issued as soon as the room opens — share it from the lobby.', 'Có ngay khi phòng mở — gửi cho đồng đội từ phòng chờ.')}</span>
    </div>`;
}

export function caseSelectHtml(cases, selectedCaseId) {
  return `
    <div class="bpa-rooms-casefield">
      <label class="bpa-field-label" for="room-case-select">${tr('Case', 'Vụ án')}</label>
      <div class="bpa-rooms-selectwrap">
        <select class="bpa-field bpa-rooms-select" id="room-case-select">
          ${cases.map((c) => `<option value="${escapeHtml(c.caseId)}"${c.caseId === selectedCaseId ? ' selected' : ''}>${escapeHtml(caseOptionLabel(c))}</option>`).join('')}
        </select>
        ${ICON_CHEVRON}
      </div>
    </div>`;
}

/**
 * Wires the toggle inside `root`: repaints the pressed state, the stamp and the note, and reports
 * the new value. Only those nodes are touched, so focus and typed text elsewhere survive.
 */
export function bindVisibilityToggle(root, { initial = VISIBILITY.PRIVATE, onChange = () => {} } = {}) {
  let visibility = initial;
  const paint = () => {
    root.querySelectorAll('[data-visibility]').forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.visibility === visibility)));
    const stamp = root.querySelector('#room-visibility-stamp');
    if (stamp) stamp.outerHTML = visibilityStampHtml(visibility);
    const note = root.querySelector('#room-visibility-note');
    if (note) note.innerHTML = visibilityNoteHtml(visibility);
  };
  root.querySelectorAll('[data-visibility]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.visibility === visibility) return;
      visibility = button.dataset.visibility;
      paint();
      onChange(visibility);
    }));
  return { get value() { return visibility; } };
}

/** The server refuses rooms for cases players can no longer play (older, non-pixel cases). */
export const CASE_NOT_PLAYABLE_CODE = 'CASE_NOT_PLAYABLE';

export function createRoomErrorText(err) {
  if (err?.errors?.code === CASE_NOT_PLAYABLE_CODE) {
    return tr('This case is no longer available. Pick one of the current cases.', 'Vụ án này không còn mở nữa. Hãy chọn một vụ án hiện có.');
  }
  return err?.message || tr('Could not create the room.', 'Không tạo được phòng.');
}

/** Creates the room and opens its lobby; re-enables the button on failure. */
export async function createRoomAndOpen(button, caseId, visibility, app) {
  if (!caseId) return;
  button.disabled = true;
  try {
    const room = await roomApi.create(caseId, visibility);
    if (app && !app.isConnected) return;
    toast(visibility === VISIBILITY.PUBLIC
      ? tr(`Public room ${room.roomCode} is open.`, `Đã mở phòng công khai ${room.roomCode}.`)
      : tr(`Room ${room.roomCode} created.`, `Đã tạo phòng ${room.roomCode}.`), 'success');
    navigate(`/lobby/${room.roomId}`);
  } catch (err) {
    toast(createRoomErrorText(err), 'error');
    button.disabled = false;
  }
}
