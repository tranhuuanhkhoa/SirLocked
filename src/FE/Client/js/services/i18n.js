const STORAGE_KEY = 'sirlocked.uiLanguage';
const SUPPORTED_LANGUAGES = new Set(['en', 'vi']);

export function uiLanguage() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.has(saved) ? saved : 'en';
}

export function setUiLanguage(language) {
  const next = SUPPORTED_LANGUAGES.has(language) ? language : 'en';
  window.localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;
}

export function tr(english, vietnamese) {
  return uiLanguage() === 'vi' ? vietnamese : english;
}

export function languageSwitchMarkup(className = '') {
  const active = uiLanguage();
  return `
    <div class="ui-language-switch ${className}" role="group" aria-label="${tr('Interface language', 'Ngôn ngữ giao diện')}">
      <button type="button" class="ui-language-option${active === 'en' ? ' is-active' : ''}"
              data-ui-language="en" aria-pressed="${active === 'en'}">EN</button>
      <button type="button" class="ui-language-option${active === 'vi' ? ' is-active' : ''}"
              data-ui-language="vi" aria-pressed="${active === 'vi'}">VI</button>
    </div>`;
}
