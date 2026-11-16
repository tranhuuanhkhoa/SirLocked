import { expect, test, type Page } from '@playwright/test';

/**
 * https://sirlocked.id.vn/ is the introduction page, a static file at /trang-chu/index.html (public/trang-chu). The game's
 * index.html sends the root there and the page puts "/" back in the address bar, so everything it loads has to use
 * absolute /trang-chu/assets/... paths.
 */
const address = (page: Page) => page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);

async function openRoot(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }),
  }));
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect.poll(() => address(page)).toBe('/');
}

test('every picture and the music of the introduction page load while the address is /', async ({ page }) => {
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

test('the music starts by itself, at the first touch when the browser blocks that, and stays off once turned off', async ({ page }) => {
  await page.addInitScript(() => {
    const plays: number[] = [];
    (window as any).__plays = plays;
    // The first try is refused like a browser that blocks sound before any touch; later ones play.
    HTMLMediaElement.prototype.play = function () {
      plays.push(Date.now());
      return plays.length === 1 ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : Promise.resolve();
    };
  });
  await openRoot(page);
  const button = page.locator('#music-btn');
  await expect.poll(() => page.evaluate(() => (window as any).__plays.length)).toBe(1);
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.lede').click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#music-label')).toHaveText('Tắt nhạc');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('sl-music'))).toBe('0');

  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await page.locator('.lede').click();
  expect(await page.evaluate(() => (window as any).__plays.length)).toBe(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('the music plays at once when the browser allows it', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__plays = 0;
    HTMLMediaElement.prototype.play = function () { (window as any).__plays += 1; return Promise.resolve(); };
  });
  await openRoot(page);
  await expect(page.locator('#music-btn')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__plays)).toBe(1);
});

test('"Tạo tài khoản" opens the register form of the game', async ({ page }) => {
  await openRoot(page);
  await page.getByRole('link', { name: 'Tạo tài khoản' }).click();
  await expect(page).toHaveURL(/\/login\?tab=register$/);
  await expect(page.locator('#form-register')).toBeVisible();
  await expect(page.locator('#form-login')).toBeHidden();
});

test('the sign-in buttons lead to the game login page', async ({ page }) => {
  await openRoot(page);
  await page.locator('.top-act a[href="/login"]').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('#form-login')).toBeVisible();
});
