import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderLoginPage(app) {
  if (session.isLoggedIn()) {
    window.location.hash = session.isAdmin() ? '#/admin' : '#/cases';
    return;
  }

  render(app, `
  <div class="auth-screen">
    <div class="auth-panel">
      <div class="auth-logo">
        <h1>SIR LOCKED</h1>
        <p>The Mystery Awaits</p>
      </div>
      <div class="gold-divider"></div>
      <div class="tab-row">
        <button class="form-tab active" data-tab="login">Log in</button>
        <button class="form-tab" data-tab="register">Register</button>
      </div>

      <form id="form-login" class="auth-form">
        <label class="field-label">Email
          <input class="field-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
        </label>
        <label class="field-label">Password
          <input class="field-input" name="password" type="password" required autocomplete="current-password" placeholder="••••••••">
        </label>
        <button class="btn btn-primary btn-block" type="submit">Log in</button>
      </form>

      <form id="form-register" class="auth-form" hidden>
        <label class="field-label">Full name
          <input class="field-input" name="fullName" type="text" required minlength="2" placeholder="Detective Holmes">
        </label>
        <label class="field-label">Email
          <input class="field-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
        </label>
        <label class="field-label">Password (min 6 characters)
          <input class="field-input" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="••••••••">
        </label>
        <button class="btn btn-primary btn-block" type="submit">Create account</button>
      </form>

      <p class="auth-hint">Two detectives, one case. Register two accounts to play co-op.</p>
    </div>
  </div>`);

  const tabs = app.querySelectorAll('.form-tab');
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      qs('#form-login', app).hidden = tab.dataset.tab !== 'login';
      qs('#form-register', app).hidden = tab.dataset.tab !== 'register';
    }));

  async function submit(form, action) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      const auth = await action(data);
      session.save(auth);
      toast(`Welcome, ${auth.user.fullName}.`, 'success');
      window.location.hash = auth.user.role === 'ADMIN' ? '#/admin' : '#/cases';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  qs('#form-login', app).addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target, (d) => authApi.login(d.get('email'), d.get('password')));
  });
  qs('#form-register', app).addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target, (d) => authApi.register(d.get('fullName'), d.get('email'), d.get('password')));
  });
}
