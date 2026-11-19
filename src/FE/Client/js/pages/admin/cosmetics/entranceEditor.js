import { EN, RARITY_OF_SERVER, avatarImg, reduce, warmEntranceArt } from '../../../cosmetics/index.js';
import { playEntrance } from '../../../cosmetics/entrances.js';
import { defineEntrance } from '../../../cosmetics/fx.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { paintStageThumb } from '../../../cosmetics/stage.js';
import { escapeHtml } from '../../../utils/dom.js';
import { basicFieldsHtml, blockHtml, mountSections, saveBarHtml, saveCosmetic, uploadHtml, wirePictureInput } from './editorCommon.js';
import { acfIcon, hexOf, keyOf, rgbOf } from './shared.js';

const PREVIEW_ID = '__pv_entrance';
const FLIPBOOK = 'flipbook';
const TEMPLATES = [FLIPBOOK, 'lang-le', 'anh-trang', 'mac-vu', 'truc-lam', 'van-kiem', 'huyet-nguyet', 'hac-duc', 'than-tham', 'kim-long', 'phuong-hoang'];
const TEMPLATE_LABELS = { [FLIPBOOK]: 'Ảnh động riêng (sprite sheet của họa sĩ)' };
const PLACES = [['hero', 'Quanh người chơi (sau ảnh đại diện)'], ['screen', 'Phủ cả màn hình'], ['across', 'Bay ngang qua màn hình'], ['drop', 'Sà xuống từ trên']];
const BLENDS = [['normal', 'Giữ nguyên (ảnh nền trong suốt)'], ['add', 'Cộng sáng (ảnh vẽ trên nền đen)']];
const MAX_CELLS = 16;
const CREATURE_TEMPLATES = { 'kim-long': 'Ảnh sinh vật bay ngang, đầu quay sang phải. Thân sẽ uốn lượn.', 'phuong-hoang': 'Ảnh sinh vật nhìn thẳng, sà xuống và vỗ cánh.' };
const SWORD_TEMPLATE = 'van-kiem';
const STILL_SECONDS = 2.5;
/* What the full-screen preview shows around the effect. */
const SAMPLE_PLAYER = { name: 'Thám tử mẫu', frameId: 'kimlong', titleId: 'kim-long', avatar: () => avatarImg('nonla') };

export function mountEntranceEditor(host, { item, page, onSaved, onChanged }) {
  warmEntranceArt();
  const painter = createPainter();
  const shipped = Boolean(item?.visual?.builtinId);
  const params = item?.visual?.params ?? {};
  const state = {
    template: item?.visual?.template ?? 'kim-long',
    tintOn: Boolean(params.tint),
    tint: params.tint ?? '120,200,255',
    imageUrl: params.imageUrl ?? null,
    swordUrl: params.swordUrl ?? null,
    duration: params.duration ? Number(params.duration) : null,
    flip: {
      sheetUrl: params.sheetUrl ?? null,
      cols: Number(params.cols) || 4,
      rows: Number(params.rows) || 4,
      frames: params.frames ? Number(params.frames) : null,
      fps: Number(params.fps) || 12,
      loop: params.loop !== false,
      place: params.place ?? 'hero',
      size: Number(params.size) || 1,
      blend: params.blend ?? 'normal',
    },
  };
  /** Frames the sheet plays: what the admin typed, never more than its cells. */
  const framesOf = () => Math.min(state.flip.frames ?? state.flip.cols * state.flip.rows, state.flip.cols * state.flip.rows);
  let playing = null;

  const applyPreview = () => {
    if (shipped) return;
    defineEntrance(PREVIEW_ID, {
      n: host.querySelector('[data-field="name"]')?.value.trim() || 'Hiệu ứng mới',
      r: RARITY_OF_SERVER[host.querySelector('[data-field="rarity"]')?.value] ?? 'leg',
      src: '',
      d: '',
      tpl: state.template,
      tint: state.tintOn ? state.tint : null,
      imageUrl: CREATURE_TEMPLATES[state.template] ? state.imageUrl : null,
      swordUrl: state.template === SWORD_TEMPLATE ? state.swordUrl : null,
      duration: state.duration,
      flip: state.template === FLIPBOOK && state.flip.sheetUrl ? { ...state.flip, frames: framesOf() } : null,
    }, { listed: false });
  };
  const previewId = () => (shipped ? keyOf(item) : PREVIEW_ID);

  const visualBody = () => {
    const body = {};
    if (state.tintOn) body.tint = state.tint;
    if (state.duration) body.duration = state.duration;
    if (CREATURE_TEMPLATES[state.template] && state.imageUrl) body.imageUrl = state.imageUrl;
    if (state.template === SWORD_TEMPLATE && state.swordUrl) body.swordUrl = state.swordUrl;
    if (state.template === FLIPBOOK) {
      const { flip } = state;
      Object.assign(body, {
        sheetUrl: flip.sheetUrl, cols: flip.cols, rows: flip.rows, frames: framesOf(), fps: flip.fps, loop: flip.loop,
        place: flip.place, size: flip.size, blend: flip.blend,
      });
    }
    return { template: state.template, imageUrl: null, params: body };
  };

  const showForTemplate = () => {
    const creature = host.querySelector('[data-creature]');
    const sword = host.querySelector('[data-sword]');
    if (creature) {
      creature.hidden = !CREATURE_TEMPLATES[state.template];
      creature.querySelector('[data-creature-note]').textContent = CREATURE_TEMPLATES[state.template] ?? '';
    }
    if (sword) sword.hidden = state.template !== SWORD_TEMPLATE;
    const flipbook = host.querySelector('[data-flipbook]');
    if (flipbook) flipbook.hidden = state.template !== FLIPBOOK;
  };

  /** The sheet with its grid over it, so the admin sees at once whether the columns and rows are right. */
  const drawSheet = () => {
    const box = host.querySelector('[data-sheet]');
    if (!box) return;
    const { flip } = state;
    if (!flip.sheetUrl) {
      box.innerHTML = '<p class="acf-align-empty">Chưa có sprite sheet. Các khung xếp thành lưới đều nhau, đọc từ trái sang phải, từ trên xuống.</p>';
      return;
    }
    const lines = [];
    for (let c = 1; c < flip.cols; c += 1) lines.push(`<i class="acf-sheet-col" style="left:${(c / flip.cols) * 100}%"></i>`);
    for (let r = 1; r < flip.rows; r += 1) lines.push(`<i class="acf-sheet-row" style="top:${(r / flip.rows) * 100}%"></i>`);
    box.innerHTML = `<div class="acf-sheet"><img src="${escapeHtml(flip.sheetUrl)}" alt="Sprite sheet đang dùng" draggable="false">${lines.join('')}</div>
      <p class="acf-hint">${flip.cols} cột × ${flip.rows} hàng, chạy ${framesOf()} khung, ${flip.fps} khung/giây.</p>`;
  };
  const numberField = (key, label, min, max, step = 1) => `
    <div class="acf-field"><label for="acf-flip-${key}">${label}</label>
      <input class="field-input" id="acf-flip-${key}" type="number" min="${min}" max="${max}" step="${step}" inputmode="numeric" value="${state.flip[key] ?? ''}" data-flip="${key}"${key === 'frames' ? ' placeholder="tất cả"' : ''}></div>`;

  const template = blockHtml({
    id: 'acf-template-title',
    title: 'Mẫu',
    sub: 'Chuyển động lấy từ một hiệu ứng có sẵn. Đổi được màu và thời lượng; vài mẫu đổi được cả ảnh.',
    body: `
      <div class="acf-field"><label for="acf-template">Kiểu chuyển động</label>
        <select class="field-input" id="acf-template" data-template>
          ${TEMPLATES.map((id) => `<option value="${id}"${state.template === id ? ' selected' : ''}>${escapeHtml(TEMPLATE_LABELS[id] ?? EN[id]?.n ?? id)}</option>`).join('')}
        </select></div>
      <div class="acf-effects">
        <div class="acf-effect">
          <label class="acf-check"><input type="checkbox" data-tint-on${state.tintOn ? ' checked' : ''}> Đổi màu chủ đạo</label>
          <div class="acf-effect-body"><input type="color" value="${hexOf(state.tint)}" data-tint aria-label="Màu chủ đạo">
            <span class="acf-hint">Đổi màu ánh sáng và hạt. Ảnh vẽ tay giữ nguyên màu của ảnh.</span></div>
        </div>
        <div class="acf-effect">
          <div class="acf-effect-body">
            <label class="acf-slider"><span>Thời lượng (giây)</span> <output data-duration-text>${state.duration ?? 'theo mẫu'}</output>
              <input type="range" min="4" max="12" step="0.5" value="${state.duration ?? 8}" data-duration aria-label="Thời lượng"></label>
            <button class="btn btn-ghost btn-sm" type="button" data-duration-reset>Dùng thời lượng của mẫu</button>
          </div>
        </div>
      </div>
      <div class="acf-template" data-creature>
        ${uploadHtml({ label: 'Tải ảnh sinh vật (PNG/WebP)', attr: 'data-creature-input', statusAttr: 'data-creature-status', statusText: state.imageUrl ? 'Đang dùng ảnh riêng.' : 'Đang dùng ảnh của mẫu.' })}
        <p class="acf-note" data-creature-note></p>
      </div>
      <div class="acf-template" data-sword>
        ${uploadHtml({ label: 'Tải ảnh kiếm (PNG/WebP, mũi kiếm quay sang phải)', attr: 'data-sword-input', statusAttr: 'data-sword-status', statusText: state.swordUrl ? 'Đang dùng ảnh riêng.' : 'Đang dùng ảnh của mẫu.' })}
      </div>
      <div class="acf-template acf-flipbook" data-flipbook>
        ${uploadHtml({ label: 'Tải sprite sheet (PNG/WebP)', attr: 'data-sheet-input', statusAttr: 'data-sheet-status', note: 'Các khung cùng cỡ, xếp lưới tối đa 16×16. Ảnh nền đen thì chọn Cộng sáng.', statusText: state.flip.sheetUrl ? 'Đang dùng sprite sheet đã tải.' : '' })}
        <div class="acf-align-wrap" data-sheet></div>
        <div class="acf-grid2">
          ${numberField('cols', 'Số cột', 1, MAX_CELLS)}
          ${numberField('rows', 'Số hàng', 1, MAX_CELLS)}
          ${numberField('frames', 'Số khung chạy', 1, MAX_CELLS * MAX_CELLS)}
          ${numberField('fps', 'Khung mỗi giây', 1, 60)}
        </div>
        <div class="acf-grid2">
          <div class="acf-field"><label for="acf-flip-place">Vị trí</label>
            <select class="field-input" id="acf-flip-place" data-flip-place>${PLACES.map(([id, label]) => `<option value="${id}"${state.flip.place === id ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
          <div class="acf-field"><label for="acf-flip-blend">Cách hòa ảnh</label>
            <select class="field-input" id="acf-flip-blend" data-flip-blend>${BLENDS.map(([id, label]) => `<option value="${id}"${state.flip.blend === id ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
        </div>
        <label class="acf-slider"><span>Cỡ hiệu ứng</span> <output data-flip-size-text>${state.flip.size.toFixed(2)}</output>
          <input type="range" min="0.3" max="3" step="0.05" value="${state.flip.size}" data-flip-size aria-label="Cỡ hiệu ứng"></label>
        <label class="acf-check"><input type="checkbox" data-flip-loop${state.flip.loop ? ' checked' : ''}> Lặp lại đến hết thời lượng (bỏ chọn: chạy một lần rồi giữ khung cuối)</label>
      </div>`,
  });
  host.innerHTML = `
    <div class="acf-editor">
      <div class="acf-editor-main">
        <div class="acf-form">
          ${blockHtml({ id: 'acf-info-title', title: 'Thông tin', body: basicFieldsHtml(item, { withDescription: true }) })}
          ${shipped ? '<p class="acf-shipped">Hiệu ứng có sẵn của game giữ nguyên hình. Muốn đổi màu hay đổi ảnh, hãy tạo hiệu ứng mới từ mẫu của nó.</p>' : template}
          ${saveBarHtml(item, 'ENTRANCE')}
        </div>
        ${item ? '<div class="acf-sections" data-sections></div>' : ''}
      </div>
      <aside class="adm-card acf-preview" data-preview aria-labelledby="acf-preview-title">
        <div class="acf-preview-head"><h2 class="adm-card-title" id="acf-preview-title">Xem trước</h2></div>
        <div class="acf-preview-stage hs-root" data-stage="black">
          <canvas class="acf-stage-thumb" data-thumb width="480" height="270" role="img" aria-label="Hiệu ứng thu nhỏ"></canvas>
        </div>
        <button class="btn btn-primary" type="button" data-play>${acfIcon('play', 18)}Xem thử toàn màn hình</button>
      </aside>
    </div>`;

  host.querySelector('[data-save]').addEventListener('click', (event) => {
    saveCosmetic({ item, category: 'ENTRANCE', root: host, visual: shipped ? null : visualBody(), button: event.currentTarget, onSaved });
  });
  if (item) mountSections(host, item, page, onChanged);
  host.querySelector('[data-play]').addEventListener('click', () => {
    applyPreview();
    playing?.cancel();
    playing = playEntrance(previewId(), SAMPLE_PLAYER);
  });
  const thumb = host.querySelector('[data-thumb]');
  const stopThumb = painter.onPaint((seconds) => paintStageThumb(thumb, previewId(), reduce.matches ? STILL_SECONDS : seconds));

  if (!shipped) {
    host.querySelector('[data-template]').addEventListener('change', (event) => {
      state.template = event.target.value;
      showForTemplate();
      applyPreview();
    });
    host.querySelector('[data-tint-on]').addEventListener('change', (event) => { state.tintOn = event.target.checked; applyPreview(); });
    host.querySelector('[data-tint]').addEventListener('input', (event) => { state.tint = rgbOf(event.target.value); applyPreview(); });
    host.querySelector('[data-duration]').addEventListener('input', (event) => {
      state.duration = Number(event.target.value);
      host.querySelector('[data-duration-text]').textContent = event.target.value;
      applyPreview();
    });
    host.querySelector('[data-duration-reset]').addEventListener('click', () => {
      state.duration = null;
      host.querySelector('[data-duration-text]').textContent = 'theo mẫu';
      applyPreview();
    });
    wirePictureInput(host.querySelector('[data-creature-input]'), {
      needsAlpha: false,
      status: host.querySelector('[data-creature-status]'),
      onPicture: ({ url }) => {
        state.imageUrl = url;
        host.querySelector('[data-creature-status]').textContent = 'Đang dùng ảnh riêng.';
        applyPreview();
      },
    });
    wirePictureInput(host.querySelector('[data-sword-input]'), {
      needsAlpha: false,
      status: host.querySelector('[data-sword-status]'),
      onPicture: ({ url }) => {
        state.swordUrl = url;
        host.querySelector('[data-sword-status]').textContent = 'Đang dùng ảnh riêng.';
        applyPreview();
      },
    });
    wirePictureInput(host.querySelector('[data-sheet-input]'), {
      needsAlpha: false,
      status: host.querySelector('[data-sheet-status]'),
      onPicture: ({ url }) => {
        state.flip.sheetUrl = url;
        host.querySelector('[data-sheet-status]').textContent = 'Đang dùng sprite sheet đã tải.';
        drawSheet();
        applyPreview();
      },
    });
    host.querySelectorAll('[data-flip]').forEach((input) => input.addEventListener('input', () => {
      const key = input.dataset.flip;
      const value = Math.round(Number(input.value));
      if (key === 'frames') state.flip.frames = input.value === '' || !Number.isFinite(value) ? null : Math.max(1, value);
      else if (Number.isFinite(value) && value >= 1) state.flip[key] = Math.min(key === 'fps' ? 60 : MAX_CELLS, value);
      drawSheet();
      applyPreview();
    }));
    host.querySelector('[data-flip-place]').addEventListener('change', (event) => { state.flip.place = event.target.value; applyPreview(); });
    host.querySelector('[data-flip-blend]').addEventListener('change', (event) => { state.flip.blend = event.target.value; applyPreview(); });
    host.querySelector('[data-flip-size]').addEventListener('input', (event) => {
      state.flip.size = Number(event.target.value) || 1;
      host.querySelector('[data-flip-size-text]').textContent = state.flip.size.toFixed(2);
      applyPreview();
    });
    host.querySelector('[data-flip-loop]').addEventListener('change', (event) => { state.flip.loop = event.target.checked; applyPreview(); });
    drawSheet();
    showForTemplate();
    applyPreview();
  }

  return () => {
    stopThumb();
    playing?.cancel();
    painter.dispose();
  };
}
