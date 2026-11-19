import '../../../css/55-tutorial.css';
import { tutorialApi } from '../api/tutorialApi.js';
import { session } from './session.js';
import { navigate } from './navigation.js';
import { tr } from './i18n.js';
import { escapeHtml } from '../utils/dom.js';

export const TUTORIAL_PATH = '/tan-thu';
export const TUTORIAL_REQUIRED_CODE = 'TUTORIAL_REQUIRED';

/** Routes a beginner may not open before finishing the tutorial (they lead into normal rooms). */
export const TUTORIAL_GATED_PATTERNS = [/^\/create-room$/, /^\/rooms$/, /^\/find-game$/, /^\/join$/, /^\/lobby\//];

let cache = { userId: '', status: null, pending: null };
let choiceOpen = null;

/** The account's tutorial status, fetched once per signed-in user (call with fresh=true after a change). */
export async function tutorialStatus({ fresh = false } = {}) {
  const userId = session.user()?.userId ?? '';
  if (!userId || !session.isLoggedIn() || session.isAdmin()) return null;
  if (cache.userId !== userId) cache = { userId, status: null, pending: null };
  if (cache.status && !fresh) return cache.status;
  if (!cache.pending || fresh) {
    cache.pending = tutorialApi.status()
      .then((status) => {
        if (cache.userId === userId) cache.status = status ?? null;
        return status ?? null;
      })
      .catch(() => null)
      .finally(() => { if (cache.userId === userId) cache.pending = null; });
  }
  return cache.pending;
}

export function forgetTutorialStatus() {
  cache = { userId: '', status: null, pending: null };
}

/** True when the router must send this player to the tutorial instead of `path`. */
export async function tutorialBlocks(path) {
  if (!TUTORIAL_GATED_PATTERNS.some((pattern) => pattern.test(path))) return false;
  const status = await tutorialStatus();
  return Boolean(status?.required);
}

/** An API refusal that means "finish the tutorial first" (room create/join, matchmaking). */
export function isTutorialRequiredError(error) {
  return error?.status === 403 && (error?.errors?.code === TUTORIAL_REQUIRED_CODE || error?.errors?.Code === TUTORIAL_REQUIRED_CODE);
}

/**
 * A new account picks Kỳ cựu or Nhập môn once. Shows the choice when the server says it is still open and resolves
 * with the status after the choice (or null when nothing had to be asked).
 */
export async function ensureTutorialChoice() {
  const status = await tutorialStatus();
  if (!status?.needsChoice) return null;
  if (choiceOpen) return choiceOpen;
  choiceOpen = new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'tt-choice-backdrop';
    backdrop.dataset.testid = 'tutorial-choice';
    backdrop.innerHTML = `
      <section class="tt-choice" role="dialog" aria-modal="true" aria-labelledby="tt-choice-title">
        <p class="tt-kicker">${escapeHtml(tr('Welcome, detective', 'Chào mừng thám tử'))}</p>
        <h2 id="tt-choice-title">${escapeHtml(tr('Have you played Sir Locked before?', 'Bạn đã từng chơi Sir Locked chưa?'))}</h2>
        <p>${escapeHtml(tr('Pick once. Beginners play a short guided case first.', 'Chọn một lần. Người mới sẽ chơi một vụ án ngắn có hướng dẫn trước.'))}</p>
        <div class="tt-choice-grid">
          <button type="button" class="tt-choice-card" data-tt-path="BEGINNER">
            <b>${escapeHtml(tr('Beginner', 'Nhập môn'))}</b>
            <span>${escapeHtml(tr('New here. A 10-minute guided case shows every step, then real cases open.', 'Mới chơi lần đầu. Một vụ án 10 phút chỉ tay từng bước, xong mới mở vụ án thật.'))}</span>
            <em>${escapeHtml(tr('Recommended for new players', 'Nên chọn nếu mới chơi'))}</em>
          </button>
          <button type="button" class="tt-choice-card" data-tt-path="VETERAN">
            <b>${escapeHtml(tr('Veteran', 'Người chơi kỳ cựu'))}</b>
            <span>${escapeHtml(tr('I know detective games. Go straight to real cases; the tutorial stays in the menu.', 'Đã quen game trinh thám. Vào thẳng vụ án thật; màn tân thủ vẫn có trong sảnh nếu muốn chơi.'))}</span>
            <em>${escapeHtml(tr('Play right away', 'Chơi ngay'))}</em>
          </button>
        </div>
        <p class="tt-choice-error" role="alert" hidden></p>
      </section>`;
    document.body.append(backdrop);
    backdrop.querySelector('[data-tt-path="BEGINNER"]')?.focus();
    backdrop.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-tt-path]');
      if (!button) return;
      const buttons = backdrop.querySelectorAll('[data-tt-path]');
      buttons.forEach((candidate) => { candidate.disabled = true; });
      const error = backdrop.querySelector('.tt-choice-error');
      try {
        const next = await tutorialApi.choose(button.dataset.ttPath);
        cache.status = next ?? null;
        backdrop.remove();
        choiceOpen = null;
        resolve(next ?? null);
        if (next?.required) navigate(TUTORIAL_PATH);
      } catch (failure) {
        error.hidden = false;
        error.textContent = failure?.message || tr('Could not save your choice. Try again.', 'Chưa lưu được lựa chọn. Thử lại nhé.');
        buttons.forEach((candidate) => { candidate.disabled = false; });
      }
    });
  });
  return choiceOpen;
}

/** Starts (or resumes) the solo tutorial room and opens it. */
export async function startTutorial() {
  const started = await tutorialApi.start();
  if (!started?.roomId) throw new Error(tr('The tutorial could not start.', 'Không mở được màn tân thủ.'));
  navigate(`/game/${started.roomId}`);
  return started;
}

/** The menu strip: a beginner is pointed at the tutorial; everyone else may replay it from here. */
export async function hydrateTutorialBanner(container) {
  const slot = container.querySelector('#home-tutorial');
  if (!slot) return;
  const status = await tutorialStatus();
  if (!slot.isConnected || !status) return;
  const required = Boolean(status.required);
  slot.hidden = false;
  slot.innerHTML = `
    <p>${escapeHtml(required
      ? tr('You chose Beginner: play the short tutorial first to unlock rooms and matchmaking.', 'Bạn chọn Nhập môn: chơi màn tân thủ ngắn trước để mở khóa tạo phòng và tìm trận.')
      : tr('New to the game, or want a refresher? The tutorial case shows every step.', 'Mới chơi hay muốn ôn lại? Màn tân thủ chỉ tay từng bước.'))}</p>
    <a class="bpa-btn ${required ? 'bpa-btn--red' : 'bpa-btn--gold'} bpa-btn--sm" href="${TUTORIAL_PATH}" data-tt-open>${escapeHtml(status.activeRoomId
      ? tr('Continue tutorial', 'Chơi tiếp màn tân thủ')
      : tr('Tutorial', 'Màn tân thủ'))}</a>`;
}
