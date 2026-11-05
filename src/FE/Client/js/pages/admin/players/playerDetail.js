import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { EN, T, avatarFor, entranceKey, frameKey, prepareCosmetics, titleHTML, titleKey } from '../../../cosmetics/index.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { categoryLabel, defName, itemTile, rarityLabel } from '../../market/marketKit.js';
import { auditTable } from './auditTable.js';
import {
  AVATAR_REASONS, TRADE_STATUS, actionDialog, alertBox, coins, dateTime, hashParams, num, pagedList, playerLink, roleChip, statusChip, tableHtml, tabsHtml, writeHashParams,
} from './shared.js';

const SOURCES = {
  STARTER: 'Quà khởi đầu', MARKET: 'Mua ở chợ', TRADE: 'Trao đổi', GRANT: 'Admin cấp', SHOP: 'Cửa hàng', CHEST: 'Mở hòm', LEVEL: 'Thưởng theo cấp', ACHIEVEMENT: 'Thành tích',
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
  if (item.lockReason === 'LISTED') return `<span class="chip chip-gold">Đang rao bán · ${coins(item.listingPrice)}</span>`;
  if (item.locked) return `<span class="chip">${escapeHtml(LOCKS[item.lockReason] ?? 'Đang khóa')}</span>`;
  if (item.openTradeIds?.length) return '<span class="chip">Trong đề nghị trao đổi</span>';
  if (item.equipped) return '<span class="chip chip-ok">Đang dùng</span>';
  return '<span class="muted small">Tự do</span>';
}

const reasonsToRevoke = (item) => {
  if (item.locked && item.lockReason !== 'LISTED') return 'Món này đang được xử lý, máy chủ sẽ từ chối. Thử lại sau ít phút.';
  if (item.openTradeIds?.length) return 'Món này đang nằm trong đề nghị trao đổi, máy chủ sẽ từ chối cho tới khi đề nghị kết thúc.';
  if (item.lockReason === 'LISTED') return `Tin rao ${coins(item.listingPrice)} sẽ bị hủy trước, rồi món này mới bị thu hồi. Hệ thống sẽ hủy tin rao này.`;
  if (item.equipped) return 'Người chơi đang dùng món này, hệ thống sẽ gỡ trang bị trước.';
  return null;
};

/** One player, everything about them, and the actions an admin can take. Histories load only when their tab opens. */
export function mountPlayerDetail(host, userId, { signal }) {
  prepareCosmetics();
  const painter = createPainter();
  let state = null;
  let activeTab = TABS.some((tab) => tab.id === hashParams().get('tab')) ? hashParams().get('tab') : 'kho';
  const opened = new Map();

  const drawSummary = () => {
    const { progress, wallet } = state;
    host.querySelector('[data-adp-summary]').innerHTML = `
      <div class="stat-card"><span class="muted small">Cấp</span><strong>${num(progress.level)}</strong><span class="muted small">KN ${num(progress.xp)}${progress.xpToNext ? `/${num(progress.xpToNext)}` : ''}</span></div>
      <div class="stat-card"><span class="muted small">Xu dùng được</span><strong>${num(wallet.balance)}</strong>${wallet.hasAccount ? '' : '<span class="muted small">Chưa mở ví</span>'}</div>
      <div class="stat-card"><span class="muted small">Xu đang giữ cho lệnh mua</span><strong>${num(wallet.held)}</strong></div>
      <div class="stat-card"><span class="muted small">Ô kho đã dùng</span><strong>${num(wallet.slotsUsed)}/${num(wallet.slotCap)}</strong></div>`;
  };

  const drawInventory = () => {
    const panel = host.querySelector('[data-adp-panel="kho"]');
    if (!state.inventory.length) {
      panel.innerHTML = '<div class="empty-state">Kho đồ trống.</div>';
      return;
    }
    panel.innerHTML = tableHtml([
      { label: 'Vật phẩm', cell: (item) => `<span class="adp-item">${itemTile(item.def, 40, 32)}<span>${escapeHtml(defName(item.def))}<br><span class="muted small">${escapeHtml(item.def.id)}</span></span></span>` },
      { label: 'Độ hiếm', cell: (item) => escapeHtml(rarityLabel(item.def.rarity)) },
      { label: 'Nhóm', cell: (item) => escapeHtml(categoryLabel(item.def.category)) },
      { label: 'Tình trạng', cell: itemState },
      { label: 'Nguồn', cell: (item) => escapeHtml(SOURCES[item.source] ?? item.source) },
      { label: 'Nhận lúc', cell: (item) => escapeHtml(dateTime(item.acquiredAt)) },
      {
        label: 'Thao tác',
        className: 'adp-actions',
        cell: (item) => (EARNED.has(item.source)
          ? '<span class="muted small" title="Cấp lại tự động nên không thu hồi được">Tự cấp theo cấp</span>'
          : `<button class="btn btn-ghost btn-sm" type="button" data-revoke="${escapeHtml(item.itemId)}" aria-label="Thu hồi ${escapeHtml(defName(item.def))}">Thu hồi</button>`),
      },
    ], state.inventory);
  };

  const drawLook = () => {
    const { look, progress } = state;
    const title = T[titleKey(look.titleDefId)];
    const entrance = EN[entranceKey(look.entranceDefId)];
    const box = host.querySelector('[data-adp-look]');
    box.innerHTML = `
      <canvas width="168" height="168" role="img" aria-label="Ảnh đại diện trong viền đang dùng"></canvas>
      <div class="adp-look-text">
        <div data-adp-title>${title ? titleHTML(title, { maxW: 260 }) : escapeHtml(look.titleDefId)}</div>
        <span class="muted small">Viền: ${escapeHtml(look.frameDefId ?? 'Không')}</span>
        <span class="muted small">Hiệu ứng vào sảnh: ${escapeHtml(entrance?.n ?? entrance?.name ?? look.entranceDefId)}</span>
      </div>`;
    painter.clear();
    const lookup = { avatar: progress.avatar, avatarUrl: progress.avatarUrl };
    painter.add(box.querySelector('canvas'), () => frameKey(state.look.frameDefId), () => avatarFor(lookup), { still: true });
    host.querySelector('[data-adp-avatar-remove]').hidden = !progress.avatarUrl;
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
    writeHashParams({ tab: id === 'kho' ? '' : id });
    host.querySelectorAll('[data-tab]').forEach((button) => {
      const on = button.dataset.tab === id;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
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
      load: (page) => adminPlayersApi.games(userId, page),
      draw: (items) => tableHtml([
        { label: 'Vụ án', cell: (row) => escapeHtml(row.caseTitle) },
        { label: 'Kết quả', cell: (row) => (row.success ? '<span class="chip chip-ok">Thắng</span>' : '<span class="chip chip-bad">Thua</span>') },
        { label: 'Điểm', cell: (row) => `${num(row.score)}${row.rank ? ` · ${escapeHtml(row.rank)}` : ''}` },
        { label: 'Lúc', cell: (row) => escapeHtml(dateTime(row.at)) },
      ], items),
    },
    hom: {
      empty: 'Chưa mở hòm nào.',
      load: (page) => adminPlayersApi.chestOpenings(userId, page),
      draw: (items) => tableHtml([
        { label: 'Hòm', cell: (row) => escapeHtml(row.chestName) },
        { label: 'Nhận được', cell: (row) => `<span class="adp-item">${itemTile(row.reward, 36, 28)}<span>${escapeHtml(defName(row.reward))}</span></span>` },
        { label: 'Trạng thái', cell: (row) => escapeHtml(row.state) },
        { label: 'Lúc', cell: (row) => escapeHtml(dateTime(row.at)) },
      ], items),
    },
    cho: {
      empty: 'Chưa có giao dịch chợ nào.',
      load: (page) => adminPlayersApi.sales(userId, page),
      draw: (items) => tableHtml([
        { label: 'Loại', cell: (row) => (row.side === 'SOLD' ? 'Bán' : 'Mua') },
        { label: 'Vật phẩm', cell: (row) => escapeHtml(defName(row.def)) },
        { label: 'Giá', cell: (row) => `${coins(row.price)}<br><span class="muted small">Phí ${num(row.fee)}</span>` },
        { label: 'Với', cell: (row) => playerLink(row.otherId, row.otherName) },
        { label: 'Lúc', cell: (row) => escapeHtml(dateTime(row.at)) },
      ], items),
    },
    traodoi: {
      empty: 'Chưa có đề nghị trao đổi nào.',
      load: (page) => adminPlayersApi.trades(userId, page),
      draw: (items) => tradesTable(items),
    },
  };

  const drawHeader = () => {
    const { account } = state;
    host.querySelector('[data-adp-head]').innerHTML = `
      <h2 class="adp-name">${escapeHtml(account.fullName)}</h2>
      <p class="muted adp-break">${escapeHtml(account.email)}</p>
      <p class="adp-chips">
        ${roleChip(account.role)} ${statusChip(account.status)}
        <span class="chip">${account.isEmailVerified ? 'Đã xác minh email' : 'Chưa xác minh email'}</span>
        <span class="chip">${account.hasSession ? 'Có phiên đăng nhập' : 'Không có phiên đăng nhập'}</span>
      </p>
      <p class="muted small">Tạo lúc ${escapeHtml(dateTime(account.createdAt))} · <span class="adp-break">Mã: ${escapeHtml(account.userId)}</span></p>`;
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

  host.innerHTML = '<div class="page"><p class="muted">Đang tải người chơi…</p></div>';

  (async () => {
    try {
      state = await adminPlayersApi.detail(userId);
    } catch (error) {
      if (!signal?.aborted) host.innerHTML = `<div class="page">${alertBox(error)}<p><a class="adp-link" href="#/admin/players">Về danh sách người chơi</a></p></div>`;
      return;
    }
    if (signal?.aborted) return;
    if (!state) {
      host.innerHTML = `<div class="page">${alertBox({ message: 'Không tìm thấy người chơi này.' })}<p><a class="adp-link" href="#/admin/players">Về danh sách người chơi</a></p></div>`;
      return;
    }
    host.innerHTML = `
      <div class="page adp-page" data-adp-loaded="true">
        <p><a class="adp-link" href="#/admin/players">← Danh sách người chơi</a></p>
        <section class="adp-profile">
          <div class="adp-look" data-adp-look></div>
          <div class="adp-head" data-adp-head></div>
        </section>
        <div class="stat-grid adp-summary" data-adp-summary></div>
        <div class="adp-toolbar">
          <button class="btn btn-primary" type="button" data-adp-coins>Cộng / trừ xu</button>
          <button class="btn btn-ghost" type="button" data-adp-grant>Cấp vật phẩm</button>
          <button class="btn btn-ghost" type="button" data-adp-progress>Đặt cấp / KN</button>
          <button class="btn btn-ghost" type="button" data-adp-avatar-remove>Xóa ảnh đại diện</button>
          <button class="btn btn-ghost" type="button" data-adp-logout>Ép đăng xuất</button>
        </div>
        ${tabsHtml(TABS, activeTab, 'Mục của người chơi')}
        ${TABS.map((tab) => `<section data-adp-panel="${tab.id}" role="tabpanel"${tab.id === activeTab ? '' : ' hidden'}></section>`).join('')}
      </div>`;
    drawHeader();
    drawSummary();
    drawLook();
    drawInventory();

    const page = host.querySelector('.adp-page');
    page.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab) showTab(tab.dataset.tab);
      const revoke = event.target.closest('[data-revoke]');
      if (revoke) {
        const item = state.inventory.find((entry) => entry.itemId === revoke.dataset.revoke);
        if (item) revokeItem(item);
      }
    }, { signal });
    const on = (selector, action) => host.querySelector(selector).addEventListener('click', action, { signal });
    on('[data-adp-coins]', adjustCoins);
    on('[data-adp-grant]', grantItem);
    on('[data-adp-progress]', setProgress);
    on('[data-adp-avatar-remove]', removeAvatar);
    on('[data-adp-logout]', forceLogout);
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
    { label: 'Người đề nghị', cell: (row) => `${playerLink(row.fromId, row.fromName)}<br><span class="muted small">Đưa: ${side(row.fromItems, row.fromCoins)}</span>` },
    { label: 'Người nhận', cell: (row) => `${playerLink(row.toId, row.toName)}<br><span class="muted small">Đưa: ${side(row.toItems, row.toCoins)}</span>` },
    { label: 'Trạng thái', cell: (row) => escapeHtml(TRADE_STATUS[row.status] ?? row.status) },
    { label: 'Lúc', cell: (row) => escapeHtml(dateTime(row.createdAt)) },
  ], items);
}
