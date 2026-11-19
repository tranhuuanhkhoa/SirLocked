import { adminAssetsApi } from '../../../api/adminAssetsApi.js';
import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { EN, FR, T } from '../../../cosmetics/index.js';
import { escapeHtml } from '../../../utils/dom.js';
import { SPRITE_KEYS, pixelIconUrl } from '../../chest/chestSprites.js';
import { RARITIES, RARITY_TEXT, acIcon, errorMessages, errorsHtml, mountThumbs, number, openDialog } from './shared.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Every sprite on offer, read from the drawing code, so a sprite added there appears here. */
const ICON_GROUPS = [
  { id: 'items', label: 'Vật phẩm', keys: () => SPRITE_KEYS.items },
  { id: 'keys', label: 'Chìa', keys: () => SPRITE_KEYS.keys },
  { id: 'chests', label: 'Hòm', keys: () => SPRITE_KEYS.chests },
  { id: 'frames', label: 'Viền', category: 'FRAME', keys: () => Object.keys(FR).filter((key) => key !== 'none').map((key) => `frame_${key}`) },
  { id: 'titles', label: 'Danh hiệu', category: 'TITLE', keys: () => Object.keys(T).map((key) => `title_${key}`) },
  { id: 'entrances', label: 'Hiệu ứng', category: 'ENTRANCE', keys: () => Object.keys(EN).map((key) => `entrance_${key}`) },
];

const groupOf = (iconKey) => ICON_GROUPS.find((group) => group.keys().includes(iconKey))?.id ?? 'items';

/**
 * The form of a curio or an old gear item: `item` to edit one, none to create a curio. Resolves through `onSaved`.
 * The id of a new curio is shown before saving; the server assigns it when it saves.
 */
export function openItemForm({ item = null, nextId = '', signal, onSaved }) {
  const editing = Boolean(item);
  const state = {
    iconKey: item?.visual?.iconKey ?? null,
    imageUrl: item?.visual?.imageUrl ?? null,
    group: groupOf(item?.visual?.iconKey),
    uploading: false,
  };
  const owned = item?.circulating ?? 0;

  const { dialog, close } = openDialog({
    title: editing ? `Sửa ${item.name}` : 'Tạo vật phẩm sưu tầm',
    subHtml: `<span class="ac-item-id">Mã vật phẩm: <code data-ac-next-id>${escapeHtml(editing ? item.id : nextId)}</code>${editing ? '' : ' (tự sinh)'}</span>`,
    wide: true,
    signal,
    body: `
      <div class="ac-form-grid">
        <label class="ac-field"><span>Tên (tiếng Việt)</span><input class="field-input" name="name" maxlength="80" value="${escapeHtml(item?.name ?? '')}"></label>
        <label class="ac-field"><span>Tên (tiếng Anh)</span><input class="field-input" name="nameEn" maxlength="80" value="${escapeHtml(item?.nameEn ?? '')}"></label>
        <label class="ac-field"><span>Mô tả (tiếng Việt)</span><textarea class="field-input" name="description" rows="2" maxlength="400">${escapeHtml(item?.description ?? '')}</textarea></label>
        <label class="ac-field"><span>Mô tả (tiếng Anh)</span><textarea class="field-input" name="descriptionEn" rows="2" maxlength="400">${escapeHtml(item?.descriptionEn ?? '')}</textarea></label>
        <label class="ac-field"><span>Độ hiếm</span>
          <select class="field-input" name="rarity">
            ${RARITIES.map((rarity) => `<option value="${rarity}"${rarity === (item?.rarity ?? 'COMMON') ? ' selected' : ''}>${RARITY_TEXT[rarity]}</option>`).join('')}
          </select>
        </label>
        <label class="ac-field"><span>Giá tham chiếu (xu)</span><input class="field-input" name="referencePrice" type="number" min="2" max="1000000" step="1" inputmode="numeric" value="${item?.referencePrice ?? ''}"></label>
        <label class="ac-check"><input type="checkbox" name="tradable"${(item?.tradable ?? true) ? ' checked' : ''}> Được bán và trao đổi trên Chợ đồ</label>
      </div>

      <div class="ac-warning" data-ac-owned-warning hidden>
        <p data-ac-rarity-warning hidden>Món này đang có ${number(owned)} bản thuộc về người chơi. Đổi độ hiếm ảnh hưởng đến lượng đổi KN của các bản đó và bảng rơi của mọi hòm chứa món này.</p>
        <p data-ac-tradable-warning hidden>Món này đang có ${number(owned)} bản thuộc về người chơi. Tắt mục này thì các bản đó không bán, không trao đổi và không đổi KN được nữa, nhưng vẫn chiếm ô trong túi; tin rao và lệnh mua đang mở cũng biến mất khỏi Chợ đồ.</p>
        <label class="ac-field"><span>Lý do</span><textarea class="field-input" name="reason" rows="2" maxlength="500"></textarea></label>
      </div>

      <section class="ac-icon-section" aria-labelledby="ac-icon-title">
        <h3 class="ac-subhead" id="ac-icon-title">Hình của vật phẩm</h3>
        <div class="ac-upload">
          <label class="btn btn-ghost btn-sm ac-upload-btn">${acIcon('upload', 16)}Tải ảnh lên<input type="file" accept="image/png,image/webp,image/jpeg" hidden></label>
          <span class="ac-upload-note">PNG, WebP hoặc JPG, tối đa 5 MB. Hoặc chọn một sprite có sẵn bên dưới.</span>
          <span data-ac-upload-state class="ac-upload-state"></span>
        </div>
        <div class="ac-image-holder" data-ac-image-holder></div>
        <div class="adm-seg ac-icon-tabs" role="tablist" aria-label="Nhóm sprite">
          ${ICON_GROUPS.map((group) => `<button type="button" class="ac-chip" role="tab" data-icon-group="${group.id}">${escapeHtml(group.label)}</button>`).join('')}
        </div>
        <div class="ac-icon-grid" data-ac-icon-grid></div>
      </section>

      <div data-ac-errors></div>
      <div class="ac-dialog-actions">
        <button type="button" class="btn btn-ghost" data-ac-cancel>Hủy</button>
        <button type="button" class="btn btn-primary" data-ac-submit>${editing ? 'Lưu' : 'Tạo vật phẩm'}</button>
      </div>`,
  });

  const $ = (selector) => dialog.querySelector(selector);
  const closing = new AbortController();
  dialog.addEventListener('close', () => closing.abort());
  const showErrors = (messages) => { $('[data-ac-errors]').innerHTML = errorsHtml(messages); };

  function renderIcons() {
    const group = ICON_GROUPS.find((entry) => entry.id === state.group);
    dialog.querySelectorAll('[data-icon-group]').forEach((tab) => {
      const on = tab.dataset.iconGroup === group.id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    $('[data-ac-icon-grid]').innerHTML = group.keys().map((key) => {
      const picture = group.category
        ? `<canvas class="ac-thumb" width="96" height="96" data-ac-thumb="${escapeHtml(key)}" data-ac-thumb-category="${group.category}" aria-hidden="true"></canvas>`
        : `<img src="${pixelIconUrl(key)}" alt="" draggable="false">`;
      return `<button type="button" class="ac-icon-cell" data-icon-key="${escapeHtml(key)}" aria-pressed="${String(!state.imageUrl && state.iconKey === key)}" title="${escapeHtml(key)}">${picture}<span>${escapeHtml(key)}</span></button>`;
    }).join('');
    mountThumbs($('[data-ac-icon-grid]'), closing.signal);
  }

  function renderImage() {
    $('[data-ac-image-holder]').innerHTML = state.imageUrl
      ? `<img data-ac-image-preview src="${escapeHtml(state.imageUrl)}" alt="Ảnh đã tải lên"><button type="button" class="btn btn-ghost btn-sm" data-ac-image-remove>Bỏ ảnh</button>`
      : '';
  }

  dialog.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-icon-group]');
    if (tab) {
      state.group = tab.dataset.iconGroup;
      renderIcons();
      return;
    }
    const cell = event.target.closest('[data-icon-key]');
    if (cell) {
      state.iconKey = cell.dataset.iconKey;
      state.imageUrl = null;
      renderImage();
      dialog.querySelectorAll('[data-icon-key]').forEach((other) => other.setAttribute('aria-pressed', String(other === cell)));
      return;
    }
    if (event.target.closest('[data-ac-image-remove]')) {
      state.imageUrl = null;
      renderImage();
    }
  });

  const fileInput = $('input[type="file"]');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      showErrors(['Ảnh phải từ 5 MB trở xuống.']);
      return;
    }
    showErrors([]);
    state.uploading = true;
    $('[data-ac-upload-state]').textContent = 'Đang tải ảnh…';
    try {
      const asset = await adminAssetsApi.upload(file);
      state.imageUrl = asset.url;
      state.iconKey = null;
      renderImage();
      renderIcons();
    } catch (error) {
      showErrors(errorMessages(error));
    } finally {
      state.uploading = false;
      $('[data-ac-upload-state]').textContent = '';
    }
  });

  const rarityChanged = () => editing && owned > 0 && $('[name="rarity"]').value !== item.rarity;
  const saleStopped = () => editing && owned > 0 && item.tradable && !$('[name="tradable"]').checked;
  const paintWarnings = () => {
    $('[data-ac-rarity-warning]').hidden = !rarityChanged();
    $('[data-ac-tradable-warning]').hidden = !saleStopped();
    $('[data-ac-owned-warning]').hidden = !rarityChanged() && !saleStopped();
  };
  $('[name="rarity"]').addEventListener('change', paintWarnings);
  $('[name="tradable"]').addEventListener('change', paintWarnings);

  $('[data-ac-cancel]').addEventListener('click', close);
  const submit = $('[data-ac-submit]');
  submit.addEventListener('click', async () => {
    if (state.uploading) return;
    const value = (name) => $(`[name="${name}"]`).value;
    const reason = value('reason').trim();
    if ((rarityChanged() || saleStopped()) && !reason) {
      showErrors([rarityChanged() ? 'Hãy nhập lý do đổi độ hiếm.' : 'Hãy nhập lý do ngừng cho bán.']);
      return;
    }
    // Old gear may stay drawn by its category; a curio has no such drawing.
    if ((!editing || item.category === 'CURIO') && !state.iconKey && !state.imageUrl) {
      showErrors(['Hãy chọn một sprite có sẵn hoặc tải ảnh lên.']);
      return;
    }
    const body = {
      name: value('name'),
      nameEn: value('nameEn'),
      description: value('description'),
      descriptionEn: value('descriptionEn'),
      rarity: value('rarity'),
      referencePrice: Number(value('referencePrice') || 0),
      tradable: $('[name="tradable"]').checked,
      iconKey: state.iconKey,
      imageUrl: state.imageUrl,
    };
    submit.disabled = true;
    showErrors([]);
    try {
      const saved = editing
        ? await adminChestsApi.updateItem(item.id, { ...body, expectedVersion: item.version, reason: reason || null })
        : await adminChestsApi.createItem(body);
      close();
      onSaved(saved);
    } catch (error) {
      showErrors(errorMessages(error));
      submit.disabled = false;
    }
  });

  renderImage();
  renderIcons();
}
