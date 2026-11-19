/* Motion-comic player: draws an AI-written script on a canvas using the case's pixel art.
   Loaded lazily (dynamic import) the first time a cutscene plays. */
import '../../../../css/45-motion-comic.css';
import { escapeHtml } from '../../utils/dom.js';
import { tr } from '../../services/i18n.js';
import { ComicAudio, type AudioSettingsAccess } from './motionComicAudio.js';
import { artTitle, artUrl, drawPanelArt, loadImages, mulberry } from './motionComicArt.js';
import {
  PAGE_H, PAGE_PLACEMENT, PAGE_RECT, PAGE_W, TIMING, buildTimeline, flashAt, shakeAt, shotAt,
  type BeatPlan, type PanelPlan, type PlayableCutscene, type Rect, type Shot, type Timeline,
} from './motionComicModel.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const E = {
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  outBack: (t: number) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  sine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};
const C = { void: '#07090D', ink: '#0A0D14', paper: '#E4DBC6', amber: '#F0A43A', caption: '#F1DC8A' };
const FONT = {
  sfx: '"Bangers", Impact, "Arial Narrow", sans-serif',
  letter: '"Patrick Hand", "Segoe Print", "Comic Sans MS", sans-serif',
  mono: '"Xanh Mono", "Courier New", monospace',
};
const SFX_COLORS: Record<string, [string, string]> = {
  impact: [C.amber, '#7A1E14'], soft: [C.paper, '#1C2433'], glass: ['#CFE6FF', '#173A5E'], phone: [C.paper, '#1C2433'], thunder: [C.amber, '#7A1E14'],
};

export type MotionComicOptions = {
  cutscene: PlayableCutscene;
  audio: AudioSettingsAccess;
  /** Label of the final button: "Vào điều tra" in the game, "Đóng" in a preview. */
  finishLabel: string;
  onDone: (reason: 'finished' | 'skipped' | 'closed') => void;
  mount?: HTMLElement;
};
export type MotionComicHandle = {
  dispose(): void;
  readonly state: string;
  /** Seconds into the timeline (test hook). */
  readonly time: number;
  /** Test hook: jump the timeline. */
  seek(t: number): void;
  readonly timeline: Timeline;
};

let fontsLinked = false;
function linkFonts() {
  if (fontsLinked) return;
  fontsLinked = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Bangers&family=Patrick+Hand&family=Xanh+Mono&display=swap';
  document.head.appendChild(link);
}

async function ensureFonts(sample: string) {
  linkFonts();
  try {
    await Promise.race([
      Promise.all(['40px "Bangers"', '27px "Patrick Hand"', '20px "Xanh Mono"'].map((f) => document.fonts.load(f, sample))),
      new Promise((resolve) => setTimeout(resolve, 3500)),
    ]);
  } catch { /* system fonts are the fallback */ }
}

type Letter = {
  beat: BeatPlan;
  kind: 'caption' | 'speech' | 'sfx';
  x: number; y: number; w: number; h: number; rot: number;
  lines: string[]; lineChars: string[][]; lh: number; size: number; padX: number; padY: number;
  who: string; tail: [number, number];
  // sfx only
  chars: string[]; ws: number[]; tw: number; fill: string; ext: string;
};

export async function playMotionComic(opts: MotionComicOptions): Promise<MotionComicHandle> {
  const { cutscene, audio: settings } = opts;
  const script = cutscene.script, assets = cutscene.assets;
  const mount = opts.mount ?? document.body;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let REDUCED = reducedQuery.matches;
  const onReducedChange = (e: MediaQueryListEvent) => { REDUCED = e.matches; };
  reducedQuery.addEventListener?.('change', onReducedChange);

  const root = document.createElement('div');
  root.className = 'mc-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', tr('Case opening comic', 'Truyện mở đầu vụ án'));
  root.dataset.mcState = 'loading';
  root.innerHTML = `
    <canvas class="mc-stage" tabindex="0" role="img" aria-label="${escapeHtml(tr('Animated comic. The narration is read in the live region.', 'Truyện tranh động. Lời dẫn được đọc qua vùng thông báo.'))}"></canvas>
    <div class="mc-scrim" data-mc-scrim></div>
    <div class="mc-ui">
      <header class="mc-hud" data-mc-hud hidden>
        <span class="mc-page-label" data-mc-page></span>
        <div class="mc-hud-actions">
          <button type="button" class="mc-hud-btn" data-mc-mute aria-pressed="false"><span data-mc-mute-label></span></button>
          <button type="button" class="mc-hud-btn" data-mc-skip><svg class="mc-ring" viewBox="0 0 18 18" aria-hidden="true"><circle class="mc-track" cx="9" cy="9" r="7"/><circle class="mc-fill" data-mc-ring cx="9" cy="9" r="7"/></svg><span>${escapeHtml(tr('Hold to skip', 'Giữ để bỏ qua'))}</span></button>
        </div>
      </header>
      <main class="mc-main">
        <section class="mc-start" data-mc-start hidden aria-labelledby="mc-start-title">
          <p class="mc-eyebrow">${escapeHtml(script.title.eyebrow)}</p>
          <h1 class="mc-logo" id="mc-start-title">${escapeHtml(script.title.title)}</h1>
          <p class="mc-sub">${escapeHtml(script.title.subtitle)}</p>
          <div class="mc-actions">
            <button type="button" class="mc-btn mc-btn-primary" data-mc-play>${escapeHtml(tr('Click to watch', 'Bấm để xem'))}</button>
            <button type="button" class="mc-btn mc-btn-ghost" data-mc-play-muted>${escapeHtml(tr('Watch without sound', 'Xem không tiếng'))}</button>
          </div>
          <p class="mc-meta"></p>
        </section>
        <section class="mc-end" data-mc-end hidden>
          <button type="button" class="mc-btn mc-btn-primary" data-mc-finish>${escapeHtml(opts.finishLabel)}</button>
          <button type="button" class="mc-btn mc-btn-ghost" data-mc-replay>${escapeHtml(tr('Watch again', 'Xem lại'))}</button>
        </section>
        <p class="mc-loading" data-mc-loading>${escapeHtml(tr('Loading…', 'Đang tải…'))}</p>
      </main>
      <footer class="mc-foot">
        <p class="mc-hint" data-mc-hint hidden></p>
        <p class="mc-rotate" data-mc-rotate hidden>${escapeHtml(tr('Rotate your phone sideways to see the full comic', 'Xoay ngang màn hình để xem trọn khung truyện'))}</p>
      </footer>
    </div>
    <div class="mc-subtitle" data-mc-subtitle hidden><span class="mc-who" data-mc-who></span><span data-mc-subtext></span></div>
    <div class="mc-sr" aria-live="polite" data-mc-live></div>`;
  mount.appendChild(root);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const cv = $<HTMLCanvasElement>('canvas.mc-stage');
  const g = cv.getContext('2d', { alpha: false })!;
  const ui = {
    hud: $('[data-mc-hud]'), page: $('[data-mc-page]'), mute: $<HTMLButtonElement>('[data-mc-mute]'), muteLbl: $('[data-mc-mute-label]'),
    skip: $<HTMLButtonElement>('[data-mc-skip]'), ring: $('[data-mc-ring]'), start: $('[data-mc-start]'), end: $('[data-mc-end]'),
    scrim: $('[data-mc-scrim]'), play: $<HTMLButtonElement>('[data-mc-play]'), playMuted: $<HTMLButtonElement>('[data-mc-play-muted]'),
    finish: $<HTMLButtonElement>('[data-mc-finish]'), replay: $<HTMLButtonElement>('[data-mc-replay]'), hint: $('[data-mc-hint]'),
    rotate: $('[data-mc-rotate]'), sub: $('[data-mc-subtitle]'), subWho: $('[data-mc-who]'), subText: $('[data-mc-subtext]'),
    live: $('[data-mc-live]'), loading: $('[data-mc-loading]'), meta: $('.mc-meta'),
  };

  // ---------------------------------------------------------------- assets and layout
  const tl = buildTimeline(script);
  const urls = tl.panels.map((p) => artUrl(p.art, assets));
  const sample = 'ẦM!! CẠCH. ƯƠNG ĐỒNG HỒ Ở THÁM TỬ ạ ữ ế ộ ố ằ ẫ ỳ ỷ' + script.title.title + script.pages.flatMap((p) => p.panels.flatMap((q) => q.beats.map((b) => b.text))).join('');
  const [images] = await Promise.all([loadImages(urls), ensureFonts(sample)]);

  let VW = 1, VH = 1, DPR = 1, dprCap = 2;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, dprCap);
    VW = Math.max(1, root.clientWidth || window.innerWidth); VH = Math.max(1, root.clientHeight || window.innerHeight);
    cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  }
  const onResize = () => { resize(); };
  window.addEventListener('resize', onResize);
  resize();

  const measure = document.createElement('canvas').getContext('2d')!;
  const panelByKey = new Map(tl.panels.map((p) => [p.key, p]));
  const letters = new Map<string, Letter[]>();
  function layoutLettering() {
    for (const panel of tl.panels) {
      const list: Letter[] = [];
      let top = 26, bottom = 30, sfxIndex = 0;
      for (const beat of panel.beats) {
        if (beat.type === 'sfx') {
          const size = Math.max(40, Math.min(110, panel.bb.w * 0.11, panel.bb.h * 0.2));
          measure.font = `${size}px ${FONT.sfx}`;
          const chars = Array.from(beat.text);
          const ws = chars.map((ch) => measure.measureText(ch).width + size * 0.015);
          const tw = ws.reduce((a, b) => a + b, 0);
          const [fill, ext] = SFX_COLORS[beat.style] ?? SFX_COLORS.impact;
          const right = sfxIndex % 2 === 0;
          const x = right ? panel.bb.x + panel.bb.w - tw / 2 - 40 : panel.bb.x + tw / 2 + 40;
          const y = right ? panel.bb.y + size * 0.8 + 24 : panel.bb.y + panel.bb.h - size * 0.7 - 24;
          list.push({ beat, kind: 'sfx', x, y, w: tw, h: size, rot: right ? 7 : -6, lines: [], lineChars: [], lh: 0, size, padX: 0, padY: 0, who: '', tail: [0, 0], chars, ws, tw, fill, ext });
          sfxIndex++;
          continue;
        }
        const speech = beat.type === 'speech';
        const size = speech ? 25 : 27, padX = speech ? 18 : 16, padY = speech ? 14 : 12;
        const maxW = Math.min(speech ? 380 : 430, panel.bb.w * (speech ? 0.5 : 0.56));
        measure.font = `${size}px ${FONT.letter}`;
        const words = beat.text.toUpperCase().split(' ');
        const lines: string[] = [];
        let cur = '';
        for (const wd of words) {
          const test = cur ? `${cur} ${wd}` : wd;
          if (cur && measure.measureText(test).width > maxW - 2 * padX) { lines.push(cur); cur = wd; } else cur = test;
        }
        if (cur) lines.push(cur);
        const widths = lines.map((l) => measure.measureText(l).width), lh = size * 1.24;
        const w = Math.max(...widths) + padX * 2, who = speech ? (assets.characters[beat.speakerId]?.title ?? '') : '';
        const h = lines.length * lh + padY * 2 - lh * 0.08 + (who ? 16 : 0);
        const jitter = list.length % 2 ? 0.7 : -0.9;
        let x: number, y: number;
        if (speech) { x = panel.bb.x + panel.bb.w - w - 36; bottom += h + 12; y = panel.bb.y + panel.bb.h - bottom; } else { x = panel.bb.x + 34; y = panel.bb.y + top; top += h + 14; }
        const tail: [number, number] = [panel.bb.x + panel.bb.w * 0.5, panel.bb.y + panel.bb.h * 0.55];
        list.push({ beat, kind: speech ? 'speech' : 'caption', x, y, w, h, rot: jitter, lines, lineChars: lines.map((l) => Array.from(l)), lh, size, padX, padY, who, tail, chars: [], ws: [], tw: 0, fill: '', ext: '' });
      }
      letters.set(panel.key, list);
    }
  }
  layoutLettering();

  // ---------------------------------------------------------------- stage helpers
  type Frame = { x: number; y: number; w: number; h: number; portrait: boolean; bar: number };
  let FRAME: Frame = { x: 0, y: 0, w: 1, h: 1, portrait: false, bar: 0 };
  function computeFrame(barK: number) {
    const portrait = VW / VH < 1.05;
    if (portrait) { const top = Math.max(56, VH * 0.1), h = Math.min(VW * 0.92, VH * 0.48); FRAME = { x: 0, y: top, w: VW, h, portrait: true, bar: 0 }; }
    else { const bar = Math.round(VH * 0.065 * barK); FRAME = { x: 0, y: bar, w: VW, h: VH - 2 * bar, portrait: false, bar }; }
  }
  const place = (pi: number) => PAGE_PLACEMENT[Math.min(pi, PAGE_PLACEMENT.length - 1)];
  const pageToWorld = (pi: number, x: number, y: number): [number, number] => {
    const P = place(pi), rot = P.rot * DEG, dx = x - PAGE_W / 2, dy = y - PAGE_H / 2, c = Math.cos(rot), s = Math.sin(rot);
    return [P.cx + dx * c - dy * s, P.cy + dx * s + dy * c];
  };
  type Cam = { x: number; y: number; lz: number; rot: number };
  function rectCam(pi: number, r: Rect, tilt: boolean, zoomOut = 1): Cam {
    const [x, y] = pageToWorld(pi, r[0] + r[2] / 2, r[1] + r[3] / 2);
    let z = Math.min(FRAME.w * 0.96 / r[2], FRAME.h * 0.96 / r[3]);
    z /= zoomOut;
    return { x, y, lz: Math.log(z), rot: tilt ? 0 : place(pi).rot * DEG };
  }
  const mixCam = (a: Cam, b: Cam, k: number, bump = 0): Cam => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), lz: lerp(a.lz, b.lz, k) - (REDUCED ? 0 : bump) * Math.sin(Math.PI * k), rot: lerp(a.rot, b.rot, k) });
  function shotCam(sh: Shot, lt: number): Cam {
    if (sh.kind === 'panel') {
      const a = rectCam(sh.page, sh.from, false), b = rectCam(sh.page, sh.to, false);
      return mixCam(a, b, REDUCED ? 1 : E.sine(clamp((lt - sh.trans) / sh.move)));
    }
    if (sh.kind === 'title') return rectCam(sh.page, PAGE_RECT, true, 1.5);
    return rectCam(sh.page, PAGE_RECT, true);
  }
  function camAt(T: number): Cam {
    const i = shotAt(tl, T), sh = tl.shots[i], lt = T - sh.t0, cur = shotCam(sh, lt);
    if (REDUCED) return shotCam(sh, sh.dur);
    if (i > 0 && lt < sh.trans) {
      const pv = tl.shots[i - 1];
      return mixCam(shotCam(pv, pv.dur), cur, E.inOut(lt / sh.trans), sh.kind === 'page' ? 0.25 : 0);
    }
    return cur;
  }
  function onScreen(wx: number, wy: number, rad: number, cam: Cam) {
    const z = Math.exp(cam.lz), dx = wx - cam.x, dy = wy - cam.y, c = Math.cos(-cam.rot), s = Math.sin(-cam.rot);
    const sx = (dx * c - dy * s) * z + FRAME.x + FRAME.w / 2, sy = (dx * s + dy * c) * z + FRAME.y + FRAME.h / 2, R = rad * z;
    return sx > -R && sx < VW + R && sy > -R && sy < VH + R;
  }

  // ---------------------------------------------------------------- state
  let state: 'loading' | 'ready' | 'playing' | 'ended' = 'loading';
  let T = 0, A = 0, evIdx = 0, curShot = -1, stepIdx = 0, disposed = false, rafId = 0, holdStart = 0;
  let lastLive = '', lastPage = -1, playStartA = 0;
  const comicAudio = new ComicAudio(settings);
  comicAudio.setMood(script.mood);

  function syncMute() {
    const muted = settings.get().muted;
    ui.mute.setAttribute('aria-pressed', String(muted));
    ui.mute.setAttribute('aria-label', muted ? tr('Turn sound on', 'Bật âm thanh') : tr('Turn sound off', 'Tắt âm thanh'));
    ui.muteLbl.textContent = muted ? tr('Sound off', 'Đã tắt tiếng') : tr('Sound', 'Âm thanh');
    comicAudio.applyLevels();
  }
  function setMuted(m: boolean) { settings.set({ muted: m }); syncMute(); }

  const setState = (s: typeof state) => { state = s; root.dataset.mcState = s; };

  // ---------------------------------------------------------------- rendering
  function revealK(P: PanelPlan) { return REDUCED ? (T >= P.revealT ? 1 : 0) : clamp((T - P.revealT) / 0.75); }
  function panelDim(P: PanelPlan) {
    if (REDUCED) return 0;
    const i = shotAt(tl, T), sh = tl.shots[i], prev = i > 0 ? tl.shots[i - 1] : null;
    const dimFor = (s: Shot | null) => (s && s.kind === 'panel' && s.panelKey !== P.key && s.page === P.page ? 0.5 : 0);
    return lerp(dimFor(prev), dimFor(sh), clamp((T - sh.t0) / 0.5));
  }
  function roughPath(poly: [number, number][], seed: number) {
    const r = mulberry(seed), p = new Path2D();
    let first = true;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 30));
      for (let k = 0; k < n; k++) {
        const t = k / n; let x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t);
        if (k > 0) { x += (r() - 0.5) * 2.4; y += (r() - 0.5) * 2.4; }
        if (first) { p.moveTo(x, y); first = false; } else p.lineTo(x, y);
      }
    }
    p.closePath();
    return p;
  }
  const paths = new Map(tl.panels.map((p, i) => [p.key, roughPath(p.poly, 11 + i * 7)]));

  function drawPanel(P: PanelPlan, cam: Cam) {
    const rv = revealK(P);
    if (rv <= 0) return;
    const bb = P.bb, cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    const [wx, wy] = pageToWorld(P.page, cx, cy);
    if (!onScreen(wx, wy, Math.hypot(bb.w, bb.h) / 2 + 80, cam)) return;
    const e = E.out(clamp(rv * 1.3)), sc = REDUCED ? 1 : lerp(1.06, 1, e), off = REDUCED ? 0 : (1 - e) * 26;
    const path = paths.get(P.key)!;
    g.save();
    g.translate(cx + P.enter[0] * off, cy + P.enter[1] * off); g.scale(sc, sc); g.translate(-cx, -cy);
    g.save();
    g.clip(path);
    g.globalAlpha = REDUCED ? 1 : clamp(rv * 2.2);
    g.translate(bb.x, bb.y);
    drawPanelArt(g, images.get(artUrl(P.art, assets)) ?? null, P.art, bb.w, bb.h, {
      t: T - P.revealT, A, weather: P.weather, mood: script.mood, flash: REDUCED ? 0 : flashAt(tl, P.page, T), reduced: REDUCED, seed: 31 + P.index * 17 + P.page * 5,
    }, artTitle(P.art, assets), FONT.letter);
    const dim = panelDim(P);
    if (dim > 0.005) { g.fillStyle = `rgba(4,6,10,${dim})`; g.fillRect(-4, -4, bb.w + 8, bb.h + 8); }
    g.restore();
    g.globalAlpha = clamp(rv * 2 - 0.3); g.lineWidth = 6; g.strokeStyle = C.ink; g.lineJoin = 'round'; g.stroke(path); g.globalAlpha = 1;
    g.restore();
  }

  function typedCount(b: BeatPlan) { return REDUCED ? 1e9 : Math.max(0, Math.floor((T - b.start - 0.1) * TIMING.cps)); }

  function drawLetter(L: Letter) {
    const b = L.beat;
    if (T < b.start) return;
    const a = clamp((T - b.start) / 0.2), dim = panelDim(panelByKey.get(b.panelKey)!);
    if (L.kind === 'sfx') {
      const p = clamp((T - b.start) / 0.32), sc = REDUCED ? 1 : lerp(0.3, 1, E.outBack(p));
      g.save(); g.translate(L.x, L.y); g.rotate(L.rot * DEG); g.scale(sc, sc); g.globalAlpha = clamp(p * 3) * (1 - dim * 0.75);
      g.font = `${L.size}px ${FONT.sfx}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineJoin = 'round';
      let x = -L.tw / 2;
      L.chars.forEach((ch, i) => {
        const wd = L.ws[i];
        g.save(); g.translate(x + wd / 2, (i % 2 ? 1 : -1) * L.size * 0.03); g.rotate((i % 2 ? 1 : -1) * 3 * DEG);
        const d = L.size * 0.022; g.fillStyle = L.ext;
        for (let k = 6; k >= 1; k--) g.fillText(ch, -wd / 2 + k * d * 0.7, k * d);
        g.strokeStyle = C.ink; g.lineWidth = L.size * 0.09; g.strokeText(ch, -wd / 2, 0); g.fillStyle = L.fill; g.fillText(ch, -wd / 2, 0);
        g.restore(); x += wd;
      });
      g.restore();
      return;
    }
    if (FRAME.portrait) return; // phones show the lines in a caption bar under the comic
    const speech = L.kind === 'speech';
    g.save(); g.translate(L.x + L.w / 2, L.y + L.h / 2); g.rotate(L.rot * DEG);
    const sc = REDUCED ? 1 : lerp(0.86, 1, E.outBack(a)); g.scale(sc, sc); g.globalAlpha = clamp(a * 2);
    if (speech) {
      const tx = L.tail[0] - (L.x + L.w / 2), ty = L.tail[1] - (L.y + L.h / 2), ang = Math.atan2(ty, tx);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.roundRect(-L.w / 2 + 6, -L.h / 2 + 7, L.w, L.h, 26); g.fill();
      const tail = new Path2D(); const bx = Math.cos(ang) * L.w * 0.3, by = Math.sin(ang) * L.h * 0.45;
      tail.moveTo(bx - 12, by - 6); tail.lineTo(bx + Math.cos(ang) * 46, by + Math.sin(ang) * 46); tail.lineTo(bx + 12, by + 6); tail.closePath();
      g.fillStyle = '#F7F3EA'; g.lineWidth = 4; g.strokeStyle = C.ink; g.lineJoin = 'round';
      g.beginPath(); g.roundRect(-L.w / 2, -L.h / 2, L.w, L.h, 26); g.fill(); g.stroke(); g.fill(tail); g.stroke(tail);
      g.beginPath(); g.roundRect(-L.w / 2 + 2, -L.h / 2 + 2, L.w - 4, L.h - 4, 24); g.fillStyle = '#F7F3EA'; g.fill();
    } else {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-L.w / 2 + 7, -L.h / 2 + 8, L.w, L.h);
      g.fillStyle = C.caption; g.fillRect(-L.w / 2, -L.h / 2, L.w, L.h); g.lineWidth = 3; g.strokeStyle = C.ink; g.strokeRect(-L.w / 2, -L.h / 2, L.w, L.h);
    }
    g.fillStyle = '#17120A'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    let yOff = 0;
    if (L.who) { g.font = `13px ${FONT.mono}`; g.fillText(L.who.toUpperCase(), -L.w / 2 + L.padX, -L.h / 2 + L.padY + 9); yOff = 16; }
    g.font = `${L.size}px ${FONT.letter}`;
    let left = typedCount(b);
    for (let i = 0; i < L.lines.length && left > 0; i++) {
      const ch = L.lineChars[i], shown = left >= ch.length ? L.lines[i] : ch.slice(0, left).join('');
      left -= ch.length;
      g.fillText(shown, -L.w / 2 + L.padX, -L.h / 2 + L.padY + yOff + (i + 1) * L.lh - L.lh * 0.27);
    }
    if (dim > 0.005) { g.fillStyle = `rgba(4,6,10,${dim})`; g.fillRect(-L.w / 2 - 2, -L.h / 2 - 2, L.w + 4, L.h + 4); }
    g.restore();
  }

  function paperAlpha(pi: number) {
    const first = tl.shots.find((s) => s.kind === 'page' && s.page === pi);
    return REDUCED ? (first && T >= first.t0 ? 1 : 0) : clamp((T - (first?.t0 ?? 0) - 0.05) / 0.6);
  }
  function drawPage(pi: number, cam: Cam) {
    const pa = paperAlpha(pi);
    if (pa <= 0) return;
    const P = place(pi);
    if (!onScreen(P.cx, P.cy, 1000, cam)) return;
    g.save(); g.translate(P.cx, P.cy); g.rotate(P.rot * DEG); g.translate(-PAGE_W / 2, -PAGE_H / 2);
    g.globalAlpha = pa;
    g.fillStyle = 'rgba(0,0,0,0.42)'; g.fillRect(14, 20, PAGE_W, PAGE_H); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(28, 36, PAGE_W, PAGE_H);
    g.fillStyle = C.paper; g.fillRect(0, 0, PAGE_W, PAGE_H);
    const eg = g.createRadialGradient(PAGE_W / 2, PAGE_H / 2, 300, PAGE_W / 2, PAGE_H / 2, 1000);
    eg.addColorStop(0, 'rgba(90,70,40,0)'); eg.addColorStop(1, 'rgba(90,70,40,0.22)'); g.fillStyle = eg; g.fillRect(0, 0, PAGE_W, PAGE_H);
    g.font = `15px ${FONT.mono}`; g.fillStyle = 'rgba(20,16,10,0.55)'; g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.fillText(`${script.title.title.toUpperCase()} · ${script.title.eyebrow.toUpperCase()}`, 44, 986);
    g.textAlign = 'right'; g.fillText(String(pi + 1), PAGE_W - 44, 986); g.textAlign = 'left';
    g.globalAlpha = 1;
    for (const panel of tl.panels.filter((p) => p.page === pi)) drawPanel(panel, cam);
    for (const panel of tl.panels.filter((p) => p.page === pi)) for (const L of letters.get(panel.key) ?? []) drawLetter(L);
    g.restore();
  }

  function spaced(text: string, x: number, y: number, sp: number) {
    const ch = Array.from(text), ws = ch.map((c) => g.measureText(c).width + sp), tw = ws.reduce((a, b) => a + b, 0) - sp;
    let xx = x - tw / 2;
    ch.forEach((c, i) => { g.fillText(c, xx, y); xx += ws[i]; });
  }
  function drawTitle(tt: number) {
    const W = VW, H = VH, bg = clamp((tt - 0.5) / 0.8);
    if (bg <= 0) return;
    g.save(); g.globalAlpha = bg;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#060A13'); gr.addColorStop(0.62, '#121C30'); gr.addColorStop(1, '#05070C');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const r = mulberry(606); let x = -10; g.fillStyle = '#020306';
    while (x < W) { const bw = 20 + r() * 50, bh = H * (0.05 + r() * 0.14); g.fillRect(x, H - bh, bw, bh); x += bw; }
    const r2 = mulberry(607); x = -10; g.fillStyle = 'rgba(240,164,58,0.5)';
    while (x < W) { const bw = 20 + r2() * 50, bh = H * (0.05 + r2() * 0.14); for (let yy = H - bh + 8; yy < H - 6; yy += 11) for (let xx = x + 4; xx < x + bw - 5; xx += 8) if (r2() < 0.1) g.fillRect(xx, yy, 2.5, 3.5); x += bw; }
    if (!REDUCED) {
      const rr = mulberry(8); g.beginPath();
      for (let i = 0; i < 160; i++) { const x0 = rr() * W * 1.3 - W * 0.15, l = 14 + rr() * 24, s = 520 + rr() * 200, y = ((rr() * (H + 200) + A * s) % (H + 200)) - 100; g.moveTo(x0 + y * 0.18, y); g.lineTo(x0 + (y + l) * 0.18, y + l); }
      g.strokeStyle = 'rgba(180,196,222,0.22)'; g.lineWidth = 1.2; g.stroke();
    }
    g.restore();

    const title = script.title.title.toUpperCase(), n = Math.max(6, Array.from(title).length);
    const S = Math.max(34, Math.min(150, W * 0.14, H * 0.2, (W * 0.88) / (n * 0.62))), cx = W / 2, cy = H * 0.42;
    const la = clamp((tt - 1.0) / 0.5);
    if (la > 0) { g.save(); g.globalAlpha = la; g.font = `${Math.max(12, S * 0.15)}px ${FONT.mono}`; g.fillStyle = C.amber; g.textAlign = 'left'; g.textBaseline = 'middle'; spaced(script.title.eyebrow.toUpperCase(), cx, cy - S * 0.8, S * 0.05); g.restore(); }
    g.font = `${S}px ${FONT.sfx}`;
    const glyphs = Array.from(title), ws = glyphs.map((ch) => (ch === ' ' ? S * 0.26 : g.measureText(ch).width + S * 0.03)), total = ws.reduce((a, b) => a + b, 0);
    const rr = mulberry(404); let xx = cx - total / 2, li = 0;
    glyphs.forEach((ch, i) => {
      const rot = (rr() - 0.5) * 7 * DEG;
      if (ch !== ' ') {
        const t0 = 1.25 + li * Math.min(0.085, 1.4 / glyphs.length); li++;
        const p = clamp((tt - t0) / 0.24);
        if (p > 0) {
          const sc = REDUCED ? 1 : lerp(2.3, 1, E.outBack(p));
          g.save(); g.translate(xx + ws[i] / 2, cy); g.rotate(rot); g.scale(sc, sc); g.globalAlpha = clamp(p * 3); g.font = `${S}px ${FONT.sfx}`;
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
          const d = Math.max(1.6, S * 0.032);
          for (let k = 6; k >= 1; k--) { g.fillStyle = k > 3 ? '#2E0906' : '#7A1E14'; g.fillText(ch, k * d * 0.8, k * d); }
          g.strokeStyle = '#05060A'; g.lineWidth = S * 0.07; g.strokeText(ch, 0, 0); g.fillStyle = C.paper; g.fillText(ch, 0, 0);
          g.restore();
        }
      }
      xx += ws[i];
    });
    const sub = Array.from(script.title.subtitle), shown = REDUCED ? sub.length : Math.floor((tt - 2.3) * 28);
    if (shown > 0) {
      g.save(); g.font = `${Math.max(16, Math.min(S * 0.27, W / (sub.length * 0.62)))}px ${FONT.letter}`; g.fillStyle = C.caption; g.textAlign = 'left'; g.textBaseline = 'middle';
      const sp = S * 0.03, wsx = sub.map((c) => g.measureText(c).width + sp), tw = wsx.reduce((a, b) => a + b, 0) - sp;
      let x0 = cx - tw / 2;
      sub.slice(0, shown).forEach((c, i) => { g.fillText(c, x0, cy + S * 0.8); x0 += wsx[i]; });
      g.restore();
    }
  }

  let vign: CanvasGradient | null = null;
  function render() {
    const W = cv.width, H = cv.height;
    const barK = state === 'playing' || state === 'ended' ? clamp((T - 0.1) / 0.9) : 0;
    computeFrame(REDUCED ? (state === 'playing' || state === 'ended' ? 1 : 0) : barK);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = C.void; g.fillRect(0, 0, W, H);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const bgG = g.createRadialGradient(VW / 2, VH * 0.45, 0, VW / 2, VH * 0.45, Math.max(VW, VH) * 0.7);
    bgG.addColorStop(0, '#111827'); bgG.addColorStop(1, C.void); g.fillStyle = bgG; g.fillRect(0, 0, VW, VH);
    if (state === 'loading') return;
    const playing = state === 'playing' || state === 'ended';
    const inTitle = playing && T >= tl.titleStart, tt = T - tl.titleStart;
    // Before play, the start card shows the first sheet slowly turning under it.
    const cam = playing ? camAt(T) : rectCam(0, PAGE_RECT, true, 1.04);
    if (!playing) cam.rot = (-2.2 + Math.sin(A * 0.25) * 0.5) * DEG;
    if (!inTitle || tt < 1.3) {
      let sx = 0, sy = 0;
      if (!REDUCED && playing) [sx, sy] = shakeAt(tl, T);
      g.save(); g.translate(FRAME.x + FRAME.w / 2 + sx, FRAME.y + FRAME.h / 2 + sy); g.scale(Math.exp(cam.lz), Math.exp(cam.lz)); g.rotate(-cam.rot); g.translate(-cam.x, -cam.y);
      if (playing) for (let pi = 0; pi < script.pages.length; pi++) drawPage(pi, cam);
      else { T = 0; drawPage(0, cam); }
      g.restore();
      if (inTitle) { g.fillStyle = `rgba(3,4,7,${clamp((tt - 0.1) / 1.0)})`; g.fillRect(0, 0, VW, VH); }
    }
    if (inTitle) { g.save(); drawTitle(tt); g.restore(); }
    if (FRAME.portrait && !inTitle) { g.fillStyle = 'rgba(7,9,13,0.9)'; g.fillRect(0, 0, VW, FRAME.y); g.fillRect(0, FRAME.y + FRAME.h, VW, VH - FRAME.y - FRAME.h); }
    if (!vign) { vign = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.32, VW / 2, VH / 2, Math.max(VW, VH) * 0.78); vign.addColorStop(0, 'rgba(0,0,0,0)'); vign.addColorStop(1, 'rgba(0,0,0,0.5)'); }
    g.fillStyle = vign; g.fillRect(0, 0, VW, VH);
    if (FRAME.bar > 0) { g.fillStyle = '#000'; g.fillRect(0, 0, VW, FRAME.bar); g.fillRect(0, VH - FRAME.bar, VW, FRAME.bar); }
  }

  // ---------------------------------------------------------------- audio events
  function processEvents() {
    while (evIdx < tl.events.length && tl.events[evIdx].t <= T) {
      const e = tl.events[evIdx++];
      if (T - e.t > 0.3 || REDUCED && !['musicIn', 'thump', 'click', 'shatter', 'ring'].includes(e.name)) continue;
      comicAudio.play(e.name, e.shot);
    }
  }

  // ---------------------------------------------------------------- control
  function seekTo(t: number) {
    T = t; evIdx = 0;
    while (evIdx < tl.events.length && tl.events[evIdx].t < t - 0.0001) evIdx++;
    curShot = -1;
  }
  function finishNow(reason: 'finished' | 'skipped' | 'closed') {
    if (disposed) return;
    opts.onDone(reason);
  }
  function startPlay(withSound: boolean) {
    if (state !== 'ready') return;
    if (!withSound) settings.set({ muted: true });
    syncMute();
    if (!settings.get().muted) comicAudio.init();
    comicAudio.applyLevels();
    beginTimeline();
  }
  function beginTimeline() {
    setState('playing'); T = REDUCED ? tl.steps[0] ?? 0 : 0; stepIdx = 0; evIdx = 0; curShot = -1; playStartA = A;
    seekTo(T);
    ui.start.hidden = true; ui.end.hidden = true; ui.scrim.setAttribute('data-off', ''); ui.hud.hidden = false;
    ui.hint.hidden = false; ui.hint.removeAttribute('data-fade');
    ui.hint.textContent = REDUCED
      ? tr('Click or press Space for the next panel · Hold Esc to skip', 'Nhấp hoặc nhấn Space để sang khung kế · Giữ Esc để bỏ qua')
      : tr('Click or press Space to skip ahead · Hold Esc to skip', 'Nhấp hoặc nhấn Space để tua tới · Giữ Esc để bỏ qua');
    cv.focus({ preventScroll: true });
  }
  function advance() {
    if (state === 'ended') return;
    if (state !== 'playing') return;
    if (REDUCED) {
      stepIdx++;
      if (stepIdx >= tl.steps.length) { endTimeline(); return; }
      seekTo(tl.steps[stepIdx]); return;
    }
    const sh = tl.shots[shotAt(tl, T)];
    if (T >= tl.titleStart) { T = tl.end; return; }
    let next = sh.t0 + sh.dur;
    for (const b of tl.beats) if (b.shot === sh.idx) { if (T < b.start - 0.001) next = Math.min(next, b.start); else if (T < b.typeEnd) next = Math.min(next, b.typeEnd); }
    const panel = sh.panelKey ? panelByKey.get(sh.panelKey) : undefined;
    if (panel && T < panel.revealT - 0.001) next = Math.min(next, panel.revealT);
    T = next + 0.0005;
  }
  function skipAll() {
    if (state !== 'playing' || T >= tl.titleStart) return;
    comicAudio.stopScopedBefore(Infinity);
    seekTo(REDUCED ? tl.steps[tl.steps.length - 1] : tl.titleStart);
    if (REDUCED) stepIdx = tl.steps.length - 1;
  }
  function endTimeline() {
    setState('ended'); T = Math.max(T, tl.titleStart + (REDUCED ? TIMING.title : 0));
    ui.end.hidden = false; ui.hint.hidden = true; ui.finish.focus({ preventScroll: true });
  }
  function replay() {
    if (state !== 'ended') return;
    comicAudio.stopScopedBefore(Infinity); lastLive = '';
    beginTimeline();
  }

  ui.play.addEventListener('click', () => startPlay(true));
  ui.playMuted.addEventListener('click', () => startPlay(false));
  ui.finish.addEventListener('click', () => finishNow(skippedEarly ? 'skipped' : 'finished'));
  ui.replay.addEventListener('click', replay);
  ui.mute.addEventListener('click', () => { comicAudio.init(); setMuted(!settings.get().muted); });
  cv.addEventListener('click', advance);
  let skippedEarly = false;
  const holdBegin = () => { if (state === 'playing' && T < tl.titleStart && !holdStart) holdStart = performance.now(); };
  const holdEnd = () => { holdStart = 0; ui.ring.style.strokeDashoffset = '44'; };
  ui.skip.addEventListener('pointerdown', (e) => { e.preventDefault(); holdBegin(); });
  for (const n of ['pointerup', 'pointerleave', 'pointercancel']) ui.skip.addEventListener(n, holdEnd);
  ui.skip.addEventListener('click', (e) => e.preventDefault());
  ui.skip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) holdBegin(); } });
  ui.skip.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') holdEnd(); });

  const onKeyDown = (e: KeyboardEvent) => {
    if (disposed) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (state === 'ended') { finishNow('closed'); return; }
      if (state === 'ready') { finishNow('skipped'); return; }
      if (!e.repeat) holdBegin();
      return;
    }
    const onBtn = e.target instanceof HTMLButtonElement;
    if (!onBtn && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); advance(); return; }
    if (e.key === 'm' || e.key === 'M') { comicAudio.init(); setMuted(!settings.get().muted); return; }
    if (e.key === 'Tab') {
      const buttons = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), canvas[tabindex]')].filter((b) => !b.closest('[hidden]'));
      if (!buttons.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Escape') holdEnd(); };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  const onVisibility = () => { if (document.hidden) comicAudio.suspend(); else if (state === 'playing') comicAudio.resume(); };
  document.addEventListener('visibilitychange', onVisibility);

  function updateDOM() {
    const playing = state === 'playing' || state === 'ended';
    ui.rotate.hidden = !(VW / VH < 1.05 && VW < 760 && state !== 'loading');
    if (!playing) { ui.sub.hidden = true; return; }
    const i = shotAt(tl, T), sh = tl.shots[i], inTitle = T >= tl.titleStart;
    const pg = inTitle ? -1 : sh.page;
    if (pg !== lastPage) { lastPage = pg; ui.page.textContent = pg < 0 ? '' : tr(`Page ${pg + 1} / ${script.pages.length}`, `Trang ${pg + 1} / ${script.pages.length}`); }
    if (A - playStartA > 7 && !ui.hint.hasAttribute('data-fade')) ui.hint.setAttribute('data-fade', '');
    let current: BeatPlan | null = null;
    if (!inTitle) for (const b of tl.beats) if (b.shot === sh.idx && b.type !== 'sfx' && T >= b.start) current = b;
    const key = current ? `${current.panelKey}:${current.start}` : '';
    if (key !== lastLive) { lastLive = key; if (current) ui.live.textContent = current.text; }
    if (FRAME.portrait && current) {
      const full = Array.from(current.text), n = REDUCED ? full.length : Math.max(0, Math.floor((T - current.start - 0.1) * TIMING.cps));
      ui.subText.textContent = full.slice(0, Math.min(n, full.length)).join('');
      ui.sub.classList.toggle('mc-speech', current.type === 'speech');
      ui.subWho.textContent = current.type === 'speech' ? (assets.characters[current.speakerId]?.title ?? '') : '';
      ui.sub.style.top = `${Math.round(FRAME.y + FRAME.h + 18)}px`; ui.sub.hidden = false;
    } else ui.sub.hidden = true;
  }

  // ---------------------------------------------------------------- main loop
  let last = performance.now(), slowFrames = 0, frames = 0;
  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now; A += dt;
    if (state === 'playing' && !REDUCED) T += dt;
    if (state === 'playing' || state === 'ended') {
      if (state === 'playing') processEvents();
      const i = shotAt(tl, T);
      if (i !== curShot) {
        curShot = i; comicAudio.stopScopedBefore(i);
        if (state === 'playing') comicAudio.setRain(tl.shots[i].weather === 'rain' || tl.shots[i].kind === 'title' && script.mood.includes('rain'));
      }
      if (state === 'playing' && !REDUCED && T >= tl.end) endTimeline();
      if (state === 'playing' && REDUCED && T >= tl.titleStart) endTimeline();
    }
    comicAudio.applyLevels();
    if (holdStart) {
      const p = (now - holdStart) / 750;
      ui.ring.style.strokeDashoffset = String(44 * (1 - clamp(p)));
      if (p >= 1) { holdEnd(); skippedEarly = true; skipAll(); if (REDUCED) endTimeline(); }
    }
    render(); updateDOM();
    frames++; if (dt > 0.034) slowFrames++;
    if (frames === 90) { if (slowFrames > 45 && dprCap > 1) { dprCap = 1; resize(); vign = null; } frames = 0; slowFrames = 0; }
    rafId = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- start
  ui.loading.hidden = true;
  syncMute();
  const approx = Math.round(tl.end / 5) * 5;
  ui.meta.textContent = tr(`About ${approx} seconds · Headphones recommended`, `Khoảng ${approx} giây · Nên đeo tai nghe`);
  setState('ready');
  rafId = requestAnimationFrame(frame);

  // Try to start straight away. If the browser blocks sound (no user gesture yet) fall back to the start card.
  const muted = settings.get().muted;
  if (muted) { ui.start.hidden = true; beginTimeline(); }
  else {
    const ok = comicAudio.init();
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (ok && comicAudio.running) beginTimeline();
    else { ui.start.hidden = false; ui.play.focus({ preventScroll: true }); }
  }

  const handle: MotionComicHandle = {
    get state() { return state; },
    get time() { return T; },
    get timeline() { return tl; },
    seek(t: number) { if (state === 'ready') startPlay(false); if (state !== 'playing' && state !== 'ended') return; setState('playing'); seekTo(t); if (REDUCED) stepIdx = Math.max(0, tl.steps.findIndex((s) => s >= t)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedQuery.removeEventListener?.('change', onReducedChange);
      comicAudio.dispose();
      root.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    },
  };
  (window as unknown as { __motionComic?: MotionComicHandle }).__motionComic = handle;
  return handle;
}
