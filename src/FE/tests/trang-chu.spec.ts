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
  expect(broken.count).toBeGreaterThanOrEqual(20);
  expect(broken.bad).toEqual([]);
  // A relative assets/... would now resolve against / and get the game's index.html instead.
  expect(await page.evaluate(() => document.documentElement.outerHTML.match(/["']assets\//g))).toBeNull();
});

test('the jump from / fetches the current homepage every time, not a copy the browser kept', async ({ page }) => {
  // The server sends no Cache-Control: without a fresh ?v= the browser reused an old homepage even after Ctrl+F5 on /.
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/trang-chu/index.html') asked.push(url.search);
  });
  await openRoot(page);
  await page.goto('/?ref=abc');
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect.poll(() => address(page)).toBe('/?ref=abc');
  expect(asked).toHaveLength(2);
  expect(asked[0]).toMatch(/^\?v=[0-9a-z]+$/);
  expect(asked[1]).toMatch(/^\?v=[0-9a-z]+&ref=abc$/);
  expect(asked[1].split('&')[0]).not.toBe(asked[0]);
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

/** Text a visitor reads or hears (text, aria-label, alt, title) that still holds a common Vietnamese word. */
const untranslated = (page: Page) => page.evaluate(() => {
  const vietnamese = /(^|[\s“«(,])(và|của|một|được|các|cho|không|là|trên|với|người|đã|để|những|trong|khi|này|có|từ|bằng|đang)(?=[\s.,:;!?”»)]|$)/;
  const found: string[] = [];
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { const text = child.nodeValue!.trim(); if (vietnamese.test(text)) found.push(text); }
      else if (child.nodeType === 1 && !['SCRIPT', 'STYLE'].includes((child as Element).tagName)) {
        for (const name of ['aria-label', 'alt', 'title']) {
          const value = (child as Element).getAttribute(name);
          if (value && vietnamese.test(value)) found.push(`${name}: ${value}`);
        }
        visit(child);
      }
    }
  };
  visit(document.body);
  return found;
});

test('with no language chosen the page is Vietnamese; EN translates all of it and VI brings it back exactly', async ({ page }) => {
  // Music off, so the first click (on EN) does not also change the music button between the two snapshots.
  await page.addInitScript(() => localStorage.setItem('sl-music', '0'));
  await openRoot(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.locator('.lang-opt[data-lang="vi"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lede')).toContainText('Game phá án co-op');
  const vietnameseText = await page.evaluate(() => document.body.textContent);

  await page.locator('.lang-opt[data-lang="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.lede')).toContainText('A co-op detective game for two');
  await expect(page.locator('.top-act a[href="/login"]')).toHaveText('Sign in');
  await expect(page).toHaveTitle('Sir Locked — co-op detective game');
  expect(await untranslated(page)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.uiLanguage'))).toBe('en');

  await page.locator('.lang-opt[data-lang="vi"]').click();
  await expect(page.locator('.lede')).toContainText('Game phá án co-op');
  expect(await page.evaluate(() => document.body.textContent)).toBe(vietnameseText);
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.uiLanguage'))).toBe('vi');
});

test('the language is shared with the game, both ways', async ({ page }) => {
  await openRoot(page);
  // Chosen in the game: the page opens in it straight away.
  await page.evaluate(() => localStorage.setItem('sirlocked.uiLanguage', 'en'));
  await page.reload();
  await expect(page.locator('.lede')).toContainText('A co-op detective game for two');
  await expect(page.locator('.lang-opt[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.classList.contains('i18n-wait'))).toBe(false);

  // Chosen on the page: the game opens in it.
  await page.locator('.lang-opt[data-lang="vi"]').click();
  await page.locator('.top-act a[href="/login"]').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.bpa-auth-tab').first()).toHaveText('Đăng nhập');
  await page.evaluate(() => localStorage.setItem('sirlocked.uiLanguage', 'en'));
  await page.reload();
  await expect(page.locator('.bpa-auth-tab').first()).toHaveText('Log in');
});

test('the chest simulator speaks the chosen language, also after switching', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRoot(page);
  await page.locator('.lang-opt[data-lang="en"]').click();
  await page.locator('#open-chest').click();
  await expect(page.locator('#vault-log')).toHaveText(/^Opened 1 chest · rarest: (Common|Rare|Epic|Legendary|Mystery)$/);
  await expect(page.locator('#rw-rar')).toHaveText(/^(Common|Rare|Epic|Legendary|Mystery)$/);
  await expect(page.locator('#rw-type')).toHaveText(/^(Collectible|Frame|Title|Lobby entrance)( · .+)?$/);
  await expect(page.locator('#open-label')).toHaveText('Open another');

  await page.locator('.lang-opt[data-lang="vi"]').click();
  await expect(page.locator('#vault-log')).toHaveText(/^Đã mở 1 hòm · hiếm nhất: (Thường|Hiếm|Quý|Huyền thoại|Bí ẩn)$/);
  await expect(page.locator('#rw-type')).toHaveText(/^(Sưu tầm|Viền|Danh hiệu|Hiệu ứng vào sảnh)( · .+)?$/);
  await expect(page.locator('#open-label')).toHaveText('Mở hòm khác');
});

test('the language switch fits the top bar of a small phone in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoot(page);
  for (const lang of ['vi', 'en']) {
    await page.locator(`.lang-opt[data-lang="${lang}"]`).click();
    const fit = await page.evaluate(() => {
      const act = document.querySelector('.top-act')!.getBoundingClientRect();
      const brand = document.querySelector('.top .brand')!.getBoundingClientRect();
      return { right: act.right, left: act.left, brandRight: brand.right, width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(fit.overflow).toBe(0);
    expect(fit.right).toBeLessThanOrEqual(fit.width);
    expect(fit.left).toBeGreaterThanOrEqual(fit.brandRight);
  }
});

const litPixels = (page: Page) => page.locator('#fireworks').evaluate((canvas: HTMLCanvasElement) => {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) lit += 1;
  return lit;
});
const showChests = (page: Page) => page.locator('#kho-do').evaluate((section) => {
  window.scrollTo({ top: section.getBoundingClientRect().top + scrollY, behavior: 'instant' as ScrollBehavior });
});

test('fireworks replace the flying dragon and play while the chest section is on screen', async ({ page }) => {
  await openRoot(page);
  await expect(page.locator('img[src*="rong-bay"], .dragon-lane')).toHaveCount(0);
  expect(await litPixels(page)).toBe(0);

  await showChests(page);
  await expect.poll(() => litPixels(page), { timeout: 6000 }).toBeGreaterThan(200);
  // The canvas covers the screen plus a margin and follows the scroll, instead of the whole (much taller) section.
  const size = await page.evaluate(() => ({
    canvas: document.querySelector('#fireworks')!.getBoundingClientRect().height,
    section: document.querySelector('#kho-do')!.getBoundingClientRect().height,
    screen: innerHeight,
  }));
  expect(size.canvas).toBeLessThanOrEqual(Math.min(size.section, size.screen + 240));
});

test('"Tắt hiệu ứng" and reduced motion stop the fireworks', async ({ page }) => {
  await openRoot(page);
  await showChests(page);
  await expect.poll(() => litPixels(page), { timeout: 6000 }).toBeGreaterThan(200);

  await page.locator('#calm-btn').click();
  await expect(page.locator('#fireworks')).toBeHidden();
  expect(await litPixels(page)).toBe(0);
  await page.locator('#calm-btn').click();
  await expect(page.locator('#fireworks')).toBeVisible();
  await expect.poll(() => litPixels(page), { timeout: 6000 }).toBeGreaterThan(200);

  await page.evaluate(() => localStorage.removeItem('sl-calm'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await showChests(page);
  await expect(page.locator('#fireworks')).toBeHidden();
  await page.waitForTimeout(1500);
  expect(await litPixels(page)).toBe(0);
});

/** The two pixel-art detectives of the hero are cut from one picture: same scale, standing on the bottom, beside the title. */
for (const [width, height] of [[1440, 900], [1920, 1080], [1262, 903], [1100, 820], [390, 844]] as const) {
  test(`the pixel-art Sherlock and Watson stand in the hero at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openRoot(page);
    const sherlock = page.locator('#fig-sherlock img');
    const watson = page.locator('#fig-watson img');
    await expect(sherlock).toHaveAttribute('src', '/trang-chu/assets/sherlock-pixel.webp');
    await expect(watson).toHaveAttribute('src', '/trang-chu/assets/watson-pixel.webp');
    for (const img of [sherlock, watson]) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    await page.waitForTimeout(2600); // the entrance animation
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const stage = rect('#stage'), sh = rect('#fig-sherlock'), wa = rect('#fig-watson'), title = rect('#hero-title');
      const smoke = rect('#fig-sherlock .smoke');
      return { stage, sh, wa, title, smoke, vw: innerWidth };
    });
    const { stage, sh, wa, title, smoke, vw } = layout;
    // One scale: each picture keeps its own proportions, and Watson is drawn at Sherlock's scale.
    expect(Math.abs(sh.width / sh.height - 669 / 996)).toBeLessThan(0.01);
    expect(Math.abs(wa.width / wa.height - 489 / 909)).toBeLessThan(0.01);
    expect(Math.abs(sh.height / 996 - wa.height / 909)).toBeLessThan(0.005);
    // Both stand on the bottom of the picture, Sherlock on the left, Watson on the right, neither lost off screen.
    expect(Math.abs(sh.bottom - (stage.bottom + 10)) <= 3 || Math.abs(sh.bottom - (stage.bottom + 8)) <= 3).toBe(true);
    expect(Math.abs(wa.bottom - sh.bottom)).toBeLessThanOrEqual(3);
    expect(sh.left).toBeLessThanOrEqual(0);
    expect(sh.right).toBeGreaterThan(sh.width * 0.85);
    expect(wa.left).toBeGreaterThan(vw / 2);
    expect(wa.right - vw).toBeLessThanOrEqual(wa.width * 0.07);
    // Sherlock never covers the title on a wide screen (on a phone the title sits under the picture).
    if (width >= 1200) expect(sh.right * 0.95).toBeLessThan(title.left + 4);
    // The pipe smoke starts at the bowl of the pipe in his hand (78.9% across, 17.5% down the picture).
    expect(Math.abs(smoke.left + smoke.width / 2 - (sh.left + sh.width * 0.789))).toBeLessThan(3);
    expect(Math.abs(smoke.top - (sh.top + sh.height * 0.175))).toBeLessThan(3);
  });
}

/**
 * The detectives are pixel art (stored 3x: Sherlock is drawn 223 x 332). Smoothed scaling made them soft; now they are
 * scaled nearest-neighbour, and wherever a whole number of screen pixels per drawn pixel is near, the scale snaps to it.
 */
for (const [width, height, dpr, whole] of [[1440, 900, 1, 2], [1440, 900, 2, 4], [1366, 768, 1, 2], [390, 844, 3, 2], [1920, 1080, 1, null]] as const) {
  test(`Sherlock and Watson are drawn crisp at ${width}×${height} @${dpr}x`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    try {
      await openRoot(page);
      await page.waitForTimeout(2600); // the entrance animation
      const figures = await page.$$eval('.fig img', (images) => images.map((img) => {
        const image = img as HTMLImageElement, box = image.getBoundingClientRect();
        return {
          rendering: getComputedStyle(image).imageRendering,
          screenPixelsPerDrawnPixel: (box.height * devicePixelRatio) / (image.naturalHeight / 3),
          left: box.left * devicePixelRatio,
        };
      }));
      expect(figures).toHaveLength(2);
      for (const figure of figures) {
        expect(figure.rendering).toBe('pixelated');
        if (whole !== null) {
          expect(figure.screenPixelsPerDrawnPixel).toBeCloseTo(whole, 3);
          // Placed on whole screen pixels too.
          expect(Math.abs(figure.left - Math.round(figure.left))).toBeLessThan(0.01);
        }
      }
      // Both at one scale.
      expect(figures[0].screenPixelsPerDrawnPixel).toBeCloseTo(figures[1].screenPixelsPerDrawnPixel, 3);
    } finally {
      await context.close();
    }
  });
}

test('the two role avatars show the new detectives', async ({ page }) => {
  await openRoot(page);
  const avatars = page.locator('.role .avatar img');
  await expect(avatars).toHaveCount(2);
  await avatars.first().scrollIntoViewIfNeeded();
  expect(await avatars.evaluateAll((list) => list.map((img) => (img as HTMLImageElement).getAttribute('src'))))
    .toEqual(['/trang-chu/assets/avatar-watson-pixel.webp', '/trang-chu/assets/avatar-sherlock-pixel.webp']);
  for (const index of [0, 1]) {
    await expect.poll(() => avatars.nth(index).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 180)).toBe(true);
  }
});
