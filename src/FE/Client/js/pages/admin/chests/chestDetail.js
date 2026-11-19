import { adminAssetsApi } from '../../../api/adminAssetsApi.js';
import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { icon, pill, stateBox } from '../../../components/admin/ui.js';
import { EN, FR, T, applyCosmetic, avatarImg, frameKey, isKnownCosmetic, prepareCosmetics, setPlaqueMotion, titleHTML, titleKey } from '../../../cosmetics/index.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { navigate } from '../../../services/navigation.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { chestIconUrl, chestPictureUrl, ownChestPictureUrl, ownKeyPictureUrl, pixelIconUrl } from '../../chest/chestSprites.js';
import { renderChestPage } from '../../chestPage.js';
import { draftOf, fromHex, toHex, weightOf } from './chestDraft.js';
import { renderChestStats } from './chestStats.js';
import { showcaseFigure, showcaseOf, showcaseRibbon, showcaseSky } from './chestShowcase.js';
import {
  CATEGORY_TEXT, NEW_CHEST, RARITIES, RARITY_COLOR, RARITY_TEXT, acIcon, confirmDialog, dateTime, errorMessages, errorsHtml, routeParam, itemThumb, mountThumbs,
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
  'prices.chest': 'Giá hòm', 'prices.key': 'Giá chìa', active: 'Đang bán', sortOrder: 'Thứ tự', challengeWeight: 'Trọng số Thử thách tuần',
  'look.template': 'Kiểu hòm', 'look.light': 'Màu ánh sáng', 'look.hi': 'Màu ánh sáng phụ', 'look.core': 'Màu lõi sáng',
  'look.imageUrl': 'Ảnh hòm', 'look.keyImageUrl': 'Ảnh chìa',
};
/** A picture field reads as "own picture" or "the template's", not as two long addresses. */
const PICTURE_FIELDS = new Set(['look.imageUrl', 'look.keyImageUrl']);
const pictureText = (url) => (url ? 'ảnh riêng' : 'hình của mẫu');

const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
/** The two pictures an admin can give a chest, in the draft's look. */
const PICTURES = [
  { field: 'imageUrl', label: 'Ảnh hòm', note: 'Hòm đóng, nền trong suốt. Thay hình hòm ở trang Mở hòm, Kho rương, chợ và thông báo rớt hòm.' },
  { field: 'keyImageUrl', label: 'Ảnh chìa', note: 'Chìa, nền trong suốt. Thay hình chìa ở nút mua chìa, kho và chợ.' },
];

const LOOKS = [
  { id: 'seal', label: 'Hòm gỗ niêm phong' }, { id: 'bank', label: 'Két sắt nhà băng' }, { id: 'lacquer', label: 'Tráp sơn mài' },
  { id: 'whitechapel', label: 'Hòm đêm Whitechapel (bộ sưu tập)' },
];
const TEMPLATE_ICON = { seal: 'chest_seal', bank: 'chest_bank', lacquer: 'chest_lacquer', whitechapel: 'chest_whitechapel' };

const barWidth = (value) => Math.min(100, Math.max(0, Number(value) || 0));

/** The form of a chest that does not exist yet: nothing chosen, switched off, the sealed case in its own light. */
const blankChest = () => ({
  id: '', keyDefId: '', name: '', nameEn: '', subtitle: '', subtitleEn: '', keyName: '', keyNameEn: '',
  iconKey: 'chest_seal', keyIconKey: 'key_loupe',
  look: { template: 'seal', light: '240,164,58', hi: '255,222,150', core: '255,236,190', imageUrl: null, keyImageUrl: null },
  chestPrice: 0, keyPrice: 0, active: false, sortOrder: 0, version: 0, challengeWeight: 0, challengePercent: 0,
  dropWeights: {}, pool: [], expectedValue: 0,
});

/** What changed, in words. `names` turns ids into names; an item since deleted keeps its id. */
function diffHtml(diff, names) {
  const line = (label, value) => `<li><span class="muted">${escapeHtml(label)}:</span> ${value}</li>`;
  const rows = [
    ...(diff.added ?? []).map((id) => line('Thêm món', escapeHtml(names(id)))),
    ...(diff.removed ?? []).map((id) => line('Gỡ món', escapeHtml(names(id)))),
    ...(diff.weights ?? []).map((change) => line(`Tỉ lệ ${RARITY_TEXT[change.rarity] ?? change.rarity}`, `${percent(change.before)} → ${percent(change.after)}`)),
    ...(diff.fields ?? []).map((change) => line(FIELD_TEXT[change.field] ?? change.field, PICTURE_FIELDS.has(change.field)
      ? `${pictureText(change.before)} → ${pictureText(change.after)}`
      : `${escapeHtml(change.before)} → ${escapeHtml(change.after)}`)),
  ];
  if (diff.reordered) rows.push(line('Nội dung', 'đổi thứ tự hiển thị'));
  return rows.length ? `<ul class="ac-diff">${rows.join('')}</ul>` : '<p class="muted">Không có thay đổi.</p>';
}

const backLink = `<a class="adm-back-link" href="/admin/chests">${icon('arrowLeft', 16)}Về danh sách hòm</a>`;

/**
 * /admin/chests/:id. Everything is edited as one draft, checked by the server as it changes and saved in one piece.
 * /admin/chests/moi is the same form for a chest that does not exist yet: no history, statistics or try-out until it is created.
 */
export async function renderChestDetail(app, id, { signal } = {}) {
  render(app, `<div class="page ac-page">${backLink}${stateBox('loading', 'Đang tải hòm…')}</div>`);

  const isNew = id === NEW_CHEST;
  const tabs = isNew ? TABS.filter((tab) => tab.id === 'thiet-lap' || tab.id === 'bang-roi') : TABS;
  const saveLabel = isNew ? 'Tạo hòm' : 'Lưu &amp; áp dụng';
  let chest;
  let catalog;
  // The scenes admins made (tab Kiểu hòm): a chest may use one instead of a built-in drawing.
  let styles = [];
  try {
    let styleList;
    [chest, catalog, styleList] = await Promise.all([
      isNew ? Promise.resolve(blankChest()) : adminChestsApi.chest(id),
      adminChestsApi.items(),
      adminChestsApi.styles().catch(() => null),
    ]);
    styles = styleList?.styles ?? [];
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
    tab: tabs.some((tab) => tab.id === routeParam('tab')) ? routeParam('tab') : 'thiet-lap',
    previewOpen: null,
    // The pictures still on their way (imageUrl, keyImageUrl): both can be uploading at once.
    uploading: new Set(),
    // A new chest's form starts empty, which is not a list of mistakes: its rules show once the admin tries to create it.
    showErrors: !isNew,
  };

  const dirty = () => JSON.stringify(state.draft) !== state.baseline;

  render(app, `
    <div class="page ac-page ac-detail">
      ${backLink}
      <div class="ac-detail-head" data-ac-head>
        <span class="ac-head-sky" data-ac-head-sky></span>
        <span class="ac-head-stage" data-ac-head-stage><span class="ac-chest-art ac-chest-art--lg" data-ac-head-art aria-hidden="true"><img alt="" draggable="false"></span></span>
        <div class="ac-detail-title">
          <span class="ac-head-ribbon" data-ac-head-ribbon></span>
          <div class="ac-detail-name"><h1 data-ac-heading></h1><span data-ac-status></span></div>
          <p class="ac-detail-sub">
            ${isNew ? 'Mã hòm và mã chìa được cấp khi tạo' : `<span class="adm-mono">${escapeHtml(chest.id)}</span> · chìa <span class="adm-mono">${escapeHtml(chest.keyDefId)}</span>`}
            · Giá trị kỳ vọng <strong data-ac-ev></strong> · Chi phí mở <strong data-ac-cost></strong> · <span data-ac-version></span>
          </p>
        </div>
        <div class="adm-actions">
          ${isNew ? '' : `<button type="button" class="btn btn-ghost" data-ac-preview>${acIcon('eye', 18)}Xem thử như người chơi</button>`}
          <button type="button" class="btn btn-primary" data-ac-save-head disabled>${saveLabel}</button>
        </div>
      </div>
      <div class="adm-seg ac-detail-tabs" role="tablist" aria-label="Mục của hòm">
        ${tabs.map((tab) => `<button type="button" class="ac-tab" role="tab" id="ac-tab-${tab.id}" aria-controls="ac-panel-${tab.id}" data-ac-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join('')}
      </div>
      ${tabs.map((tab) => `<section class="ac-tab-panel" role="tabpanel" id="ac-panel-${tab.id}" aria-labelledby="ac-tab-${tab.id}" data-ac-panel="${tab.id}"></section>`).join('')}
      <footer class="ac-savebar" data-ac-savebar>
        <div data-ac-violations></div>
        <div class="ac-savebar-row">
          <span class="ac-savebar-text">${isNew
    ? 'Hòm được tạo kèm loại hòm và chìa riêng. Bật “Đang bán” thì người chơi thấy hòm ngay khi tạo.'
    : 'Thay đổi có hiệu lực ngay với người chơi. Lượt mở đang chạy giữ nguyên phần thưởng đã quay.'}</span>
          <button type="button" class="btn adm-btn-accent" data-ac-save disabled>${saveLabel}</button>
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
            ${isNew ? '' : text('sortOrder', 'Thứ tự hiển thị', draft.sortOrder, 'type="number" min="0" step="1" inputmode="numeric"')}
            <div class="ac-field">
              <label for="ac-challenge-weight">Trọng số rớt ở Thử thách tuần</label>
              <input class="field-input" id="ac-challenge-weight" name="challengeWeight" value="${escapeHtml(draft.challengeWeight)}" type="number" min="0" max="10000" step="1" inputmode="numeric" aria-describedby="ac-challenge-hint">
              <span class="ac-field-hint" id="ac-challenge-hint" data-ac-challenge-hint>${isNew ? 'Hòm mới chỉ rớt ở Thử thách tuần khi có trọng số.' : `Hiện chiếm ${percent(state.chest.challengePercent)} số hòm rớt ở Thử thách tuần.`} 0 = không rớt.</span>
            </div>
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
            <select class="field-input" name="template" aria-describedby="ac-template-hint">
              <optgroup label="Có sẵn">
                ${LOOKS.map((look) => `<option value="${look.id}"${look.id === draft.look.template ? ' selected' : ''}>${escapeHtml(look.label)}</option>`).join('')}
              </optgroup>
              ${styles.length ? `<optgroup label="Kiểu tự tạo">
                ${styles.map((style) => `<option value="${escapeHtml(style.id)}"${style.id === draft.look.template ? ' selected' : ''}>${escapeHtml(style.name)}</option>`).join('')}
              </optgroup>` : ''}
            </select>
            <span class="ac-field-hint" id="ac-template-hint">Kiểu hòm là cảnh mở hòm: phòng, hạt bay, màu và con dấu. Tạo kiểu mới hoàn toàn ở tab <a href="/admin/chests?tab=kieu-hom">Kiểu hòm</a>; Ảnh riêng bên dưới đè lên ảnh hòm và chìa của kiểu.</span>
          </label>
          <div class="ac-colours">
            ${colour('light', 'Ánh sáng', draft.look.light)}
            ${colour('hi', 'Ánh sáng phụ', draft.look.hi)}
            ${colour('core', 'Lõi sáng', draft.look.core)}
          </div>
          <div class="ac-pictures" data-ac-pictures>
            <h3 class="ac-pictures-title">Ảnh riêng</h3>
            <p class="ac-field-hint">PNG hoặc WebP, nền trong suốt, tối đa 5 MB. Không có ảnh riêng thì dùng hình của kiểu hòm. Kiểu hòm vẫn quyết định phòng, con dấu và hạt bay ở trang Mở hòm.</p>
            ${PICTURES.map((picture) => `<div class="ac-picture-row" data-ac-picture-row="${picture.field}"></div>`).join('')}
          </div>
        </section>
      </div>`);
    paintLook();
  }

  function paintLook() {
    const preview = $('[data-ac-look-preview]');
    if (!preview) return;
    const { template, light, hi } = state.draft.look;
    const style = styles.find((entry) => entry.id === template);
    // The chest's own picture wins; on a scene an admin made, that scene's chest picture stands in.
    const picture = ownChestPictureUrl(state.draft) || (style?.chestImageUrl ?? '');
    const image = preview.querySelector('img');
    image.src = picture || pixelIconUrl(TEMPLATE_ICON[template] ?? state.chest.iconKey);
    image.classList.toggle('is-picture', Boolean(picture));
    preview.setAttribute('style', `--ac-glow:rgb(${light});--ac-glow-hi:rgb(${hi})`);
    paintPictures();
  }

  /** One row per picture: what is used now, and the buttons to upload or drop it. */
  function paintPictures() {
    for (const picture of PICTURES) {
      const row = $(`[data-ac-picture-row="${picture.field}"]`);
      if (!row) continue;
      // Only the chest's own pictures: a style's pictures are changed on the Kiểu hòm tab.
      const url = picture.field === 'imageUrl' ? ownChestPictureUrl(state.draft) : ownKeyPictureUrl(state.draft);
      const busy = state.uploading.has(picture.field);
      const inputId = `ac-picture-${picture.field}`;
      render(row, `
        <span class="ac-picture-thumb">${url ? `<img class="is-picture" src="${escapeHtml(url)}" alt="${escapeHtml(picture.label)} đang dùng" draggable="false">` : `<span class="muted">Mẫu</span>`}</span>
        <span class="ac-picture-text"><strong>${escapeHtml(picture.label)}</strong><span>${busy ? 'Đang tải ảnh…' : escapeHtml(picture.note)}</span></span>
        <span class="ac-picture-actions">
          <label class="btn btn-ghost btn-sm ac-upload-btn" for="${inputId}">${acIcon('upload', 16)}${url ? 'Đổi ảnh' : 'Tải ảnh lên'}</label>
          <input id="${inputId}" type="file" accept="image/png,image/webp" hidden data-ac-picture-input="${picture.field}"${busy ? ' disabled' : ''}>
          ${url ? `<button type="button" class="btn btn-ghost btn-sm adm-btn-danger" data-ac-picture-remove="${picture.field}">Bỏ ảnh</button>` : ''}
        </span>`);
    }
  }

  async function uploadPicture(field, file) {
    if (!file) return;
    if (!/^image\/(png|webp)$/.test(file.type)) {
      toast('Ảnh hòm và chìa phải là PNG hoặc WebP (nền trong suốt).', 'error');
      return;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      toast('Ảnh phải từ 5 MB trở xuống.', 'error');
      return;
    }
    state.uploading.add(field);
    paintPictures();
    paintSaveBar();
    try {
      const asset = await adminAssetsApi.upload(file);
      if (signal?.aborted) return;
      state.draft.look[field] = asset.url;
      changed();
    } catch (error) {
      if (!signal?.aborted) toast(errorMessages(error)[0] ?? 'Không tải được ảnh.', 'error');
    } finally {
      state.uploading.delete(field);
      if (!signal?.aborted) {
        paintLook();
        paintSaveBar();
      }
    }
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
    $('[data-ac-violations]').innerHTML = errorsHtml(state.showErrors ? messages : []);
    // While a picture is on its way, saving would store the draft without it.
    // "Tạo hòm" stays clickable while the form is not ready: clicking it is how the admin asks what is missing.
    const blocked = !dirty() || state.pending || state.uploading.size > 0 || (!isNew && messages.length > 0);
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
      const check = isNew ? await adminChestsApi.checkNew(state.draft) : await adminChestsApi.check(id, state.draft);
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
    $('[data-ac-heading]').textContent = isNew ? 'Hòm mới' : current.name;
    $('[data-ac-status]').innerHTML = isNew ? pill('Chưa tạo', '', { dot: true })
      : current.active ? pill('Đang bán', 'ok', { dot: true }) : pill('Đang tắt', '', { dot: true });
    $('[data-ac-version]').textContent = isNew ? 'chưa có phiên bản' : `phiên bản ${current.version}`;
    const art = $('[data-ac-head-art]');
    art.querySelector('img').src = chestIconUrl(current);
    art.querySelector('img').classList.toggle('is-picture', Boolean(chestPictureUrl(current)));
    if (current.look?.light) art.style.setProperty('--ac-glow', `rgb(${current.look.light})`);
    paintShowcase(current);
  }

  /** A collection's chest gets its night scene, its outfits and its ribbon in the header; the others stay plain. */
  function paintShowcase(current) {
    const showcase = showcaseOf(current);
    const head = $('[data-ac-head]');
    head.classList.toggle('ac-detail-head--showcase', Boolean(showcase));
    $('[data-ac-head-sky]').innerHTML = showcase ? showcaseSky() : '';
    $('[data-ac-head-ribbon]').innerHTML = showcase ? showcaseRibbon(showcase) : '';
    const stage = $('[data-ac-head-stage]');
    stage.querySelectorAll('.ac-show-figure').forEach((figure) => figure.remove());
    if (showcase) {
      const [first, ...rest] = showcase.figures;
      stage.insertAdjacentHTML('afterbegin', showcaseFigure(first, 'l'));
      stage.insertAdjacentHTML('beforeend', rest.map((figure) => showcaseFigure(figure, 'r')).join(''));
    }
  }

  // ---------------------------------------------------------------- saving

  function save() {
    if ($('[data-ac-save]').disabled) return;
    if (isNew) {
      if (state.checkFailed || (state.check?.violations?.length ?? 0) > 0) {
        state.showErrors = true;
        paintSaveBar();
        $('[data-ac-violations]').scrollIntoView({ block: 'nearest' });
        return;
      }
      create();
      return;
    }
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

  /** The chest is made from the form, then its own edit page takes over. */
  function create() {
    const name = state.draft.name.trim();
    confirmDialog({
      title: `Tạo ${name}?`,
      body: `<p>Hòm mới có loại hòm và chìa riêng. ${state.draft.active
        ? 'Hòm bán ngay khi tạo.'
        : 'Hòm đang tắt: bật “Đang bán” khi đã sẵn sàng.'}</p>${diffHtml(state.check?.diff ?? {}, nameOf)}`,
      confirmLabel: 'Tạo hòm',
      signal,
      action: async (reason) => {
        const created = await adminChestsApi.create({ ...state.draft, reason });
        toast(`Đã tạo ${created.name}.`, 'success');
        navigate(`/admin/chests/${encodeURIComponent(created.id)}`);
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
              <p class="ac-version-sum">Hòm ${xu(version.chestPrice)} · chìa ${xu(version.keyPrice)} · ${number(version.poolCount)} món · ${RARITIES.map((rarity) => `${RARITY_TEXT[rarity]} ${percent((version.dropWeights?.[rarity] ?? 0) / 100)}`).join(' · ')} · thử thách ${version.challengeWeight}</p>
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
  page.addEventListener('change', (event) => {
    const input = event.target.closest?.('[data-ac-picture-input]');
    if (!input) return;
    const file = input.files?.[0];
    input.value = '';
    uploadPicture(input.dataset.acPictureInput, file);
  });
  page.addEventListener('click', (event) => {
    const remove = event.target.closest?.('[data-ac-picture-remove]');
    if (!remove) return;
    state.draft.look[remove.dataset.acPictureRemove] = null;
    paintLook();
    changed();
  });
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
    } else if (name === 'chestPrice' || name === 'keyPrice' || name === 'sortOrder' || name === 'challengeWeight') {
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
