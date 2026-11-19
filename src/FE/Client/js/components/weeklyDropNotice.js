import { weeklyApi } from '../api/weeklyApi.js';
import { chestIconUrl, chestPictureUrl } from '../pages/chest/chestSprites.js';
import { tr } from '../services/i18n.js';
import { escapeHtml } from '../utils/dom.js';

/**
 * One line on the result page about the weekly challenge chest this game earned (or why it did not).
 *
 * The server decides (GET .../challenge/reward/{roomId} -> { status, drop, minScore }); this only words it:
 * GRANTED / WAITING name the chest, the other statuses say what is missing, and a game that was not the challenge
 * (NOT_CHALLENGE) or a week with no chest to give (NO_CHEST) shows nothing. Like hydrateRewardChip, a failed call
 * is swallowed: the result page must never break over a bonus line.
 */

const CHEST_LINK = '/kho-ruong';
const CHALLENGE_LINK = '/workshop/challenge';

/** The chest's name in the viewer's language, already escaped for HTML. */
function chestNameHtml(drop) {
  const name = tr(drop?.chestNameEn || drop?.chestName || '', drop?.chestName || drop?.chestNameEn || '');
  return escapeHtml(name || tr('a chest', 'một hòm'));
}

/** The chest's picture (the shared pixel sprite, as the challenge page draws it), or '' with no drop or no picture. */
function chestPictureHtml(drop) {
  if (!drop) return '';
  const src = chestIconUrl(drop);
  const picture = chestPictureUrl(drop) ? ' is-picture' : '';
  return src
    ? `<img class="bpa-weekly-drop-icon${picture}" src="${escapeHtml(src)}" width="40" height="40" alt="${chestNameHtml(drop)}" draggable="false">`
    : '';
}

/** The chest line with its picture in front of it. */
const chestLineHtml = (drop, text) =>
  `<span class="bpa-weekly-drop-chest">${chestPictureHtml(drop)}<span class="bpa-weekly-drop-text">${text}</span></span>`;

/** The markup of the notice for one status, or '' when there is nothing to say. */
function noticeHtml(reward) {
  const drop = reward.drop ?? null;
  switch (reward.status) {
    case 'GRANTED': {
      const name = chestNameHtml(drop);
      return `${chestLineHtml(drop, tr(`Weekly Challenge: you got ${name}!`, `Thử thách tuần: bạn nhận được ${name}!`))}
        <a class="bpa-btn bpa-btn--gold bpa-btn--sm bpa-weekly-drop-btn" href="${CHEST_LINK}">${tr('Open in the Chest Vault', 'Mở ở Kho Rương')}</a>`;
    }
    case 'WAITING': {
      const name = chestNameHtml(drop);
      const link = (text) => `<a class="bpa-weekly-drop-link" href="${CHALLENGE_LINK}">${text}</a>`;
      return chestLineHtml(drop, tr(
        `Weekly Challenge: your bag is full, ${name} is waiting on ${link('the Weekly Challenge page')}.`,
        `Thử thách tuần: túi đầy, ${name} đang chờ ở ${link('trang Thử thách tuần')}.`,
      ));
    }
    case 'LOW_SCORE': {
      const min = Number(reward.minScore);
      if (!Number.isFinite(min)) return '';
      return `<span class="bpa-weekly-drop-text">${tr(
        `You need ${min} points to get the Weekly Challenge chest.`,
        `Cần ${min} điểm để nhận hòm Thử thách tuần.`,
      )}</span>`;
    }
    case 'NOT_SOLVED':
      return `<span class="bpa-weekly-drop-text">${tr('Solve the case to get the Weekly Challenge chest.', 'Phải phá được vụ mới nhận hòm Thử thách tuần.')}</span>`;
    case 'UNVERIFIED':
      return `<span class="bpa-weekly-drop-text">${tr('Verify your email to get the Weekly Challenge chest.', 'Xác minh email để nhận hòm Thử thách tuần.')}</span>`;
    case 'AUTHOR':
      return `<span class="bpa-weekly-drop-text">${tr('Authors do not get a chest from their own case.', 'Tác giả không nhận hòm từ vụ của mình.')}</span>`;
    case 'ALREADY_THIS_WEEK':
      return `<span class="bpa-weekly-drop-text">${tr('You already got this week\'s Weekly Challenge chest.', 'Bạn đã nhận hòm Thử thách tuần này.')}</span>`;
    default:
      return ''; // NOT_CHALLENGE, NO_CHEST and anything a newer server might add
  }
}

/** Fills `container` (a hidden `.bpa-weekly-drop`) once the weekly reward of this room is known. */
export async function hydrateWeeklyDrop(container, roomId) {
  if (!container || !roomId) return;
  let reward = null;
  try {
    reward = await weeklyApi.rewardForRoom(roomId);
  } catch {
    return;
  }
  if (!reward || !container.isConnected) return;
  const html = noticeHtml(reward);
  if (!html) return;
  container.innerHTML = html;
  container.dataset.weeklyDropStatus = reward.status;
  container.hidden = false;
}
