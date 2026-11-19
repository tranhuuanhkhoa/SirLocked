import { weeklyApi } from '../../api/weeklyApi.js';
import { session } from '../../services/session.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { chestIconUrl, chestPictureUrl } from '../chest/chestSprites.js';
import { fmt } from '../market/marketKit.js';

/**
 * "Phần thưởng tuần này" on the weekly challenge page: which chests the challenge can drop and how likely each is,
 * what the signed-in player already has of it, and a button for every chest still waiting for room in the bag.
 *
 * weeklyRewardBoxHtml(challenge) is the static box (everything the anonymous challenge payload knows);
 * mountWeeklyRewardBox(container, { signal }) then fills in the viewer's own state. Server strings are escaped here,
 * chest icons come from the shared chest sprites (the market uses the same helper).
 */

const chestName = (name, nameEn) => tr(nameEn || name || '', name || nameEn || '');

/** "60%"; "33,33%" in Vietnamese and "33.33%" in English (the market's number format); '' for a value that is not a number. */
function percentText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${fmt(n)}%` : '';
}

/** `drop` names the chest by iconKey and look: its own picture when an admin gave it one, else its pixel drawing. */
function iconHtml(drop) {
  const src = chestIconUrl(drop);
  const picture = chestPictureUrl(drop) ? ' is-picture' : '';
  return src
    ? `<img class="bpa-ch-rw-icon${picture}" src="${escapeHtml(src)}" width="40" height="40" alt="" draggable="false">`
    : '<span class="bpa-ch-rw-icon" aria-hidden="true"></span>';
}

function chestRowHtml(drop) {
  const percent = Number(drop.percent);
  const bar = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return `
    <li class="bpa-ch-rw-chest" data-weekly-chest="${escapeHtml(drop.chestId)}">
      ${iconHtml(drop)}
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

/**
 * The waiting chests alone, for a week with no challenge: no odds (nothing drops), no state of this week, only the
 * chests from earlier weeks still waiting for room. Hidden until mountWeeklyRewardBox(container, { waitingOnly: true })
 * finds at least one, so a guest or a player with nothing waiting sees just the blank page.
 */
export function weeklyWaitingBoxHtml() {
  return `
    <section class="bpa-ch-reward bpa-ch-reward--waiting" aria-labelledby="ch-waiting-h" data-weekly-reward hidden>
      <h2 id="ch-waiting-h" class="bpa-ch-rw-h">${tr('Chests waiting for you', 'Hòm đang chờ nhận')}</h2>
      <p class="bpa-ch-rw-rule">${tr('Clear some room in your bag, then press Claim chest.', 'Dọn túi rồi bấm Nhận hòm.')}</p>
      <ul class="bpa-ch-rw-waiting" data-weekly-waiting hidden></ul>
    </section>`;
}

function setState(el, html, { text = false } = {}) {
  if (!el) return; // the waiting-only box has no state line
  if (text) el.textContent = html;
  else el.innerHTML = html;
  el.hidden = !html;
}

/** Why a claim failed, in words. A bag that is still full is the one the player can fix. */
function claimError(error) {
  // http.js reports a request that never got an answer as status 0 with an English message.
  if (error?.status === 0) return tr('Could not reach the server, please try again.', 'Không kết nối được máy chủ, thử lại sau.');
  const code = error?.errors?.code ?? error?.code;
  if (code === 'SLOTS_FULL') return tr('Your bag is still full.', 'Túi vẫn đầy.');
  if (code === 'WEEKLY_DROP_NOT_FOUND') return tr('This chest was not found.', 'Không tìm thấy hòm này.');
  return error?.message || tr('Could not claim the chest. Please try again.', 'Không nhận được hòm. Vui lòng thử lại.');
}

/**
 * Fills the viewer's part of the box. A guest keeps the static box plus a sign-in line; a signed-in player gets
 * this week's state and the claim buttons. Safe to call again after the page was drawn again.
 *
 * `waitingOnly` is for the box of weeklyWaitingBoxHtml(): it stays hidden for a guest, on a failed load and when
 * nothing is waiting, and shows only the waiting chests with their claim buttons.
 */
export async function mountWeeklyRewardBox(container, { signal, waitingOnly = false } = {}) {
  const root = container?.querySelector('[data-weekly-reward]');
  if (!root) return;
  const stateEl = waitingOnly ? null : root.querySelector('[data-weekly-state]');
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
  // Per-drop UI state. Rows are painted from it, so a row that is repainted for one drop never loses another's.
  const inFlight = new Set();
  const errors = new Map();
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
    return `<li class="bpa-ch-rw-wait" data-weekly-drop="${escapeHtml(drop.id)}">
        ${iconHtml(drop)}
        <span class="bpa-ch-rw-name">${escapeHtml(name)}${older ? ` <small>${escapeHtml(tr(`week of ${drop.weekKey}`, `tuần ${drop.weekKey}`))}</small>` : ''}</span>
        ${claimed.has(drop.id)
          ? `<span class="bpa-ch-rw-done">${tr('Claimed', 'Đã nhận')}</span>`
          : `<button type="button" class="bpa-btn bpa-btn--red bpa-btn--sm bpa-ch-rw-claim" data-weekly-claim${inFlight.has(drop.id) ? ' disabled aria-busy="true"' : ''}>${tr('Claim chest', 'Nhận hòm')}</button>`}
        <p class="bpa-ch-rw-msg" data-weekly-msg role="alert"${errors.has(drop.id) ? '' : ' hidden'}>${escapeHtml(errors.get(drop.id) ?? '')}</p>
      </li>`;
  }

  function paint() {
    setState(stateEl, stateText(), { text: true });
    waitingEl.innerHTML = waiting.map(waitingRowHtml).join('');
    waitingEl.hidden = waiting.length === 0;
    if (waitingOnly) root.hidden = waiting.length === 0;
  }

  const rowOf = (id) => [...waitingEl.children].find((row) => row.dataset.weeklyDrop === id) ?? null;

  /** Repaints one drop's row from the state and returns the live row. Other rows are left as they are. */
  function paintRow(id) {
    const drop = waiting.find((entry) => entry.id === id);
    const old = rowOf(id);
    if (!drop || !old) return null;
    old.outerHTML = waitingRowHtml(drop);
    return rowOf(id);
  }

  waitingEl.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-weekly-claim]');
    const id = button?.closest('[data-weekly-drop]')?.dataset.weeklyDrop;
    if (!id || button.disabled || inFlight.has(id)) return;
    const hadFocus = document.activeElement === button;
    inFlight.add(id);
    errors.delete(id);
    paintRow(id);

    let failure = null;
    try {
      await weeklyApi.claim(id);
      claimed.add(id);
    } catch (error) {
      failure = error;
    }
    inFlight.delete(id);
    if (signal?.aborted) return;
    if (failure) errors.set(id, claimError(failure));
    // The row is looked up again: other claims may have repainted the list while this one was on its way.
    const row = paintRow(id);
    setState(stateEl, stateText(), { text: true });
    // Back to a working button: keep the keyboard where it was unless the player moved on meanwhile.
    if (failure && hadFocus && document.activeElement === document.body) row?.querySelector('[data-weekly-claim]')?.focus();
  });

  paint();
}
