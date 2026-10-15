import type { DiscoveryNotice, GameUiModel } from './gameUiModel.js';
import { initials } from '../utils/dom.js';

type Translate = (english: string, vietnamese: string) => string;

function html(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Line icons of the "Bảng phá án" game screen (24×24, stroke = currentColor).
const ICON_PATHS: Record<string, string> = {
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6"/>',
  bag: '<path d="M5 9h14l-1 11H6z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/><path d="M5 13h14"/>',
  file: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 11h18"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  hint: '<path d="M9 17h6"/><path d="M10 20h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.6"/><path d="M12 17.2v.1"/>',
  call: '<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3.5"/><path d="M12 13.6v.1"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M10 2.5h4"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5"/><path d="M12 14.5v2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M10.5 7.8v3.4"/><path d="M10.5 13.4v.1"/>',
  compare: '<path d="M3.5 3.5h7v9h-7z"/><path d="M13.5 11.5h7v9h-7z"/><path d="M13.5 6.5h3a2 2 0 0 1 2 2v1"/><path d="M16.8 7.8l1.7 1.7 1.7-1.7"/><path d="M10.5 17.5h-3a2 2 0 0 1-2-2v-1"/><path d="M7.2 16.2l-1.7-1.7-1.7 1.7"/>',
  wait: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4.6 8 4.6 8 8.5s-8 3.9-8 8.5"/><path d="M16 3.5c0 4.6-8 4.6-8 8.5s8 3.9 8 8.5"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  merge: '<path d="M3 6h7l-1.6 2.4L10 11l-1.6 2.4L10 16H3z"/><path d="M21 8h-7l1.6 2.4L14 13l1.6 2.4L14 18h7z"/>',
  door: '<path d="M3.5 20.5h17"/><path d="M6 20.5V3.5h9v17"/><path d="M12 12.3v.2"/><path d="M15 12h6"/><path d="M18.5 9.5L21 12l-2.5 2.5"/>',
  wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.5a10 10 0 0 1 4.2-2.4"/><path d="M12.4 9.8A10 10 0 0 1 19 12.5"/><path d="M12 20h.01"/>',
};

/** Inline SVG icon; decorative unless a label is given. */
export function gameIcon(name: keyof typeof ICON_PATHS | string, className = 'bpa-g-ic') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] ?? ''}</svg>`;
}

export function romanNumeral(value: number) {
  let rest = Math.max(1, Math.floor(value));
  let out = '';
  for (const [unit, glyph] of [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) {
    while (rest >= unit) { out += glyph; rest -= unit; }
  }
  return out;
}

export function roleName(role: string | null | undefined, tr: Translate) {
  if (role === 'INVESTIGATOR') return tr('Investigator', 'Điều tra viên');
  if (role === 'INTERROGATOR') return tr('Interrogator', 'Thẩm vấn viên');
  return tr('Detective', 'Thám tử');
}

function shortRole(role: string, tr: Translate) {
  if (role === 'INVESTIGATOR') return tr('INV', 'ĐTV');
  if (role === 'INTERROGATOR') return tr('INT', 'TVV');
  return role || '—';
}

/** "10:33" for the investigation clock. */
export function clockText(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return hours ? `${hours}:${mm}` : mm;
}

export type HudExtras = {
  sceneTitle: string;
  actNumber: number;
  roomCode: string;
  clockSeconds: number;
  /** Role-shaped progress inside the current location: exhibits examined or statements taken. */
  progress: { done: number; total: number; unit: 'EVIDENCE' | 'TESTIMONY' } | null;
  /** What each detective is doing or where they are (keyed by user id). */
  whereabouts: Record<string, string>;
};

export function renderGameHud(model: GameUiModel, caseTitle: string, localUserId: string, tr: Translate, extras?: HudExtras) {
  const progressLabel = model.sceneProgressState === 'COMPLETE'
    ? tr('Location investigated', 'Đã điều tra xong địa điểm')
    : model.sceneProgressState === 'READY'
      ? tr('Route forward available', 'Đã mở lối điều tra tiếp theo')
      : model.sceneProgressRemaining > 0
        ? `${model.sceneProgressRemaining} ${tr('lead(s) still open', 'manh mối còn bỏ ngỏ')}`
        : tr('Follow the current lead', 'Theo dấu manh mối hiện tại');
  const progress = extras?.progress;
  const percent = model.sceneProgressState === 'COMPLETE'
    ? 100
    : progress && progress.total > 0
      ? Math.round(Math.min(1, progress.done / progress.total) * 100)
      : model.sceneProgressState === 'READY' ? 100 : 0;
  const countLabel = progress && progress.total > 0
    ? `${Math.min(progress.done, progress.total)}/${progress.total} ${progress.unit === 'EVIDENCE' ? tr('exhibits', 'vật chứng') : tr('statements', 'lời khai')}`
    : '';
  const act = extras ? `${tr('Act', 'Hồi')} ${romanNumeral(extras.actNumber)}` : '';

  const players = model.players.map((player) => {
    const isLocal = player.userId === localUserId;
    const firstName = player.username.split(' ')[0] || player.username;
    const activity = !isLocal && model.partnerActivity?.actorUserId === player.userId
      ? `<i class="partner-activity" role="status">${model.partnerActivity.message.trim().toLocaleLowerCase().startsWith(model.partnerActivity.actorName.trim().toLocaleLowerCase())
        ? ''
        : `<span>${html(model.partnerActivity.actorName)} </span>`}${html(model.partnerActivity.message)}</i>`
      : `<i>${html(extras?.whereabouts[player.userId] || '—')}</i>`;
    return `<div class="detective-presence bpa-g-row ${isLocal ? 'is-local' : ''} ${player.isConnected ? '' : 'is-offline'}">
      <span class="bpa-g-mono ${player.role === 'INTERROGATOR' ? 'is-rust' : ''}" aria-hidden="true">${html(initials(player.username))}</span>
      <span class="bpa-g-row-txt">
        <b><span class="bpa-g-row-name">${isLocal ? `${tr('You', 'Bạn')} · ${html(firstName)}` : html(firstName)}</span><abbr class="bpa-g-role" title="${html(roleName(player.role, tr))}">${shortRole(player.role, tr)}</abbr>${player.isConnected ? '' : `<em class="bpa-g-offline">${tr('OFFLINE', 'MẤT KẾT NỐI')}</em>`}</b>
        ${activity}
      </span>
      <span class="presence-dot bpa-g-dot" role="img" aria-label="${player.isConnected ? tr('Connected', 'Đang kết nối') : tr('Disconnected', 'Mất kết nối')}"></span>
    </div>`;
  }).join('');

  return `<section class="objective-brief bpa-g-obj bpa-g-glass" aria-label="${tr('Current investigation objective', 'Mục tiêu điều tra hiện tại')}">
      <span class="bpa-g-obj-pin" aria-hidden="true"></span>
      <div class="objective-kicker bpa-g-kick">${html(caseTitle)}${act ? ` · ${html(act)}` : ''}</div>
      ${extras?.sceneTitle ? `<h1 class="bpa-g-obj-title">${html(extras.sceneTitle)}</h1>` : ''}
      <span class="bpa-g-mute">${tr('Current investigation objective', 'Mục tiêu điều tra hiện tại')}</span>
      <p class="objective-copy">${html(model.objective)}</p>
      <div class="scene-progress is-${model.sceneProgressState.toLowerCase()}">
        <span class="bpa-g-thread" style="--bpa-g-p: ${percent}%" aria-hidden="true"><i></i><b></b></span>
        ${countLabel ? `<span class="bpa-g-prog-count bpa-g-mute">${html(countLabel)}</span>` : ''}
        <span class="bpa-g-prog-state bpa-g-mute">${html(progressLabel)}</span>
      </div>
    </section>
    ${extras ? `<div class="bpa-g-timer bpa-g-glass" role="timer" aria-label="${tr('Investigation time', 'Thời gian điều tra')}">
      ${gameIcon('clock')}<span class="bpa-g-clock" id="bpa-g-clock">${clockText(extras.clockSeconds)}</span>
    </div>` : ''}
    <aside class="coop-presence bpa-g-team bpa-g-glass" aria-label="${tr('Detective team', 'Đội điều tra')}">
      <div class="bpa-g-team-hd"><span class="bpa-g-kick">${tr('Detective team', 'Đội điều tra')}</span>${extras?.roomCode ? `<span class="bpa-g-mute">${tr('Room', 'Phòng')} ${html(extras.roomCode)}</span>` : ''}</div>
      <div class="game-players">${players}</div>
    </aside>
    <div id="game-reconnect-wait-slot"></div>`;
}

type PresencePlayer = {
  isConnected: boolean;
  disconnectedAt?: string | null;
  reconnectGraceEndsAt?: string | null;
};

export function reconnectWait(players: PresencePlayer[], now = Date.now()) {
  const offline = players.filter((player) => player.isConnected === false);
  if (!offline.length) return null;
  const deadlines = offline.map((player) => {
    const explicit = Date.parse(player.reconnectGraceEndsAt ?? '');
    if (Number.isFinite(explicit)) return explicit;
    const disconnectedAt = Date.parse(player.disconnectedAt ?? '');
    return Number.isFinite(disconnectedAt) ? disconnectedAt + 5 * 60_000 : NaN;
  }).filter(Number.isFinite);
  const deadline = deadlines.length ? Math.min(...deadlines) : null;
  return { deadline, seconds: deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000)) };
}

export function renderReconnectWait(wait: NonNullable<ReturnType<typeof reconnectWait>>, tr: Translate) {
  const message = wait.seconds === 0
    ? tr('Reconnect time elapsed. Waiting for the server to confirm the room status…', 'Đã hết thời gian kết nối lại. Đang chờ máy chủ xác nhận trạng thái phòng…')
    : tr('Waiting for a detective to reconnect. The game ends automatically after 5 minutes continuously offline.', 'Đang chờ thám tử kết nối lại. Ván chơi tự kết thúc sau 5 phút mất kết nối liên tục.');
  return `<div class="reconnect-wait" id="game-reconnect-wait">
    ${gameIcon('wifiOff')}
    <div class="bpa-g-notice-txt">
      <p role="status">${html(message)}</p>
      ${wait.seconds === null
        ? `<p class="bpa-g-mute">${tr('Syncing the reconnect deadline…', 'Đang đồng bộ hạn kết nối lại…')}</p>`
        : `<p class="bpa-g-mute">${tr('Time to reconnect', 'Thời gian kết nối lại')}: <strong role="timer" aria-live="off" id="game-reconnect-countdown"></strong></p>`}
    </div>
  </div>`;
}

export function renderContextAction(model: GameUiModel, tr: Translate) {
  const action = model.contextAction;
  if (!action || action.targetType === 'CHARACTER' || model.mode.kind !== 'EXPLORE') return '';
  return `<div class="context-action ${action.enabled ? '' : 'is-disabled'}" role="status">
    <span class="context-key">${html(action.enabled ? action.keyLabel : '—')}</span>
    <span class="context-copy"><strong>${html(action.actionLabel)}</strong><small>${html(action.label)}${action.reason ? ` · ${html(action.reason)}` : ''}</small></span>
    <span class="sr-only">${action.enabled ? '' : tr('This action is not available to your role.', 'Hành động này không dành cho vai trò của bạn.')}</span>
  </div>`;
}

export type DiscoveryCardOptions = {
  /** Private evidence (Crack cases): which role's notebook it went to. */
  privateRole?: string | null;
  /** Milliseconds since the card appeared; keeps the slide-in from restarting on redraws. */
  elapsedMs?: number;
};

export function renderDiscoveryCard(notice: DiscoveryNotice | null, tr: Translate, options: DiscoveryCardOptions = {}) {
  if (!notice) return '';
  const isPhoto = notice.kind === 'PHOTO';
  const image = notice.imageUrl
    ? isPhoto && !notice.imageUrl.startsWith('blob:')
      ? `<img data-auth-image="${html(notice.imageUrl)}" alt="">`
      : `<img src="${html(notice.imageUrl)}" alt="" onerror="this.remove()">`
    : '';
  const caption = isPhoto ? tr('Scene photo', 'Ảnh hiện trường') : notice.kind === 'ITEM' ? tr('Exhibit', 'Vật chứng') : tr('Scene detail', 'Chi tiết hiện trường');
  const subtitle = isPhoto ? tr('Photographic evidence', 'Chứng cứ ảnh') : notice.kind === 'ITEM' ? tr('Examined object', 'Vật thể đã khám nghiệm') : tr('Scene detail', 'Chi tiết hiện trường');
  const offset = options.elapsedMs ? `--bpa-t: -${Math.round(options.elapsedMs)}ms` : '';
  return `<aside class="discovery-card bpa-g-disc" role="status" aria-live="polite" aria-labelledby="bpa-g-disc-title" data-discovery-id="${html(notice.id)}" style="${offset}">
    <span class="bpa-g-disc-margin" aria-hidden="true"></span>
    <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
    <div class="bpa-g-disc-hd">
      <span class="bpa-g-disc-kick">${tr('New discovery', 'Phát hiện mới')}</span>
      <button class="discovery-dismiss bpa-g-x is-ink" id="discovery-dismiss-btn" type="button" aria-label="${tr('Dismiss discovery', 'Đóng thông báo phát hiện')}">${gameIcon('x')}</button>
    </div>
    <div class="bpa-g-disc-top">
      <figure class="bpa-g-photo ${isPhoto ? '' : 'is-obj'}">
        <span class="bpa-g-tape" aria-hidden="true"></span>
        <span class="bpa-g-photo-pic">${image}<span aria-hidden="true">${image ? '' : html(initials(notice.title) || '+')}</span></span>
        <figcaption>${html(caption)}</figcaption>
      </figure>
      <div class="bpa-g-disc-meta">
        ${options.privateRole ? `<span class="bpa-g-tagp">${tr('Private', 'Riêng')} · ${html(roleName(options.privateRole, tr))}</span>` : ''}
        <h2 class="bpa-g-disc-h" id="bpa-g-disc-title">${html(notice.title)}</h2>
        <span class="bpa-g-disc-sub">${html(subtitle)}</span>
      </div>
    </div>
    <p class="bpa-g-disc-p">${html(notice.detail)}</p>
    ${notice.clueCount > 0 ? `<p class="bpa-g-disc-count"><b>+${notice.clueCount}</b>${tr('new case-file lead(s)', 'manh mối mới trong hồ sơ')}</p>` : ''}
    <button class="discovery-case-link bpa-btn bpa-btn--red bpa-btn--block bpa-g-disc-btn" id="discovery-case-file-btn" type="button">${tr('Open case file', 'Mở hồ sơ vụ án')}${gameIcon('arrow')}</button>
  </aside>`;
}

export function renderFinalConfrontationCallout(model: GameUiModel, tr: Translate) {
  if (!model.finalConfrontationReady || model.mode.kind === 'ACCUSATION') return '';
  return `<button class="final-confrontation-callout" id="accuse-btn" type="button">
    <span>${tr('Final confrontation ready', 'Đối chất cuối cùng đã sẵn sàng')}</span>
    <strong>${tr('Build the accusation', 'Lập cáo buộc')}</strong>
  </button>`;
}
