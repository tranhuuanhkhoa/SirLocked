import '../../../css/22-bpa-auth.css';
import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { languageSwitchMarkup, tr } from '../services/i18n.js';
import { pendingRoomInvite } from '../services/roomInvites.js';
import { googleLoginUrl } from '../../../config/apiUrls.js';

/* --------------------------------------------------------------------------
   Shared "Bảng phá án" account board, also used by the verify, reset and
   OAuth pages: a cork board of clues whose strings meet behind the card.
   -------------------------------------------------------------------------- */

export const ICON_ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
const ICON_LENS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M8 9.5a3 3 0 0 1 2.5-2"/></svg>';

const BOARD_DEFS = `
  <filter id="bpa-auth-glow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="bpa-auth-drop" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="2" dy="9" stdDeviation="8" flood-color="#000" flood-opacity=".55"/></filter>
  <filter id="bpa-auth-hdrop" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="1" dy="4" stdDeviation="4" flood-color="#3b2a14" flood-opacity=".3"/></filter>
  <filter id="bpa-auth-ink" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 3" result="speckle"/>
    <feComposite in="SourceGraphic" in2="speckle" operator="in"/>
  </filter>
  <radialGradient id="bpa-auth-pin-red" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#f3a291"/><stop offset=".45" stop-color="#c0392b"/><stop offset="1" stop-color="#6e1a12"/></radialGradient>
  <radialGradient id="bpa-auth-pin-gold" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff1c2"/><stop offset=".45" stop-color="#c7a24b"/><stop offset="1" stop-color="#5e4a1c"/></radialGradient>
  <radialGradient id="bpa-auth-wax" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#e06a55"/><stop offset=".42" stop-color="#b0291e"/><stop offset="1" stop-color="#5e130c"/></radialGradient>
  <linearGradient id="bpa-auth-sticky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ecd68a"/><stop offset="1" stop-color="#d6bc66"/></linearGradient>
  <linearGradient id="bpa-auth-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e3a4"/><stop offset=".5" stop-color="#c7a24b"/><stop offset="1" stop-color="#6e5522"/></linearGradient>
  <linearGradient id="bpa-auth-brass-v" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#efd78c"/><stop offset=".55" stop-color="#c7a24b"/><stop offset="1" stop-color="#85662a"/></linearGradient>
  <linearGradient id="bpa-auth-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8c8c86"/><stop offset=".35" stop-color="#f1f1ec"/><stop offset=".7" stop-color="#b4b4ad"/><stop offset="1" stop-color="#6a6a64"/></linearGradient>`;

/**
 * @param {object} board
 * @param {string} board.decor   SVG clue artwork in the 1440x900 board space
 * @param {Array<[number, number, number, number, string]>} board.threads x1 y1 x2 y2 delayClass
 * @param {Array<[number, number, 'red'|'gold']>} board.pins
 * @param {string} board.body    markup of the card section
 * @param {boolean} [board.centered] verify / reset layout (column centred vertically)
 * @param {string} [board.threadsClass] extra state class: is-solving / is-solved / is-cold
 */
export function authBoardMarkup({ decor, threads, pins, body, centered = false, threadsClass = '', notice = false }) {
  const lines = (kind) => threads.map(([x1, y1, x2, y2, delay]) =>
    `<path class="thread ${kind} ${delay}" pathLength="1" d="M${x1} ${y1}L${x2} ${y2}"/>`).join('');
  const pinMarks = pins.map(([cx, cy, color]) => `
    <ellipse cx="${cx + 2.4}" cy="${cy + 4.6}" rx="8" ry="5" fill="rgba(0,0,0,.45)"/>
    <circle cx="${cx}" cy="${cy}" r="8.5" fill="url(#bpa-auth-pin-${color})"/>`).join('');
  return `
    <div class="auth-screen bpa-auth">
      <div class="bpa-auth-backdrop" aria-hidden="true">
        <div class="bpa-auth-fit">
          <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
            <defs>${BOARD_DEFS}</defs>
            ${decor}
            <g class="bpa-auth-threads ${threadsClass}" data-auth-threads>
              <g transform="translate(2 5)">${lines('shadow')}</g>
              ${lines('red')}
            </g>
            <g>${pinMarks}</g>
          </svg>
        </div>
      </div>
      <div class="auth-panel">
        <div class="bpa-auth-lang">${languageSwitchMarkup('ui-language-switch-auth')}</div>
        <div class="bpa-auth-col${centered ? ' bpa-auth-col--center' : ''}${notice ? ' bpa-auth-col--notice' : ''}">
          <div class="bpa-auth-label bpa-auth-rise">
            <p class="bpa-auth-kicker">${tr('CASE BOARD · 221B', 'BẢNG PHÁ ÁN · 221B')}</p>
            <h1 class="bpa-auth-word">SIR <span>LOCKED</span></h1>
            <p class="bpa-auth-tagline">${tr('Two detectives. One locked case.', 'Hai thám tử. Một vụ án bí ẩn.')}</p>
          </div>
          ${body}
        </div>
      </div>
    </div>`;
}

/** Card head row: "THẺ ĐIỀU TRA ……… Nº 221". */
export function authHead(left, right = 'Nº 221') {
  return `<p class="bpa-auth-head"><span>${left}</span><span>${right}</span></p>`;
}

/** Password field with the magnifier reveal toggle (wire it with wireRevealButtons). */
export function passwordField({ id, name, label, autocomplete, hint = '', describedBy = '', minlength = '', extra = '' }) {
  return `
    <div class="bpa-auth-field">
      <div class="bpa-auth-labelrow">
        <label for="${id}" class="bpa-auth-flabel">${label}</label>
        ${hint}
      </div>
      <div class="bpa-auth-inputwrap">
        <input id="${id}" class="bpa-auth-input has-tool" name="${name}" type="password" required
               ${minlength ? `minlength="${minlength}"` : ''} autocomplete="${autocomplete}" spellcheck="false" placeholder="••••••••"
               ${describedBy ? `aria-describedby="${describedBy}"` : ''}>
        <button type="button" class="bpa-auth-reveal" data-reveal="${id}" aria-pressed="false"
                aria-label="${tr('Show password', 'Hiện mật khẩu')}">${ICON_LENS}</button>
      </div>
      ${extra}
    </div>`;
}

export function wireRevealButtons(root) {
  root.querySelectorAll('[data-reveal]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = root.querySelector(`#${button.dataset.reveal}`);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? tr('Hide password', 'Ẩn mật khẩu') : tr('Show password', 'Hiện mật khẩu'));
    });
  });
}

/** Strings go gold and the card pin glows while a request is in flight. */
export function setBoardState(root, state) {
  const threads = root.querySelector('[data-auth-threads]');
  threads?.classList.remove('is-solving', 'is-solved', 'is-cold');
  if (state) threads?.classList.add(`is-${state}`);
  root.querySelector('.bpa-auth-pin')?.classList.toggle('is-solving', state === 'solving');
}

const LOGIN_DECOR = () => `
  <g transform="translate(64 58) rotate(-5)">
    <g filter="url(#bpa-auth-drop)"><path d="M0 0H320V196L306 204L292 197L276 206L258 198L240 205L222 197L205 206L186 198L168 205L150 197L132 206L114 198L96 205L78 197L60 206L42 198L24 205L10 197L0 203Z" fill="#e3dbc9"/></g>
    <text x="16" y="25" class="bpa-auth-mono" font-size="9.5" letter-spacing="2" fill="#3a342b">${tr('LONDON DAILY NEWS', 'NHẬT BÁO LUÂN ĐÔN')}</text>
    <text x="304" y="25" class="bpa-auth-mono" font-size="9.5" letter-spacing="1" fill="#3a342b" text-anchor="end">${tr('No. 1221', 'SỐ 1221')}</text>
    <path d="M16 33H304M16 36.5H304" stroke="#3a342b" stroke-width=".8"/>
    <text x="16" y="66" class="bpa-auth-serif" font-size="25" font-weight="700" letter-spacing=".5" fill="#15120e">${tr('THE LOCKED', 'BÍ ẨN CĂN PHÒNG')}</text>
    <text x="16" y="94" class="bpa-auth-serif" font-size="25" font-weight="700" letter-spacing=".5" fill="#15120e">${tr('ROOM MYSTERY', 'KHÓA KÍN')}</text>
    <text x="16" y="114" class="bpa-auth-body" font-size="12.5" font-style="italic" fill="#3a342b">${tr('Police baffled — two detectives called in.', 'Cảnh sát bó tay — hai thám tử được mời vào cuộc.')}</text>
    <g fill="#8f8676" opacity=".55"><rect x="16" y="126" width="138" height="3"/><rect x="16" y="134" width="130" height="3"/><rect x="16" y="142" width="138" height="3"/><rect x="16" y="150" width="122" height="3"/><rect x="16" y="158" width="138" height="3"/><rect x="16" y="166" width="134" height="3"/><rect x="16" y="174" width="96" height="3"/><rect x="166" y="188" width="110" height="3"/></g>
    <rect x="166" y="124" width="138" height="58" fill="#2b2621"/>
    <path d="M235 136A9 9 0 0 1 240 152.5L243 170H227L230 152.5A9 9 0 0 1 235 136Z" fill="#d9cfb8"/>
  </g>
  <g transform="translate(104 318) rotate(4)">
    <g filter="url(#bpa-auth-drop)"><rect width="262" height="176" fill="#e7ddc5"/></g>
    <path d="M-2 132C40 112 82 152 130 134S220 98 264 114" fill="none" stroke="rgba(79,154,154,.42)" stroke-width="15"/>
    <path d="M0 30H262M0 72H262M14 0V176M58 0V176M104 0V120M150 0V176M196 0V176M240 0V176M0 104L120 96M150 40L262 18" fill="none" stroke="#ab9d7f" stroke-width="1.2"/>
    <path d="M0 46H262M80 0V176" fill="none" stroke="#cdbf9f" stroke-width="4"/>
    <path d="M131 0V176M0 88H262" stroke="rgba(0,0,0,.08)" stroke-width="1.5"/>
    <text x="16" y="60" class="bpa-auth-mono" font-size="7.5" letter-spacing="1.5" fill="#6b5f4b">${tr('BAKER ST', 'PHỐ BAKER')}</text>
    <ellipse cx="172" cy="52" rx="24" ry="17" transform="rotate(-12 172 52)" fill="none" stroke="#b8382b" stroke-width="2.4"/>
    <path d="M150 44C156 32 180 28 194 36" fill="none" stroke="#b8382b" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M166 46L178 58M178 46L166 58" stroke="#b8382b" stroke-width="2" stroke-linecap="round"/>
    <text x="200" y="30" class="bpa-auth-mono" font-size="11" font-weight="700" letter-spacing="1" fill="#b8382b">221B</text>
  </g>
  <g transform="translate(74 590) rotate(-4)">
    <g filter="url(#bpa-auth-drop)"><rect width="214" height="196" fill="url(#bpa-auth-sticky)"/></g>
    <text class="bpa-auth-body" font-size="22" font-style="italic" fill="#2a2318">
      <tspan x="20" y="58">${tr('Locked from', 'Cửa khóa trái')}</tspan>
      <tspan x="20" y="88">${tr('the inside…', 'từ bên trong…')}</tspan>
      <tspan x="20" y="118">${tr('so how did the', 'vậy hung thủ')}</tspan>
      <tspan x="20" y="148">${tr('culprit get out?', 'ra bằng lối nào?')}</tspan>
    </text>
    <path d="M20 96C54 92 90 99 124 93" fill="none" stroke="#b8382b" stroke-width="2" stroke-linecap="round"/>
  </g>
  <g transform="translate(1124 44) rotate(5)">
    <g filter="url(#bpa-auth-drop)"><rect width="236" height="292" fill="#f1ebde"/></g>
    <text x="18" y="30" class="bpa-auth-mono" font-size="10" letter-spacing="2" fill="#3a342b">${tr('PRINT · SAMPLE 04', 'VÂN TAY · MẪU 04')}</text>
    <path d="M18 40H218" stroke="rgba(182,64,48,.6)" stroke-width="1.2"/>
    <g transform="translate(118 145)" fill="none" stroke="#1d2a3a" stroke-width="1.7" stroke-linecap="round" opacity=".82">
      <path d="M-4 8V0A4 5 0 0 1 4 0V10"/><path d="M-11 22V0A11 13 0 0 1 11 0V26"/><path d="M-18 34V0A18 21 0 0 1 18 0V38" stroke-dasharray="60 5 200"/><path d="M-25 46V2A25 29 0 0 1 25 2V50"/><path d="M-32 56V4A32 37 0 0 1 32 4V60" stroke-dasharray="90 6 300"/><path d="M-39 64V6A39 45 0 0 1 39 6V68"/><path d="M-46 70V8A46 53 0 0 1 46 8V72" stroke-dasharray="40 5 160 7 400"/><path d="M-53 72V10A53 61 0 0 1 53 10V74"/><path d="M-60 70V14A60 69 0 0 1 60 14V64" stroke-dasharray="120 8 400"/><path d="M-56 86C-30 78 30 78 56 88"/><path d="M-50 96C-24 90 24 90 50 98"/><path d="M-40 106C-18 101 18 101 40 108"/>
    </g>
    <circle cx="152" cy="112" r="15" fill="none" stroke="#b8382b" stroke-width="2"/>
    <text x="18" y="276" class="bpa-auth-body" font-size="14" font-style="italic" fill="#4a4237">${tr('Door handle, inside', 'Tay nắm cửa, phía trong')}</text>
  </g>
  <g transform="translate(1046 396) rotate(-6)">
    <g filter="url(#bpa-auth-drop)"><path d="M28 0H284V146H28L0 118V28Z" fill="#c4a06b"/></g>
    <circle cx="30" cy="73" r="13" fill="none" stroke="#ece0c6" stroke-width="5"/>
    <circle cx="30" cy="73" r="8" fill="#1a130d"/>
    <text x="60" y="34" class="bpa-auth-mono" font-size="12" font-weight="700" letter-spacing="2" fill="#2a2318">${tr('EXHIBIT #3', 'TANG VẬT #3')}</text>
    <path d="M60 42H252" stroke="rgba(42,35,24,.4)"/>
    <g fill="none" stroke="#1d2a3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="96" cy="84" r="18"/><circle cx="96" cy="84" r="7"/><path d="M114 84H238"/><path d="M208 84V100H216V92H224V102H232V84"/></g>
    <text x="60" y="132" class="bpa-auth-body" font-size="15" font-style="italic" fill="#2a2318">${tr('Brass key', 'Chìa khóa đồng')}</text>
  </g>
  <g transform="translate(1104 630) rotate(3)">
    <g filter="url(#bpa-auth-drop)"><rect width="276" height="196" fill="#f3eee3"/></g>
    <path d="M0 40H276" stroke="rgba(182,64,48,.6)" stroke-width="1.2"/>
    <path d="M0 72H276M0 104H276M0 136H276M0 168H276" stroke="rgba(79,154,154,.45)"/>
    <text x="18" y="30" class="bpa-auth-mono" font-size="10" letter-spacing="2" fill="#3a342b">${tr('TIMELINE', 'DÒNG THỜI GIAN')}</text>
    <text x="18" y="66" class="bpa-auth-mono" font-size="12.5" fill="#2a2318">21:30<tspan x="74">${tr('Upstairs light off', 'Đèn tầng hai tắt')}</tspan></text>
    <text x="18" y="98" class="bpa-auth-mono" font-size="12.5" fill="#2a2318">22:15<tspan x="74">${tr('A knock at the door', 'Có tiếng gõ cửa')}</tspan></text>
    <text x="18" y="130" class="bpa-auth-mono" font-size="12.5" fill="#2a2318">23:47<tspan x="74">${tr('Locked from inside', 'Cửa bị khóa trái')}</tspan></text>
    <text x="18" y="162" class="bpa-auth-mono" font-size="12.5" font-weight="700" fill="#b8382b">??:??<tspan x="74">${tr('Detectives arrive', 'Thám tử tới')}</tspan></text>
  </g>`;

const LOGIN_THREADS = [
  [385.4, 220.6, 720, 450, 'd1'], [1141.2, 53.5, 720, 450, 'd2'], [130.8, 335.9, 720, 450, 'd3'],
  [1083.5, 465.5, 720, 450, 'd4'], [181.9, 598.5, 720, 450, 'd5'], [1343.1, 652.5, 720, 450, 'd6'],
  [130.8, 335.9, 181.9, 598.5, 'd7'], [1141.2, 53.5, 1083.5, 465.5, 'd7'], [1083.5, 465.5, 1343.1, 652.5, 'd7'],
  [130.8, 335.9, -20, 250, 'd7'], [1343.1, 652.5, 1460, 760, 'd7'],
];
const LOGIN_PINS = [
  [78.6, 64.7, 'gold'], [385.4, 220.6, 'red'], [130.8, 335.9, 'gold'], [181.9, 598.5, 'red'],
  [1141.2, 53.5, 'gold'], [1083.5, 465.5, 'red'], [1343.1, 652.5, 'gold'],
];

/** The login board (newspaper, map, fingerprint…) around any card body. */
export function loginBoardMarkup(body, { threadsClass = '', notice = false } = {}) {
  return authBoardMarkup({ decor: LOGIN_DECOR(), threads: LOGIN_THREADS, pins: LOGIN_PINS, body, threadsClass, notice });
}

const GOOGLE_MARK ='<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

export async function renderLoginPage(app) {
  const errorCode = new URLSearchParams(window.location.hash.split('?')[1] || '').get('error');
  const googleError = !errorCode ? '' : errorCode === 'google_cancelled'
    ? tr('Google sign-in was cancelled. Try again below, or sign in with your email and password.', 'Đăng nhập Google đã bị hủy. Bạn có thể thử lại bên dưới hoặc đăng nhập bằng email và mật khẩu.')
    : tr('Google sign-in could not be completed. Choose Continue with Google below to start a new sign-in attempt.', 'Không thể hoàn tất đăng nhập Google. Bấm Đăng nhập với Google bên dưới để bắt đầu lại.');
  if (session.isLoggedIn() && !googleError) {
    window.location.hash = pendingRoomInvite() || (session.isAdmin() ? '#/admin' : '#/menu');
    return;
  }
  const invite = pendingRoomInvite();

  const body = `
    <section class="bpa-auth-section bpa-auth-rise-late" aria-labelledby="auth-title-login">
      <div class="bpa-auth-tabs" role="group" aria-label="${tr('Log in or register', 'Đăng nhập hoặc đăng ký')}">
        <button type="button" class="bpa-auth-tab" data-tab="login" aria-pressed="true">${tr('Log in', 'Đăng nhập')}</button>
        <button type="button" class="bpa-auth-tab" data-tab="register" aria-pressed="false">${tr('Register', 'Đăng ký')}</button>
      </div>
      <div class="bpa-auth-card">
        <span class="bpa-auth-pin" aria-hidden="true"></span>
        <div class="bpa-auth-swap" data-swap>
          <div data-view-head="login">
            ${authHead(tr('Case card', 'Thẻ điều tra'))}
            <h2 id="auth-title-login" class="bpa-auth-title" tabindex="-1">${tr('Start investigating', 'Bắt đầu phá án')}</h2>
            <p class="bpa-auth-sub">${tr('Every clue leads back to you.', 'Mọi manh mối đều dẫn về bạn.')}</p>
          </div>
          <div data-view-head="register" hidden>
            ${authHead(tr('New file', 'Hồ sơ mới'), tr('Nº PENDING', 'Nº CHỜ CẤP'))}
            <h2 id="auth-title-register" class="bpa-auth-title" tabindex="-1">${tr('Join 221B', 'Gia nhập 221B')}</h2>
            <p class="bpa-auth-sub">${tr('Open your detective file to start investigating.', 'Lập hồ sơ thám tử để bắt đầu phá án.')}</p>
          </div>
          <div data-view-head="forgot" hidden>
            ${authHead(tr('Urgent telegram', 'Điện tín khẩn'), tr('TO 221B', 'GỬI 221B'))}
            <h2 id="auth-title-forgot" class="bpa-auth-title" tabindex="-1">${tr('Forgot password?', 'Quên mật khẩu?')}</h2>
            <p class="bpa-auth-sub">${tr('Enter your email to receive a password reset link.', 'Nhập email để nhận liên kết đặt lại mật khẩu.')}</p>
          </div>

          ${googleError ? `
            <div class="bpa-auth-note bpa-auth-note--warn" role="alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a3f27" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>
              <div>
                <p class="k">${errorCode === 'google_cancelled' ? tr('Google sign-in cancelled', 'Đăng nhập Google đã hủy') : tr('Google sign-in failed', 'Đăng nhập Google thất bại')}</p>
                <p>${escapeHtml(googleError)}</p>
              </div>
            </div>` : ''}
          ${invite ? `
            <div class="bpa-auth-note bpa-auth-note--invite auth-hint" data-hide-on="forgot">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2f6363" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20.5V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v16"/><path d="M3 20.5h18"/><path d="M15 12.5h.01"/></svg>
              <div>
                <p class="k">${tr('Your partner is waiting', 'Đồng đội đang chờ')}</p>
                <p>${tr('Sign in or register to join your partner. Your invitation is saved while you verify your email.', 'Đăng nhập hoặc đăng ký để vào cùng đồng đội. Lời mời được giữ trong lúc bạn xác minh email.')}</p>
              </div>
            </div>` : ''}

          <form id="form-login" class="bpa-auth-form">
            <div class="bpa-auth-field">
              <label for="auth-login-email" class="bpa-auth-flabel"><span aria-hidden="true">01 — </span>Email</label>
              <input id="auth-login-email" class="bpa-auth-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
            </div>
            ${passwordField({
              id: 'auth-login-password', name: 'password', autocomplete: 'current-password',
              label: `<span aria-hidden="true">02 — </span>${tr('Password', 'Mật khẩu')}`,
              hint: `<a href="#" id="link-forgot" class="bpa-auth-link">${tr('Forgot password?', 'Quên mật khẩu?')}</a>`,
            })}
            <button class="bpa-auth-primary" type="submit" data-label="${tr('Log in', 'Đăng nhập')}" data-busy="${tr('Following the trail…', 'Đang lần theo dấu…')}">
              <span>${tr('Log in', 'Đăng nhập')}</span>${ICON_ARROW}
            </button>
          </form>

          <form id="form-register" class="bpa-auth-form bpa-auth-form--tight" hidden>
            <div class="bpa-auth-field">
              <label for="auth-reg-name" class="bpa-auth-flabel"><span aria-hidden="true">01 — </span>${tr('Full name', 'Họ và tên')}</label>
              <input id="auth-reg-name" class="bpa-auth-input" name="fullName" type="text" required minlength="2" autocomplete="name" placeholder="Detective Holmes">
            </div>
            <div class="bpa-auth-field">
              <label for="auth-reg-email" class="bpa-auth-flabel"><span aria-hidden="true">02 — </span>Email</label>
              <input id="auth-reg-email" class="bpa-auth-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
            </div>
            ${passwordField({
              id: 'auth-reg-password', name: 'password', autocomplete: 'new-password', minlength: 6, describedBy: 'auth-reg-hint',
              label: `<span aria-hidden="true">03 — </span>${tr('Password', 'Mật khẩu')}`,
              hint: `<span id="auth-reg-hint" class="bpa-auth-hint">${tr('At least 6 characters, including letters and numbers.', 'Tối thiểu 6 ký tự, gồm chữ và số.')}</span>`,
            })}
            <button class="bpa-auth-primary" type="submit" data-label="${tr('Create account', 'Tạo tài khoản')}" data-busy="${tr('Opening your file…', 'Đang lập hồ sơ…')}">
              <span>${tr('Create account', 'Tạo tài khoản')}</span>${ICON_ARROW}
            </button>
          </form>

          <form id="form-forgot" class="bpa-auth-form" hidden>
            <div class="bpa-auth-field">
              <label for="auth-forgot-email" class="bpa-auth-flabel"><span aria-hidden="true">01 — </span>Email</label>
              <input id="auth-forgot-email" class="bpa-auth-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
            </div>
            <button class="bpa-auth-primary" type="submit" data-label="${tr('Send request', 'Gửi yêu cầu')}" data-busy="${tr('Sending the telegram…', 'Đang gửi điện tín…')}">
              <span>${tr('Send request', 'Gửi yêu cầu')}</span>${ICON_ARROW}
            </button>
            <div id="forgot-result" role="status"></div>
            <p class="bpa-auth-center">
              <a href="#" id="link-back-login" class="bpa-auth-link is-back"><span aria-hidden="true">←</span><span class="u">${tr('Back to login', 'Quay lại đăng nhập')}</span></a>
            </p>
          </form>

          <div data-hide-on="forgot">
            <p class="bpa-auth-or">${tr('or', 'hoặc')}</p>
            <a href="${escapeHtml(googleLoginUrl(import.meta.env.DEV, import.meta.env.VITE_API_URL))}" class="bpa-auth-google" id="google-login">
              ${GOOGLE_MARK}<span>${tr('Continue with Google', 'Đăng nhập với Google')}</span>
            </a>
            <p class="bpa-auth-switch" data-view-only="login">${tr('No account yet?', 'Chưa có tài khoản?')}
              <button type="button" class="bpa-auth-link is-strong" data-open="register">${tr('Open a file', 'Đăng ký')}</button></p>
            <p class="bpa-auth-switch" data-view-only="register" hidden>${tr('Already have an account?', 'Đã có tài khoản?')}
              <button type="button" class="bpa-auth-link is-strong" data-open="login">${tr('Sign in', 'Đăng nhập')}</button></p>
          </div>
        </div>
        <p class="bpa-sr" role="status" id="auth-status"></p>
      </div>
    </section>`;

  render(app, loginBoardMarkup(body, { notice: Boolean(googleError || invite) }));
  wireRevealButtons(app);

  const tabs = app.querySelectorAll('.bpa-auth-tab');
  const swap = qs('[data-swap]', app);
  const status = qs('#auth-status', app);
  let view = 'login';
  let flip = false;

  function showForm(name, { focusTitle = false } = {}) {
    if (name === view) return;
    view = name;
    qs('#form-login', app).hidden = name !== 'login';
    qs('#form-register', app).hidden = name !== 'register';
    qs('#form-forgot', app).hidden = name !== 'forgot';
    app.querySelectorAll('[data-view-head]').forEach((head) => { head.hidden = head.dataset.viewHead !== name; });
    app.querySelectorAll('[data-hide-on]').forEach((block) => { block.hidden = block.dataset.hideOn === name; });
    app.querySelectorAll('[data-view-only]').forEach((block) => { block.hidden = block.dataset.viewOnly !== name; });
    tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.tab === (name === 'register' ? 'register' : 'login'))));
    app.querySelector('section.bpa-auth-section').setAttribute('aria-labelledby', `auth-title-${name}`);
    // Lens wipe: alternate the two keyframe copies so each swap replays it.
    flip = !flip;
    swap.classList.remove('bpa-wipe-a', 'bpa-wipe-b');
    swap.classList.add(flip ? 'bpa-wipe-b' : 'bpa-wipe-a');
    if (focusTitle) qs(`#auth-title-${name}`, app)?.focus();
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => showForm(tab.dataset.tab)));
  app.querySelectorAll('[data-open]').forEach((button) =>
    button.addEventListener('click', () => showForm(button.dataset.open, { focusTitle: true })));

  function setBusy(button, busy) {
    button.disabled = busy;
    button.querySelector('span').textContent = busy ? button.dataset.busy : button.dataset.label;
    setBoardState(app, busy ? 'solving' : '');
    status.textContent = busy ? button.dataset.busy : '';
  }

  async function submit(form, action) {
    const button = form.querySelector('button[type=submit]');
    setBusy(button, true);
    try {
      const data = new FormData(form);
      const auth = await action(data);
      if (!app.isConnected) return;
      session.save(auth);
      toast(tr(`Welcome, ${auth.user.fullName}.`, `Chào mừng, ${auth.user.fullName}.`), 'success');
      window.location.hash = pendingRoomInvite() || (auth.user.role === 'ADMIN' ? '#/admin' : '#/menu');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  qs('#form-login', app).addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target, (d) => authApi.login(d.get('email'), d.get('password')));
  });

  qs('#form-register', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector('button[type=submit]');
    setBusy(button, true);
    try {
      const d = new FormData(form);
      const auth = await authApi.register(d.get('fullName'), d.get('email'), d.get('password'));
      if (!app.isConnected) return;
      session.save(auth);
      // Chưa xác minh → đưa sang trang nhắc kiểm tra email (không vào game ngay)
      window.location.hash = session.isEmailVerified() ? (pendingRoomInvite() || '#/menu') : '#/verify-notice';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });

  qs('#link-forgot', app).addEventListener('click', (e) => {
    e.preventDefault();
    showForm('forgot', { focusTitle: true });
  });

  qs('#link-back-login', app).addEventListener('click', (e) => {
    e.preventDefault();
    showForm('login', { focusTitle: true });
  });

  qs('#form-forgot', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      const data = new FormData(e.target);
      await authApi.forgotPassword(data.get('email'));
      qs('#forgot-result', app).innerHTML = `
        <div class="bpa-auth-slip">
          <p class="k">${tr('Telegram sent', 'Điện tín đã được gửi')}</p>
          <p>${tr(
            'If the email exists, we have sent a password reset link. Open the email (check Spam too) and press the button inside.',
            'Nếu email tồn tại, chúng tôi đã gửi một liên kết đặt lại mật khẩu. Hãy mở email (kiểm tra cả mục Spam) và nhấn vào nút trong đó.',
          )}</p>
        </div>`;
      e.target.querySelector('input[name=email]').value = '';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}
