import { EN, RARITY_OF_SERVER, avatarImg, reduce, warmEntranceArt } from '../../../cosmetics/index.js';
import { playEntrance } from '../../../cosmetics/entrances.js';
import { defineEntrance } from '../../../cosmetics/fx.js';
import { createPainter } from '../../../cosmetics/painter.js';
import { paintStageThumb } from '../../../cosmetics/stage.js';
import { escapeHtml } from '../../../utils/dom.js';
import { acquisitionHtml, basicFieldsHtml, saveCosmetic, statusHtml, wireAcquisition, wirePictureInput, wireStatus } from './editorCommon.js';
import { hexOf, keyOf, rgbOf } from './shared.js';

const PREVIEW_ID = '__pv_entrance';
const TEMPLATES = ['lang-le', 'anh-trang', 'mac-vu', 'truc-lam', 'van-kiem', 'huyet-nguyet', 'hac-duc', 'than-tham', 'kim-long', 'phuong-hoang'];
const CREATURE_TEMPLATES = { 'kim-long': 'Ảnh sinh vật bay ngang, đầu quay sang phải. Thân sẽ uốn lượn.', 'phuong-hoang': 'Ảnh sinh vật nhìn thẳng, sà xuống và vỗ cánh.' };
const SWORD_TEMPLATE = 'van-kiem';
const STILL_SECONDS = 2.5;
/* What the full-screen preview shows around the effect. */
const SAMPLE_PLAYER = { name: 'Thám tử mẫu', frameId: 'kimlong', titleId: 'kim-long', avatar: () => avatarImg('nonla') };

export function mountEntranceEditor(host, { item, page, onSaved }) {
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
  };
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
    }, { listed: false });
  };
  const previewId = () => (shipped ? keyOf(item) : PREVIEW_ID);

  const visualBody = () => {
    const body = {};
    if (state.tintOn) body.tint = state.tint;
    if (state.duration) body.duration = state.duration;
    if (CREATURE_TEMPLATES[state.template] && state.imageUrl) body.imageUrl = state.imageUrl;
    if (state.template === SWORD_TEMPLATE && state.swordUrl) body.swordUrl = state.swordUrl;
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
  };

  host.innerHTML = `
    <div class="acf-editor">
      <div class="acf-editor-main">
        <section class="acf-section">
          <h3>Thông tin hiệu ứng</h3>
          ${basicFieldsHtml(item, { withDescription: true })}
        </section>
        ${shipped ? '<p class="muted small">Hiệu ứng có sẵn của game giữ nguyên hình. Muốn đổi màu hay đổi ảnh, hãy tạo hiệu ứng mới từ mẫu của nó.</p>' : `
        <section class="acf-section">
          <h3>Mẫu</h3>
          <label class="field-label" for="acf-template">Kiểu chuyển động</label>
          <select class="field-input" id="acf-template" data-template>
            ${TEMPLATES.map((id) => `<option value="${id}"${state.template === id ? ' selected' : ''}>${escapeHtml(EN[id]?.n ?? id)}</option>`).join('')}
          </select>
          <div class="acf-effect">
            <label class="acf-check"><input type="checkbox" data-tint-on${state.tintOn ? ' checked' : ''}> Đổi màu chủ đạo</label>
            <div class="acf-effect-body"><input type="color" value="${hexOf(state.tint)}" data-tint aria-label="Màu chủ đạo"></div>
            <p class="muted small">Đổi màu ánh sáng và hạt. Ảnh vẽ tay giữ nguyên màu của ảnh.</p>
          </div>
          <label class="acf-slider">Thời lượng (giây) <output data-duration-text>${state.duration ?? 'theo mẫu'}</output>
            <input type="range" min="4" max="12" step="0.5" value="${state.duration ?? 8}" data-duration aria-label="Thời lượng"></label>
          <button class="btn btn-ghost btn-sm" type="button" data-duration-reset>Dùng thời lượng của mẫu</button>
          <div data-creature>
            <label class="btn btn-ghost acf-upload">Tải ảnh sinh vật (PNG/WebP)
              <input type="file" accept="image/png,image/webp" data-creature-input hidden></label>
            <p class="muted small" data-creature-note></p>
            <p class="acf-status" data-creature-status>${state.imageUrl ? 'Đang dùng ảnh riêng.' : 'Đang dùng ảnh của mẫu.'}</p>
          </div>
          <div data-sword>
            <label class="btn btn-ghost acf-upload">Tải ảnh kiếm (PNG/WebP, mũi kiếm quay sang phải)
              <input type="file" accept="image/png,image/webp" data-sword-input hidden></label>
            <p class="acf-status" data-sword-status>${state.swordUrl ? 'Đang dùng ảnh riêng.' : 'Đang dùng ảnh của mẫu.'}</p>
          </div>
        </section>`}
        <div class="acf-actions"><button class="btn btn-primary" type="button" data-save>${item ? 'Lưu hiệu ứng' : 'Tạo hiệu ứng'}</button></div>
        ${item ? acquisitionHtml(item, page) + statusHtml(item) : ''}
      </div>
      <aside class="acf-preview" data-preview aria-label="Xem trước">
        <h3>Xem trước</h3>
        <div class="acf-preview-stage hs-root" data-stage="black">
          <canvas class="acf-stage-thumb" data-thumb width="480" height="270" role="img" aria-label="Hiệu ứng thu nhỏ"></canvas>
        </div>
        <button class="btn btn-primary" type="button" data-play>Xem thử toàn màn hình</button>
      </aside>
    </div>`;

  host.querySelector('[data-save]').addEventListener('click', (event) => {
    saveCosmetic({ item, category: 'ENTRANCE', root: host, visual: shipped ? null : visualBody(), button: event.currentTarget, onSaved });
  });
  if (item) {
    wireAcquisition(host, item, onSaved);
    wireStatus(host, item, onSaved);
  }
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
    showForTemplate();
    applyPreview();
  }

  return () => {
    stopThumb();
    playing?.cancel();
    painter.dispose();
  };
}
