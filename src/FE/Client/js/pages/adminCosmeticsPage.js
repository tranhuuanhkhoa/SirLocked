import '../../../css/48-cosmetics.css';
import { adminCosmeticsApi } from '../api/adminCosmeticsApi.js';
import { icon, pill, rarityPill, segTabs, stateBox } from '../components/admin/ui.js';
import { applyCosmetic, prepareCosmetics } from '../cosmetics/index.js';
import { escapeHtml, render } from '../utils/dom.js';
import { mountEntranceEditor } from './admin/cosmetics/entranceEditor.js';
import { mountFrameEditor } from './admin/cosmetics/frameEditor.js';
import { mountGrid } from './admin/cosmetics/grid.js';
import { CATEGORIES, catalogEntryOf, categoryOf, errorText, rarityLabel, tabOf } from './admin/cosmetics/shared.js';
import { mountTitleEditor } from './admin/cosmetics/titleEditor.js';
import { mountGrantTool, mountXpTool } from './admin/cosmetics/tools.js';

const NEW = 'new';
const TOOLS = [{ id: 'grant', label: 'Cấp cho người chơi' }, { id: 'xp', label: 'Thiết lập KN' }];
const EDITORS = { FRAME: mountFrameEditor, TITLE: mountTitleEditor, ENTRANCE: mountEntranceEditor };

const queryOf = () => new URLSearchParams(window.location.search);

/** The area's title and its tab tray, as in the design: Viền · Danh hiệu · Hiệu ứng vào sảnh · Cấp cho người chơi · Thiết lập KN. */
const headHtml = (active) => `
  <div class="acf-head">
    <h1>Mỹ phẩm</h1>
    ${segTabs([...CATEGORIES, ...TOOLS].map((tab) => ({ label: tab.label, href: `/admin/cosmetics?tab=${tab.id}`, active: tab.id === active })), 'Khu mỹ phẩm')}
  </div>`;

const problemsHtml = (problems) => (problems.length === 0 ? '' : `
  <details class="acf-problems">
    <summary>Dữ liệu danh mục có ${problems.length} chỗ không khớp</summary>
    <ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>
  </details>`);

/** /admin/cosmetics (?tab=FRAME|TITLE|ENTRANCE|grant|xp), /admin/cosmetics/:defId and /admin/cosmetics/new?type=FRAME. */
export async function renderAdminCosmeticsPage(app, defId, { signal } = {}) {
  prepareCosmetics();
  const listing = !defId;
  const tab = tabOf(queryOf().get('tab'));
  const frame = (body) => `<div class="page acf-page">${listing ? headHtml(tab) : ''}${body}</div>`;
  render(app, frame(stateBox('loading', 'Đang tải mỹ phẩm…')));

  let page;
  try {
    page = await adminCosmeticsApi.list();
  } catch (error) {
    if (signal?.aborted) return undefined;
    render(app, frame(stateBox('error', 'Không tải được mỹ phẩm', errorText(error))));
    return undefined;
  }
  if (signal?.aborted) return undefined;
  for (const item of page.items) applyCosmetic(catalogEntryOf(item));

  let cleanup = null;
  const mount = (mounter, host, options) => {
    cleanup?.();
    cleanup = mounter(host, options);
  };
  const leave = () => { cleanup?.(); cleanup = null; };
  signal?.addEventListener('abort', leave, { once: true });

  if (listing) {
    render(app, frame(`
      ${problemsHtml(page.problems)}
      <div class="acf-tab-body" data-tab-body></div>`));
    const host = app.querySelector('[data-tab-body]');
    if (tab === 'grant') mount(mountGrantTool, host, { page, defId: queryOf().get('def') });
    else if (tab === 'xp') mount(mountXpTool, host, { page });
    else mount(mountGrid, host, { page, category: tab });
    return leave;
  }

  const creating = decodeURIComponent(defId) === NEW;
  const found = creating ? null : page.items.find((item) => item.id === decodeURIComponent(defId));
  const category = creating ? queryOf().get('type') : found?.category;
  if (!EDITORS[category]) {
    render(app, `
      <div class="page acf-page">
        <a class="adm-back-link acf-back" href="/admin/cosmetics">${icon('arrowLeft', 16)}Về danh sách mỹ phẩm</a>
        ${stateBox('empty', 'Không tìm thấy mỹ phẩm này.', 'Món có thể đã bị xóa, hoặc địa chỉ bị gõ sai.')}
      </div>`);
    return leave;
  }

  /** Saving redraws the editor from what the server now holds, so the page never shows what was not stored. */
  const show = (item) => {
    const kind = categoryOf(category);
    render(app, `
      <div class="page acf-page acf-detail">
        <a class="adm-back-link acf-back" href="/admin/cosmetics?tab=${category}">${icon('arrowLeft', 16)}Về danh sách ${escapeHtml(kind.noun)}</a>
        <div class="acf-detail-head">
          <span class="adm-eyebrow">${escapeHtml(kind.label)}</span>
          <div class="acf-detail-name">
            <h1>${item ? escapeHtml(item.name) : `Tạo ${escapeHtml(kind.label.toLowerCase())} mới`}</h1>
            ${item ? '<span class="acf-detail-pills" data-editor-pills></span>' : ''}
          </div>
          <p class="acf-detail-sub"${item ? ' data-editor-meta' : ''}>${item ? '' : 'Đặt tên, độ hiếm và hình rồi bấm Tạo. Tạo xong mới đặt được cách nhận.'}</p>
        </div>
        <div data-editor></div>
      </div>`);
    const writeMeta = (current) => {
      const meta = app.querySelector('[data-editor-meta]');
      if (meta) meta.innerHTML = `<code class="adm-mono">${escapeHtml(current.id)}</code> · phiên bản ${current.version} · ${Number(current.owners ?? 0).toLocaleString('vi-VN')} người sở hữu`;
      const pills = app.querySelector('[data-editor-pills]');
      if (pills) {
        pills.innerHTML = [
          rarityPill(current.rarity, rarityLabel(current.rarity)),
          current.retired ? pill('Đã retire', 'bad', { dot: true, small: true }) : pill('Đang phát hành', 'ok', { dot: true, small: true }),
          current.tradable ? '' : pill('Không giao dịch', '', { small: true }),
        ].join('');
      }
    };
    if (item) writeMeta(item);
    const remember = (saved) => {
      page.items = page.items.map((other) => (other.id === saved.id ? saved : other));
      applyCosmetic(catalogEntryOf(saved));
      writeMeta(saved);
    };
    mount(EDITORS[category], app.querySelector('[data-editor]'), {
      item,
      page,
      onChanged: remember,
      onSaved: (saved) => {
        remember(saved);
        show(saved);
      },
    });
  };
  show(found);
  return leave;
}
