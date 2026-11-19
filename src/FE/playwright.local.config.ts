import base from './playwright.config';
export default { ...base, webServer: undefined, use: { ...base.use, actionTimeout: 15000, screenshot: 'only-on-failure', launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } } };
