import '../../../../css/48-cosmetics.css';
import { marketApi, newRequestId } from '../../api/marketApi.js';
import { progressApi } from '../../api/progressApi.js';
import {
  AVS, EN, FR, FRAME_PREFIX, ENTRANCE_PREFIX, RAR, T, TITLE_PREFIX,
  avatarFor, avatarImg, chime, closeStage, cosmeticDefaults, entranceList, forgetCanvas, frameGroups, frameKey, loadCosmeticCatalog, loadCosmeticsIfUnknown,
  paintFrame, prepareCosmetics, rarOf, reduce, setPlaqueMotion, titleHTML, titleKey, titleList, xpRates,
  entranceKey, warmEntranceArt, whenTitleFontReady,
} from '../../cosmetics/index.js';
import { playEntrance } from '../../cosmetics/entrances.js';
import { createPainter } from '../../cosmetics/painter.js';
import { tr, uiLanguage } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import { errorText } from '../market/marketKit.js';
import { AvatarFileProblem, squareAvatar } from './avatarFile.js';

const TABS = [
  { id: 'doi', label: () => tr('Exchange for XP', 'Đổi kinh nghiệm') },
  { id: 'vien', label: () => tr('Avatar frames', 'Viền avatar') },
  { id: 'danhhieu', label: () => tr('Titles', 'Danh hiệu') },
  { id: 'sanh', label: () => tr('Lobby entrance', 'Hiệu ứng vào sảnh') },
];
const CATEGORY = { frame: 'FRAME', title: 'TITLE', entrance: 'ENTRANCE' };
const RESIZE_DEBOUNCE_MS = 200;

/* errorText speaks for the market; past the checks made here, what fails is the image host */
const uploadErrorText = (error) => {
  if (error instanceof AvatarFileProblem) return error.message;
  return error?.status >= 500 ? tr('The picture could not be saved. Please try again.', 'Chưa lưu được ảnh. Vui lòng thử lại.') : errorText(error);
};

const SOURCE_EN = {
  'Mặc định': 'Default',
  'Chỉ admin cấp': 'Admin only',
  'Chơi 10 vụ': 'Play 10 cases',
  'Ghi 50 lời khai': 'Record 50 statements',
  'Tìm 100 manh mối': 'Find 100 clues',
  'Giải 25 câu đố ổ khóa': 'Solve 25 lock puzzles',
  'Phá án lúc nửa đêm': 'Solve a case at midnight',
  'Phá án không dùng gợi ý': 'Solve a case without hints',
  'Thắng 50 vụ': 'Win 50 cases',
  'Sở hữu Đồng hồ 2:17': 'Own the 2:17 watch',
};
const CHEST_EN = { 'Hòm Niêm Phong': 'the Sealed Case', 'Két Nhà Băng': 'the Bank Safe', 'Tráp Sơn Mài': 'the Lacquer Box' };

/** The prototype's "how to get it", in the interface language. */
function sourceText(source) {
  if (uiLanguage() === 'vi' || !source) return source;
  if (SOURCE_EN[source]) return SOURCE_EN[source];
  const level = source.match(/^(?:Đạt c|C)ấp (\d+)$/);
  if (level) return `Level ${level[1]}`;
  const chest = source.match(/^Ra từ (.+)$/);
  if (chest) return `From ${CHEST_EN[chest[1]] ?? chest[1]}`;
  const mystery = source.match(/^Bí ẩn · (.+)$/);
  if (mystery) return mystery[1] === 'mọi hòm' ? 'Mystery · every chest' : `Mystery · ${CHEST_EN[mystery[1]] ?? mystery[1]}`;
  return source;
}

/** XP that exchanging `total` would waste, because the level cap stops the climb. The curve is the server's: 200 + 40 * (level - 1). */
function xpBeyondCap(me, total) {
  let room = me.xpToNext - me.xp;
  for (let level = me.level + 1; level < me.maxLevel; level++) room += 200 + 40 * (level - 1);
  return Math.max(0, total - room);
}

const rarityName = (rar) => tr(rar.en, rar.n);
/** Which drawing a detective with nothing equipped wears. The admin page can change it. */
const defaultFrame = () => cosmeticDefaults().frame;
const defaultTitle = () => cosmeticDefaults().title;
const defaultEntrance = () => cosmeticDefaults().entrance;
const fmt = (value) => Number(value).toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-US');

/**
 * The cosmetic half of a detective's profile: portrait in its frame, title, level, and for one's own
 * profile the four tabs of the approved design. The server decides everything: what is owned, what is
 * worn, what an exchange pays. `extraTabs` adds tabs that need none of that ({ id, label(), render(panel) }).
 * Returns `dispose` to take it all down again and `openTab(id)`.
 */
export function mountCosmeticsPanel(host, { userId, isOwnProfile, displayName, extraTabs = [] }) {
  prepareCosmetics();
  const tabs = [...TABS, ...extraTabs];
  const painter = createPainter();
  const listeners = new AbortController();
  let disposed = false;
  let me = null;
  let activeTab = 'doi';
  let busy = false;
  let uploading = false;
  let entrance = null;
  let resizeTimer = 0;
  let unavailable = false;
  let headerOnScreen = true;
  // The plaque at the top rests while it is scrolled away, which is most of the time in a long tab.
  const headerWatch = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      headerOnScreen = entries[entries.length - 1].isIntersecting;
      const titleHost = host.querySelector('[data-hs-title]');
      if (titleHost) setPlaqueMotion(titleHost, headerOnScreen);
    })
    : null;
  // One key per user action; kept after a failed request so resending it cannot pay twice.
  let retry = null;

  const $ = (selector) => host.querySelector(selector);
  const look = () => ({ frameId: frameKey(me?.frameDefId), titleId: titleKey(me?.titleDefId), entranceId: entranceKey(me?.entranceDefId) });
  const live = (message) => { const el = $('[data-hs-live]'); if (el) el.textContent = message; };
  const ownedFree = (defId) => me?.owned?.find((item) => item.defId === defId && !item.locked);
  const owns = (defId) => !!me?.owned?.some((item) => item.defId === defId);
  const shake = (el) => {
    if (reduce.matches) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 300, easing: 'ease-in-out' });
  };

  // ---- shell ------------------------------------------------------------------------------

  function renderShell() {
    host.innerHTML = `
    <section class="hs-root" aria-label="${escapeHtml(tr('Detective portrait', 'Chân dung thám tử'))}">
      <div class="hs-wrap">
        <div class="hs-card">
          <div class="hs-pic">
            <canvas data-hs-me width="236" height="236" role="img" aria-label="${escapeHtml(tr('Avatar in the current frame', 'Ảnh đại diện trong viền đang dùng'))}"></canvas>
            ${isOwnProfile ? `<button class="hs-btn hs-chg" data-hs-change type="button" aria-expanded="false">${escapeHtml(tr('Change avatar', 'Đổi ảnh đại diện'))}</button>` : ''}
          </div>
          <div class="hs-who">
            <h2 class="hs-name">${escapeHtml(displayName)}</h2>
            <div data-hs-title></div>
            <div class="hs-lvrow">
              <span class="hs-lv" data-hs-level></span>
              <span class="hs-bar"><i data-hs-bar></i></span>
              <span data-hs-xp></span>
            </div>
          </div>
        </div>
        ${isOwnProfile ? `
        <section class="hs-picker" data-hs-picker hidden aria-label="${escapeHtml(tr('Choose an avatar', 'Chọn ảnh đại diện'))}">
          <h3>${escapeHtml(tr('Avatar', 'Ảnh đại diện'))}</h3>
          <div class="hs-avs" data-hs-avatars></div>
          <p class="hs-picker-note" data-hs-avatars-note hidden>${escapeHtml(tr('Choose a picture from your computer or phone. Its middle is cut to a square.', 'Chọn ảnh từ máy tính hoặc điện thoại. Hệ thống lấy phần giữa ảnh và cắt thành hình vuông.'))}</p>
        </section>
        <div class="hs-tabs" role="tablist" aria-label="${escapeHtml(tr('Profile sections', 'Mục hồ sơ'))}">
          ${tabs.map((tab) => `<button class="hs-tab" role="tab" type="button" id="hs-tab-${tab.id}" data-hs-tab="${tab.id}" aria-controls="hs-p-${tab.id}" aria-selected="false">${escapeHtml(tab.label())}</button>`).join('')}
        </div>
        ${tabs.map((tab) => `<section class="hs-panel" id="hs-p-${tab.id}" role="tabpanel" aria-labelledby="hs-tab-${tab.id}" hidden></section>`).join('')}` : ''}
        <div class="hs-sr" aria-live="polite" data-hs-live></div>
      </div>
    </section>`;
    painter.add($('[data-hs-me]'), () => look().frameId, () => avatarFor(me));
    headerWatch?.observe($('[data-hs-title]'));
    if (isOwnProfile) {
      $('[data-hs-change]').addEventListener('click', togglePicker);
      host.querySelectorAll('[data-hs-tab]').forEach((button) => button.addEventListener('click', () => openTab(button.dataset.hsTab)));
    }
  }

  function renderHeader() {
    const level = me?.level ?? 1;
    $('[data-hs-level]').textContent = String(level);
    const titleHost = $('[data-hs-title]');
    const width = Math.max(240, titleHost.parentElement.clientWidth - 4);
    titleHost.innerHTML = titleHTML(T[look().titleId] ?? T[defaultTitle()], { scale: 1.1, maxW: width });
    setPlaqueMotion(titleHost, headerOnScreen);
    const bar = $('[data-hs-bar]');
    const text = $('[data-hs-xp]');
    if (!isOwnProfile) {
      bar.parentElement.hidden = true;
      text.textContent = tr(`Level ${level}`, `Cấp ${level}`);
    } else if (me.isMaxLevel) {
      bar.style.width = '100%';
      text.textContent = tr('Max level', 'Cấp tối đa');
    } else {
      bar.style.width = `${((me.xp / me.xpToNext) * 100).toFixed(1)}%`;
      text.textContent = `${fmt(me.xp)} / ${fmt(me.xpToNext)} ${tr('XP', 'KN')}`;
    }
  }

  // ---- tabs -------------------------------------------------------------------------------

  function openTab(id) {
    if (unavailable) return;
    activeTab = id;
    for (const tab of tabs) {
      $(`#hs-tab-${tab.id}`).setAttribute('aria-selected', String(tab.id === id));
      const panel = $(`#hs-p-${tab.id}`);
      panel.hidden = tab.id !== id;
      if (tab.id !== id) panel.innerHTML = '';
    }
    painter.clear();
    painter.add($('[data-hs-me]'), () => look().frameId, () => avatarFor(me));
    const extra = extraTabs.find((tab) => tab.id === id);
    if (extra) extra.render($(`#hs-p-${id}`));
    // A tab clicked before the portrait has loaded is drawn when it arrives.
    else if (me) ({ doi: renderExchange, vien: renderFrames, danhhieu: renderTitles, sanh: renderEntrances })[id]();
  }

  const renderActiveTab = () => { if (isOwnProfile) openTab(activeTab); };

  /** How to draw what this detective owns and wears: it may have been made after this page loaded. */
  const knowWhatIsWorn = () => (me ? loadCosmeticsIfUnknown([me.frameDefId, me.titleDefId, me.entranceDefId, ...(me.owned ?? []).map((item) => item.defId)]) : Promise.resolve(false));

  async function refresh() {
    const [fresh] = await Promise.all([progressApi.me(), loadCosmeticCatalog()]);
    me = fresh;
    if (disposed) return;
    await knowWhatIsWorn();
    if (disposed) return;
    renderHeader();
    renderActiveTab();
    renderAvatarsIfOpen();
  }

  // ---- exchange ---------------------------------------------------------------------------

  function renderExchange() {
    const panel = $('#hs-p-doi');
    const groups = new Map();
    for (const item of me.exchangeable) {
      if (!groups.has(item.def.id)) groups.set(item.def.id, { def: item.def, xp: item.xp, ids: [] });
      groups.get(item.def.id).ids.push(item.itemId);
    }
    const total = me.exchangeable.reduce((sum, item) => sum + item.xp, 0);
    const maxed = me.isMaxLevel;
    const rates = xpRates();
    panel.innerHTML = `
      <p class="hs-hint">${tr(
    `<b style="color:${RAR.rare.c}">Rare</b> items give <b>${fmt(rates.rare)} XP</b>, <b style="color:${RAR.myth.c}">Epic</b> items give <b>${fmt(rates.epic)} XP</b>. Every 10 levels unlocks a new frame.`,
    `Vật phẩm <b style="color:${RAR.rare.c}">Hiếm</b> đổi được <b>${fmt(rates.rare)} KN</b>, vật phẩm <b style="color:${RAR.myth.c}">Quý</b> đổi được <b>${fmt(rates.epic)} KN</b>. Cứ 10 cấp mở một viền mới.`)}</p>
      ${maxed ? `<p class="hs-hint"><b>${escapeHtml(tr('You are at the highest level.', 'Bạn đã đạt cấp cao nhất.'))}</b></p>` : ''}
      ${groups.size === 0 ? `<p class="hs-hint">${tr('No Rare or Epic items to exchange yet. <a class="hs-link" href="/kho-ruong">Open a chest</a> to find some.', 'Chưa có vật phẩm Hiếm hay Quý để đổi. <a class="hs-link" href="/kho-ruong">Mở hòm</a> để có thêm.')}</p>` : ''}
      <div class="hs-items">
        ${[...groups.values()].map((group) => {
    const rar = rarOf(group.def.rarity);
    return `<div class="hs-ex" style="--rc:${rar.c}">
            <i class="hs-sw"></i>
            <span class="hs-nm"><b>${escapeHtml(tr(group.def.nameEn || group.def.name, group.def.name))}</b><span>${escapeHtml(rarityName(rar))} · ×${group.ids.length} · +${fmt(group.xp)} ${tr('XP each', 'KN mỗi món')}</span></span>
            <button class="hs-btn" type="button" data-hs-one="${escapeHtml(group.def.id)}" ${maxed ? 'disabled' : ''}>${escapeHtml(tr('Exchange 1', 'Đổi 1'))}</button>
          </div>`;
  }).join('')}
      </div>
      <div class="hs-row-actions">
        <button class="hs-btn hs-btn-amber" type="button" data-hs-all ${!total || maxed ? 'disabled' : ''}>${escapeHtml(total ? tr(`Exchange all · +${fmt(total)} XP`, `Đổi tất cả · +${fmt(total)} KN`) : tr('Nothing to exchange', 'Hết vật phẩm để đổi'))}</button>
      </div>`;
    panel.querySelectorAll('[data-hs-one]').forEach((button) => button.addEventListener('click', () => {
      const group = groups.get(button.dataset.hsOne);
      exchange([group.ids[0]]);
    }));
    panel.querySelector('[data-hs-all]').addEventListener('click', () => {
      const ids = me.exchangeable.map((item) => item.itemId);
      const wasted = xpBeyondCap(me, total);
      confirmDialog(
        tr(`Exchange ${ids.length} ${ids.length === 1 ? 'item' : 'items'} for ${fmt(total)} XP?`, `Đổi ${ids.length} vật phẩm lấy ${fmt(total)} KN?`),
        tr('The items are gone for good, and they cannot be sold afterwards.', 'Vật phẩm sẽ mất vĩnh viễn và không bán được nữa.')
          + (wasted > 0 ? ` ${tr(`Level ${me.maxLevel} is the top: ${fmt(wasted)} XP beyond it is lost.`, `Cấp ${me.maxLevel} là cao nhất: ${fmt(wasted)} KN dư sẽ mất.`)}` : ''),
        () => exchange(ids));
    });
  }

  async function exchange(itemIds) {
    if (busy) return;
    busy = true;
    const signature = [...itemIds].sort().join(',');
    if (retry?.signature !== signature) retry = { signature, key: newRequestId() };
    host.querySelectorAll('[data-hs-one],[data-hs-all]').forEach((button) => { button.disabled = true; });
    try {
      const result = await progressApi.exchange(itemIds, retry.key);
      retry = null;
      if (disposed) return;
      live(tr(`Received ${result.xpGained} XP. Level ${result.level}.`, `Nhận ${result.xpGained} kinh nghiệm. Cấp ${result.level}.`));
      await refresh();
      if (disposed) return;
      showUnlocks(result.newFrameDefIds);
      for (const defId of result.newTitleDefIds) {
        const title = T[titleKey(defId)];
        if (title) toast(tr(`New title: ${title.n}`, `Danh hiệu mới: ${title.n}`), 'success');
      }
    } catch (error) {
      // A definite answer from the server ends this action; only a lost connection may be resent as is.
      if (error?.status !== 0) retry = null;
      if (disposed) return;
      toast(errorText(error), 'error');
      await refresh().catch(() => {});
    } finally {
      busy = false;
    }
  }

  // ---- dialogs ----------------------------------------------------------------------------

  function dialog(label, inner) {
    document.querySelector('.hs-unlock')?.remove();
    const el = document.createElement('div');
    el.className = 'hs-unlock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', label);
    el.innerHTML = `<div class="hs-box">${inner}</div>`;
    const previous = document.activeElement;
    const close = () => {
      el.remove();
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, { signal: listeners.signal });
    el.addEventListener('click', (event) => { if (event.target === el) close(); });
    document.body.append(el);
    return { el, close };
  }

  function confirmDialog(heading, detail, onConfirm) {
    const { el, close } = dialog(heading, `
      <h2 class="hs-confirm-h">${escapeHtml(heading)}</h2>
      <p class="hs-hint">${escapeHtml(detail)}</p>
      <div class="hs-row-actions">
        <button class="hs-btn" type="button" data-close>${escapeHtml(tr('Keep them', 'Giữ lại'))}</button>
        <button class="hs-btn hs-btn-amber" type="button" data-ok>${escapeHtml(tr('Exchange', 'Đổi'))}</button>
      </div>`);
    el.querySelector('[data-close]').addEventListener('click', close);
    el.querySelector('[data-ok]').addEventListener('click', () => { close(); onConfirm(); });
    el.querySelector('[data-close]').focus();
  }

  /** The "new frame" screen, one frame after another when a big exchange opened several. */
  function showUnlocks(defIds) {
    const [next, ...rest] = defIds;
    if (!next) return;
    const id = frameKey(next);
    const frame = FR[id];
    if (!frame) { showUnlocks(rest); return; }
    const { el, close } = dialog(tr('New frame unlocked', 'Mở khóa viền mới'), `
      <small>${escapeHtml(tr(`Level ${frame.lv ?? me.level} · new frame unlocked`, `Cấp ${frame.lv ?? me.level} · mở khóa viền mới`))}</small>
      <canvas width="240" height="240" aria-hidden="true"></canvas>
      <h2>${escapeHtml(frame.name)}</h2>
      <div class="hs-row-actions">
        <button class="hs-btn" type="button" data-close>${escapeHtml(tr('Later', 'Để sau'))}</button>
        <button class="hs-btn hs-btn-amber" type="button" data-use>${escapeHtml(tr('Use now', 'Dùng ngay'))}</button>
      </div>`);
    const canvas = el.querySelector('canvas');
    const stopPaint = painter.onPaint((now) => paintFrame(canvas, id, now, avatarFor(me)));
    const finish = () => { stopPaint(); forgetCanvas(canvas); close(); showUnlocks(rest); };
    el.querySelector('[data-close]').addEventListener('click', finish);
    el.querySelector('[data-use]').addEventListener('click', async () => {
      finish();
      await wear(CATEGORY.frame, next, frame.name);
    });
    setTimeout(() => el.querySelector('[data-use]')?.focus(), 60);
    chime(frame.rar);
  }

  // ---- wearing ----------------------------------------------------------------------------

  async function wear(category, defId, name) {
    if (busy) return;
    busy = true;
    try {
      if (defId === null) await marketApi.unequip(category);
      else {
        const item = ownedFree(defId);
        if (!item) throw { message: tr('This item is on the market or in a trade right now.', 'Món này đang rao bán hoặc đang giao dịch.') };
        await marketApi.equip(item.itemId);
      }
      if (disposed) return;
      live(tr(`Now using ${name}.`, `Đang dùng ${name}.`));
      await refresh();
    } catch (error) {
      if (!disposed) toast(error?.errors ? errorText(error) : error.message, 'error');
    } finally {
      busy = false;
    }
  }

  // ---- frames -----------------------------------------------------------------------------

  function renderFrames() {
    const panel = $('#hs-p-vien');
    panel.innerHTML = frameGroups(owns).map(([label, ids]) => `
      <p class="hs-group-label">${escapeHtml(label)}</p>
      <div class="hs-frames">
        ${ids.map((id) => {
    const frame = FR[id];
    const rar = RAR[frame.rar];
    const ok = id === defaultFrame() || owns(FRAME_PREFIX + id);
    const lock = frame.lv ? tr(`Level ${frame.lv}`, `Cấp ${frame.lv}`) : tr('Not yet', 'Chưa có');
    return `<button class="hs-fr${ok ? '' : ' hs-locked'}" type="button" data-hs-frame="${id}" aria-pressed="${look().frameId === id}" style="--rc:${rar.c}"
              aria-label="${escapeHtml(`${frame.name}, ${rarityName(rar)}${ok ? '' : `, ${sourceText(frame.src)}`}`)}">
            <canvas width="160" height="160" aria-hidden="true"></canvas>
            <b>${escapeHtml(frame.name)}</b><span>${escapeHtml(rarityName(rar))}</span><small>${escapeHtml(sourceText(frame.src))}</small>${ok ? '' : `<i class="hs-lock">${escapeHtml(lock)}</i>`}
          </button>`;
  }).join('')}
      </div>`).join('');
    panel.querySelectorAll('[data-hs-frame]').forEach((button) => {
      const id = button.dataset.hsFrame;
      // Dimmed and grey until owned: motion there costs as much as anywhere and shows as nothing.
      const locked = id !== defaultFrame() && !owns(FRAME_PREFIX + id);
      painter.add(button.querySelector('canvas'), () => id, () => avatarFor(me), { still: locked });
      button.addEventListener('click', () => {
        const frame = FR[id];
        if (id === look().frameId) return;
        if (id === defaultFrame()) { wear(CATEGORY.frame, null, frame.name); return; }
        if (!owns(FRAME_PREFIX + id)) {
          live(tr(`${frame.name} is locked: ${sourceText(frame.src)}.`, `${frame.name} chưa mở: ${frame.src}.`));
          shake(button);
          return;
        }
        wear(CATEGORY.frame, FRAME_PREFIX + id, frame.name);
      });
    });
  }

  // ---- titles -----------------------------------------------------------------------------

  /** "How to get it", with progress for achievements. Those the record cannot count stay plainly closed. */
  function titleSource(title) {
    const achievement = me.achievements?.find((entry) => entry.titleDefId === TITLE_PREFIX + title.id);
    if (!achievement) return sourceText(title.src);
    if (!achievement.countable) return `${tr('Not open yet', 'Chưa mở')} · ${sourceText(title.src)}`;
    return achievement.target > 1 ? `${sourceText(title.src)} · ${fmt(Math.min(achievement.count, achievement.target))} / ${fmt(achievement.target)}` : sourceText(title.src);
  }

  function renderTitles() {
    const panel = $('#hs-p-danhhieu');
    panel.innerHTML = '<div class="hs-titles"></div>';
    const list = panel.firstElementChild;
    const width = list.clientWidth || 900;
    const cell = width >= 1000 ? (width - 10) / 2 : width;
    list.innerHTML = titleList(owns).map((title) => {
      const ok = title.id === defaultTitle() || owns(TITLE_PREFIX + title.id);
      const rar = RAR[title.r];
      return `<button class="hs-ti${ok ? '' : ' hs-locked'}" type="button" data-hs-title-id="${title.id}" aria-pressed="${look().titleId === title.id}">
          ${titleHTML(title, { maxW: cell - 30 })}
          <span class="hs-meta" style="color:${rar.c}">${escapeHtml(rarityName(rar))}</span>
          <span class="hs-meta">${escapeHtml(titleSource(title))}</span>
        </button>`;
    }).join('');
    list.querySelectorAll('[data-hs-title-id]').forEach((button) => {
      // Moving is for the plaque being looked at; the one in use already moves at the top of the page.
      // All of them at once is what made this tab heavy.
      setPlaqueMotion(button, false);
      let hovered = false;
      let focused = false;
      const update = () => setPlaqueMotion(button, hovered || focused);
      button.addEventListener('pointerenter', () => { hovered = true; update(); });
      button.addEventListener('pointerleave', () => { hovered = false; update(); });
      button.addEventListener('focusin', () => { focused = true; update(); });
      button.addEventListener('focusout', () => { focused = false; update(); });
    });
    list.querySelectorAll('[data-hs-title-id]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.hsTitleId;
      const title = T[id];
      if (id === look().titleId) return;
      if (id === defaultTitle()) { wear(CATEGORY.title, null, title.n); return; }
      if (!owns(TITLE_PREFIX + id)) {
        live(tr(`${title.n} is locked: ${sourceText(title.src)}.`, `${title.n} chưa mở: ${title.src}.`));
        shake(button);
        return;
      }
      wear(CATEGORY.title, TITLE_PREFIX + id, title.n);
    }));
  }

  // ---- entrances --------------------------------------------------------------------------

  function renderEntrances() {
    warmEntranceArt();
    const panel = $('#hs-p-sanh');
    const worn = look().entranceId;
    panel.innerHTML = `
      <p class="hs-hint">${escapeHtml(tr(
    'A lobby entrance is an item of its own, from chests. Everyone in the room sees yours when you enter a lobby; the default one stays a quiet mist in the lobby.',
    'Hiệu ứng vào sảnh là vật phẩm riêng, ra từ hòm. Khi bạn vào phòng chờ, mọi người trong phòng đều thấy hiệu ứng đang dùng; hiệu ứng mặc định chỉ là làn sương nhẹ trong sảnh.'))}</p>
      <div class="hs-ens">
        ${entranceList(owns).map((entry) => {
    const rar = RAR[entry.r];
    const on = worn === entry.id;
    const ok = entry.id === defaultEntrance() || owns(ENTRANCE_PREFIX + entry.id);
    return `<div class="hs-en${on ? ' hs-on' : ''}${ok ? '' : ' hs-locked'}" style="--rc:${rar.c}" data-hs-entrance="${entry.id}">
            <span class="hs-emb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${entry.ic}"/></svg></span>
            <span class="hs-ent"><b>${escapeHtml(entry.n)}</b><span style="color:${rar.c}">${escapeHtml(rarityName(rar))} · ${escapeHtml(sourceText(entry.src))}</span><span>${escapeHtml(entry.d)}</span></span>
            <span class="hs-enb">
              <button class="hs-btn" type="button" data-try>${escapeHtml(tr('Preview', 'Xem thử'))}</button>
              <button class="hs-btn ${on || !ok ? '' : 'hs-btn-amber'}" type="button" data-use ${on || !ok ? 'disabled' : ''}>${escapeHtml(on ? tr('In use', 'Đang dùng') : ok ? tr('Use', 'Dùng') : tr('Not yet', 'Chưa có'))}</button>
            </span>
          </div>`;
  }).join('')}
      </div>`;
    panel.querySelectorAll('[data-hs-entrance]').forEach((row) => {
      const id = row.dataset.hsEntrance;
      const entry = EN[id];
      row.querySelector('[data-try]').addEventListener('click', () => preview(id));
      row.querySelector('[data-use]').addEventListener('click', () => {
        if (id === defaultEntrance()) wear(CATEGORY.entrance, null, entry.n);
        else wear(CATEGORY.entrance, ENTRANCE_PREFIX + id, entry.n);
      });
    });
  }

  /** Works for entrances not owned yet: that is how a detective decides they want one. */
  function preview(id) {
    entrance?.cancel();
    entrance = playEntrance(id, {
      name: displayName,
      frameId: look().frameId,
      titleId: look().titleId,
      avatar: () => avatarFor(me),
    });
  }

  // ---- avatar picker ----------------------------------------------------------------------

  function togglePicker() {
    const picker = $('[data-hs-picker]');
    const open = picker.hidden;
    picker.hidden = !open;
    $('[data-hs-change]').setAttribute('aria-expanded', String(open));
    if (open) {
      renderAvatars();
      // On a phone the picker opens below the screen, and a button that seems to do nothing gets no second tap.
      picker.scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
    }
  }

  function renderAvatarsIfOpen() {
    const picker = $('[data-hs-picker]');
    if (picker && !picker.hidden) renderAvatars();
  }

  // No capture attribute: that would send a phone straight to the camera and hide the gallery.
  const uploadTile = () => (uploading
    ? `<span class="hs-av hs-up" role="status" aria-busy="true">${escapeHtml(tr('Uploading…', 'Đang tải…'))}</span>`
    : `<label class="hs-av hs-up">${tr('Upload<br>your own', 'Tải ảnh<br>của bạn')}<input type="file" accept="image/*" aria-label="${escapeHtml(tr('Upload your avatar', 'Tải ảnh đại diện của bạn'))}" data-hs-upload></label>`);

  function renderAvatars() {
    const avatars = $('[data-hs-avatars]');
    avatars.innerHTML = AVS.map((avatar) => `
      <button class="hs-av" type="button" data-hs-avatar="${avatar.id}" aria-pressed="${me.avatar === avatar.id}" aria-label="${escapeHtml(avatar.n)}" title="${escapeHtml(avatar.n)}">
        <canvas width="152" height="152" aria-hidden="true"></canvas>
      </button>`).join('')
      + (me.avatarUrl ? `<button class="hs-av" type="button" data-hs-avatar="upload" aria-pressed="${me.avatar === 'upload'}" aria-label="${escapeHtml(tr('Your picture', 'Ảnh của bạn'))}"><img src="${escapeHtml(me.avatarUrl)}" alt=""></button>` : '')
      + (me.canUploadAvatar ? uploadTile() : '');
    $('[data-hs-avatars-note]').hidden = !me.canUploadAvatar;
    const thumbs = [...avatars.querySelectorAll('[data-hs-avatar] canvas')];
    const stopThumbs = painter.onPaint(() => {
      let waiting = false;
      for (const canvas of thumbs) {
        if (canvas.dataset.done) continue;
        const image = avatarImg(canvas.parentElement.dataset.hsAvatar);
        if (image?.naturalWidth) {
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.dataset.done = '1';
        } else waiting = true;
      }
      if (!waiting) stopThumbs();
    });
    avatars.querySelectorAll('[data-hs-avatar]').forEach((button) => button.addEventListener('click', () => chooseAvatar(button.dataset.hsAvatar)));
    avatars.querySelector('[data-hs-upload]')?.addEventListener('change', (event) => uploadAvatar(event.target.files?.[0]));
  }

  async function chooseAvatar(id) {
    if (busy || id === me.avatar) return;
    busy = true;
    try {
      me = await progressApi.setAvatar(id);
      if (disposed) return;
      renderAvatars();
      renderHeader();
      live(tr('Avatar changed.', 'Đã đổi ảnh đại diện.'));
    } catch (error) {
      if (!disposed) toast(errorText(error), 'error');
    } finally {
      busy = false;
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    // Drawing the tiles again also gives a fresh input, so the same file can be picked again.
    if (busy) { renderAvatars(); return; }
    busy = true;
    uploading = true;
    renderAvatars();
    let stored = false;
    try {
      me = await progressApi.uploadAvatar(await squareAvatar(file));
      stored = true;
      if (disposed) return;
      renderHeader();
      live(tr('Your picture is now your avatar.', 'Đã dùng ảnh của bạn.'));
    } catch (error) {
      if (!disposed) toast(uploadErrorText(error), 'error');
    } finally {
      busy = false;
      uploading = false;
      if (!disposed) {
        renderAvatars();
        $(stored ? '[data-hs-avatar="upload"]' : '[data-hs-upload]')?.focus({ preventScroll: true });
      }
    }
  }

  // ---- lifecycle --------------------------------------------------------------------------

  async function start() {
    renderShell();
    try {
      const [fresh] = await Promise.all([isOwnProfile ? progressApi.me() : progressApi.user(userId), loadCosmeticCatalog()]);
      me = fresh;
      await knowWhatIsWorn();
    } catch (error) {
      if (disposed) return;
      // The rest of the profile still works; say so only where it matters to the owner.
      me = null;
      painter.clear();
      headerWatch?.disconnect();
      host.innerHTML = isOwnProfile ? `<p class="hs-unavailable" role="status">${escapeHtml(tr('The portrait could not be loaded. Please try again later.', 'Chưa tải được chân dung. Vui lòng thử lại sau.'))}</p>` : '';
      for (const tab of extraTabs) {
        const section = document.createElement('section');
        section.id = `hs-p-${tab.id}`;
        host.append(section);
        tab.render(section);
      }
      unavailable = true;
      console.warn('Cosmetics could not be loaded', error);
      return;
    }
    if (disposed) return;
    renderHeader();
    renderActiveTab();
    whenTitleFontReady().then(() => {
      if (disposed || !me) return;
      renderHeader();
      if (activeTab === 'danhhieu' && isOwnProfile) renderTitles();
    });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || !me) return;
        renderHeader();
        if (activeTab === 'danhhieu' && isOwnProfile) renderTitles();
      }, RESIZE_DEBOUNCE_MS);
    }, { signal: listeners.signal });
  }

  start();

  return {
    openTab,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(resizeTimer);
      listeners.abort();
      entrance?.cancel();
      closeStage(true);
      painter.dispose();
      headerWatch?.disconnect();
      document.querySelector('.hs-unlock')?.remove();
    },
  };
}
