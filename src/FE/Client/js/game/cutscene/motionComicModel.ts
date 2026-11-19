/**
 * Pure data model of the motion-comic intro: script types, page layouts and the timeline.
 * Nothing here touches the DOM, so the timing can be unit-tested and kept in step with the server's
 * duration estimate (`MotionComicRules.EstimateSeconds` in the API).
 */

export type ComicBeat = { type: 'caption' | 'speech' | 'sfx'; speakerId?: string; text: string; style?: string };
export type ComicArt = { kind: 'scene' | 'character' | 'item' | 'cover'; id: string; focus: number[] };
export type ComicPanelScript = { art: ComicArt; weather: string; enter: string; beats: ComicBeat[]; audio: string[] };
export type ComicPageScript = { layout: string; panels: ComicPanelScript[] };
export type MotionComicScript = {
  format: 'motion-comic-v1';
  caseId: string;
  language: string;
  title: { eyebrow: string; title: string; subtitle: string };
  mood: string;
  pages: ComicPageScript[];
};
export type ComicAssetRef = { title: string; url: string };
export type ComicAssets = {
  scenes: Record<string, ComicAssetRef>;
  characters: Record<string, ComicAssetRef>;
  items: Record<string, ComicAssetRef>;
  coverUrl: string;
};
/** What `GET /api/cases/{id}/intro-cutscene` returns. */
export type PlayableCutscene = { caseId: string; trigger: string; version: number; script: MotionComicScript; assets: ComicAssets };

// Same constants as the server's MotionComicRules, so the estimate there matches playback here.
export const TIMING = { title: 4.5, panel: 0.9, flip: 1.1, sfx: 1.2, lineBase: 1.7, linePerChar: 0.05, cps: 40, reveal: 0.35 } as const;

export type Rect = [number, number, number, number];
export type Point = [number, number];
export const PAGE_W = 1600;
export const PAGE_H = 1000;

/** Panel polygons per layout, on a 1600x1000 sheet. Slightly slanted gutters, like the reference comic. */
export const LAYOUTS: Record<string, Point[][]> = {
  'wide-top-two-bottom': [
    [[40, 40], [1560, 40], [1560, 520], [40, 580]],
    [[40, 604], [1000, 566], [940, 960], [40, 960]],
    [[1024, 565], [1560, 544], [1560, 960], [964, 960]],
  ],
  'tall-left-two-right': [
    [[40, 40], [700, 40], [640, 960], [40, 960]],
    [[724, 40], [1560, 40], [1560, 470], [694, 500]],
    [[692, 524], [1560, 494], [1560, 960], [664, 960]],
  ],
  'three-strips': [
    [[40, 40], [1560, 40], [1560, 330], [40, 352]],
    [[40, 376], [1560, 354], [1560, 640], [40, 662]],
    [[40, 686], [1560, 664], [1560, 960], [40, 960]],
  ],
  splash: [
    [[40, 40], [1560, 40], [1560, 960], [40, 960]],
  ],
  'splash-inset': [
    [[40, 40], [1560, 40], [1560, 960], [40, 960]],
    [[900, 560], [1520, 536], [1520, 928], [880, 940]],
  ],
};

/** Where each page sits in the world. The camera flies between them. */
export const PAGE_PLACEMENT = [
  { cx: 800, cy: 500, rot: -1.2 },
  { cx: 2700, cy: 540, rot: 0.9 },
  { cx: 4600, cy: 470, rot: -0.7 },
] as const;

export type BeatPlan = {
  type: ComicBeat['type'];
  text: string;
  speakerId: string;
  style: string;
  panelKey: string;
  shot: number;
  start: number;
  typeEnd: number;
  end: number;
};
export type PanelPlan = {
  key: string;
  page: number;
  index: number;
  poly: Point[];
  bb: { x: number; y: number; w: number; h: number };
  art: ComicArt;
  weather: string;
  enter: [number, number];
  revealT: number;
  shot: number;
  beats: BeatPlan[];
};
export type Shot = {
  idx: number;
  kind: 'page' | 'panel' | 'title';
  page: number;
  panelKey?: string;
  t0: number;
  dur: number;
  trans: number;
  move: number;
  from: Rect;
  to: Rect;
  weather: string;
};
export type TimedEvent = { t: number; name: string; shot: number };
export type Timeline = {
  shots: Shot[];
  panels: PanelPlan[];
  beats: BeatPlan[];
  events: TimedEvent[];
  flashes: { t: number; k: number; page: number }[];
  shakes: { t: number; a: number }[];
  steps: number[];
  end: number;
  titleStart: number;
};

const ENTER: Record<string, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0], none: [0, 0] };
const SFX_EVENT: Record<string, string> = { impact: 'thump', soft: 'click', glass: 'shatter', phone: 'ring', thunder: 'thunder' };
const AUDIO_EVENT: Record<string, string> = { thump: 'thump', ring: 'ring', siren: 'siren', shatter: 'shatter', thunder: 'thunder', ticking: 'ticking' };

export const chars = (text: string) => Array.from(text ?? '').length;
export const lineSeconds = (text: string) => TIMING.lineBase + TIMING.linePerChar * chars(text);

/** Mirrors `MotionComicRules.EstimateSeconds`. */
export function estimateSeconds(script: MotionComicScript): number {
  let total: number = TIMING.title;
  for (const page of script.pages) {
    total += TIMING.flip;
    for (const panel of page.panels) {
      total += TIMING.panel;
      for (const beat of panel.beats) total += beat.type === 'sfx' ? TIMING.sfx : lineSeconds(beat.text);
    }
  }
  return Math.round(total * 10) / 10;
}

function bounds(poly: Point[]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Grows a rectangle around its centre and keeps it on the sheet. */
function grow(r: Rect, factor: number): Rect {
  const w = Math.min(PAGE_W + 100, r[2] * factor), h = Math.min(PAGE_H + 100, r[3] * factor);
  return [Math.max(-50, Math.min(PAGE_W + 50 - w, r[0] + r[2] / 2 - w / 2)), Math.max(-50, Math.min(PAGE_H + 50 - h, r[1] + r[3] / 2 - h / 2)), w, h];
}

export const PAGE_RECT: Rect = [-50, -50, PAGE_W + 100, PAGE_H + 100];

export function buildTimeline(script: MotionComicScript): Timeline {
  const tl: Timeline = { shots: [], panels: [], beats: [], events: [], flashes: [], shakes: [], steps: [], end: 0, titleStart: 0 };
  let t = 0;
  const addEvent = (at: number, name: string, shot: number) => {
    // Never queue the same sound twice within a moment (a cue and a matching sfx beat).
    if (tl.events.some((e) => e.name === name && Math.abs(e.t - at) < 0.45)) return;
    tl.events.push({ t: at, name, shot });
  };
  const addFlash = (at: number, k: number, page: number) => {
    // At most ~2 flashes a second, always one smooth pulse: safe for photosensitive viewers.
    if (tl.flashes.some((f) => Math.abs(f.t - at) < 0.6)) return;
    tl.flashes.push({ t: at, k, page });
  };

  script.pages.forEach((page, pi) => {
    const polys = LAYOUTS[page.layout] ?? LAYOUTS.splash;
    // Overview shot: the sheet slides into view.
    tl.shots.push({ idx: tl.shots.length, kind: 'page', page: pi, t0: t, dur: TIMING.flip, trans: TIMING.flip, move: 0, from: PAGE_RECT, to: PAGE_RECT, weather: 'none' });
    addEvent(t + 0.05, pi === 0 ? 'musicIn' : 'whooshSoft', tl.shots.length - 1);
    t += TIMING.flip;

    page.panels.forEach((panel, qi) => {
      const poly = polys[Math.min(qi, polys.length - 1)];
      const bb = bounds(poly);
      const shotIdx = tl.shots.length;
      const key = `p${pi}-${qi}`;
      const plan: PanelPlan = {
        key, page: pi, index: qi, poly, bb, art: panel.art, weather: panel.weather, enter: ENTER[panel.enter] ?? [0, 0],
        revealT: t + TIMING.reveal, shot: shotIdx, beats: [],
      };
      let cursor = TIMING.panel;
      for (const beat of panel.beats) {
        const text = beat.text ?? '';
        const n = chars(text);
        const dur = beat.type === 'sfx' ? TIMING.sfx : lineSeconds(text);
        const typeDur = beat.type === 'sfx' ? 0.32 : Math.min(dur - 0.3, 0.1 + n / TIMING.cps);
        const b: BeatPlan = {
          type: beat.type, text, speakerId: beat.speakerId ?? '', style: beat.style ?? '', panelKey: key, shot: shotIdx,
          start: t + cursor, typeEnd: t + cursor + typeDur, end: t + cursor + dur,
        };
        plan.beats.push(b); tl.beats.push(b);
        if (beat.type === 'sfx') {
          const name = SFX_EVENT[beat.style ?? ''];
          if (name) addEvent(b.start, name, shotIdx);
          if (beat.style === 'impact' || beat.style === 'glass') tl.shakes.push({ t: b.start, a: 7 });
          if (beat.style === 'thunder') { addFlash(b.start, 0.6, pi); tl.shakes.push({ t: b.start, a: 8 }); }
        }
        cursor += dur;
      }
      const dur = cursor;
      const tight: Rect = [bb.x - 24, bb.y - 24, bb.w + 48, bb.h + 48];
      tl.shots.push({
        idx: shotIdx, kind: 'panel', page: pi, panelKey: key, t0: t, dur, trans: TIMING.panel, move: Math.max(0.5, dur - TIMING.panel),
        from: grow(tight, 1.35), to: tight, weather: panel.weather,
      });
      addEvent(t, 'whoosh', shotIdx);
      addEvent(plan.revealT, 'thump', shotIdx);
      tl.shakes.push({ t: plan.revealT, a: 3 });
      panel.audio.forEach((cue, ci) => {
        const name = AUDIO_EVENT[cue];
        if (!name) return;
        const at = plan.revealT + 0.2 + ci * 0.7;
        addEvent(at, name, shotIdx);
        if (name === 'thunder') { addFlash(at, 0.6, pi); tl.shakes.push({ t: at, a: 8 }); }
        if (name === 'shatter') tl.shakes.push({ t: at, a: 8 });
      });
      tl.panels.push(plan);
      t += dur;
    });
  });

  tl.titleStart = t;
  const titleShot = tl.shots.length;
  tl.shots.push({ idx: titleShot, kind: 'title', page: Math.max(0, script.pages.length - 1), t0: t, dur: TIMING.title, trans: 1.2, move: 0, from: PAGE_RECT, to: PAGE_RECT, weather: 'none' });
  addEvent(t, 'whooshLong', titleShot);
  addEvent(t + 2.2, 'titleHit', titleShot);
  tl.shakes.push({ t: t + 2.2, a: 6 });
  t += TIMING.title;
  tl.end = t;
  tl.events.sort((a, b) => a.t - b.t);

  // Reduced motion plays by hand: one step per beat, then the title card.
  for (const b of tl.beats) tl.steps.push(b.start + 0.01);
  tl.steps.push(tl.titleStart + TIMING.title - 0.05);
  tl.steps.sort((a, b) => a - b);
  return tl;
}

export function shotAt(tl: Timeline, T: number): number {
  let i = 0;
  while (i + 1 < tl.shots.length && T >= tl.shots[i + 1].t0) i++;
  return i;
}

/** One smooth pulse (no strobing); `k` caps the brightness. */
export function flashAt(tl: Timeline, page: number, T: number): number {
  let f = 0;
  for (const fl of tl.flashes) {
    if (fl.page !== page) continue;
    const x = T - fl.t;
    if (x < 0 || x > 1.6) continue;
    f = Math.max(f, (x < 0.08 ? x / 0.08 : Math.exp(-(x - 0.08) * 3.2)) * fl.k);
  }
  return f;
}

export function shakeAt(tl: Timeline, T: number): [number, number] {
  let x = 0, y = 0;
  for (const s of tl.shakes) {
    const d = T - s.t;
    if (d < 0 || d > 0.8) continue;
    const k = s.a * Math.exp(-d * 7);
    x += Math.sin(T * 91 + s.t) * k; y += Math.cos(T * 77 + s.t * 3) * k;
  }
  return [x, y];
}

/** The most flashes the timeline ever shows in any one second. Used by tests to guard the "3 per second" rule. */
export function maxFlashesPerSecond(tl: Timeline): number {
  let max = 0;
  for (const f of tl.flashes) max = Math.max(max, tl.flashes.filter((g) => g.t >= f.t && g.t < f.t + 1).length);
  return max;
}
