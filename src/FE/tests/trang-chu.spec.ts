import { expect, test, type Page } from '@playwright/test';

/**
 * https://sirlocked.id.vn/ is the introduction page, a static file at /trang-chu/index.html (public/trang-chu). The game's
 * index.html sends the root there and the page puts "/" back in the address bar, so everything it loads has to use
 * absolute /trang-chu/assets/... paths.
 *
 * Browsers refuse sound before the visitor's first click. When the page's own try is refused it covers itself with
 * "Bấm để vào" (#gate), so the click that enters is also the one that starts the music.
 */
const address = (page: Page) => page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
const plays = (page: Page) => page.evaluate(() => (window as any).__plays as number);

/** Stands in for the browser's rule: `allowed` plays at once, `blocked` refuses until the page has been clicked. */
async function soundPolicy(page: Page, policy: 'allowed' | 'blocked') {
  await page.addInitScript((mode) => {
    (window as any).__plays = 0;
    let clicked = mode === 'allowed';
    for (const type of ['pointerdown', 'keydown', 'click']) addEventListener(type, () => { clicked = true; }, true);
    HTMLMediaElement.prototype.play = function () {
      (window as any).__plays += 1;
      return clicked ? Promise.resolve() : Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    };
  }, policy);
}

async function openRoot(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }),
  }));
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect.poll(() => address(page)).toBe('/');
}

test('every picture and the music of the introduction page load while the address is /', async ({ page }) => {
  await soundPolicy(page, 'allowed');
  await openRoot(page);
  await expect.poll(() => page.locator('img.art-lit').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const broken = await page.evaluate(async () => {
    const html = await (await fetch('/trang-chu/index.html')).text();
    const paths = [...new Set(html.match(/\/trang-chu\/assets\/[\w-]+\.[a-z0-9]+/g) ?? [])];
    const bad: string[] = [];
    for (const path of paths) {
      const response = await fetch(path);
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !/^(image|audio)\//.test(type)) bad.push(`${path} ${response.status} ${type}`);
    }
    return { count: paths.length, bad };
  });
  expect(broken.count).toBeGreaterThan(20);
  expect(broken.bad).toEqual([]);
  // A relative assets/... would now resolve against / and get the game's index.html instead.
  expect(await page.evaluate(() => document.documentElement.outerHTML.match(/["']assets\//g))).toBeNull();
});

test('when the browser allows sound the music plays at once, with nothing in the way', async ({ page }) => {
  await soundPolicy(page, 'allowed');
  await openRoot(page);
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#gate')).toBeHidden();
  expect(await plays(page)).toBe(1);
});

test('when the browser blocks sound, the click on "Bấm để vào" enters the page and starts the music', async ({ page }) => {
  await soundPolicy(page, 'blocked');
  await openRoot(page);
  const gate = page.locator('#gate');
  await expect(gate).toBeVisible();
  await expect(page.locator('#gate-go')).toBeFocused();
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'false');
  // The page behind waits: no scrolling, nothing to tab to.
  expect(await page.evaluate(() => (document.querySelector('#top-bar') as HTMLElement).inert)).toBe(true);

  await page.locator('#gate-go').click();
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(gate).toBeHidden();
  expect(await page.evaluate(() => (document.querySelector('#top-bar') as HTMLElement).inert)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.classList.contains('gated'))).toBe(false);
});

test('a click anywhere on the cover enters too, and the keyboard reaches it', async ({ page }) => {
  await soundPolicy(page, 'blocked');
  await openRoot(page);
  await expect(page.locator('#gate')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('#gate')).toBeVisible();
  await page.mouse.click(30, 30);
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');
});

test('"Vào không bật nhạc" enters in silence and is remembered; the music button still turns it on', async ({ page }) => {
  await soundPolicy(page, 'blocked');
  await openRoot(page);
  await page.locator('#gate-quiet').click();
  await expect(page.locator('#gate')).toBeHidden();
  await page.locator('.lede').click();
  expect(await plays(page)).toBe(1);
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('sl-music'))).toBe('0');

  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect(page.locator('#gate')).toBeHidden();
  expect(await plays(page)).toBe(0);

  await page.locator('#music-btn').click();
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('sl-music'))).toBe('1');
});

test('turning the music off with its button is remembered too', async ({ page }) => {
  await soundPolicy(page, 'allowed');
  await openRoot(page);
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#music-btn').click();
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await page.locator('.lede').click();
  expect(await plays(page)).toBe(0);
});

test('"Tạo tài khoản" opens the register form of the game', async ({ page }) => {
  await soundPolicy(page, 'allowed');
  await openRoot(page);
  await page.getByRole('link', { name: 'Tạo tài khoản' }).click();
  await expect(page).toHaveURL(/\/login\?tab=register$/);
  await expect(page.locator('#form-register')).toBeVisible();
  await expect(page.locator('#form-login')).toBeHidden();
});

test('the sign-in buttons lead to the game login page', async ({ page }) => {
  await soundPolicy(page, 'allowed');
  await openRoot(page);
  await page.locator('.top-act a[href="/login"]').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('#form-login')).toBeVisible();
});
