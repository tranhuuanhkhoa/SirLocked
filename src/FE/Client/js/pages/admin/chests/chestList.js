import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { pixelIconUrl } from '../../chest/chestSprites.js';
import { draftOf } from './chestDraft.js';
import { confirmDialog, errorMessages, number, percent, xu } from './shared.js';

function rowHtml(chest) {
  const ratio = chest.cost > 0 ? (chest.expectedValue * 100) / chest.cost : 0;
  const glow = chest.look?.light ? ` style="--ac-glow:rgb(${escapeHtml(chest.look.light)})"` : '';
  return `
    <article class="ac-chest-row${chest.active ? '' : ' is-off'}" data-chest-id="${escapeHtml(chest.id)}">
      <a class="ac-chest-art"${glow} href="#/admin/chests/${encodeURIComponent(chest.id)}" aria-label="Sửa ${escapeHtml(chest.name)}">
        <img src="${pixelIconUrl(chest.iconKey)}" alt="" draggable="false">
      </a>
      <div class="ac-chest-main">
        <h3><a href="#/admin/chests/${encodeURIComponent(chest.id)}">${escapeHtml(chest.name)}</a></h3>
        <p class="muted ac-small">${escapeHtml(chest.id)} · ${escapeHtml(chest.keyName)}</p>
        <span class="ac-tag ${chest.active ? 'ac-tag--on' : 'ac-tag--off'}">${chest.active ? 'Đang bán' : 'Đang tắt'}</span>
      </div>
      <dl class="ac-chest-facts">
        <div><dt>Giá hòm</dt><dd>${xu(chest.chestPrice)}</dd></div>
        <div><dt>Giá chìa</dt><dd>${xu(chest.keyPrice)}</dd></div>
        <div><dt>Mở 7 ngày</dt><dd data-ac-opens>${number(chest.opensLast7Days)}</dd></div>
        <div><dt>Giá trị kỳ vọng / chi phí</dt><dd data-ac-ev>${number(chest.expectedValue)} / ${number(chest.cost)} xu <span class="muted">(${percent(ratio, 0)})</span></dd></div>
      </dl>
      <div class="ac-chest-actions">
        <a class="btn btn-ghost btn-sm" href="#/admin/chests/${encodeURIComponent(chest.id)}">Sửa</a>
        <button type="button" class="btn btn-ghost btn-sm" data-ac-toggle>${chest.active ? 'Tắt' : 'Bật'}</button>
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
      <div class="page-head"><h2>Hòm</h2></div>
      ${problems.length ? `<details class="ac-problems"><summary>Danh mục có ${problems.length} chỗ chưa khớp</summary><ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul></details>` : ''}
      <p class="muted ac-small">Hòm mới được tạo bằng cách nhân bản một hòm có sẵn.</p>
      <div class="ac-chest-list">${chests.map(rowHtml).join('') || '<p class="muted">Chưa có hòm nào.</p>'}</div>`);
  }

  try {
    await load();
  } catch (error) {
    if (!signal?.aborted) render(container, `<div class="empty-state">${escapeHtml(errorMessages(error)[0])}</div>`);
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
          window.location.hash = `#/admin/chests/${encodeURIComponent(created.id)}`;
        },
      });
    }
  }, signal ? { signal } : undefined);
}
