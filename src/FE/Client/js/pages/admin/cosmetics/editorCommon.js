import { adminCosmeticsApi } from '../../../api/adminCosmeticsApi.js';
import { adminAssetsApi } from '../../../api/adminAssetsApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { METRICS, RARITIES, askReason, checkPicture, errorText } from './shared.js';

const LEVELS_NOTE = 'Món theo cấp, thành tích hoặc mặc định tự thành không giao dịch được. Người chơi đã vượt cấp đó nhận bù khi mở hồ sơ lần tới.';

/** Name, rarity and the rest of what every cosmetic has. */
export function basicFieldsHtml(item, { withDescription = false } = {}) {
  const value = (field) => escapeHtml(item?.[field] ?? '');
  return `
    <div class="acf-grid2">
      <div><label class="field-label" for="acf-name">Tên tiếng Việt</label>
        <input class="field-input" id="acf-name" data-field="name" maxlength="60" required value="${value('name')}"></div>
      <div><label class="field-label" for="acf-name-en">Tên tiếng Anh</label>
        <input class="field-input" id="acf-name-en" data-field="nameEn" maxlength="60" value="${value('nameEn')}" placeholder="Để trống thì dùng tên tiếng Việt"></div>
      <div><label class="field-label" for="acf-rarity">Độ hiếm</label>
        <select class="field-input" id="acf-rarity" data-field="rarity">
          ${RARITIES.map((rarity) => `<option value="${rarity.id}"${(item?.rarity ?? 'RARE') === rarity.id ? ' selected' : ''}>${rarity.label}</option>`).join('')}
        </select></div>
      <div><label class="field-label" for="acf-price">Giá tham chiếu (xu)</label>
        <input class="field-input" id="acf-price" data-field="referencePrice" type="number" min="2" max="1000000" value="${value('referencePrice')}" placeholder="Theo độ hiếm"></div>
    </div>
    ${withDescription ? `
    <label class="field-label" for="acf-desc">Mô tả</label>
    <textarea class="field-input" id="acf-desc" data-field="description" rows="2" maxlength="300" placeholder="Để trống thì dùng mô tả của mẫu">${value('description')}</textarea>` : ''}
    <label class="acf-check"><input type="checkbox" data-field="tradable"${item?.tradable ?? true ? ' checked' : ''}> Được bán và trao đổi</label>`;
}

/** The fields of basicFieldsHtml as a request body. */
export function readBasics(root, item) {
  const field = (name) => root.querySelector(`[data-field="${name}"]`);
  const price = field('referencePrice').value.trim();
  return {
    name: field('name').value.trim(),
    nameEn: field('nameEn').value.trim(),
    rarity: field('rarity').value,
    referencePrice: price ? Number(price) : item?.referencePrice ?? null,
    description: field('description')?.value.trim() ?? item?.description ?? '',
    descriptionEn: item?.descriptionEn ?? '',
    tradable: field('tradable').checked,
  };
}

/** Saves a new or an existing cosmetic and goes on to its page, or stays and reports what is wrong. */
export async function saveCosmetic({ item, category, root, visual, button, onSaved }) {
  const basics = readBasics(root, item);
  if (!basics.name) {
    toast('Hãy nhập tên.', 'error');
    return;
  }
  let reason = null;
  if (item && basics.tradable !== item.tradable) {
    reason = await askReason(basics.tradable
      ? { heading: `Cho phép bán ${item.name}?`, detail: 'Món sẽ lên chợ, trao đổi được và đổi được KN nếu đủ độ hiếm.', confirmLabel: 'Cho phép bán', danger: true }
      : { heading: `Khóa giao dịch ${item.name}?`, detail: 'Món sẽ không bán, trao đổi hay đổi KN được nữa, kể cả các bản người chơi đang có.', confirmLabel: 'Khóa giao dịch', danger: true });
    if (!reason) return;
  }
  button.disabled = true;
  try {
    if (item) {
      const saved = await adminCosmeticsApi.update(item.id, { ...basics, expectedVersion: item.version, visual, reason });
      toast('Đã lưu.', 'success');
      onSaved(saved);
    } else {
      const saved = await adminCosmeticsApi.create({ ...basics, category, visual });
      toast('Đã tạo. Giờ có thể đặt cách nhận.', 'success');
      window.location.hash = `#/admin/cosmetics/${encodeURIComponent(saved.id)}`;
    }
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    button.disabled = false;
  }
}

/** An upload button for one picture. `onPicture({ url, width, height })` runs once it is stored. */
export function wirePictureInput(input, { needsAlpha = true, status, onPicture }) {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    status.textContent = '';
    status.classList.remove('is-warning');
    const { error, warnings } = await checkPicture(file, { needsAlpha });
    if (error) {
      toast(error, 'error');
      return;
    }
    status.textContent = 'Đang tải ảnh lên…';
    try {
      const stored = await adminAssetsApi.upload(file);
      status.textContent = warnings.join(' ');
      status.classList.toggle('is-warning', warnings.length > 0);
      onPicture(stored);
    } catch (uploadError) {
      status.textContent = '';
      toast(uploadError?.errors?.code === 'ASSET_STORAGE_UNAVAILABLE' ? 'Máy chủ chưa cấu hình nơi lưu ảnh (Cloudinary).' : errorText(uploadError), 'error');
    }
  });
}

/** How this cosmetic is obtained, and which chests it sits in. */
export function acquisitionHtml(item, page) {
  const way = item.acquisition;
  const radio = (mode, label) => `<label class="acf-check"><input type="radio" name="acf-mode" value="${mode}"${way.mode === mode ? ' checked' : ''}> ${label}</label>`;
  const metric = way.metric ?? page.metrics[0];
  return `
    <section class="acf-section" data-acquisition>
      <h3>Cách nhận</h3>
      <div class="acf-modes">
        ${radio('level', 'Theo cấp')}
        ${radio('achievement', 'Thành tích')}
        ${radio('default', 'Mặc định (mỗi nhóm một món)')}
        ${radio('admin', 'Chỉ admin cấp')}
      </div>
      <div data-mode-fields="level"><label class="field-label" for="acf-level">Cấp nhận (1–${page.maxLevel})</label>
        <input class="field-input acf-short" id="acf-level" type="number" min="1" max="${page.maxLevel}" value="${way.level ?? 10}"></div>
      <div data-mode-fields="achievement" class="acf-grid2">
        <div><label class="field-label" for="acf-metric">Chỉ số</label>
          <select class="field-input" id="acf-metric">${page.metrics.map((name) => `<option value="${name}"${name === metric ? ' selected' : ''}>${escapeHtml(METRICS[name] ?? name)}</option>`).join('')}</select></div>
        <div><label class="field-label" for="acf-target">Mục tiêu</label>
          <input class="field-input" id="acf-target" type="number" min="1" value="${way.target ?? 1}"></div>
      </div>
      <p class="muted small">${LEVELS_NOTE}</p>
      <div class="acf-actions"><button class="btn btn-primary" type="button" data-save-way>Lưu cách nhận</button></div>
      <h4>Ra từ hòm</h4>
      ${way.chests.length > 0
    ? `<p class="acf-chests" data-chests>Đang nằm trong hòm: ${way.chests.map((chest) => `<a href="#/admin/chests/${encodeURIComponent(chest.id)}">${escapeHtml(chest.name)}${chest.active ? '' : ' (đang tắt)'}</a>`).join(', ')}</p>`
    : '<p class="muted small" data-chests>Chưa nằm trong hòm nào.</p>'}
      <p class="muted small">Việc đưa vào hòm làm ở <a href="#/admin/chests">Hòm &amp; vật phẩm</a>.</p>
    </section>`;
}

function wireAcquisition(root, item, onSaved) {
  const section = root.querySelector('[data-acquisition]');
  const chosen = () => section.querySelector('input[name="acf-mode"]:checked')?.value;
  const show = () => section.querySelectorAll('[data-mode-fields]').forEach((block) => { block.hidden = block.dataset.modeFields !== chosen(); });
  section.querySelectorAll('input[name="acf-mode"]').forEach((input) => input.addEventListener('change', show));
  show();
  section.querySelector('[data-save-way]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const mode = chosen();
    const reason = await askReason(mode !== 'admin' && item.tradable
      ? { heading: `Đổi cách nhận của ${item.name}?`, detail: 'Món sẽ không bán, trao đổi hay đổi KN được nữa, kể cả các bản người chơi đang có. Khi đã có người nhận miễn phí thì không bật lại được.', confirmLabel: 'Đổi cách nhận', danger: true }
      : { heading: `Đổi cách nhận của ${item.name}?`, detail: 'Áp dụng ngay cho mọi người chơi.', confirmLabel: 'Đổi cách nhận' });
    if (!reason) return;
    button.disabled = true;
    try {
      const saved = await adminCosmeticsApi.setAcquisition(item.id, {
        mode,
        level: Number(section.querySelector('#acf-level').value),
        metric: section.querySelector('#acf-metric').value,
        target: Number(section.querySelector('#acf-target').value),
        reason,
      });
      toast('Đã lưu cách nhận.', 'success');
      onSaved(saved);
    } catch (error) {
      toast(errorText(error), 'error');
    } finally {
      button.disabled = false;
    }
  });
}

/** Retire, bring back, delete, and a way to give one to a player. */
export function statusHtml(item) {
  const made = !item.visual?.builtinId;
  return `
    <section class="acf-section" data-status>
      <h3>Trạng thái</h3>
      <p class="muted small">${item.retired ? 'Đã ngừng phát hành: không còn rơi, không còn trong cửa hàng. Người đã có vẫn dùng bình thường.' : 'Đang phát hành.'} ${item.owners} người đang sở hữu.</p>
      <div class="acf-actions">
        <button class="btn ${item.retired ? 'btn-primary' : 'btn-ghost'}" type="button" data-retire>${item.retired ? 'Phát hành lại' : 'Ngừng phát hành (retire)'}</button>
        <a class="btn btn-ghost" href="#/admin/cosmetics?tab=grant&def=${encodeURIComponent(item.id)}">Cấp cho người chơi</a>
        ${made && item.owners === 0 ? '<button class="btn acf-btn-danger" type="button" data-delete>Xóa hẳn</button>' : ''}
      </div>
    </section>`;
}

function wireStatus(root, item, onSaved) {
  const section = root.querySelector('[data-status]');
  section.querySelector('[data-retire]').addEventListener('click', async () => {
    const reason = await askReason(item.retired
      ? { heading: `Phát hành lại ${item.name}?`, detail: 'Món sẽ quay lại bảng rơi và cửa hàng nếu đang nằm trong đó.', confirmLabel: 'Phát hành lại' }
      : { heading: `Ngừng phát hành ${item.name}?`, detail: 'Món sẽ hết rơi và rời cửa hàng. Người đang dùng vẫn giữ nguyên.', confirmLabel: 'Ngừng phát hành', danger: true });
    if (!reason) return;
    try {
      onSaved(await adminCosmeticsApi.setRetired(item.id, !item.retired, reason));
      toast('Đã lưu.', 'success');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  });
  section.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const reason = await askReason({ heading: `Xóa hẳn ${item.name}?`, detail: 'Chưa ai sở hữu món này. Thao tác không hoàn tác được.', confirmLabel: 'Xóa hẳn', danger: true });
    if (!reason) return;
    try {
      await adminCosmeticsApi.remove(item.id, reason);
      toast('Đã xóa.', 'success');
      window.location.hash = `#/admin/cosmetics?tab=${item.category}`;
    } catch (error) {
      toast(errorText(error), 'error');
    }
  });
}

/**
 * How it is obtained and its status, which save on their own. They redraw only themselves: the admin may still be in
 * the middle of editing a picture or its effects, and those are not saved by these buttons.
 */
export function mountSections(root, item, page, onChanged) {
  const box = root.querySelector('[data-sections]');
  const draw = () => {
    box.innerHTML = acquisitionHtml(item, page) + statusHtml(item);
    wireAcquisition(box, item, changed);
    wireStatus(box, item, changed);
  };
  const changed = (saved) => {
    // The object the editor holds, so its next save sends the new version.
    Object.assign(item, saved);
    root.querySelector('[data-field="tradable"]').checked = item.tradable;
    onChanged(saved);
    draw();
  };
  draw();
}
