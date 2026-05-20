const PARTIALS = [
  { target: 'nav-root', url: 'components/nav.html' },
  { target: 'mobile-menu-root', url: 'components/mobile-menu.html' },
  { target: 'screens-root', url: 'screens/auth.html' },
  { target: 'screens-root', url: 'screens/how-to-play.html', append: true },
  { target: 'screens-root', url: 'screens/create-room.html', append: true },
  { target: 'screens-root', url: 'screens/join-room.html', append: true },
  { target: 'screens-root', url: 'screens/options.html', append: true },
];

async function loadPartials() {
  for (const partial of PARTIALS) {
    const target = document.getElementById(partial.target);
    const response = await fetch(partial.url);
    if (!response.ok) throw new Error(`Cannot load ${partial.url}`);
    const html = await response.text();
    if (partial.append) {
      target.insertAdjacentHTML('beforeend', html);
    } else {
      target.innerHTML = html;
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadPartials();
    showScreen('auth', document.querySelector('.nav-tabs .nav-tab'));
  } catch (error) {
    document.body.insertAdjacentHTML('beforeend', '<p class="load-error">Khong the tai giao dien. Hay chay file qua local server thay vi mo truc tiep bang file://.</p>');
    console.error(error);
  }
});
  const SCREENS = ['auth','play','create','join','options'];

  function showScreen(id, tab) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('s-' + id).classList.add('active');
    if (tab) tab.classList.add('active');
    // Sync both desktop nav-tabs and mobile menu tabs by screen id
    const idx = SCREENS.indexOf(id);
    const desktopTabs = document.querySelectorAll('.nav-tabs .nav-tab');
    const mobileTabs = document.querySelectorAll('.nav-mobile-menu .nav-tab');
    desktopTabs.forEach((t,i) => t.classList.toggle('active', i === idx));
    mobileTabs.forEach((t,i) => t.classList.toggle('active', i === idx));
  }

  function toggleMenu() {
    const btn = document.getElementById('hamburger');
    const menu = document.getElementById('mobile-menu');
    btn.classList.toggle('open');
    menu.classList.toggle('open');
  }

  function closeMenu() {
    document.getElementById('hamburger').classList.remove('open');
    document.getElementById('mobile-menu').classList.remove('open');
  }

  // Close menu on outside click
  document.addEventListener('click', function(e) {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger');
    if (menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) {
      closeMenu();
    }
  });

  function switchTab(tab) {
    document.getElementById('form-login').hidden = tab !== 'login';
    document.getElementById('form-register').hidden = tab !== 'register';
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  }

  function setDiff(btn) {
    btn.closest('.diff-row').querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function setQuality(btn) {
    btn.closest('.quality-row').querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function setLang(btn) {
    btn.closest('.lang-row').querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
