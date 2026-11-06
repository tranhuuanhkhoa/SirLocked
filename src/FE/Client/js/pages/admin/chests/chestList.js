import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { pill, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { pixelIconUrl } from '../../chest/chestSprites.js';
import { draftOf } from './chestDraft.js';
import { confirmDialog, errorMessages, number, percent, xu } from './shared.js';
import { navigate } from '../../../services/navigation.js';

/** The chest's own sprite on the navy tile of the design, lit by the chest's light colour. */
export const chestArt = (chest, href = '') => {
  const glow = chest.look?.light ? ` style="--ac-glow:rgb(${escapeHtml(chest.look.light)})"` : '';
  const img = `<img src="${pixelIconUrl(chest.iconKey)}" alt="" draggable="false">`;
  return href
    ? `<a class="ac-chest-art"${glow} href="${href}" aria-label="Sửa ${escapeHtml(chest.name)}" tabindex="-1">${img}</a>`
    : `<span class="ac-chest-art"${glow} aria-hidden="true">${img}</span>`;
};

function cardHtml(chest) {
  const ratio = chest.cost > 0 ? (chest.expectedValue * 100) / chest.cost : 0;
  const href = `/admin/chests/${encodeURIComponent(chest.id)}`;
  return `
    <article class="adm-card ac-chest-card${chest.active ? '' : ' is-off'}" data-chest-id="${escapeHtml(chest.id)}">
      <div class="ac-chest-top">
        ${chestArt(chest, href)}
        <div class="ac-chest-main">
          <h2 class="ac-chest-name"><a href="${href}">${escapeHtml(chest.name)}</a></h2>
          <span class="ac-chest-code"><span class="adm-mono">${escapeHtml(chest.id)}</span> · ${escapeHtml(chest.keyName)}</span>
          <span>${chest.active ? pill('Đang bán', 'ok', { dot: true, small: true }) : pill('Đang tắt', '', { dot: true, small: true })}</span>
        </div>
      </div>
      <dl class="ac-facts">
        <div><dt>Giá hòm</dt><dd>${xu(chest.chestPrice)}</dd></div>
        <div><dt>Giá chìa</dt><dd>${xu(chest.keyPrice)}</dd></div>
        <div><dt>Mở 7 ngày</dt><dd data-ac-opens>${number(chest.opensLast7Days)}</dd></div>
      </dl>
      <div class="ac-ev">
        <span class="ac-ev-line"><span>Giá trị kỳ vọng / chi phí</span><strong data-ac-ev>${number(chest.expectedValue)} / ${number(chest.cost)} xu · ${percent(ratio, 0)}</strong></span>
        <span class="adm-meter adm-meter--gold ac-ev-meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, ratio))}%"></span></span>
      </div>
      <div class="ac-chest-actions">
        <a class="btn btn-primary btn-sm" href="${href}">Sửa</a>
        <button type="button" class="btn btn-ghost btn-sm ${chest.active ? 'adm-btn-danger' : 'adm-btn-ok'}" data-ac-toggle>${chest.active ? 'Tắt' : 'Bật'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ac-clone>Nhân bản</button>
      </div>
    </article>`;
}

/** The chests, with on/off and "make a new one from this one". */
export async function renderChestList(container, { signal } = {}) {
  let chests = [];

  async function load() {
    const data = await adminChestsApi.chests();
    if (signal?.aborted) return;
    chests = data?.chests ?? [];
    const problems = data?.problems ?? [];
    render(container, `
      ${problems.length ? `<details class="ac-problems"><summary>Danh mục có ${problems.length} chỗ chưa khớp</summary><ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul></details>` : ''}
      <p class="ac-lead">Hòm mới được tạo bằng cách nhân bản một hòm có sẵn.</p>
      ${chests.length
    ? `<div class="ac-chest-grid">${chests.map(cardHtml).join('')}</div>`
    : stateBox('empty', 'Chưa có hòm nào.')}`);
  }

  try {
    await load();
  } catch (error) {
    if (!signal?.aborted) render(container, stateBox('error', 'Không tải được danh sách hòm', errorMessages(error)[0]));
    return;
  }

  container.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const id = button?.closest('[data-chest-id]')?.dataset.chestId;
    const chest = chests.find((entry) => entry.id === id);
    if (!chest) return;

    if (button.hasAttribute('data-ac-toggle')) {
      const turningOff = chest.active;
      confirmDialog({
        title: turningOff ? `Tắt ${chest.name}?` : `Bật ${chest.name}?`,
        body: turningOff
          ? '<p>Hòm biến mất khỏi Kho Rương và không bán hòm hay chìa nữa. Hòm và chìa người chơi đang giữ vẫn mở được.</p>'
          : '<p>Hòm xuất hiện ở Kho Rương và bắt đầu bán ngay.</p>',
        confirmLabel: turningOff ? 'Tắt hòm' : 'Bật hòm',
        danger: turningOff,
        signal,
        action: async (reason) => {
          const current = await adminChestsApi.chest(chest.id);
          await adminChestsApi.save(chest.id, { ...draftOf(current), active: !turningOff, reason });
          toast(turningOff ? `Đã tắt ${chest.name}.` : `Đã bật ${chest.name}.`, 'success');
          await load();
        },
      });
    } else if (button.hasAttribute('data-ac-clone')) {
      confirmDialog({
        title: `Tạo hòm mới từ ${chest.name}`,
        body: '<p>Hòm mới có cùng giá, hình, bảng rơi và nội dung, kèm vật phẩm hòm và chìa riêng. Hòm mặc định tắt: bật lên khi đã sẵn sàng.</p>',
        extra: `
          <div class="ac-form-grid">
            <label class="ac-field"><span>Tên hòm mới (tiếng Việt)</span><input class="field-input" name="name" maxlength="80"></label>
            <label class="ac-field"><span>Tên hòm mới (tiếng Anh)</span><input class="field-input" name="nameEn" maxlength="80"></label>
          </div>`,
        confirmLabel: 'Tạo hòm',
        reason: 'optional',
        reasonLabel: 'Ghi chú',
        signal,
        action: async (reason, dialog) => {
          const created = await adminChestsApi.clone(chest.id, {
            name: dialog.querySelector('[name="name"]').value,
            nameEn: dialog.querySelector('[name="nameEn"]').value,
            reason,
          });
          toast(`Đã tạo ${created.name}. Hòm đang tắt.`, 'success');
          navigate(`/admin/chests/${encodeURIComponent(created.id)}`);
        },
      });
    }
  }, signal ? { signal } : undefined);
}
