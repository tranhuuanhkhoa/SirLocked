import { RARITY_OF_SERVER, T, prepareCosmetics, setPlaqueMotion, titleHTML, whenTitleFontReady } from '../../../cosmetics/index.js';
import { STYLE_KEYS, titleFrom } from '../../../cosmetics/titles.js';
import { escapeHtml } from '../../../utils/dom.js';
import { acquisitionHtml, basicFieldsHtml, saveCosmetic, statusHtml, wireAcquisition, wireStatus } from './editorCommon.js';
import { hexOf, keyOf, rgbOf } from './shared.js';

const STYLE_LABELS = {
  thuong: 'Đồng thường', ngan: 'Bạc', nguyet: 'Trăng bạc', truc: 'Trúc', ngoc: 'Ngọc', bang: 'Băng', anhdao: 'Anh đào', mac: 'Mực', tinhkhong: 'Tinh không',
  kiem: 'Song kiếm', thanh: 'U linh', thantham: 'Thần thám', hoa: 'Lửa', hacduc: 'Cánh đen', longphung: 'Long phụng', kimlong: 'Kim long', phuong: 'Phượng hoàng', thienmenh: 'Thiên mệnh',
};
const PARTICLES = [['tw', 'Lấp lánh'], ['rise', 'Bụi sáng bay lên'], ['leaf', 'Lá trúc'], ['snow', 'Tuyết'], ['petal', 'Cánh hoa'], ['smoke', 'Khói'], ['ember', 'Tàn lửa'], ['feather', 'Lông đen'], ['wfeather', 'Lông trắng']];
const MAX_PARTICLE_ROWS = 4;
const NAME_DEBOUNCE_MS = 150;

export function mountTitleEditor(host, { item, page, onSaved }) {
  prepareCosmetics();
  const shipped = Boolean(item?.visual?.builtinId);
  const params = item?.visual?.params ?? {};
  const state = {
    style: params.style ?? 'kimlong',
    glowOn: Boolean(params.glow),
    glow: params.glow ?? '255,200,90',
    partsOn: Array.isArray(params.parts),
    parts: Array.isArray(params.parts) ? params.parts.map((row) => [row[0], Number(row[1]), row[2]]) : [['rise', 6, '255,214,120'], ['tw', 3, '255,248,220']],
  };
  let timer = 0;
  let disposed = false;

  const nameOf = () => host.querySelector('[data-field="name"]')?.value.trim() || 'Danh hiệu mới';
  const rarOf = () => RARITY_OF_SERVER[host.querySelector('[data-field="rarity"]')?.value] ?? 'rare';

  /** The plaque as the current fields would draw it. A shipped title keeps its style. */
  const plaque = (style = state.style) => titleFrom({
    n: nameOf(),
    r: rarOf(),
    src: '',
    made: true,
    sty: shipped ? T[keyOf(item)]?.sty : style,
    glow: !shipped && state.glowOn ? state.glow : null,
    parts: !shipped && state.partsOn ? state.parts : null,
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
    const cell = Math.max(200, (grid.clientWidth || 600) / (grid.clientWidth > 700 ? 2 : 1) - 24);
    grid.innerHTML = STYLE_KEYS.map((key) => `
      <button class="acf-style${state.style === key ? ' is-on' : ''}" type="button" role="radio" aria-checked="${state.style === key}" data-style="${key}">
        ${titleHTML(plaque(key), { maxW: cell })}
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
      <input class="field-input acf-short" type="number" min="1" max="12" value="${row[1]}" data-part-count aria-label="Số hạt">
      <input type="color" value="${hexOf(row[2])}" data-part-color aria-label="Màu hạt">
      <button class="btn btn-ghost btn-sm" type="button" data-part-remove aria-label="Bỏ dòng này">Bỏ</button>
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
    const body = { style: state.style };
    if (state.glowOn) body.glow = state.glow;
    if (state.partsOn) body.parts = state.parts;
    return { template: 'style', imageUrl: null, params: body };
  };

  host.innerHTML = `
    <div class="acf-editor">
      <div class="acf-editor-main">
        <section class="acf-section">
          <h3>Thông tin danh hiệu</h3>
          ${basicFieldsHtml(item)}
          <p class="muted small">Chữ trên bảng tên chính là tên tiếng Việt.</p>
        </section>
        ${shipped ? '<p class="muted small">Danh hiệu có sẵn của game giữ nguyên kiểu.</p>' : `
        <section class="acf-section">
          <h3>Kiểu bảng tên</h3>
          <div class="acf-styles hs-root" data-styles role="radiogroup" aria-label="Kiểu bảng tên"></div>
        </section>
        <section class="acf-section">
          <h3>Ghi đè</h3>
          <div class="acf-effect">
            <label class="acf-check"><input type="checkbox" data-glow-on${state.glowOn ? ' checked' : ''}> Đổi màu phát sáng</label>
            <div class="acf-effect-body"><input type="color" value="${hexOf(state.glow)}" data-glow-color aria-label="Màu phát sáng"></div>
          </div>
          <div class="acf-effect">
            <label class="acf-check"><input type="checkbox" data-parts-on${state.partsOn ? ' checked' : ''}> Đổi hạt bay</label>
            <div data-parts></div>
            <button class="btn btn-ghost btn-sm" type="button" data-part-add>Thêm loại hạt</button>
          </div>
        </section>`}
        <div class="acf-actions"><button class="btn btn-primary" type="button" data-save>${item ? 'Lưu danh hiệu' : 'Tạo danh hiệu'}</button></div>
        ${item ? acquisitionHtml(item, page) + statusHtml(item) : ''}
      </div>
      <aside class="acf-preview" data-preview aria-label="Xem trước">
        <h3>Xem trước</h3>
        <div class="acf-preview-stage hs-root" data-stage="profile">
          <figure><div data-title-full class="acf-title-box"></div><figcaption>Cỡ đầy đủ, ở hồ sơ</figcaption></figure>
          <figure><div data-title-bare class="acf-title-box"></div><figcaption>Cỡ thu nhỏ, trong sảnh</figcaption></figure>
        </div>
      </aside>
    </div>`;

  host.querySelector('[data-save]').addEventListener('click', (event) => {
    saveCosmetic({ item, category: 'TITLE', root: host, visual: shipped ? null : visualBody(), button: event.currentTarget, onSaved });
  });
  if (item) {
    wireAcquisition(host, item, onSaved);
    wireStatus(host, item, onSaved);
  }
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
  }
  drawAll();
  whenTitleFontReady().then(() => { if (!disposed) drawAll(); });

  return () => {
    disposed = true;
    clearTimeout(timer);
    watcher?.disconnect();
  };
}
