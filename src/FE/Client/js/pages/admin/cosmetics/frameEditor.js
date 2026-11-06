import { avatarImg, FR, forgetCanvas, paintFrame } from '../../../cosmetics/index.js';
import { defineFrame, liveOf, sheenOf } from '../../../cosmetics/frames.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { escapeHtml } from '../../../utils/dom.js';
import { basicFieldsHtml, blockHtml, mountSections, saveBarHtml, saveCosmetic, uploadHtml, wirePictureInput } from './editorCommon.js';
import { hexOf, keyOf, rgbOf } from './shared.js';

const PREVIEW_ID = '__pv';
const FRAME_BASES = ['dong', 'bac', 'ngoc', 'vang', 'truong', 'thach', 'mac', 'bang', 'sonmai', 'ulinh', 'vankiem', 'hacduc', 'kimlong', 'phuong', 'tinhkhong', 'lua'];
const BACKGROUNDS = [
  { id: 'profile', label: 'Nền hồ sơ' },
  { id: 'lobby', label: 'Nền sảnh chờ' },
  { id: 'black', label: 'Nền đen' },
];
const FALL_KINDS = [['snow', 'Tuyết'], ['petal', 'Hoa đào'], ['rose', 'Hoa hồng'], ['feather', 'Lông vũ']];

/* The effects of the LIVE table in cosmetics/frames.js, with the limits the server keeps. */
const EFFECTS = [
  { key: 'aura', label: 'Hào quang thở', color: '255,190,90', sliders: [{ label: 'Cường độ', min: 0, max: 0.6, step: 0.01, value: 0.28 }] },
  { key: 'rays', label: 'Tia sáng xoay', color: '255,214,130', sliders: [{ label: 'Cường độ', min: 0, max: 0.4, step: 0.01, value: 0.16 }] },
  { key: 'comet', label: 'Sao chổi chạy vòng', color: '255,232,170', sliders: [{ label: 'Tốc độ', min: 0.02, max: 0.6, step: 0.01, value: 0.16 }, { label: 'Số vệt', min: 1, max: 4, step: 1, value: 1 }] },
  { key: 'spark', label: 'Lấp lánh', color: '255,244,210', sliders: [{ label: 'Số lượng', min: 1, max: 10, step: 1, value: 3 }] },
  { key: 'fall', label: 'Rơi quanh viền', kinds: FALL_KINDS, sliders: [{ label: 'Số lượng', min: 1, max: 16, step: 1, value: 6 }] },
  { key: 'embers', label: 'Tàn lửa bay', color: '255,160,60', sliders: [{ label: 'Số lượng', min: 1, max: 16, step: 1, value: 7 }] },
  { key: 'flame', label: 'Vòng lửa', sliders: [] },
  { key: 'breathe', label: 'Thở nhẹ (ảnh phồng lên xuống)', sliders: [{ label: 'Độ', min: 0.002, max: 0.03, step: 0.001, value: 0.01 }] },
];

/** The controls' state from a `live` object: every effect keeps its values even while switched off. */
function effectsFrom(live) {
  return Object.fromEntries(EFFECTS.map((effect) => {
    const stored = live?.[effect.key];
    const state = { on: stored !== undefined && stored !== null, color: effect.color ?? null, kind: effect.kinds?.[0][0] ?? null, values: effect.sliders.map((slider) => slider.value) };
    if (Array.isArray(stored)) {
      if (effect.kinds) [state.kind] = stored;
      else [state.color] = stored;
      state.values = stored.slice(1).map(Number);
    } else if (state.on && effect.key === 'breathe') {
      state.values = [Number(stored)];
    }
    return [effect.key, state];
  }));
}

function liveFrom(effects) {
  const live = {};
  for (const effect of EFFECTS) {
    const state = effects[effect.key];
    if (!state.on) continue;
    if (effect.key === 'flame') live.flame = 1;
    else if (effect.key === 'breathe') [live.breathe] = state.values;
    else live[effect.key] = [effect.kinds ? state.kind : state.color, ...state.values];
  }
  return live;
}

function sheenFrom(stored) {
  return { on: Boolean(stored?.a), color: stored?.rgb ?? '255,236,180', a: Number(stored?.a || 0.4), period: Number(stored?.period ?? 8), conic: Boolean(stored?.conic) };
}

const sheenValue = (sheen) => (sheen.on ? { rgb: sheen.color, a: sheen.a, period: sheen.period, conic: sheen.conic } : null);

function effectsHtml(effects, sheen) {
  const slider = (key, index, def, value) => `
    <label class="acf-slider"><span>${escapeHtml(def.label)}</span> <output>${value}</output>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}" data-effect-value="${key}" data-index="${index}" aria-label="${escapeHtml(def.label)}"></label>`;
  return `
    ${EFFECTS.map((effect) => {
    const state = effects[effect.key];
    const hasBody = effect.color || effect.kinds || effect.sliders.length > 0;
    return `<div class="acf-effect" data-effect="${effect.key}">
        <label class="acf-check"><input type="checkbox" data-effect-on="${effect.key}"${state.on ? ' checked' : ''}> ${escapeHtml(effect.label)}</label>
        ${hasBody ? `<div class="acf-effect-body">
          ${effect.color ? `<input type="color" value="${hexOf(state.color)}" data-effect-color="${effect.key}" aria-label="Màu ${escapeHtml(effect.label)}">` : ''}
          ${effect.kinds ? `<select class="field-input acf-kind" data-effect-kind="${effect.key}" aria-label="Loại">${effect.kinds.map(([id, label]) => `<option value="${id}"${state.kind === id ? ' selected' : ''}>${label}</option>`).join('')}</select>` : ''}
          ${effect.sliders.map((def, index) => slider(effect.key, index, def, state.values[index])).join('')}
        </div>` : ''}
      </div>`;
  }).join('')}
    <div class="acf-effect" data-effect="sheen">
      <label class="acf-check"><input type="checkbox" data-sheen="on"${sheen.on ? ' checked' : ''}> Ánh kim lướt</label>
      <div class="acf-effect-body">
        <input type="color" value="${hexOf(sheen.color)}" data-sheen="color" aria-label="Màu ánh kim">
        <label class="acf-slider"><span>Cường độ</span> <output>${sheen.a}</output><input type="range" min="0" max="1" step="0.01" value="${sheen.a}" data-sheen="a" aria-label="Cường độ ánh kim"></label>
        <label class="acf-slider"><span>Chu kỳ (giây)</span> <output>${sheen.period}</output><input type="range" min="2" max="20" step="0.5" value="${sheen.period}" data-sheen="period" aria-label="Chu kỳ ánh kim"></label>
        <label class="acf-check"><input type="checkbox" data-sheen="conic"${sheen.conic ? ' checked' : ''}> Xoay tròn</label>
      </div>
    </div>`;
}

export function mountFrameEditor(host, { item, page, onSaved, onChanged }) {
  const painter = createPainter();
  const key = item ? keyOf(item) : null;
  const visual = item?.visual;
  const shipped = Boolean(visual?.builtinId);
  const avatar = () => avatarImg('nonla');
  const params = visual?.params ?? {};

  const state = {
    template: visual?.template ?? 'painted',
    imageUrl: visual?.imageUrl ?? null,
    hole: params.hole ? { x: Number(params.hole.x), y: Number(params.hole.y), r: Number(params.hole.r) } : null,
    scale: params.scale ? Number(params.scale) : null,
    glowUrl: params.glowUrl ?? null,
    base: params.base ?? 'kimlong',
    effects: effectsFrom(visual?.template ? params.live : { aura: ['255,190,90', 0.28] }),
    sheen: sheenFrom(params.sheen),
    size: null,
  };

  const visualBody = () => {
    const live = liveFrom(state.effects);
    const body = { live };
    if (state.sheen.on) body.sheen = sheenValue(state.sheen);
    // Left out, a clone keeps its base's sheen; strength 0 is how it switches one off.
    if (state.template === 'builtin-clone') return { template: 'builtin-clone', imageUrl: null, params: { base: state.base, sheen: { rgb: state.sheen.color, a: 0, period: state.sheen.period }, ...body } };
    if (state.hole) body.hole = state.hole;
    if (state.scale) body.scale = state.scale;
    if (state.glowUrl) body.glowUrl = state.glowUrl;
    return { template: 'painted', imageUrl: state.imageUrl, params: body };
  };

  /** The drawing the preview canvases read; they follow it on their next paint. */
  const applyPreview = () => {
    if (shipped) return;
    const words = { name: 'Xem trước', rar: 'rare', src: '' };
    const live = liveFrom(state.effects);
    if (state.template === 'builtin-clone') defineFrame(PREVIEW_ID, { ...words, base: state.base, live, sheen: sheenValue(state.sheen) });
    else if (state.imageUrl && state.hole) defineFrame(PREVIEW_ID, { ...words, imageUrl: state.imageUrl, hole: state.hole, scale: state.scale ?? 1, live, sheen: sheenValue(state.sheen), glowUrl: state.glowUrl });
    else defineFrame(PREVIEW_ID, { ...words, base: 'none', live, sheen: null });
  };

  const previewId = () => (shipped ? key : PREVIEW_ID);

  const render = () => {
    const look = blockHtml({
      id: 'acf-look-title',
      title: 'Hình ảnh',
      body: `
        <div class="acf-modes" role="radiogroup" aria-labelledby="acf-look-title">
          <label class="acf-choice"><input type="radio" name="acf-template" value="painted"${state.template === 'painted' ? ' checked' : ''}> Ảnh vẽ tay tải lên</label>
          <label class="acf-choice"><input type="radio" name="acf-template" value="builtin-clone"${state.template === 'builtin-clone' ? ' checked' : ''}> Biến thể từ viền có sẵn</label>
        </div>
        <div class="acf-template" data-for-template="painted">
          ${uploadHtml({ label: 'Chọn ảnh PNG/WebP nền trong suốt', attr: 'data-picture', note: 'Dưới 5 MB; lỗ avatar cần trong suốt để không che avatar.', statusAttr: 'data-picture-status' })}
          <div class="acf-align-wrap" data-align-wrap></div>
          <div class="acf-grid3" data-hole-fields>
            <div class="acf-field"><label for="acf-hole-x">Tâm X (px)</label><input class="field-input" id="acf-hole-x" type="number" min="0" inputmode="numeric" data-hole="x"></div>
            <div class="acf-field"><label for="acf-hole-y">Tâm Y (px)</label><input class="field-input" id="acf-hole-y" type="number" min="0" inputmode="numeric" data-hole="y"></div>
            <div class="acf-field"><label for="acf-hole-r">Bán kính (px)</label><input class="field-input" id="acf-hole-r" type="number" min="1" inputmode="numeric" data-hole="r"></div>
          </div>
          ${uploadHtml({ label: 'Lớp phát sáng (tùy chọn)', attr: 'data-glow', small: true, statusAttr: 'data-glow-status', statusText: state.glowUrl ? 'Đã có lớp phát sáng.' : '' })}
        </div>
        <div class="acf-template" data-for-template="builtin-clone">
          <p class="acf-note">Dùng lại hình của viền có sẵn, đổi hiệu ứng và màu bên dưới.</p>
          <div class="acf-bases" role="radiogroup" aria-label="Viền gốc">
            ${FRAME_BASES.map((id) => `<button class="acf-base${state.base === id ? ' is-on' : ''}" type="button" role="radio" aria-checked="${state.base === id}" data-base="${id}" title="${escapeHtml(FR[id].name)}"><canvas width="84" height="84" aria-hidden="true"></canvas><span>${escapeHtml(FR[id].name)}</span></button>`).join('')}
          </div>
        </div>`,
    });
    const effects = blockHtml({
      id: 'acf-effects-title',
      title: 'Hiệu ứng sống',
      sub: 'Bật, chọn màu và kéo thanh; khung xem trước đổi theo ngay.',
      body: `<div class="acf-effects">${effectsHtml(state.effects, state.sheen)}</div>`,
    });
    host.innerHTML = `
      <div class="acf-editor">
        <div class="acf-editor-main">
          <div class="acf-form">
            ${blockHtml({ id: 'acf-info-title', title: 'Thông tin', body: basicFieldsHtml(item) })}
            ${shipped ? '<p class="acf-shipped">Viền có sẵn của game giữ nguyên hình. Muốn đổi hiệu ứng, hãy tạo một biến thể từ nó.</p>' : look + effects}
            ${saveBarHtml(item, 'FRAME')}
          </div>
          ${item ? '<div class="acf-sections" data-sections></div>' : ''}
        </div>
        <aside class="adm-card acf-preview" data-preview aria-labelledby="acf-preview-title">
          <div class="acf-preview-head">
            <h2 class="adm-card-title" id="acf-preview-title">Xem trước</h2>
            <label class="acf-select"><span class="bpa-sr">Nền xem trước</span>
              <select class="field-input" data-background>${BACKGROUNDS.map((background) => `<option value="${background.id}">${background.label}</option>`).join('')}</select></label>
          </div>
          <div class="acf-preview-stage hs-root" data-stage="profile">
            <figure><canvas data-preview-canvas style="width:236px;height:236px" width="236" height="236" aria-label="Xem trước cỡ 236 px" role="img"></canvas><figcaption>236 px, ở hồ sơ</figcaption></figure>
            <figure><canvas data-preview-canvas style="width:160px;height:160px" width="160" height="160" aria-label="Xem trước cỡ 160 px" role="img"></canvas><figcaption>160 px, trong lưới</figcaption></figure>
          </div>
        </aside>
      </div>`;
    wire();
  };

  const syncHoleFields = () => {
    if (!state.hole) return;
    for (const axis of ['x', 'y', 'r']) {
      const input = host.querySelector(`[data-hole="${axis}"]`);
      if (input && document.activeElement !== input) input.value = String(Math.round(state.hole[axis]));
    }
  };

  /* ---- lining up the avatar hole: drag the circle, drag its handle, and the sample avatar shows through the picture ---- */

  const placeHole = () => {
    const wrap = host.querySelector('[data-align]');
    if (!wrap || !state.size || !state.hole) return;
    const { width, height } = state.size;
    const { x, y, r } = state.hole;
    const ring = wrap.querySelector('[data-ring]');
    const sample = wrap.querySelector('[data-sample]');
    const handle = wrap.querySelector('[data-handle]');
    for (const element of [ring, sample]) {
      element.style.left = `${((x - r) / width) * 100}%`;
      element.style.top = `${((y - r) / height) * 100}%`;
      element.style.width = `${((r * 2) / width) * 100}%`;
      element.style.height = `${((r * 2) / height) * 100}%`;
    }
    handle.style.left = `${((x + r) / width) * 100}%`;
    handle.style.top = `${(y / height) * 100}%`;
    syncHoleFields();
  };

  /** The sample avatar in the hole. It arrives a moment after the page asks for it. */
  const paintSample = (canvas) => {
    const stop = painter.onPaint(() => {
      const image = avatar();
      if (!image) return;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      stop();
    });
  };

  const clampHole = () => {
    const { width, height } = state.size;
    const { hole } = state;
    hole.r = Math.max(4, Math.min(hole.r, Math.max(width, height)));
    hole.x = Math.max(0, Math.min(hole.x, width));
    hole.y = Math.max(0, Math.min(hole.y, height));
  };

  const drawAligner = () => {
    const wrap = host.querySelector('[data-align-wrap]');
    if (!wrap) return;
    if (!state.imageUrl) {
      wrap.innerHTML = '<p class="acf-align-empty">Chưa có ảnh. Sau khi tải ảnh, kéo vòng tròn vào đúng lỗ avatar.</p>';
      return;
    }
    wrap.innerHTML = '<p class="acf-note">Đang mở ảnh…</p>';
    const image = new Image();
    image.crossOrigin = state.imageUrl.startsWith('/') ? null : 'anonymous';
    image.onerror = () => { wrap.innerHTML = '<p class="acf-status is-warning">Không mở được ảnh này.</p>'; };
    image.onload = () => {
      state.size = { width: image.naturalWidth, height: image.naturalHeight };
      if (!state.hole) state.hole = { x: image.naturalWidth / 2, y: image.naturalHeight / 2, r: Math.min(image.naturalWidth, image.naturalHeight) * 0.3 };
      wrap.innerHTML = `
        <div class="acf-align" data-align style="aspect-ratio:${image.naturalWidth}/${image.naturalHeight}">
          <canvas class="acf-align-sample" data-sample width="256" height="256" aria-hidden="true"></canvas>
          <img class="acf-align-art" src="${escapeHtml(state.imageUrl)}" alt="Ảnh viền đang căn" draggable="false">
          <div class="acf-align-ring" data-ring role="slider" aria-label="Vị trí lỗ avatar. Kéo để di chuyển" tabindex="0" aria-valuetext="Vòng tròn lỗ avatar"></div>
          <div class="acf-align-handle" data-handle role="slider" aria-label="Bán kính lỗ avatar. Kéo để đổi" tabindex="0" aria-valuetext="Nút đổi bán kính"></div>
        </div>
        <p class="acf-note">${image.naturalWidth}×${image.naturalHeight} px. Kéo vòng tròn, kéo nút để đổi bán kính; phím mũi tên chỉnh từng điểm.</p>`;
      wireAligner();
      paintSample(wrap.querySelector('[data-sample]'));
      placeHole();
      applyPreview();
    };
    image.src = state.imageUrl;
  };

  const wireAligner = () => {
    const area = host.querySelector('[data-align]');
    const pixelsPerCss = () => state.size.width / area.getBoundingClientRect().width;
    const toImage = (event) => {
      const rect = area.getBoundingClientRect();
      const k = state.size.width / rect.width;
      return { x: (event.clientX - rect.left) * k, y: (event.clientY - rect.top) * k };
    };
    const dragging = (element, onMove) => {
      element.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        const start = toImage(event);
        const hole = { ...state.hole };
        const move = (next) => {
          onMove(toImage(next), start, hole);
          clampHole();
          placeHole();
          applyPreview();
        };
        const up = () => {
          element.removeEventListener('pointermove', move);
          element.removeEventListener('pointerup', up);
          element.removeEventListener('pointercancel', up);
        };
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', up);
        element.addEventListener('pointercancel', up);
      });
    };
    const ring = area.querySelector('[data-ring]');
    const handle = area.querySelector('[data-handle]');
    dragging(ring, (at, start, hole) => {
      state.hole.x = hole.x + at.x - start.x;
      state.hole.y = hole.y + at.y - start.y;
    });
    dragging(handle, (at) => {
      state.hole.r = Math.hypot(at.x - state.hole.x, at.y - state.hole.y);
    });
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    ring.addEventListener('keydown', (event) => {
      const step = arrows[event.key];
      if (!step) return;
      event.preventDefault();
      const k = Math.max(1, Math.round(pixelsPerCss()));
      state.hole.x += step[0] * k;
      state.hole.y += step[1] * k;
      clampHole();
      placeHole();
      applyPreview();
    });
    handle.addEventListener('keydown', (event) => {
      const step = arrows[event.key];
      if (!step) return;
      event.preventDefault();
      state.hole.r += (step[0] - step[1]) * Math.max(1, Math.round(pixelsPerCss()));
      clampHole();
      placeHole();
      applyPreview();
    });
  };

  /* ---- what is on the page ---- */

  const showTemplate = () => host.querySelectorAll('[data-for-template]').forEach((block) => { block.hidden = block.dataset.forTemplate !== state.template; });

  const setOutput = (input) => {
    const output = input.closest('label')?.querySelector('output');
    if (output) output.textContent = input.value;
  };

  /** Moves the controls to what a clone starts from: the base frame's own effects. */
  const adoptBase = (id) => {
    state.base = id;
    state.effects = effectsFrom(liveOf(id) ?? {});
    state.sheen = sheenFrom(sheenOf(id));
    host.querySelectorAll('[data-base]').forEach((button) => {
      const on = button.dataset.base === id;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', String(on));
    });
    const section = host.querySelector('[data-effect]')?.parentElement;
    if (section) {
      section.querySelectorAll('.acf-effect').forEach((row) => row.remove());
      section.insertAdjacentHTML('beforeend', effectsHtml(state.effects, state.sheen));
      wireEffects();
    }
    applyPreview();
  };

  const wireEffects = () => {
    host.querySelectorAll('[data-effect-on]').forEach((input) => input.addEventListener('change', () => { state.effects[input.dataset.effectOn].on = input.checked; applyPreview(); }));
    host.querySelectorAll('[data-effect-color]').forEach((input) => input.addEventListener('input', () => { state.effects[input.dataset.effectColor].color = rgbOf(input.value); applyPreview(); }));
    host.querySelectorAll('[data-effect-kind]').forEach((input) => input.addEventListener('change', () => { state.effects[input.dataset.effectKind].kind = input.value; applyPreview(); }));
    host.querySelectorAll('[data-effect-value]').forEach((input) => input.addEventListener('input', () => {
      state.effects[input.dataset.effectValue].values[Number(input.dataset.index)] = Number(input.value);
      setOutput(input);
      applyPreview();
    }));
    host.querySelectorAll('[data-sheen]').forEach((input) => input.addEventListener('input', () => {
      const field = input.dataset.sheen;
      if (field === 'on' || field === 'conic') state.sheen[field] = input.checked;
      else if (field === 'color') state.sheen.color = rgbOf(input.value);
      else { state.sheen[field] = Number(input.value); setOutput(input); }
      applyPreview();
    }));
  };

  const wire = () => {
    host.querySelector('[data-save]').addEventListener('click', (event) => {
      saveCosmetic({ item, category: 'FRAME', root: host, visual: shipped ? null : visualBody(), button: event.currentTarget, onSaved });
    });
    if (item) mountSections(host, item, page, onChanged);
    host.querySelector('[data-background]').addEventListener('change', (event) => { host.querySelector('[data-stage]').dataset.stage = event.target.value; });
    host.querySelectorAll('[data-preview-canvas]').forEach((canvas) => {
      const stop = painter.onPaint((seconds) => paintFrame(canvas, previewId(), seconds, avatar()));
      cleanups.push(() => { stop(); forgetCanvas(canvas); });
    });
    if (shipped) return;

    host.querySelectorAll('input[name="acf-template"]').forEach((input) => input.addEventListener('change', () => {
      state.template = input.value;
      showTemplate();
      applyPreview();
    }));
    showTemplate();
    wirePictureInput(host.querySelector('[data-picture]'), {
      status: host.querySelector('[data-picture-status]'),
      onPicture: ({ url }) => {
        state.imageUrl = url;
        state.hole = null;
        drawAligner();
      },
    });
    wirePictureInput(host.querySelector('[data-glow]'), {
      needsAlpha: false,
      status: host.querySelector('[data-glow-status]'),
      onPicture: ({ url }) => {
        state.glowUrl = url;
        host.querySelector('[data-glow-status]').textContent = 'Đã có lớp phát sáng.';
        applyPreview();
      },
    });
    host.querySelectorAll('[data-hole]').forEach((input) => input.addEventListener('input', () => {
      if (!state.hole || !state.size || input.value === '') return;
      state.hole[input.dataset.hole] = Number(input.value);
      clampHole();
      placeHole();
      applyPreview();
    }));
    host.querySelectorAll('[data-base]').forEach((button) => {
      painter.add(button.querySelector('canvas'), () => button.dataset.base, avatar, { still: true });
      button.addEventListener('click', () => adoptBase(button.dataset.base));
    });
    wireEffects();
    drawAligner();
    applyPreview();
  };

  const cleanups = [];
  render();
  return () => {
    for (const cleanup of cleanups) cleanup();
    painter.dispose();
  };
}
