import { adminAssetsApi } from '../../../api/adminAssetsApi.js';
import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { icon, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { fromHex, toHex } from './chestDraft.js';
import { acIcon, confirmDialog, errorMessages, errorsHtml, openDialog } from './shared.js';

/** What drifts in the room. The last three exist only for scenes made here. */
const PARTICLES = [
  ['dust', 'Bụi vàng bay lên'], ['coins', 'Ánh kim lấp lánh'], ['petals', 'Cánh hoa rơi'], ['embers', 'Tàn lửa bay lên'],
  ['rise', 'Ảnh hạt tự tải: bay lên'], ['fall', 'Ảnh hạt tự tải: rơi xuống'], ['none', 'Không có'],
];
const particleLabel = (value) => PARTICLES.find(([id]) => id === value)?.[1] ?? value;

const PICTURES = [
  { field: 'backdropUrl', label: 'Ảnh nền cảnh', note: 'Căn phòng phía sau hòm, phủ kín trang Mở hòm. Ảnh ngang, hơi tối để chữ dễ đọc.' },
  { field: 'chestImageUrl', label: 'Ảnh hòm', note: 'Hòm đóng, nền trong suốt. Hiện ở trang Mở hòm, kho, chợ và thông báo rớt hòm.' },
  { field: 'keyImageUrl', label: 'Ảnh chìa', note: 'Chìa, nền trong suốt.' },
  { field: 'particleUrl', label: 'Ảnh hạt bay (không bắt buộc)', note: 'Hình nhỏ nền trong suốt: giọt mưa, bông tuyết, đốm sáng… Dùng khi chọn "Ảnh hạt tự tải". Không có thì là đốm sáng theo màu nhấn.' },
];
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

const blankStyle = () => ({
  name: '', nameEn: '', backdropUrl: '', particles: 'dust', particleUrl: '', accent: '233,183,90', accent2: '255,226,160',
  stampText: '', stampTextEn: '', stampColor: '158,63,42', chestImageUrl: '', keyImageUrl: '', version: 0,
});

/** A small picture of the scene: the room, the chest in it, and its stamp. */
function previewHtml(style) {
  const room = style.backdropUrl ? `background-image:url('${escapeHtml(style.backdropUrl)}');` : '';
  return `
    <div class="ac-style-preview" style="${room}--ac-glow:rgb(${escapeHtml(style.accent)})" data-style-preview-art>
      ${style.chestImageUrl ? `<img src="${escapeHtml(style.chestImageUrl)}" alt="" draggable="false">` : '<span class="ac-style-empty">Chưa có ảnh hòm</span>'}
      ${style.stampText ? `<span class="ac-style-stamp" style="color:rgb(${escapeHtml(style.stampColor)});border-color:rgb(${escapeHtml(style.stampColor)})">${escapeHtml(style.stampText)}</span>` : ''}
    </div>`;
}

/** /admin/chests?tab=kieu-hom: the opening scenes admins made, and making a new one from nothing. */
export async function renderChestStyles(container, { signal } = {}) {
  let styles = [];

  function cardHtml(style) {
    const used = style.usedBy ?? [];
    return `
      <article class="adm-card ac-style-card" data-style-id="${escapeHtml(style.id)}">
        ${previewHtml(style)}
        <div class="ac-style-info">
          <h3>${escapeHtml(style.name)}</h3>
          <p class="ac-style-meta">${escapeHtml(style.nameEn)} · <span class="adm-mono">${escapeHtml(style.id)}</span> · ${escapeHtml(particleLabel(style.particles))}</p>
          <p class="ac-style-meta">${used.length ? `Đang dùng ở: ${used.map((user) => escapeHtml(user.name)).join(', ')}` : 'Chưa hòm nào dùng'}</p>
        </div>
        <div class="adm-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-ac-style-edit>Sửa</button>
          <button type="button" class="btn btn-ghost btn-sm adm-btn-danger" data-ac-style-delete${used.length ? ' disabled title="Đổi kiểu của các hòm đang dùng trước khi xóa"' : ''}>Xóa</button>
        </div>
      </article>`;
  }

  async function load() {
    const data = await adminChestsApi.styles();
    if (signal?.aborted) return;
    styles = data?.styles ?? [];
    render(container, `
      <div class="ac-list-head">
        <p class="ac-lead">Kiểu hòm là cảnh mở hòm: căn phòng phía sau, hạt bay, màu, con dấu, ảnh hòm và chìa. Tạo kiểu mới rồi chọn nó ở ô Kiểu hòm của từng hòm.</p>
        <button type="button" class="btn btn-primary" data-ac-style-new>${icon('plus', 16)}Tạo kiểu mới</button>
      </div>
      ${styles.length
    ? `<div class="ac-style-grid">${styles.map(cardHtml).join('')}</div>`
    : stateBox('empty', 'Chưa có kiểu tự tạo nào.', 'Bốn kiểu có sẵn vẫn dùng như cũ.')}`);
  }

  function openEditor(existing) {
    const draft = existing ? { ...existing, particleUrl: existing.particleUrl ?? '' } : blankStyle();
    const uploading = new Set();
    const text = (name, label, attrs = '') => `<label class="ac-field"><span>${escapeHtml(label)}</span><input class="field-input" name="${name}" value="${escapeHtml(draft[name])}" ${attrs}></label>`;
    const colour = (name, label) => `<label class="ac-colour"><span>${escapeHtml(label)}</span><input type="color" name="${name}" value="${toHex(draft[name])}"></label>`;
    const { dialog, close } = openDialog({
      title: existing ? `Sửa kiểu ${existing.name}` : 'Tạo kiểu hòm mới',
      wide: true,
      signal,
      body: `
        <form class="ac-style-form" novalidate>
          <div class="ac-style-layout">
            <div class="ac-style-fields">
              <div class="ac-form-grid">
                ${text('name', 'Tên kiểu', 'maxlength="80"')}
                ${text('nameEn', 'Tên kiểu (tiếng Anh)', 'maxlength="80"')}
                ${text('stampText', 'Chữ trên con dấu', 'maxlength="30"')}
                ${text('stampTextEn', 'Chữ trên con dấu (tiếng Anh)', 'maxlength="30"')}
              </div>
              <label class="ac-field"><span>Hạt bay</span>
                <select class="field-input" name="particles">${PARTICLES.map(([id, label]) => `<option value="${id}"${id === draft.particles ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
              </label>
              <div class="ac-colours">
                ${colour('accent', 'Màu nhấn (ánh sáng)')}
                ${colour('accent2', 'Màu nhấn phụ')}
                ${colour('stampColor', 'Màu con dấu')}
              </div>
              <div class="ac-pictures">
                <h3 class="ac-pictures-title">Ảnh</h3>
                <p class="ac-field-hint">PNG, WebP hoặc JPG, tối đa 5 MB.</p>
                ${PICTURES.map((picture) => `<div class="ac-picture-row" data-style-picture="${picture.field}"></div>`).join('')}
              </div>
            </div>
            <div class="ac-style-side"><h3 class="ac-pictures-title">Xem trước</h3><div data-style-preview></div></div>
          </div>
          <div data-style-errors></div>
          <div class="ac-dialog-actions">
            <button type="button" class="btn btn-ghost" data-style-cancel>Hủy</button>
            <button type="submit" class="btn btn-primary" data-style-save>${existing ? 'Lưu kiểu' : 'Tạo kiểu'}</button>
          </div>
        </form>`,
    });
    const $ = (selector) => dialog.querySelector(selector);

    function paintPreview() {
      $('[data-style-preview]').innerHTML = previewHtml(draft);
    }

    function paintPictures() {
      for (const picture of PICTURES) {
        const row = $(`[data-style-picture="${picture.field}"]`);
        const url = draft[picture.field];
        const busy = uploading.has(picture.field);
        const inputId = `ac-style-${picture.field}`;
        row.innerHTML = `
          <span class="ac-picture-thumb">${url ? `<img class="is-picture" src="${escapeHtml(url)}" alt="${escapeHtml(picture.label)}" draggable="false">` : '<span class="muted">Chưa có</span>'}</span>
          <span class="ac-picture-text"><strong>${escapeHtml(picture.label)}</strong><span>${busy ? 'Đang tải ảnh…' : escapeHtml(picture.note)}</span></span>
          <span class="ac-picture-actions">
            <label class="btn btn-ghost btn-sm ac-upload-btn" for="${inputId}">${acIcon('upload', 16)}${url ? 'Đổi ảnh' : 'Tải ảnh lên'}</label>
            <input id="${inputId}" type="file" accept="image/png,image/webp,image/jpeg" hidden data-style-picture-input="${picture.field}"${busy ? ' disabled' : ''}>
            ${url && picture.field === 'particleUrl' ? '<button type="button" class="btn btn-ghost btn-sm adm-btn-danger" data-style-picture-remove="particleUrl">Bỏ ảnh</button>' : ''}
          </span>`;
      }
      $('[data-style-save]').disabled = uploading.size > 0;
    }

    async function upload(field, file) {
      if (!file) return;
      if (!/^image\/(png|webp|jpeg)$/.test(file.type)) {
        toast('Ảnh phải là PNG, WebP hoặc JPG.', 'error');
        return;
      }
      if (file.size > MAX_PICTURE_BYTES) {
        toast('Ảnh phải từ 5 MB trở xuống.', 'error');
        return;
      }
      uploading.add(field);
      paintPictures();
      try {
        const asset = await adminAssetsApi.upload(file);
        draft[field] = asset.url;
      } catch (error) {
        toast(errorMessages(error)[0] ?? 'Không tải được ảnh.', 'error');
      } finally {
        uploading.delete(field);
        if (dialog.isConnected) {
          paintPictures();
          paintPreview();
        }
      }
    }

    dialog.addEventListener('input', (event) => {
      const { name, value } = event.target;
      if (!name || name === 'reason') return;
      draft[name] = event.target.type === 'color' ? fromHex(value) : value;
      paintPreview();
    });
    dialog.addEventListener('change', (event) => {
      const input = event.target.closest('[data-style-picture-input]');
      if (!input) return;
      const file = input.files?.[0];
      input.value = '';
      upload(input.dataset.stylePictureInput, file);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-style-cancel]')) { close(); return; }
      const remove = event.target.closest('[data-style-picture-remove]');
      if (remove) {
        draft[remove.dataset.stylePictureRemove] = '';
        paintPictures();
      }
    });
    $('.ac-style-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const save = $('[data-style-save]');
      if (save.disabled) return;
      save.disabled = true;
      const body = {
        name: draft.name, nameEn: draft.nameEn, backdropUrl: draft.backdropUrl, particles: draft.particles,
        particleUrl: draft.particleUrl || null, accent: draft.accent, accent2: draft.accent2,
        stampText: draft.stampText, stampTextEn: draft.stampTextEn, stampColor: draft.stampColor,
        chestImageUrl: draft.chestImageUrl, keyImageUrl: draft.keyImageUrl, expectedVersion: draft.version,
      };
      try {
        const saved = existing ? await adminChestsApi.updateStyle(existing.id, body) : await adminChestsApi.createStyle(body);
        close();
        toast(existing ? `Đã lưu ${saved.name}.` : `Đã tạo ${saved.name}. Chọn nó ở ô Kiểu hòm của hòm.`, 'success');
        await load();
      } catch (error) {
        $('[data-style-errors]').innerHTML = errorsHtml(errorMessages(error));
        save.disabled = false;
      }
    });

    paintPictures();
    paintPreview();
  }

  try {
    await load();
  } catch (error) {
    if (!signal?.aborted) render(container, stateBox('error', 'Không tải được kiểu hòm', errorMessages(error)[0]));
    return;
  }

  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-ac-style-new]')) {
      openEditor(null);
      return;
    }
    const style = styles.find((entry) => entry.id === event.target.closest('[data-style-id]')?.dataset.styleId);
    if (!style) return;
    if (event.target.closest('[data-ac-style-edit]')) {
      openEditor(style);
    } else if (event.target.closest('[data-ac-style-delete]:not([disabled])')) {
      confirmDialog({
        title: `Xóa kiểu ${style.name}?`,
        body: '<p>Chưa hòm nào dùng kiểu này. Xóa rồi không khôi phục được.</p>',
        confirmLabel: 'Xóa kiểu',
        danger: true,
        reason: 'optional',
        reasonLabel: 'Ghi chú',
        signal,
        action: async (reason) => {
          await adminChestsApi.deleteStyle(style.id, reason);
          toast(`Đã xóa ${style.name}.`, 'success');
          await load();
        },
      });
    }
  }, signal ? { signal } : undefined);
}
