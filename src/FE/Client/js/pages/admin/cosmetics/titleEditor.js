import { RARITY_OF_SERVER, T, prepareCosmetics, setPlaqueMotion, titleHTML, whenTitleFontReady } from '../../../cosmetics/index.js';
import { STYLE_KEYS, titleFrom } from '../../../cosmetics/titles.js';
import { escapeHtml } from '../../../utils/dom.js';
import { basicFieldsHtml, blockHtml, mountSections, saveBarHtml, saveCosmetic, uploadHtml, wirePictureInput } from './editorCommon.js';
import { hexOf, keyOf, rgbOf } from './shared.js';

const STYLE_LABELS = {
  thuong: 'Đồng thường', ngan: 'Bạc', nguyet: 'Trăng bạc', truc: 'Trúc', ngoc: 'Ngọc', bang: 'Băng', anhdao: 'Anh đào', mac: 'Mực', tinhkhong: 'Tinh không',
  kiem: 'Song kiếm', thanh: 'U linh', thantham: 'Thần thám', hoa: 'Lửa', hacduc: 'Cánh đen', longphung: 'Long phụng', kimlong: 'Kim long', phuong: 'Phượng hoàng', thienmenh: 'Thiên mệnh',
};
const PARTICLES = [['tw', 'Lấp lánh'], ['rise', 'Bụi sáng bay lên'], ['leaf', 'Lá trúc'], ['snow', 'Tuyết'], ['petal', 'Cánh hoa'], ['smoke', 'Khói'], ['ember', 'Tàn lửa'], ['feather', 'Lông đen'], ['wfeather', 'Lông trắng']];
const MAX_PARTICLE_ROWS = 4;
const NAME_DEBOUNCE_MS = 150;
/* Where the name sits on a new picture until the admin draws the box: the middle, as on most nameplates. */
const DEFAULT_BOX = { x: 0.15, y: 0.28, w: 0.7, h: 0.44 };
const MIN_BOX = 0.02;
const round4 = (value) => Math.round(value * 10000) / 10000;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** A box kept inside the picture, at least 2 % wide and tall, in fractions rounded as the server stores them. */
function boxWithin({ x, y, w, h }) {
  const width = Math.min(1, Math.max(MIN_BOX, w));
  const height = Math.min(1, Math.max(MIN_BOX, h));
  return { x: round4(Math.min(clamp01(x), 1 - width)), y: round4(Math.min(clamp01(y), 1 - height)), w: round4(width), h: round4(height) };
}

export function mountTitleEditor(host, { item, page, onSaved, onChanged }) {
  prepareCosmetics();
  const shipped = Boolean(item?.visual?.builtinId);
  const params = item?.visual?.params ?? {};
  const state = {
    style: params.style ?? 'kimlong',
    glowOn: Boolean(params.glow),
    glow: params.glow ?? '255,200,90',
    partsOn: Array.isArray(params.parts),
    parts: Array.isArray(params.parts) ? params.parts.map((row) => [row[0], Number(row[1]), row[2]]) : [['rise', 6, '255,214,120'], ['tw', 3, '255,248,220']],
    // "style": one of the 18 plates drawn in code. "painted": a picture an artist drew, with the name written in its box.
    kind: item?.visual?.template === 'painted' ? 'painted' : 'style',
    pic: {
      url: item?.visual?.template === 'painted' ? item.visual.imageUrl ?? null : null,
      w: Number(params.size?.w) || 0,
      h: Number(params.size?.h) || 0,
      box: params.box ? boxWithin(params.box) : { ...DEFAULT_BOX },
      baked: params.textBaked === true,
      color: params.color ?? '255,240,200',
      scale: Number(params.scale) || 1,
    },
  };
  let timer = 0;
  let disposed = false;

  const nameOf = () => host.querySelector('[data-field="name"]')?.value.trim() || 'Danh hiệu mới';
  const rarOf = () => RARITY_OF_SERVER[host.querySelector('[data-field="rarity"]')?.value] ?? 'rare';

  const painted = () => !shipped && state.kind === 'painted' && Boolean(state.pic.url && state.pic.w && state.pic.h);
  const picOf = () => ({ ...state.pic, box: state.pic.baked ? null : state.pic.box });

  /** The plaque as the current fields would draw it. A shipped title keeps its style. */
  const plaque = (style = state.style, { asStyle = false } = {}) => titleFrom({
    n: nameOf(),
    r: rarOf(),
    src: '',
    made: true,
    sty: shipped ? T[keyOf(item)]?.sty : style,
    glow: !shipped && state.glowOn ? state.glow : null,
    parts: !shipped && state.partsOn ? state.parts : null,
    pic: !asStyle && painted() ? picOf() : null,
  });

  // Only plaques on screen move: all eighteen at once is too much for a phone, off screen they show as nothing.
  const watcher = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) setPlaqueMotion(entry.target, entry.isIntersecting);
    })
    : null;
  const moving = (cell) => {
    if (watcher) watcher.observe(cell);
    else setPlaqueMotion(cell, true);
  };

  const drawPreviews = () => {
    const full = host.querySelector('[data-title-full]');
    const bare = host.querySelector('[data-title-bare]');
    if (!full || !bare) return;
    const width = Math.max(240, full.clientWidth - 8);
    full.innerHTML = titleHTML(plaque(), { scale: 1.1, maxW: width });
    bare.innerHTML = titleHTML(plaque(), { scale: 0.74, bare: true, maxW: Math.min(width, 260) });
    setPlaqueMotion(full, true);
    setPlaqueMotion(bare, true);
  };

  const drawStyles = () => {
    const grid = host.querySelector('[data-styles]');
    if (!grid) return;
    watcher?.disconnect();
    // As wide as one cell of the grid, however many columns its CSS gives it.
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter((track) => track && track !== 'none').length);
    const cell = Math.max(200, (grid.clientWidth || 600) / columns - 24);
    grid.innerHTML = STYLE_KEYS.map((key) => `
      <button class="acf-style${state.style === key ? ' is-on' : ''}" type="button" role="radio" aria-checked="${state.style === key}" data-style="${key}">
        ${titleHTML(plaque(key, { asStyle: true }), { maxW: cell })}
        <small>${escapeHtml(STYLE_LABELS[key] ?? key)}</small>
      </button>`).join('');
    grid.querySelectorAll('[data-style]').forEach((button) => {
      moving(button);
      button.addEventListener('click', () => {
        state.style = button.dataset.style;
        grid.querySelectorAll('[data-style]').forEach((other) => {
          const on = other === button;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-checked', String(on));
        });
        drawPreviews();
      });
    });
  };

  const drawAll = () => {
    drawStyles();
    drawPreviews();
  };

  const particleRowsHtml = () => state.parts.map((row, index) => `
    <div class="acf-part" data-part="${index}">
      <select class="field-input" data-part-kind aria-label="Loại hạt">${PARTICLES.map(([id, label]) => `<option value="${id}"${row[0] === id ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <input class="field-input acf-count" type="number" min="1" max="12" inputmode="numeric" value="${row[1]}" data-part-count aria-label="Số hạt">
      <input type="color" value="${hexOf(row[2])}" data-part-color aria-label="Màu hạt">
      <button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-part-remove aria-label="Bỏ dòng này">Bỏ</button>
    </div>`).join('');

  const wireParticles = () => {
    const box = host.querySelector('[data-parts]');
    box.innerHTML = particleRowsHtml();
    host.querySelector('[data-part-add]').disabled = state.parts.length >= MAX_PARTICLE_ROWS;
    box.querySelectorAll('[data-part]').forEach((row) => {
      const index = Number(row.dataset.part);
      row.querySelector('[data-part-kind]').addEventListener('change', (event) => { state.parts[index][0] = event.target.value; drawPreviews(); });
      row.querySelector('[data-part-count]').addEventListener('input', (event) => { state.parts[index][1] = Math.max(1, Math.min(12, Number(event.target.value) || 1)); drawPreviews(); });
      row.querySelector('[data-part-color]').addEventListener('input', (event) => { state.parts[index][2] = rgbOf(event.target.value); drawPreviews(); });
      row.querySelector('[data-part-remove]').addEventListener('click', () => {
        state.parts.splice(index, 1);
        wireParticles();
        drawPreviews();
      });
    });
  };

  const visualBody = () => {
    const effects = {};
    if (state.glowOn) effects.glow = state.glow;
    if (state.partsOn) effects.parts = state.parts;
    if (state.kind === 'painted') {
      const { pic } = state;
      const body = { size: { w: pic.w, h: pic.h }, color: pic.color, scale: pic.scale, ...effects };
      if (pic.baked) body.textBaked = true;
      else body.box = pic.box;
      return { template: 'painted', imageUrl: pic.url, params: body };
    }
    return { template: 'style', imageUrl: null, params: { style: state.style, ...effects } };
  };

  // ---------------------------------------------------------------- a nameplate painted by an artist

  const kindBlock = blockHtml({
    id: 'acf-kind-title',
    title: 'Loại bảng tên',
    sub: 'Kiểu vẽ sẵn của game, hoặc ảnh bảng tên do họa sĩ vẽ rồi tải lên.',
    body: `
      <div class="acf-modes" role="radiogroup" aria-labelledby="acf-kind-title">
        <label class="acf-choice"><input type="radio" name="acf-title-kind" value="style"${state.kind === 'style' ? ' checked' : ''}> Kiểu vẽ sẵn (18 kiểu)</label>
        <label class="acf-choice"><input type="radio" name="acf-title-kind" value="painted"${state.kind === 'painted' ? ' checked' : ''}> Ảnh riêng</label>
      </div>`,
  });
  const percentField = (part, label) => `
    <div class="acf-field"><label for="acf-tbox-${part}">${label} (%)</label>
      <input class="field-input" id="acf-tbox-${part}" type="number" min="0" max="100" step="0.5" inputmode="decimal" data-tbox="${part}"></div>`;
  const paintedBlock = blockHtml({
    id: 'acf-paint-title',
    title: 'Ảnh bảng tên',
    sub: 'PNG hoặc WebP nền trong suốt, nên rộng gấp 3 đến 5 lần chiều cao (ví dụ 900×220). Tên tiếng Việt hoặc tiếng Anh được viết vào khung chữ, nên đổi tên không cần vẽ lại.',
    attrs: ' data-painted-block',
    body: `
      ${uploadHtml({ label: 'Tải ảnh bảng tên', attr: 'data-title-input', statusAttr: 'data-title-status', statusText: state.pic.url ? 'Đang dùng ảnh đã tải.' : '' })}
      <div class="acf-align-wrap" data-tbox-wrap></div>
      <label class="acf-check"><input type="checkbox" data-title-baked${state.pic.baked ? ' checked' : ''}> Ảnh đã có chữ sẵn (không viết tên lên ảnh)</label>
      <div class="acf-grid2" data-tbox-fields>
        ${percentField('x', 'Khung chữ: trái')}
        ${percentField('y', 'Khung chữ: trên')}
        ${percentField('w', 'Khung chữ: rộng')}
        ${percentField('h', 'Khung chữ: cao')}
      </div>
      <div class="acf-grid2">
        <div class="acf-field" data-title-color-field><label for="acf-title-color">Màu chữ</label><input id="acf-title-color" type="color" value="${hexOf(state.pic.color)}" data-title-color></div>
        <div class="acf-field"><label for="acf-title-scale">Cỡ bảng tên: <output data-title-scale-out>${state.pic.scale.toFixed(2)}</output></label>
          <input id="acf-title-scale" type="range" min="0.5" max="2" step="0.05" value="${state.pic.scale}" data-title-scale></div>
      </div>`,
  });

  /** The picture with the text box over it. Dragging on the picture draws a new box; the fields under it fine-tune it. */
  const drawAlign = () => {
    const wrap = host.querySelector('[data-tbox-wrap]');
    if (!wrap) return;
    const { pic } = state;
    if (!pic.url || !pic.w || !pic.h) {
      wrap.innerHTML = '<p class="acf-align-empty">Chưa có ảnh. Sau khi tải ảnh, kéo trên ảnh để vẽ khung chữ.</p>';
    } else {
      wrap.innerHTML = `
        <div class="acf-align acf-tbox-area" data-tbox-area style="aspect-ratio:${pic.w}/${pic.h}">
          <img class="acf-align-art" src="${escapeHtml(pic.url)}" alt="Ảnh bảng tên" draggable="false">
          <div class="acf-tbox" data-tbox-mark aria-hidden="true"${pic.baked ? ' hidden' : ''}></div>
        </div>
        <p class="acf-hint">${pic.baked ? 'Ảnh đã có chữ: không có khung chữ.' : 'Kéo trên ảnh để vẽ khung chữ, hoặc nhập số bên dưới.'}</p>`;
      wireBoxDrag(wrap.querySelector('[data-tbox-area]'));
    }
    paintBox();
  };

  const paintBox = () => {
    const { box, baked } = state.pic;
    const mark = host.querySelector('[data-tbox-mark]');
    if (mark) Object.assign(mark.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
    host.querySelectorAll('[data-tbox]').forEach((input) => {
      input.disabled = baked;
      if (document.activeElement !== input) input.value = String(Math.round(box[input.dataset.tbox] * 1000) / 10);
    });
    const colorField = host.querySelector('[data-title-color-field]');
    if (colorField) colorField.hidden = baked;
  };

  const wireBoxDrag = (area) => {
    let start = null;
    const at = (event) => {
      const rect = area.getBoundingClientRect();
      return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
    };
    area.addEventListener('pointerdown', (event) => {
      if (state.pic.baked) return;
      start = at(event);
      area.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    area.addEventListener('pointermove', (event) => {
      if (!start) return;
      const here = at(event);
      state.pic.box = boxWithin({ x: Math.min(start.x, here.x), y: Math.min(start.y, here.y), w: Math.abs(here.x - start.x), h: Math.abs(here.y - start.y) });
      paintBox();
    });
    const end = () => {
      if (!start) return;
      start = null;
      drawPreviews();
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  };

  const showKind = () => {
    const isPainted = state.kind === 'painted';
    const styles = host.querySelector('[data-styles-block]');
    const paintedSection = host.querySelector('[data-painted-block]');
    if (styles) styles.hidden = isPainted;
    if (paintedSection) paintedSection.hidden = !isPainted;
  };

  const styles = blockHtml({
    id: 'acf-styles-title',
    title: 'Kiểu bảng tên',
    sub: 'Mỗi ô vẽ đúng tên đang gõ, như người chơi sẽ thấy.',
    attrs: ' data-styles-block',
    body: '<div class="acf-styles hs-root" data-styles role="radiogroup" aria-labelledby="acf-styles-title"></div>',
  });
  const overrides = blockHtml({
    id: 'acf-over-title',
    title: 'Ghi đè',
    sub: 'Không bật thì dùng màu và hạt của kiểu đã chọn.',
    body: `
      <div class="acf-effects">
        <div class="acf-effect">
          <label class="acf-check"><input type="checkbox" data-glow-on${state.glowOn ? ' checked' : ''}> Đổi màu phát sáng</label>
          <div class="acf-effect-body"><input type="color" value="${hexOf(state.glow)}" data-glow-color aria-label="Màu phát sáng"></div>
        </div>
        <div class="acf-effect">
          <label class="acf-check"><input type="checkbox" data-parts-on${state.partsOn ? ' checked' : ''}> Đổi hạt bay</label>
          <div class="acf-parts" data-parts></div>
          <div><button class="btn btn-ghost btn-sm" type="button" data-part-add>Thêm loại hạt</button></div>
        </div>
      </div>`,
  });
  host.innerHTML = `
    <div class="acf-editor">
      <div class="acf-editor-main">
        <div class="acf-form">
          ${blockHtml({ id: 'acf-info-title', title: 'Thông tin', sub: 'Chữ trên bảng tên chính là tên tiếng Việt.', body: basicFieldsHtml(item) })}
          ${shipped ? '<p class="acf-shipped">Danh hiệu có sẵn của game giữ nguyên kiểu.</p>' : kindBlock + styles + paintedBlock + overrides}
          ${saveBarHtml(item, 'TITLE')}
        </div>
        ${item ? '<div class="acf-sections" data-sections></div>' : ''}
      </div>
      <aside class="adm-card acf-preview" data-preview aria-labelledby="acf-preview-title">
        <div class="acf-preview-head"><h2 class="adm-card-title" id="acf-preview-title">Xem trước</h2></div>
        <div class="acf-preview-stage hs-root" data-stage="profile">
          <figure><div data-title-full class="acf-title-box"></div><figcaption>Cỡ đầy đủ, ở hồ sơ</figcaption></figure>
          <figure><div data-title-bare class="acf-title-box"></div><figcaption>Cỡ thu nhỏ, trong sảnh</figcaption></figure>
        </div>
      </aside>
    </div>`;

  host.querySelector('[data-save]').addEventListener('click', (event) => {
    saveCosmetic({ item, category: 'TITLE', root: host, visual: shipped ? null : visualBody(), button: event.currentTarget, onSaved });
  });
  if (item) mountSections(host, item, page, onChanged);
  // The style grid shows the name being typed, so it follows the field.
  const redrawSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(drawAll, NAME_DEBOUNCE_MS);
  };
  host.querySelector('[data-field="name"]').addEventListener('input', redrawSoon);
  host.querySelector('[data-field="rarity"]').addEventListener('change', drawAll);
  if (!shipped) {
    host.querySelector('[data-glow-on]').addEventListener('change', (event) => { state.glowOn = event.target.checked; drawPreviews(); });
    host.querySelector('[data-glow-color]').addEventListener('input', (event) => { state.glow = rgbOf(event.target.value); drawPreviews(); });
    host.querySelector('[data-parts-on]').addEventListener('change', (event) => { state.partsOn = event.target.checked; drawPreviews(); });
    host.querySelector('[data-part-add]').addEventListener('click', () => {
      if (state.parts.length >= MAX_PARTICLE_ROWS) return;
      state.parts.push(['tw', 3, '255,248,220']);
      wireParticles();
      drawPreviews();
    });
    wireParticles();

    host.querySelectorAll('[name="acf-title-kind"]').forEach((radio) => radio.addEventListener('change', () => {
      state.kind = radio.value;
      showKind();
      drawAll();
    }));
    wirePictureInput(host.querySelector('[data-title-input]'), {
      needsAlpha: true,
      status: host.querySelector('[data-title-status]'),
      onPicture: (stored) => {
        state.pic.url = stored.url;
        state.pic.w = Number(stored.width) || 0;
        state.pic.h = Number(stored.height) || 0;
        drawAlign();
        drawPreviews();
      },
    });
    host.querySelector('[data-title-baked]').addEventListener('change', (event) => {
      state.pic.baked = event.target.checked;
      drawAlign();
      drawPreviews();
    });
    host.querySelectorAll('[data-tbox]').forEach((input) => input.addEventListener('input', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      state.pic.box = boxWithin({ ...state.pic.box, [input.dataset.tbox]: value / 100 });
      paintBox();
      drawPreviews();
    }));
    host.querySelector('[data-title-color]').addEventListener('input', (event) => { state.pic.color = rgbOf(event.target.value); drawPreviews(); });
    host.querySelector('[data-title-scale]').addEventListener('input', (event) => {
      state.pic.scale = Number(event.target.value) || 1;
      host.querySelector('[data-title-scale-out]').textContent = state.pic.scale.toFixed(2);
      drawPreviews();
    });
    showKind();
    drawAlign();
  }
  drawAll();
  whenTitleFontReady().then(() => { if (!disposed) drawAll(); });

  return () => {
    disposed = true;
    clearTimeout(timer);
    watcher?.disconnect();
  };
}
