import '../../../css/48-cosmetics.css';
import { adminCosmeticsApi } from '../api/adminCosmeticsApi.js';
import { applyCosmetic, prepareCosmetics } from '../cosmetics/index.js';
import { escapeHtml, render } from '../utils/dom.js';
import { mountEntranceEditor } from './admin/cosmetics/entranceEditor.js';
import { mountFrameEditor } from './admin/cosmetics/frameEditor.js';
import { mountGrid } from './admin/cosmetics/grid.js';
import { CATEGORIES, catalogEntryOf, errorText, rarityLabel } from './admin/cosmetics/shared.js';
import { mountTitleEditor } from './admin/cosmetics/titleEditor.js';
import { mountGrantTool, mountXpTool } from './admin/cosmetics/tools.js';

const NEW = 'new';
const TOOLS = [{ id: 'grant', label: 'Cấp cho người chơi' }, { id: 'xp', label: 'Thiết lập KN' }];
const EDITORS = { FRAME: mountFrameEditor, TITLE: mountTitleEditor, ENTRANCE: mountEntranceEditor };

const queryOf = () => new URLSearchParams((window.location.hash.split('?')[1]) ?? '');

const tabsHtml = (active) => `
  <nav class="acf-tabs" aria-label="Khu mỹ phẩm">
    ${[...CATEGORIES, ...TOOLS].map((tab) => `<a class="acf-tab${tab.id === active ? ' is-active' : ''}" href="#/admin/cosmetics?tab=${tab.id}"${tab.id === active ? ' aria-current="page"' : ''}>${escapeHtml(tab.label)}</a>`).join('')}
  </nav>`;

const problemsHtml = (problems) => (problems.length === 0 ? '' : `
  <details class="notice notice-bad acf-problems">
    <summary>Dữ liệu danh mục có ${problems.length} chỗ không khớp</summary>
    <ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>
  </details>`);

/** #/admin/cosmetics (?tab=FRAME|TITLE|ENTRANCE|grant|xp), #/admin/cosmetics/:defId and #/admin/cosmetics/new?type=FRAME. */
export async function renderAdminCosmeticsPage(app, defId, { signal } = {}) {
  prepareCosmetics();
  render(app, '<div class="page acf-page"><p class="muted">Đang tải mỹ phẩm…</p></div>');

  let page;
  try {
    page = await adminCosmeticsApi.list();
  } catch (error) {
    if (signal?.aborted) return undefined;
    render(app, `<div class="page acf-page"><div class="empty-state">${escapeHtml(errorText(error))}</div></div>`);
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

  if (!defId) {
    const tab = queryOf().get('tab') ?? 'FRAME';
    render(app, `
      <div class="page acf-page">
        <h2>Mỹ phẩm</h2>
        ${problemsHtml(page.problems)}
        ${tabsHtml(tab)}
        <div data-tab-body></div>
      </div>`);
    const host = app.querySelector('[data-tab-body]');
    if (tab === 'grant') mount(mountGrantTool, host, { page, defId: queryOf().get('def') });
    else if (tab === 'xp') mount(mountXpTool, host, { page });
    else mount(mountGrid, host, { page, category: EDITORS[tab] ? tab : 'FRAME' });
    return leave;
  }

  const creating = decodeURIComponent(defId) === NEW;
  const found = creating ? null : page.items.find((item) => item.id === decodeURIComponent(defId));
  const category = creating ? queryOf().get('type') : found?.category;
  if (!EDITORS[category]) {
    render(app, `<div class="page acf-page"><div class="empty-state">Không tìm thấy mỹ phẩm này.</div><p><a class="btn btn-ghost" href="#/admin/cosmetics">Về danh sách</a></p></div>`);
    return leave;
  }

  /** Saving redraws the editor from what the server now holds, so the page never shows what was not stored. */
  const show = (item) => {
    const label = CATEGORIES.find((entry) => entry.id === category)?.label ?? '';
    render(app, `
      <div class="page acf-page">
        <p><a href="#/admin/cosmetics?tab=${category}">‹ ${escapeHtml(label)}</a></p>
        <h2>${item ? escapeHtml(item.name) : `Tạo ${escapeHtml(label.toLowerCase())} mới`}</h2>
        ${item ? `<p class="muted small" data-editor-meta></p>` : ''}
        <div data-editor></div>
      </div>`);
    const writeMeta = (current) => {
      const meta = app.querySelector('[data-editor-meta]');
      if (meta) meta.innerHTML = `<code>${escapeHtml(current.id)}</code> · ${escapeHtml(rarityLabel(current.rarity))} · phiên bản ${current.version}`;
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
