import { cosmeticSprite, isCosmeticDef } from '../../cosmetics/icons.js';

/*
 * Pixel sprites of Mở hòm, moved as they are from the approved mock-up
 * (hom-niem-phong.html): a small grid-drawing engine, the three chests, their keys and the item icons.
 * Everything renders to a canvas on first use, so importing this module costs nothing until an icon is needed.
 */
const MAT = {
  ebony:['#5C2D1C','#87472D','#2B120A'], seam:['#22100A','#22100A','#22100A'],
  gold:['#C9963A','#F4D27C','#7A4E18'], iron:['#7D8694','#BEC6D1','#414853'],
  rivet:['#EDE5D0','#EDE5D0','#EDE5D0'], glass:['#5C8BB8','#CFE6FF','#2D4A67'],
  ruby:['#B8233A','#F26E80','#610C1B'], ribbon:['#821829','#A92A3E','#4A0A14'],
  paper:['#D8CDB2','#F3EBD6','#9C9078'], black:['#1B1F27','#1B1F27','#1B1F27'],
  white:['#F7F0DE','#F7F0DE','#F7F0DE'], velvet:['#4C1020','#7C2034','#2A0811'],
  wood:['#8A5432','#B9774A','#4E2C18'], tweed:['#7D6C4E','#A8946F','#463C2B'],
  leather:['#7A2E22','#A8493A','#45170F'], flame:['#F0A43A','#FFE58F','#B5651D'],
  safe:['#3E5A4D','#6E907E','#21332A'], panel:['#4A6B5B','#7FA191','#2A4236'], dark:['#11161A','#11161A','#11161A'],
  lacquer:['#22171A','#43302F','#0D0809'], vermil:['#9E2420','#CF4A3E','#5A100D'], jade:['#3E9A78','#93E3C1','#1C5A43'],
  pearl:['#CFE3E6','#F6FCFD','#8DA9AE'], bronze:['#9A6A2E','#CB9550','#573812'], sapphire:['#2F5FD0','#93B8FF','#17307A'],
  glaze:['#2E5FA8','#73A0E3','#173569'], mint:['#5E8C6A','#8DBB98','#33553D'],
  onyx:['#2B2331','#4B4057','#120D17'], silver:['#8D96A6','#D6DCE6','#4A505E'], crimson:['#7A1226','#B32A42','#3A0712'],
};
const FLAT = new Set(['seam', 'rivet', 'black', 'white', 'dark']);
const NAMES = Object.keys(MAT);
const OUT = [5, 7, 10];
const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RGB = {}; for (const k of NAMES) RGB[k] = MAT[k].map(hexRGB);

class G {
  constructor(w, h) { this.w = w; this.h = h; this.a = new Uint8Array(w * h).fill(255); }
  set(x, y, m, only) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (only && this.a[i] === 255) return;
    this.a[i] = m === null ? 255 : NAMES.indexOf(m);
  }
  rect(x0, y0, x1, y1, m, only) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, m, only); return this; }
  circ(cx, cy, r, m, only) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r + r * 0.5) this.set(x, y, m, only);
    } return this;
  }
  ell(x0, y0, x1, y1, m, only) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const u = (x - cx) / rx, v = (y - cy) / ry; if (u * u + v * v <= 1) this.set(x, y, m, only);
    } return this;
  }
  ring(cx, cy, rx, ry, m) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry); if (Math.abs(d - 1) < 0.5 / Math.min(rx, ry)) this.set(x, y, m);
    } return this;
  }
  line(x0, y0, x1, y1, m, w = 1) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
    const lo = -Math.floor((w - 1) / 2), hi = Math.ceil((w - 1) / 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = Math.round(x0 + (x1 - x0) * t), py = Math.round(y0 + (y1 - y0) * t);
      for (let a = lo; a <= hi; a++) for (let b = lo; b <= hi; b++) this.set(px + a, py + b, m);
    } return this;
  }
  poly(pts, m) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
      }
      if (ins) this.set(x, y, m);
    } return this;
  }
  render({ top = true, bottom = true } = {}) {
    const W = this.w + 2, H = this.h + 2, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
    const get = (i, j) => (i < 0 || j < 0 || i >= this.w || j >= this.h) ? 255 : this.a[j * this.w + i];
    for (let j = -1; j <= this.h; j++) for (let i = -1; i <= this.w; i++) {
      const v = get(i, j); let col = null;
      if (v === 255) {
        if ((j === -1 && !top) || (j === this.h && !bottom)) continue;
        if (get(i + 1, j) !== 255 || get(i - 1, j) !== 255 || get(i, j + 1) !== 255 || get(i, j - 1) !== 255) col = OUT;
      } else {
        const nm = NAMES[v], [b, l, dk] = RGB[nm]; col = b;
        if (!FLAT.has(nm)) {
          if (get(i, j - 1) !== v || get(i - 1, j) !== v) col = l;
          else if (get(i, j + 1) !== v || get(i + 1, j) !== v) col = dk;
        }
      }
      if (!col) continue;
      const k = ((j + 1) * W + (i + 1)) * 4; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return { c, w: W, h: H };
  }
}

/* ---------- the sealed chest (48 px wide) ---------- */
function chestBody(sealed) {
  const g = new G(48, 23);
  g.rect(3, 0, 44, 21, 'ebony');
  g.rect(3, 0, 44, 0, 'seam');
  g.rect(4, 7, 43, 7, 'seam'); g.rect(4, 14, 43, 14, 'seam');
  for (const x of [17, 31]) { g.set(x, 3, 'seam'); g.set(x + 6, 11, 'seam'); g.set(x - 9, 18, 'seam'); }
  g.rect(8, 1, 10, 19, 'iron'); g.rect(37, 1, 39, 19, 'iron');
  for (const y of [3, 10, 17]) { g.set(9, y, 'rivet'); g.set(38, y, 'rivet'); }
  g.rect(2, 1, 6, 5, 'gold'); g.rect(41, 1, 45, 5, 'gold'); g.rect(2, 15, 6, 19, 'gold'); g.rect(41, 15, 45, 19, 'gold');
  g.set(4, 3, 'rivet'); g.set(43, 3, 'rivet'); g.set(4, 17, 'rivet'); g.set(43, 17, 'rivet');
  g.rect(1, 20, 46, 22, 'gold');
  for (const x of [5, 12, 19, 28, 35, 42]) g.set(x, 21, 'seam');
  // lock plate
  g.poly([[19, 1], [29, 1], [29, 9], [24, 14], [19, 9]], 'gold');
  g.rect(20, 2, 27, 2, 'gold');
  g.circ(23.5, 3.6, 1.4, 'black'); g.rect(23, 4, 24, 8, 'black');
  // evidence tag on a string
  g.line(9, 2, 13, 5, 'black'); g.rect(12, 5, 17, 11, 'paper'); g.rect(13, 6, 16, 6, 'ruby');
  g.rect(13, 8, 16, 8, 'seam'); g.rect(13, 10, 15, 10, 'seam');
  if (sealed) {
    g.circ(32.5, 4, 3, 'ruby'); g.set(30, 7, 'ruby'); g.set(30, 8, 'ruby'); g.set(35, 7, 'ruby');
    g.rect(32, 3, 33, 5, 'ribbon'); g.set(31, 4, 'ribbon'); g.set(34, 4, 'ribbon');
  }
  return g.render({ top: false });
}
function chestLid() {
  const g = new G(48, 18);
  g.ell(3, 0, 44, 25, 'ebony'); g.rect(3, 9, 44, 17, 'ebony');
  g.rect(4, 9, 43, 9, 'seam', true);
  g.set(15, 5, 'seam'); g.set(30, 13, 'seam'); g.set(20, 13, 'seam');
  g.rect(8, 0, 10, 17, 'iron', true); g.rect(37, 0, 39, 17, 'iron', true);
  g.set(9, 6, 'rivet', true); g.set(38, 6, 'rivet', true); g.set(9, 12, 'rivet'); g.set(38, 12, 'rivet');
  g.rect(2, 12, 6, 17, 'gold'); g.rect(41, 12, 45, 17, 'gold'); g.set(4, 14, 'rivet'); g.set(43, 14, 'rivet');
  g.rect(3, 16, 44, 17, 'gold');
  g.circ(23.5, 7.5, 3.6, 'gold'); g.circ(23.5, 7.5, 2.1, 'glass'); g.set(22, 6, 'white');
  g.line(26, 10, 28, 12, 'gold', 2);
  return g.render({ bottom: false });
}
function chestUnderside() {
  const g = new G(48, 14);
  g.rect(3, 0, 44, 13, 'ebony');
  g.rect(6, 2, 41, 11, 'velvet');
  for (let y = 4; y <= 10; y += 3) for (let x = 9 + ((y / 3) % 2) * 3; x <= 39; x += 6) g.set(x, y, 'gold');
  g.rect(3, 12, 44, 13, 'gold');
  return g.render({ bottom: false });
}
/* ---------- the Whitechapel night case: onyx and silver, a storm-lantern lock, crimson velvet ---------- */
function wcBody(sealed) {
  const g = new G(48, 23);
  g.rect(3, 0, 44, 21, 'onyx');
  g.rect(3, 0, 44, 0, 'seam');
  // quilted crimson velvet in silver frames, left and right of the lock
  for (const x0 of [11, 28]) {
    g.rect(x0, 2, x0 + 8, 16, 'silver'); g.rect(x0 + 1, 3, x0 + 7, 15, 'crimson');
    for (let y = 5; y <= 13; y += 4) for (let x = x0 + 2 + ((y - 5) / 4 % 2) * 2; x <= x0 + 6; x += 4) g.set(x, y, 'silver');
  }
  // silver straps, studs and corner braces
  g.rect(7, 1, 8, 18, 'silver'); g.rect(39, 1, 40, 18, 'silver');
  for (const y of [4, 10, 16]) { g.set(7, y, 'rivet'); g.set(40, y, 'rivet'); }
  for (const [x, y] of [[3, 1], [42, 1], [3, 14], [42, 14]]) { g.rect(x, y, x + 2, y + 4, 'silver'); g.set(x + 1, y + 2, 'black'); }
  // plinth with a crimson inlay
  g.rect(1, 19, 46, 22, 'silver'); g.rect(2, 20, 45, 20, 'crimson');
  for (const x of [6, 14, 22, 25, 33, 41]) g.set(x, 21, 'black');
  // the storm-lantern lock: brass roof, glowing glass, keyhole plate
  g.rect(23, 0, 24, 0, 'gold'); g.poly([[19.5, 3], [28.5, 3], [25.5, 0.5], [22.5, 0.5]], 'gold');
  g.rect(19, 3, 28, 11, 'gold'); g.rect(20, 4, 27, 10, 'flame'); g.rect(23, 5, 24, 9, 'white'); g.set(22, 7, 'white'); g.set(25, 7, 'white');
  g.rect(19, 11, 28, 12, 'gold');
  g.poly([[20, 13], [28, 13], [26.5, 18], [21.5, 18]], 'gold');
  g.circ(23.5, 14.4, 1.1, 'black'); g.rect(23, 15, 24, 16, 'black');
  if (sealed) {
    // red wax seal on a silver cord, hanging from the lantern
    g.line(27, 12, 30, 14, 'silver');
    g.circ(31.5, 15.5, 2.6, 'ruby'); g.rect(31, 15, 32, 16, 'ribbon'); g.set(30, 18, 'ribbon'); g.set(33, 18, 'ribbon');
  }
  return g.render({ top: false });
}
function wcLid() {
  const g = new G(48, 18);
  g.ell(3, 0, 44, 27, 'onyx'); g.rect(3, 11, 44, 17, 'onyx');
  g.rect(4, 11, 43, 11, 'seam', true);
  // a row of silver studs following the dome
  for (let k = 1; k < 12; k++) { const a = Math.PI + k * Math.PI / 12; g.set(23.5 + Math.cos(a) * 16.5, 12.5 + Math.sin(a) * 9.5, 'silver', true); }
  g.rect(7, 3, 8, 17, 'silver', true); g.rect(39, 3, 40, 17, 'silver', true);
  g.set(7, 8, 'rivet', true); g.set(40, 8, 'rivet', true);
  g.rect(3, 14, 44, 17, 'silver'); g.rect(4, 15, 43, 15, 'crimson');
  for (const x of [3, 42]) g.rect(x, 12, x + 2, 17, 'silver');
  // the silver magnifier, crimson lens, gold ferrule
  g.circ(22.5, 6.5, 4.3, 'silver'); g.circ(22.5, 6.5, 2.8, 'crimson'); g.set(21, 5, 'white'); g.set(20, 6, 'white');
  g.line(25.5, 9.5, 29, 12.5, 'silver', 2); g.rect(29, 12, 30, 13, 'gold');
  return g.render({ bottom: false });
}
function wcUnderside() {
  const g = new G(48, 14);
  g.rect(3, 0, 44, 13, 'onyx');
  g.rect(6, 2, 41, 11, 'crimson');
  for (let y = 4; y <= 10; y += 3) for (let x = 9 + ((y / 3) % 2) * 3; x <= 39; x += 6) g.set(x, y, 'silver');
  g.rect(3, 12, 44, 13, 'silver');
  g.circ(23.5, 7, 2.2, 'flame'); g.set(23, 6, 'white');
  return g.render({ bottom: false });
}

/* ---------- the loupe key (40 px wide) ---------- */
function keySprite() {
  const g = new G(40, 18);
  g.line(6, 14, 4, 17, 'ribbon', 2); g.line(9, 14, 10, 17, 'ribbon', 2);
  g.circ(8, 8, 6.4, 'gold'); g.circ(8, 8, 4.1, 'glass');
  g.set(6, 6, 'white'); g.set(5, 7, 'white'); g.set(7, 5, 'white');
  g.rect(17, 7, 35, 9, 'gold');
  g.rect(18, 6, 19, 10, 'gold'); g.rect(22, 6, 22, 10, 'gold');
  g.circ(15.5, 8, 1.6, 'ruby');
  g.rect(28, 10, 35, 14, 'gold'); g.rect(30, 12, 30, 14, null); g.rect(33, 13, 34, 14, null);
  g.rect(36, 7, 37, 9, 'gold'); g.set(38, 8, 'gold');
  return g.render();
}

/* ---------- the bank safe: frame + swinging door ---------- */
function safeFrame() {
  const g = new G(48, 41);
  g.rect(3, 1, 44, 36, 'safe');
  g.rect(2, 0, 45, 2, 'gold'); g.rect(2, 34, 45, 36, 'gold');
  g.rect(4, 37, 9, 40, 'iron'); g.rect(38, 37, 43, 40, 'iron');
  g.rect(6, 5, 41, 32, 'dark');
  g.rect(7, 22, 40, 23, 'iron');
  g.rect(9, 17, 14, 21, 'gold'); g.rect(16, 17, 21, 21, 'gold'); g.rect(12, 13, 18, 16, 'gold');
  g.circ(30, 19, 2.2, 'gold'); g.circ(35, 20, 1.8, 'gold'); g.circ(33, 16.5, 1.6, 'gold');
  g.rect(9, 27, 22, 31, 'paper'); g.rect(9, 29, 22, 29, 'vermil'); g.rect(26, 26, 38, 31, 'mint'); g.rect(26, 28, 38, 28, 'gold');
  g.rect(4, 8, 5, 12, 'iron'); g.rect(4, 25, 5, 29, 'iron');
  for (const [x, y] of [[4, 4], [43, 4], [4, 32], [43, 32], [43, 18]]) g.set(x, y, 'rivet');
  return g.render();
}
function safeDoor() {
  const g = new G(36, 28);
  g.rect(0, 0, 35, 27, 'safe'); g.rect(2, 2, 33, 25, 'panel');
  g.rect(9, 3, 26, 5, 'gold'); g.rect(10, 4, 25, 4, 'seam');
  for (const x of [3, 32]) for (let y = 4; y <= 24; y += 5) g.set(x, y, 'rivet');
  g.circ(13, 16, 6, 'iron'); g.circ(13, 16, 4.2, 'black'); g.circ(13, 16, 1.6, 'iron');
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; g.set(13 + Math.cos(a) * 5.3, 16 + Math.sin(a) * 5.3, 'rivet'); }
  g.set(13, 8, 'gold');
  const hx = 26, hy = 12;
  for (const a of [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6]) { g.line(hx, hy, hx + Math.cos(a) * 4, hy + Math.sin(a) * 4, 'gold'); g.circ(hx + Math.cos(a) * 4.6, hy + Math.sin(a) * 4.6, 0.9, 'gold'); }
  g.circ(hx, hy, 1.4, 'gold');
  g.rect(24, 19, 28, 24, 'gold'); g.circ(26, 20.6, 0.8, 'black'); g.rect(26, 21, 26, 23, 'black');
  return g.render();
}
function safeDoorBack() {
  const g = new G(36, 28);
  g.rect(0, 0, 35, 27, 'safe'); g.rect(3, 3, 32, 24, 'iron'); g.rect(5, 5, 30, 22, 'panel');
  g.rect(27, 6, 35, 8, 'gold'); g.rect(27, 19, 35, 21, 'gold');
  g.circ(15, 14, 4, 'gold'); g.circ(15, 14, 1.5, 'iron'); g.rect(19, 13, 27, 14, 'iron');
  return g.render();
}
function bankKey() {
  const g = new G(40, 18);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.circ(8 + Math.cos(a) * 6.2, 8 + Math.sin(a) * 6.2, 1.2, 'iron'); }
  g.circ(8, 8, 5.8, 'iron'); g.circ(8, 8, 3, 'gold'); g.circ(8, 8, 1, null);
  g.rect(15, 7, 35, 9, 'iron'); g.rect(16, 6, 17, 10, 'gold'); g.rect(20, 6, 20, 10, 'gold');
  g.rect(28, 10, 35, 13, 'iron'); g.rect(30, 12, 30, 13, null); g.rect(33, 12, 33, 13, null);
  g.rect(28, 3, 34, 6, 'iron'); g.rect(31, 3, 31, 4, null);
  g.rect(36, 7, 37, 9, 'iron'); g.set(38, 8, 'iron');
  return g.render();
}
/* ---------- the lacquer box: tiered lid, jade clasp ---------- */
function trapBody(clasp) {
  const g = new G(48, 23);
  g.rect(4, 0, 43, 19, 'lacquer');
  g.rect(4, 0, 43, 0, 'gold'); g.rect(4, 1, 43, 1, 'vermil'); g.rect(4, 2, 43, 2, 'gold'); g.rect(4, 17, 43, 17, 'gold');
  for (const fx of [12, 35]) {
    g.circ(fx, 10, 1.2, 'gold');
    for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0], [-2, -2], [2, -2], [-2, 2], [2, 2], [0, -4], [0, 4], [-4, 0], [4, 0]]) g.set(fx + dx, 10 + dy, 'pearl');
  }
  for (const [x, y] of [[7, 5], [18, 14], [29, 5], [40, 14], [7, 15], [40, 5]]) g.set(x, y, 'pearl');
  g.rect(2, 19, 45, 20, 'vermil'); g.rect(3, 21, 8, 22, 'vermil'); g.rect(39, 21, 44, 22, 'vermil');
  g.rect(20, 8, 27, 15, 'bronze'); g.circ(23.5, 10.6, 1.2, 'black'); g.rect(23, 11, 24, 13, 'black');
  if (clasp) { g.circ(23.5, 4.6, 2.5, 'jade'); g.rect(23, 4, 24, 5, 'dark'); g.rect(23, 7, 24, 7, 'jade'); }
  return g.render({ top: false });
}
function trapLid() {
  const g = new G(48, 18);
  g.rect(3, 12, 44, 17, 'lacquer'); g.rect(6, 6, 41, 11, 'lacquer'); g.rect(12, 2, 35, 5, 'lacquer');
  g.rect(3, 12, 44, 12, 'vermil');
  g.rect(3, 16, 44, 16, 'gold'); g.rect(6, 10, 41, 10, 'gold'); g.rect(12, 5, 35, 5, 'gold');
  for (const x of [10, 17, 29, 36]) { g.set(x, 8, 'pearl'); g.set(x + 1, 8, 'pearl'); g.set(x + 1, 9, 'pearl'); }
  for (const x of [7, 14, 21, 26, 33, 40]) g.set(x, 14, 'pearl');
  g.rect(21, 0, 26, 1, 'jade'); g.set(22, 0, 'white');
  return g.render({ bottom: false });
}
function trapUnderside() {
  const g = new G(48, 14);
  g.rect(3, 0, 44, 13, 'lacquer'); g.rect(6, 2, 41, 11, 'vermil');
  for (let y = 4; y <= 10; y += 3) for (let x = 9 + ((y / 3) % 2) * 3; x <= 39; x += 6) g.set(x, y, 'gold');
  g.rect(3, 12, 44, 13, 'gold');
  return g.render({ bottom: false });
}
function jadeKey() {
  const g = new G(40, 18);
  g.line(7, 14, 5, 17, 'vermil', 2); g.line(10, 14, 11, 17, 'vermil', 2);
  g.circ(8, 8, 6.4, 'jade'); g.ring(8, 8, 4.3, 4.3, 'gold'); g.circ(8, 8, 2, null); g.set(5, 4, 'white'); g.set(4, 5, 'white');
  g.rect(15, 7, 35, 9, 'bronze'); g.rect(16, 6, 17, 10, 'gold'); g.rect(20, 6, 20, 10, 'gold');
  g.rect(28, 10, 34, 14, 'bronze'); g.rect(30, 12, 31, 14, null); g.set(33, 14, null);
  g.rect(36, 7, 37, 9, 'bronze'); g.set(38, 8, 'bronze');
  return g.render();
}

/* ---------- evidence items (22 px) ---------- */
const ICON = {
  magnifier(gold) { const g = new G(22, 22); g.line(13, 13, 19, 19, 'wood', 3); g.rect(12, 12, 14, 14, gold ? 'gold' : 'iron'); g.circ(8, 8, 7, gold ? 'gold' : 'iron'); g.circ(8, 8, 5, 'glass'); g.set(6, 5, 'white'); g.set(5, 6, 'white'); g.set(7, 5, 'white'); return g; },
  watch() { const g = new G(22, 22); g.circ(11, 2, 2, 'gold'); g.set(11, 2, null); g.rect(10, 4, 12, 5, 'gold'); g.circ(11, 13, 8, 'gold'); g.circ(11, 13, 6, 'paper');
    for (const [x, y] of [[11, 8], [16, 13], [11, 18], [6, 13]]) g.set(x, y, 'black');
    const ah = 68.5 * Math.PI / 180, am = 102 * Math.PI / 180;
    g.line(11, 13, 11 + 3 * Math.sin(ah), 13 - 3 * Math.cos(ah), 'black'); g.line(11, 13, 11 + 5 * Math.sin(am), 13 - 5 * Math.cos(am), 'black'); return g; },
  pipe() { const g = new G(22, 22); g.line(9, 14, 20, 9, 'black', 2); g.rect(19, 8, 21, 9, 'iron'); g.poly([[3, 7], [11, 7], [11, 16], [9, 19], [5, 19], [3, 16]], 'wood'); g.rect(4, 7, 9, 8, 'black'); g.rect(3, 11, 10, 11, 'gold'); return g; },
  hat() { const g = new G(22, 22); g.poly([[1, 15], [6, 12], [7, 16], [2, 17]], 'tweed'); g.poly([[21, 15], [16, 12], [15, 16], [20, 17]], 'tweed'); g.ell(4, 4, 18, 18, 'tweed'); g.rect(4, 14, 18, 15, 'leather'); g.line(11, 4, 11, 13, 'black'); g.rect(10, 2, 12, 3, 'leather'); return g; },
  notebook() { const g = new G(22, 22); g.rect(15, 3, 17, 19, 'paper'); g.rect(4, 2, 15, 20, 'leather'); g.rect(6, 5, 12, 8, 'paper'); g.line(7, 6, 11, 6, 'black'); g.line(7, 7, 10, 7, 'black'); g.rect(13, 2, 13, 20, 'black'); return g; },
  lantern() { const g = new G(22, 22); g.circ(11, 2, 2, 'iron'); g.set(11, 2, null); g.poly([[6, 7], [17, 7], [14, 4], [8, 4]], 'iron'); g.rect(6, 7, 16, 16, 'glass'); g.rect(9, 10, 13, 14, 'flame'); g.rect(10, 9, 12, 9, 'flame'); g.rect(6, 7, 6, 16, 'iron'); g.rect(16, 7, 16, 16, 'iron'); g.rect(11, 7, 11, 8, 'iron'); g.rect(5, 17, 17, 19, 'iron'); return g; },
  hairpin() { const g = new G(22, 22); g.line(3, 20, 13, 9, 'gold', 2); g.circ(15, 7, 5, 'gold'); g.circ(15, 7, 3, 'ruby'); g.set(14, 6, 'white'); for (const [x, y] of [[15, 1], [21, 7], [15, 13], [9, 7]]) g.set(x, y, 'gold'); return g; },
  fingerprint() { const g = new G(22, 22); g.rect(3, 2, 18, 20, 'paper'); for (const r of [6, 4, 2]) g.ring(10.5, 11, r * 0.8, r, 'black'); g.rect(5, 17, 16, 17, 'black'); g.rect(5, 4, 9, 4, 'ruby'); return g; },
  coin() { const g = new G(22, 22); g.circ(11, 11, 8.5, 'bronze'); g.ring(11, 11, 6, 6, 'gold'); g.rect(9, 9, 13, 13, null); for (const [x, y] of [[11, 5], [11, 17], [5, 11], [17, 11]]) g.set(x, y, 'gold'); return g; },
  cheque() { const g = new G(22, 22); g.rect(2, 5, 19, 16, 'paper'); g.rect(2, 5, 19, 7, 'mint'); g.rect(4, 10, 12, 10, 'seam'); g.rect(4, 13, 9, 13, 'seam'); g.line(12, 14, 17, 12, 'black'); g.rect(16, 9, 17, 10, 'vermil'); return g; },
  pen() { const g = new G(22, 22); g.line(4, 18, 14, 8, 'black', 3); g.poly([[13, 6], [19, 2], [16, 9]], 'gold'); g.line(7, 15, 9, 13, 'gold'); g.set(17, 4, 'black'); return g; },
  monocle() { const g = new G(22, 22); for (let k = 0; k < 5; k++) g.set(14 + k * 1.5, 14 + k * 1.5, 'gold'); g.circ(9, 9, 6.5, 'gold'); g.circ(9, 9, 4.6, 'glass'); g.set(7, 6, 'white'); g.set(6, 7, 'white'); return g; },
  moneybag() { const g = new G(22, 22); g.ell(3, 7, 18, 21, 'tweed'); g.rect(8, 3, 13, 7, 'tweed'); g.rect(7, 7, 14, 8, 'leather'); g.circ(10.5, 15, 3, 'gold'); g.rect(10, 13, 11, 17, 'bronze'); return g; },
  tophat() { const g = new G(22, 22); g.rect(6, 2, 15, 15, 'lacquer'); g.rect(2, 15, 19, 17, 'lacquer'); g.rect(6, 12, 15, 13, 'vermil'); return g; },
  goldbar() { const g = new G(22, 22); g.poly([[2, 19], [20, 19], [17, 12], [5, 12]], 'gold'); g.poly([[6, 12], [16, 12], [14, 6], [8, 6]], 'gold'); g.rect(6, 12, 16, 12, 'bronze'); g.set(9, 16, 'white'); g.set(10, 8, 'white'); return g; },
  stamp() { const g = new G(22, 22); g.circ(11, 4, 3, 'wood'); g.rect(10, 6, 12, 11, 'wood'); g.rect(4, 12, 18, 16, 'iron'); g.rect(4, 17, 18, 18, 'vermil'); return g; },
  ring() { const g = new G(22, 22); g.circ(11, 15, 5.6, 'gold'); g.circ(11, 15, 3.6, null); g.poly([[6, 6], [16, 6], [18, 8], [11, 13], [4, 8]], 'glass'); g.set(8, 7, 'white'); g.set(13, 7, 'white'); g.rect(10, 6, 12, 6, 'white'); return g; },
  sapphire() { const g = new G(22, 22); g.poly([[2, 8], [7, 2], [15, 2], [20, 8], [11, 20]], 'sapphire'); g.line(2, 8, 20, 8, 'glass'); g.line(7, 2, 9, 8, 'glass'); g.line(15, 2, 13, 8, 'glass'); g.line(9, 8, 11, 19, 'glass'); g.set(6, 5, 'white'); g.set(7, 4, 'white'); return g; },
  fan() { const g = new G(22, 22); const p = [[11, 20]]; for (let a = -160; a <= -20; a += 10) p.push([11 + Math.cos(a * Math.PI / 180) * 10.5, 20 + Math.sin(a * Math.PI / 180) * 10.5]); g.poly(p, 'paper'); for (let a = -150; a <= -30; a += 30) g.line(11, 20, 11 + Math.cos(a * Math.PI / 180) * 9, 20 + Math.sin(a * Math.PI / 180) * 9, 'bronze'); g.circ(15, 12, 1.6, 'vermil'); g.circ(8, 14, 1.2, 'vermil'); return g; },
  teacup() { const g = new G(22, 22); g.ell(2, 15, 20, 19, 'pearl'); g.poly([[4, 7], [18, 7], [16, 15], [6, 15]], 'pearl'); g.rect(5, 10, 17, 11, 'glaze'); g.set(9, 13, 'glaze'); g.set(13, 13, 'glaze'); return g; },
  paperlamp() { const g = new G(22, 22); g.rect(8, 2, 14, 4, 'lacquer'); g.ell(4, 4, 18, 18, 'vermil'); for (const y of [7, 11, 15]) g.rect(5, y, 17, y, 'gold', true); g.rect(8, 18, 14, 19, 'lacquer'); g.rect(10, 20, 12, 21, 'gold'); return g; },
  scroll() { const g = new G(22, 22); g.rect(3, 4, 18, 17, 'paper'); g.rect(2, 2, 19, 3, 'wood'); g.rect(2, 18, 19, 19, 'wood'); g.poly([[4, 16], [8, 8], [11, 12], [13, 9], [17, 16]], 'black'); g.set(16, 6, 'vermil'); g.set(15, 6, 'vermil'); return g; },
  comb() { const g = new G(22, 22); g.ell(3, 3, 18, 12, 'paper'); g.rect(3, 8, 18, 10, 'paper'); for (let x = 4; x <= 17; x += 2) g.rect(x, 11, x, 18, 'paper'); g.circ(10.5, 6, 1.5, 'vermil'); return g; },
  vase() { const g = new G(22, 22); g.rect(9, 1, 13, 5, 'pearl'); g.ell(4, 5, 18, 20, 'pearl'); g.rect(5, 9, 17, 10, 'glaze', true); g.rect(5, 16, 17, 16, 'glaze', true); for (const [x, y] of [[8, 13], [11, 12], [14, 13]]) g.set(x, y, 'glaze'); return g; },
  jadeseal() { const g = new G(22, 22); g.ell(6, 2, 16, 12, 'jade'); g.set(9, 6, 'black'); g.set(13, 6, 'black'); g.rect(4, 12, 18, 18, 'jade'); g.rect(4, 19, 18, 20, 'vermil'); return g; },
  mirror() { const g = new G(22, 22); g.rect(10, 17, 12, 21, 'bronze'); g.circ(11, 9.5, 8.5, 'bronze'); g.circ(11, 9.5, 6.3, 'glass'); g.set(8, 6, 'white'); g.set(7, 7, 'white'); return g; },
  mask() { const g = new G(22, 22); g.ell(3, 2, 18, 20, 'paper'); g.rect(4, 2, 17, 4, 'gold', true); g.line(5, 8, 9, 6, 'vermil', 2); g.line(16, 8, 12, 6, 'vermil', 2); g.ell(6, 9, 9, 11, 'black'); g.ell(12, 9, 15, 11, 'black'); g.rect(7, 13, 8, 15, 'vermil'); g.rect(13, 13, 14, 15, 'vermil'); g.rect(9, 16, 12, 17, 'vermil'); return g; },
  pendant() { const g = new G(22, 22); g.line(11, 0, 11, 4, 'vermil'); g.circ(11, 12.5, 8, 'jade'); g.circ(11, 12.5, 2.4, null); g.ring(11, 12.5, 5.2, 5.2, 'gold'); g.set(7, 8, 'white'); return g; },
  badge() { const g = new G(22, 22); const p = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 4.5 : 10; const a = -Math.PI / 2 + k * Math.PI / 5; p.push([11 + r * Math.cos(a), 11.5 + r * Math.sin(a)]); } g.poly(p, 'iron'); g.circ(11, 11.5, 3, 'gold'); return g; },
};

/* ---------- lookups by iconKey (the API sends one for every chest, key and collectible) ---------- */

const ITEM_ICONS = {
  ...ICON,
  magnifier: () => ICON.magnifier(false),
  magnifier_gold: () => ICON.magnifier(true),
};
const KEY_SPRITES = { key_loupe: keySprite, key_gear: bankKey, key_jade: jadeKey };

const CHEST_LOOKS = {
  chest_seal: {
    mech: 'lid', light: '240,164,58', hi: '255,222,150', core: '255,236,190', hole: [23.5, 22], brk: [32.5, 22],
    shards: ['#B8233A', '#F26E80', '#610C1B', '#821829'],
    sprites: () => ({ body: chestBody(true), bodyBare: chestBody(false), lid: chestLid(), under: chestUnderside() }),
  },
  chest_bank: {
    mech: 'door', light: '120,190,230', hi: '205,235,255', core: '236,248,255', hole: [32, 26], brk: [19, 21],
    shards: ['#E8F4FF', '#BEC6D1', '#9FD4E8'],
    sprites: () => ({ frame: safeFrame(), door: safeDoor(), doorBack: safeDoorBack() }),
  },
  chest_whitechapel: {
    mech: 'lid', light: '190,52,58', hi: '255,150,140', core: '255,222,214', hole: [23.5, 35], brk: [33, 32],
    shards: ['#B8233A', '#F26E80', '#610C1B', '#EEF2F8'],
    sprites: () => ({ body: wcBody(true), bodyBare: wcBody(false), lid: wcLid(), under: wcUnderside() }),
  },
  chest_lacquer: {
    mech: 'lid', light: '70,200,150', hi: '170,250,210', core: '222,255,238', hole: [23.5, 29], brk: [23.5, 23],
    shards: ['#3E9A78', '#93E3C1', '#1C5A43', '#C9934E'],
    sprites: () => ({ body: trapBody(true), bodyBare: trapBody(false), lid: trapLid(), under: trapUnderside() }),
  },
};

const memo = new Map();
function once(key, make) {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
}

export function isChestIcon(iconKey) {
  return Object.hasOwn(CHEST_LOOKS, iconKey);
}

/** Every sprite an item can be given, for the admin's picker. Cosmetic sprites are named after their item: frame_dong. */
export const SPRITE_KEYS = {
  items: Object.keys(ITEM_ICONS),
  keys: Object.keys(KEY_SPRITES),
  chests: Object.keys(CHEST_LOOKS),
};

const COSMETIC_KEY = /^(frame|title|entrance)_/;
const COSMETIC_CATEGORY = { frame: 'FRAME', title: 'TITLE', entrance: 'ENTRANCE' };

/** An item that borrows a cosmetic's drawing, by naming it as its icon. */
function borrowedCosmeticSprite(iconKey) {
  return cosmeticSprite({ id: iconKey, category: COSMETIC_CATEGORY[iconKey.match(COSMETIC_KEY)[1]] });
}

/** Icon of a collectible, or of a key when `iconKey` names one. Unknown keys fall back to the magnifier. */
export function itemSprite(iconKey) {
  if (COSMETIC_KEY.test(iconKey ?? '')) return borrowedCosmeticSprite(iconKey);
  return once(`item:${iconKey}`, () => {
    if (KEY_SPRITES[iconKey]) return KEY_SPRITES[iconKey]();
    if (isChestIcon(iconKey)) return { c: closedChestCanvas(iconKey), w: 50, h: 50 };
    return (ITEM_ICONS[iconKey] ?? ITEM_ICONS.magnifier)().render();
  });
}

const IMAGE_SIDE = 192;
const IMAGE_LOGICAL = 48;

/**
 * An uploaded picture as a sprite: the canvas is there at once and the picture lands on it when it arrives, which
 * `ready` announces for whoever copied the canvas meanwhile. A picture that cannot load shows the magnifier.
 */
function imageSprite(url) {
  return once(`image:${url}`, () => {
    const c = document.createElement('canvas');
    c.width = IMAGE_SIDE;
    c.height = IMAGE_SIDE;
    const x = c.getContext('2d');
    const ready = new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const scale = Math.min(IMAGE_SIDE / image.naturalWidth, IMAGE_SIDE / image.naturalHeight);
        const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
        x.imageSmoothingQuality = 'high';
        x.drawImage(image, (IMAGE_SIDE - w) / 2, (IMAGE_SIDE - h) / 2, w, h);
        resolve();
      };
      image.onerror = () => {
        const fallback = itemSprite('magnifier');
        x.imageSmoothingEnabled = false;
        x.drawImage(fallback.c, 0, 0, IMAGE_SIDE, IMAGE_SIDE);
        resolve();
      };
      image.src = url;
    });
    return { c, w: IMAGE_LOGICAL, h: IMAGE_LOGICAL, smooth: true, ready };
  });
}

/** The sprite of any item definition: its cosmetic drawing, then an uploaded picture, then its pixel icon. */
export function defSprite(def) {
  if (isCosmeticDef(def)) return cosmeticSprite(def);
  return def?.visual?.imageUrl ? imageSprite(def.visual.imageUrl) : itemSprite(def?.iconKey);
}

/** Only an upload (https) or a picture shipped under /assets/; anything else is no picture. The server checks the same. */
const PICTURE_URL = /^(https:\/\/|\/assets\/)[^\s"'<>]+$/;
const pictureOf = (url) => (typeof url === 'string' && PICTURE_URL.test(url) ? url : '');

/** A chest's own picture, when an admin gave it one (look.imageUrl). '' means: no picture of its own. */
export const ownChestPictureUrl = (chest) => pictureOf(chest?.look?.imageUrl);

/** The key's own picture (look.keyImageUrl), or ''. */
export const ownKeyPictureUrl = (chest) => pictureOf(chest?.look?.keyImageUrl);

/**
 * What a chest looks like: its own picture, else the picture of the scene an admin made for it (look.scene), else ''
 * (draw its template).
 */
export const chestPictureUrl = (chest) => ownChestPictureUrl(chest) || pictureOf(chest?.look?.scene?.chestImageUrl);

/** The key's picture: its own, else its scene's, else ''. */
export const keyPictureUrl = (chest) => ownKeyPictureUrl(chest) || pictureOf(chest?.look?.scene?.keyImageUrl);

/** A scene's picture (room, particle), checked like every other picture. */
export const scenePictureUrl = (url) => pictureOf(url);

/** A chest for an <img>: its own picture, else its pixel drawing. `chest` needs iconKey and look. */
export function chestIconUrl(chest) {
  return chestPictureUrl(chest) || pixelIconUrl(chest?.iconKey);
}

/** The key as a sprite: its own picture, else its pixel drawing. A picture lands later; see `ready`. */
export function keyArtSprite(chest) {
  const url = keyPictureUrl(chest);
  return url ? imageSprite(url) : itemSprite(chest?.keyIconKey);
}

/** Copies a sprite onto a canvas of any size, centred. */
export function paintSprite(canvas, sprite) {
  const x = canvas.getContext('2d');
  x.imageSmoothingEnabled = !!sprite.smooth;
  x.clearRect(0, 0, canvas.width, canvas.height);
  const s = Math.min(canvas.width / sprite.w, canvas.height / sprite.h);
  x.drawImage(sprite.c, (canvas.width - sprite.w * s) / 2, (canvas.height - sprite.h * s) / 2, sprite.w * s, sprite.h * s);
}

/** Which chest drawing each template of the catalog means. */
const TEMPLATE_ICON = { seal: 'chest_seal', bank: 'chest_bank', lacquer: 'chest_lacquer', whitechapel: 'chest_whitechapel' };

/**
 * Everything the stage needs to draw and open one chest type, with its key. `look` is what an admin chose: it picks the
 * drawing and colours the light. Without one, the drawing follows the icon.
 */
export function chestLook(iconKey, keyIconKey, look) {
  const icon = CHEST_LOOKS[TEMPLATE_ICON[look?.template]] ? TEMPLATE_ICON[look.template] : iconKey;
  const drawing = once(`chest:${icon}:${keyIconKey}`, () => {
    const base = CHEST_LOOKS[icon] ?? CHEST_LOOKS.chest_seal;
    return { ...base, sp: { ...base.sprites(), key: itemSprite(keyIconKey) } };
  });
  return look?.light ? { ...drawing, light: look.light, hi: look.hi, core: look.core } : drawing;
}

function closedChestCanvas(iconKey) {
  const look = CHEST_LOOKS[iconKey], sp = look.sprites();
  const c = document.createElement('canvas'); c.width = 50; c.height = 50;
  const x = c.getContext('2d');
  if (look.mech === 'door') { x.drawImage(sp.frame.c, 0, 3); x.drawImage(sp.door.c, 6, 8); }
  else { x.drawImage(sp.lid.c, 0, 3); x.drawImage(sp.body.c, 0, 21); }
  return c;
}

/**
 * The icon as a square PNG data URL for <img> in the market, or '' when it cannot be drawn
 * (so callers can fall back to their own drawing).
 */
export function pixelIconUrl(iconKey) {
  // A cosmetic's art may still be arriving, so this one is not kept: the next render gets the finished picture.
  if (COSMETIC_KEY.test(iconKey ?? '')) {
    try {
      return borrowedCosmeticSprite(iconKey).c.toDataURL('image/png');
    } catch {
      return '';
    }
  }
  return once(`url:${iconKey}`, () => {
    try {
      if (isChestIcon(iconKey)) return closedChestCanvas(iconKey).toDataURL('image/png');
      const sp = itemSprite(iconKey), side = Math.max(sp.w, sp.h);
      const c = document.createElement('canvas'); c.width = side; c.height = side;
      c.getContext('2d').drawImage(sp.c, Math.floor((side - sp.w) / 2), Math.floor((side - sp.h) / 2));
      return c.toDataURL('image/png');
    } catch {
      return '';
    }
  });
}
