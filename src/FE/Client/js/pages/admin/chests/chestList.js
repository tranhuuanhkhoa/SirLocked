import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { icon, pill, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { chestIconUrl, chestPictureUrl } from '../../chest/chestSprites.js';
import { draftOf } from './chestDraft.js';
import { showcaseFigures, showcaseOf, showcaseRibbon, showcaseSky } from './chestShowcase.js';
import { NEW_CHEST, confirmDialog, errorMessages, number, percent, xu } from './shared.js';
import { navigate } from '../../../services/navigation.js';

/** The chest's own picture, or its sprite, on the navy tile of the design, lit by the chest's light colour. */
export const chestArt = (chest, href = '') => {
  const glow = chest.look?.light ? ` style="--ac-glow:rgb(${escapeHtml(chest.look.light)})"` : '';
  const picture = chestPictureUrl(chest) ? ' class="is-picture"' : '';
  const img = `<img${picture} src="${escapeHtml(chestIconUrl(chest))}" alt="" draggable="false">`;
  return href
    ? `<a class="ac-chest-art"${glow} href="${href}" aria-label="Sửa ${escapeHtml(chest.name)}" tabindex="-1">${img}</a>`
    : `<span class="ac-chest-art"${glow} aria-hidden="true">${img}</span>`;
};

/** The numbers every card shows, the same markup in the plain card and the showcase. */
function factsHtml(chest, ratio) {
  return `
      <dl class="ac-facts">
        <div><dt>Giá hòm</dt><dd>${xu(chest.chestPrice)}</dd></div>
        <div><dt>Giá chìa</dt><dd>${xu(chest.keyPrice)}</dd></div>
        <div><dt>Mở 7 ngày</dt><dd data-ac-opens>${number(chest.opensLast7Days)}</dd></div>
      </dl>
      <div class="ac-ev">
        <span class="ac-ev-line"><span>Giá trị kỳ vọng / chi phí</span><strong data-ac-ev>${number(chest.expectedValue)} / ${number(chest.cost)} xu · ${percent(ratio, 0)}</strong></span>
        <span class="adm-meter adm-meter--gold ac-ev-meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, ratio))}%"></span></span>
      </div>
      <p class="ac-challenge" data-ac-challenge>Thử thách tuần: <strong>${chest.challengePercent > 0 ? percent(chest.challengePercent) : 'Không rớt'}</strong></p>`;
}

function actionsHtml(chest, href) {
  return `
      <div class="ac-chest-actions">
        <a class="btn btn-primary btn-sm" href="${href}">Sửa</a>
        <button type="button" class="btn btn-ghost btn-sm ${chest.active ? 'adm-btn-danger' : 'adm-btn-ok'}" data-ac-toggle>${chest.active ? 'Tắt' : 'Bật'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ac-clone>Nhân bản</button>
      </div>`;
}

/** A collection's chest: a wide card with its night scene, the outfits beside the chest and a legend ribbon. */
function showcaseCardHtml(chest, showcase, ratio, href) {
  return `
    <article class="adm-card ac-chest-card ac-chest-card--showcase${chest.active ? '' : ' is-off'}" data-chest-id="${escapeHtml(chest.id)}" data-showcase="${escapeHtml(chest.look.template)}">
      <div class="ac-show-stage">
        ${showcaseSky()}
        ${showcaseFigures(showcase)}
        ${chestArt(chest, href)}
      </div>
      <div class="ac-show-body">
        ${showcaseRibbon(showcase)}
        <div class="ac-chest-main">
          <h2 class="ac-chest-name"><a href="${href}">${escapeHtml(chest.name)}</a></h2>
          <span class="ac-show-era">${escapeHtml(chest.subtitle || showcase.era)}</span>
          <span class="ac-chest-code"><span class="adm-mono">${escapeHtml(chest.id)}</span> · ${escapeHtml(chest.keyName)}</span>
          <span>${chest.active ? pill('Đang bán', 'ok', { dot: true, small: true }) : pill('Đang tắt', '', { dot: true, small: true })}</span>
        </div>
        ${factsHtml(chest, ratio)}
        ${actionsHtml(chest, href)}
      </div>
    </article>`;
}

function cardHtml(chest) {
  const ratio = chest.cost > 0 ? (chest.expectedValue * 100) / chest.cost : 0;
  const href = `/admin/chests/${encodeURIComponent(chest.id)}`;
  const showcase = showcaseOf(chest);
  if (showcase) return showcaseCardHtml(chest, showcase, ratio, href);
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
      ${factsHtml(chest, ratio)}
      ${actionsHtml(chest, href)}
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
      <div class="ac-list-head">
        <p class="ac-lead">Tạo hòm mới từ đầu, hoặc nhân bản một hòm có sẵn rồi sửa tiếp.</p>
        <a class="btn btn-primary" href="/admin/chests/${NEW_CHEST}" data-ac-new>${icon('plus', 16)}Tạo hòm mới</a>
      </div>
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
