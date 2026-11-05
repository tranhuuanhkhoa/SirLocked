import { adminCosmeticsApi } from '../../../api/adminCosmeticsApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { CATEGORIES, askReason, errorText, rarityLabel } from './shared.js';

const SEARCH_DEBOUNCE_MS = 250;

/** Giving a cosmetic to one player: find them, pick the item, say why. */
export function mountGrantTool(host, { page, defId }) {
  let timer = 0;
  let player = null;
  let asked = 0;

  const options = CATEGORIES.map((category) => `
    <optgroup label="${escapeHtml(category.label)}">
      ${page.items.filter((item) => item.category === category.id).map((item) => `<option value="${escapeHtml(item.id)}"${item.id === defId ? ' selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(rarityLabel(item.rarity))}${item.retired ? ' · đã retire' : ''}</option>`).join('')}
    </optgroup>`).join('');

  host.innerHTML = `
    <section class="acf-section acf-narrow" data-grant>
      <h3>Cấp mỹ phẩm cho người chơi</h3>
      <label class="field-label" for="acf-player">Tìm người chơi theo tên hoặc email</label>
      <input class="field-input" id="acf-player" data-player-search autocomplete="off" placeholder="Gõ ít nhất 2 ký tự">
      <div class="acf-players" data-players role="listbox" aria-label="Kết quả tìm kiếm"></div>
      <p class="muted small" data-player-chosen>Chưa chọn người chơi.</p>
      <label class="field-label" for="acf-grant-item">Món được cấp</label>
      <select class="field-input" id="acf-grant-item" data-grant-item>${options}</select>
      <p class="muted small">Món giao dịch được sẽ chiếm một ô trong túi, túi đầy thì không cấp được. Món không giao dịch được thì không chiếm ô.</p>
      <div class="acf-actions"><button class="btn btn-primary" type="button" data-grant-send disabled>Cấp cho người chơi</button></div>
    </section>`;

  const results = host.querySelector('[data-players]');
  const chosen = host.querySelector('[data-player-chosen]');
  const send = host.querySelector('[data-grant-send]');

  const search = async (text) => {
    const ticket = ++asked;
    try {
      const found = await adminCosmeticsApi.searchPlayers(text);
      if (ticket !== asked) return;
      results.innerHTML = found.length === 0
        ? '<p class="muted small">Không tìm thấy ai.</p>'
        : found.map((one, index) => `<button class="acf-player" type="button" role="option" aria-selected="false" data-index="${index}"><b>${escapeHtml(one.fullName)}</b><span>${escapeHtml(one.email)} · Cấp ${one.level}</span></button>`).join('');
      results.querySelectorAll('[data-index]').forEach((button) => button.addEventListener('click', () => {
        player = found[Number(button.dataset.index)];
        results.querySelectorAll('[data-index]').forEach((other) => other.setAttribute('aria-selected', String(other === button)));
        chosen.textContent = `Đã chọn: ${player.fullName} (${player.email})`;
        send.disabled = false;
      }));
    } catch (error) {
      toast(errorText(error), 'error');
    }
  };

  host.querySelector('[data-player-search]').addEventListener('input', (event) => {
    clearTimeout(timer);
    const text = event.target.value.trim();
    if (text.length < 2) {
      asked++;
      results.innerHTML = '';
      return;
    }
    timer = setTimeout(() => search(text), SEARCH_DEBOUNCE_MS);
  });

  send.addEventListener('click', async () => {
    if (!player) return;
    const select = host.querySelector('[data-grant-item]');
    const name = select.selectedOptions[0]?.textContent ?? '';
    const reason = await askReason({ heading: `Cấp cho ${player.fullName}?`, detail: name, confirmLabel: 'Cấp' });
    if (!reason) return;
    send.disabled = true;
    try {
      await adminCosmeticsApi.grant(select.value, player.id, reason);
      toast(`Đã cấp cho ${player.fullName}.`, 'success');
    } catch (error) {
      toast(errorText(error), 'error');
    } finally {
      send.disabled = false;
    }
  });

  return () => clearTimeout(timer);
}

/** What an exchanged item pays. The level curve lives in code and is only shown. */
export function mountXpTool(host, { page }) {
  host.innerHTML = `
    <section class="acf-section acf-narrow" data-xp>
      <h3>Thiết lập kinh nghiệm</h3>
      <div class="acf-grid2">
        <div><label class="field-label" for="acf-rare-xp">KN khi đổi một món Hiếm</label>
          <input class="field-input" id="acf-rare-xp" type="number" min="1" max="100000" value="${page.rareXp}" data-rare></div>
        <div><label class="field-label" for="acf-epic-xp">KN khi đổi một món Quý</label>
          <input class="field-input" id="acf-epic-xp" type="number" min="1" max="100000" value="${page.epicXp}" data-epic></div>
      </div>
      <div class="acf-actions"><button class="btn btn-primary" type="button" data-save-xp>Lưu</button></div>
      <h4>Công thức cấp (chỉ xem)</h4>
      <p class="muted small">KN để lên cấp tiếp theo = 200 + 40 × (cấp − 1). Cấp tối đa: ${page.maxLevel}. Đến cấp tối đa thì KN dừng lại.</p>
    </section>`;
  const rare = host.querySelector('[data-rare]');
  const epic = host.querySelector('[data-epic]');
  host.querySelector('[data-save-xp]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const nextRare = Number(rare.value);
    const nextEpic = Number(epic.value);
    const reason = await askReason({
      heading: 'Đổi tỉ lệ kinh nghiệm?',
      detail: `Món Hiếm ${page.rareXp} → ${nextRare} KN, món Quý ${page.epicXp} → ${nextEpic} KN. Áp dụng ngay cho mọi lần đổi tiếp theo.`,
      confirmLabel: 'Đổi tỉ lệ',
      danger: true,
    });
    if (!reason) return;
    button.disabled = true;
    try {
      const saved = await adminCosmeticsApi.setXp(nextRare, nextEpic, reason);
      page.rareXp = saved.rareXp;
      page.epicXp = saved.epicXp;
      toast('Đã lưu tỉ lệ kinh nghiệm.', 'success');
    } catch (error) {
      toast(errorText(error), 'error');
    } finally {
      button.disabled = false;
    }
  });
  return () => {};
}
