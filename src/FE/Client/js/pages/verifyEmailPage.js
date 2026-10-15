import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { toast } from '../utils/toast.js';
import { pendingRoomInvite } from '../services/roomInvites.js';
import { ICON_ARROW, authBoardMarkup, authHead, setBoardState } from './loginPage.js';

/* Board for the verification screens: sealed envelope, telegram, sorting tag. */

function todayStamp(withYear = true) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}${withYear ? `.${now.getFullYear()}` : ''}`;
}

const VERIFY_DECOR = () => `
  <g transform="translate(70 112) rotate(-5)">
    <g filter="url(#bpa-auth-drop)"><rect width="372" height="238" rx="3" fill="#e7d9bb"/></g>
    <path d="M0 0L178 130L0 238Z" fill="#e0d0ae"/>
    <path d="M372 0L194 130L372 238Z" fill="#dbc9a5"/>
    <path d="M0 238L172 118Q186 109 200 118L372 238Z" fill="#d5c29b"/>
    <path d="M0 0L176 146Q186 153 196 146L372 0Z" transform="translate(0 4)" fill="rgba(58,38,18,.2)"/>
    <path d="M0 0L176 146Q186 153 196 146L372 0Z" fill="#eee4cd"/>
    <text x="24" y="30" class="bpa-auth-mono" font-size="10" letter-spacing="1.8" fill="#4a3f30">${tr('FROM · SIR LOCKED', 'NGƯỜI GỬI · SIR LOCKED')}</text>
    <text x="24" y="45" class="bpa-auth-mono" font-size="10" letter-spacing="1.8" fill="#4a3f30">${tr('221B BAKER STREET', '221B PHỐ BAKER')}</text>
    <g transform="translate(24 190) rotate(-2)">
      <rect width="108" height="30" fill="#f6f0e1" stroke="#9e3f2a" stroke-width="1.2"/>
      <rect width="28" height="30" fill="#9e3f2a"/>
      <text x="14" y="21.5" class="bpa-auth-serif" font-size="18" font-weight="700" fill="#fbf6ed" text-anchor="middle">R</text>
      <text x="36" y="12.5" class="bpa-auth-mono" font-size="8" font-weight="600" letter-spacing="1.2" fill="#6b2a1c">${tr('REGISTERED', 'BẢO ĐẢM')}</text>
      <text x="36" y="24" class="bpa-auth-mono" font-size="9.5" font-weight="700" letter-spacing="1" fill="#2a2318">Nº 0412</text>
    </g>
    <g transform="translate(186 146)">
      <circle r="31" transform="translate(1.5 3.5)" fill="rgba(40,8,4,.35)"/>
      <circle r="30.5" fill="url(#bpa-auth-wax)"/>
      <circle r="20" fill="none" stroke="rgba(60,8,4,.5)" stroke-width="2.2"/>
      <path d="M0 -11A5.5 5.5 0 0 1 3.2 -1L5.5 9H-5.5L-3.2 -1A5.5 5.5 0 0 1 0 -11Z" fill="rgba(60,8,4,.55)"/>
      <path d="M-17 -16A23 23 0 0 1 -2 -23" fill="none" stroke="rgba(255,214,196,.5)" stroke-width="2.4" stroke-linecap="round"/>
    </g>
  </g>
  <g transform="translate(100 604) rotate(-3.5)">
    <g filter="url(#bpa-auth-drop)"><rect width="226" height="184" fill="url(#bpa-auth-sticky)"/></g>
    <text class="bpa-auth-body" font-size="22" font-style="italic" fill="#2a2318">
      <tspan x="22" y="60">${tr('Only the mailbox', 'Chỉ chủ hộp thư')}</tspan>
      <tspan x="22" y="90">${tr('owner can break', 'mới phá được')}</tspan>
      <tspan x="22" y="120">${tr('this seal.', 'niêm phong này.')}</tspan>
    </text>
    <path d="M22 128C64 123 112 131 162 124" fill="none" stroke="#b8382b" stroke-width="2" stroke-linecap="round"/>
    <text x="204" y="162" class="bpa-auth-body" font-size="16" font-style="italic" fill="#5b4a2a" text-anchor="end">— S.L.</text>
  </g>
  <g transform="translate(1062 106) rotate(4.5)">
    <g filter="url(#bpa-auth-drop)"><rect width="316" height="212" fill="#ecdfbb"/></g>
    <rect x="8" y="8" width="300" height="196" fill="none" stroke="rgba(122,63,39,.35)"/>
    <text x="22" y="48" class="bpa-auth-serif" font-size="25" font-weight="700" letter-spacing="3" fill="#2a2318">${tr('TELEGRAM', 'ĐIỆN TÍN')}</text>
    <text x="294" y="32" class="bpa-auth-mono" font-size="9" letter-spacing="1.4" fill="#4a3f30" text-anchor="end">${tr('221B POST OFFICE', 'BƯU ĐIỆN 221B')}</text>
    <text x="294" y="46" class="bpa-auth-mono" font-size="9" letter-spacing="1.4" fill="#4a3f30" text-anchor="end">Nº 0412</text>
    <path d="M22 58H294M22 61.5H294" stroke="#4a3f30" stroke-width=".8"/>
    <rect x="20" y="74" width="232" height="24" fill="#f8f3e6"/>
    <text x="28" y="90.5" class="bpa-auth-mono" font-size="11" font-weight="600" letter-spacing=".8" fill="#1d1a16">${tr('TO THE DETECTIVE STOP', 'GỬI THÁM TỬ STOP')}</text>
    <rect x="20" y="104" width="250" height="24" fill="#f8f3e6"/>
    <text x="28" y="120.5" class="bpa-auth-mono" font-size="11" font-weight="600" letter-spacing=".8" fill="#1d1a16">${tr('VERIFICATION SENT STOP', 'THƯ XÁC MINH ĐÃ ĐI STOP')}</text>
    <rect x="20" y="134" width="226" height="24" fill="#f8f3e6"/>
    <text x="28" y="150.5" class="bpa-auth-mono" font-size="11" font-weight="600" letter-spacing=".8" fill="#1d1a16">${tr('OPEN · PRESS THE LINK', 'MỞ THƯ · NHẤN LIÊN KẾT')}</text>
    <g transform="translate(258 168) rotate(-14)" opacity=".82">
      <circle r="31" fill="none" stroke="#9e3f2a" stroke-width="2.2"/>
      <circle r="22" fill="none" stroke="#9e3f2a" stroke-width="1.1"/>
      <text y="-6" class="bpa-auth-mono" font-size="8.5" font-weight="700" letter-spacing="1" fill="#9e3f2a" text-anchor="middle">221B</text>
      <text y="5" class="bpa-auth-mono" font-size="9" font-weight="700" fill="#9e3f2a" text-anchor="middle">${todayStamp(false)}</text>
      <text y="15" class="bpa-auth-mono" font-size="7.5" font-weight="600" fill="#9e3f2a" text-anchor="middle">${new Date().getFullYear()}</text>
      <path d="M-38 -12C-46 -18 -54 -6 -62 -12S-78 -6 -86 -12M-38 0C-46 -6 -54 6 -62 0S-78 6 -86 0M-38 12C-46 6 -54 18 -62 12S-78 18 -86 12" fill="none" stroke="#9e3f2a" stroke-width="1.6"/>
    </g>
  </g>
  <g transform="translate(1050 552) rotate(-4)">
    <g filter="url(#bpa-auth-drop)"><path d="M30 0H304V172H30L0 142V30Z" fill="#c4a06b"/></g>
    <circle cx="32" cy="86" r="13" fill="none" stroke="#ece0c6" stroke-width="5"/>
    <circle cx="32" cy="86" r="8" fill="#1a130d"/>
    <text x="64" y="34" class="bpa-auth-mono" font-size="12.5" font-weight="700" letter-spacing="2" fill="#2a2318">${tr('MAIL SORTING', 'PHÂN LOẠI THƯ')}</text>
    <text x="288" y="34" class="bpa-auth-mono" font-size="10" font-weight="600" letter-spacing="1.2" fill="#3b3328" text-anchor="end">${tr('BOX 07', 'NGĂN 07')}</text>
    <path d="M64 44H288" stroke="rgba(42,35,24,.45)"/>
    <g fill="none" stroke="#2a2318" stroke-width="1.4"><rect x="64" y="58" width="14" height="14"/><rect x="64" y="88" width="14" height="14"/><rect x="64" y="118" width="14" height="14"/></g>
    <g class="bpa-auth-mono" font-size="12" font-weight="600" letter-spacing="1" fill="#2a2318">
      <text x="88" y="70">${tr('INBOX', 'HỘP THƯ CHÍNH')}</text>
      <text x="88" y="100">${tr('PROMOTIONS', 'QUẢNG CÁO')}</text>
      <text x="88" y="130">SPAM</text>
    </g>
    <path d="M66 94L71 100L82 86M66 124L71 130L82 116" fill="none" stroke="#b8382b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="132" cy="110" rx="84" ry="31" transform="rotate(-4 132 110)" fill="none" stroke="#b8382b" stroke-width="2"/>
    <text x="282" y="156" class="bpa-auth-body" font-size="17" font-style="italic" fill="#7a2418" text-anchor="end">${tr('check here too!', 'xem cả đây!')}</text>
    <path d="M214 140C206 134 210 124 218 120M218 120L210 119M218 120L215 128" fill="none" stroke="#b8382b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const VERIFY_THREADS = [
  [370.3, 101.8, 720, 450, 'd1'], [1073.3, 293.5, 720, 450, 'd2'], [213.6, 611.1, 720, 450, 'd3'],
  [1087.9, 635.6, 720, 450, 'd4'], [1073.3, 293.5, 1087.9, 635.6, 'd5'], [1087.9, 635.6, 1188, 940, 'd6'],
  [213.6, 611.1, -20, 470, 'd7'],
];
const VERIFY_PINS = [[370.3, 101.8, 'gold'], [1073.3, 293.5, 'red'], [213.6, 611.1, 'red'], [1087.9, 635.6, 'gold']];

/** Card frame shared by the verification screens. */
export function verifyBoardMarkup(content, threadsClass = '') {
  return authBoardMarkup({
    decor: VERIFY_DECOR(),
    threads: VERIFY_THREADS,
    pins: VERIFY_PINS,
    centered: true,
    threadsClass,
    body: `
      <section class="bpa-auth-section bpa-auth-rise-late" aria-labelledby="verify-title">
        <span class="bpa-auth-pin bpa-auth-pin--center${threadsClass === 'is-solving' ? ' is-solving' : ''}" aria-hidden="true"></span>
        <div class="bpa-auth-card">
          ${authHead(tr('Account verification', 'Xác minh tài khoản'))}
          <div class="bpa-auth-swap" data-swap>${content}</div>
        </div>
      </section>`,
  });
}

const SEAL = `
  <path d="M16 -3.7Q16.9 0 15.9 3.6Q15 7.2 12.4 9.8Q9.9 12.4 7 15.1Q4 17.7 .3 16.4Q-3.4 15 -7 14.2Q-10.6 13.3 -13.5 10.6Q-16.5 7.9 -16.1 4Q-15.7 0 -15.6 -3.7Q-15.5 -7.5 -13.2 -10.5Q-10.8 -13.6 -7.1 -14.4Q-3.5 -15.1 .1 -15.7Q3.7 -16.2 7.4 -15Q11 -13.8 13.1 -10.6Q15.2 -7.3 16 -3.7Z" transform="translate(1 2)" fill="rgba(40,8,4,.35)"/>
  <path d="M16 -3.7Q16.9 0 15.9 3.6Q15 7.2 12.4 9.8Q9.9 12.4 7 15.1Q4 17.7 .3 16.4Q-3.4 15 -7 14.2Q-10.6 13.3 -13.5 10.6Q-16.5 7.9 -16.1 4Q-15.7 0 -15.6 -3.7Q-15.5 -7.5 -13.2 -10.5Q-10.8 -13.6 -7.1 -14.4Q-3.5 -15.1 .1 -15.7Q3.7 -16.2 7.4 -15Q11 -13.8 13.1 -10.6Q15.2 -7.3 16 -3.7Z" fill="url(#bpa-auth-wax)"/>
  <circle r="10.5" fill="none" stroke="rgba(60,8,4,.5)" stroke-width="1.5"/>
  <path d="M0 -6A3 3 0 0 1 1.8 -.6L3 5H-3L-1.8 -.6A3 3 0 0 1 0 -6Z" fill="rgba(60,8,4,.6)"/>
  <path d="M-9 -9A12 12 0 0 1 -1 -12.5" fill="none" stroke="rgba(255,214,196,.55)" stroke-width="1.6" stroke-linecap="round"/>`;

/**
 * Envelope illustration for each verification state.
 * @param {'check'|'scan'|'ok'|'bad'} state
 */
export function envelopeHero(state) {
  const postmark = state === 'check' ? `
    <g transform="translate(268 40) rotate(-12)" opacity=".86">
      <path d="M-33 -9C-40 -14 -47 -4 -54 -9S-68 -4 -75 -9M-33 1C-40 -4 -47 6 -54 1S-68 6 -75 1M-33 11C-40 6 -47 16 -54 11S-68 16 -75 11" fill="none" stroke="#9e3f2a" stroke-width="1.5"/>
      <circle r="29" fill="#fbf6ed" stroke="#9e3f2a" stroke-width="2"/>
      <circle r="22" fill="none" stroke="#9e3f2a"/>
      <text y="-2" class="bpa-auth-mono" font-size="9" font-weight="700" fill="#9e3f2a" text-anchor="middle">${tr('SENT', 'ĐÃ GỬI')}</text>
      <text y="10" class="bpa-auth-mono" font-size="8.5" font-weight="600" fill="#9e3f2a" text-anchor="middle">${todayStamp(false)}</text>
    </g>` : '';
  const opened = `
    <path d="M-86 -50L-5 -76Q0 -78 5 -76L86 -50Z" fill="#e6d8b9" stroke="rgba(120,95,60,.35)"/>
    <g transform="translate(0 -70.6) scale(.62)">${SEAL}</g>
    <rect x="-66" y="-66" width="132" height="84" fill="#fffdf7" stroke="rgba(91,82,72,.28)"/>
    <path d="M-52 -48H22M-52 -36H30M-52 -24H8" stroke="rgba(91,82,72,.38)" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="42" cy="-40" r="11" fill="rgba(79,154,154,.16)" stroke="#2f6363" stroke-width="2"/>
    <path d="M37 -40.5L40.6 -36.8L47.5 -44" fill="none" stroke="#2f6363" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const closed = `
    <path d="M-86 -50L-5 12Q0 15 5 12L86 -50Z" transform="translate(0 2.5)" fill="rgba(58,38,18,.2)"/>
    <path d="M-86 -50L-5 12Q0 15 5 12L86 -50Z" fill="#eee4cd"/>
    <g transform="translate(0 9)">
      ${state === 'scan' ? '<circle class="bpa-auth-halo" r="25" filter="url(#bpa-auth-glow)" fill="rgba(239,212,134,.75)"/>' : ''}
      ${SEAL}
      ${state === 'bad' ? `
        <path d="M7 -17L18 -9L15 -3L10 -6L8 -11Z" fill="#eee4cd"/>
        <path d="M10 -6L15 -3" stroke="#f2b9a9" stroke-width="1.4"/>
        <path d="M10 -6L3 -1L6 4L-2 8L-6 16M3 -1L-5 -4L-10 -11" fill="none" stroke="#2a0805" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <g transform="translate(25 -15) rotate(24)"><path d="M-5 -4L4 -5L6 2L-1 5Z" fill="url(#bpa-auth-wax)" stroke="rgba(40,8,4,.55)" stroke-width=".8"/></g>` : ''}
    </g>`;
  const scanner = state === 'scan' ? `
    <g class="bpa-auth-scan">
      <circle r="25" fill="rgba(255,250,232,.26)" stroke="#c7a24b" stroke-width="5"/>
      <circle r="27.5" fill="none" stroke="#5e4a1c"/>
      <circle r="22.5" fill="none" stroke="#5e4a1c"/>
      <path d="M-13 -13A18 18 0 0 1 2 -19" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M19.5 19.5L30 30" stroke="#5e4a1c" stroke-width="7" stroke-linecap="round"/>
      <path d="M29 29L48 48" stroke="#3a2614" stroke-width="10" stroke-linecap="round"/>
    </g>` : '';
  const stamp = state === 'ok'
    ? `<div class="bpa-auth-stampbox" aria-hidden="true"><div class="bpa-auth-stamp bpa-auth-stamp--teal"><b>${tr('VERIFIED', 'ĐÃ XÁC MINH')}</b><small>221B · ${todayStamp()}</small></div></div>`
    : state === 'bad'
      ? `<div class="bpa-auth-stampbox" aria-hidden="true"><div class="bpa-auth-stamp bpa-auth-stamp--red"><b>${tr('INVALID', 'KHÔNG HỢP LỆ')}</b><small>221B · ${todayStamp()}</small></div></div>`
      : '';
  return `
    <div class="bpa-auth-hero">
      <svg viewBox="0 0 360 124" aria-hidden="true" focusable="false">
        ${postmark}
        <g transform="translate(128 74) rotate(-3)">
          <rect x="-86" y="-50" width="172" height="100" rx="2" filter="url(#bpa-auth-hdrop)" fill="#cdb98f"/>
          ${state === 'ok' ? opened : ''}
          <path d="M-86 -50L-2 8L-86 50Z" fill="#e3d4b3"/>
          <path d="M86 -50L2 8L86 50Z" fill="#dccba7"/>
          <path d="M-86 50L-6 -4Q0 -8 6 -4L86 50Z" fill="#d5c29b"/>
          ${state === 'ok' ? '' : closed}
        </g>
        ${scanner}
      </svg>
      ${stamp}
    </div>`;
}

export const RESEND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12.5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17V7a1.5 1.5 0 0 1 1.5-1.5H13"/><path d="M4.5 6.5l7.5 6 3-2.4"/><path d="M17 3.5a3.5 3.5 0 1 1-2.6 1.2"/><path d="M14.2 2.6l.2 2.3 2.3-.2"/></svg>';

export function resendSentMarkup() {
  return `
    <p class="bpa-auth-sent">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/></svg>
      <span>${tr('Verification email sent again. Please check your inbox.', 'Đã gửi lại email. Vui lòng kiểm tra hộp thư.')}</span>
    </p>`;
}

/** Resend button behaviour shared by the notice page and a failed verification. */
export function wireResend(app, button, result) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    setBoardState(app, 'solving');
    try {
      await authApi.resendVerification();
      result.innerHTML = resendSentMarkup();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
      setBoardState(app, '');
    }
  });
}

export async function renderVerifyEmailPage(app) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');

  render(app, verifyBoardMarkup(`
    <div id="verify-state">
      ${envelopeHero('scan')}
      <h2 id="verify-title" class="bpa-auth-title">${tr('Verifying your account…', 'Đang xác minh tài khoản của bạn...')}</h2>
      <p class="bpa-auth-text bpa-auth-aside">${tr(
        'The magnifier is checking the seal on your link — this only takes a moment.',
        'Kính lúp đang soi dấu niêm phong trên liên kết — vui lòng chờ trong giây lát.',
      )}</p>
      <svg viewBox="0 0 300 20" width="100%" height="20" aria-hidden="true" focusable="false" style="display:block;margin-top:18px;overflow:visible">
        <path class="bpa-auth-runline" d="M10 10H290" stroke="#c7a24b" stroke-width="2.4" stroke-linecap="round"/>
        <circle cx="10" cy="10" r="6" fill="url(#bpa-auth-pin-red)"/>
        <circle cx="290" cy="10" r="6" fill="url(#bpa-auth-pin-gold)"/>
      </svg>
    </div>
    <p class="bpa-sr" role="status" id="verify-status">${tr('Verifying your account…', 'Đang xác minh tài khoản của bạn...')}</p>`, 'is-solving'));

  const stateEl = qs('#verify-state', app);
  const statusEl = qs('#verify-status', app);
  const settle = (threadsState, markup, statusText) => {
    stateEl.innerHTML = markup;
    statusEl.textContent = statusText;
    setBoardState(app, threadsState);
    app.querySelector('.bpa-auth-pin')?.classList.toggle('is-lit', threadsState === 'solved');
    qs('[data-swap]', app).classList.add('bpa-wipe-a');
  };
  const backToLogin = `<a href="#/login" class="bpa-auth-primary"><span>${tr('Back to login', 'Về trang đăng nhập')}</span>${ICON_ARROW}</a>`;

  if (!token) {
    settle('cold', `
      ${envelopeHero('bad')}
      <h2 id="verify-title" class="bpa-auth-title">${tr('Invalid link', 'Liên kết không hợp lệ')}</h2>
      <p class="bpa-auth-text">${tr('No verification code was found in this link.', 'Không tìm thấy mã xác minh trong liên kết.')}</p>
      ${backToLogin}`, tr('Invalid link', 'Liên kết không hợp lệ'));
    return;
  }

  try {
    await authApi.verifyEmail(token);
    // Nếu đang đăng nhập thì mở khóa game ngay
    if (session.isLoggedIn()) session.setEmailVerified();
    if (!app.isConnected) return;

    const invite = pendingRoomInvite();
    const goHref = session.isLoggedIn() ? (invite || '#/menu') : '#/login';
    // The invited-room label is pinned by tests/invites-resume.spec.ts, so it stays as it was.
    const goText = session.isLoggedIn()
      ? (invite ? 'Tiếp tục tới phòng được mời' : tr('Enter the game', 'Vào game ngay'))
      : tr('Log in', 'Đăng nhập');
    settle('solved', `
      ${envelopeHero('ok')}
      <h2 id="verify-title" class="bpa-auth-title">${tr('Verification complete!', 'Xác minh thành công!')}</h2>
      <p class="bpa-auth-text">${tr('Your account is now active. You can enter the game.', 'Tài khoản của bạn đã được kích hoạt. Bây giờ bạn có thể vào game.')}</p>
      <a href="${goHref}" class="bpa-auth-primary"><span>${goText}</span>${ICON_ARROW}</a>`, tr('Verification complete!', 'Xác minh thành công!'));
  } catch (err) {
    if (!app.isConnected) return;
    const canResend = session.isLoggedIn() && !session.isEmailVerified();
    settle('cold', `
      ${envelopeHero('bad')}
      <h2 id="verify-title" class="bpa-auth-title">${tr('Verification failed', 'Xác minh thất bại')}</h2>
      <p class="bpa-auth-text">${escapeHtml(err.message || tr('The verification code is invalid or has already been used.', 'Mã xác minh không hợp lệ hoặc đã được dùng.'))}</p>
      ${canResend ? `<p class="bpa-auth-aside">${tr('Send the verification email again to get a new link.', 'Hãy gửi lại email xác minh để nhận liên kết mới.')}</p>` : ''}
      ${backToLogin}
      ${canResend ? `
        <button type="button" class="bpa-auth-ink" id="btn-resend">${RESEND_ICON}<span>${tr('Resend verification email', 'Gửi lại email xác minh')}</span></button>
        <div id="resend-result" role="status"></div>` : ''}`, tr('Verification failed', 'Xác minh thất bại'));
    if (canResend) wireResend(app, qs('#btn-resend', app), qs('#resend-result', app));
  }
}
