/**
 * P10 · Pha thuốc thử — ported from design/project/PuzzleReagent.dc.html.
 * Squeeze drops from the three reagents (max params.maxDrops, a 9th spills), read the colour meter
 * (RYB trilinear mix vs the public target swatch, CIELAB ΔE — the same maths as ReagentMixKind.cs), then
 * sweep the cup over the blank letter: ctx.submit({ drops:{y,b,r} }). The server re-mixes and judges;
 * a wrong sweep stains a corner (the run's failed attempts), the right one makes the ink bloom. The
 * letter text only exists in ctx.reveal (sent once solved).
 */
import './reagent_mix.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

type Key = 'y' | 'b' | 'r';
type Rgb = [number, number, number];
interface Msg { kick: string; text: string; tone: PuzzleTone }

const KEYS: Key[] = ['y', 'b', 'r'];
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const BX: Record<Key, number> = { y: 52, b: 142, r: 232 }; // bottle x in the bench art
const BEAKER_X = 358;
const TIP_Y = 182;
const BOTTOM = 306;
const STEP = 11;
const DEFAULT_CUBE: Record<string, Rgb> = {
  w: [240, 236, 222], r: [196, 58, 38], y: [226, 172, 34], b: [36, 98, 162],
  ry: [216, 108, 32], rb: [104, 44, 98], yb: [58, 132, 66], ryb: [58, 44, 30],
};
const LIQ_TOP: Record<Key, number> = { y: 274, b: 268, r: 280 };

const css = (rgb: Rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
const tint = (rgb: Rgb, t: number) => css(rgb.map((v) => Math.round(v + (255 - v) * t)) as Rgb);

function lab(rgb: Rgb) {
  const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const [r, g, b] = rgb.map(f);
  const h = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = h((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const Yv = h(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const Z = h((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * Yv - 16, 500 * (X - Yv), 200 * (Yv - Z)];
}

function mount(body: HTMLElement, initial: PuzzleContext): PuzzleKindHandle {
  let ctx = initial;
  const tr = ctx.tr;
  const params = ctx.params ?? {};
  const cube: Record<string, Rgb> = { ...DEFAULT_CUBE };
  if (params.cube && typeof params.cube === 'object') {
    for (const corner of Object.keys(DEFAULT_CUBE)) {
      const v = params.cube[corner];
      if (Array.isArray(v) && v.length === 3) cube[corner] = v.map(Number) as Rgb;
    }
  }
  const R: Record<Key, { rgb: Rgb; name: string; low: string; n: string }> = {
    y: { rgb: cube.y, name: tr('TURMERIC YELLOW', 'VÀNG NGHỆ'), low: tr('turmeric yellow', 'vàng nghệ'), n: '1' },
    b: { rgb: cube.b, name: tr('COPPER BLUE', 'LAM ĐỒNG'), low: tr('copper blue', 'lam đồng'), n: '2' },
    r: { rgb: cube.r, name: tr('VERMILION', 'ĐỎ SON'), low: tr('vermilion', 'đỏ son'), n: '3' },
  };
  (Array.isArray(params.reagents) ? params.reagents : []).forEach((item: any) => {
    const k = item?.key as Key;
    if (!KEYS.includes(k)) return;
    if (item.name) R[k].name = String(item.name);
    if (item.low) R[k].low = String(item.low);
    if (Array.isArray(item.rgb) && item.rgb.length === 3) R[k].rgb = item.rgb.map(Number) as Rgb;
  });
  const target: Rgb = Array.isArray(params.target) && params.target.length === 3 ? params.target.map(Number) as Rgb : [113, 119, 47];
  const T_LAB = lab(target);
  const tolerance = Number(params.tolerance) > 0 ? Number(params.tolerance) : 1.5;
  const MAX = Math.max(3, Math.min(12, Math.round(Number(params.maxDrops) || 8)));
  const targetName = String(params.targetName || tr('target colour', 'màu mẫu'));
  const total = Number(params.total) > 0 ? Number(params.total) : 0;

  // ---- colour: pigment (RYB) mixing + perceptual deviation ----
  const count = (drops: Key[]) => { const c = { y: 0, b: 0, r: 0 }; drops.forEach((k) => { c[k] += 1; }); return c; };
  function mixRGB(c: Record<Key, number>): Rgb | null {
    const m = Math.max(c.y, c.b, c.r);
    if (!m) return null;
    const Y = c.y / m;
    const B = c.b / m;
    const Rr = c.r / m;
    const corners: [number, number, number, Rgb][] = [[0, 0, 0, cube.w], [1, 0, 0, cube.r], [0, 1, 0, cube.y], [0, 0, 1, cube.b], [1, 1, 0, cube.ry], [1, 0, 1, cube.rb], [0, 1, 1, cube.yb], [1, 1, 1, cube.ryb]];
    const out = [0, 0, 0];
    corners.forEach(([cr, cy, cb, col]) => {
      const w = (cr ? Rr : 1 - Rr) * (cy ? Y : 1 - Y) * (cb ? B : 1 - B);
      for (let i = 0; i < 3; i++) out[i] += w * col[i];
    });
    return out.map((v) => Math.round(v)) as Rgb;
  }
  function dev(c: Record<Key, number>) {
    const rgb = mixRGB(c);
    if (!rgb) return null;
    const L = lab(rgb);
    const dE = Math.hypot(L[0] - T_LAB[0], L[1] - T_LAB[1], L[2] - T_LAB[2]);
    const hue = (Math.atan2(L[2], L[1]) * 180) / Math.PI;
    const ht = (Math.atan2(T_LAB[2], T_LAB[1]) * 180) / Math.PI;
    const dh = ((hue - ht + 540) % 360) - 180;
    const warm = Math.abs(dh) > 0.5 ? dh < 0 : L[0] > T_LAB[0];
    return { rgb, dE, warm };
  }
  const isMatch = (drops: Key[]) => { const d = dev(count(drops)); return !!d && d.dE < tolerance; };
  const surfY = (n: number) => BOTTOM - STEP * Math.min(8, Math.round((n * 8) / MAX));

  const M: Record<string, Msg> = {
    fresh: { kick: tr('STEP 1 · MIX', 'BƯỚC 1 · PHA MÀU'), text: tr('The cup is empty. Click a bottle (or keys 1 · 2 · 3) to add one drop at a time.', 'Cốc đang rỗng. Bấm vào một lọ (hoặc phím 1 · 2 · 3) để nhỏ từng giọt.'), tone: 'info' },
    spill: { kick: tr('OVERFLOW', 'TRÀN CỐC'), text: tr('The cup overflowed — pour it out and mix again.', 'Tràn cốc — đổ bỏ rồi pha lại.'), tone: 'bad' },
    spillWait: { kick: tr('OVERFLOW', 'TRÀN CỐC'), text: tr('The cup overflowed — pour it out before adding more.', 'Cốc đã tràn — bấm Đổ bỏ trước khi nhỏ thêm.'), tone: 'bad' },
    pourWait: { kick: tr('POUR OUT', 'ĐỔ BỎ'), text: tr('Waiting for the last drop before pouring…', 'Chờ giọt cuối rơi xong rồi đổ…'), tone: 'info' },
    pouring: { kick: tr('POUR OUT', 'ĐỔ BỎ'), text: tr('Pouring the mix into the waste jar…', 'Đang đổ thuốc vào bình thải…'), tone: 'info' },
    poured: { kick: tr('CLEAN CUP', 'CỐC SẠCH'), text: tr('Poured out. Mix again from the first drop.', 'Đã đổ bỏ. Pha lại từ giọt đầu tiên.'), tone: 'info' },
    emptyPour: { kick: tr('EMPTY CUP', 'CỐC RỖNG'), text: tr('There is nothing to pour.', 'Cốc chưa có gì để đổ.'), tone: 'info' },
    emptySweep: { kick: tr('EMPTY CUP', 'CỐC RỖNG'), text: tr('No reagent to sweep yet — add drops first.', 'Chưa có thuốc để quét — nhỏ giọt vào cốc trước.'), tone: 'info' },
    wait: { kick: tr('WAIT', 'CHỜ ĐÃ'), text: tr('The last drop is still falling.', 'Giọt cuối còn đang rơi.'), tone: 'info' },
    sweeping: { kick: tr('SWEEPING', 'QUÉT THUỐC'), text: tr('The flat brush lays a thin coat over the letter…', 'Chổi dẹt quét một lớp thuốc mỏng lên lá thư…'), tone: 'info' },
    revealing: { kick: tr('INK SHOWING', 'MỰC ĐANG HIỆN'), text: tr('The writing slowly blooms on the paper…', 'Nét chữ loang dần trên giấy…'), tone: 'ok' },
    bad1: { kick: tr('WRONG REAGENT', 'SAI THUỐC'), text: tr('Wrong reagent — a corner of the letter is stained.', 'Sai thuốc — lá thư bị ố một góc.'), tone: 'bad' },
    bad2: { kick: tr('WRONG REAGENT', 'SAI THUỐC'), text: tr('Wrong reagent — another corner is stained.', 'Sai thuốc — lá thư bị ố thêm một góc.'), tone: 'bad' },
  };
  function dropMsg(drops: Key[]): Msg {
    const n = drops.length;
    const k = drops[n - 1];
    const d = dev(count(drops));
    if (!d) return M.fresh;
    if (d.dE < tolerance) return { kick: tr('MATCHES THE SAMPLE', 'KHỚP MẪU'), text: tr('The needle sits in the green — sweep the reagent over the letter.', 'Kim đo nằm trong vùng xanh — quét thuốc lên lá thư.'), tone: 'ok' };
    const lean = tr(`Needle off by ${Math.round(d.dE)}, leaning ${d.warm ? 'warm' : 'cold'}.`, `Kim lệch ${Math.round(d.dE)}, nghiêng về phía ${d.warm ? 'ấm' : 'lạnh'}.`);
    if (n >= MAX) return { kick: `${tr('DROP', 'GIỌT')} ${MAX}/${MAX}`, text: tr(`The cup is full and does not match. ${lean} Pour it out and mix again.`, `Cốc đã đầy mà chưa khớp mẫu. ${lean} Đổ bỏ rồi pha lại.`), tone: 'info' };
    return { kick: `${tr('DROP', 'GIỌT')} ${n}/${MAX}`, text: `${R[k].name}. ${lean}`, tone: 'info' };
  }

  // ---- state ----
  let drops: Key[] = [];
  let spilled = false;
  let spillLive = false;
  let dp: Record<Key, string> = { y: 'home', b: 'home', r: 'home' };
  const tok: Record<Key, number> = { y: 0, b: 0, r: 0 };
  let sq: Record<Key, string> = { y: '', b: '', r: '' };
  let dropK = '';
  let dropC = '#000';
  let dropFall = 0;
  let hitK = '';
  let hitC = '#000';
  let pourK = '';
  let pourWait = false;
  let instant = false;
  let busy = false;
  let sweeping = false;
  let sweepK = '';
  let localStains = 0;
  let stainLive = false;
  let revealed = false;
  let revealLive = false;
  let solved = false;
  let submitting = false;
  let msg: Msg | null = null;
  let q: Key[] = [];
  let fly: Key | null = null;
  let away: Key | null = null;
  let alive = true;
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
    timers.add(id);
  };
  const reduced = () => Boolean(ctx.reducedMotion);
  const stains = () => Math.max(localStains, Number(ctx.run?.attempts) || 0);

  // ---- markup ----
  const bottle = (k: Key) => {
    const rgb = R[k].rgb;
    const top = LIQ_TOP[k];
    return `<g transform="translate(${BX[k]} 0)">
      <ellipse cx="0" cy="341" rx="42" ry="5" fill="rgba(0,0,0,.55)"></ellipse>
      <path d="M-36 252 Q-36 240 -24 236 L-15 228 Q-13 224 -13 220 L-13 211 L13 211 L13 220 Q13 224 15 228 L24 236 Q36 240 36 252 L36 330 Q36 340 26 340 L-26 340 Q-36 340 -36 330 Z" fill="rgba(46,14,11,.62)" stroke="rgba(255,150,128,.32)" stroke-width="1.2"></path>
      <path d="M-32 ${top} L32 ${top} L32 328 Q32 336 24 336 L-24 336 Q-32 336 -32 328 Z" fill="${css(rgb)}"></path>
      <path d="M-32 ${top} L32 ${top} L32 328 Q32 336 24 336 L-24 336 Q-32 336 -32 328 Z" fill="url(#rg-shade)"></path>
      <ellipse cx="0" cy="${top}" rx="32" ry="3.2" fill="${tint(rgb, 0.25)}"></ellipse>
      <rect x="-25" y="288" width="50" height="40" rx="2" fill="#e9cfc2" stroke="rgba(70,24,16,.45)" stroke-width="1"></rect>
      <rect x="-25" y="288" width="50" height="6" rx="1" fill="${css(rgb)}"></rect>
      <text x="0" y="321" text-anchor="middle" style="font-family: 'Playfair Display', Georgia, serif; font-size: 23px; font-weight: 700; fill: #2a1210">${R[k].n}</text>
      <path d="M-30 247 Q-31.5 290 -29 326" fill="none" stroke="rgba(255,208,192,.4)" stroke-width="3" stroke-linecap="round"></path>
      <path d="M31.5 250 Q33.5 290 31.5 328" fill="none" stroke="rgba(255,72,50,.55)" stroke-width="1.6"></path>
      <rect x="-15" y="204" width="30" height="8" rx="2" fill="#2a1210" stroke="rgba(255,150,128,.32)" stroke-width="1"></rect>
    </g>`;
  };
  const dropper = (k: Key) => `<g class="rg-dp" data-rg-dp="${k}"><g transform="translate(${BX[k]} 0)">
      <path d="M-3.6 206 L-3.6 270 Q-3.4 276 -1.3 281 L1.3 281 Q3.4 276 3.6 270 L3.6 206 Z" fill="rgba(255,226,214,.16)" stroke="rgba(255,196,180,.6)" stroke-width="1"></path>
      <rect x="-2" y="262" width="4" height="16" rx="2" fill="${css(R[k].rgb)}"></rect>
      <rect x="-14" y="190" width="28" height="17" rx="3" fill="#1b0f0d" stroke="rgba(255,150,128,.25)" stroke-width="1"></rect>
      <path d="M-11 194 H11" stroke="rgba(255,150,128,.3)" stroke-width="1"></path>
      <g class="rg-bulb" data-rg-bulb="${k}">
        <path d="M-12 192 L-12 160 Q-12 142 0 142 Q12 142 12 160 L12 192 Z" fill="url(#rg-rubber)"></path>
        <path d="M-7 186 L-7 161 Q-7 151 -2 148" fill="none" stroke="rgba(255,120,96,.42)" stroke-width="2" stroke-linecap="round"></path>
      </g>
    </g></g>`;
  const btn = (k: Key) => `<button type="button" class="rg-bt rg-bt-${k}" data-rg-bt="${k}" aria-disabled="false">
      <span class="rg-plate"><i></i><span class="rg-plate-n">${esc(R[k].name)}</span><span class="rg-plate-c"><span class="pz-kbd">${R[k].n}</span><b data-rg-n="${k}">0</b>${esc(tr('DROPS', 'GIỌT'))}</span><i></i></span>
    </button>`;
  const find = params.find ?? {};
  const testimony = typeof params.testimony === 'string' ? { text: params.testimony, mono: params.witnessMono } : params.testimony ?? null;
  const targetCss = css(target);
  const labelName = targetName.toUpperCase();
  const root = document.createElement('div');
  root.className = 'rg-root';
  root.innerHTML = `
    <aside class="rg-clues" aria-label="${esc(tr('Clues', 'Manh mối'))}">
      <div class="pz-card s-paper rg-card rg-card-a">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>${esc(find.title || tr('Colour sample on an empty bottle', 'Mẫu màu dán trên chai rỗng'))}</h3>
        <svg class="rg-label" viewBox="0 0 236 84" role="img" aria-label="${esc(tr(`Empty bottle label: a ${targetName} swatch${total ? `, "${total} drops"` : ''}.`, `Nhãn chai rỗng: ô màu ${targetName}${total ? `, ghi tay ‘${labelName} — ${total} giọt’` : ''}.`))}">
          <g transform="translate(6 4)">
            <path d="M14 0h14v8c0 3 2 4 4 6 4 3 6 7 6 12v48c0 4-3 6-6 6H10c-3 0-6-2-6-6V26c0-5 2-9 6-12 2-2 4-3 4-6Z" fill="#5a3a22" stroke="#2a1a10" stroke-width="1.2"></path>
            <path d="M9 30c0-4 1-7 3-9" fill="none" stroke="rgba(255,236,210,.45)" stroke-width="2" stroke-linecap="round"></path>
            <rect x="8" y="40" width="26" height="22" fill="#efe4cf" stroke="#2a1a10" stroke-width=".8"></rect>
            <rect x="12" y="44" width="10" height="10" fill="${targetCss}"></rect>
            <rect x="12" y="-2" width="18" height="5" rx="1" fill="#2a1a10"></rect>
          </g>
          <path d="M42 54 L72 40 M42 70 L72 76" fill="none" stroke="#5b5248" stroke-width="1" stroke-dasharray="3 3"></path>
          <g transform="rotate(-2 154 42)">
            <path d="M74 8 L230 6 L232 74 L76 78 L74 60 L77 52 L74 44 Z" fill="#f2e7d1" stroke="rgba(91,82,72,.55)" stroke-width="1"></path>
            <rect x="120" y="0" width="38" height="12" fill="rgba(233,220,192,.8)" transform="rotate(4 139 6)"></rect>
            <rect x="84" y="20" width="44" height="44" fill="${targetCss}" stroke="rgba(0,0,0,.3)" stroke-width="1"></rect>
            <text x="136" y="40" textLength="${Math.min(90, labelName.length * 11)}" lengthAdjust="spacingAndGlyphs" style="font-family: 'Crimson Text', Georgia, serif; font-style: italic; font-size: 19px; font-weight: 600; fill: #07111f">${esc(labelName)}</text>
            ${total ? `<text x="140" y="64" style="font-family: 'Crimson Text', Georgia, serif; font-style: italic; font-size: 20px; fill: #07111f">— ${total} ${esc(tr('drops', 'giọt'))}</text>` : ''}
          </g>
        </svg>
        <p>${esc(find.text || tr('An empty bottle under the bench; its label still has the sample the photographer brushed on.', 'Chai rỗng dưới gầm bàn, nhãn còn ô màu mẫu thợ ảnh tự quét.'))}</p>
        <span class="pz-tag mine">${esc(find.tag || tr('YOUR FIND', 'BẠN TÌM THẤY'))}</span>
      </div>
      ${testimony?.text ? `<div class="pz-card s-paper rg-card rg-card-b">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="rg-tv"><span class="g-mono rust" aria-hidden="true">${esc(String(testimony.mono || 'ĐĐ').slice(0, 3))}</span><p>${esc(testimony.text)}<span class="pz-tag partner">${esc(testimony.tag || tr('SHARED · PARTNER', 'ĐÃ CHIA SẺ · ĐỒNG ĐỘI'))}</span></p></div>
      </div>` : ''}
      <div class="pz-card s-paper rg-card rg-card-c">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>${esc(tr('Mixing chart on the wall', 'Bảng pha màu trên tường'))}</h3>
        <div class="rg-wheel">
          <svg viewBox="0 0 92 86" aria-hidden="true">
            <defs>
              <clipPath id="rg-cy"><circle cx="46" cy="30" r="24"></circle></clipPath>
              <clipPath id="rg-cb"><circle cx="32" cy="54" r="24"></circle></clipPath>
              <clipPath id="rg-cr"><circle cx="60" cy="54" r="24"></circle></clipPath>
            </defs>
            <circle cx="46" cy="30" r="24" fill="${css(cube.y)}"></circle>
            <circle cx="32" cy="54" r="24" fill="${css(cube.b)}"></circle>
            <circle cx="60" cy="54" r="24" fill="${css(cube.r)}"></circle>
            <g clip-path="url(#rg-cy)"><circle cx="32" cy="54" r="24" fill="${css(cube.yb)}"></circle><circle cx="60" cy="54" r="24" fill="${css(cube.ry)}"></circle></g>
            <g clip-path="url(#rg-cb)"><circle cx="60" cy="54" r="24" fill="${css(cube.rb)}"></circle></g>
            <g clip-path="url(#rg-cy)"><g clip-path="url(#rg-cb)"><circle cx="60" cy="54" r="24" fill="${css(cube.ryb)}"></circle></g></g>
            <g fill="none" stroke="#2a2318" stroke-width="1"><circle cx="46" cy="30" r="24"></circle><circle cx="32" cy="54" r="24"></circle><circle cx="60" cy="54" r="24"></circle></g>
          </svg>
          <ul>
            <li><i style="background: ${css(cube.yb)}"></i>${esc(tr('YELLOW + BLUE → GREEN', 'VÀNG + LAM → LỤC'))}</li>
            <li><i style="background: ${css(cube.rb)}"></i>${esc(tr('BLUE + RED → VIOLET', 'LAM + ĐỎ → TÍM'))}</li>
            <li><i style="background: ${css(cube.ry)}"></i>${esc(tr('RED + YELLOW → ORANGE', 'ĐỎ + VÀNG → CAM'))}</li>
            <li><i style="background: ${css(cube.ryb)}"></i>${esc(tr('ALL THREE → BROWN', 'CẢ BA → NÂU'))}</li>
          </ul>
        </div>
      </div>
      <div class="rg-keys-row"><p class="rg-keys" aria-hidden="true"><span class="pz-kbd">1</span><span class="pz-kbd">2</span><span class="pz-kbd">3</span><em>${esc(tr('DROP', 'NHỎ GIỌT'))}</em><span class="pz-kbd">⌫</span><em>${esc(tr('POUR OUT', 'ĐỔ BỎ'))}</em><span class="pz-kbd">↵</span><em>${esc(tr('SWEEP', 'QUÉT'))}</em></p></div>
    </aside>
    <section class="rg-room" aria-label="${esc(tr('Mixing bench under the red lamp', 'Bàn pha thuốc dưới đèn đỏ'))}">
      <div class="rg-glow" aria-hidden="true"></div>
      <svg class="rg-lamp" viewBox="0 0 96 132" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="rg-redglass" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#ffb08e"></stop><stop offset=".35" stop-color="#ff3a22"></stop><stop offset=".8" stop-color="#a60e08"></stop><stop offset="1" stop-color="#5a0704"></stop></radialGradient>
          <radialGradient id="rg-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(255,60,36,.55)"></stop><stop offset="1" stop-color="rgba(255,60,36,0)"></stop></radialGradient>
        </defs>
        <path d="M48 0 V46" stroke="#140907" stroke-width="2"></path>
        <circle class="rg-lampcore" cx="48" cy="84" r="46" fill="url(#rg-halo)"></circle>
        <path d="M34 46 H62 L68 56 H28 Z" fill="#2a1712" stroke="#3e231a" stroke-width="1"></path>
        <rect x="22" y="56" width="52" height="50" rx="4" fill="#1e110d" stroke="#43271d" stroke-width="1.5"></rect>
        <rect class="rg-lampcore" x="28" y="62" width="40" height="38" rx="2" fill="url(#rg-redglass)"></rect>
        <path d="M30 64 L40 64 L30 76 Z" fill="rgba(255,220,200,.25)"></path>
        <g class="rg-moth" fill="#1a0806">
          <path d="M56 82 C50 76 44 76 45 81 C46 85 51 86 56 84 Z"></path>
          <path d="M58 82 C64 76 70 76 69 81 C68 85 63 86 58 84 Z"></path>
          <path d="M56 84 C52 88 49 91 51 92 C53 93 56 89 57 86 Z" opacity=".85"></path>
          <path d="M58 84 C62 88 65 91 63 92 C61 93 58 89 57 86 Z" opacity=".85"></path>
          <ellipse cx="57" cy="84" rx="1.6" ry="5"></ellipse>
          <path d="M56.4 79.5 Q54 76 52 75.5 M57.6 79.5 Q60 76 62 75.5" stroke="#1a0806" stroke-width=".7" fill="none"></path>
        </g>
        <rect x="20" y="104" width="56" height="5" rx="2" fill="#2a1712"></rect>
      </svg>
      <div class="rg-bench">
        <div class="rg-blk rg-b1">
          <p class="rg-sign" aria-hidden="true">${esc(tr('DEVELOPING', 'ĐANG TRÁNG ẢNH'))}<br>${esc(tr('NO WHITE LIGHT', 'KHÔNG BẬT ĐÈN TRẮNG'))}</p>
          <svg class="rg-shelf" viewBox="0 0 300 100" aria-hidden="true" focusable="false">
            <rect x="12" y="62" width="82" height="22" rx="1.5" fill="#2a120c" stroke="rgba(255,120,90,.3)" stroke-width="1"></rect>
            <rect x="18" y="42" width="70" height="20" rx="1.5" fill="#341710" stroke="rgba(255,120,90,.3)" stroke-width="1"></rect>
            <rect x="26" y="66" width="60" height="14" fill="#c9a28f" opacity=".75"></rect>
            <text x="56" y="77" text-anchor="middle" style="font-family: 'Source Code Pro', ui-monospace, monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; fill: #2a120c">${esc(tr('PHOTO PAPER', 'GIẤY ẢNH'))}</text>
            <path d="M18 43 H88" stroke="rgba(255,110,80,.45)" stroke-width="1"></path>
            <path d="M112 34 L134 34 L134 40 Q142 44 142 54 L142 80 Q142 84 138 84 L108 84 Q104 84 104 80 L104 54 Q104 44 112 40 Z" fill="rgba(60,18,12,.85)" stroke="rgba(255,140,110,.35)" stroke-width="1"></path>
            <path d="M116 22 Q123 16 130 22 L130 34 L116 34 Z" fill="#3a1a12" stroke="rgba(255,140,110,.35)" stroke-width="1"></path>
            <path d="M106 56 L106 80" stroke="rgba(255,96,70,.55)" stroke-width="1.6"></path>
            <path d="M108 60 L140 60 L140 80 Q140 82 138 82 L110 82 Q108 82 108 80 Z" fill="rgba(20,8,6,.6)"></path>
            <path d="M118 66 q4 -6 8 0 q4 6 8 0" fill="none" stroke="rgba(255,150,120,.25)" stroke-width="1"></path>
            <circle cx="164" cy="70" r="14" fill="rgba(60,18,12,.8)" stroke="rgba(255,140,110,.35)" stroke-width="1"></circle>
            <rect x="159" y="42" width="10" height="16" fill="rgba(60,18,12,.8)" stroke="rgba(255,140,110,.35)" stroke-width="1"></rect>
            <path d="M152 66 Q151 74 155 79" fill="none" stroke="rgba(255,96,70,.55)" stroke-width="1.6"></path>
            <path d="M192 84 Q190 70 202 66 Q214 63 220 72 L244 80 L220 81 Q214 86 204 85 Z" fill="#c9a89a" stroke="#3a1a12" stroke-width="1"></path>
            <circle cx="206" cy="74" r="3.6" fill="#2a120c"></circle>
            <path d="M194 76 Q196 69 203 67" fill="none" stroke="rgba(255,236,224,.5)" stroke-width="1.2"></path>
            <rect x="252" y="30" width="30" height="5" rx="1" fill="#3a1a12"></rect>
            <rect x="252" y="79" width="30" height="5" rx="1" fill="#3a1a12"></rect>
            <path d="M256 35 L278 35 Q278 50 268 57 Q278 64 278 79 L256 79 Q256 64 266 57 Q256 50 256 35 Z" fill="rgba(255,200,180,.08)" stroke="rgba(255,150,128,.45)" stroke-width="1"></path>
            <path d="M259 79 Q267 70 275 79 Z M261 44 L273 44 Q271 52 267 55 Q263 52 261 44 Z" fill="#b07a52"></path>
            <path d="M253 35 V79" stroke="#3a1a12" stroke-width="2"></path>
            <path d="M281 35 V79" stroke="#3a1a12" stroke-width="2"></path>
            <rect x="0" y="84" width="300" height="8" fill="#3a1810"></rect>
            <path d="M0 84.5 H300" stroke="rgba(255,104,78,.55)" stroke-width="1"></path>
            <path d="M26 92 L26 100 L40 92 Z M274 92 L274 100 L260 92 Z" fill="#2a120c"></path>
          </svg>
          <div class="rg-art1">
            <svg class="rg-mix" viewBox="0 0 460 350" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="rg-glassg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="rgba(255,205,192,.2)"></stop><stop offset=".2" stop-color="rgba(255,205,192,.05)"></stop><stop offset=".78" stop-color="rgba(255,90,70,.04)"></stop><stop offset="1" stop-color="rgba(255,96,74,.22)"></stop></linearGradient>
                <linearGradient id="rg-shade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="rgba(0,0,0,.38)"></stop><stop offset=".22" stop-color="rgba(0,0,0,0)"></stop><stop offset=".72" stop-color="rgba(0,0,0,0)"></stop><stop offset="1" stop-color="rgba(0,0,0,.42)"></stop></linearGradient>
                <linearGradient id="rg-rubber" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#160707"></stop><stop offset=".32" stop-color="#4c1813"></stop><stop offset=".62" stop-color="#26100c"></stop><stop offset="1" stop-color="#0c0404"></stop></linearGradient>
                <linearGradient id="rg-lblight" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgba(255,252,244,0)"></stop><stop offset="1" stop-color="rgba(255,252,244,.3)"></stop></linearGradient>
                <linearGradient id="rg-liqlight" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgba(255,252,244,0)"></stop><stop offset="1" stop-color="rgba(255,252,244,.13)"></stop></linearGradient>
                <radialGradient id="rg-lbglow" cx=".5" cy="1" r="1"><stop offset="0" stop-color="rgba(255,248,236,.42)"></stop><stop offset=".55" stop-color="rgba(255,248,236,.08)"></stop><stop offset="1" stop-color="rgba(255,248,236,0)"></stop></radialGradient>
                <radialGradient id="rg-cloudg" cx=".5" cy=".3" r=".5"><stop offset="0" data-rg-hitstop style="stop-opacity: .9"></stop><stop offset="1" data-rg-hitstop style="stop-opacity: 0"></stop></radialGradient>
                <clipPath id="rg-bkin"><path d="M312 204 L312 296 Q312 306 322 306 L394 306 Q404 306 404 296 L404 204 Z"></path></clipPath>
              </defs>
              <path d="M262 308 Q262 196 358 190 Q454 196 454 308 Z" fill="url(#rg-lbglow)"></path>
              ${bottle('y')}${bottle('b')}${bottle('r')}
              <g>
                <ellipse cx="438" cy="341" rx="22" ry="4" fill="rgba(0,0,0,.55)"></ellipse>
                <path d="M426 296 Q426 290 431 289 L445 289 Q450 290 450 296 L452 332 Q452 340 444 340 L432 340 Q424 340 424 332 Z" fill="rgba(52,18,10,.78)" stroke="rgba(255,150,128,.3)" stroke-width="1.1"></path>
                <path d="M427 312 L449 312 L450 332 Q450 338 444 338 L432 338 Q426 338 426 332 Z" fill="rgba(20,12,8,.85)"></path>
                <path d="M429 298 Q428 316 429 334" fill="none" stroke="rgba(255,208,192,.32)" stroke-width="2" stroke-linecap="round"></path>
                <path d="M420 262 L456 262 L442 280 L442 292 L434 292 L434 280 Z" fill="#34211b" stroke="rgba(255,150,128,.35)" stroke-width="1.1"></path>
                <ellipse cx="438" cy="262" rx="18" ry="3" fill="#120806" stroke="rgba(255,150,128,.4)" stroke-width="1"></ellipse>
                <ellipse class="rg-fsplash" data-rg-fsplash cx="438" cy="261" rx="12" ry="3.5"></ellipse>
              </g>
              <g>
                <ellipse cx="358" cy="342" rx="70" ry="5" fill="rgba(0,0,0,.6)"></ellipse>
                <rect x="296" y="314" width="124" height="26" rx="2" fill="#2b130d" stroke="rgba(255,140,110,.3)" stroke-width="1"></rect>
                <rect x="300" y="317" width="116" height="20" rx="1" fill="none" stroke="rgba(199,162,75,.5)" stroke-width="1"></rect>
                <path d="M300 308 L416 308 L420 314 L296 314 Z" fill="#f4eee4"></path>
                <path d="M300 308 L416 308 L420 314 L296 314 Z" fill="url(#rg-lblight)"></path>
              </g>
              <g class="rg-puddle" data-rg-puddle>
                <ellipse cx="358" cy="311" rx="68" ry="4.6" stroke="none"></ellipse>
                <path d="M298 312 Q296 322 299 334" fill="none" stroke-width="3.4" stroke-linecap="round"></path>
                <path d="M417 312 Q421 320 418 328" fill="none" stroke-width="3" stroke-linecap="round"></path>
                <ellipse cx="358" cy="310" rx="40" ry="1.4" fill="rgba(255,255,255,.35)" stroke="none"></ellipse>
              </g>
              <g class="rg-bk" data-rg-bk>
                <ellipse cx="358" cy="309" rx="50" ry="3" fill="rgba(255,250,240,.35)"></ellipse>
                <path d="M308 206 L308 298 Q308 310 320 310 L396 310 Q408 310 408 298 L408 206 Z" fill="url(#rg-glassg)"></path>
                <g clip-path="url(#rg-bkin)">
                  <g class="rg-pliq">
                    <g class="rg-lvl" data-rg-lvl>
                      <rect class="rg-liq" data-rg-liq x="240" y="0" width="236" height="250"></rect>
                      <rect class="rg-shd" x="312" y="0" width="92" height="250" fill="url(#rg-shade)"></rect>
                      <ellipse class="rg-cloud" data-rg-cloud cx="358" cy="2" rx="30" ry="34" fill="url(#rg-cloudg)"></ellipse>
                      <g class="rg-swirl" data-rg-swirl>
                        <path pathLength="1" d="M358 2 C350 12 338 16 340 30 C342 44 360 42 356 56 C352 70 336 72 340 88"></path>
                        <path pathLength="1" d="M360 2 C368 14 382 20 378 36 C374 50 356 48 362 64"></path>
                        <path pathLength="1" d="M357 4 C356 20 366 30 354 42 C346 50 338 46 342 38"></path>
                      </g>
                      <ellipse class="rg-surf" data-rg-surf cx="358" cy="0" rx="46" ry="4.4"></ellipse>
                      <g class="rg-rip" data-rg-rip><ellipse cx="358" cy="0" rx="44" ry="4.2"></ellipse><ellipse cx="358" cy="0" rx="44" ry="4.2"></ellipse></g>
                      <g class="rg-crown" data-rg-crown>
                        <circle cx="358" cy="0" r="2.2" style="--dx: -13px; --dy: -15px"></circle>
                        <circle cx="358" cy="0" r="1.8" style="--dx: -6px; --dy: -21px"></circle>
                        <circle cx="358" cy="0" r="2.6" style="--dx: 0px; --dy: -27px"></circle>
                        <circle cx="358" cy="0" r="1.8" style="--dx: 7px; --dy: -20px"></circle>
                        <circle cx="358" cy="0" r="2.2" style="--dx: 14px; --dy: -14px"></circle>
                      </g>
                    </g>
                  </g>
                  <rect x="312" y="262" width="92" height="44" fill="url(#rg-liqlight)"></rect>
                </g>
                <ellipse cx="358" cy="206" rx="50" ry="5.5" fill="none" stroke="rgba(255,214,200,.55)" stroke-width="1.4"></ellipse>
                <path d="M308 206 L308 298 Q308 310 320 310 L396 310 Q408 310 408 298 L408 206" fill="none" stroke="rgba(255,206,192,.6)" stroke-width="1.6"></path>
                <path d="M404 205 Q412 202 417 196 Q410 199 404 200" fill="rgba(255,214,200,.25)" stroke="rgba(255,214,200,.6)" stroke-width="1.2"></path>
                <path d="M316 214 L316 294" stroke="rgba(255,240,232,.32)" stroke-width="4" stroke-linecap="round"></path>
                <path d="M403 214 Q405 260 402 300" fill="none" stroke="rgba(255,76,54,.6)" stroke-width="1.5"></path>
                <g stroke="rgba(255,236,228,.62)" stroke-width="1.1"><path d="M322 295 H330 M322 284 H336 M322 273 H330 M322 262 H336 M322 251 H330 M322 240 H336 M322 229 H330 M322 218 H340"></path></g>
                <text x="344" y="221.5" style="font-family: 'Source Code Pro', ui-monospace, monospace; font-size: 9px; font-weight: 700; fill: rgba(255,236,228,.75)">${MAX}</text>
                <g class="rg-spill" data-rg-spill>
                  <path class="rg-bulge" d="M309 207 Q358 188 407 207 Q358 213 309 207 Z" stroke="none"></path>
                  <path class="rg-run" pathLength="1" d="M310 208 Q303 238 309 262 Q313 286 308 309"></path>
                  <path class="rg-run" pathLength="1" d="M406 208 Q414 236 408 260 Q403 284 409 309"></path>
                  <path class="rg-run" pathLength="1" d="M416 197 Q422 216 417 240"></path>
                  <circle class="rg-drip" cx="417" cy="243" r="3.2" stroke="none"></circle>
                  <circle class="rg-drip" cx="309" cy="268" r="2.6" stroke="none"></circle>
                </g>
              </g>
              <path class="rg-stream" data-rg-stream pathLength="1" d="M438 228 Q440 246 438 262"></path>
              ${dropper('y')}${dropper('b')}${dropper('r')}
              <g transform="translate(${BEAKER_X} ${TIP_Y})">
                <g class="rg-drop" data-rg-drop>
                  <path data-rg-dropfill d="M0 0 C2.6 3.2 5 6.4 5 9.2 A5 5 0 0 1 -5 9.2 C-5 6.4 -2.6 3.2 0 0 Z"></path>
                  <ellipse cx="-1.8" cy="8" rx="1.2" ry="1.8" fill="rgba(255,255,255,.55)"></ellipse>
                </g>
              </g>
            </svg>
            ${btn('y')}${btn('b')}${btn('r')}
            <span class="rg-total" data-rg-total aria-hidden="true"></span>
            <p class="s-sr" data-rg-sum></p>
            <button type="button" class="s-btn s-btn-gold rg-pourbtn" aria-disabled="true" data-rg-pour>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6 L13 6 L12 16 L5 16 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" transform="rotate(28 8.5 11)"></path><path d="M15.5 9 Q16.5 12 15.5 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>
              ${esc(tr('Pour out', 'Đổ bỏ'))}
            </button>
          </div>
          <div class="rg-front" aria-hidden="true"></div>
        </div>
        <div class="rg-blk rg-b2">
          <div class="rg-art2">
            <svg class="rg-film" viewBox="0 0 44 196" aria-hidden="true" focusable="false">
              <circle cx="22" cy="4" r="3" fill="#7a5a3a"></circle>
              <rect x="17" y="5" width="10" height="22" rx="2" fill="#7a3a26"></rect>
              <path d="M22 6 V26" stroke="rgba(0,0,0,.4)" stroke-width="1"></path>
              <circle cx="22" cy="14" r="2.6" fill="none" stroke="#b9a497" stroke-width="1.1"></circle>
              <rect x="6" y="18" width="32" height="176" fill="#2e1309"></rect>
              <g fill="#a1622f" opacity=".55">${Array.from({ length: 17 }, (_, i) => `<rect x="8" y="${24 + i * 10}" width="3" height="5"></rect><rect x="33" y="${24 + i * 10}" width="3" height="5"></rect>`).join('')}</g>
              <g fill="#b97a44"><rect x="13" y="24" width="18" height="38"></rect><rect x="13" y="66" width="18" height="38"></rect><rect x="13" y="108" width="18" height="38"></rect><rect x="13" y="150" width="18" height="38"></rect></g>
              <g fill="#3a1a0c" stroke="#3a1a0c">
                <path d="M13 50 H31 V62 H13 Z M16 50 V40 M22 50 V38 M28 50 V41" stroke-width="1.4"></path>
                <path d="M15 92 Q22 98 29 92 L27 96 Q22 99 17 96 Z M22 92 V80 L27 88 Z" stroke-width=".8"></path>
                <circle cx="25" cy="116" r="3.2" stroke="none"></circle>
                <path d="M18 146 V124 M15 124 H21" stroke-width="1.4" fill="none"></path>
                <path d="M13 176 Q22 172 31 176 V188 H13 Z" stroke="none" opacity=".7"></path>
              </g>
            </svg>
            <div class="rg-dock">
              <div class="rg-sw">
                <span class="s-pin gold" aria-hidden="true" style="top: -7px; left: 50%; margin-left: -9px; width: 14px; height: 14px"></span>
                <span class="rg-sw-k">${esc(tr('SAMPLE', 'MẪU MÀU'))}</span>
                <div class="rg-sw-row">
                  <figure><span class="rg-chip" style="background: ${targetCss}" aria-hidden="true"></span><figcaption>${esc(tr('SAMPLE', 'MẪU'))}</figcaption></figure>
                  <figure><span class="rg-chip cup empty" data-rg-cupchip aria-hidden="true"></span><figcaption>${esc(tr('CUP', 'CỐC'))}</figcaption></figure>
                </div>
                <span class="rg-sw-name">${esc(targetName)}</span>
              </div>
              <span class="rg-clip" aria-hidden="true"></span>
              <span class="rg-arm" aria-hidden="true"></span>
              <div class="rg-meter" role="img" data-rg-meter>
                <span class="rg-meter-plate" aria-hidden="true">${esc(tr('COLOUR DEVIATION', 'ĐỘ LỆCH MÀU'))}</span>
                <svg class="rg-dial" viewBox="0 0 130 84" aria-hidden="true" focusable="false">
                  <path d="M17.51 46.32A56 56 0 0 1 59.15 20.31L59.77 26.27A50 50 0 0 0 22.6 49.5Z" fill="rgba(52,92,150,.3)"></path>
                  <path d="M70.85 20.31A56 56 0 0 1 112.49 46.32L107.4 49.5A50 50 0 0 0 70.23 26.27Z" fill="rgba(200,104,34,.32)"></path>
                  <path d="M59.15 20.31A56 56 0 0 1 70.85 20.31L69.81 30.25A46 46 0 0 0 60.19 30.25Z" fill="#3b9a5a"></path>
                  <path d="M16.07 47.75A56.5 56.5 0 0 1 113.93 47.75L113.06 48.25A55.5 55.5 0 0 0 16.94 48.25Z" fill="#3b2414"></path>
                  <path d="M27.69 52.68L19.21 47.38M26.58 47.22L21.78 43.63M29.14 44.09L24.66 40.1M31.96 41.18L27.83 36.83M37.51 41.65L31.26 33.84M38.27 36.13L34.93 31.14M41.73 34.02L38.82 28.77M45.35 32.21L42.89 26.73M50.43 34.48L47.12 25.05M52.98 29.53L51.48 23.72M56.94 28.68L55.93 22.77M60.96 28.17L60.45 22.19M65 32L65 22M69.04 28.17L69.55 22.19M73.06 28.68L74.07 22.77M77.02 29.53L78.52 23.72M79.57 34.48L82.88 25.05M84.65 32.21L87.11 26.73M88.27 34.02L91.18 28.77M91.73 36.13L95.07 31.14M92.49 41.65L98.74 33.84M98.04 41.18L102.17 36.83M100.86 44.09L105.34 40.1M103.42 47.22L108.22 43.63M102.31 52.68L110.79 47.38" stroke="#3b2414" stroke-width="1.1"></path>
                  <text class="rg-dial-t" x="27" y="73">${esc(tr('COLD', 'LẠNH'))}</text>
                  <text class="rg-dial-t" x="104" y="73">${esc(tr('WARM', 'ẤM'))}</text>
                  <text class="rg-dial-t ok" x="65" y="16">${esc(tr('MATCH', 'KHỚP'))}</text>
                  <circle cx="20.9" cy="52.5" r="2.2" fill="#6b4a1e"></circle>
                  <g class="rg-needle" data-rg-needle>
                    <g class="rg-needle-in">
                      <path d="M63.6 76 L64.6 24 L65 21 L65.4 24 L66.4 76 Z" fill="#1c0e08"></path>
                      <path d="M64.7 30 L65 21 L65.3 30 Z" fill="#c0331f"></path>
                    </g>
                  </g>
                  <circle cx="65" cy="76" r="6" fill="#b98a44" stroke="#4e3418" stroke-width="1"></circle>
                  <circle cx="63.6" cy="74.6" r="1.8" fill="rgba(255,240,200,.7)"></circle>
                  <path d="M9 50 Q16 30 36 18" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="4" stroke-linecap="round"></path>
                </svg>
                <div class="rg-read" aria-hidden="true"><i class="rg-jewel" data-rg-jewel></i><span><b data-rg-readbig>—</b><small data-rg-readsmall></small></span></div>
              </div>
            </div>
          </div>
          <div class="rg-front" aria-hidden="true"><span class="rg-drawer"></span></div>
        </div>
        <div class="rg-blk rg-b3">
          <div class="rg-art3">
            <svg class="rg-letter" viewBox="0 0 224 560" role="img" focusable="false" data-rg-letter>
              <defs>
                <clipPath id="rg-paperclip"><rect x="16" y="30" width="192" height="270"></rect></clipPath>
                <linearGradient id="rg-paperg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#efd6c8"></stop><stop offset=".55" stop-color="#e8cbbb"></stop><stop offset="1" stop-color="#dcb9a8"></stop></linearGradient>
                <radialGradient id="rg-soft" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"></stop><stop offset=".62" stop-color="#fff"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop></radialGradient>
                <radialGradient id="rg-stA" cx="0" cy="1" r="1.2"><stop offset="0" stop-color="rgba(160,104,46,.3)"></stop><stop offset=".55" stop-color="rgba(150,92,40,.24)"></stop><stop offset=".86" stop-color="rgba(126,70,30,.42)"></stop><stop offset="1" stop-color="rgba(96,46,18,.7)"></stop></radialGradient>
                <radialGradient id="rg-stB" cx="1" cy="0" r="1.2"><stop offset="0" stop-color="rgba(160,104,46,.3)"></stop><stop offset=".55" stop-color="rgba(150,92,40,.24)"></stop><stop offset=".86" stop-color="rgba(126,70,30,.42)"></stop><stop offset="1" stop-color="rgba(96,46,18,.7)"></stop></radialGradient>
                <radialGradient id="rg-stC" cx="1" cy="1" r="1.2"><stop offset="0" stop-color="rgba(160,104,46,.3)"></stop><stop offset=".55" stop-color="rgba(150,92,40,.24)"></stop><stop offset=".86" stop-color="rgba(126,70,30,.42)"></stop><stop offset="1" stop-color="rgba(96,46,18,.7)"></stop></radialGradient>
                <mask id="rg-inkmask" maskUnits="userSpaceOnUse" x="0" y="0" width="224" height="320">
                  <g class="rg-ink" data-rg-ink>
                    ${[[60, 92, 58, 0.32], [122, 96, 56, 0.4], [184, 92, 56, 0.48], [184, 138, 56, 0.58], [122, 140, 56, 0.66], [60, 138, 58, 0.75], [60, 182, 58, 0.91], [122, 180, 56, 0.99], [184, 182, 56, 1.07], [184, 224, 56, 1.18], [122, 226, 56, 1.26], [60, 224, 58, 1.34]]
                      .map(([cx, cy, r, d]) => `<circle class="rg-bl" style="--d: ${d}s" cx="${cx}" cy="${cy}" r="${r}" fill="url(#rg-soft)"></circle>`).join('')}
                  </g>
                </mask>
              </defs>
              <g transform="translate(0 64)">
                <path d="M8 22 Q112 40 216 22" fill="none" stroke="#a77b67" stroke-width="1.4"></path>
                <circle cx="8" cy="22" r="3.6" fill="#6e4a2c" stroke="#2a160c" stroke-width="1"></circle>
                <circle cx="216" cy="22" r="3.6" fill="#6e4a2c" stroke="#2a160c" stroke-width="1"></circle>
                <g class="rg-paper" data-rg-paper>
                  <rect x="21" y="37" width="192" height="270" fill="rgba(0,0,0,.42)"></rect>
                  <rect x="16" y="30" width="192" height="270" fill="url(#rg-paperg)"></rect>
                  <path d="M16 118 H208" stroke="rgba(110,50,40,.2)" stroke-width="1.2"></path>
                  <path d="M16 119.6 H208" stroke="rgba(255,240,232,.4)" stroke-width="1"></path>
                  <path d="M16 206 H208" stroke="rgba(110,50,40,.2)" stroke-width="1.2"></path>
                  <path d="M16 207.6 H208" stroke="rgba(255,240,232,.4)" stroke-width="1"></path>
                  <path d="M30 60 Q80 58 120 61 M40 250 Q100 247 170 251 M60 286 Q120 284 190 287" fill="none" stroke="rgba(150,90,70,.1)" stroke-width="1"></path>
                  <rect x="16" y="30" width="192" height="270" fill="none" stroke="rgba(110,50,40,.3)" stroke-width="1"></rect>
                  <g clip-path="url(#rg-paperclip)">
                    <path class="rg-trail" data-rg-trail pathLength="1" d="M30 92 H194 C214 92 214 138 194 138 H30 C10 138 10 180 30 180 H194 C214 180 214 222 194 222 H30"></path>
                    <g class="rg-stains" data-rg-stains>
                      <g class="rg-st rg-st-a" data-rg-st="1" style="--d: 2.45s"><path d="M8 222 C22 220 34 228 42 236 C54 246 66 254 62 270 C58 282 66 294 58 308 L8 308 Z" fill="url(#rg-stA)" stroke="rgba(84,38,12,.62)" stroke-width="1.8"></path><path d="M8 222 C22 220 34 228 42 236 C54 246 66 254 62 270 C58 282 66 294 58 308 L8 308 Z" transform="translate(8 308) scale(.68) translate(-8 -308)" fill="none" stroke="rgba(110,58,22,.32)" stroke-width="1.6"></path><path d="M8 222 C22 220 34 228 42 236 C54 246 66 254 62 270 C58 282 66 294 58 308 L8 308 Z" transform="translate(8 308) scale(.4) translate(-8 -308)" fill="rgba(120,70,30,.12)" stroke="none"></path></g>
                      <g class="rg-st rg-st-b" data-rg-st="2" style="--d: .85s"><path d="M216 22 L216 98 C204 102 192 96 184 86 C174 76 162 70 166 56 C168 46 160 36 168 22 Z" fill="url(#rg-stB)" stroke="rgba(84,38,12,.62)" stroke-width="1.8"></path><path d="M216 22 L216 98 C204 102 192 96 184 86 C174 76 162 70 166 56 C168 46 160 36 168 22 Z" transform="translate(216 22) scale(.68) translate(-216 -22)" fill="none" stroke="rgba(110,58,22,.32)" stroke-width="1.6"></path><path d="M216 22 L216 98 C204 102 192 96 184 86 C174 76 162 70 166 56 C168 46 160 36 168 22 Z" transform="translate(216 22) scale(.4) translate(-216 -22)" fill="rgba(120,70,30,.12)" stroke="none"></path></g>
                      <g class="rg-st rg-st-c" data-rg-st="3" style="--d: 2.25s"><path d="M216 308 L146 308 C148 296 142 286 152 276 C162 266 172 258 186 254 C198 250 208 240 216 234 Z" fill="url(#rg-stC)" stroke="rgba(84,38,12,.62)" stroke-width="1.8"></path><path d="M216 308 L146 308 C148 296 142 286 152 276 C162 266 172 258 186 254 C198 250 208 240 216 234 Z" transform="translate(216 308) scale(.68) translate(-216 -308)" fill="none" stroke="rgba(110,58,22,.32)" stroke-width="1.6"></path><path d="M216 308 L146 308 C148 296 142 286 152 276 C162 266 172 258 186 254 C198 250 208 240 216 234 Z" transform="translate(216 308) scale(.4) translate(-216 -308)" fill="rgba(120,70,30,.12)" stroke="none"></path></g>
                    </g>
                    <g class="rg-ink" data-rg-inktext mask="url(#rg-inkmask)"></g>
                  </g>
                </g>
                <g transform="translate(62 29)"><rect x="-5" y="-11" width="10" height="34" rx="2" fill="#8c4a30" stroke="#3a180c" stroke-width="1"></rect><path d="M0 -10 V22" stroke="rgba(30,10,4,.55)" stroke-width="1"></path><circle cx="0" cy="3" r="3.4" fill="none" stroke="#c9b0a2" stroke-width="1.2"></circle><path d="M-3.4 -8 V18" stroke="rgba(255,190,160,.3)" stroke-width="1"></path></g>
                <g transform="translate(162 29)"><rect x="-5" y="-11" width="10" height="34" rx="2" fill="#8c4a30" stroke="#3a180c" stroke-width="1"></rect><path d="M0 -10 V22" stroke="rgba(30,10,4,.55)" stroke-width="1"></path><circle cx="0" cy="3" r="3.4" fill="none" stroke="#c9b0a2" stroke-width="1.2"></circle><path d="M-3.4 -8 V18" stroke="rgba(255,190,160,.3)" stroke-width="1"></path></g>
              </g>
              <ellipse cx="178" cy="551" rx="32" ry="4.5" fill="rgba(0,0,0,.55)"></ellipse>
              <path d="M152 476 L152 540 Q152 550 162 550 L194 550 Q204 550 204 540 L204 476 Z" fill="rgba(255,190,170,.07)"></path>
              <path d="M154 504 L202 504 L202 540 Q202 548 194 548 L162 548 Q154 548 154 540 Z" fill="rgba(255,150,128,.12)"></path>
              <g class="rg-brush" data-rg-brush>
                <path d="M-5.5 -50 L-4 -178 Q0 -187 4 -178 L5.5 -50 Z" fill="#6e2c1c" stroke="#2a0e08" stroke-width="1"></path>
                <path d="M-2.4 -60 L-1.5 -172" stroke="rgba(255,150,120,.38)" stroke-width="1.6" stroke-linecap="round"></path>
                <path d="M-20 -50 L20 -50 L19 -30 L-19 -30 Z" fill="#b5773a" stroke="#4a2a0e" stroke-width="1"></path>
                <path d="M-19.5 -45 H19.5 M-19.2 -36 H19.2" stroke="rgba(60,30,8,.5)" stroke-width="1"></path>
                <path d="M-19 -30 L19 -30 L21 -6 Q20 0 0 1 Q-20 0 -21 -6 Z" fill="#2f1610" stroke="#160806" stroke-width="1"></path>
                <path data-rg-tint d="M-20.4 -13 L20.4 -13 L21 -6 Q20 0 0 1 Q-20 0 -21 -6 Z" fill="#2f1610"></path>
                <path d="M-12 -28 L-13 -2 M-4 -28 L-4.4 0 M4 -28 L4.4 0 M12 -28 L13 -2" stroke="rgba(255,140,110,.16)" stroke-width="1"></path>
              </g>
              <path d="M152 476 L152 540 Q152 550 162 550 L194 550 Q204 550 204 540 L204 476" fill="none" stroke="rgba(255,206,192,.55)" stroke-width="1.5"></path>
              <ellipse cx="178" cy="476" rx="26" ry="4" fill="none" stroke="rgba(255,206,192,.55)" stroke-width="1.3"></ellipse>
              <path d="M158 484 L158 540" stroke="rgba(255,240,232,.28)" stroke-width="3" stroke-linecap="round"></path>
              <path d="M154 504 Q178 507 202 504" fill="none" stroke="rgba(255,206,192,.35)" stroke-width="1"></path>
            </svg>
          </div>
          <div class="rg-front">
            <button type="button" class="s-btn s-btn-red rg-sweepbtn" aria-disabled="true" data-rg-sweep>${esc(tr('Sweep over the letter', 'Quét lên thư'))}</button>
          </div>
        </div>
      </div>
    </section>`;
  body.appendChild(root);

  const $ = <T extends Element>(q2: string) => root.querySelector<T>(q2)!;
  const bts: Record<Key, HTMLButtonElement> = { y: $('[data-rg-bt="y"]'), b: $('[data-rg-bt="b"]'), r: $('[data-rg-bt="r"]') };
  const pourBtn = $<HTMLButtonElement>('[data-rg-pour]');
  const sweepBtn = $<HTMLButtonElement>('[data-rg-sweep]');
  const sheet = body.closest<HTMLElement>('.pz-sheet') ?? body;
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };

  // ---- letter text (only in the reveal) ----
  function letterLines(): string[] {
    const reveal = ctx.reveal ?? {};
    if (Array.isArray(reveal.letter) && reveal.letter.length) return reveal.letter.slice(0, 4).map(String);
    const text = String(reveal.text ?? '').trim();
    if (!text) return [];
    const out: string[] = [];
    let line = '';
    text.split(/\s+/).forEach((word) => {
      if ((line + ' ' + word).trim().length > 18 && line) { out.push(line); line = word; } else line = (line + ' ' + word).trim();
    });
    if (line) out.push(line);
    return out.slice(0, 4);
  }
  let inkWritten = false;
  function writeInk() {
    const lines = letterLines();
    if (!lines.length || inkWritten) return;
    inkWritten = true;
    const xs = [28, 44, 30, 60];
    const ys = [100, 142, 184, 225];
    const text = (cls: string) => lines.map((line, i) => {
      const avail = 206 - xs[i] - 26;
      const size = Math.max(14, Math.min(23, Math.floor((23 * avail) / Math.max(1, line.length * 10.2))));
      return `<text transform="translate(${xs[i]} ${ys[i]}) skewX(22)" style="font-size: ${size}px">${esc(line)}</text>`;
    }).join('');
    $('[data-rg-inktext]').innerHTML = `
      <g class="rg-ink-halo" style="font-family: 'Crimson Text', Georgia, serif; font-style: italic; fill: none; stroke: rgba(70,22,30,.42); stroke-width: 2.4">${text('h')}</g>
      <g style="font-family: 'Crimson Text', Georgia, serif; font-style: italic; font-weight: 600; fill: #2a0f16">${text('t')}</g>
      ${lines.length > 1 ? '<path d="M50 150 Q90 146 132 151" fill="none" stroke="#2a0f16" stroke-width="1.4" stroke-linecap="round"></path>' : ''}`;
  }

  // ---- droppers: queue of squeezes, one droplet at a time ----
  function squeeze(k: Key) {
    if (solved || sweeping || pourK || pourWait || submitting) return;
    if (spilled) { msg = M.spillWait; render(); return; }
    const inFlight = q.length + (fly ? 1 : 0);
    if (drops.length + inFlight >= MAX + 1) return;
    if (reduced()) { impact(k, false); return; }
    q.push(k);
    if (!fly) next();
    else if (!busy) { busy = true; render(); }
  }
  function move(j: Key, steps: [string, number][]) {
    tok[j] += 1;
    const t = tok[j];
    steps.forEach(([pos, at]) => {
      const f = () => { if (tok[j] !== t) return; dp = { ...dp, [j]: pos }; render(); };
      if (at <= 0) f(); else later(at, f);
    });
  }
  function goHome(j: Key) { if (away === j) away = null; move(j, [['up', 0], ['home', 330]]); }
  function next() {
    if (!q.length) {
      fly = null;
      if (pourWait) { pourWait = false; startPour(); return; }
      busy = false;
      render();
      const j = away;
      if (j) { const t = tok[j]; later(520, () => { if (fly || q.length || tok[j] !== t || away !== j) return; goHome(j); }); }
      return;
    }
    const k = q.shift()!;
    fly = k;
    if (!busy) { busy = true; render(); }
    let t = 0;
    if (away !== k) {
      if (away) goHome(away);
      move(k, [['up', 0], ['over', 300]]);
      away = k;
      t = 650;
    }
    later(t, () => dropFrom(k));
  }
  function dropFrom(k: Key) {
    sq = { ...sq, [k]: sq[k] === 'a' ? 'b' : 'a' };
    dropK = dropK === 'a' ? 'b' : 'a';
    dropC = css(R[k].rgb);
    dropFall = surfY(drops.length) - TIP_Y - 16;
    render();
    later(450, () => { impact(k, true); later(170, next); });
  }
  function impact(k: Key, isLive: boolean) {
    drops = drops.concat(k);
    msg = dropMsg(drops);
    if (isLive) { hitK = hitK === 'a' ? 'b' : 'a'; hitC = css(R[k].rgb); }
    if (drops.length > MAX) { spilled = true; spillLive = isLive; msg = M.spill; }
    render();
  }

  // ---- pour out ----
  function pour() {
    if (solved || sweeping || pourK || pourWait || submitting) return;
    if (!drops.length && !q.length && !fly) { msg = M.emptyPour; render(); return; }
    if (fly || q.length) { q = []; pourWait = true; msg = M.pourWait; render(); return; }
    startPour();
  }
  function startPour() {
    if (away) goHome(away);
    if (reduced()) { finishPour(); return; }
    pourK = 'on';
    pourWait = false;
    busy = true;
    msg = M.pouring;
    render();
    later(1720, finishPour);
  }
  function finishPour() {
    pourWait = false;
    drops = [];
    spilled = false;
    spillLive = false;
    pourK = '';
    instant = true;
    busy = false;
    hitK = '';
    msg = M.poured;
    render();
    later(90, () => { instant = false; render(); });
  }

  // ---- brush the reagent over the letter (the server judges) ----
  function sweep() {
    if (solved || sweeping || pourK || pourWait || submitting) return;
    if (fly || q.length) { msg = M.wait; render(); return; }
    if (!drops.length) { msg = M.emptySweep; render(); return; }
    if (spilled) { msg = M.spillWait; render(); return; }
    const c = count(drops);
    submitting = true;
    if (!reduced()) { sweeping = true; sweepK = sweepK === 'a' ? 'b' : 'a'; msg = M.sweeping; }
    render();
    ctx.submit({ drops: { y: c.y, b: c.b, r: c.r } })
      .then((result) => {
        submitting = false;
        if (!alive) return;
        if (result.solved) { reveal(true); return; }
        if (result.feedback?.reason === 'invalid') {
          sweeping = false;
          msg = { kick: tr('NOT SWEPT', 'CHƯA QUÉT'), text: result.message || tr('The cup could not be used.', 'Không dùng được cốc thuốc này.'), tone: 'bad' };
          render();
          return;
        }
        localStains += 1; // the run's attempts (shared with the partner) may already count this sweep
        const badMsg = stains() > 1 ? M.bad2 : M.bad1;
        if (reduced()) { stainLive = false; sweeping = false; msg = badMsg; render(); return; }
        stainLive = true;
        render();
        later(stains() === 2 ? 1000 : 2400, () => { msg = badMsg; render(); });
        later(3250, () => { sweeping = false; render(); });
      })
      .catch((error) => {
        submitting = false;
        sweeping = false;
        if (!alive) return;
        msg = { kick: tr('NOT SENT', 'CHƯA GỬI'), text: error?.message || tr('Could not reach the server.', 'Không gửi được tới máy chủ.'), tone: 'bad' };
        render();
      });
  }
  function reveal(isLive: boolean) {
    solved = true;
    revealed = true;
    writeInk();
    const final = letterLines().join(' ');
    const solvedMsg: Msg = { kick: tr('INK REVEALED', 'MỰC ĐÃ HIỆN'), text: final ? `‘${final}’` : tr('The hidden writing is legible.', 'Nét chữ ẩn đã đọc được.'), tone: 'ok' };
    if (!isLive || reduced()) { revealLive = false; sweeping = false; msg = solvedMsg; render(); return; }
    revealLive = true;
    msg = M.revealing;
    render();
    later(2000, () => { msg = solvedMsg; render(); });
    later(3250, () => { sweeping = false; render(); });
  }

  function onKey(e: KeyboardEvent) {
    const k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey || solved) return;
    const target = e.target as HTMLElement;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const map: Record<string, Key> = { 1: 'y', 2: 'b', 3: 'r' };
    if (map[k]) { e.preventDefault(); squeeze(map[k]); return; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); pour(); return; }
    if (k === 'Enter') {
      const tag = (target?.tagName || '').toUpperCase();
      if (tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      sweep();
    }
  }

  // ---- view ----
  let lastStatus = '';
  function render() {
    if (!alive) return;
    root.classList.toggle('rg-rm', reduced());
    const n = drops.length;
    const c = count(drops);
    const d = dev(c);
    const match = !!d && d.dE < tolerance && !spilled;
    const isBusy = busy || pourWait;
    const pouring = !!pourK;
    const mix: Rgb = d ? d.rgb : [222, 206, 196];
    const mixColor = css(mix);
    const lock = solved || sweeping || pouring || pourWait || spilled || submitting;
    KEYS.forEach((k) => {
      const pos = dp[k] || 'home';
      const x = pos === 'over' ? BEAKER_X - BX[k] : 0;
      const y = pos === 'over' ? -98 : pos === 'up' ? -146 : 0;
      ($(`[data-rg-dp="${k}"]`) as SVGGElement).style.transform = `translate(${x}px, ${y}px)`;
      setCls($(`[data-rg-bulb="${k}"]`), 'rg-bulb' + (sq[k] ? ` sq-${sq[k]}` : ''));
      setCls(bts[k], `rg-bt rg-bt-${k}` + (lock ? ' off' : ''));
      bts[k].setAttribute('aria-disabled', lock ? 'true' : 'false');
      bts[k].setAttribute('aria-label', tr(`${R[k].low} bottle — add one drop (key ${R[k].n}). ${c[k]} drop(s) so far.`, `Lọ ${R[k].low} — nhỏ một giọt vào cốc (phím ${R[k].n}). Đã nhỏ ${c[k]} giọt.`));
      $(`[data-rg-n="${k}"]`).textContent = String(c[k]);
    });
    const drop = $<SVGGElement>('[data-rg-drop]');
    setCls(drop, 'rg-drop' + (dropK ? ` d-${dropK}` : ''));
    drop.style.setProperty('--fall', `${dropFall}px`);
    $('[data-rg-dropfill]').setAttribute('fill', dropC);
    root.querySelectorAll<SVGStopElement>('[data-rg-hitstop]').forEach((stop) => { stop.style.stopColor = hitC; });
    setCls($('[data-rg-rip]'), 'rg-rip' + (hitK ? ` h-${hitK}` : ''));
    const crown = $<SVGGElement>('[data-rg-crown]');
    setCls(crown, 'rg-crown' + (hitK ? ` h-${hitK}` : ''));
    crown.style.fill = hitC;
    const swirl = $<SVGGElement>('[data-rg-swirl]');
    setCls(swirl, 'rg-swirl' + (hitK ? ` h-${hitK}` : ''));
    swirl.style.stroke = hitC;
    setCls($('[data-rg-cloud]'), 'rg-cloud' + (hitK ? ` h-${hitK}` : ''));
    ($('[data-rg-lvl]') as SVGGElement).style.transform = `translateY(${n ? surfY(n) : BOTTOM + 8}px)`;
    ($('[data-rg-liq]') as SVGRectElement).style.fill = mixColor;
    ($('[data-rg-surf]') as SVGEllipseElement).style.fill = tint(mix, 0.22);
    setCls($('[data-rg-bk]'), 'rg-bk' + (pouring ? ' pour' : '') + (instant ? ' instant' : ''));
    const stream = $<SVGPathElement>('[data-rg-stream]');
    setCls(stream, 'rg-stream' + (pouring ? ' pour' : ''));
    stream.style.stroke = mixColor;
    const fs = $<SVGEllipseElement>('[data-rg-fsplash]');
    setCls(fs, 'rg-fsplash' + (pouring ? ' pour' : ''));
    fs.style.stroke = mixColor;
    const spill = $<SVGGElement>('[data-rg-spill]');
    setCls(spill, 'rg-spill' + (spilled ? ' on' : '') + (spilled && spillLive ? ' go' : ''));
    spill.style.fill = mixColor;
    spill.style.stroke = mixColor;
    const puddle = $<SVGGElement>('[data-rg-puddle]');
    setCls(puddle, 'rg-puddle' + (spilled ? ' on' : '') + (spilled && spillLive && !pouring ? ' go' : '') + (spilled && pouring ? ' pour' : ''));
    puddle.style.fill = mixColor;
    puddle.style.stroke = mixColor;
    const totalEl = $<HTMLElement>('[data-rg-total]');
    setCls(totalEl, 'rg-total' + (spilled ? ' bad' : n >= MAX ? ' full' : ''));
    totalEl.textContent = spilled ? tr('OVERFLOW', 'TRÀN CỐC') : `${Math.min(MAX, n)}/${MAX} ${tr('DROPS', 'GIỌT')}`;
    const parts = KEYS.filter((k) => c[k]).map((k) => `${c[k]} ${R[k].low}`);
    $('[data-rg-sum]').textContent = n ? tr(`In the cup: ${parts.join(', ')} (${Math.min(MAX, n)}/${MAX} drops${spilled ? ', overflowed' : ''}).`, `Trong cốc: ${parts.join(', ')} (${Math.min(MAX, n)}/${MAX} giọt${spilled ? ', đã tràn' : ''}).`) : tr('The cup is empty.', 'Cốc đang rỗng.');
    pourBtn.setAttribute('aria-disabled', (!n && !isBusy) || pouring || sweeping || solved || pourWait || submitting ? 'true' : 'false');
    // swatch + meter
    const chip = $<HTMLElement>('[data-rg-cupchip]');
    setCls(chip, 'rg-chip cup' + (d ? '' : ' empty') + (spilled ? ' bad' : ''));
    chip.style.backgroundColor = d ? mixColor : 'transparent';
    let needleDeg = -62;
    if (d) needleDeg = (d.warm ? 1 : -1) * 58 * Math.sqrt(Math.min(1, d.dE / 60));
    if (match) needleDeg = 0;
    const needle = $<SVGGElement>('[data-rg-needle]');
    setCls(needle, 'rg-needle' + (match ? ' ok' : ''));
    needle.style.transform = `rotate(${Math.round(needleDeg * 10) / 10}deg)`;
    setCls($('[data-rg-jewel]'), 'rg-jewel' + (spilled ? ' bad' : match ? ' ok' : n ? ' on' : ''));
    let readBig = '—';
    let readSmall = tr('EMPTY CUP', 'CỐC RỖNG');
    if (spilled) { readBig = tr('OVERFLOW', 'TRÀN'); readSmall = tr('POUR IT OUT', 'ĐỔ BỎ ĐI'); }
    else if (match) { readBig = tr('MATCH', 'KHỚP'); readSmall = tr('ON SAMPLE', 'ĐÚNG MẪU'); }
    else if (d) { readBig = `${tr('OFF', 'LỆCH')} ${Math.round(d.dE)}`; readSmall = d.warm ? tr('LEANS WARM', 'NGHIÊNG ẤM') : tr('LEANS COLD', 'NGHIÊNG LẠNH'); }
    $('[data-rg-readbig]').textContent = readBig;
    $('[data-rg-readsmall]').textContent = readSmall;
    $('[data-rg-meter]').setAttribute('aria-label', tr('Colour deviation meter: ', 'Đồng hồ độ lệch màu: ') + (spilled ? tr('cup overflowed.', 'cốc tràn.') : match ? tr('matches the sample.', 'khớp mẫu.') : d ? tr(`off by ${Math.round(d.dE)}, leaning ${d.warm ? 'warm' : 'cold'}.`, `lệch ${Math.round(d.dE)}, nghiêng ${d.warm ? 'ấm.' : 'lạnh.'}`) : tr('empty cup.', 'cốc rỗng.')));
    // letter + brush
    const sw = sweeping ? ` sw-${sweepK}` : '';
    setCls($('[data-rg-paper]'), 'rg-paper' + sw);
    setCls($('[data-rg-brush]'), 'rg-brush' + sw);
    const trail = $<SVGPathElement>('[data-rg-trail]');
    setCls(trail, 'rg-trail' + sw);
    trail.style.stroke = mixColor;
    $('[data-rg-tint]').setAttribute('fill', sweeping ? mixColor : '#2f1610');
    const inkCls = 'rg-ink' + (revealed ? ' on' : '') + (revealed && revealLive ? ' go' : '');
    setCls($('[data-rg-ink]'), inkCls);
    setCls($('[data-rg-inktext]'), inkCls);
    const st = stains();
    setCls($('[data-rg-stains]'), 'rg-stains' + (st >= 4 ? ' heavy' : ''));
    [1, 2, 3].forEach((i) => setCls($(`[data-rg-st="${i}"]`), `rg-st rg-st-${['a', 'b', 'c'][i - 1]}` + (st >= i ? ' on' : '') + (stainLive && st === i ? ' grow' : '')));
    $('[data-rg-letter]').setAttribute('aria-label', revealed ? tr('The letter shows writing: ', 'Lá thư đã hiện chữ: ') + `‘${letterLines().join(' ')}’` : st ? tr(`A blank letter, ${Math.min(st, 3)} corner(s) stained.`, `Lá thư trắng, bị ố ${Math.min(st, 3)} góc.`) : tr('A blank letter pegged on the drying line.', 'Lá thư trắng trơn kẹp trên dây phơi.'));
    sweepBtn.setAttribute('aria-disabled', !n || spilled || isBusy || pouring || sweeping || solved || submitting ? 'true' : 'false');
    setCls(sweepBtn, 's-btn s-btn-red rg-sweepbtn' + (match && !isBusy && !sweeping && !solved ? ' ready' : ''));
    // status
    const m = msg || (n ? dropMsg(drops) : M.fresh);
    const line = `${m.kick} · ${m.text}`;
    if (line !== lastStatus) { lastStatus = line; ctx.setStatus(line, m.tone); }
  }

  // ---- wiring ----
  const listeners: [EventTarget, string, EventListener][] = [];
  const on = (target: EventTarget, type: string, fn: EventListener) => { target.addEventListener(type, fn); listeners.push([target, type, fn]); };
  KEYS.forEach((k) => on(bts[k], 'click', () => squeeze(k)));
  on(pourBtn, 'click', () => pour());
  on(sweepBtn, 'click', () => sweep());
  on(sheet, 'keydown', onKey as EventListener);

  if (ctx.solved) reveal(false);
  else render();

  return {
    update(nextCtx) {
      ctx = nextCtx;
      if (nextCtx.solved && !solved && !submitting) reveal(false); // the partner revealed it
      else if (solved && !inkWritten) { writeInk(); render(); }
      else render();
    },
    unmount() {
      alive = false;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
      root.remove();
    },
  };
}

const reagentMix: PuzzleKindModule = {
  kind: 'reagent_mix',
  label: { en: 'Reagent mixing', vi: 'Pha thuốc thử' },
  mount,
};

export default reagentMix;
