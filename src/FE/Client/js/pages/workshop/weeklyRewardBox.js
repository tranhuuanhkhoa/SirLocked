import { weeklyApi } from '../../api/weeklyApi.js';
import { session } from '../../services/session.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { pixelIconUrl } from '../chest/chestSprites.js';

/**
 * "Phần thưởng tuần này" on the weekly challenge page: which chests the challenge can drop and how likely each is,
 * what the signed-in player already has of it, and a button for every chest still waiting for room in the bag.
 *
 * weeklyRewardBoxHtml(challenge) is the static box (everything the anonymous challenge payload knows);
 * mountWeeklyRewardBox(container, { signal }) then fills in the viewer's own state. Server strings are escaped here,
 * chest icons come from the shared chest sprites (the market uses the same helper).
 */

const chestName = (name, nameEn) => tr(nameEn || name || '', name || nameEn || '');

/** "60%", "33.33%"; '' for a value that is not a number. */
function percentText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n}%` : '';
}

function iconHtml(iconKey) {
  const src = pixelIconUrl(iconKey);
  return src
    ? `<img class="bpa-ch-rw-icon" src="${src}" width="40" height="40" alt="" draggable="false">`
    : '<span class="bpa-ch-rw-icon" aria-hidden="true"></span>';
}

function chestRowHtml(drop) {
  const percent = Number(drop.percent);
  const bar = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return `
    <li class="bpa-ch-rw-chest" data-weekly-chest="${escapeHtml(drop.chestId)}">
      ${iconHtml(drop.iconKey)}
      <span class="bpa-ch-rw-name">${escapeHtml(chestName(drop.name, drop.nameEn))}</span>
      <b class="bpa-ch-rw-pct">${escapeHtml(percentText(drop.percent))}</b>
      <span class="bpa-ch-rw-bar" aria-hidden="true"><i style="width:${bar}%"></i></span>
    </li>`;
}

export function weeklyRewardBoxHtml(challenge) {
  const drops = Array.isArray(challenge?.drops) ? challenge.drops : [];
  const minScore = Number(challenge?.minScore);
  const min = Number.isFinite(minScore) ? minScore : 80;
  return `
    <section class="bpa-ch-reward" aria-labelledby="ch-reward-h" data-weekly-reward>
      <h2 id="ch-reward-h" class="bpa-ch-rw-h">${tr('This week\'s reward', 'Phần thưởng tuần này')}</h2>
      <p class="bpa-ch-rw-rule">${tr(
        `Score ${min} or more and solve the case: get 1 chest (once a week).`,
        `Đạt từ ${min} điểm và phá được vụ: nhận 1 hòm (mỗi tuần 1 lần).`,
      )}</p>
      ${drops.length
        ? `<ul class="bpa-ch-rw-list">${drops.map(chestRowHtml).join('')}</ul>`
        : `<p class="bpa-ch-rw-empty">${tr('No chest is dropping this week.', 'Tuần này chưa có hòm nào rớt.')}</p>`}
      <p class="bpa-ch-rw-state" data-weekly-state aria-live="polite" hidden></p>
      <ul class="bpa-ch-rw-waiting" data-weekly-waiting hidden></ul>
      <a class="bpa-link bpa-link--gold bpa-ch-rw-link" href="/kho-ruong">${tr('See what is inside the chests in the Chest Vault', 'Xem đồ trong hòm ở Kho Rương')}</a>
    </section>`;
}

function setState(el, html, { text = false } = {}) {
  if (text) el.textContent = html;
  else el.innerHTML = html;
  el.hidden = !html;
}

/** Why a claim failed, in words. A bag that is still full is the one the player can fix. */
function claimError(error) {
  const code = error?.errors?.code ?? error?.code;
  if (code === 'SLOTS_FULL') return tr('Your bag is still full.', 'Túi vẫn đầy.');
  if (code === 'WEEKLY_DROP_NOT_FOUND') return tr('This chest was not found.', 'Không tìm thấy hòm này.');
  return error?.message || tr('Could not claim the chest. Please try again.', 'Không nhận được hòm. Vui lòng thử lại.');
}

/**
 * Fills the viewer's part of the box. A guest keeps the static box plus a sign-in line; a signed-in player gets
 * this week's state and the claim buttons. Safe to call again after the page was drawn again.
 */
export async function mountWeeklyRewardBox(container, { signal } = {}) {
  const root = container?.querySelector('[data-weekly-reward]');
  if (!root) return;
  const stateEl = root.querySelector('[data-weekly-state]');
  const waitingEl = root.querySelector('[data-weekly-waiting]');

  if (!session.user()) {
    setState(stateEl, `<a class="bpa-link bpa-link--gold" href="/login">${tr('Sign in to claim your chest', 'Đăng nhập để nhận hòm')}</a>`);
    return;
  }

  let reward;
  try {
    reward = await weeklyApi.reward();
  } catch {
    if (signal?.aborted || !root.isConnected) return;
    setState(stateEl, tr('Could not load your chest status.', 'Không tải được trạng thái nhận hòm.'), { text: true });
    return;
  }
  if (signal?.aborted || !root.isConnected) return;

  const thisWeek = reward?.thisWeek ?? null;
  const claimed = new Set();
  const inFlight = new Set();
  // This week's waiting chest is in `waiting` too: one entry, one button, per drop id.
  const waiting = [];
  for (const drop of [thisWeek, ...(Array.isArray(reward?.waiting) ? reward.waiting : [])]) {
    if (drop?.state === 'WAITING' && drop.id && !waiting.some((entry) => entry.id === drop.id)) waiting.push(drop);
  }

  function stateText() {
    if (!thisWeek) return tr('Not claimed yet', 'Chưa nhận');
    const name = chestName(thisWeek.chestName, thisWeek.chestNameEn);
    if (thisWeek.state === 'DONE' || claimed.has(thisWeek.id)) return tr(`Claimed: ${name}`, `Đã nhận: ${name}`);
    if (thisWeek.state === 'WAITING') return tr('Bag full — clear some room, then press Claim chest', 'Túi đầy — dọn túi rồi bấm Nhận hòm');
    if (thisWeek.state === 'PENDING') return tr(`Delivering: ${name}…`, `Đang trao hòm: ${name}…`);
    return tr('Not claimed yet', 'Chưa nhận');
  }

  function waitingRowHtml(drop) {
    const name = chestName(drop.chestName, drop.chestNameEn);
    const older = drop.weekKey && drop.weekKey !== reward?.weekKey;
    return `
      <li class="bpa-ch-rw-wait" data-weekly-drop="${escapeHtml(drop.id)}">
        ${iconHtml(drop.iconKey)}
        <span class="bpa-ch-rw-name">${escapeHtml(name)}${older ? ` <small>${escapeHtml(tr(`week of ${drop.weekKey}`, `tuần ${drop.weekKey}`))}</small>` : ''}</span>
        ${claimed.has(drop.id)
          ? `<span class="bpa-ch-rw-done">${tr('Claimed', 'Đã nhận')}</span>`
          : `<button type="button" class="bpa-btn bpa-btn--red bpa-btn--sm bpa-ch-rw-claim" data-weekly-claim${inFlight.has(drop.id) ? ' disabled aria-busy="true"' : ''}>${tr('Claim chest', 'Nhận hòm')}</button>`}
        <p class="bpa-ch-rw-msg" data-weekly-msg role="alert" hidden></p>
      </li>`;
  }

  function paint() {
    setState(stateEl, stateText(), { text: true });
    waitingEl.innerHTML = waiting.map(waitingRowHtml).join('');
    waitingEl.hidden = waiting.length === 0;
  }

  waitingEl.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-weekly-claim]');
    const row = button?.closest('[data-weekly-drop]');
    if (!button || !row || button.disabled) return;
    const id = row.dataset.weeklyDrop;
    if (inFlight.has(id)) return;
    inFlight.add(id);
    const message = row.querySelector('[data-weekly-msg]');
    message.hidden = true;
    message.textContent = '';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await weeklyApi.claim(id);
      if (signal?.aborted) return;
      claimed.add(id);
      paint();
    } catch (error) {
      if (signal?.aborted) return;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      message.textContent = claimError(error);
      message.hidden = false;
    } finally {
      inFlight.delete(id);
    }
  });

  paint();
}
