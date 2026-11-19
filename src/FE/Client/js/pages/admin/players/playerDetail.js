import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { EN, FR, T, avatarFor, entranceKey, frameKey, loadCosmeticCatalog, prepareCosmetics, titleHTML, titleKey } from '../../../cosmetics/index.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { pill, rarityPill, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { categoryLabel, defName, itemTile, rarityLabel } from '../../market/marketKit.js';
import { auditTable } from './auditTable.js';
import {
  AVATAR_REASONS, TRADE_STATUS, actionDialog, alertBox, coins, dateTime, num, pagedList, playerLink, roleChip, routeParams, statusChip, tableHtml, writeRouteParams,
} from './shared.js';

const SOURCES = {
  STARTER: 'Quà khởi đầu', MARKET: 'Mua ở chợ', TRADE: 'Trao đổi', GRANT: 'Admin cấp', SHOP: 'Cửa hàng', CHEST: 'Mở hòm', LEVEL: 'Thưởng theo cấp', ACHIEVEMENT: 'Thành tích', WEEKLY: 'Thử thách tuần',
};
const EARNED = new Set(['LEVEL', 'ACHIEVEMENT']);
const LOCKS = { TRADE: 'Trong giao dịch', OPENING: 'Đang mở hòm', EXCHANGING: 'Đang đổi KN' };
const TABS = [
  { id: 'kho', label: 'Kho đồ' },
  { id: 'tran', label: 'Lịch sử trận' },
  { id: 'hom', label: 'Mở hòm' },
  { id: 'cho', label: 'Giao dịch chợ' },
  { id: 'traodoi', label: 'Trao đổi' },
  { id: 'nhatky', label: 'Nhật ký admin' },
];

function itemState(item) {
  if (item.lockReason === 'LISTED') return pill(`Đang rao bán · ${coins(item.listingPrice)}`, 'gold', { small: true });
  if (item.locked) return pill(LOCKS[item.lockReason] ?? 'Đang khóa', '', { small: true });
  if (item.openTradeIds?.length) return pill('Trong đề nghị trao đổi', '', { small: true });
  if (item.equipped) return pill('Đang dùng', 'ok', { small: true });
  return '<span class="adp-free">Tự do</span>';
}

const itemCell = (def, size = 36, inner = 28) => `
  <span class="adp-item">${itemTile(def, size, inner)}<span class="adp-item-text"><strong>${escapeHtml(defName(def))}</strong><span class="adp-code">${escapeHtml(def.id)}</span></span></span>`;

const reasonsToRevoke = (item) => {
  if (item.locked && item.lockReason !== 'LISTED') return 'Món này đang được xử lý, máy chủ sẽ từ chối. Thử lại sau ít phút.';
  if (item.openTradeIds?.length) return 'Món này đang nằm trong đề nghị trao đổi, máy chủ sẽ từ chối cho tới khi đề nghị kết thúc.';
  if (item.lockReason === 'LISTED') return `Tin rao ${coins(item.listingPrice)} sẽ bị hủy trước, rồi món này mới bị thu hồi. Hệ thống sẽ hủy tin rao này.`;
  if (item.equipped) return 'Người chơi đang dùng món này, hệ thống sẽ gỡ trang bị trước.';
  return null;
};

const percent = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

/** One player, everything about them, and the actions an admin can take. Histories load only when their tab opens. */
export function mountPlayerDetail(host, userId, { signal }) {
  prepareCosmetics();
  const painter = createPainter();
  let state = null;
  let activeTab = TABS.some((tab) => tab.id === routeParams().get('tab')) ? routeParams().get('tab') : 'kho';
  const opened = new Map();

  // The four numbers, each with the action that changes it (clicks are caught on the page, so redrawing keeps them working).
  const drawSummary = () => {
    const { progress, wallet } = state;
    const stat = ({ label, value, action = '', gold = false, foot = '' }) => `
      <div class="adp-stat${gold ? ' adp-stat--gold' : ''}">
        <span class="adp-stat-top"><span>${label}</span>${action}</span>
        <strong class="adp-stat-value">${value}</strong>
        ${foot}
      </div>`;
    host.querySelector('[data-adp-summary]').innerHTML = [
      stat({
        label: 'Cấp',
        value: num(progress.level),
        action: '<button class="adp-stat-act" type="button" data-adp-progress>Đặt cấp / KN</button>',
        foot: `${progress.xpToNext ? `<span class="adm-meter adm-meter--gold" aria-hidden="true"><span style="width: ${percent(progress.xp, progress.xpToNext)}%"></span></span>` : ''}
          <small>KN ${num(progress.xp)}${progress.xpToNext ? `/${num(progress.xpToNext)}` : ''}</small>`,
      }),
      stat({
        label: 'Xu dùng được',
        value: num(wallet.balance),
        gold: true,
        action: '<button class="adp-stat-act" type="button" data-adp-coins>Cộng / trừ xu</button>',
        foot: `<small>${wallet.hasAccount ? 'xu' : 'Chưa mở ví'}</small>`,
      }),
      stat({ label: 'Xu đang giữ cho lệnh mua', value: num(wallet.held), foot: '<small>xu</small>' }),
      stat({
        label: 'Ô kho đã dùng',
        value: `${num(wallet.slotsUsed)}/${num(wallet.slotCap)}`,
        action: '<button class="adp-stat-act" type="button" data-adp-grant>Cấp vật phẩm</button>',
        foot: `<span class="adm-meter" aria-hidden="true"><span style="width: ${percent(wallet.slotsUsed, wallet.slotCap)}%"></span></span>`,
      }),
    ].join('');
  };

  const drawInventory = () => {
    const panel = host.querySelector('[data-adp-panel="kho"]');
    if (!state.inventory.length) {
      panel.innerHTML = stateBox('empty', 'Kho đồ trống.');
      return;
    }
    panel.innerHTML = tableHtml([
      { label: 'Vật phẩm', cell: (item) => itemCell(item.def) },
      { label: 'Độ hiếm', cell: (item) => rarityPill(item.def.rarity, rarityLabel(item.def.rarity)) },
      { label: 'Nhóm', cell: (item) => escapeHtml(categoryLabel(item.def.category)) },
      { label: 'Tình trạng', cell: itemState },
      { label: 'Nguồn', cell: (item) => escapeHtml(SOURCES[item.source] ?? item.source) },
      { label: 'Nhận lúc', cell: (item) => `<span class="adp-date">${escapeHtml(dateTime(item.acquiredAt))}</span>` },
      {
        label: 'Thao tác',
        className: 'adp-actions',
        cell: (item) => (EARNED.has(item.source)
          ? '<span class="adp-muted" title="Cấp lại tự động nên không thu hồi được">Tự cấp theo cấp</span>'
          : `<button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-revoke="${escapeHtml(item.itemId)}" aria-label="Thu hồi ${escapeHtml(defName(item.def))}">Thu hồi</button>`),
      },
    ], state.inventory, { minWidth: 960 });
  };

  // What the player wears: the painted avatar in its frame and the title plaque, then the names in words.
  const drawLook = () => {
    const { look, progress } = state;
    const title = T[titleKey(look.titleDefId)];
    const entrance = EN[entranceKey(look.entranceDefId)];
    const frameId = frameKey(look.frameDefId);
    const frameName = frameId === 'none' ? 'Không' : (FR[frameId]?.name ?? look.frameDefId ?? 'Không');
    const box = host.querySelector('[data-adp-look]');
    box.innerHTML = `
      <div class="adp-look-pic">
        <canvas width="168" height="168" role="img" aria-label="Ảnh đại diện trong viền đang dùng"></canvas>
        <div class="adp-look-title" data-adp-title>${title ? titleHTML(title, { maxW: 190 }) : escapeHtml(look.titleDefId)}</div>
      </div>
      <p class="adp-look-text">Đang dùng: danh hiệu <strong>${escapeHtml(title?.n ?? look.titleDefId ?? '—')}</strong>
        · viền <strong>${escapeHtml(frameName)}</strong>
        · hiệu ứng vào sảnh <strong>${escapeHtml(entrance?.n ?? entrance?.name ?? look.entranceDefId)}</strong></p>`;
    painter.clear();
    const lookup = { avatar: progress.avatar, avatarUrl: progress.avatarUrl };
    painter.add(box.querySelector('canvas'), () => frameKey(state.look.frameDefId), () => avatarFor(lookup), { still: true });
    const remove = host.querySelector('[data-adp-avatar-remove]');
    if (remove) remove.hidden = !progress.avatarUrl;
  };

  const applyResult = (result) => {
    if (!result) return;
    state.wallet = { ...state.wallet, balance: result.balance ?? state.wallet.balance, held: result.held ?? state.wallet.held, slotsUsed: result.slotsUsed ?? state.wallet.slotsUsed, hasAccount: true };
    if (result.level) state.progress = { ...state.progress, level: result.level, xp: result.xp ?? state.progress.xp };
    drawSummary();
  };

  const reload = async () => {
    const fresh = await adminPlayersApi.detail(userId);
    if (!fresh || signal?.aborted) return;
    state = fresh;
    drawHeader();
    drawSummary();
    drawLook();
    drawInventory();
  };

  const showTab = (id) => {
    activeTab = id;
    writeRouteParams({ tab: id === 'kho' ? '' : id });
    host.querySelectorAll('[data-tab]').forEach((button) => {
      const on = button.dataset.tab === id;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    host.querySelectorAll('[data-adp-panel]').forEach((panel) => { panel.hidden = panel.dataset.adpPanel !== id; });
    openTab(id);
  };

  const openTab = (id) => {
    if (id === 'kho' || opened.has(id)) {
      opened.get(id)?.refresh();
      return;
    }
    const panel = host.querySelector(`[data-adp-panel="${id}"]`);
    const list = id === 'nhatky'
      ? auditTable(panel, { load: (page) => adminPlayersApi.audit(userId, page), signal, empty: 'Chưa có thao tác admin nào với người này.' })
      : pagedList(panel, { signal, ...HISTORIES[id] });
    opened.set(id, list);
    list.refresh();
  };

  const HISTORIES = {
    tran: {
      empty: 'Chưa chơi trận nào.',
      noun: 'trận',
      load: (page) => adminPlayersApi.games(userId, page),
      draw: (items) => tableHtml([
        { label: 'Vụ án', cell: (row) => `<strong class="adp-strong">${escapeHtml(row.caseTitle)}</strong>` },
        { label: 'Kết quả', cell: (row) => (row.success ? pill('Thắng', 'ok', { small: true }) : pill('Thua', 'bad', { small: true })) },
        { label: 'Điểm', num: true, cell: (row) => `${num(row.score)}${row.rank ? ` · ${escapeHtml(row.rank)}` : ''}` },
        { label: 'Lúc', cell: (row) => `<span class="adp-date">${escapeHtml(dateTime(row.at))}</span>` },
      ], items, { minWidth: 620 }),
    },
    hom: {
      empty: 'Chưa mở hòm nào.',
      noun: 'lượt mở',
      load: (page) => adminPlayersApi.chestOpenings(userId, page),
      draw: (items) => tableHtml([
        { label: 'Hòm', cell: (row) => `<strong class="adp-strong">${escapeHtml(row.chestName)}</strong>` },
        { label: 'Nhận được', cell: (row) => itemCell(row.reward) },
        { label: 'Trạng thái', cell: (row) => `<code class="adp-code">${escapeHtml(row.state)}</code>` },
        { label: 'Lúc', cell: (row) => `<span class="adp-date">${escapeHtml(dateTime(row.at))}</span>` },
      ], items, { minWidth: 680 }),
    },
    cho: {
      empty: 'Chưa có giao dịch chợ nào.',
      noun: 'giao dịch',
      load: (page) => adminPlayersApi.sales(userId, page),
      draw: (items) => tableHtml([
        { label: 'Loại', cell: (row) => (row.side === 'SOLD' ? pill('Bán', 'gold', { small: true }) : pill('Mua', '', { small: true })) },
        { label: 'Vật phẩm', cell: (row) => `<strong class="adp-strong">${escapeHtml(defName(row.def))}</strong>` },
        { label: 'Giá', num: true, cell: (row) => `<strong class="adp-strong">${coins(row.price)}</strong><br><span class="adp-muted">Phí ${num(row.fee)}</span>` },
        { label: 'Với', cell: (row) => playerLink(row.otherId, row.otherName) },
        { label: 'Lúc', cell: (row) => `<span class="adp-date">${escapeHtml(dateTime(row.at))}</span>` },
      ], items, { minWidth: 720 }),
    },
    traodoi: {
      empty: 'Chưa có đề nghị trao đổi nào.',
      noun: 'đề nghị',
      load: (page) => adminPlayersApi.trades(userId, page),
      draw: (items) => tradesTable(items),
    },
  };

  // Name, email, the account's state, and the actions on the account itself (on the right).
  const drawHeader = () => {
    const { account, progress } = state;
    host.querySelector('[data-adp-head]').innerHTML = `
      <h1 class="adp-name">${escapeHtml(account.fullName)}</h1>
      <span class="adp-email adp-break">${escapeHtml(account.email)}</span>
      <span class="adp-pills">
        ${roleChip(account.role)}
        ${statusChip(account.status)}
        ${pill(account.isEmailVerified ? 'Đã xác minh email' : 'Chưa xác minh email', account.isEmailVerified ? 'ok' : '', { small: true })}
        ${pill(account.hasSession ? 'Có phiên đăng nhập' : 'Không có phiên đăng nhập', '', { small: true })}
      </span>
      <span class="adp-created">Tạo lúc ${escapeHtml(dateTime(account.createdAt))} · <span class="adp-break">Mã: <code class="adp-code">${escapeHtml(account.userId)}</code></span></span>`;
    const canLock = account.role !== 'ADMIN' && account.status !== 'DELETED';
    const locked = account.status === 'LOCKED';
    host.querySelector('[data-adp-actions]').innerHTML = `
      ${canLock ? `<button class="btn btn-ghost ${locked ? 'adm-btn-ok' : 'adm-btn-danger'}" type="button" data-adp-lock>${locked ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}</button>` : ''}
      <button class="btn btn-ghost" type="button" data-adp-logout>Ép đăng xuất</button>
      <button class="btn btn-ghost" type="button" data-adp-avatar-remove${progress.avatarUrl ? '' : ' hidden'}>Xóa ảnh đại diện</button>`;
  };

  // ---- actions ----

  const adjustCoins = async () => {
    const result = await actionDialog({
      signal,
      title: 'Cộng / trừ xu',
      message: `Số dư hiện tại: ${coins(state.wallet.balance)}. Nhập số âm để trừ. Xu đang giữ cho lệnh mua không trừ được.`,
      notice: state.wallet.hasAccount ? null : 'Người này chưa mở ví. Thao tác này tạo ví cho họ, kèm 500 xu quà khởi đầu như mọi người chơi mới.',
      fields: [{
        name: 'amount',
        label: 'Số xu',
        type: 'number',
        validate: (value) => (Number.isInteger(Number(value)) && Number(value) !== 0 && value !== '' ? null : 'Số xu phải là số nguyên khác 0.'),
      }],
      confirmLabel: 'Cập nhật số xu',
      submit: ({ amount, reason }, idempotencyKey) => adminPlayersApi.adjustCoins(userId, { amount: Number(amount), reason: reason.trim(), idempotencyKey }),
    });
    if (result === null) return;
    applyResult(result);
    toast(`Số dư mới: ${coins(result.balance)}.`, 'success');
  };

  const grantItem = async () => {
    let defs = [];
    try {
      defs = (await adminPlayersApi.catalog()) ?? [];
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    const result = await actionDialog({
      signal,
      title: 'Cấp vật phẩm',
      message: `Kho đang dùng ${num(state.wallet.slotsUsed)}/${num(state.wallet.slotCap)} ô. Vật phẩm chiếm một ô.`,
      fields: [{
        name: 'defId',
        label: 'Vật phẩm',
        type: 'select',
        options: defs.map((def) => ({ value: def.id, label: `${defName(def)} · ${rarityLabel(def.rarity)} · ${categoryLabel(def.category)}` })),
      }],
      confirmLabel: 'Cấp vật phẩm',
      submit: ({ defId, reason }, idempotencyKey) => adminPlayersApi.grantItem(userId, { defId, reason: reason.trim(), idempotencyKey }),
    });
    if (result === null) return;
    toast('Đã cấp vật phẩm.', 'success');
    await reloadQuietly();
  };

  const revokeItem = async (item) => {
    const result = await actionDialog({
      signal,
      danger: true,
      title: `Thu hồi ${defName(item.def)}`,
      message: 'Vật phẩm bị xóa khỏi kho của người chơi và không tự trở lại.',
      notice: reasonsToRevoke(item),
      confirmLabel: 'Thu hồi',
      submit: ({ reason }, idempotencyKey) => adminPlayersApi.revokeItem(userId, item.itemId, { reason: reason.trim(), idempotencyKey }),
    });
    if (result === null) return;
    toast(result.cancelledListingId ? 'Đã hủy tin rao và thu hồi vật phẩm.' : 'Đã thu hồi vật phẩm.', 'success');
    await reloadQuietly();
  };

  const setProgress = async () => {
    const result = await actionDialog({
      signal,
      title: 'Đặt cấp / KN',
      message: 'Lên cấp thì tự cấp bù phần thưởng còn thiếu. Hạ cấp không thu hồi đồ đã nhận.',
      fields: [
        { name: 'level', label: 'Cấp', type: 'number', min: 1, max: state.progress.maxLevel, value: String(state.progress.level), validate: (value) => (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= state.progress.maxLevel ? null : `Cấp phải từ 1 đến ${state.progress.maxLevel}.`) },
        { name: 'xp', label: 'KN', type: 'number', min: 0, value: String(state.progress.xp), validate: (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 && value !== '' ? null : 'KN phải là số nguyên không âm.') },
      ],
      confirmLabel: 'Đặt cấp và KN',
      submit: ({ level, xp, reason }, idempotencyKey) => adminPlayersApi.setProgress(userId, { level: Number(level), xp: Number(xp), reason: reason.trim(), idempotencyKey }),
    });
    if (result === null) return;
    applyResult(result);
    const granted = result.grantedRewardDefIds ?? [];
    const kept = result.keptRewardDefIds ?? [];
    toast(`Đã đặt cấp ${num(result.level)}.${granted.length ? ` Cấp bù: ${granted.join(', ')}.` : ''}${kept.length ? ` Cảnh báo, vẫn giữ đồ trên cấp này: ${kept.join(', ')}.` : ''}`, kept.length ? 'info' : 'success', kept.length ? 9000 : 4200);
    await reloadQuietly(result);
  };

  const removeAvatar = async () => {
    const result = await actionDialog({
      signal,
      danger: true,
      title: 'Xóa ảnh đại diện',
      message: 'Người chơi về lại ảnh mẫu mặc định, file trên Cloudinary bị xóa.',
      presets: AVATAR_REASONS,
      confirmLabel: 'Xóa ảnh',
      submit: ({ reason }) => adminPlayersApi.removeAvatar(userId, reason.trim()),
    });
    if (result === null) return;
    toast(result.fileRemoved ? 'Đã xóa ảnh đại diện.' : 'Đã xóa ảnh khỏi hồ sơ, nhưng chưa xóa được file trên Cloudinary.', result.fileRemoved ? 'success' : 'info');
    state.progress = { ...state.progress, avatar: result.avatar, avatarUrl: null };
    drawLook();
  };

  const forceLogout = async () => {
    const result = await actionDialog({
      signal,
      danger: true,
      title: `Ép đăng xuất ${state.account.fullName}`,
      message: 'Mọi phiên đăng nhập hết hiệu lực ngay. Người chơi phải đăng nhập lại.',
      confirmLabel: 'Ép đăng xuất',
      submit: ({ reason }) => adminPlayersApi.forceLogout(userId, reason.trim()),
    });
    if (result === null) return;
    toast('Đã buộc đăng xuất.', 'success');
    state.account = { ...state.account, hasSession: false };
    drawHeader();
  };

  // The same lock and unlock as the list, through the same older routes.
  const toggleLock = async () => {
    const locked = state.account.status === 'LOCKED';
    const name = state.account.fullName;
    const result = await actionDialog({
      signal,
      danger: !locked,
      title: locked ? `Mở khóa ${name}` : `Khóa ${name}`,
      message: locked ? 'Người chơi đăng nhập lại được.' : 'Người chơi bị đăng xuất ngay và không vào được game cho tới khi mở khóa.',
      confirmLabel: locked ? 'Mở khóa' : 'Khóa tài khoản',
      submit: ({ reason }) => (locked ? adminPlayersApi.unlock(userId, reason.trim()) : adminPlayersApi.lock(userId, reason.trim())),
    });
    if (result === null) return;
    toast(locked ? 'Đã mở khóa tài khoản.' : 'Đã khóa tài khoản.', 'success');
    state.account = { ...state.account, status: result?.status ?? (locked ? 'ACTIVE' : 'LOCKED') };
    drawHeader();
    await reloadQuietly();
  };

  /** A refresh after an action that already succeeded: failing to reload it must not read as the action failing. */
  const reloadQuietly = async (result) => {
    try {
      await reload();
      // The answer of the action is newer than anything read a moment before it.
      if (result) applyResult(result);
    } catch {
      toast('Thao tác đã xong, nhưng chưa tải lại được trang.', 'info');
    }
  };

  // ---- first draw ----

  const backLink = '<a class="adm-back-link" href="/admin/players"><svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Danh sách người chơi</a>';
  host.innerHTML = `<div class="page adp-page">${backLink}${stateBox('loading', 'Đang tải người chơi…')}</div>`;

  (async () => {
    try {
      // What this player wears may have been made on the cosmetics page, which only the catalog can draw.
      [state] = await Promise.all([adminPlayersApi.detail(userId), loadCosmeticCatalog()]);
    } catch (error) {
      if (!signal?.aborted) host.innerHTML = `<div class="page adp-page">${backLink}${alertBox(error)}</div>`;
      return;
    }
    if (signal?.aborted) return;
    if (!state) {
      host.innerHTML = `<div class="page adp-page">${backLink}${alertBox({ message: 'Không tìm thấy người chơi này.' })}</div>`;
      return;
    }
    host.innerHTML = `
      <div class="page adp-page adp-detail" data-adp-loaded="true">
        ${backLink}
        <section class="adm-card adp-profile" aria-label="Tài khoản">
          <div class="adp-look" data-adp-look></div>
          <div class="adp-head" data-adp-head></div>
          <div class="adp-profile-actions" data-adp-actions></div>
        </section>
        <div class="adp-stats" data-adp-summary></div>
        <section class="adm-card adm-card--flush adp-tabs-card">
          <div class="adm-tabs" role="tablist" aria-label="Mục của người chơi">
            ${TABS.map((tab) => `<button type="button" role="tab" id="adp-tab-${tab.id}" aria-controls="adp-panel-${tab.id}" data-tab="${tab.id}" aria-selected="${tab.id === activeTab}"${tab.id === activeTab ? ' class="is-active"' : ' tabindex="-1"'}>${escapeHtml(tab.label)}</button>`).join('')}
          </div>
          ${TABS.map((tab) => `<section class="adp-panel" id="adp-panel-${tab.id}" data-adp-panel="${tab.id}" role="tabpanel" aria-labelledby="adp-tab-${tab.id}"${tab.id === activeTab ? '' : ' hidden'}></section>`).join('')}
        </section>
      </div>`;
    drawHeader();
    drawSummary();
    drawLook();
    drawInventory();

    const page = host.querySelector('.adp-page');
    const actions = {
      '[data-adp-coins]': adjustCoins,
      '[data-adp-grant]': grantItem,
      '[data-adp-progress]': setProgress,
      '[data-adp-avatar-remove]': removeAvatar,
      '[data-adp-logout]': forceLogout,
      '[data-adp-lock]': toggleLock,
    };
    page.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab) showTab(tab.dataset.tab);
      const revoke = event.target.closest('[data-revoke]');
      if (revoke) {
        const item = state.inventory.find((entry) => entry.itemId === revoke.dataset.revoke);
        if (item) revokeItem(item);
      }
      for (const [selector, action] of Object.entries(actions)) {
        if (event.target.closest(selector)) action();
      }
    }, { signal });
    // Arrow keys move between the tabs, as a tab list should.
    page.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const index = TABS.findIndex((tab) => tab.id === activeTab);
      const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      showTab(next.id);
      page.querySelector(`[data-tab="${next.id}"]`).focus();
    }, { signal });
    if (activeTab !== 'kho') openTab(activeTab);
  })();

  return () => painter.dispose();
}

/** Trade offers, shared with the economy page. */
export function tradesTable(items) {
  const side = (defs, coinsGiven) => {
    const names = defs.map((def) => escapeHtml(defName(def)));
    if (coinsGiven) names.push(coins(coinsGiven));
    return names.join(', ') || '—';
  };
  return tableHtml([
    { label: 'Người đề nghị', cell: (row) => `${playerLink(row.fromId, row.fromName)}<br><span class="adp-muted">Đưa: ${side(row.fromItems, row.fromCoins)}</span>` },
    { label: 'Người nhận', cell: (row) => `${playerLink(row.toId, row.toName)}<br><span class="adp-muted">Đưa: ${side(row.toItems, row.toCoins)}</span>` },
    { label: 'Trạng thái', cell: (row) => pill(TRADE_STATUS[row.status] ?? row.status, row.status === 'ACCEPTED' ? 'ok' : row.status === 'FAILED' || row.status === 'DECLINED' ? 'bad' : '', { small: true }) },
    { label: 'Lúc', cell: (row) => `<span class="adp-date">${escapeHtml(dateTime(row.createdAt))}</span>` },
  ], items, { minWidth: 720 });
}
