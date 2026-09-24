import type { DiscoveryNotice, GameUiModel } from './gameUiModel.js';

type Translate = (english: string, vietnamese: string) => string;

function html(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortRole(role: string) {
  if (role === 'INVESTIGATOR') return 'INV';
  if (role === 'INTERROGATOR') return 'INT';
  return role || '—';
}

export function renderGameHud(model: GameUiModel, caseTitle: string, localUserId: string, canAbandon: boolean, tr: Translate) {
  const progressLabel = model.sceneProgressState === 'COMPLETE'
    ? tr('Location investigated', 'Đã điều tra xong địa điểm')
    : model.sceneProgressState === 'READY'
      ? tr('Route forward available', 'Đã mở lối điều tra tiếp theo')
      : model.sceneProgressRemaining > 0
        ? `${model.sceneProgressRemaining} ${tr('lead(s) still open', 'manh mối còn bỏ ngỏ')}`
        : tr('Follow the current lead', 'Theo dấu manh mối hiện tại');
  const players = model.players.map((player) => {
    const isLocal = player.userId === localUserId;
    return `<div class="detective-presence ${isLocal ? 'is-local' : ''} ${player.isConnected ? '' : 'is-offline'}">
      <span class="presence-dot" aria-hidden="true"></span>
      <span class="presence-copy"><strong>${html(player.username.split(' ')[0])}</strong><small>${shortRole(player.role)}${player.isConnected ? '' : ` · ${tr('OFFLINE', 'MẤT KẾT NỐI')}`}</small></span>
    </div>`;
  }).join('');
  const activity = model.partnerActivity
    ? `<div class="partner-activity" role="status">${model.partnerActivity.message.trim().toLocaleLowerCase().startsWith(model.partnerActivity.actorName.trim().toLocaleLowerCase())
      ? ''
      : `<span>${html(model.partnerActivity.actorName)}</span>`}${html(model.partnerActivity.message)}</div>`
    : '';

  return `<section class="objective-brief" aria-label="${tr('Current investigation objective', 'Mục tiêu điều tra hiện tại')}">
      <div class="objective-kicker">${html(caseTitle)}</div>
      <div class="objective-copy">${html(model.objective)}</div>
      <div class="scene-progress is-${model.sceneProgressState.toLowerCase()}"><span aria-hidden="true"></span>${html(progressLabel)}</div>
    </section>
    <aside class="coop-presence" aria-label="${tr('Detective team', 'Đội điều tra')}">
      <div class="game-players">${players}</div>
      ${activity}
      ${canAbandon ? `<button id="abandon-game-btn" class="btn btn-ghost btn-sm" type="button">${tr('Abandon after reconnect timeout', 'Rời ván sau thời gian chờ kết nối lại')}</button>` : ''}
    </aside>`;
}

export function renderContextAction(model: GameUiModel, tr: Translate) {
  const action = model.contextAction;
  if (!action || action.targetType === 'CHARACTER' || model.mode.kind !== 'EXPLORE') return '';
  return `<div class="context-action ${action.enabled ? '' : 'is-disabled'}" role="status">
    <span class="context-key">${html(action.keyLabel)}</span>
    <span class="context-copy"><strong>${html(action.actionLabel)}</strong><small>${html(action.label)}${action.reason ? ` · ${html(action.reason)}` : ''}</small></span>
    <span class="sr-only">${action.enabled ? '' : tr('This action is not available to your role.', 'Hành động này không dành cho vai trò của bạn.')}</span>
  </div>`;
}

export function renderDiscoveryCard(notice: DiscoveryNotice | null, tr: Translate) {
  if (!notice) return '';
  return `<aside class="discovery-card" role="status" aria-live="polite" data-discovery-id="${html(notice.id)}">
    ${notice.imageUrl ? `<div class="discovery-art"><img ${notice.kind === 'PHOTO' ? `data-auth-image="${html(notice.imageUrl)}"` : `src="${html(notice.imageUrl)}"`} alt="${html(notice.title)}"></div>` : '<div class="discovery-mark" aria-hidden="true">+</div>'}
    <div class="discovery-copy">
      <span class="discovery-kicker">${notice.kind === 'PHOTO' ? tr('Photographic evidence', 'Chứng cứ ảnh') : tr('New discovery', 'Phát hiện mới')}</span>
      <strong>${html(notice.title)}</strong>
      <p>${html(notice.detail)}</p>
      ${notice.clueCount > 0 ? `<small>${notice.clueCount} ${tr('new case-file lead(s)', 'manh mối mới trong hồ sơ')}</small>` : ''}
      <button class="discovery-case-link" id="discovery-case-file-btn" type="button">${tr('Open case file', 'Mở hồ sơ vụ án')}</button>
    </div>
    <button class="discovery-dismiss" id="discovery-dismiss-btn" type="button" aria-label="${tr('Dismiss discovery', 'Đóng thông báo phát hiện')}">×</button>
  </aside>`;
}

export function renderFinalConfrontationCallout(model: GameUiModel, tr: Translate) {
  if (!model.finalConfrontationReady || model.mode.kind === 'ACCUSATION') return '';
  return `<button class="final-confrontation-callout" id="accuse-btn" type="button">
    <span>${tr('Final confrontation ready', 'Đối chất cuối cùng đã sẵn sàng')}</span>
    <strong>${tr('Build the accusation', 'Lập cáo buộc')}</strong>
  </button>`;
}
