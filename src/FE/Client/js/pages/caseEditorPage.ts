/**
 * Case Studio (/admin/editor/:caseId): the owner opens a case the bot imported, fixes what is off — where NPCs, item
 * boxes, clue zones and doors sit, the walk grid, evidence texts, dialogue, an NPC's face from the library, missing
 * hints — and publishes it only from here, after looking at it. Every change autosaves to the server as a new editor
 * version and is validated there; numbered copies can be restored. See docs/case-studio.md.
 */
import { caseEditorApi } from '../api/caseEditorApi.js';
import { aiCaseApi } from '../api/aiCaseApi.js';
import { navigate } from '../services/navigation.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { icon } from '../components/admin/icons.js';
import { SceneCanvas, type Overlays } from '../editor/canvas';
import {
  KIND_LABEL, RUNTIME_SIZE, addHint, changedSections, characterLines, createHistory, deleteEvidence, evidenceDependencies,
  findScene, getGeometry, hintIssues, hintTargets, hintsFor, hitTest, missingHintLevels, issueTarget, issuesByObject, libraryLook, objectKey, onResizeHandle,
  orderedScenes, paintGrid, parseHintIssue, reachability, readPath, removeHint, resizeGeometry, sceneGrid, sceneObjects,
  sceneProfile, setGeometry, snap, swapNpcLook, translateGeometry, writeText,
  type Geometry, type LibraryNpc, type ObjectKind, type ObjectRef, type Reachability,
} from '../editor/model';

type Tab = 'object' | 'evidence' | 'lines' | 'check' | 'history';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'stale' | 'readonly';
type Drag =
  | { mode: 'move' | 'resize'; ref: ObjectRef; start: Geometry; from: { x: number; y: number }; changed: boolean }
  | { mode: 'pan'; clientX: number; clientY: number; ox: number; oy: number }
  | { mode: 'paint'; value: '0' | '1'; changed: number }
  | null;

const AUTOSAVE_MS = 1500;
const TEXT_COMMIT_MS = 700;
const LONG_LINE = 280;
const KIND_ORDER: ObjectKind[] = ['npc', 'item', 'clue', 'door', 'spawn'];
const REVISION_KIND: Record<string, string> = {
  ORIGINAL: 'Bản bot nhập', CHECKPOINT: 'Phiên bản', BEFORE_RESTORE: 'Trước khi khôi phục', PUBLISH: 'Đã xuất bản',
  BEFORE_IMPORT: 'Bản sửa trước khi nhập lại',
};

export async function renderCaseEditorPage(app: HTMLElement, caseId: string, { signal }: { signal: AbortSignal }) {
  render(app, `<div class="page cse-page"><div class="adm-state adm-loading" role="status"><strong>Đang mở Case Studio…</strong></div></div>`);

  let data: any;
  try {
    data = await caseEditorApi.open(caseId);
  } catch (error) {
    if (signal.aborted) return;
    render(app, `<div class="page cse-page">
      <a class="adm-back-link" href="/admin/ai">${icon('arrowLeft', 16)}Tạo vụ án AI</a>
      <div class="adm-state adm-state--error" role="alert"><strong>Không mở được vụ này trong editor.</strong>
      <span>${escapeHtml(error?.status === 404 ? 'Không có vụ án này.' : error?.message || 'Lỗi không rõ.')}</span></div></div>`);
    return;
  }
  if (signal.aborted) return;

  /* ------------------------------------------------------------ state */

  let gameCase: any = data.case;
  let version: number = data.version;
  let canEdit: boolean = Boolean(data.canEdit);
  let validation = data.validation ?? { canPublish: false, errors: [], warnings: [] };
  let revisions: any[] = data.revisions ?? [];
  let sceneId: string = orderedScenes(gameCase)[0]?.sceneId ?? '';
  let selected: ObjectRef | null = null;
  let hoverKey: string | null = null;
  let tool: 'select' | 'floor' | 'wall' = 'select';
  let brush = 3;
  const overlays: Overlays = { boxes: true, labels: true, grid: false, reach: false };
  let reach: Reachability | null = null;
  let tab: Tab = 'object';
  let linesCharacter = '';
  let saveState: SaveState = canEdit ? 'saved' : 'readonly';
  let saveMessage = '';
  let changeCount = 0;
  let savedChangeCount = 0;
  let saving: Promise<void> | null = null;
  let autosaveTimer = 0;
  let textTimer = 0;
  let drag: Drag = null;
  let brushAt: { x: number; y: number } | null = null;
  let library: LibraryNpc[] | null = null;
  let libraryError = '';
  let libraryQuery = '';
  let disposed = false;
  const history = createHistory(JSON.stringify(gameCase));

  const scene = () => findScene(gameCase, sceneId);
  const allIssues = () => [...(validation.errors ?? []), ...(validation.warnings ?? [])];
  const isDirty = () => changeCount !== savedChangeCount;

  render(app, `
    <div class="page cse-page${canEdit ? '' : ' is-readonly'}">
      <header class="cse-head">
        <div class="cse-head-main">
          <a class="adm-back-link" href="${data.sourceAiDraftId ? '/admin/ai' : `/admin/cases/${encodeURIComponent(caseId)}`}">${icon('arrowLeft', 16)}${data.sourceAiDraftId ? 'Tạo vụ án AI' : 'Vụ án'}</a>
          <span class="adm-eyebrow" id="cse-eyebrow"></span>
          <h1 class="cse-title" id="cse-title"></h1>
        </div>
        <p class="cse-save" id="cse-save" role="status" aria-live="polite"></p>
        <div class="cse-actions">
          <button type="button" class="btn btn-sm" id="cse-undo" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button>
          <button type="button" class="btn btn-sm" id="cse-redo" title="Làm lại (Ctrl+Y)" aria-label="Làm lại">↷</button>
          <button type="button" class="btn btn-sm" id="cse-checkpoint">Lưu phiên bản</button>
          <button type="button" class="btn btn-sm" id="cse-playtest">Chơi thử cảnh này</button>
          <button type="button" class="btn btn-primary btn-sm" id="cse-publish">Duyệt &amp; xuất bản</button>
        </div>
      </header>
      <div id="cse-banner"></div>
      <div class="cse-body">
        <aside class="cse-left" aria-label="Cảnh và đối tượng">
          <h2 class="cse-side-title">Cảnh</h2>
          <div id="cse-scenes" class="cse-scenes"></div>
          <h2 class="cse-side-title">Trong cảnh</h2>
          <div id="cse-objects" class="cse-objects"></div>
        </aside>
        <section class="cse-stage" aria-label="Khung cảnh">
          <div class="cse-toolbar" role="toolbar" aria-label="Công cụ">
            <div class="cse-tools" role="group" aria-label="Công cụ vẽ">
              <button type="button" class="cse-tool" data-tool="select" title="Chọn và kéo (V)">Chọn &amp; kéo</button>
              <button type="button" class="cse-tool" data-tool="floor" title="Tô ô đi được (B)">Vẽ lối đi</button>
              <button type="button" class="cse-tool" data-tool="wall" title="Tô ô chặn (N)">Vẽ vật cản</button>
              <label class="cse-brush">Cọ <select id="cse-brush" aria-label="Cỡ cọ">
                ${[1, 3, 5, 9, 15].map((size) => `<option value="${size}"${size === brush ? ' selected' : ''}>${size}×${size} ô</option>`).join('')}
              </select></label>
            </div>
            <div class="cse-tools" role="group" aria-label="Lớp phủ">
              <label><input type="checkbox" data-overlay="boxes" checked> Khung</label>
              <label><input type="checkbox" data-overlay="labels" checked> Nhãn</label>
              <label><input type="checkbox" data-overlay="grid"> Lưới đi</label>
              <button type="button" class="btn btn-sm" id="cse-reach">Kiểm đường đi</button>
            </div>
            <div class="cse-tools" role="group" aria-label="Thu phóng">
              <button type="button" class="btn btn-sm" data-zoom="out" aria-label="Thu nhỏ">−</button>
              <button type="button" class="btn btn-sm" data-zoom="fit">Vừa khung</button>
              <button type="button" class="btn btn-sm" data-zoom="in" aria-label="Phóng to">+</button>
            </div>
          </div>
          <div class="cse-canvas-wrap" id="cse-wrap">
            <canvas id="cse-canvas" aria-label="Cảnh đang sửa" tabindex="0"></canvas>
          </div>
          <p class="cse-reach-result" id="cse-reach-result" role="status" aria-live="polite"></p>
        </section>
        <aside class="cse-right" aria-label="Bảng sửa">
          <nav class="adm-seg cse-tabs" aria-label="Bảng" id="cse-tabs"></nav>
          <div id="cse-panel" class="cse-panel"></div>
        </aside>
      </div>
    </div>`);

  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => app.querySelector(selector) as T;
  const canvasElement = $<HTMLCanvasElement>('#cse-canvas');
  const view = new SceneCanvas(canvasElement);
  view.onImageReady = () => draw();

  /* ------------------------------------------------------------ rendering */

  function draw() {
    if (disposed) return;
    const current = scene();
    view.draw(gameCase, current, {
      overlays,
      selected: selected ? objectKey(selected) : null,
      hover: hoverKey,
      issues: current ? issuesByObject(gameCase, validation.errors, sceneId) : new Map(),
      reach: overlays.reach ? reach : null,
      brush: tool !== 'select' && brushAt && canEdit ? { ...brushAt, cells: brush, value: tool === 'floor' ? '1' : '0' } : null,
    });
  }

  function renderHeader() {
    $('#cse-title').textContent = gameCase.title || caseId;
    $('#cse-eyebrow').textContent = `Case Studio · ${canEdit ? 'bản nháp' : data.status === 'PUBLISHED' ? 'đã xuất bản, chỉ xem' : 'chỉ xem'}`;
    $('.cse-page').classList.toggle('is-readonly', !canEdit);
    const errors = validation.errors?.length ?? 0;
    const save = $('#cse-save');
    const text: Record<SaveState, string> = {
      saved: 'Đã lưu',
      dirty: 'Chưa lưu…',
      saving: 'Đang lưu…',
      error: saveMessage || 'Lưu không được',
      stale: 'Có bản mới hơn',
      readonly: 'Chỉ xem',
    };
    save.textContent = `${text[saveState]} · bản ${version}`;
    save.dataset.state = saveState;
    ($('#cse-undo') as HTMLButtonElement).disabled = !canEdit || !history.canUndo();
    ($('#cse-redo') as HTMLButtonElement).disabled = !canEdit || !history.canRedo();
    ($('#cse-checkpoint') as HTMLButtonElement).disabled = !canEdit || saveState === 'stale';
    const playtest = $('#cse-playtest') as HTMLButtonElement;
    playtest.disabled = !data.canPlaytest || saveState === 'stale';
    playtest.title = data.canPlaytest
      ? 'Mở phòng chơi thử riêng, hai thám tử bắt đầu ở cảnh đang mở'
      : 'Chỉ vụ do bot làm (có bản nháp AI) mới có phòng chơi thử';
    const publish = $('#cse-publish') as HTMLButtonElement;
    publish.disabled = !canEdit || !validation.canPublish || saveState !== 'saved';
    publish.textContent = !canEdit ? 'Đã xuất bản' : errors > 0 ? `Còn ${errors} lỗi` : 'Duyệt & xuất bản';
    publish.title = errors > 0 ? 'Sửa hết lỗi ở bảng Kiểm tra trước khi xuất bản'
      : saveState !== 'saved' ? 'Chờ lưu xong' : 'Bạn duyệt vụ này và đưa lên cho người chơi';
  }

  function renderBanner() {
    const banner = $('#cse-banner');
    if (!canEdit) {
      banner.innerHTML = `<div class="notice notice-warn" role="status">${data.status === 'PUBLISHED'
        ? 'Vụ đã xuất bản nên chỉ xem được. Muốn sửa: gỡ xuất bản ở Quản lý vụ án, rồi mở lại đây.'
        : 'Vụ này chỉ xem được trong editor (màn tân thủ được nạp lại từ file JSON trong repo).'}</div>`;
    } else if (saveState === 'stale') {
      banner.innerHTML = `<div class="notice notice-bad" role="alert">Vụ vừa được lưu ở nơi khác${saveMessage ? ` (${escapeHtml(saveMessage)})` : ''}. Thay đổi chưa lưu ở đây sẽ không ghi đè lên bản đó.
        <button type="button" class="btn btn-sm" id="cse-reload">Tải bản mới nhất</button></div>`;
    } else if (saveState === 'error') {
      banner.innerHTML = `<div class="notice notice-bad" role="alert">${escapeHtml(saveMessage || 'Lưu không được.')} Editor sẽ thử lại ở thay đổi kế tiếp.
        <button type="button" class="btn btn-sm" id="cse-retry">Thử lưu lại</button></div>`;
    } else {
      banner.innerHTML = '';
    }
  }

  function renderScenes() {
    const errorsByScene = new Map<string, number>();
    for (const issue of validation.errors ?? []) {
      const target = issueTarget(gameCase, issue);
      const id = 'sceneId' in target ? target.sceneId : '';
      if (id) errorsByScene.set(id, (errorsByScene.get(id) ?? 0) + 1);
    }
    $('#cse-scenes').innerHTML = orderedScenes(gameCase).map((entry) => {
      const count = errorsByScene.get(entry.sceneId) ?? 0;
      return `<button type="button" class="cse-scene${entry.sceneId === sceneId ? ' is-active' : ''}" data-scene="${escapeHtml(entry.sceneId)}"
        aria-pressed="${entry.sceneId === sceneId}">
        <span>${escapeHtml(entry.title || entry.sceneId)}</span>
        <small>${escapeHtml(sceneProfile(entry).projection === 'topdown' ? 'ngoài trời' : 'trong nhà')}</small>
        ${count ? `<span class="cse-badge" title="${count} lỗi">${count}</span>` : ''}
      </button>`;
    }).join('');
  }

  function renderObjects() {
    const current = scene();
    const objects = current ? sceneObjects(gameCase, current) : [];
    const marks = current ? issuesByObject(gameCase, validation.errors, sceneId) : new Map();
    const groups = KIND_ORDER.map((kind) => {
      const list = objects.filter((object) => object.kind === kind);
      if (list.length === 0) return '';
      return `<div class="cse-group"><h3>${escapeHtml(KIND_LABEL[kind])} <small>${list.length}</small></h3>
        ${list.map((object) => {
    const key = objectKey(object);
    const bad = marks.has(key) || Boolean(overlays.reach && reach?.unreachable.has(key));
    return `<button type="button" class="cse-object cse-object--${object.kind}${selected && objectKey(selected) === key ? ' is-active' : ''}${bad ? ' is-bad' : ''}"
            data-object="${escapeHtml(key)}">${bad ? '<span class="cse-dot" aria-label="có lỗi"></span>' : ''}${escapeHtml(object.label)}</button>`;
  }).join('')}</div>`;
    }).join('');
    $('#cse-objects').innerHTML = groups || '<p class="cse-muted">Cảnh này chưa có đối tượng.</p>';
  }

  function renderTabs() {
    const errors = validation.errors?.length ?? 0;
    const items: [Tab, string][] = [['object', 'Đối tượng'], ['evidence', 'Bằng chứng'], ['lines', 'Lời thoại'], ['check', 'Kiểm tra'], ['history', 'Lịch sử']];
    $('#cse-tabs').innerHTML = items.map(([key, label]) => `<button type="button" data-tab="${key}" aria-pressed="${tab === key}"${tab === key ? ' class="is-active"' : ''}>
      ${escapeHtml(label)}${key === 'check' ? ` <span class="adm-count${errors ? ' cse-count-bad' : ''}">${errors}</span>` : ''}</button>`).join('');
  }

  /** Re-renders the right panel unless the owner is typing in it (the text would lose focus). */
  function renderPanel(force = false) {
    const panel = $('#cse-panel');
    if (!force && panel.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement!.tagName)) return;
    const html = tab === 'object' ? objectPanel()
      : tab === 'evidence' ? evidencePanel()
        : tab === 'lines' ? linesPanel()
          : tab === 'check' ? checkPanel()
            : historyPanel();
    panel.innerHTML = html;
    panel.querySelectorAll('input, textarea, select, button').forEach((element) => {
      if (!canEdit && !(element as HTMLElement).dataset.readonlyOk) (element as HTMLInputElement).disabled = true;
    });
    if (tab === 'lines') updatePreview();
  }

  function renderAll() {
    renderHeader();
    renderBanner();
    renderScenes();
    renderObjects();
    renderTabs();
    renderPanel();
    renderToolbar();
    draw();
  }

  function renderToolbar() {
    app.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.tool === tool);
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
      if (button.dataset.tool !== 'select') button.disabled = !canEdit || !sceneGrid(scene());
    });
    ($('#cse-brush') as HTMLSelectElement).disabled = !canEdit || tool === 'select';
    app.querySelectorAll<HTMLInputElement>('[data-overlay]').forEach((input) => {
      input.checked = Boolean(overlays[input.dataset.overlay as keyof Overlays]);
    });
    const reachButton = $('#cse-reach');
    reachButton.classList.toggle('is-active', overlays.reach);
    reachButton.setAttribute('aria-pressed', String(overlays.reach));
    const result = $('#cse-reach-result');
    if (!overlays.reach || !reach) { result.textContent = ''; result.dataset.state = ''; return; }
    if (!reach.checked) {
      result.textContent = 'Cảnh này không có lưới đi pixel nên không kiểm được.';
      result.dataset.state = 'warn';
    } else if (!reach.spawnOk) {
      result.textContent = 'Điểm xuất hiện mặc định không đứng trên ô đi được: người chơi kẹt ngay khi vào cảnh.';
      result.dataset.state = 'bad';
    } else if (reach.unreachable.size > 0) {
      result.textContent = `${reach.unreachable.size} chỗ người chơi không đi tới được (tô đỏ). Kéo chúng ra sàn hoặc vẽ thêm lối đi.`;
      result.dataset.state = 'bad';
    } else {
      result.textContent = 'Mọi NPC, vật phẩm, cửa và điểm xuất hiện đều đi tới được.';
      result.dataset.state = 'ok';
    }
  }

  /* ------------------------------------------------------------ panels */

  function boxInputs(geometry: Geometry, resizable: boolean) {
    const field = (name: string, label: string, value: number, enabled = true) => `<label class="cse-num">${label}
      <input type="number" step="4" min="0" max="${RUNTIME_SIZE}" data-geo="${name}" value="${Math.round(value)}"${enabled ? '' : ' disabled'}></label>`;
    return `<div class="cse-geo">
      ${field('x', 'x', geometry.box.x)}${field('y', 'y', geometry.box.y)}
      ${field('width', 'rộng', geometry.box.width, resizable)}${field('height', 'cao', geometry.box.height, resizable)}
    </div>`;
  }

  function issueList(issues: any[]) {
    if (!issues.length) return '';
    return `<ul class="cse-issues">${issues.map((issue) => `<li><code>${escapeHtml(issue.code)}</code> ${escapeHtml(issue.message)}</li>`).join('')}</ul>`;
  }

  function objectPanel() {
    const current = scene();
    if (!current) return '<p class="cse-muted">Vụ chưa có cảnh.</p>';
    if (!selected) {
      const profile = sceneProfile(current);
      const objects = sceneObjects(gameCase, current);
      return `<div class="cse-card">
        <h3>${escapeHtml(current.title || current.sceneId)}</h3>
        <p class="cse-muted"><code>${escapeHtml(current.sceneId)}</code> · ${profile.projection === 'topdown' ? 'ngoài trời (topdown, NPC ×1.5)' : 'trong nhà (isometric, NPC ×4)'}</p>
        <p>${objects.filter((object) => object.kind === 'npc').length} NPC · ${objects.filter((object) => object.kind === 'item').length} vật phẩm ·
          ${objects.filter((object) => object.kind === 'clue').length} manh mối · ${objects.filter((object) => object.kind === 'door').length} cửa</p>
        <p class="cse-help">Bấm một khung trên cảnh (hoặc ở danh sách bên trái) để sửa. Kéo để dời, kéo góc dưới phải để đổi cỡ.
          Mọi vị trí bám lưới 4 đơn vị (1 pixel gốc). Mũi tên dời 4, Shift + mũi tên dời 16.</p>
        ${sceneGrid(current) ? '<p class="cse-help">Vẽ lối đi / vật cản tô trực tiếp lên lưới 128×128 ô của cảnh (bật "Lưới đi" để thấy).</p>' : '<p class="cse-help">Cảnh này không có lưới đi pixel.</p>'}
      </div>`;
    }
    const geometry = getGeometry(current, selected);
    if (!geometry) return '<p class="cse-muted">Đối tượng không còn trong cảnh.</p>';
    const key = objectKey(selected);
    const issues = issuesByObject(gameCase, allIssues(), sceneId).get(key) ?? [];
    const unreachable = overlays.reach && reach?.unreachable.has(key)
      ? '<p class="notice notice-bad">Người chơi không đi tới được chỗ này từ điểm xuất hiện.</p>' : '';
    const object = sceneObjects(gameCase, current).find((entry) => objectKey(entry) === key)!;
    let extra = '';
    if (selected.kind === 'npc') extra = npcExtra(selected.id);
    if (selected.kind === 'door') {
      const door = current.runtime.transitions.find((entry) => entry.targetSceneId === selected!.id);
      extra = `<label class="cse-field">Chữ trên cửa<input type="text" data-text="door-label" value="${escapeHtml(door?.label ?? '')}"></label>
        <p class="cse-muted">Dẫn tới: ${escapeHtml(findScene(gameCase, selected.id)?.title ?? selected.id)}</p>`;
    }
    if (selected.kind === 'clue') {
      const zone = current.runtime.clueZones.find((entry) => entry.clueId === selected!.id);
      extra = `<label class="cse-field">Nhãn vùng manh mối<input type="text" data-text="zone-label" value="${escapeHtml(zone?.label ?? '')}"></label>
        <button type="button" class="btn btn-sm" data-goto-evidence="clue:${escapeHtml(selected.id)}" data-readonly-ok="1">Xem manh mối ở tab Bằng chứng</button>`;
    }
    if (selected.kind === 'item') {
      extra = `<button type="button" class="btn btn-sm" data-goto-evidence="item:${escapeHtml(selected.id)}" data-readonly-ok="1">Sửa chữ vật phẩm ở tab Bằng chứng</button>`;
    }
    if (selected.kind === 'spawn') {
      extra = '<p class="cse-help">Điểm xuất hiện là chỗ đặt chân của thám tử khi vào cảnh. Điểm "default" phải đứng trên lối đi.</p>';
    }
    return `<div class="cse-card">
      <span class="adm-eyebrow">${escapeHtml(KIND_LABEL[selected.kind])}</span>
      <h3>${escapeHtml(object.label)}</h3>
      <p class="cse-muted"><code>${escapeHtml(selected.id)}</code></p>
      ${unreachable}${issueList(issues)}
      ${selected.kind === 'spawn' || selected.kind === 'npc'
    ? `${selected.kind === 'npc' ? '<p class="cse-muted">Vị trí chân NPC (khung nói đi theo)</p>' : ''}<div class="cse-geo">
          <label class="cse-num">x<input type="number" step="4" data-geo="px" value="${Math.round(geometry.point!.x)}"></label>
          <label class="cse-num">y<input type="number" step="4" data-geo="py" value="${Math.round(geometry.point!.y)}"></label></div>`
    : boxInputs(geometry, object.resizable)}
      ${extra}
    </div>`;
  }

  function npcExtra(characterId: string) {
    const character = (gameCase.characters ?? []).find((entry) => entry.characterId === characterId);
    if (!character) return '';
    const portrait = character.imageUrl ? `<img class="cse-portrait" src="${escapeHtml(character.imageUrl)}" alt="">` : '';
    const placement = scene()?.runtime?.characterPlacements?.find((entry) => entry.characterId === characterId);
    const list = (library ?? []).filter((entry) => libraryLook(entry))
      .filter((entry) => !libraryQuery || `${entry.nameVi} ${entry.nameEn} ${entry.key} ${(entry.tags ?? []).join(' ')}`.toLowerCase().includes(libraryQuery.toLowerCase()));
    const libraryHtml = library === null
      ? `<p class="cse-muted">${libraryError ? escapeHtml(libraryError) : 'Đang tải thư viện NPC…'}</p>`
      : list.length === 0
        ? '<p class="cse-muted">Không có NPC nào khớp.</p>'
        : `<div class="cse-library">${list.slice(0, 60).map((entry) => {
          const look = libraryLook(entry)!;
          const current = character.presentation?.spriteSheet?.url === look.idle;
          return `<button type="button" class="cse-npc${current ? ' is-active' : ''}" data-swap="${escapeHtml(entry.key)}" title="${escapeHtml(entry.nameVi || entry.key)}">
            <img src="${escapeHtml(entry.thumbUrl || look.portrait)}" alt="" loading="lazy"><span>${escapeHtml(entry.nameVi || entry.key)}</span></button>`;
        }).join('')}</div>`;
    return `<div class="cse-npc-head">${portrait}<div><strong>${escapeHtml(character.name)}</strong><br><span class="cse-muted">${escapeHtml(character.role || '')}</span></div></div>
      <label class="cse-field">Hướng nhìn<select data-text="npc-direction">
        <option value="left"${placement?.direction !== 'right' ? ' selected' : ''}>Sang trái</option>
        <option value="right"${placement?.direction === 'right' ? ' selected' : ''}>Sang phải</option></select></label>
      <button type="button" class="btn btn-sm" data-goto-lines="${escapeHtml(characterId)}" data-readonly-ok="1">Sửa lời thoại của ${escapeHtml(character.name)}</button>
      <h4 class="cse-sub">Đổi mặt từ thư viện NPC</h4>
      <p class="cse-help">Chỉ đổi ảnh: id, tên, lời khai và mọi lời thoại giữ nguyên.${data.world ? ` Thế giới: ${escapeHtml(data.world)}.` : ''}</p>
      <input type="search" class="cse-search" data-library-search placeholder="Tìm: quản gia, cảnh sát, nữ…" value="${escapeHtml(libraryQuery)}" data-readonly-ok="1">
      ${libraryHtml}`;
  }

  function evidencePanel() {
    const placedIn = (kind: 'item' | 'clue', id: string) => orderedScenes(gameCase)
      .filter((entry) => kind === 'item'
        ? entry.runtime?.itemPlacements?.some((placement) => placement.itemId === id) || (entry.itemIds ?? []).includes(id)
        : entry.runtime?.clueZones?.some((zone) => zone.clueId === id))
      .map((entry) => `<button type="button" class="adm-pill adm-pill--line adm-pill--sm" data-goto-object="${escapeHtml(`${entry.sceneId}|${kind}:${id}`)}" data-readonly-ok="1">${escapeHtml(entry.title || entry.sceneId)}</button>`)
      .join(' ');
    const errorsFor = (kind: 'item' | 'clue', id: string) => (validation.errors ?? []).filter((issue) => {
      const target = issueTarget(gameCase, issue);
      return target.type === 'evidence' && target.kind === kind && target.id === id;
    });
    const items = (gameCase.items ?? []).map((item, index) => `
      <article class="cse-card cse-evidence" id="cse-ev-item-${escapeHtml(item.itemId)}">
        <span class="adm-eyebrow">Vật phẩm${item.isCollectible ? ' · nhặt được' : ''}</span>
        <label class="cse-field">Tên<input type="text" data-path="items[${index}].name" value="${escapeHtml(item.name)}"></label>
        <label class="cse-field">Mô tả<textarea rows="2" data-path="items[${index}].description">${escapeHtml(item.description)}</textarea></label>
        ${typeof item.inspectText === 'string' ? `<label class="cse-field">Khi xem kỹ<textarea rows="2" data-path="items[${index}].inspectText">${escapeHtml(item.inspectText)}</textarea></label>` : ''}
        <p class="cse-muted"><code>${escapeHtml(item.itemId)}</code> · Ở: ${placedIn('item', item.itemId) || 'chưa đặt vào cảnh nào'}</p>
        ${issueList(errorsFor('item', item.itemId))}
        <button type="button" class="btn btn-sm adm-btn-danger" data-delete-evidence="item:${escapeHtml(item.itemId)}">Xóa vật phẩm…</button>
      </article>`).join('');
    const clues = (gameCase.clues ?? []).map((clue, index) => `
      <article class="cse-card cse-evidence" id="cse-ev-clue-${escapeHtml(clue.clueId)}">
        <span class="adm-eyebrow">Manh mối${clue.isCritical ? ' · then chốt' : ''}${clue.isEvidence ? ' · bằng chứng' : ''}${clue.isRedHerring ? ' · đánh lạc hướng' : ''}</span>
        <label class="cse-field">Tiêu đề<input type="text" data-path="clues[${index}].title" value="${escapeHtml(clue.title)}"></label>
        <label class="cse-field">Nội dung<textarea rows="3" data-path="clues[${index}].content">${escapeHtml(clue.content)}</textarea></label>
        <p class="cse-muted"><code>${escapeHtml(clue.clueId)}</code>${placedIn('clue', clue.clueId) ? ` · Vùng ở: ${placedIn('clue', clue.clueId)}` : ''}</p>
        ${issueList(errorsFor('clue', clue.clueId))}
        <button type="button" class="btn btn-sm adm-btn-danger" data-delete-evidence="clue:${escapeHtml(clue.clueId)}">Xóa manh mối…</button>
      </article>`).join('');
    return `<h3 class="cse-sub">Vật phẩm (${gameCase.items?.length ?? 0})</h3>${items || '<p class="cse-muted">Không có.</p>'}
      <h3 class="cse-sub">Manh mối (${gameCase.clues?.length ?? 0})</h3>${clues || '<p class="cse-muted">Không có.</p>'}`;
  }

  function linesPanel() {
    const characters = gameCase.characters ?? [];
    if (!linesCharacter || !characters.some((entry) => entry.characterId === linesCharacter)) {
      linesCharacter = (selected?.kind === 'npc' ? selected.id : '') || characters[0]?.characterId || '';
    }
    const lines = linesCharacter ? characterLines(gameCase, linesCharacter) : [];
    return `<label class="cse-field">Nhân vật<select data-lines-character data-readonly-ok="1">
        ${characters.map((entry) => `<option value="${escapeHtml(entry.characterId)}"${entry.characterId === linesCharacter ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}
      </select></label>
      <div class="cse-preview" id="cse-preview" aria-live="polite"></div>
      ${lines.length === 0 ? '<p class="cse-muted">Nhân vật này chưa có lời thoại.</p>' : lines.map((line) => `
        <label class="cse-field cse-line" data-line-path="${escapeHtml(line.path)}">
          <span>${escapeHtml(line.label)} <small class="cse-count" data-count-for="${escapeHtml(line.path)}">${line.text.length}</small></span>
          <textarea rows="${Math.min(6, Math.max(2, Math.ceil(line.text.length / 60)))}" data-path="${escapeHtml(line.path)}" data-speaker="${escapeHtml(line.speaker)}">${escapeHtml(line.text)}</textarea>
        </label>`).join('')}`;
  }

  let previewPath = '';
  function updatePreview() {
    const preview = app.querySelector('#cse-preview');
    if (!preview) return;
    const character = (gameCase.characters ?? []).find((entry) => entry.characterId === linesCharacter);
    const lines = characterLines(gameCase, linesCharacter);
    const line = lines.find((entry) => entry.path === previewPath) ?? lines.find((entry) => entry.path.endsWith('.answer')) ?? lines[0];
    if (!line) { preview.innerHTML = ''; return; }
    const npcSpeaks = line.speaker !== 'Thám tử';
    const text = String(readPath(gameCase, line.path) ?? '');
    preview.innerHTML = `<div class="cse-bubble${npcSpeaks ? '' : ' is-detective'}">
        ${npcSpeaks && character?.imageUrl ? `<img src="${escapeHtml(character.imageUrl)}" alt="">` : ''}
        <div><strong>${escapeHtml(line.speaker)}</strong><p>${escapeHtml(text) || '<em>(trống)</em>'}</p></div>
      </div>
      <p class="cse-muted">Xem trước: ${escapeHtml(line.label)}${text.length > LONG_LINE ? ` · <span class="cse-warn">dài ${text.length} ký tự, khung thoại sẽ phải cuộn</span>` : ''}</p>`;
  }

  function checkPanel() {
    const errors = validation.errors ?? [];
    const warnings = validation.warnings ?? [];
    const hints = hintIssues(errors);
    const issueTargets = new Map<string, any>();
    for (const issue of hints) {
      const target = parseHintIssue(issue);
      if (target) issueTargets.set(`${target.contextType}:${target.targetId}`, { ...target, messages: [...(issueTargets.get(`${target.contextType}:${target.targetId}`)?.messages ?? []), issue.message] });
    }
    const targetName = (contextType: string, targetId: string) => contextType === 'SCENE'
      ? findScene(gameCase, targetId)?.title || targetId
      : contextType === 'DEDUCTION' ? (gameCase.deductions ?? []).find((entry) => entry.deductionId === targetId)?.prompt || targetId
        : (gameCase.evidenceChallenges ?? []).find((entry) => entry.challengeId === targetId)?.prompt || targetId;
    const levelName = ['', 'Mức 1 · hướng chung', 'Mức 2 · chỗ cần xem', 'Mức 3 · gần đáp án'];
    const targetBlock = (contextType: string, targetId: string, missing: number[]) => `<div class="cse-hint-target">
        <h4>${escapeHtml(contextType)} · ${escapeHtml(targetName(contextType, targetId))}</h4>
        ${hintsFor(gameCase, contextType, targetId).map(({ index, hint }) => `
          <div class="cse-hint-row"><span class="adm-pill adm-pill--sm">Mức ${escapeHtml(String(hint.order))}</span>
            <textarea rows="2" data-path="hints[${index}].text">${escapeHtml(hint.text)}</textarea>
            <button type="button" class="btn btn-sm adm-btn-danger" data-remove-hint="${index}" aria-label="Xóa gợi ý mức ${escapeHtml(String(hint.order))}">×</button></div>`).join('')}
        ${missing.map((order) => `
          <div class="cse-hint-row cse-hint-new"><span class="adm-pill adm-pill--sm adm-pill--bad">${escapeHtml(levelName[order] ?? `Mức ${order}`)}</span>
            <textarea rows="2" data-new-hint="${escapeHtml(`${contextType}|${targetId}|${order}`)}" placeholder="Viết gợi ý mức ${order}…"></textarea>
            <button type="button" class="btn btn-sm btn-primary" data-add-hint="${escapeHtml(`${contextType}|${targetId}|${order}`)}">Thêm</button></div>`).join('')}
      </div>`;
    const hintBlock = issueTargets.size === 0 ? '' : `<section class="cse-card cse-hints">
      <h3>Thiếu gợi ý — chặn xuất bản</h3>
      <p class="cse-help">Mỗi cảnh, đối chất và suy luận cần đủ gợi ý mức 1, 2, 3 (người chơi mua bằng xu/quảng cáo).</p>
      ${[...issueTargets.values()].map((target) => targetBlock(target.contextType, target.targetId, target.missing)).join('')}
    </section>`;
    // Every other hint, so the owner can reword them (and E3 can be tried on a complete case).
    const restTargets = hintTargets(gameCase).filter((target) => !issueTargets.has(`${target.contextType}:${target.targetId}`));
    const allHints = restTargets.length === 0 ? '' : `<details class="cse-card cse-all-hints"${openAllHints ? ' open' : ''}>
      <summary>Tất cả gợi ý (${restTargets.length} câu hỏi đã đủ)</summary>
      ${restTargets.map((target) => targetBlock(target.contextType, target.targetId, missingHintLevels(gameCase, target.contextType, target.targetId))).join('')}
    </details>`;
    const others = errors.filter((issue) => !hints.includes(issue));
    const row = (issue: any, index: number, kind: 'error' | 'warning') => `<li>
      <button type="button" class="cse-issue cse-issue--${kind}" data-issue="${kind}:${index}" data-readonly-ok="1">
        <code>${escapeHtml(issue.code)}</code><span>${escapeHtml(issue.message)}</span><small>${escapeHtml(issue.path || '')}</small>
      </button></li>`;
    return `${validation.canPublish
      ? '<div class="notice notice-ok" role="status">Không còn lỗi. Vụ sẵn sàng để bạn duyệt và xuất bản.</div>'
      : `<div class="notice notice-bad" role="status">${errors.length} lỗi chặn xuất bản.</div>`}
      ${hintBlock}
      ${allHints}
      ${others.length ? `<h3 class="cse-sub">Lỗi (${others.length})</h3><ul class="cse-issue-list">${others.map((issue) => row(issue, errors.indexOf(issue), 'error')).join('')}</ul>` : ''}
      ${warnings.length ? `<h3 class="cse-sub">Cảnh báo, không chặn (${warnings.length})</h3><ul class="cse-issue-list">${warnings.map((issue, index) => row(issue, index, 'warning')).join('')}</ul>` : ''}
      <p class="cse-help">Bấm một dòng để tới đúng chỗ. Server kiểm lại sau mỗi lần lưu, cùng luật với lúc xuất bản.</p>`;
  }

  let openAllHints = false;
  let revisionView: { number: number; html: string } | null = null;
  function historyPanel() {
    return `<p class="cse-help">Editor tự lưu mỗi thay đổi. "Lưu phiên bản" giữ một bản có số để quay lại; bản bot nhập luôn được giữ.</p>
      ${revisionView ? `<div class="cse-card cse-revision-view">${revisionView.html}</div>` : ''}
      <ol class="cse-revisions">${revisions.map((revision) => `<li class="cse-revision">
        <div><strong>#${revision.number} · ${escapeHtml(REVISION_KIND[revision.kind] ?? revision.kind)}</strong>
          ${revision.note ? `<span class="cse-note">${escapeHtml(revision.note)}</span>` : ''}
          <small>${escapeHtml(new Date(revision.createdAt).toLocaleString('vi-VN'))} · ${escapeHtml(revision.createdByName || '')} · ${revision.errorCount} lỗi</small></div>
        <div class="cse-revision-actions">
          <button type="button" class="btn btn-sm" data-view-revision="${revision.number}" data-readonly-ok="1">So sánh</button>
          <button type="button" class="btn btn-sm" data-restore="${revision.number}">Khôi phục</button>
        </div></li>`).join('')}</ol>`;
  }

  /* ------------------------------------------------------------ changes, autosave, undo */

  /** A finished gesture: one undo step, then autosave after a short pause. */
  function commit({ keepPanel = false } = {}) {
    if (!canEdit) return;
    if (!history.push(JSON.stringify(gameCase))) return;
    changeCount++;
    if (saveState === 'saved' || saveState === 'error') saveState = 'dirty';
    if (overlays.reach) reach = reachability(scene());
    scheduleSave();
    renderHeader();
    renderScenes();
    renderObjects();
    if (!keepPanel) renderPanel();
    renderToolbar();
    draw();
  }

  function scheduleSave(delay = AUTOSAVE_MS) {
    window.clearTimeout(autosaveTimer);
    if (saveState === 'stale' || !canEdit) return;
    autosaveTimer = window.setTimeout(() => { void save(); }, delay);
  }

  async function save({ checkpoint = false, note = '' } = {}): Promise<boolean> {
    if (!canEdit || saveState === 'stale') return false;
    flushPending();
    window.clearTimeout(autosaveTimer);
    if (saving) {
      await saving;
      if (!checkpoint && !isDirty()) return true;
    }
    if (!checkpoint && !isDirty()) return true;
    const sentChange = changeCount;
    const body = JSON.parse(history.current);
    saveState = 'saving';
    renderHeader();
    let ok = false;
    saving = (async () => {
      try {
        const result = await caseEditorApi.save(caseId, version, body, { checkpoint, note });
        if (disposed) return;
        version = result.version;
        validation = result.validation ?? validation;
        revisions = result.revisions ?? revisions;
        savedChangeCount = sentChange;
        saveState = isDirty() ? 'dirty' : 'saved';
        saveMessage = '';
        ok = true;
        if (checkpoint) toast(`Đã lưu phiên bản #${result.revision?.number ?? ''}.`, 'success');
      } catch (error) {
        if (disposed) return;
        const code = error?.errors?.code;
        if (error?.status === 409 && code === 'CASE_EDITOR_STALE') {
          saveState = 'stale';
          saveMessage = error.errors.updatedByName ? `bởi ${error.errors.updatedByName}` : '';
        } else {
          saveState = 'error';
          saveMessage = error?.status === 409 && code === 'CASE_IMMUTABLE_WHILE_ACTIVE'
            ? 'Có phòng chơi thật đang dùng vụ này; chờ phòng xong rồi lưu.'
            : error?.status === 422 && Array.isArray(error.errors)
              ? `${error.message} ${error.errors.map((entry) => entry.path).filter(Boolean).join(', ')}`
              : error?.message || 'Lưu không được.';
        }
      }
    })();
    await saving;
    saving = null;
    if (disposed) return ok;
    renderHeader();
    renderBanner();
    renderScenes();
    renderObjects();
    renderTabs();
    renderPanel();
    draw();
    if (ok && isDirty()) scheduleSave();
    return ok;
  }

  function applySnapshot(snapshot: string | null) {
    if (snapshot === null) return;
    gameCase = JSON.parse(snapshot);
    changeCount++;
    if (saveState === 'saved' || saveState === 'error') saveState = 'dirty';
    if (!findScene(gameCase, sceneId)) sceneId = orderedScenes(gameCase)[0]?.sceneId ?? '';
    if (selected && !getGeometry(scene(), selected)) selected = null;
    if (overlays.reach) reach = reachability(scene());
    scheduleSave();
    renderAll();
  }

  /** A text edit or nudge still waiting for its pause becomes its own undo step first. */
  function flushPending() {
    if (!textTimer) return;
    window.clearTimeout(textTimer);
    textTimer = 0;
    commit({ keepPanel: true });
  }

  const undo = () => { if (!canEdit) return; flushPending(); applySnapshot(history.undo()); };
  const redo = () => { if (!canEdit) return; flushPending(); applySnapshot(history.redo()); };

  async function reloadLatest() {
    try {
      data = await caseEditorApi.open(caseId);
    } catch (error) {
      toast(error?.message || 'Không tải được bản mới.', 'error');
      return;
    }
    if (disposed) return;
    gameCase = data.case;
    version = data.version;
    validation = data.validation;
    revisions = data.revisions;
    canEdit = Boolean(data.canEdit);
    if (!canEdit) tool = 'select';
    history.reset(JSON.stringify(gameCase));
    changeCount = savedChangeCount = 0;
    saveState = canEdit ? 'saved' : 'readonly';
    saveMessage = '';
    if (!findScene(gameCase, sceneId)) sceneId = orderedScenes(gameCase)[0]?.sceneId ?? '';
    selected = null;
    renderAll();
  }

  /* ------------------------------------------------------------ selection */

  function select(ref: ObjectRef | null, { focus = false } = {}) {
    selected = ref;
    if (tab !== 'object' && ref) tab = 'object';
    if (ref?.kind === 'npc') loadLibrary();
    if (focus && ref) {
      const geometry = getGeometry(scene(), ref);
      const rect = canvasElement.getBoundingClientRect();
      if (geometry) {
        const sx = view.ox + (geometry.box.x + geometry.box.width / 2) * view.scale;
        const sy = view.oy + (geometry.box.y + geometry.box.height / 2) * view.scale;
        if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) {
          view.ox += rect.width / 2 - sx;
          view.oy += rect.height / 2 - sy;
        }
      }
    }
    renderObjects();
    renderTabs();
    renderPanel(true);
    draw();
  }

  function openScene(id: string) {
    if (id === sceneId) return;
    sceneId = id;
    selected = null;
    reach = overlays.reach ? reachability(scene()) : null;
    const profile = sceneProfile(scene());
    view.fit(profile.width, profile.height);
    renderAll();
  }

  function goToIssue(issue: any) {
    const target = issueTarget(gameCase, issue);
    if (target.type === 'object') {
      if (target.sceneId !== sceneId) openScene(target.sceneId);
      select(target.ref, { focus: true });
      tab = 'object';
    } else if (target.type === 'scene') {
      if (target.sceneId !== sceneId) openScene(target.sceneId);
      if (target.part === 'grid') overlays.grid = true;
      select(null);
    } else if (target.type === 'evidence') {
      tab = 'evidence';
      renderTabs();
      renderPanel(true);
      app.querySelector(`#cse-ev-${target.kind}-${CSS.escape(target.id)}`)?.scrollIntoView({ block: 'center' });
      return;
    } else if (target.type === 'character') {
      const home = orderedScenes(gameCase).find((entry) => entry.runtime?.characterPlacements?.some((placement) => placement.characterId === target.id));
      if (home) {
        if (home.sceneId !== sceneId) openScene(home.sceneId);
        select({ kind: 'npc', id: target.id }, { focus: true });
      }
    } else if (target.type === 'lines') {
      linesCharacter = target.characterId;
      previewPath = target.path;
      tab = 'lines';
      renderTabs();
      renderPanel(true);
      const field = app.querySelector(`[data-line-path^="${CSS.escape(target.path.replace(/\.[a-zA-Z]+$/, ''))}"] textarea`) as HTMLTextAreaElement | null;
      field?.scrollIntoView({ block: 'center' });
      field?.focus();
      return;
    } else if (target.type === 'hints') {
      tab = 'check';
    }
    renderAll();
  }

  async function loadLibrary() {
    if (library !== null || libraryError) return;
    try {
      const entries = await aiCaseApi.library(data.world || '', 'NPC');
      if (disposed) return;
      library = Array.isArray(entries) ? entries : [];
    } catch (error) {
      if (disposed) return;
      libraryError = error?.message || 'Không tải được thư viện NPC.';
    }
    if (tab === 'object' && selected?.kind === 'npc') renderPanel();
  }

  /* ------------------------------------------------------------ dialogs */

  function ask({ title, bodyHtml, confirm, danger = false, note = false }: { title: string; bodyHtml: string; confirm: string; danger?: boolean; note?: boolean }) {
    return new Promise<{ ok: boolean; note: string }>((resolve) => {
      const layer = document.createElement('div');
      layer.className = 'adm-layer cse-layer';
      layer.innerHTML = `<div class="cse-dialog" role="dialog" aria-modal="true" aria-labelledby="cse-dialog-title">
        <h2 id="cse-dialog-title">${escapeHtml(title)}</h2>
        <div class="cse-dialog-body">${bodyHtml}</div>
        ${note ? '<label class="cse-field">Ghi chú (tùy chọn)<input type="text" maxlength="200" data-dialog-note></label>' : ''}
        <div class="cse-dialog-actions">
          <button type="button" class="btn" data-dialog="cancel">Thôi</button>
          <button type="button" class="btn ${danger ? 'adm-btn-danger' : 'btn-primary'}" data-dialog="ok">${escapeHtml(confirm)}</button>
        </div></div>`;
      document.body.appendChild(layer);
      const close = (ok: boolean) => {
        const value = (layer.querySelector('[data-dialog-note]') as HTMLInputElement | null)?.value ?? '';
        layer.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve({ ok, note: value });
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.stopPropagation(); close(false); }
      };
      document.addEventListener('keydown', onKey, true);
      layer.addEventListener('click', (event) => {
        const action = (event.target as HTMLElement).closest('[data-dialog]')?.getAttribute('data-dialog');
        if (action) close(action === 'ok');
        else if (event.target === layer) close(false);
      });
      const first = layer.querySelector<HTMLElement>('[data-dialog-note]') ?? layer.querySelector<HTMLElement>('[data-dialog="ok"]');
      first?.focus();
      signal.addEventListener('abort', () => close(false), { once: true });
    });
  }

  /* ------------------------------------------------------------ header actions */

  async function checkpoint() {
    const answer = await ask({ title: 'Lưu phiên bản', bodyHtml: '<p>Giữ bản hiện tại thành một phiên bản có số để quay lại sau.</p>', confirm: 'Lưu', note: true });
    if (!answer.ok || disposed) return;
    await save({ checkpoint: true, note: answer.note });
  }

  async function playtest() {
    const current = scene();
    if (!current || !data.canPlaytest) return;
    if (isDirty() && !(await save())) {
      toast('Chưa lưu được thay đổi, nên chưa mở phòng chơi thử.', 'error');
      return;
    }
    try {
      const room = await caseEditorApi.playtest(caseId, current.sceneId);
      if (disposed) return;
      toast(`Phòng chơi thử bắt đầu ở "${current.title || current.sceneId}". Mời người thứ hai bằng liên kết trong sảnh.`, 'success');
      navigate(`/lobby/${encodeURIComponent(room.roomId)}`);
    } catch (error) {
      toast(error?.message || 'Không mở được phòng chơi thử.', 'error');
    }
  }

  async function publish() {
    if (!validation.canPublish) return;
    if (isDirty() && !(await save())) return;
    if (!validation.canPublish) { renderAll(); return; }
    const warnings = validation.warnings?.length ?? 0;
    const answer = await ask({
      title: 'Duyệt và xuất bản',
      bodyHtml: `<p>Bạn đã xem và duyệt <strong>${escapeHtml(gameCase.title)}</strong>. Xuất bản thì người chơi thấy vụ ngay trong danh sách.</p>
        ${warnings ? `<p class="cse-warn">${warnings} cảnh báo không chặn vẫn còn (xem tab Kiểm tra).</p>` : ''}
        <p class="cse-muted">Sau khi xuất bản, editor chỉ xem được; muốn sửa phải gỡ xuất bản trước.</p>`,
      confirm: 'Xuất bản',
      note: true,
    });
    if (!answer.ok || disposed) return;
    try {
      await caseEditorApi.publish(caseId, version, answer.note);
      if (disposed) return;
      toast('Đã xuất bản. Vụ đã lên danh sách cho người chơi.', 'success');
      await reloadLatest();
    } catch (error) {
      if (disposed) return;
      if (error?.status === 409 && error?.errors?.code === 'CASE_EDITOR_STALE') {
        saveState = 'stale';
        renderAll();
      } else if (error?.status === 422 && Array.isArray(error.errors)) {
        validation = { ...validation, canPublish: false, errors: error.errors };
        tab = 'check';
        renderAll();
        toast(error.message || 'Vụ còn lỗi.', 'error');
      } else {
        toast(error?.message || 'Xuất bản không được.', 'error');
      }
    }
  }

  async function viewRevision(number: number) {
    try {
      const result = await caseEditorApi.revision(caseId, number);
      if (disposed) return;
      const changed = changedSections(result.case, gameCase);
      revisionView = {
        number,
        html: `<h4>So với bản #${number}</h4>
          ${changed.length ? `<p>Bản hiện tại khác ở: <strong>${escapeHtml(changed.join(', '))}</strong>.</p>` : '<p>Giống hệt bản hiện tại.</p>'}
          <p class="cse-muted">Tên lúc đó: ${escapeHtml(result.case.title)} · ${result.revision.errorCount} lỗi, ${result.revision.warningCount} cảnh báo.</p>`,
      };
      renderPanel(true);
    } catch (error) {
      toast(error?.message || 'Không mở được bản này.', 'error');
    }
  }

  async function restore(number: number) {
    const answer = await ask({
      title: `Khôi phục bản #${number}?`,
      bodyHtml: '<p>Bản hiện tại được tự lưu thành "Trước khi khôi phục" trước, nên có thể quay lại.</p>',
      confirm: 'Khôi phục',
      note: true,
    });
    if (!answer.ok || disposed) return;
    if (isDirty() && !(await save())) return;
    try {
      const result = await caseEditorApi.restore(caseId, number, version, answer.note);
      if (disposed) return;
      data = result;
      gameCase = result.case;
      version = result.version;
      validation = result.validation;
      revisions = result.revisions;
      history.reset(JSON.stringify(gameCase));
      changeCount = savedChangeCount = 0;
      saveState = 'saved';
      revisionView = null;
      if (!findScene(gameCase, sceneId)) sceneId = orderedScenes(gameCase)[0]?.sceneId ?? '';
      selected = null;
      toast(`Đã khôi phục bản #${number}.`, 'success');
      renderAll();
    } catch (error) {
      if (error?.status === 409 && error?.errors?.code === 'CASE_EDITOR_STALE') { saveState = 'stale'; renderAll(); return; }
      toast(error?.message || 'Khôi phục không được.', 'error');
    }
  }

  async function confirmDeleteEvidence(kind: 'item' | 'clue', id: string) {
    const dependencies = evidenceDependencies(gameCase, kind, id);
    const name = kind === 'item'
      ? (gameCase.items ?? []).find((entry) => entry.itemId === id)?.name
      : (gameCase.clues ?? []).find((entry) => entry.clueId === id)?.title;
    const answer = await ask({
      title: `Xóa ${kind === 'item' ? 'vật phẩm' : 'manh mối'} "${name || id}"?`,
      bodyHtml: dependencies.length
        ? `<p class="cse-warn"><strong>${dependencies.length} chỗ khác còn dùng nó</strong> và sẽ báo lỗi sau khi xóa (vụ sẽ không xuất bản được tới khi sửa):</p>
           <ul class="cse-deps">${dependencies.slice(0, 30).map((reference) => `<li><code>${escapeHtml(reference.path)}</code></li>`).join('')}</ul>
           ${dependencies.length > 30 ? `<p class="cse-muted">…và ${dependencies.length - 30} chỗ nữa.</p>` : ''}`
        : '<p>Không chỗ nào khác dùng nó. Khung của nó trong các cảnh cũng bị xóa theo.</p>',
      confirm: dependencies.length ? 'Vẫn xóa' : 'Xóa',
      danger: true,
    });
    if (!answer.ok || disposed) return;
    if (deleteEvidence(gameCase, kind, id)) {
      if (selected && selected.kind === kind && selected.id === id) selected = null;
      commit();
      toast('Đã xóa. Có thể hoàn tác bằng Ctrl+Z.', 'info');
    }
  }

  /* ------------------------------------------------------------ events */

  const listeners: [EventTarget, string, EventListener, any?][] = [];
  const on = (target: EventTarget, type: string, listener: EventListener, options?: any) => {
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
  };

  on($('#cse-undo'), 'click', undo);
  on($('#cse-redo'), 'click', redo);
  on($('#cse-checkpoint'), 'click', () => { void checkpoint(); });
  on($('#cse-playtest'), 'click', () => { void playtest(); });
  on($('#cse-publish'), 'click', () => { void publish(); });
  on($('#cse-banner'), 'click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#cse-reload')) void reloadLatest();
    if (target.closest('#cse-retry')) { saveState = 'dirty'; void save(); }
  });
  on($('#cse-scenes'), 'click', (event) => {
    const id = (event.target as HTMLElement).closest('[data-scene]')?.getAttribute('data-scene');
    if (id) openScene(id);
  });
  on($('#cse-objects'), 'click', (event) => {
    const key = (event.target as HTMLElement).closest('[data-object]')?.getAttribute('data-object');
    if (!key) return;
    const [kind, ...rest] = key.split(':');
    select({ kind: kind as ObjectKind, id: rest.join(':') }, { focus: true });
  });
  on($('#cse-tabs'), 'click', (event) => {
    const key = (event.target as HTMLElement).closest('[data-tab]')?.getAttribute('data-tab') as Tab | null;
    if (!key) return;
    tab = key;
    renderTabs();
    renderPanel(true);
  });
  app.querySelectorAll('[data-tool]').forEach((button) => on(button, 'click', () => {
    tool = (button as HTMLElement).dataset.tool as typeof tool;
    if (tool !== 'select') overlays.grid = true;
    renderToolbar();
    draw();
  }));
  on($('#cse-brush'), 'change', (event) => { brush = Number((event.target as HTMLSelectElement).value) || 3; draw(); });
  app.querySelectorAll('[data-overlay]').forEach((input) => on(input, 'change', () => {
    overlays[(input as HTMLInputElement).dataset.overlay as keyof Overlays] = (input as HTMLInputElement).checked;
    draw();
  }));
  on($('#cse-reach'), 'click', () => {
    overlays.reach = !overlays.reach;
    reach = overlays.reach ? reachability(scene()) : null;
    renderObjects();
    renderToolbar();
    renderPanel();
    draw();
  });
  app.querySelectorAll('[data-zoom]').forEach((button) => on(button, 'click', () => {
    const rect = canvasElement.getBoundingClientRect();
    const mode = (button as HTMLElement).dataset.zoom;
    if (mode === 'fit') {
      const profile = sceneProfile(scene());
      view.fit(profile.width, profile.height);
    } else {
      view.zoomAt(mode === 'in' ? 1.25 : 0.8, rect.width / 2, rect.height / 2);
    }
    draw();
  }));

  /* canvas: select, drag, resize, pan, paint */
  const handleSize = () => 10 / view.scale;
  on(canvasElement, 'pointerdown', (event: PointerEvent) => {
    const current = scene();
    if (!current || event.button === 2) return;
    canvasElement.focus();
    const point = view.toRuntime(event.clientX, event.clientY);
    if (event.button === 1 || (tool === 'select' && event.shiftKey)) {
      drag = { mode: 'pan', clientX: event.clientX, clientY: event.clientY, ox: view.ox, oy: view.oy };
    } else if (tool !== 'select') {
      const grid = sceneGrid(current);
      if (!grid || !canEdit) return;
      const value = tool === 'floor' ? '1' : '0';
      drag = { mode: 'paint', value, changed: paintGrid(grid, point.x, point.y, brush, value) };
      if (overlays.reach) reach = reachability(current);
      draw();
    } else {
      const objects = sceneObjects(gameCase, current);
      const selectedObject = selected ? objects.find((object) => objectKey(object) === objectKey(selected!)) ?? null : null;
      if (canEdit && selectedObject && onResizeHandle(selectedObject, point, handleSize())) {
        drag = { mode: 'resize', ref: selected!, start: getGeometry(current, selected!)!, from: point, changed: false };
      } else {
        const hit = hitTest(objects, point);
        if (hit) {
          if (!selected || objectKey(selected) !== objectKey(hit)) select({ kind: hit.kind, id: hit.id });
          drag = canEdit ? { mode: 'move', ref: { kind: hit.kind, id: hit.id }, start: getGeometry(current, hit)!, from: point, changed: false } : null;
        } else {
          if (selected) select(null);
          drag = { mode: 'pan', clientX: event.clientX, clientY: event.clientY, ox: view.ox, oy: view.oy };
        }
      }
    }
    if (drag) canvasElement.setPointerCapture(event.pointerId);
  });
  on(canvasElement, 'pointermove', (event: PointerEvent) => {
    const current = scene();
    if (!current) return;
    const point = view.toRuntime(event.clientX, event.clientY);
    if (tool !== 'select') { brushAt = point; }
    if (!drag) {
      if (tool === 'select') {
        const objects = sceneObjects(gameCase, current);
        const hit = hitTest(objects, point);
        const key = hit ? objectKey(hit) : null;
        const selectedObject = selected ? objects.find((object) => objectKey(object) === objectKey(selected!)) : null;
        canvasElement.style.cursor = canEdit && selectedObject && onResizeHandle(selectedObject, point, handleSize()) ? 'nwse-resize' : hit ? (canEdit ? 'move' : 'pointer') : 'grab';
        if (key !== hoverKey) { hoverKey = key; draw(); }
      } else {
        canvasElement.style.cursor = 'crosshair';
        draw();
      }
      return;
    }
    if (drag.mode === 'pan') {
      view.ox = drag.ox + (event.clientX - drag.clientX);
      view.oy = drag.oy + (event.clientY - drag.clientY);
    } else if (drag.mode === 'paint') {
      const grid = sceneGrid(current);
      if (grid) drag.changed += paintGrid(grid, point.x, point.y, brush, drag.value);
      if (overlays.reach) reach = reachability(current);
    } else {
      const profile = sceneProfile(current);
      const dx = point.x - drag.from.x, dy = point.y - drag.from.y;
      const next = drag.mode === 'move'
        ? translateGeometry(drag.start, dx, dy, profile.width)
        : resizeGeometry(drag.start, dx, dy, profile.width);
      drag.changed = drag.changed || next.box.x !== drag.start.box.x || next.box.y !== drag.start.box.y
        || next.box.width !== drag.start.box.width || next.box.height !== drag.start.box.height;
      setGeometry(current, drag.ref, next);
    }
    draw();
  });
  const endDrag = () => {
    const finished = drag;
    drag = null;
    if (!finished) return;
    if ((finished.mode === 'move' || finished.mode === 'resize') && finished.changed) commit();
    else if (finished.mode === 'paint' && finished.changed > 0) commit();
  };
  on(canvasElement, 'pointerup', endDrag);
  on(canvasElement, 'pointercancel', endDrag);
  on(canvasElement, 'pointerleave', () => { if (!drag && brushAt) { brushAt = null; draw(); } });
  on(canvasElement, 'wheel', (event: WheelEvent) => {
    event.preventDefault();
    const rect = canvasElement.getBoundingClientRect();
    view.zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top);
    draw();
  }, { passive: false });

  /* right panel: inspector, evidence, lines, hints, history */
  const panel = $('#cse-panel');
  on(panel, 'input', (event) => {
    const target = event.target as HTMLInputElement;
    if (!canEdit) return;
    if (target.dataset.path) {
      if (!writeText(gameCase, target.dataset.path, target.value)) return;
      const counter = panel.querySelector(`[data-count-for="${CSS.escape(target.dataset.path)}"]`);
      if (counter) counter.textContent = String(target.value.length);
      if (tab === 'lines') { previewPath = target.dataset.path; updatePreview(); }
      if (target.dataset.path === 'title') renderHeader();
      window.clearTimeout(textTimer);
      textTimer = window.setTimeout(() => { textTimer = 0; commit({ keepPanel: true }); }, TEXT_COMMIT_MS);
      return;
    }
    if (target.dataset.text === 'door-label' || target.dataset.text === 'zone-label') {
      const runtime = scene()?.runtime;
      const entry = target.dataset.text === 'door-label'
        ? runtime?.transitions?.find((door) => door.targetSceneId === selected?.id)
        : runtime?.clueZones?.find((zone) => zone.clueId === selected?.id);
      if (!entry) return;
      entry.label = target.value;
      draw();
      window.clearTimeout(textTimer);
      textTimer = window.setTimeout(() => { textTimer = 0; commit({ keepPanel: true }); }, TEXT_COMMIT_MS);
      return;
    }
    if (target.dataset.librarySearch !== undefined) {
      libraryQuery = target.value;
      const caret = target.selectionStart;
      renderPanel(true);
      const search = panel.querySelector('[data-library-search]') as HTMLInputElement | null;
      search?.focus();
      if (search && caret !== null) search.setSelectionRange(caret, caret);
    }
  });
  on(panel, 'toggle', (event) => {
    if ((event.target as HTMLElement).classList?.contains('cse-all-hints')) openAllHints = (event.target as HTMLDetailsElement).open;
  }, true);
  on(panel, 'focusin', (event) => {
    const target = event.target as HTMLElement;
    if (tab === 'lines' && target.dataset.path) { previewPath = target.dataset.path; updatePreview(); }
  });
  on(panel, 'change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.linesCharacter !== undefined) {
      linesCharacter = target.value;
      previewPath = '';
      renderPanel(true);
      return;
    }
    if (!canEdit) return;
    if (target.dataset.text === 'npc-direction') {
      const placement = scene()?.runtime?.characterPlacements?.find((entry) => entry.characterId === selected?.id);
      if (placement) { placement.direction = target.value; commit(); }
      return;
    }
    if (target.dataset.geo && selected) {
      const current = scene();
      const geometry = getGeometry(current, selected);
      if (!geometry) return;
      const value = snap(Number(target.value) || 0);
      const next: Geometry = { box: { ...geometry.box }, point: geometry.point ? { ...geometry.point } : undefined };
      if (target.dataset.geo === 'px' || target.dataset.geo === 'py') {
        const moved = translateGeometry(geometry, target.dataset.geo === 'px' ? value - geometry.point!.x : 0,
          target.dataset.geo === 'py' ? value - geometry.point!.y : 0, sceneProfile(current).width);
        setGeometry(current, selected, selected.kind === 'spawn'
          ? { box: moved.box, point: { x: target.dataset.geo === 'px' ? value : geometry.point!.x, y: target.dataset.geo === 'py' ? value : geometry.point!.y } }
          : moved);
      } else if (target.dataset.geo === 'x' || target.dataset.geo === 'y') {
        setGeometry(current, selected, translateGeometry(geometry, target.dataset.geo === 'x' ? value - geometry.box.x : 0,
          target.dataset.geo === 'y' ? value - geometry.box.y : 0, sceneProfile(current).width));
      } else {
        next.box[target.dataset.geo] = value;
        setGeometry(current, selected, resizeGeometry({ box: { ...geometry.box } }, next.box.width - geometry.box.width,
          next.box.height - geometry.box.height, sceneProfile(current).width));
      }
      commit();
    }
  });
  on(panel, 'click', (event) => {
    const target = (event.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!target) return;
    const ds = target.dataset;
    if (ds.swap && selected?.kind === 'npc' && canEdit) {
      const entry = (library ?? []).find((candidate) => candidate.key === ds.swap);
      if (entry && swapNpcLook(gameCase, selected.id, entry)) {
        commit();
        toast(`Đã đổi mặt sang "${entry.nameVi || entry.key}". Lời thoại giữ nguyên.`, 'success');
      }
    } else if (ds.gotoEvidence) {
      const [kind, ...rest] = ds.gotoEvidence.split(':');
      tab = 'evidence';
      renderTabs();
      renderPanel(true);
      app.querySelector(`#cse-ev-${kind}-${CSS.escape(rest.join(':'))}`)?.scrollIntoView({ block: 'center' });
    } else if (ds.gotoLines) {
      linesCharacter = ds.gotoLines;
      previewPath = '';
      tab = 'lines';
      renderTabs();
      renderPanel(true);
    } else if (ds.gotoObject) {
      const [targetScene, key] = ds.gotoObject.split('|');
      const [kind, ...rest] = key.split(':');
      openScene(targetScene);
      select({ kind: kind as ObjectKind, id: rest.join(':') }, { focus: true });
    } else if (ds.deleteEvidence && canEdit) {
      const [kind, ...rest] = ds.deleteEvidence.split(':');
      void confirmDeleteEvidence(kind as 'item' | 'clue', rest.join(':'));
    } else if (ds.issue) {
      const [kind, index] = ds.issue.split(':');
      const issue = (kind === 'error' ? validation.errors : validation.warnings)?.[Number(index)];
      if (issue) goToIssue(issue);
    } else if (ds.addHint && canEdit) {
      const [contextType, targetId, order] = ds.addHint.split('|');
      const field = panel.querySelector(`[data-new-hint="${CSS.escape(ds.addHint)}"]`) as HTMLTextAreaElement | null;
      if (!field?.value.trim()) { field?.focus(); toast('Viết gợi ý trước khi thêm.', 'info'); return; }
      if (addHint(gameCase, contextType, targetId, Number(order), field.value)) commit();
    } else if (ds.removeHint && canEdit) {
      if (removeHint(gameCase, Number(ds.removeHint))) commit();
    } else if (ds.viewRevision) {
      void viewRevision(Number(ds.viewRevision));
    } else if (ds.restore && canEdit) {
      void restore(Number(ds.restore));
    }
  });

  /* keyboard: undo/redo, nudge, tools */
  on(document, 'keydown', (event: KeyboardEvent) => {
    if (document.querySelector('.cse-layer')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement)?.tagName ?? '');
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !typing && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (mod && !typing && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return; }
    if (typing || mod) return;
    if (selected && canEdit && event.key.startsWith('Arrow')) {
      const current = scene();
      const geometry = getGeometry(current, selected);
      if (!geometry) return;
      event.preventDefault();
      const step = event.shiftKey ? 16 : 4;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      setGeometry(current, selected, translateGeometry(geometry, dx, dy, sceneProfile(current).width));
      draw();
      window.clearTimeout(textTimer);
      textTimer = window.setTimeout(() => { textTimer = 0; commit(); }, 400);
      return;
    }
    const keyTool = { v: 'select', b: 'floor', n: 'wall' }[event.key.toLowerCase()];
    if (keyTool && (keyTool === 'select' || (canEdit && sceneGrid(scene())))) {
      tool = keyTool as typeof tool;
      if (tool !== 'select') overlays.grid = true;
      renderToolbar();
      draw();
    } else if (event.key === 'Escape' && selected) {
      select(null);
    }
  });

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (isDirty() || saving) { event.preventDefault(); event.returnValue = ''; }
  };
  on(window, 'beforeunload', onBeforeUnload as EventListener);
  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe($('#cse-wrap'));

  /* first paint */
  const firstProfile = sceneProfile(scene());
  view.fit(firstProfile.width, firstProfile.height);
  renderAll();
  // Test hook: the scene canvas and its state, read by tests/case-editor.spec.ts.
  (window as any).__caseEditor = {
    state: () => ({ version, saveState, selected, tool, sceneId, scale: view.scale, ox: view.ox, oy: view.oy, imagesSettled: view.imagesSettled() }),
    gameCase: () => gameCase,
  };

  return () => {
    disposed = true;
    window.clearTimeout(autosaveTimer);
    window.clearTimeout(textTimer);
    resizeObserver.disconnect();
    for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
    document.querySelectorAll('.cse-layer').forEach((layer) => layer.remove());
    delete (window as any).__caseEditor;
    // Leaving with unsaved changes: send them once more (the version check still guards the server).
    if (isDirty() && canEdit && saveState !== 'stale') {
      void caseEditorApi.save(caseId, version, JSON.parse(history.current)).catch(() => {});
    }
  };
}
