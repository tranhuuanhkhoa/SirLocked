import { escapeHtml } from '../../../utils/dom.js';

export const CATEGORIES = [
  { id: 'FRAME', label: 'Viền' },
  { id: 'TITLE', label: 'Danh hiệu' },
  { id: 'ENTRANCE', label: 'Hiệu ứng vào sảnh' },
];

export const RARITIES = [
  { id: 'COMMON', label: 'Thường' },
  { id: 'RARE', label: 'Hiếm' },
  { id: 'EPIC', label: 'Quý' },
  { id: 'LEGENDARY', label: 'Huyền thoại' },
  { id: 'MYSTERY', label: 'Bí ẩn' },
];

export const METRICS = {
  Played: 'Số vụ đã chơi',
  Won: 'Số vụ thắng',
  MidnightWins: 'Số vụ phá lúc nửa đêm',
  NoHintWins: 'Số vụ phá không dùng gợi ý',
  CluesFound: 'Số manh mối tìm được',
  TestimoniesRecorded: 'Số lời khai ghi được',
  OwnsWatch217: 'Sở hữu Đồng hồ 2:17',
};

const PREFIXES = { FRAME: 'frame_', TITLE: 'title_', ENTRANCE: 'entrance_' };
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const PICTURE_TYPES = ['image/png', 'image/webp'];
const SLOW_PICTURE_SIDE = 2048;
const ALPHA_SAMPLE_SIDE = 256;
const OPAQUE_ALPHA = 250;

/** The id the drawing tables use: the server's id without its category. */
export const keyOf = (item) => item.id.slice(PREFIXES[item.category]?.length ?? 0);

export const rarityLabel = (id) => RARITIES.find((rarity) => rarity.id === id)?.label ?? id;

/** What this definition looks like to the tables in cosmetics/catalog.js. */
export function catalogEntryOf(item) {
  const way = item.acquisition;
  const chests = (way?.chests ?? []).filter((chest) => chest.active);
  return {
    id: item.id,
    category: item.category,
    rarity: item.rarity,
    name: item.name,
    description: item.displayDescription,
    visual: item.visual,
    level: way?.level ?? null,
    metric: way?.metric ?? null,
    target: way?.target ?? null,
    achievementCountable: Boolean(way?.metric),
    chests: chests.map((chest) => chest.name),
    activeChestCount: 0,
    isDefault: way?.mode === 'default',
  };
}

/** How it is obtained, in one line for a card. */
export function acquisitionText(item) {
  const way = item.acquisition;
  const parts = [];
  if (way.mode === 'default') parts.push('Mặc định');
  if (way.mode === 'level') parts.push(`Cấp ${way.level}`);
  if (way.mode === 'achievement') parts.push(way.metric ? `${METRICS[way.metric] ?? way.metric}: ${way.target}` : `Thành tích chưa đếm được (${way.target})`);
  if (way.chests.length > 0) parts.push(`Hòm: ${way.chests.map((chest) => chest.name).join(', ')}`);
  if (parts.length === 0) parts.push('Chỉ admin cấp');
  return parts.join(' · ');
}

export const hexOf = (rgb) => `#${String(rgb).split(',').map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;

export const rgbOf = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(',');

export const errorText = (error) => error?.message || 'Có lỗi xảy ra, hãy thử lại.';

/**
 * Looks at a picture before it is sent. `error` stops the upload; `warnings` are for the admin to weigh. A picture
 * with no transparency is allowed, because it may be meant that way, but as a frame it would cover the avatar.
 */
export async function checkPicture(file, { needsAlpha = true } = {}) {
  if (!PICTURE_TYPES.includes(file.type)) return { error: 'Chỉ nhận ảnh PNG hoặc WebP.', warnings: [] };
  if (file.size > MAX_PICTURE_BYTES) return { error: 'Ảnh phải nhỏ hơn 5 MB.', warnings: [] };
  const warnings = [];
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (Math.max(width, height) > SLOW_PICTURE_SIDE) warnings.push(`Ảnh rất lớn (${width}×${height}), máy người chơi có thể vẽ chậm. Nên dùng cạnh dài dưới ${SLOW_PICTURE_SIDE} px.`);
    if (needsAlpha) {
      const scale = Math.min(1, ALPHA_SAMPLE_SIDE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let transparent = false;
      for (let i = 3; i < data.length && !transparent; i += 4) transparent = data[i] < OPAQUE_ALPHA;
      if (!transparent) warnings.push('Ảnh này không có vùng trong suốt (kênh alpha), nên sẽ che mất avatar.');
    }
    bitmap.close();
  } catch {
    return { error: 'Không đọc được ảnh này.', warnings: [] };
  }
  return { warnings };
}

/**
 * A confirmation that needs a reason, for what changes things for players. Resolves to the reason, or null when
 * cancelled. The reason goes into the audit log.
 */
export function askReason({ heading, detail, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'acf-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', heading);
    overlay.innerHTML = `
      <form class="acf-modal-box">
        <h3>${escapeHtml(heading)}</h3>
        <p class="muted">${escapeHtml(detail)}</p>
        <label class="field-label" for="acf-reason">Lý do (ghi vào nhật ký)</label>
        <textarea class="field-input" id="acf-reason" rows="2" maxlength="500" required></textarea>
        <div class="acf-actions">
          <button class="btn btn-ghost" type="button" data-cancel>Hủy</button>
          <button class="btn ${danger ? 'acf-btn-danger' : 'btn-primary'}" type="submit" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`;
    const finish = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (event) => { if (event.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
    overlay.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = overlay.querySelector('textarea').value.trim();
      if (reason) finish(reason);
    });
    document.body.append(overlay);
    overlay.querySelector('textarea').focus();
  });
}
