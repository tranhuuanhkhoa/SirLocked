import { escapeHtml, render } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { navigate } from '../services/navigation.js';
import { startTutorial, tutorialStatus } from '../services/tutorial.js';

/** /tan-thu: what the newcomer tutorial teaches, and the button that starts or resumes it. */
export async function renderTutorialPage(app, { signal } = {}) {
  render(app, `<div class="tt-page"><div class="tt-page-card"><p class="tt-page-note">${escapeHtml(tr('Loading…', 'Đang tải…'))}</p></div></div>`);
  const status = await tutorialStatus({ fresh: true });
  if (signal?.aborted) return;
  const resume = Boolean(status?.activeRoomId);
  const startLabel = resume ? tr('Continue the tutorial', 'Chơi tiếp màn tân thủ')
    : status?.completed ? tr('Play it again', 'Chơi lại màn tân thủ') : tr('Start the tutorial', 'Bắt đầu màn tân thủ');
  render(app, `
    <div class="tt-page">
      <article class="tt-page-card">
        <p class="tt-kicker">${escapeHtml(tr('Tutorial case', 'Hồ sơ nhập môn'))}</p>
        <h1>${escapeHtml(tr('The blue-and-white teapot', 'Ấm men lam'))}</h1>
        <img class="tt-page-cover" src="/assets/pixel/tan-thu/cover.png" alt="${escapeHtml(tr('Shikumen lane in 1930s Shanghai', 'Ngõ Thạch Khố Môn, Thượng Hải 1930'))}">
        <p>${escapeHtml(tr('Shanghai, 1930. A Ming teapot vanishes from a teahouse counter. A short, very easy case played alone, with a gold arrow showing every step.', 'Thượng Hải, 1930. Chiếc ấm men lam đời Minh biến mất khỏi quầy trà lâu. Một vụ án ngắn, rất dễ, chơi một mình, có mũi tên vàng chỉ từng bước.'))}</p>
        <ul class="tt-page-list">
          <li>${escapeHtml(tr('Walk, question people and inspect objects', 'Đi lại, hỏi chuyện và khám vật chứng'))}</li>
          <li>${escapeHtml(tr('Take a photo, solve a puzzle, use hints', 'Chụp ảnh hiện trường, giải đố, dùng gợi ý'))}</li>
          <li>${escapeHtml(tr('Catch a lie with evidence, then accuse the culprit', 'Vạch lời nói dối bằng chứng cứ, rồi buộc tội thủ phạm'))}</li>
        </ul>
        ${status?.required ? `<p class="tt-page-note">${escapeHtml(tr('Finish it once to unlock rooms and matchmaking.', 'Chơi xong một lần để mở khóa tạo phòng và tìm trận.'))}</p>` : ''}
        ${status?.completed ? `<p class="tt-page-note">${escapeHtml(tr('Already finished. Replays give no rewards.', 'Bạn đã chơi xong. Chơi lại không có thưởng.'))}</p>` : ''}
        <div class="tt-page-actions">
          <button type="button" class="bpa-btn bpa-btn--red" data-tt-start>${escapeHtml(startLabel)}</button>
          ${status?.required ? '' : `<button type="button" class="bpa-btn bpa-btn--ink" data-tt-back>${escapeHtml(tr('Back to the menu', 'Về sảnh'))}</button>`}
        </div>
        <p class="tt-choice-error" role="alert" hidden></p>
      </article>
    </div>`);
  app.querySelector('[data-tt-back]')?.addEventListener('click', () => navigate('/menu'));
  const button = app.querySelector('[data-tt-start]');
  button?.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await startTutorial();
    } catch (error) {
      const note = app.querySelector('.tt-choice-error');
      note.hidden = false;
      note.textContent = error?.message || tr('The tutorial could not start.', 'Không mở được màn tân thủ.');
      button.disabled = false;
    }
  });
}
