/**
 * P1 · Nạy khóa ổ bi — ported from design/project/PuzzleLockpick.dc.html.
 * Tension on, slide the pick under a pin and lift it. Only the binding pin catches at the shear line
 * ("cạch"); lifting a set pin too far jams it; releasing tension drops every pin. Which pin binds next is
 * the server's secret: the module asks with ctx.probe({ set, pin }) → { binds } (cached per pin/prefix)
 * and submits { order } once every pin is set.
 */
import './lockpick.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

const YS = 192; // shear line
const YCT = 92; // top of the chambers (springs start here)
const LD = 56; // driver pin length
const STEP = 4; // keyboard lift step
const GAIN = 0.5; // lock units per screen pixel while dragging

type Phase = 'pick' | 'turn' | 'open';
interface Pin { n: number; x: number; need: number }

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);
const WORDS = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu'];

function pinsFrom(params: any): Pin[] {
  const fallback = [20, 30, 14, 26, 34];
  const count = Math.max(3, Math.min(6, Math.round(num(params?.pinCount, Array.isArray(params?.needs) ? params.needs.length : 5))));
  const needs: number[] = Array.from({ length: count }, (_, i) => {
    const need = Array.isArray(params?.needs) ? Number(params.needs[i]) : NaN;
    return Number.isFinite(need) ? Math.max(8, Math.min(40, need)) : fallback[i % fallback.length];
  });
  // Chambers spread evenly over the mockup's span (5 pins → x = 140, 232, 324, 416, 508).
  return needs.map((need, i) => ({ n: i + 1, x: r1(140 + (i * 368) / (count - 1)), need }));
}

function springPaths(pin: Pin) {
  const x0 = pin.x - 8.5;
  const x1 = pin.x + 8.5;
  const y0 = 93.5;
  const y1 = YS + pin.need - LD - 1.5;
  const step = (y1 - y0) / 14;
  const y = (k: number) => r1(y0 + step * k);
  let back = '';
  for (let k = 1; k <= 7; k++) back += `M${x1} ${y(2 * k - 1)} L${x0} ${y(2 * k)} `;
  let front = `M${x0} ${y0} H${x1} `;
  for (let k = 0; k <= 6; k++) front += `M${x0} ${y(2 * k)} L${x1} ${y(2 * k + 1)} `;
  front += `M${x0} ${r1(y1)} H${x1}`;
  return { back: back.trim(), front };
}

function keyPinPath(pin: Pin) {
  const x = pin.x;
  const t = YS + pin.need;
  return `M${r1(x - 10)} ${r1(t + 2.5)} Q${r1(x - 10)} ${t} ${r1(x - 7.5)} ${t} H${r1(x + 7.5)} Q${r1(x + 10)} ${t} ${r1(x + 10)} ${r1(t + 2.5)} V264 Q${r1(x + 10)} 270.5 ${r1(x + 4.5)} 274.4 Q${x} 276.6 ${r1(x - 4.5)} 274.4 Q${r1(x - 10)} 270.5 ${r1(x - 10)} 264 Z`;
}

function lockSvg(pins: Pin[], tr: PuzzleContext['tr']) {
  const bores = pins.map((p) => `<rect x="${r1(p.x - 14)}" y="92" width="28" height="100" fill="url(#lp-g-bore)"></rect>
    <rect x="${r1(p.x - 12)}" y="80" width="24" height="12" rx="1.5" fill="#8f6f2c" stroke="#4a3810" stroke-width=".8"></rect><path d="M${r1(p.x - 6)} 86 H${r1(p.x + 6)}" stroke="#3a2c10" stroke-width="1.4"></path>`).join('');
  const plugBores = pins.map((p) => `<rect x="${r1(p.x - 14)}" y="192" width="28" height="46" fill="url(#lp-g-bore)"></rect>`).join('');
  const keyPins = pins.map((p) => {
    const t = YS + p.need;
    return `<g class="lp-kp" data-lp-kp="${p.n}"><g class="lp-trem">
      <path class="lp-kshape" d="${keyPinPath(p)}" fill="url(#lp-g-key)"></path>
      <path d="M${r1(p.x - 4)} ${t + 4} V263" stroke="rgba(255,255,255,.55)" stroke-width="1.4" stroke-linecap="round"></path><path d="M${r1(p.x - 7)} ${r1(t + 1.2)} H${r1(p.x + 7)}" stroke="rgba(255,255,255,.35)"></path>
    </g></g>`;
  }).join('');
  const columns = pins.map((p) => {
    const t = YS + p.need;
    const spring = springPaths(p);
    return `<g class="lp-col" data-lp-col="${p.n}">
      <g class="lp-spr" data-lp-spr="${p.n}">
        <path d="${spring.back}" fill="none" stroke="#5d676d" stroke-width="1.7" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
        <path d="${spring.front}" fill="none" stroke="#1d2226" stroke-width="3.4" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
        <path d="${spring.front}" fill="none" stroke="#dfe5e8" stroke-width="1.8" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
      </g>
      <g class="lp-drv" data-lp-drv="${p.n}"><g class="lp-trem">
        <rect x="${r1(p.x - 10)}" y="${t - LD}" width="20" height="56" rx="2.6" fill="url(#lp-g-drv)" stroke="rgba(52,36,8,.75)" stroke-width=".8"></rect>
        <path d="M${r1(p.x - 4)} ${t - 52} V${t - 4}" stroke="rgba(255,250,225,.75)" stroke-width="1.4" stroke-linecap="round"></path><path d="M${r1(p.x - 8)} ${r1(t - 52.5)} H${r1(p.x + 8)} M${r1(p.x - 8)} ${r1(t - 3.5)} H${r1(p.x + 8)}" stroke="rgba(52,36,8,.45)"></path>
      </g></g>
    </g>`;
  }).join('');
  const labels = pins.map((p) => `<text class="lp-lbl" data-lp-lbl="${p.n}" x="${p.x}" y="38">${pins.length > 5 ? p.n : `${tr('PIN', 'CHỐT')} ${p.n}`}</text>
    <rect class="lp-ul" data-lp-ul="${p.n}" x="${r1(p.x - 20)}" y="45" width="40" height="2.4" rx="1"></rect>`).join('');
  const last = pins[pins.length - 1].x;
  return `
  <svg class="lp-x" viewBox="0 0 800 400" aria-hidden="true">
    <defs>
      <linearGradient id="lp-g-hous" gradientUnits="userSpaceOnUse" x1="0" y1="62" x2="0" y2="342"><stop offset="0" stop-color="#e8c878"></stop><stop offset=".5" stop-color="#c79f4a"></stop><stop offset="1" stop-color="#8f6d2c"></stop></linearGradient>
      <linearGradient id="lp-g-plug" gradientUnits="userSpaceOnUse" x1="0" y1="192" x2="0" y2="322"><stop offset="0" stop-color="#dcb965"></stop><stop offset=".45" stop-color="#be9441"></stop><stop offset="1" stop-color="#86652a"></stop></linearGradient>
      <linearGradient id="lp-g-face" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a2a"></stop><stop offset=".45" stop-color="#e3c374"></stop><stop offset="1" stop-color="#6e5420"></stop></linearGradient>
      <pattern id="lp-p-ha" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="1.05" fill="rgba(74,50,12,.30)"></rect></pattern>
      <pattern id="lp-p-hb" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="1.05" fill="rgba(74,50,12,.28)"></rect></pattern>
      <linearGradient id="lp-g-bore" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a0705"></stop><stop offset=".5" stop-color="#2b2114"></stop><stop offset="1" stop-color="#0a0705"></stop></linearGradient>
      <linearGradient id="lp-g-way" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070504"></stop><stop offset=".5" stop-color="#17110b"></stop><stop offset="1" stop-color="#2c2117"></stop></linearGradient>
      <linearGradient id="lp-g-key" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4b545a"></stop><stop offset=".3" stop-color="#eef3f5"></stop><stop offset=".58" stop-color="#a0aab0"></stop><stop offset="1" stop-color="#363d42"></stop></linearGradient>
      <linearGradient id="lp-g-drv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#674e1e"></stop><stop offset=".3" stop-color="#fbe9ae"></stop><stop offset=".58" stop-color="#cfa752"></stop><stop offset="1" stop-color="#57431a"></stop></linearGradient>
      <linearGradient id="lp-g-shaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7f8"></stop><stop offset=".45" stop-color="#9ea8ae"></stop><stop offset="1" stop-color="#3b4348"></stop></linearGradient>
      <linearGradient id="lp-g-grip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d3826"></stop><stop offset=".5" stop-color="#2b1e14"></stop><stop offset="1" stop-color="#120c08"></stop></linearGradient>
      <linearGradient id="lp-g-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3dc95"></stop><stop offset=".5" stop-color="#c7a24b"></stop><stop offset="1" stop-color="#6e5620"></stop></linearGradient>
      <radialGradient id="lp-g-flash" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6d6" stop-opacity="1"></stop><stop offset=".35" stop-color="#f3d27a" stop-opacity=".85"></stop><stop offset="1" stop-color="#f3d27a" stop-opacity="0"></stop></radialGradient>
      <radialGradient id="lp-g-red" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd2c4" stop-opacity="1"></stop><stop offset=".35" stop-color="#e0563e" stop-opacity=".85"></stop><stop offset="1" stop-color="#e0563e" stop-opacity="0"></stop></radialGradient>
      <filter id="lp-f-soft" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="6"></feGaussianBlur></filter>
    </defs>
    <g class="lp-callout">
      <path d="M646 100 H600 L${last + 16} 118" class="lp-lead"></path><circle cx="${last + 16}" cy="118" r="2.2" class="lp-dot"></circle><text x="652" y="104" class="lp-cap">${tr('SPRING', 'LÒ XO')}</text>
      <path d="M646 152 H602 L${last + 14} 170" class="lp-lead"></path><circle cx="${last + 14}" cy="170" r="2.2" class="lp-dot"></circle><text x="652" y="156" class="lp-cap">${tr('DRIVER · BRASS', 'CHỐT TRÊN · ĐỒNG')}</text>
      <path d="M646 226 H604 L${last + 14} 244" class="lp-lead"></path><circle cx="${last + 14}" cy="244" r="2.2" class="lp-dot"></circle><text x="652" y="230" class="lp-cap">${tr('KEY PIN · STEEL', 'CHỐT DƯỚI · THÉP')}</text>
      <path d="M96 372 V362 L104 330" class="lp-lead"></path><circle cx="104" cy="330" r="2.2" class="lp-dot"></circle><text x="92" y="388" class="lp-cap">${tr('HOUSING', 'THÂN KHÓA')}</text>
      <path d="M226 372 V362 L218 316" class="lp-lead"></path><circle cx="218" cy="316" r="2.2" class="lp-dot"></circle><text x="214" y="388" class="lp-cap">${tr('PLUG', 'LÕI KHÓA')}</text>
      <path d="M560 372 V362 L586 304" class="lp-lead"></path><circle cx="586" cy="304" r="2.2" class="lp-dot"></circle><text x="470" y="388" class="lp-cap">${tr('TENSION WRENCH', 'THANH VẶN')}</text>
      <path d="M700 372 V362 L690 300" class="lp-lead"></path><circle cx="690" cy="300" r="2.2" class="lp-dot"></circle><text x="664" y="388" class="lp-cap">${tr('PICK', 'CÂY NẠY')}</text>
    </g>
    <g class="lp-lbls">${labels}<g class="lp-mk" data-lp-mk><path d="M-6.5 51 H6.5 L0 59 Z"></path></g></g>
    <g class="lp-body">
      <rect x="66" y="78" width="540" height="276" rx="12" fill="#000" opacity=".5" filter="url(#lp-f-soft)"></rect>
      <path d="M58 74 Q58 62 70 62 H586 Q598 62 598 74 V342 H58 Z" fill="url(#lp-g-hous)"></path>
      <path d="M58 74 Q58 62 70 62 H586 Q598 62 598 74 V342 H58 Z" fill="url(#lp-p-ha)"></path>
      <path d="M70 62.9 H586" stroke="rgba(255,244,210,.7)" stroke-width="1.3"></path><path d="M58.6 76 V340" stroke="rgba(255,244,210,.35)"></path>
      ${bores}
      <g class="lp-plug" data-lp-plug>
        <path d="M70 192 H606 V322 H70 Z" fill="url(#lp-g-plug)"></path><path d="M70 192 H606 V322 H70 Z" fill="url(#lp-p-hb)"></path>
        <path d="M70 192.7 H606" stroke="rgba(255,244,210,.55)" stroke-width="1.1"></path>
        <rect x="70" y="238" width="552" height="68" fill="url(#lp-g-way)"></rect><path d="M70 238.6 H622" stroke="rgba(0,0,0,.8)" stroke-width="1.2"></path><path d="M70 305.5 H622" stroke="rgba(255,236,190,.22)"></path>
        <g class="lp-roll">${plugBores}${keyPins}</g>
        <g class="lp-turned"><path d="M70 202 H606 M70 214 H606 M70 226 H606 M70 314 H606" stroke="rgba(255,244,210,.28)"></path><path d="M70 208 H606 M70 220 H606" stroke="rgba(60,40,10,.35)"></path></g>
      </g>
      <path d="M58 186 H74 V342 H58 Z" fill="url(#lp-g-hous)"></path><path d="M58 186 H74 V342 H58 Z" fill="url(#lp-p-ha)"></path>
      <path d="M58 322 H598 V342 H58 Z" fill="url(#lp-g-hous)"></path><path d="M58 322 H598 V342 H58 Z" fill="url(#lp-p-ha)"></path><path d="M74 322.5 H598" stroke="rgba(60,40,10,.55)"></path>
      <path d="M588 176 H608 Q618 176 618 186 V238 H588 Z" fill="url(#lp-g-face)" stroke="#4a3810" stroke-width=".8"></path>
      <path d="M588 306 H618 V336 Q618 346 608 346 H588 Z" fill="url(#lp-g-face)" stroke="#4a3810" stroke-width=".8"></path>
      <path d="M58 342.5 H598" stroke="rgba(0,0,0,.6)" stroke-width="1.4"></path>
      ${columns}
      <path class="lp-shear" d="M50 192 H644"></path>
      <text class="lp-cap lp-cap-shear" x="652" y="196">${tr('SHEAR LINE', 'ĐƯỜNG CẮT')}</text>
      <g data-lp-flash><ellipse class="lp-fl" cx="0" cy="192" rx="30" ry="9" fill="url(#lp-g-flash)"></ellipse><text class="lp-pop" x="0" y="110">${tr('click!', 'cạch!')}</text></g>
      <g data-lp-jamg><ellipse class="lp-jm" cx="0" cy="192" rx="24" ry="7" fill="url(#lp-g-red)"></ellipse><ellipse class="lp-jfl" cx="0" cy="192" rx="34" ry="11" fill="url(#lp-g-red)"></ellipse></g>
      <g class="lp-wr" data-lp-wr>
        <g class="lp-wrleg">
          <path d="M560 300 H612 Q620 300 620.6 308 L628.5 392 Q628.8 396 624.8 396 H621.6 Q618.6 396 618.3 392.6 L611.2 309.6 Q610.8 306.4 607.8 306.4 H560 Z" fill="url(#lp-g-shaft)" stroke="#262c30" stroke-width=".8"></path>
          <path d="M562 301.4 H610" stroke="rgba(255,255,255,.6)"></path>
        </g>
      </g>
      <g class="lp-pkx" data-lp-pkx>
        <g class="lp-pky" data-lp-pky>
          <path d="M4 293 H700 V299 H-5 Q-9.5 299 -9.5 294.5 L-8.5 285 Q-7.6 277.6 -1.6 276.2 L2.6 276 Q5 276.2 4.6 279.2 L3.6 286 Q3 290.6 4 293 Z" fill="url(#lp-g-shaft)" stroke="#262c30" stroke-width=".8"></path>
          <path d="M6 294.4 H700" stroke="rgba(255,255,255,.7)" stroke-width="1"></path>
          <rect x="478" y="285" width="16" height="22" rx="2" fill="url(#lp-g-brass)" stroke="#4a3810" stroke-width=".8"></rect>
          <path d="M494 285 H760 Q768 285 768 293 V299 Q768 307 760 307 H494 Z" fill="url(#lp-g-grip)" stroke="#0c0806" stroke-width=".8"></path>
          <path d="M506 287 V305 M520 287 V305 M534 287 V305 M548 287 V305 M562 287 V305 M576 287 V305 M590 287 V305 M604 287 V305" stroke="rgba(255,228,190,.12)" stroke-width="1.4"></path>
        </g>
      </g>
    </g>
  </svg>`;
}

const KIT_SVG = (tr: PuzzleContext['tr']) => `<svg class="lp-kit" viewBox="0 0 250 64" role="img" aria-label="${esc(tr('Locksmith kit: a leather roll with four picks and an L-shaped tension wrench.', 'Bộ đồ nghề của thợ khóa: cuộn da có bốn cây nạy và một thanh vặn hình chữ L.'))}">
  <rect x="2" y="8" width="246" height="52" rx="6" fill="#6f4c2f" stroke="#3e2a18" stroke-width="1.2"></rect>
  <rect x="7" y="13" width="236" height="42" rx="4" fill="none" stroke="#d2b083" stroke-opacity=".5" stroke-dasharray="3 3"></rect>
  <rect x="30" y="31" width="11" height="25" rx="2" fill="#24170e" stroke="#120b06" stroke-width=".6"></rect><path d="M36 33 V13" stroke="#cfd6da" stroke-width="2.4" stroke-linecap="round"></path><rect x="78" y="31" width="11" height="25" rx="2" fill="#24170e" stroke="#120b06" stroke-width=".6"></rect><path d="M84 33 V13" stroke="#cfd6da" stroke-width="2.4" stroke-linecap="round"></path><rect x="126" y="31" width="11" height="25" rx="2" fill="#24170e" stroke="#120b06" stroke-width=".6"></rect><path d="M132 33 V13" stroke="#cfd6da" stroke-width="2.4" stroke-linecap="round"></path><rect x="174" y="31" width="11" height="25" rx="2" fill="#24170e" stroke="#120b06" stroke-width=".6"></rect><path d="M180 33 V13" stroke="#cfd6da" stroke-width="2.4" stroke-linecap="round"></path>
  <path d="M36 13 Q36 7.5 41 8.5" fill="none" stroke="#cfd6da" stroke-width="2.4" stroke-linecap="round"></path>
  <path d="M84 21 L88 18 L83 15.5 L88 13 L84 10" fill="none" stroke="#cfd6da" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path>
  <path d="M132 15 L137 10 L132 7" fill="none" stroke="#cfd6da" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path>
  <path d="M180 13 L184 9 L180 5 L176 9 Z" fill="#cfd6da"></path>
  <path d="M214 16 H228 V54" fill="none" stroke="#cfd6da" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"></path>
  <rect x="2" y="34" width="246" height="26" rx="0" fill="#5c3d24" opacity=".85"></rect>
  <path d="M60 34 V60 M108 34 V60 M156 34 V60 M204 34 V60" stroke="#d2b083" stroke-opacity=".45" stroke-dasharray="2.5 2.5"></path>
  <path d="M2 34.5 H248" stroke="#d2b083" stroke-opacity=".5"></path>
</svg>`;

const GAUGE_SVG = `<svg class="lp-gauge" viewBox="0 0 96 56" aria-hidden="true">
  <path d="M10 50 A38 38 0 0 1 86 50" fill="none" stroke="#2a2f33" stroke-width="7"></path>
  <path d="M44.03 12.21 A38 38 0 0 1 69.25 18.5" fill="none" stroke="#3f9a86" stroke-width="7"></path>
  <path d="M81.55 32.16 A38 38 0 0 1 86 50" fill="none" stroke="#9e3f2a" stroke-width="7"></path>
  <path d="M18 50 L14 50 M22.02 35 L18.56 33 M33 24.02 L31 20.56 M48 20 L48 16 M63 24.02 L65 20.56 M73.98 35 L77.44 33 M78 50 L82 50" stroke="#8f8577" stroke-width="1.4"></path>
  <g class="lp-needle"><path d="M48 50 L46.2 22 L48 12 L49.8 22 Z" fill="#efd486" stroke="#5e4a1c" stroke-width=".6"></path></g>
  <circle cx="48" cy="50" r="5" fill="url(#lp-g-brass)" stroke="#3a2c10" stroke-width=".8"></circle>
</svg>`;

const FACE_SVG = `<svg class="lp-face-svg" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="lp-g-ring" cx=".42" cy=".36" r=".7"><stop offset="0" stop-color="#f3dc95"></stop><stop offset=".55" stop-color="#c39b47"></stop><stop offset="1" stop-color="#6e5420"></stop></radialGradient>
    <radialGradient id="lp-g-fplug" cx=".42" cy=".36" r=".72"><stop offset="0" stop-color="#ead08a"></stop><stop offset=".6" stop-color="#b98f3e"></stop><stop offset="1" stop-color="#7a5c22"></stop></radialGradient>
  </defs>
  <circle cx="60" cy="62" r="57" fill="#000" opacity=".45"></circle>
  <circle cx="60" cy="60" r="56" fill="url(#lp-g-ring)" stroke="#3a2c10"></circle>
  <path d="M60 12.5 L60 7 M68.25 13.22 L68.86 9.77 M76.25 15.36 L77.44 12.08 M83.75 18.86 L86.5 14.1 M90.53 23.61 L92.78 20.93 M96.39 29.47 L99.07 27.22 M101.14 36.25 L105.9 33.5 M104.64 43.75 L107.92 42.56 M106.78 51.75 L110.23 51.14 M107.5 60 L113 60" stroke="#2b1f08" stroke-width="1.4"></path>
  <rect x="55" y="5" width="10" height="16" rx="1" fill="#120d08"></rect><rect x="56.4" y="7" width="7.2" height="13" rx="1.4" fill="url(#lp-g-drv)"></rect>
  <circle cx="60" cy="60" r="41.5" fill="#0e0b08"></circle>
  <g class="lp-fplug" data-lp-fplug>
    <circle cx="60" cy="60" r="40" fill="url(#lp-g-fplug)" stroke="#4a3810" stroke-width=".8"></circle>
    <rect x="55" y="20.5" width="10" height="13" fill="#120d08"></rect><rect x="56.4" y="21.5" width="7.2" height="11.5" rx="1.4" fill="url(#lp-g-key)"></rect>
    <path d="M55.5 34 H64.5 V46 L60.5 50.5 L64.5 56 V70 L59.5 76 L64.5 82 V92 H55.5 V80.5 L60 75 L55.5 69 V54.5 L59.6 49.5 L55.5 44.5 Z" fill="#0b0806" stroke="#5e4a1c" stroke-width=".7"></path>
    <path d="M56.5 86.5 H64 V91.5 H56.5 Z M60 89 L98 117" fill="#c9d1d5" stroke="#c9d1d5" stroke-width="5" stroke-linecap="round"></path>
    <path d="M60 89 L98 117" stroke="#4b545a" stroke-width="1.2" stroke-linecap="round"></path>
    <path d="M60 20.8 L57.6 24.6 H62.4 Z" fill="#efd486"></path>
  </g>
</svg>`;

const TRUNK_SVG = `<svg class="lp-trunk-svg" viewBox="0 0 200 170" aria-hidden="true">
  <defs>
    <linearGradient id="lp-g-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f28"></stop><stop offset="1" stop-color="#2a1c11"></stop></linearGradient>
    <linearGradient id="lp-g-iron" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1c2023"></stop><stop offset=".45" stop-color="#4a5359"></stop><stop offset="1" stop-color="#1a1d20"></stop></linearGradient>
  </defs>
  <ellipse cx="100" cy="162" rx="88" ry="7" fill="#000" opacity=".55"></ellipse>
  <g class="lp-lidin"><path d="M26 64 L34 10 Q100 -6 166 10 L174 64 Z" fill="#2a1c12" stroke="#15100b"></path><path d="M38 58 L44 18 Q100 6 156 18 L162 58 Z" fill="none" stroke="#4a5359" stroke-width="3"></path></g>
  <g class="lp-inside">
    <path d="M24 64 L28 44 H172 L176 64 Z" fill="#0d0907"></path>
    <path d="M64 61 L70 47 H130 L136 61 Z" fill="#e9dcc0"></path><path d="M68 57 L73 45 H127 L132 57 Z" fill="#f6efdf"></path>
    <path d="M100 45 V61 M70 53 H130" stroke="#bf3b2c" stroke-width="2"></path><circle cx="100" cy="53" r="2.6" fill="#bf3b2c"></circle>
  </g>
  <path d="M20 66 H180 V156 Q180 160 176 160 H24 Q20 160 20 156 Z" fill="url(#lp-g-wood)" stroke="#120c08"></path>
  <path d="M20 90 H180 M20 113 H180 M20 136 H180" stroke="rgba(0,0,0,.4)"></path>
  <path d="M33 66 H45 V160 H33 Z M155 66 H167 V160 H155 Z M20 150 H180 V160 H20 Z" fill="url(#lp-g-iron)"></path>
  <circle cx="39" cy="78" r="1.8" fill="#9aa3a8"></circle><circle cx="39" cy="124" r="1.8" fill="#9aa3a8"></circle><circle cx="161" cy="78" r="1.8" fill="#9aa3a8"></circle><circle cx="161" cy="124" r="1.8" fill="#9aa3a8"></circle>
  <rect x="85" y="70" width="30" height="34" rx="3" fill="url(#lp-g-brass)" stroke="#3a2c10"></rect>
  <circle cx="100" cy="84" r="3.4" fill="#120d08"></circle><path d="M98.4 85 H101.6 L102.6 95 H97.4 Z" fill="#120d08"></path>
  <g class="lp-bolt"><rect x="104" y="72" width="22" height="6" rx="1.5" fill="url(#lp-g-shaft)" stroke="#262c30" stroke-width=".7"></rect></g>
  <g class="lp-lid">
    <path d="M18 68 V46 Q100 18 182 46 V68 Z" fill="url(#lp-g-wood)" stroke="#120c08"></path>
    <path d="M18 58 H182" stroke="rgba(0,0,0,.35)"></path>
    <path d="M33 68 V38.8 Q39 36.6 45 34.9 V68 Z M155 68 V34.9 Q161 36.6 167 38.8 V68 Z M18 62 H182 V68 H18 Z" fill="url(#lp-g-iron)"></path>
    <path d="M93 52 H107 V80 Q107 83 104 83 H96 Q93 83 93 80 Z" fill="url(#lp-g-iron)" stroke="#0f1113"></path>
    <rect x="96.5" y="71" width="7" height="8" rx="1" fill="#0b0c0d"></rect>
  </g>
  <g class="lp-dust"><circle cx="51" cy="64" r="3" style="--dx: -34px; --dy: -26px; animation-delay: 1150ms"></circle><circle cx="65" cy="64" r="4.2" style="--dx: -22px; --dy: -36px; animation-delay: 1190ms"></circle><circle cx="79" cy="64" r="5.4" style="--dx: -8px; --dy: -40px; animation-delay: 1230ms"></circle><circle cx="93" cy="64" r="3" style="--dx: 8px; --dy: -42px; animation-delay: 1270ms"></circle><circle cx="107" cy="64" r="4.2" style="--dx: 22px; --dy: -36px; animation-delay: 1150ms"></circle><circle cx="121" cy="64" r="5.4" style="--dx: 34px; --dy: -24px; animation-delay: 1190ms"></circle><circle cx="135" cy="64" r="3" style="--dx: -40px; --dy: -8px; animation-delay: 1230ms"></circle><circle cx="149" cy="64" r="4.2" style="--dx: 40px; --dy: -10px; animation-delay: 1270ms"></circle></g>
</svg>`;

const ICONS = `<svg width="0" height="0" style="position: absolute" aria-hidden="true">
  <symbol id="lp-i-rung" viewBox="0 0 24 24"><path d="M2 12 H5 L7 7 L10 17 L13 7 L16 17 L18 12 H22"></path></symbol>
  <symbol id="lp-i-cach" viewBox="0 0 24 24"><path d="M12 3 V7 M12 17 V21 M3 12 H7 M17 12 H21 M5.6 5.6 L8.4 8.4 M15.6 15.6 L18.4 18.4 M18.4 5.6 L15.6 8.4 M8.4 15.6 L5.6 18.4"></path><circle cx="12" cy="12" r="2.2"></circle></symbol>
  <symbol id="lp-i-long" viewBox="0 0 24 24"><path d="M3 9 Q8 17 12 12 T21 15"></path><path d="M3 15 H6 M18 9 H21"></path></symbol>
  <symbol id="lp-i-ket" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"></circle><path d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5"></path></symbol>
  <symbol id="lp-i-key" viewBox="0 0 24 24"><circle cx="7.5" cy="12" r="4"></circle><path d="M11.5 12 H21 M17 12 V15.5 M20 12 V14.5"></path></symbol>
</svg>`;

function mount(body: HTMLElement, initial: PuzzleContext): PuzzleKindHandle {
  let ctx = initial;
  const tr = ctx.tr;
  const params = ctx.params ?? {};
  const pins = pinsFrom(params);
  const N = pins.length;
  const WIN = num(params.win, 4);
  const OVER = num(params.over, 10);
  const LMAX = num(params.liftMax, 54);
  const pinOf = (n: number) => pins[n - 1] ?? pins[N - 1];
  const maxLift = (pin: Pin) => Math.min(pin.need + 20, LMAX);

  // ---- state (kept in the module; the host never re-renders this body) ----
  let sel = N;
  let lift = 0;
  let tension = false;
  let setOrder: number[] = [];
  let jam = 0;
  let jamLift = 0;
  let attempts = 0;
  let bump = 0;
  let phase: Phase = 'pick';
  let msg = '';
  let msgPin = 0;
  let flashN = 0;
  let flashPin = pins[0].n;
  let jamN = 0;
  let dropN = 0;
  let dropping = false;
  let dropOrder: number[] = [];
  let dragging = false;
  let busy = false;
  let alive = true;
  let lastStatus = '';
  const isSet = (n: number) => setOrder.includes(n);

  // binding answers from the server, per "pins already set → pin" (the only secret the client asks for)
  const binds = new Map<string, boolean>();
  const pending = new Set<string>();
  const keyOf = (order: number[], pin: number) => `${order.join(',')}|${pin}`;
  const known = (pin: number) => binds.get(keyOf(setOrder, pin));

  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
    timers.add(id);
    return id;
  };
  let dropTimer = 0;
  let probeTimer = 0;
  let raf = 0;
  let drag: { id: number; y0: number; base: number; x: number; y: number; g: { left: number; s: number } } | null = null;
  let hover: number | null = null;

  // ---- markup ----
  const chest = params.chest ?? {};
  const chestTitle = chest.title || tr('Pin-tumbler chest', 'Rương khóa ổ bi');
  const chestText = chest.text || tr(`An iron chest with a ${N}-pin lock. The key is gone, but a locksmith's kit was left behind.`, `Rương sắt có ổ khóa ${WORDS[N] || N} chốt. Chìa đã mất; may mà còn bộ đồ nghề của thợ khóa.`);
  const chestTag = chest.tag || tr('EVIDENCE', 'VẬT CHỨNG');
  const note = params.note || tr('The locksmith said: only one pin binds at a time — lift the one that trembles first.', 'Thợ khóa dặn: mỗi lúc chỉ một chốt kẹt — chốt nào rung nhẹ thì nâng chốt đó trước.');
  const noteTag = params.noteTag || tr('ADVICE · LOCKSMITH', 'LỜI DẶN · THỢ KHÓA');
  const pips = pins.map((p) => `<i class="lp-pip" data-lp-pip="${p.n}"></i>`).join('');

  const root = document.createElement('div');
  root.className = 'lp-root';
  root.innerHTML = `
    <aside class="lp-clues" aria-label="${esc(tr('Clues for the lock', 'Manh mối cho ổ khóa'))}">
      <article class="pz-card s-paper lp-card-a">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <span class="pz-tag mine" style="margin-top: 0">${esc(chestTag)}</span>
        <h3 style="margin-top: 4px">${esc(chestTitle)}</h3>
        <p>${esc(chestText)}</p>
        ${KIT_SVG(tr)}
      </article>
      <article class="pz-card s-paper lp-card-b">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="lp-from"><span class="lp-from-ic" aria-hidden="true"><svg><use href="#lp-i-key"></use></svg></span><span class="pz-tag partner" style="margin-top: 0">${esc(noteTag)}</span></div>
        <p class="lp-quote">${esc(note)}</p>
      </article>
      <article class="pz-card s-paper lp-card-c">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>${esc(tr('What you feel', 'Cảm giác trên tay'))}</h3>
        <ul class="lp-legend">
          <li data-lp-lg="bind"><svg class="lp-lg-ic" aria-hidden="true"><use href="#lp-i-rung"></use></svg><span><b>${esc(tr('Trembling', 'Rung nhẹ'))}</b> — ${esc(tr('this pin binds', 'chốt đang kẹt'))}</span></li>
          <li data-lp-lg="set"><svg class="lp-lg-ic" aria-hidden="true"><use href="#lp-i-cach"></use></svg><span><b>${esc(tr('Click', 'Cạch'))}</b> — ${esc(tr('the pin is set', 'chốt đã khớp'))}</span></li>
          <li data-lp-lg="loose"><svg class="lp-lg-ic" aria-hidden="true"><use href="#lp-i-long"></use></svg><span><b>${esc(tr('Loose', 'Lỏng'))}</b> — ${esc(tr('not its turn yet', 'chốt chưa tới lượt'))}</span></li>
        </ul>
      </article>
    </aside>
    <section class="lp-sec" aria-label="${esc(tr(`The ${N}-pin lock`, `Ổ khóa ${WORDS[N] || N} chốt`))}">
      ${ICONS}
      <div class="lp-mat" data-lp-mat>
        <div class="lp-top">
          <p class="lp-prog"><span class="lp-pips" aria-hidden="true">${pips}</span><span data-lp-count></span></p>
          <p class="lp-top-hint">${esc(tr('Slide sideways to choose a pin · drag up to lift', 'Rê ngang để chọn chốt · kéo lên để nâng'))}</p>
        </div>
        <div class="lp-xwrap">
          <div class="lp-stage" tabindex="0" role="application" aria-roledescription="${esc(tr('lock', 'ổ khóa'))}" aria-label="${esc(tr(`${N}-pin lock`, `Ổ khóa ${WORDS[N] || N} chốt`))}" aria-describedby="lp-help" data-lp-stage>
            ${lockSvg(pins, tr)}
          </div>
        </div>
        <p class="lp-mleg" aria-hidden="true"><span><i class="sw-shear"></i>${esc(tr('SHEAR LINE', 'ĐƯỜNG CẮT'))}</span><span><i class="sw-drv"></i>${esc(tr('DRIVER PIN', 'CHỐT TRÊN'))}</span><span><i class="sw-key"></i>${esc(tr('KEY PIN', 'CHỐT DƯỚI'))}</span></p>
        <div class="lp-ctl">
          <button type="button" class="lp-tg" aria-pressed="false" aria-keyshortcuts="Space" data-lp-tension>
            ${GAUGE_SVG}
            <span class="lp-tg-t"><b>${esc(tr('Tension', 'Lực vặn'))}</b><span class="lp-tg-st" aria-hidden="true"><i></i><span data-lp-tword></span></span></span>
            <span class="pz-kbd" aria-hidden="true">Space</span>
          </button>
          <p class="lp-feel" aria-live="polite" data-lp-feel>
            <svg class="lp-feel-ic" aria-hidden="true"><use href="#lp-i-long" data-lp-feelic></use></svg>
            <span class="lp-feel-tx"><span class="lp-feel-k" data-lp-feelk></span><b data-lp-feeltx></b></span>
          </p>
          <figure class="lp-face" aria-hidden="true">${FACE_SVG}<figcaption class="lp-cap-h" data-lp-facecap></figcaption></figure>
          <figure class="lp-trunk" aria-hidden="true">${TRUNK_SVG}<figcaption class="lp-cap-h" data-lp-trunkcap></figcaption></figure>
        </div>
        <div class="lp-acts">
          <span class="lp-tries" data-lp-tries></span>
          <button type="button" class="s-btn s-btn-red lp-turn" aria-keyshortcuts="Enter" data-lp-turn>${esc(tr('Turn the plug', 'Xoay ổ khóa'))} <span class="pz-kbd" aria-hidden="true">Enter</span></button>
        </div>
        <p id="lp-help" class="s-sr">${esc(tr(
          'Focus the lock, then use the keys: left and right arrows move the pick to another pin; up and down lift or lower the pin a notch; space turns tension on or off; Enter turns the plug once every pin is set. You can also drag with a mouse or finger: slide sideways to choose a pin, drag up to lift.',
          `Chọn ổ khóa rồi dùng phím: mũi tên trái, phải để đưa cây nạy tới chốt khác; mũi tên lên, xuống để nâng hoặc hạ chốt từng nấc; phím cách để bật hoặc nhả lực vặn; Enter để xoay ổ khi cả ${WORDS[N] || N} chốt đã khớp. Có thể kéo chuột hoặc ngón tay: rê ngang để chọn chốt, kéo lên để nâng.`))}</p>
      </div>
    </section>`;
  body.appendChild(root);

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const mat = $<HTMLElement>('[data-lp-mat]');
  const stage = $<HTMLElement>('[data-lp-stage]');
  const tensionBtn = $<HTMLButtonElement>('[data-lp-tension]');
  const turnBtn = $<HTMLButtonElement>('[data-lp-turn]');
  const feel = $<HTMLElement>('[data-lp-feel]');
  const feelIc = $<SVGUseElement>('[data-lp-feelic]');
  const el = {
    count: $<HTMLElement>('[data-lp-count]'),
    tword: $<HTMLElement>('[data-lp-tword]'),
    feelK: $<HTMLElement>('[data-lp-feelk]'),
    feelTx: $<HTMLElement>('[data-lp-feeltx]'),
    faceCap: $<HTMLElement>('[data-lp-facecap]'),
    trunkCap: $<HTMLElement>('[data-lp-trunkcap]'),
    tries: $<HTMLElement>('[data-lp-tries]'),
    mk: $<SVGGElement>('[data-lp-mk]'),
    plug: $<SVGGElement>('[data-lp-plug]'),
    wr: $<SVGGElement>('[data-lp-wr]'),
    pkx: $<SVGGElement>('[data-lp-pkx]'),
    pky: $<SVGGElement>('[data-lp-pky]'),
    flash: $<SVGGElement>('[data-lp-flash]'),
    jamg: $<SVGGElement>('[data-lp-jamg]'),
    fplug: $<SVGGElement>('[data-lp-fplug]'),
  };
  const flashEls = [...el.flash.querySelectorAll<SVGElement>('.lp-fl, .lp-pop')];
  const jamFlash = el.jamg.querySelector<SVGElement>('.lp-jfl')!;
  const legend = (key: string) => root.querySelector<HTMLElement>(`[data-lp-lg="${key}"]`)!;
  const pinEls = pins.map((p) => ({
    lbl: root.querySelector<SVGTextElement>(`[data-lp-lbl="${p.n}"]`)!,
    ul: root.querySelector<SVGRectElement>(`[data-lp-ul="${p.n}"]`)!,
    kp: root.querySelector<SVGGElement>(`[data-lp-kp="${p.n}"]`)!,
    col: root.querySelector<SVGGElement>(`[data-lp-col="${p.n}"]`)!,
    spr: root.querySelector<SVGGElement>(`[data-lp-spr="${p.n}"]`)!,
    drv: root.querySelector<SVGGElement>(`[data-lp-drv="${p.n}"]`)!,
    pip: root.querySelector<HTMLElement>(`[data-lp-pip="${p.n}"]`)!,
  }));

  const reduced = () => Boolean(ctx.reducedMotion);
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };

  // ---- the server's binding answer ----
  function ask(pin: number) {
    if (phase !== 'pick' || isSet(pin)) return;
    const order = setOrder.slice();
    const key = keyOf(order, pin);
    if (binds.has(key) || pending.has(key)) return;
    pending.add(key);
    ctx.probe({ set: order, pin })
      .then((result) => {
        pending.delete(key);
        if (result?.feedback?.reason === 'invalid') return;
        binds.set(key, Boolean(result?.feedback?.binds));
        if (!alive) return;
        // The answer may land while the pin is already held at the shear line: it catches now.
        if (phase === 'pick' && tension && !jam && sel === pin && keyOf(setOrder, pin) === key && lift > 0) settle(pinOf(pin));
        render();
      })
      .catch((error) => {
        pending.delete(key);
        if (!alive) return;
        status(tr('NO SIGNAL', 'MẤT KẾT NỐI'), error?.message || tr('Could not reach the server — try the pin again.', 'Không hỏi được máy chủ — thử lại chốt này.'), 'bad');
      });
  }

  function scheduleAsk() {
    if (probeTimer) { window.clearTimeout(probeTimer); timers.delete(probeTimer); probeTimer = 0; }
    if (!tension || jam || phase !== 'pick' || isSet(sel) || known(sel) !== undefined) return;
    const pin = sel;
    probeTimer = later(() => { probeTimer = 0; if (sel === pin) ask(pin); }, 140);
  }

  /** Catch (set) the held pin if it binds, then overset it if it was lifted too far. */
  function settle(pin: Pin) {
    if (!isSet(pin.n) && lift >= pin.need - WIN) {
      const b = known(pin.n);
      if (b === true) {
        setOrder = setOrder.concat(pin.n);
        flashN++;
        flashPin = pin.n;
        msg = 'set';
        msgPin = pin.n;
      } else if (b === undefined) ask(pin.n);
    }
    if (isSet(pin.n) && lift > pin.need + WIN + OVER) {
      setOrder = setOrder.filter((n) => n !== pin.n);
      jam = pin.n;
      jamLift = lift;
      attempts++;
      bump++;
      jamN++;
      msg = 'jam';
      msgPin = pin.n;
    }
  }

  // ---- the pick ----
  function applyLift(target: number) {
    if (phase !== 'pick' || jam || busy) return;
    const pin = pinOf(sel);
    const L = r1(Math.max(0, Math.min(maxLift(pin), target)));
    if (L === lift) return;
    lift = L;
    if (!tension) {
      if (L > 6 && msg !== 'notension') msg = 'notension';
      render();
      return;
    }
    settle(pin);
    render();
  }

  function selectPin(n: number) {
    if (phase !== 'pick' || jam || n === sel || n < 1 || n > N) return;
    sel = n;
    lift = 0;
    render();
  }

  function nudgeJam() { jamN++; msg = 'jam'; render(); }

  function toggleTension() {
    if (phase !== 'pick' || busy) return;
    if (!tension) { tension = true; lift = 0; msg = 'on'; render(); return; }
    // releasing tension drops every caught driver (and a wedged pin) back into the plug
    const order = setOrder.slice();
    if (jam && !order.includes(jam)) order.push(jam);
    const fall = order.length > 0;
    if (dropTimer) { window.clearTimeout(dropTimer); timers.delete(dropTimer); dropTimer = 0; }
    tension = false;
    setOrder = [];
    jam = 0;
    jamLift = 0;
    lift = 0;
    msg = fall ? 'drop' : 'off';
    dropOrder = order;
    dropping = fall && !reduced();
    if (fall) dropN++;
    render();
    if (dropping) dropTimer = later(() => { dropTimer = 0; dropping = false; dropOrder = []; render(); }, 180 + order.length * 70 + 600);
  }

  function turn() {
    if (phase !== 'pick' || busy) return;
    if (jam) { nudgeJam(); return; }
    if (setOrder.length < N || !tension) { msg = 'short'; render(); return; }
    busy = true;
    stopDrag();
    lift = 0;
    render();
    ctx.submit({ order: setOrder.slice() })
      .then((result) => {
        busy = false;
        if (!alive) return;
        if (result.solved) { open(true); return; }
        // The server disagrees with the pins (e.g. stale binding answers): start over with fresh answers.
        binds.clear();
        msg = 'refused';
        toggleTension();
        msg = 'refused';
        render();
      })
      .catch((error) => {
        busy = false;
        if (!alive) return;
        render();
        status(tr('NOT SENT', 'CHƯA GỬI'), error?.message || tr('Could not reach the server.', 'Không gửi được tới máy chủ.'), 'bad');
      });
  }

  function open(animated: boolean) {
    stopDrag();
    clearAllTimers();
    if (setOrder.length < N) setOrder = pins.map((p) => p.n);
    tension = true;
    jam = 0;
    lift = 0;
    dropping = false;
    msg = '';
    if (!animated || reduced()) { phase = 'open'; render(); return; }
    phase = 'turn';
    render();
    later(() => { phase = 'open'; render(); }, 2050);
  }

  // ---- pointer: slide along the keyway to choose, drag up to lift ----
  function geom() {
    const rect = stage.getBoundingClientRect();
    return rect.width ? { left: rect.left, s: rect.width / 800 } : null;
  }
  function pinAt(clientX: number, g: { left: number; s: number }) {
    const x = (clientX - g.left) / g.s;
    let best = 1;
    let bestD = Infinity;
    for (const p of pins) { const d = Math.abs(x - p.x); if (d < bestD) { bestD = d; best = p.n; } }
    return best;
  }
  function onDown(e: PointerEvent) {
    if (phase !== 'pick' || busy) return;
    if (e.button != null && e.button !== 0) return;
    if (jam) { nudgeJam(); return; }
    const g = geom();
    if (!g) return;
    const n = pinAt(e.clientX, g);
    const same = n === sel;
    drag = { id: e.pointerId, y0: e.clientY, base: same ? lift : 0, x: e.clientX, y: e.clientY, g };
    try { stage.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
    sel = n;
    lift = same ? lift : 0;
    dragging = true;
    render();
  }
  function onMove(e: PointerEvent) {
    if (drag) {
      if (e.pointerId !== drag.id) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
    } else {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      hover = e.clientX;
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; frame(); });
  }
  function frame() {
    if (!alive) return;
    if (drag) {
      if (phase !== 'pick' || jam) return;
      const L = drag.base + (drag.y0 - drag.y) * GAIN;
      if (!lift && L <= 0.5) {
        const n = pinAt(drag.x, drag.g);
        if (n !== sel) { drag.y0 = drag.y; drag.base = 0; sel = n; lift = 0; render(); return; }
      }
      applyLift(L);
      return;
    }
    const hx = hover;
    hover = null;
    if (hx == null || phase !== 'pick' || jam || lift) return;
    const g = geom();
    if (!g) return;
    const n = pinAt(hx, g);
    if (n !== sel) { sel = n; render(); }
  }
  function onUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; frame(); }
    drag = null;
    try { stage.releasePointerCapture(e.pointerId); } catch { /* released */ }
    dragging = false;
    if (!jam && phase === 'pick') lift = 0;
    render();
  }
  function onKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); toggleTension(); return; }
    if (k === 'Enter') { e.preventDefault(); turn(); return; }
    const dirs: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 2, ArrowDown: -2 };
    if (!(k in dirs)) return;
    e.preventDefault();
    if (phase !== 'pick') return;
    if (jam) { nudgeJam(); return; }
    const d = dirs[k];
    if (d === -1 || d === 1) { selectPin(Math.max(1, Math.min(N, sel + d))); return; }
    applyLift(lift + (d > 0 ? STEP : -STEP));
  }
  function stopDrag() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    drag = null;
    hover = null;
    dragging = false;
  }
  function clearAllTimers() {
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    dropTimer = 0;
    probeTimer = 0;
  }

  // ---- status line (host footer) ----
  function status(kick: string, text: string, tone: PuzzleTone = 'info') {
    const line = kick ? `${kick} · ${text}` : text;
    if (line === lastStatus) return;
    lastStatus = line;
    ctx.setStatus(line, tone);
  }

  // ---- view ----
  function render() {
    if (!alive) return;
    root.classList.toggle('lp-rm', reduced());
    const turning = phase === 'turn';
    const isOpen = phase === 'open';
    const done = turning || isOpen;
    const n = setOrder.length;
    const plugDx = tension || done ? r1(2 + 1.2 * n) : 0;
    const faceDeg = done ? 90 : tension ? 2 * n : 0;
    const delays: Record<number, number> = {};
    if (dropping) dropOrder.forEach((p, i) => { delays[p] = 60 + i * 70; });
    const selKnown = known(sel);
    pins.forEach((pin, i) => {
      const e = pinEls[i];
      const isSel = pin.n === sel && !done;
      const set = isSet(pin.n);
      const kLift = jam === pin.n ? jamLift : isSel ? lift : 0;
      const keyTop = YS + pin.need - kLift;
      const dBot = set ? Math.min(YS - 1.5, keyTop) : keyTop;
      const restTop = YS + pin.need - LD;
      const held = isSel && kLift > 0 && !jam;
      const bindTouch = isSel && tension && !set && !jam && phase === 'pick' && known(pin.n) === true;
      const dl = `${delays[pin.n] || 0}ms`;
      e.kp.style.transform = `translateY(${r1(-kLift)}px)`;
      e.kp.style.transitionDelay = dl;
      e.drv.style.transform = `translateY(${r1(dBot - (YS + pin.need))}px)`;
      e.drv.style.transitionDelay = dl;
      e.spr.style.transform = `scaleY(${r3((dBot - LD - YCT) / (restTop - YCT))})`;
      e.spr.style.transitionDelay = dl;
      setCls(e.kp, ['lp-kp', held ? 'is-held' : '', bindTouch ? 'is-bind' : '', jam === pin.n ? 'is-jam' : ''].filter(Boolean).join(' '));
      setCls(e.col, ['lp-col', held ? 'is-held' : '', bindTouch ? 'is-bind' : '', set ? 'is-set' : ''].filter(Boolean).join(' '));
      setCls(e.lbl, ['lp-lbl', isSel ? 'is-sel' : '', set ? 'is-set' : '', jam === pin.n ? 'is-jam' : ''].filter(Boolean).join(' '));
      setCls(e.ul, 'lp-ul' + (set ? ' is-on' : ''));
      setCls(e.pip, 'lp-pip' + (i < n ? ' is-on' : ''));
    });
    const selPin = pinOf(sel);
    const pickLift = jam && jam === sel ? jamLift : done ? 0 : lift;
    const ready = phase === 'pick' && n === N && tension && !jam;
    el.mk.style.transform = `translateX(${selPin.x}px)`;
    el.plug.style.transform = `translateX(${plugDx}px)`;
    el.wr.style.transform = `translateX(${plugDx}px)`;
    el.pkx.style.transform = `translateX(${r1(selPin.x + plugDx)}px)`;
    el.pky.style.transform = `translateY(${r1(-pickLift)}px)`;
    setCls(el.pky, 'lp-pky' + (!done && !jam && lift > 0 ? ' is-held' : ''));
    el.flash.setAttribute('transform', `translate(${pinOf(flashPin).x} 0)`);
    const flashCls = flashN ? (flashN % 2 ? ' fa' : ' fb') : '';
    flashEls.forEach((node) => setCls(node, (node.classList.contains('lp-pop') ? 'lp-pop' : 'lp-fl') + flashCls));
    el.jamg.setAttribute('transform', `translate(${pinOf(jam || msgPin || N).x} 0)`);
    setCls(jamFlash, 'lp-jfl' + (jamN ? (jamN % 2 ? ' ja' : ' jb') : ''));
    el.fplug.style.transform = `rotate(${faceDeg}deg)`;
    el.faceCap.textContent = `${tr('PLUG', 'Ổ XOAY')} ${faceDeg}°`;
    el.count.textContent = `${tr('Pins set', 'Chốt đã khớp')}: ${n}/${N}`;

    // feel readout
    let feelKind = 'off';
    let feelText = tr('Loose — no tension yet', 'Lỏng — chưa có lực vặn');
    let icon = '#lp-i-long';
    if (done) { feelKind = 'set'; feelText = tr('The plug has turned', 'Ổ khóa đã xoay'); icon = '#lp-i-cach'; }
    else if (jam) { feelKind = 'jam'; feelText = tr('Jammed — pin past the shear line', 'Kẹt cứng — chốt quá đường cắt'); icon = '#lp-i-ket'; }
    else if (!tension) feelKind = 'off';
    else if (isSet(sel)) { feelKind = 'set'; feelText = tr('Click — the pin is set', 'Cạch — chốt đã khớp'); icon = '#lp-i-cach'; }
    else if (selKnown === true) { feelKind = 'bind'; feelText = tr('Trembling — this pin binds', 'Rung nhẹ — chốt đang kẹt'); icon = '#lp-i-rung'; }
    else if (selKnown === false) { feelKind = 'loose'; feelText = tr('Loose — not its turn yet', 'Lỏng — chốt chưa tới lượt'); }
    else { feelKind = 'wait'; feelText = tr('Feeling the pin…', 'Đang dò chốt…'); icon = '#lp-i-rung'; }
    setCls(feel, 'lp-feel is-' + feelKind);
    if (feelIc.getAttribute('href') !== icon) feelIc.setAttribute('href', icon);
    el.feelK.textContent = `${tr('FEEL', 'CẢM GIÁC')} · ${tr('PIN', 'CHỐT')} ${sel}`;
    el.feelTx.textContent = feelText;
    setCls(legend('bind'), feelKind === 'bind' ? 'is-on' : '');
    setCls(legend('set'), feelKind === 'set' ? 'is-on' : '');
    setCls(legend('loose'), feelKind === 'loose' || feelKind === 'off' ? 'is-on' : '');

    tensionBtn.setAttribute('aria-pressed', tension || done ? 'true' : 'false');
    tensionBtn.disabled = done || busy;
    el.tword.textContent = tension || done ? tr('ON', 'BẬT') : tr('OFF', 'TẮT');
    el.trunkCap.textContent = isOpen ? tr('CHEST · OPEN', 'RƯƠNG · ĐÃ MỞ') : turning ? tr('CHEST · OPENING', 'RƯƠNG · ĐANG MỞ') : tr('CHEST · LOCKED', 'RƯƠNG · ĐANG KHÓA');
    el.tries.textContent = `${tr('Tries', 'Lần thử')}: ${attempts}`;
    setCls(el.tries, ['lp-tries', attempts > 0 ? 'has-fail' : '', bump ? (bump % 2 ? 'bump-a' : 'bump-b') : ''].filter(Boolean).join(' '));
    turnBtn.disabled = !ready || busy;
    setCls(turnBtn, 's-btn s-btn-red lp-turn' + (ready && !busy ? ' is-ready' : ''));
    turnBtn.hidden = done;

    setCls(mat, ['lp-mat', tension || done ? 'is-ten' : '', jam ? 'is-jam' : '', dragging ? 'is-drag' : '', dropping ? 'is-drop' : '',
      turning ? 'is-turn' : '', isOpen ? 'is-open' : '', jamN ? (jamN % 2 ? 'shk-a' : 'shk-b') : '', dropN ? (dropN % 2 ? 'dr-a' : 'dr-b') : ''].filter(Boolean).join(' '));

    // footer status
    const pn = msgPin || sel;
    if (turning) status(tr('OPENING', 'ĐANG MỞ'), tr('The plug turns — the chest bolt slides back.', 'Ổ khóa xoay — chốt rương rút về.'), 'ok');
    else if (isOpen) status(tr('OPEN', 'ĐÃ MỞ'), tr('The chest is open.', 'Rương đã mở.'), 'ok');
    else if (busy) status(tr('TURNING', 'ĐANG XOAY'), tr('Turning the plug…', 'Đang xoay ổ khóa…'));
    else if (jam) status(tr('TOO FAR', 'QUÁ TAY'), tr('Too far — the pin is stuck on the shear line. Release tension to start again.', 'Quá tay — chốt kẹt trên đường cắt. Nhả lực vặn để làm lại.'), 'bad');
    else if (ready) status(tr(`ALL ${N} PINS`, `ĐỦ ${N} CHỐT`), tr(`Click! All ${N} pins are set. Turn the plug (Enter).`, `Cạch! Cả ${WORDS[N] || N} chốt đã khớp. Xoay ổ khóa (Enter).`), 'ok');
    else if (msg === 'set') status(`${tr('SET', 'ĐÃ KHỚP')} ${n}/${N}`, tr(`Click! Pin ${pn} is set.`, `Cạch! Chốt ${pn} đã khớp.`), 'ok');
    else if (msg === 'notension') status(tr('SLIPPED', 'TRƯỢT'), tr('Keep tension on so the pins can catch.', 'Cần giữ lực vặn để chốt bám lại.'));
    else if (msg === 'drop') status(tr('RELEASED', 'NHẢ LỰC'), tr('Tension released — the pins fall back.', 'Nhả lực vặn — các chốt rơi về chỗ cũ.'));
    else if (msg === 'refused') status(tr('STILL STUCK', 'VẪN KẸT'), tr('The plug will not turn — the pins fell back. Feel them again.', 'Lõi khóa không xoay — các chốt đã rơi về. Dò lại từ đầu.'), 'bad');
    else if (msg === 'short') status(tr('WILL NOT TURN', 'CHƯA XOAY ĐƯỢC'), tr(`${N - n} pin(s) still unset — the plug will not turn.`, `Còn ${N - n} chốt chưa khớp — ổ chưa xoay được.`));
    else if (tension) status(tr('PROBING', 'ĐANG DÒ'), n ? tr(`${n}/${N} set. Find the next binding pin — it trembles.`, `Đã khớp ${n}/${N}. Tìm chốt kẹt tiếp theo — nó sẽ rung nhẹ.`) : tr('Probe each pin, find the one that trembles, then lift slowly.', 'Dò từng chốt, tìm chốt rung nhẹ rồi nâng từ từ.'));
    else status(tr('READY', 'CHUẨN BỊ'), tr('Turn tension on (Space), then probe each pin.', 'Bật lực vặn (Space) rồi dò từng chốt.'));

    scheduleAsk();
  }

  // ---- wiring ----
  const onTension = () => toggleTension();
  const onTurn = () => turn();
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('keydown', onKey);
  tensionBtn.addEventListener('click', onTension);
  turnBtn.addEventListener('click', onTurn);

  if (ctx.solved) open(false);
  else render();

  return {
    update(next) {
      ctx = next;
      if (next.solved && phase === 'pick' && !busy) open(false); // the partner opened it
      else render();
    },
    unmount() {
      alive = false;
      stopDrag();
      clearAllTimers();
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('keydown', onKey);
      tensionBtn.removeEventListener('click', onTension);
      turnBtn.removeEventListener('click', onTurn);
      root.remove();
    },
  };
}

const lockpick: PuzzleKindModule = {
  kind: 'lockpick',
  label: { en: 'Lock picking', vi: 'Nạy khóa' },
  mount,
};

export default lockpick;
