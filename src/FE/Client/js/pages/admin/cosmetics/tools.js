import { adminCosmeticsApi } from '../../../api/adminCosmeticsApi.js';
import { person } from '../../../components/admin/ui.js';
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
    <section class="adm-card acf-tool" data-grant aria-labelledby="acf-grant-title">
      <h2 class="adm-card-title" id="acf-grant-title">Cấp mỹ phẩm cho người chơi</h2>
      <div class="acf-field">
        <label for="acf-player">Người chơi</label>
        <input class="field-input acf-input-soft" id="acf-player" type="search" data-player-search autocomplete="off" placeholder="Tìm người chơi theo tên hoặc email" aria-describedby="acf-player-hint">
        <span class="acf-hint" id="acf-player-hint">Gõ ít nhất 2 ký tự</span>
      </div>
      <div class="acf-players" data-players role="listbox" aria-label="Kết quả tìm kiếm"></div>
      <p class="acf-chosen" data-player-chosen>Chưa chọn người chơi.</p>
      <div class="acf-field">
        <label for="acf-grant-item">Món được cấp</label>
        <select class="field-input" id="acf-grant-item" data-grant-item>${options}</select>
      </div>
      <p class="acf-note">Món giao dịch được sẽ chiếm một ô trong túi, túi đầy thì không cấp được. Món không giao dịch được thì không chiếm ô.</p>
      <div><button class="btn btn-primary acf-btn-wide" type="button" data-grant-send disabled>Cấp</button></div>
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
        ? '<p class="acf-hint">Không tìm thấy ai.</p>'
        : found.map((one, index) => `<button class="acf-player" type="button" role="option" aria-selected="false" data-index="${index}">${person(one.fullName, `${one.email} · Cấp ${one.level}`)}</button>`).join('');
      results.querySelectorAll('[data-index]').forEach((button) => button.addEventListener('click', () => {
        player = found[Number(button.dataset.index)];
        results.querySelectorAll('[data-index]').forEach((other) => other.setAttribute('aria-selected', String(other === button)));
        chosen.textContent = `Đã chọn: ${player.fullName} (${player.email})`;
        chosen.classList.add('is-chosen');
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
    <section class="adm-card acf-tool" data-xp aria-labelledby="acf-xp-title">
      <h2 class="adm-card-title" id="acf-xp-title">Thiết lập kinh nghiệm</h2>
      <div class="acf-grid2">
        <div class="acf-field"><label for="acf-rare-xp">KN khi đổi một món Hiếm</label>
          <input class="field-input" id="acf-rare-xp" type="number" min="1" max="100000" inputmode="numeric" value="${page.rareXp}" data-rare></div>
        <div class="acf-field"><label for="acf-epic-xp">KN khi đổi một món Quý</label>
          <input class="field-input" id="acf-epic-xp" type="number" min="1" max="100000" inputmode="numeric" value="${page.epicXp}" data-epic></div>
      </div>
      <div><button class="btn btn-primary acf-btn-wide" type="button" data-save-xp>Lưu</button></div>
      <div class="acf-formula">
        <h3>Công thức cấp (chỉ xem)</h3>
        <p>KN để lên cấp tiếp theo = 200 + 40 × (cấp − 1). Cấp tối đa: ${page.maxLevel}. Đến cấp tối đa thì KN dừng lại.</p>
      </div>
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
