import { adminChestsApi } from '../../../api/adminChestsApi.js';
import { newRequestId } from '../../../api/marketApi.js';
import { person, stateBox } from '../../../components/admin/ui.js';
import { escapeHtml, render } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { confirmDialog, errorMessages, errorsHtml, number } from './shared.js';

const SEARCH_DEBOUNCE_MS = 250;
const MAX_PER_GRANT = 12;

/** Gives a detective chests and keys, for support and events. */
export async function renderChestGrant(host, { signal } = {}) {
  let chests = [];
  try {
    chests = (await adminChestsApi.chests())?.chests ?? [];
  } catch (error) {
    if (!signal?.aborted) render(host, stateBox('error', 'Không tải được danh sách hòm', errorMessages(error)[0]));
    return;
  }
  if (signal?.aborted) return;

  let selected = null;
  let timer = 0;
  let ticket = 0;
  signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });

  render(host, `
    <section class="adm-card ac-grant" aria-labelledby="ac-grant-title">
      <div>
        <h2 class="adm-card-title" id="ac-grant-title">Cấp hòm &amp; chìa</h2>
        <p class="ac-card-note">Món được cấp vào túi của người chơi và chiếm ô như đồ mua (tối đa 12 ô). Hòm đang tắt vẫn cấp được.</p>
      </div>
      <label class="ac-field"><span>Người nhận</span>
        <input class="field-input ac-input-soft" type="search" autocomplete="off" placeholder="Tìm người chơi theo tên hoặc email" data-ac-player-search>
      </label>
      <div class="ac-player-results" data-ac-player-results></div>
      <p class="ac-player-chosen" data-ac-player-chosen hidden></p>
      <div class="ac-grant-grid">
        <label class="ac-field"><span>Hòm</span>
          <select class="field-input" name="chestId">
            ${chests.map((chest) => `<option value="${escapeHtml(chest.id)}">${escapeHtml(chest.name)}${chest.active ? '' : ' (đang tắt)'}</option>`).join('')}
          </select>
        </label>
        <label class="ac-field"><span>Số hòm</span><input class="field-input" type="number" name="chests" min="0" max="${MAX_PER_GRANT}" step="1" value="1" inputmode="numeric"></label>
        <label class="ac-field"><span>Số chìa</span><input class="field-input" type="number" name="keys" min="0" max="${MAX_PER_GRANT}" step="1" value="1" inputmode="numeric"></label>
      </div>
      <div data-ac-errors></div>
      <div><button type="button" class="btn btn-primary ac-btn-wide" data-ac-grant>Cấp</button></div>
    </section>`);

  const $ = (selector) => host.querySelector(selector);
  const results = $('[data-ac-player-results]');
  const chosen = $('[data-ac-player-chosen]');

  async function search(text) {
    const mine = ++ticket;
    if (!text.trim()) {
      results.innerHTML = '';
      return;
    }
    try {
      const players = await adminChestsApi.players(text);
      if (signal?.aborted || mine !== ticket) return;
      results.innerHTML = (players ?? []).map((player) => `
        <button type="button" class="ac-pick" data-ac-player="${escapeHtml(player.id)}" data-name="${escapeHtml(player.fullName)}">
          ${person(player.fullName, player.email)}
        </button>`).join('') || '<p class="ac-card-note">Không tìm thấy ai.</p>';
    } catch (error) {
      if (!signal?.aborted && mine === ticket) results.innerHTML = errorsHtml(errorMessages(error));
    }
  }

  $('[data-ac-player-search]').addEventListener('input', (event) => {
    clearTimeout(timer);
    const text = event.target.value;
    timer = setTimeout(() => search(text), SEARCH_DEBOUNCE_MS);
  });

  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ac-player]');
    if (!button) return;
    selected = { id: button.dataset.acPlayer, name: button.dataset.name };
    results.innerHTML = '';
    chosen.hidden = false;
    chosen.textContent = `Người nhận: ${selected.name}`;
  });

  $('[data-ac-grant]').addEventListener('click', () => {
    const showErrors = (messages) => { $('[data-ac-errors]').innerHTML = errorsHtml(messages); };
    const chestCount = Number($('[name="chests"]').value || 0);
    const keyCount = Number($('[name="keys"]').value || 0);
    if (!selected) {
      showErrors(['Hãy chọn người nhận.']);
      return;
    }
    if (chestCount < 0 || keyCount < 0 || chestCount + keyCount < 1 || chestCount > MAX_PER_GRANT || keyCount > MAX_PER_GRANT) {
      showErrors([`Hãy cấp ít nhất một món, mỗi loại tối đa ${MAX_PER_GRANT}.`]);
      return;
    }
    showErrors([]);
    const chestId = $('[name="chestId"]').value;
    const chest = chests.find((entry) => entry.id === chestId);
    // One per grant: confirming again after a lost answer must not give everything twice.
    const requestId = newRequestId();
    confirmDialog({
      title: `Cấp cho ${selected.name}?`,
      body: `<p>${number(chestCount)} ${escapeHtml(chest?.name ?? chestId)} và ${number(keyCount)} ${escapeHtml(chest?.keyName ?? 'chìa')} cho ${escapeHtml(selected.name)}.</p>`,
      confirmLabel: 'Cấp',
      signal,
      action: async (reason) => {
        await adminChestsApi.grant({ userId: selected.id, chestId, chests: chestCount, keys: keyCount, reason, requestId });
        toast(`Đã cấp cho ${selected.name}.`, 'success');
      },
    });
  });
}
