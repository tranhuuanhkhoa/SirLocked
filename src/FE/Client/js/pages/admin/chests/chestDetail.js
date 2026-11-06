import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { icon, pill, stateBox } from '../../../components/admin/ui.js';
import { EN, FR, T, applyCosmetic, avatarImg, frameKey, isKnownCosmetic, prepareCosmetics, setPlaqueMotion, titleHTML, titleKey } from '../../../cosmetics/index.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { pixelIconUrl } from '../../chest/chestSprites.js';
import { renderChestPage } from '../../chestPage.js';
import { draftOf, fromHex, toHex, weightOf } from './chestDraft.js';
import { renderChestStats } from './chestStats.js';
import {
  CATEGORY_TEXT, RARITIES, RARITY_COLOR, RARITY_TEXT, acIcon, confirmDialog, dateTime, errorMessages, errorsHtml, routeParam, itemThumb, mountThumbs,
  number, openDialog, percent, rarityBadge, setRouteParam, xu,
} from './shared.js';

const CHECK_DEBOUNCE_MS = 250;

const TABS = [
  { id: 'thiet-lap', label: 'Thiết lập' },
  { id: 'bang-roi', label: 'Bảng rơi & nội dung' },
  { id: 'lich-su', label: 'Lịch sử' },
  { id: 'thong-ke', label: 'Thống kê' },
];

const FIELD_TEXT = {
  name: 'Tên', nameEn: 'Tên (Anh)', subtitle: 'Phụ đề', subtitleEn: 'Phụ đề (Anh)', keyName: 'Tên chìa', keyNameEn: 'Tên chìa (Anh)',
  'prices.chest': 'Giá hòm', 'prices.key': 'Giá chìa', active: 'Đang bán', sortOrder: 'Thứ tự',
  'look.template': 'Kiểu hòm', 'look.light': 'Màu ánh sáng', 'look.hi': 'Màu ánh sáng phụ', 'look.core': 'Màu lõi sáng',
};

const LOOKS = [{ id: 'seal', label: 'Hòm gỗ niêm phong' }, { id: 'bank', label: 'Két sắt nhà băng' }, { id: 'lacquer', label: 'Tráp sơn mài' }];
const TEMPLATE_ICON = { seal: 'chest_seal', bank: 'chest_bank', lacquer: 'chest_lacquer' };

const barWidth = (value) => Math.min(100, Math.max(0, Number(value) || 0));

/** What changed, in words. `names` turns ids into names; an item since deleted keeps its id. */
function diffHtml(diff, names) {
  const line = (label, value) => `<li><span class="muted">${escapeHtml(label)}:</span> ${value}</li>`;
  const rows = [
    ...(diff.added ?? []).map((id) => line('Thêm món', escapeHtml(names(id)))),
    ...(diff.removed ?? []).map((id) => line('Gỡ món', escapeHtml(names(id)))),
    ...(diff.weights ?? []).map((change) => line(`Tỉ lệ ${RARITY_TEXT[change.rarity] ?? change.rarity}`, `${percent(change.before)} → ${percent(change.after)}`)),
    ...(diff.fields ?? []).map((change) => line(FIELD_TEXT[change.field] ?? change.field, `${escapeHtml(change.before)} → ${escapeHtml(change.after)}`)),
  ];
  if (diff.reordered) rows.push(line('Nội dung', 'đổi thứ tự hiển thị'));
  return rows.length ? `<ul class="ac-diff">${rows.join('')}</ul>` : '<p class="muted">Không có thay đổi.</p>';
}

const backLink = `<a class="adm-back-link" href="/admin/chests">${icon('arrowLeft', 16)}Về danh sách hòm</a>`;

/** /admin/chests/:id. Everything is edited as one draft, checked by the server as it changes and saved in one piece. */
export async function renderChestDetail(app, id, { signal } = {}) {
  render(app, `<div class="page ac-page">${backLink}${stateBox('loading', 'Đang tải hòm…')}</div>`);

  let chest;
  let catalog;
  try {
    [chest, catalog] = await Promise.all([adminChestsApi.chest(id), adminChestsApi.items()]);
  } catch (error) {
    if (!signal?.aborted) {
      render(app, `<div class="page ac-page">${backLink}${stateBox('error', 'Không mở được hòm này', errorMessages(error)[0])}</div>`);
    }
    return;
  }
  if (signal?.aborted || !chest) return;

  prepareCosmetics();
  const painter = createPainter();
  signal?.addEventListener('abort', () => painter.dispose(), { once: true });

  const defs = new Map((catalog?.items ?? []).map((item) => [item.id, item]));
  for (const entry of chest.pool) if (!defs.has(entry.def.id)) defs.set(entry.def.id, { ...entry.def, retired: entry.retired });
  const nameOf = (defId) => defs.get(defId)?.name ?? defId;

  const state = {
    chest,
    draft: draftOf(chest),
    baseline: JSON.stringify(draftOf(chest)),
    check: null,
    checkFailed: null,
    pending: false,
    ticket: 0,
    timer: 0,
    tab: TABS.some((tab) => tab.id === routeParam('tab')) ? routeParam('tab') : 'thiet-lap',
    previewOpen: null,
  };

  const dirty = () => JSON.stringify(state.draft) !== state.baseline;

  render(app, `
    <div class="page ac-page ac-detail">
      ${backLink}
      <div class="ac-detail-head">
        <span class="ac-chest-art ac-chest-art--lg" data-ac-head-art aria-hidden="true"><img alt="" draggable="false"></span>
        <div class="ac-detail-title">
          <div class="ac-detail-name"><h1 data-ac-heading></h1><span data-ac-status></span></div>
          <p class="ac-detail-sub">
            <span class="adm-mono">${escapeHtml(chest.id)}</span> · chìa <span class="adm-mono">${escapeHtml(chest.keyDefId)}</span>
            · Giá trị kỳ vọng <strong data-ac-ev></strong> · Chi phí mở <strong data-ac-cost></strong> · <span data-ac-version></span>
          </p>
        </div>
        <div class="adm-actions">
          <button type="button" class="btn btn-ghost" data-ac-preview>${acIcon('eye', 18)}Xem thử như người chơi</button>
          <button type="button" class="btn btn-primary" data-ac-save-head disabled>Lưu &amp; áp dụng</button>
        </div>
      </div>
      <div class="adm-seg ac-detail-tabs" role="tablist" aria-label="Mục của hòm">
        ${TABS.map((tab) => `<button type="button" class="ac-tab" role="tab" id="ac-tab-${tab.id}" aria-controls="ac-panel-${tab.id}" data-ac-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join('')}
      </div>
      ${TABS.map((tab) => `<section class="ac-tab-panel" role="tabpanel" id="ac-panel-${tab.id}" aria-labelledby="ac-tab-${tab.id}" data-ac-panel="${tab.id}"></section>`).join('')}
      <footer class="ac-savebar" data-ac-savebar>
        <div data-ac-violations></div>
        <div class="ac-savebar-row">
          <span class="ac-savebar-text">Thay đổi có hiệu lực ngay với người chơi. Lượt mở đang chạy giữ nguyên phần thưởng đã quay.</span>
          <button type="button" class="btn adm-btn-accent" data-ac-save disabled>Lưu &amp; áp dụng</button>
        </div>
      </footer>
    </div>`);

  const $ = (selector) => app.querySelector(selector);
  const panel = (tab) => $(`[data-ac-panel="${tab}"]`);

  // ---------------------------------------------------------------- settings

  function renderSettings() {
    const { draft } = state;
    const text = (name, label, value, attrs = '') => `<label class="ac-field"><span>${escapeHtml(label)}</span><input class="field-input" name="${name}" value="${escapeHtml(value)}" ${attrs}></label>`;
    const colour = (name, label, value) => `<label class="ac-colour"><span>${escapeHtml(label)}</span><input type="color" name="${name}" value="${toHex(value)}"></label>`;
    render(panel('thiet-lap'), `
      <div class="ac-two">
        <section class="adm-card ac-col-main" aria-labelledby="ac-info-title">
          <h2 class="adm-card-title" id="ac-info-title">Thông tin &amp; giá</h2>
          <div class="ac-form-grid">
            ${text('name', 'Tên hòm', draft.name, 'maxlength="80"')}
            ${text('nameEn', 'Tên hòm (tiếng Anh)', draft.nameEn, 'maxlength="80"')}
            ${text('subtitle', 'Phụ đề', draft.subtitle, 'maxlength="80"')}
            ${text('subtitleEn', 'Phụ đề (tiếng Anh)', draft.subtitleEn, 'maxlength="80"')}
            ${text('keyName', 'Tên chìa', draft.keyName, 'maxlength="80"')}
            ${text('keyNameEn', 'Tên chìa (tiếng Anh)', draft.keyNameEn, 'maxlength="80"')}
            ${text('chestPrice', 'Giá hòm (xu)', draft.chestPrice, 'type="number" min="2" max="1000000" step="1" inputmode="numeric"')}
            ${text('keyPrice', 'Giá chìa (xu)', draft.keyPrice, 'type="number" min="2" max="1000000" step="1" inputmode="numeric"')}
            ${text('sortOrder', 'Thứ tự hiển thị', draft.sortOrder, 'type="number" min="0" step="1" inputmode="numeric"')}
          </div>
          <label class="ac-switch-row">
            <span class="ac-switch-text"><strong>Đang bán</strong><span>Tắt thì ẩn khỏi Kho Rương, hòm và chìa đã có vẫn mở được.</span></span>
            <input type="checkbox" class="ac-switch" role="switch" name="active"${draft.active ? ' checked' : ''}>
          </label>
        </section>
        <section class="adm-card ac-col-side ac-look" aria-labelledby="ac-look-title">
          <h2 class="adm-card-title" id="ac-look-title">Hình hòm và ánh sáng</h2>
          <div class="ac-look-preview" data-ac-look-preview><img alt="Hình hòm" draggable="false"></div>
          <label class="ac-field"><span>Kiểu hòm</span>
            <select class="field-input" name="template">
              ${LOOKS.map((look) => `<option value="${look.id}"${look.id === draft.look.template ? ' selected' : ''}>${escapeHtml(look.label)}</option>`).join('')}
            </select>
          </label>
          <div class="ac-colours">
            ${colour('light', 'Ánh sáng', draft.look.light)}
            ${colour('hi', 'Ánh sáng phụ', draft.look.hi)}
            ${colour('core', 'Lõi sáng', draft.look.core)}
          </div>
        </section>
      </div>`);
    paintLook();
  }

  function paintLook() {
    const preview = $('[data-ac-look-preview]');
    if (!preview) return;
    const { template, light, hi } = state.draft.look;
    preview.querySelector('img').src = pixelIconUrl(TEMPLATE_ICON[template] ?? state.chest.iconKey);
    preview.setAttribute('style', `--ac-glow:rgb(${light});--ac-glow-hi:rgb(${hi})`);
  }

  // ---------------------------------------------------------------- the table and the pool

  function renderTable() {
    const { draft } = state;
    render(panel('bang-roi'), `
      <div class="ac-two">
        <section class="adm-card ac-rates-card" aria-labelledby="ac-rates-title">
          <h2 class="adm-card-title" id="ac-rates-title">Bảng rơi</h2>
          <div class="ac-weights">
            ${RARITIES.map((rarity) => `
              <div class="ac-weight">
                <div class="ac-weight-line">
                  <span class="ac-weight-name">${rarityBadge(rarity)}</span>
                  <label class="ac-weight-input">
                    <span class="bpa-sr">Tỉ lệ ${escapeHtml(RARITY_TEXT[rarity])} (%)</span>
                    <input class="field-input" type="number" min="0" max="100" step="0.01" inputmode="decimal" data-weight="${rarity}" value="${draft.dropWeights[rarity] / 100}">
                    <i aria-hidden="true">%</i>
                  </label>
                </div>
                <span class="ac-weight-bar" aria-hidden="true"><span data-ac-weight-bar="${rarity}" style="width:${barWidth(draft.dropWeights[rarity] / 100)}%;background:${RARITY_COLOR[rarity]}"></span></span>
              </div>`).join('')}
          </div>
          <div class="ac-weight-total"><strong>Tổng</strong><strong data-ac-total></strong></div>
          <p class="ac-card-note">Tỉ lệ thật của mỗi món bằng tỉ lệ độ hiếm chia đều cho số món cùng độ hiếm đang phát hành.</p>
        </section>
        <section class="adm-card ac-pool-card" aria-labelledby="ac-pool-title">
          <div class="ac-pool-head">
            <h2 class="adm-card-title" id="ac-pool-title">Nội dung hòm <span class="ac-title-note" data-ac-pool-count></span></h2>
            <button type="button" class="btn btn-primary btn-sm" data-ac-add-item>${icon('plus', 16)}Thêm vật phẩm</button>
          </div>
          <div class="ac-pool" data-ac-pool></div>
        </section>
      </div>`);
    paintTotal();
    paintPool();
  }

  function paintTotal() {
    const total = $('[data-ac-total]');
    if (!total) return;
    const weight = RARITIES.reduce((sum, rarity) => sum + state.draft.dropWeights[rarity], 0);
    total.textContent = percent(weight / 100);
    total.dataset.valid = String(weight === 10000);
  }

  /** Cosmetics are shown by their own drawing code, as players see them. */
  function cosmeticView(def) {
    // Made on the cosmetics page, perhaps: its definition is right here, the same way the chest reel draws it.
    if (def.visual && !isKnownCosmetic(def.id)) applyCosmetic(def);
    if (def.category === 'FRAME' && FR[frameKey(def.id)]) {
      return `<canvas class="ac-pool-frame" data-ac-frame="${escapeHtml(frameKey(def.id))}" aria-hidden="true"></canvas>`;
    }
    if (def.category === 'TITLE' && T[titleKey(def.id)]) return `<div class="ac-pool-title" data-ac-title-art>${titleHTML(T[titleKey(def.id)], { maxW: 150 })}</div>`;
    return itemThumb(def, 44);
  }

  function poolCard(defId) {
    const def = defs.get(defId);
    const retired = Boolean(def?.retired);
    const art = ['FRAME', 'TITLE', 'ENTRANCE'].includes(def?.category) ? cosmeticView(def) : itemThumb(def ?? { id: defId }, 40);
    const rate = state.check?.rates?.[defId] ?? null;
    return `
      <div class="ac-pool-item${retired ? ' is-retired' : ''}" data-pool-item="${escapeHtml(defId)}">
        <div class="ac-pool-art${def?.category === 'TITLE' ? ' ac-pool-art--title' : ''}">${art}</div>
        <div class="ac-pool-text">
          <strong>${escapeHtml(nameOf(defId))}</strong>
          <span class="ac-pool-code"><span class="adm-mono">${escapeHtml(defId)}</span>${retired ? ' · <span class="ac-retired-note">Đã ngừng, không rơi</span>' : ''}</span>
        </div>
        <div class="ac-pool-meta">
          ${def ? `<span>${escapeHtml(CATEGORY_TEXT[def.category] ?? def.category)}</span>` : ''}
          <span class="ac-rate" data-ac-rate data-ac-rate-of="${escapeHtml(defId)}">${rate === null ? '' : percent(rate, 4)}</span>
        </div>
        <button type="button" class="ac-remove" data-ac-remove aria-label="Gỡ ${escapeHtml(nameOf(defId))} khỏi hòm" title="Gỡ khỏi hòm">${icon('x', 18)}</button>
      </div>`;
  }

  /** The rate each item would have, worked out here so a card is never blank before the first answer from the server. */
  function localRate(defId) {
    const def = defs.get(defId);
    if (!def || def.retired) return 0;
    const peers = state.draft.pool.filter((other) => defs.get(other)?.rarity === def.rarity && !defs.get(other)?.retired).length;
    return peers === 0 ? 0 : (state.draft.dropWeights[def.rarity] / 100) / peers;
  }

  /** "3 món · mỗi món 26,64%": the same split as localRate, for the head of a rarity's group. */
  function groupNote(rarity) {
    const ids = state.draft.pool.filter((defId) => (defs.get(defId)?.rarity ?? 'COMMON') === rarity);
    const live = ids.filter((defId) => !defs.get(defId)?.retired).length;
    const each = live === 0 ? '' : ` · mỗi món ${percent((state.draft.dropWeights[rarity] / 100) / live, 4)}`;
    return `${number(ids.length)} món${each}`;
  }

  function paintPool() {
    const pool = $('[data-ac-pool]');
    if (!pool) return;
    painter.clear();
    $('[data-ac-pool-count]').textContent = `· ${number(state.draft.pool.length)} món`;
    pool.innerHTML = RARITIES.map((rarity) => {
      const ids = state.draft.pool.filter((defId) => (defs.get(defId)?.rarity ?? 'COMMON') === rarity);
      return `
        <section class="ac-pool-group" data-pool-column="${rarity}" aria-label="${escapeHtml(RARITY_TEXT[rarity])}">
          <header>${rarityBadge(rarity)}<span class="ac-group-note" data-ac-group-note>${groupNote(rarity)}</span></header>
          ${ids.map(poolCard).join('') || '<p class="ac-pool-empty">Chưa có món nào.</p>'}
        </section>`;
    }).join('');
    pool.querySelectorAll('canvas[data-ac-frame]').forEach((canvas) => {
      const frame = canvas.dataset.acFrame;
      const avatar = avatarImg('nonla');
      painter.add(canvas, () => frame, () => avatar);
    });
    pool.querySelectorAll('[data-ac-title-art]').forEach((host) => setPlaqueMotion(host, false));
    mountThumbs(pool, signal);
    paintRates();
  }

  function paintRates() {
    for (const element of app.querySelectorAll('[data-ac-rate-of]')) {
      const defId = element.dataset.acRateOf;
      element.textContent = `Tỉ lệ thật ${percent(state.check?.rates?.[defId] ?? localRate(defId), 4)}`;
    }
  }

  function openPicker() {
    const pickable = () => [...defs.values()]
      .filter((def) => !def.retired && def.category !== 'CHEST' && def.category !== 'KEY' && !state.draft.pool.includes(def.id));
    const { dialog } = openDialog({
      title: 'Thêm vật phẩm vào hòm',
      signal,
      body: `
        <div class="ac-toolbar">
          <label class="adm-search-box ac-search">
            ${icon('search', 18)}
            <span class="bpa-sr">Tìm vật phẩm</span>
            <input type="search" placeholder="Tìm theo tên hoặc mã" data-ac-pick-search>
          </label>
          <label class="ac-select"><span class="bpa-sr">Nhóm</span>
            <select class="field-input" data-ac-pick-category>
              <option value="">Mọi nhóm</option>
              ${Object.entries(CATEGORY_TEXT).filter(([value]) => value !== 'CHEST' && value !== 'KEY').map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="ac-picker" data-ac-picker></div>`,
    });
    const closing = new AbortController();
    dialog.addEventListener('close', () => closing.abort());
    const paint = () => {
      const text = dialog.querySelector('[data-ac-pick-search]').value.trim().toLocaleLowerCase('vi');
      const category = dialog.querySelector('[data-ac-pick-category]').value;
      const shown = pickable().filter((def) => (!category || def.category === category)
        && (!text || [def.id, def.name, def.nameEn].some((value) => value?.toLocaleLowerCase('vi').includes(text))));
      const list = dialog.querySelector('[data-ac-picker]');
      list.innerHTML = shown.map((def) => `
        <button type="button" class="ac-pick" data-pick-item="${escapeHtml(def.id)}">
          <span class="ac-pick-art">${itemThumb(def, 36)}</span>
          <span class="ac-pick-text"><strong>${escapeHtml(def.name)}</strong><small><span class="adm-mono">${escapeHtml(def.id)}</span> · ${escapeHtml(CATEGORY_TEXT[def.category] ?? def.category)}</small></span>
          ${rarityBadge(def.rarity)}
          <span class="ac-pick-add" aria-hidden="true">${icon('plus', 16)}Thêm</span>
        </button>`).join('') || '<p class="ac-picker-empty">Không còn món nào khớp.</p>';
      mountThumbs(list, closing.signal);
    };
    dialog.querySelector('[data-ac-pick-search]').addEventListener('input', paint);
    dialog.querySelector('[data-ac-pick-category]').addEventListener('change', paint);
    dialog.querySelector('[data-ac-picker]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-pick-item]');
      if (!button) return;
      state.draft.pool.push(button.dataset.pickItem);
      paintPool();
      changed();
      paint();
    });
    paint();
  }

  // ---------------------------------------------------------------- live check

  function paintSaveBar() {
    const { check, draft, checkFailed } = state;
    $('[data-ac-ev]').textContent = check ? xu(check.expectedValue) : xu(state.chest.expectedValue);
    $('[data-ac-cost]').textContent = xu(check?.cost ?? (Number(draft.chestPrice) + Number(draft.keyPrice)));
    const messages = checkFailed ? [checkFailed] : (check?.violations ?? []).map((violation) => violation.message);
    $('[data-ac-violations]').innerHTML = errorsHtml(messages);
    const blocked = !dirty() || state.pending || messages.length > 0;
    $('[data-ac-save]').disabled = blocked;
    $('[data-ac-save-head]').disabled = blocked;
  }

  /** The server holds the rules, so it is asked every time the draft changes. */
  function changed() {
    paintTotal();
    state.pending = true;
    // An answer still on its way is about the draft as it was.
    state.ticket += 1;
    paintSaveBar();
    clearTimeout(state.timer);
    state.timer = setTimeout(runCheck, CHECK_DEBOUNCE_MS);
  }

  async function runCheck() {
    const ticket = ++state.ticket;
    try {
      const check = await adminChestsApi.check(id, state.draft);
      if (signal?.aborted || ticket !== state.ticket) return;
      state.check = check;
      state.checkFailed = null;
    } catch (error) {
      if (signal?.aborted || ticket !== state.ticket) return;
      state.checkFailed = errorMessages(error)[0];
    }
    state.pending = false;
    paintSaveBar();
    paintRates();
  }

  function applyServerChest(next) {
    state.chest = next;
    state.draft = draftOf(next);
    state.baseline = JSON.stringify(state.draft);
    state.check = null;
    state.checkFailed = null;
    state.pending = false;
    clearTimeout(state.timer);
    state.ticket += 1;
    for (const entry of next.pool) if (!defs.has(entry.def.id)) defs.set(entry.def.id, { ...entry.def, retired: entry.retired });
    paintHead();
    renderSettings();
    renderTable();
    runCheck();
  }

  function paintHead() {
    const { chest: current } = state;
    $('[data-ac-heading]').textContent = current.name;
    $('[data-ac-status]').innerHTML = current.active ? pill('Đang bán', 'ok', { dot: true }) : pill('Đang tắt', '', { dot: true });
    $('[data-ac-version]').textContent = `phiên bản ${current.version}`;
    const art = $('[data-ac-head-art]');
    art.querySelector('img').src = pixelIconUrl(current.iconKey);
    if (current.look?.light) art.style.setProperty('--ac-glow', `rgb(${current.look.light})`);
  }

  // ---------------------------------------------------------------- saving

  function save() {
    if ($('[data-ac-save]').disabled) return;
    confirmDialog({
      title: `Lưu & áp dụng ${state.chest.name}?`,
      body: `<p>Thay đổi có hiệu lực ngay với người chơi. Lượt mở đang chạy giữ nguyên phần thưởng đã quay.</p>${diffHtml(state.check?.diff ?? {}, nameOf)}`,
      confirmLabel: 'Lưu & áp dụng',
      signal,
      action: async (reason) => {
        const next = await adminChestsApi.save(id, { ...state.draft, reason });
        applyServerChest(next);
        toast('Đã lưu và áp dụng.', 'success');
      },
    });
  }

  // ---------------------------------------------------------------- history

  async function renderHistory() {
    const host = panel('lich-su');
    render(host, stateBox('loading', 'Đang tải lịch sử…'));
    let versions;
    try {
      versions = await adminChestsApi.versions(id);
    } catch (error) {
      if (!signal?.aborted) render(host, errorsHtml(errorMessages(error)));
      return;
    }
    if (signal?.aborted) return;
    render(host, `
      <section class="adm-card ac-history">
        <p class="ac-card-note">Mỗi lần lưu tạo một phiên bản. Khôi phục tạo một phiên bản mới giống bản cũ; trạng thái bật/tắt và thứ tự giữ nguyên như hiện tại.</p>
        <div class="ac-versions">
          ${(versions ?? []).map((version) => `
            <article class="ac-version${version.current ? ' is-current' : ''}" data-version="${version.version}">
              <header>
                <strong>Phiên bản ${version.version}</strong>
                ${version.current ? pill('Đang dùng', 'ok', { small: true }) : ''}
                <span class="ac-version-when">${dateTime(version.at)}${version.adminName ? ` · ${escapeHtml(version.adminName)}` : ''}</span>
                ${version.current ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-ac-restore>Khôi phục phiên bản này</button>'}
              </header>
              ${version.reason ? `<p class="ac-version-reason">${escapeHtml(version.reason)}</p>` : ''}
              <p class="ac-version-sum">Hòm ${xu(version.chestPrice)} · chìa ${xu(version.keyPrice)} · ${number(version.poolCount)} món · ${RARITIES.map((rarity) => `${RARITY_TEXT[rarity]} ${percent((version.dropWeights?.[rarity] ?? 0) / 100)}`).join(' · ')}</p>
              ${version.diff?.isEmpty ? '' : diffHtml(version.diff ?? {}, nameOf)}
            </article>`).join('')}
        </div>
      </section>`);
  }

  function restore(version) {
    if (dirty()) {
      toast('Hãy lưu hoặc tải lại trang trước khi khôi phục: bạn đang có thay đổi chưa lưu.', 'error');
      return;
    }
    confirmDialog({
      title: `Khôi phục phiên bản ${version}?`,
      body: '<p>Giá, hình, bảng rơi và nội dung trở lại như phiên bản đó, có hiệu lực ngay. Trạng thái bật/tắt và thứ tự giữ nguyên.</p>',
      confirmLabel: 'Khôi phục',
      signal,
      action: async (reason) => {
        const next = await adminChestsApi.restore(id, version, { expectedVersion: state.chest.version, reason });
        applyServerChest(next);
        toast(`Đã khôi phục phiên bản ${version}.`, 'success');
        await renderHistory();
      },
    });
  }

  // ---------------------------------------------------------------- trying it out

  function openPreview() {
    if (state.previewOpen) return;
    const overlay = document.createElement('div');
    overlay.className = 'ac-preview';
    overlay.innerHTML = `
      <div class="ac-preview-bar">
        <span>Xem thử theo bản đã lưu: không tạo vật phẩm, không trừ xu</span>
        <button type="button" class="ac-preview-close" data-ac-preview-close>Thoát xem thử</button>
      </div>
      <div class="ac-preview-stage"></div>`;
    document.body.append(overlay);
    const controller = new AbortController();
    const close = () => {
      controller.abort();
      overlay.remove();
      state.previewOpen = null;
    };
    state.previewOpen = close;
    const closeButton = overlay.querySelector('[data-ac-preview-close]');
    closeButton.addEventListener('click', close);
    // Keys go to the screen on top, not to the button left behind it.
    closeButton.focus();
    renderChestPage(overlay.querySelector('.ac-preview-stage'), {
      signal: controller.signal,
      preview: true,
      api: {
        list: () => adminChestsApi.preview(id),
        open: () => adminChestsApi.previewOpen(id),
      },
    });
  }

  // ---------------------------------------------------------------- tabs and wiring

  function showTab(tab) {
    state.tab = tab;
    setRouteParam('tab', tab === 'thiet-lap' ? null : tab);
    app.querySelectorAll('[data-ac-tab]').forEach((button) => {
      const on = button.dataset.acTab === tab;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
    });
    app.querySelectorAll('[data-ac-panel]').forEach((section) => { section.hidden = section.dataset.acPanel !== tab; });
    $('[data-ac-savebar]').hidden = tab === 'lich-su' || tab === 'thong-ke';
    // The header copy of "Lưu & áp dụng" goes with the bar: there it would save with no reasons shown and leave the history stale.
    $('[data-ac-save-head]').hidden = tab === 'lich-su' || tab === 'thong-ke';
    if (tab === 'lich-su') renderHistory();
    if (tab === 'thong-ke') renderChestStats(panel('thong-ke'), id, { signal });
  }

  const page = app.querySelector('.ac-detail');
  page.addEventListener('input', (event) => {
    const input = event.target;
    if (input.dataset.weight) {
      state.draft.dropWeights[input.dataset.weight] = weightOf(input.value);
      paintPoolHeaders();
      changed();
      return;
    }
    const { name } = input;
    if (!name || !panel('thiet-lap').contains(input)) return;
    if (name === 'light' || name === 'hi' || name === 'core') {
      state.draft.look[name] = fromHex(input.value);
      paintLook();
    } else if (name === 'template') {
      state.draft.look.template = input.value;
      paintLook();
    } else if (name === 'active') {
      state.draft.active = input.checked;
    } else if (name === 'chestPrice' || name === 'keyPrice' || name === 'sortOrder') {
      state.draft[name] = Number(input.value || 0);
    } else {
      state.draft[name] = input.value;
    }
    changed();
  });

  /** A rarity's percentage changed: its bar, and the "each item" split in its group of the content list. */
  function paintPoolHeaders() {
    for (const rarity of RARITIES) {
      const bar = app.querySelector(`[data-ac-weight-bar="${rarity}"]`);
      if (bar) bar.style.width = `${barWidth(state.draft.dropWeights[rarity] / 100)}%`;
    }
    app.querySelectorAll('[data-pool-column]').forEach((column) => {
      column.querySelector('[data-ac-group-note]').textContent = groupNote(column.dataset.poolColumn);
    });
  }

  page.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-ac-tab]');
    if (tab) { showTab(tab.dataset.acTab); return; }
    if (event.target.closest('[data-ac-add-item]')) { openPicker(); return; }
    if (event.target.closest('[data-ac-preview]')) { openPreview(); return; }
    if (event.target.closest('[data-ac-save], [data-ac-save-head]')) { save(); return; }
    const remove = event.target.closest('[data-ac-remove]');
    if (remove) {
      const defId = remove.closest('[data-pool-item]').dataset.poolItem;
      state.draft.pool = state.draft.pool.filter((other) => other !== defId);
      paintPool();
      changed();
      return;
    }
    const version = event.target.closest('[data-ac-restore]');
    if (version) restore(Number(version.closest('[data-version]').dataset.version));
  });

  paintHead();
  renderSettings();
  renderTable();
  paintSaveBar();
  showTab(state.tab);
  runCheck();

  return () => {
    clearTimeout(state.timer);
    state.previewOpen?.();
    painter.dispose();
  };
}
