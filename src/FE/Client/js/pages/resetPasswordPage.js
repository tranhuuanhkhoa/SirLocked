import { authApi } from '../api/authApi.js';
import { render, qs } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { toast } from '../utils/toast.js';
import { ICON_ARROW, authBoardMarkup, authHead, passwordField, setBoardState, wireRevealButtons } from './loginPage.js';

/* Board: key ring, padlock, locksmith's receipt. */

function todayStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
}

const RESET_DECOR = () => `
  <g transform="translate(300 74) scale(1.3)">
    <g filter="url(#bpa-auth-drop)">
      <path d="M-37 55C-52 66 -68 78 -83 84" fill="none" stroke="#d8ccb0" stroke-width="1.3"/>
      <g transform="translate(-196 70) rotate(-6)">
        <path d="M0 0H110L124 13V39L110 52H0Z" fill="#e9dcc0"/>
        <circle cx="111" cy="26" r="4.5" fill="#2a1f17"/>
        <text x="12" y="20" class="bpa-auth-mono" font-size="8.5" font-weight="600" letter-spacing="1.3" fill="#4a3f30">${tr('SPARE KEY', 'CHÌA DỰ PHÒNG')}</text>
        <text x="12" y="41" class="bpa-auth-serif" font-size="15" font-weight="700" fill="#2a2318">${tr('Room 221B', 'Phòng 221B')}</text>
      </g>
      <g transform="translate(-16 76) rotate(34)">
        <circle cy="10" r="8.5" fill="none" stroke="#5e4a1c" stroke-width="6.5"/>
        <circle cy="10" r="8.5" fill="none" stroke="#9a7a34" stroke-width="4.5"/>
        <rect x="-2.6" y="18" width="5.2" height="52" rx="1.5" fill="#9a7a34" stroke="#5e4a1c" stroke-width=".8"/>
        <path d="M2 56H11V61H7V65H11V70H2Z" fill="#9a7a34" stroke="#5e4a1c" stroke-width=".8"/>
      </g>
      <g transform="translate(3 80) rotate(4)">
        <path d="M-17 0Q-17 -9 -8 -9H8Q17 -9 17 0V26Q17 34 9 34H-9Q-17 34 -17 26Z" fill="url(#bpa-auth-steel)" stroke="#55554f"/>
        <circle r="4.5" fill="#241a12"/>
        <path d="M-6.5 34V104L0 113L6.5 104V96L11 92V84L6.5 80V72L11 68V60L6.5 56V34Z" fill="url(#bpa-auth-steel)" stroke="#55554f"/>
        <path d="M-2 40V100" stroke="rgba(0,0,0,.22)" stroke-width="1.4"/>
      </g>
      <g transform="translate(22 74.5) rotate(-24)">
        <circle cy="15" r="13" fill="none" stroke="#6e5522" stroke-width="8"/>
        <circle cy="15" r="13" fill="none" stroke="url(#bpa-auth-brass)" stroke-width="6"/>
        <rect x="-6.5" y="30" width="13" height="5" rx="1.5" fill="#b8923e" stroke="#6e5522" stroke-width=".8"/>
        <rect x="-5" y="37" width="10" height="4" rx="1.5" fill="#b8923e" stroke="#6e5522" stroke-width=".8"/>
        <rect x="-3.2" y="40" width="6.4" height="98" rx="2" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
        <path d="M3 112H21V119H15V125H21V134H3Z" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
        <circle cy="138" r="3.4" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
      </g>
      <circle cy="40" r="40" fill="none" stroke="#5e4a1c" stroke-width="7.5"/>
      <circle cy="40" r="40" fill="none" stroke="url(#bpa-auth-brass)" stroke-width="5.5"/>
      <path d="M-33 17.5A40 40 0 0 1 -6 .5" fill="none" stroke="rgba(255,246,214,.8)" stroke-width="1.6" stroke-linecap="round"/>
    </g>
  </g>
  <g transform="translate(96 596) rotate(-4)">
    <g filter="url(#bpa-auth-drop)"><rect width="220" height="188" fill="url(#bpa-auth-sticky)"/></g>
    <text class="bpa-auth-body" font-size="22" font-style="italic" fill="#2a2318">
      <tspan x="22" y="58">${tr('New lock,', 'Khóa mới,')}</tspan>
      <tspan x="22" y="88">${tr('new key.', 'chìa mới.')}</tspan>
      <tspan x="22" y="126">${tr('Never reuse', 'Đừng dùng lại')}</tspan>
      <tspan x="22" y="156">${tr('an old key!', 'chìa khóa cũ!')}</tspan>
    </text>
    <path d="M22 164C58 159 98 166 140 160" fill="none" stroke="#b8382b" stroke-width="2" stroke-linecap="round"/>
  </g>
  <g transform="translate(1217 120) rotate(-7)">
    <g filter="url(#bpa-auth-drop)">
      <path d="M-46 152V44A46 46 0 0 1 46 44V116" fill="none" stroke="#4d4d48" stroke-width="20"/>
      <path d="M-46 152V44A46 46 0 0 1 46 44V116" fill="none" stroke="url(#bpa-auth-steel)" stroke-width="16"/>
      <path d="M-49 140V44A49 49 0 0 1 -14 -3" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5" stroke-linecap="round"/>
      <g class="bpa-auth-lockbody" data-lockbody>
        <rect x="-82" y="104" width="164" height="142" rx="14" fill="url(#bpa-auth-brass-v)" stroke="#5e4a1c" stroke-width="2"/>
        <rect x="-72" y="114" width="144" height="122" rx="8" fill="none" stroke="rgba(255,241,194,.45)" stroke-width="1.5"/>
        <path d="M-80 138H80" stroke="rgba(94,74,28,.45)" stroke-width="1.5"/>
        <text y="130" class="bpa-auth-mono" font-size="10" font-weight="700" letter-spacing="2.4" fill="#5e4a1c" text-anchor="middle">SIR LOCKED</text>
        <circle cy="182" r="18" fill="none" stroke="rgba(94,74,28,.55)" stroke-width="2"/>
        <circle cy="178" r="11" fill="#1a130d"/>
        <path d="M-6 182L-10 210H10L6 182Z" fill="#1a130d"/>
        <g fill="#8a6a2a" stroke="#5e4a1c" stroke-width=".8"><circle cx="-62" cy="226" r="3.5"/><circle cx="62" cy="226" r="3.5"/><circle cx="-62" cy="152" r="3.5"/><circle cx="62" cy="152" r="3.5"/></g>
      </g>
    </g>
  </g>
  <g transform="translate(1112 504) rotate(4)">
    <g filter="url(#bpa-auth-drop)"><path d="M0 0H232V300L224 307L216 300L208 307L200 300L192 307L184 300L176 307L168 300L160 307L152 300L144 307L136 300L128 307L120 300L112 307L104 300L96 307L88 300L80 307L72 300L64 307L56 300L48 307L40 300L32 307L24 300L16 307L8 300L0 307Z" fill="#f4f0e4"/></g>
    <text x="116" y="36" class="bpa-auth-mono" font-size="11.5" font-weight="700" letter-spacing="2" fill="#2a2318" text-anchor="middle">${tr('BAKER ST LOCKSMITH', 'THỢ KHÓA PHỐ BAKER')}</text>
    <text x="116" y="52" class="bpa-auth-mono" font-size="9" letter-spacing="1.6" fill="#4a3f30" text-anchor="middle">${tr('221B · OPEN ALL NIGHT', '221B · MỞ CỬA CẢ ĐÊM')}</text>
    <path d="M16 64H216M16 112H216M16 192H216" stroke="#4a3f30" stroke-dasharray="3 3"/>
    <g class="bpa-auth-mono" font-size="10.5" letter-spacing=".6" fill="#2a2318">
      <text x="16" y="84">${tr('RECEIPT', 'HÓA ĐƠN')}</text>
      <text x="216" y="84" text-anchor="end">Nº 0412</text>
      <text x="16" y="100">${todayStamp()}</text>
    </g>
    <g class="bpa-auth-mono" font-size="11" fill="#2a2318">
      <text x="16" y="134">${tr('NEW LOCK FITTED', 'THAY Ổ KHÓA MỚI')}</text><text x="216" y="134" text-anchor="end">1</text>
      <text x="16" y="156">${tr('NEW KEY CUT', 'CẮT CHÌA MỚI')}</text><text x="216" y="156" text-anchor="end">1</text>
      <text x="16" y="178">${tr('OLD KEY VOIDED', 'HỦY CHÌA CŨ')}</text><text x="216" y="178" text-anchor="end">1</text>
    </g>
    <text x="16" y="214" class="bpa-auth-mono" font-size="12" font-weight="700" letter-spacing="1" fill="#07111f">${tr('TOTAL', 'TỔNG CỘNG')}</text>
    <text x="216" y="214" class="bpa-auth-mono" font-size="12" font-weight="700" fill="#07111f" text-anchor="end">${tr('FREE', 'MIỄN PHÍ')}</text>
    <text x="116" y="238" class="bpa-auth-body" font-size="14.5" font-style="italic" fill="#5b5248" text-anchor="middle">${tr('On the house for detectives.', 'Miễn phí cho thám tử.')}</text>
    <g transform="translate(118 274) rotate(-9)" opacity=".85">
      <rect x="-76" y="-17" width="152" height="34" fill="none" stroke="#b8382b" stroke-width="2.4"/>
      <rect x="-71" y="-12" width="142" height="24" fill="none" stroke="#b8382b"/>
      <text y="4.5" class="bpa-auth-mono" font-size="12" font-weight="700" letter-spacing="2" fill="#b8382b" text-anchor="middle">${tr('PAID', 'ĐÃ THANH TOÁN')}</text>
    </g>
  </g>`;

const RESET_THREADS = [
  [300, 74, 720, 450, 'd1'], [1217, 120, 720, 450, 'd2'], [206.7, 602.3, 720, 450, 'd3'], [1226.7, 526.1, 720, 450, 'd4'],
  [1217, 120, 1460, 24, 'd5'], [1226.7, 526.1, 1460, 478, 'd6'], [206.7, 602.3, -20, 506, 'd7'], [300, 74, -20, 24, 'd7'],
];
const RESET_PINS = [[300, 74, 'red'], [1217, 120, 'gold'], [1226.7, 526.1, 'red'], [206.7, 602.3, 'gold']];

const RULE_ICONS = `
  <svg class="ic-no" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>
  <svg class="ic-ok" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
  <svg class="ic-bad" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>`;

function resetBoard(content, threadsClass = '') {
  return authBoardMarkup({
    decor: RESET_DECOR(),
    threads: RESET_THREADS,
    pins: RESET_PINS,
    centered: true,
    threadsClass,
    body: `
      <section class="bpa-auth-section bpa-auth-rise-late" aria-labelledby="reset-title">
        <span class="bpa-auth-pin bpa-auth-pin--center" aria-hidden="true"></span>
        <div class="bpa-auth-card">
          ${authHead(tr('Account recovery', 'Khôi phục tài khoản'))}
          ${content}
        </div>
      </section>`,
  });
}

function brokenKeyHero() {
  return `
    <div class="bpa-auth-hero bpa-auth-hero--tall">
      <svg viewBox="0 0 360 132" aria-hidden="true" focusable="false">
        <g filter="url(#bpa-auth-hdrop)">
          <g transform="rotate(-7 116 84)">
            <circle cx="42" cy="84" r="21" fill="none" stroke="#6e5522" stroke-width="11"/>
            <circle cx="42" cy="84" r="21" fill="none" stroke="url(#bpa-auth-brass)" stroke-width="8.5"/>
            <rect x="64" y="77" width="7" height="14" rx="1.5" fill="#b8923e" stroke="#6e5522" stroke-width=".8"/>
            <path d="M71 80H112L116 82.5L111 85L115 88H71Z" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
          </g>
          <g transform="translate(12 7) rotate(11 122 84)">
            <path d="M124 80L120 82.5L125 85L121 88H190V80Z" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
            <path d="M164 88V106H172V98H180V110H190V88Z" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
            <circle cx="192" cy="84" r="4" fill="url(#bpa-auth-brass)" stroke="#6e5522" stroke-width=".8"/>
          </g>
        </g>
        <path d="M121 106L126 103L127 108Z M110 112L114 110L114 114Z" fill="#b8923e"/>
      </svg>
      <div class="bpa-auth-stampbox" aria-hidden="true">
        <div class="bpa-auth-stamp bpa-auth-stamp--red"><b>${tr('INVALID', 'KHÔNG HỢP LỆ')}</b><small>221B · ${todayStamp()}</small></div>
      </div>
    </div>`;
}

export async function renderResetPasswordPage(app) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');

  if (!token) {
    render(app, resetBoard(`
      ${brokenKeyHero()}
      <h2 id="reset-title" class="bpa-auth-title">${tr('Invalid link', 'Liên kết không hợp lệ')}</h2>
      <p class="bpa-auth-text">${tr('No reset code was found in this link.', 'Không tìm thấy mã đặt lại trong liên kết.')}</p>
      <p class="bpa-auth-aside">${tr(
        'Open the latest link in your email, or request a new one with “Forgot password?” on the login page.',
        'Hãy mở liên kết mới nhất trong email, hoặc yêu cầu liên kết mới qua “Quên mật khẩu?” ở trang đăng nhập.',
      )}</p>
      <a href="#/login" class="bpa-auth-primary"><span>${tr('Back to login', 'Về trang đăng nhập')}</span>${ICON_ARROW}</a>`, 'is-cold'));
    return;
  }

  render(app, resetBoard(`
    <h2 id="reset-title" class="bpa-auth-title">${tr('Reset password', 'Đặt lại mật khẩu')}</h2>
    <p class="bpa-auth-sub">${tr('Enter a new password for your account.', 'Nhập mật khẩu mới cho tài khoản của bạn.')}</p>
    <form id="form-reset" class="bpa-auth-form">
      ${passwordField({
        id: 'reset-new', name: 'newPassword', autocomplete: 'new-password', minlength: 6, describedBy: 'reset-rules',
        label: `${tr('New password', 'Mật khẩu mới')} <span class="bpa-auth-hint">${tr('(at least 6 characters, including letters and numbers)', '(tối thiểu 6 ký tự, gồm chữ và số)')}</span>`,
        extra: `
          <ul id="reset-rules" class="bpa-auth-rules">
            <li class="bpa-auth-rule" data-rule="length">${RULE_ICONS}<span>${tr('At least 6 characters', 'Ít nhất 6 ký tự')}<span class="bpa-sr" data-rule-sr></span></span></li>
            <li class="bpa-auth-rule" data-rule="mix">${RULE_ICONS}<span>${tr('Letters and numbers', 'Có cả chữ và số')}<span class="bpa-sr" data-rule-sr></span></span></li>
          </ul>`,
      })}
      ${passwordField({
        id: 'reset-confirm', name: 'confirmPassword', autocomplete: 'new-password', minlength: 6, describedBy: 'reset-match',
        label: tr('Confirm new password', 'Xác nhận mật khẩu mới'),
        extra: `<p id="reset-match" class="bpa-auth-rule" data-rule="match" style="margin-top:7px">${RULE_ICONS}<span>${tr('Matches the new password', 'Khớp với mật khẩu mới')}<span class="bpa-sr" data-rule-sr></span></span></p>`,
      })}
      <button class="bpa-auth-primary" type="submit"><span>${tr('Reset password', 'Đặt lại mật khẩu')}</span>${ICON_ARROW}</button>
    </form>
    <p class="bpa-auth-center">
      <a href="#/login" class="bpa-auth-link is-back"><span aria-hidden="true">←</span><span class="u">${tr('Back to login', 'Quay lại đăng nhập')}</span></a>
    </p>`));
  wireRevealButtons(app);

  const form = qs('#form-reset', app);
  const newInput = qs('#reset-new', app);
  const confirmInput = qs('#reset-confirm', app);
  const setRule = (name, state) => {
    const rule = app.querySelector(`[data-rule="${name}"]`);
    rule.classList.toggle('is-ok', state === 'ok');
    rule.classList.toggle('is-bad', state === 'bad');
    rule.querySelector('[data-rule-sr]').textContent = state === 'ok' ? tr(': met', ': đạt') : state === 'bad' ? tr(': not met', ': chưa đạt') : '';
  };
  // Live checklist only; submission keeps the browser validation and the existing checks.
  const updateRules = () => {
    const password = newInput.value;
    const confirm = confirmInput.value;
    setRule('length', password ? (password.length >= 6 ? 'ok' : '') : '');
    setRule('mix', password ? (/[a-zA-Z]/.test(password) && /\d/.test(password) ? 'ok' : '') : '');
    const match = !confirm ? '' : confirm === password ? 'ok' : confirm.length >= password.length ? 'bad' : '';
    setRule('match', match);
    confirmInput.setAttribute('aria-invalid', String(match === 'bad'));
  };
  newInput.addEventListener('input', updateRules);
  confirmInput.addEventListener('input', updateRules);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const newPassword = data.get('newPassword');
    const confirmPassword = data.get('confirmPassword');

    if (newPassword !== confirmPassword) {
      setRule('match', 'bad');
      toast(tr('The confirmation password does not match.', 'Mật khẩu xác nhận không khớp.'), 'error');
      return;
    }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    setBoardState(app, 'solving');
    app.querySelector('[data-lockbody]')?.classList.add('is-busy');
    try {
      await authApi.resetPassword(token, newPassword);
      toast(tr('Password reset! Please log in again.', 'Đặt lại mật khẩu thành công! Hãy đăng nhập lại.'), 'success');
      window.location.hash = '#/login';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      setBoardState(app, '');
      app.querySelector('[data-lockbody]')?.classList.remove('is-busy');
    }
  });
}
