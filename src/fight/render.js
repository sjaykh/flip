// Fight mode renderer: everything on the arena canvas is drawn here, in code.
// 256×144 internal resolution, scaled up with crisp pixels. Original art only:
// a bitmap font, procedurally rasterised sprite arrays and a Kochi rooftop stage.
// No game rules here — ui.js passes in a plain "scene" object every frame.

export const ARENA_W = 256;
export const ARENA_H = 144;
const FLOOR_Y = 128;
export const PLAYER_X = 74;
export const ANXIETY_X = 186;

// ---------- Bitmap font (5×7, original) ----------

const GLYPHS = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '####. ....# ....# .###. ....# ....# ####.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '.###. #.... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ....# .###.',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '/': '....# ...#. ...#. ..#.. .#... .#... #....',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
};
const FONT = Object.fromEntries(Object.entries(GLYPHS).map(([k, v]) => [k, v.split(' ')]));

export function textWidth(str, scale = 1) {
  return str.length ? (str.length * 6 - 1) * scale : 0;
}

/** Draws pixel text. `colors` may be one colour or [top, bottom] for a two-tone fill. */
export function drawText(ctx, str, x, y, { scale = 1, color = '#fff', outline = null, align = 'left' } = {}) {
  const s = String(str).toUpperCase();
  let x0 = Math.round(align === 'center' ? x - textWidth(s, scale) / 2 : align === 'right' ? x - textWidth(s, scale) : x);
  const y0 = Math.round(y);
  const paint = (dx, dy, fill) => {
    let cx = x0 + dx;
    for (const ch of s) {
      const g = FONT[ch] || FONT['?'];
      for (let r = 0; r < 7; r++) {
        ctx.fillStyle = Array.isArray(fill) ? (r < 4 ? fill[0] : fill[1]) : fill;
        for (let c = 0; c < 5; c++) {
          if (g[r][c] === '#') ctx.fillRect(cx + c * scale, y0 + dy + r * scale, scale, scale);
        }
      }
      cx += 6 * scale;
    }
  };
  if (outline) {
    const o = Math.max(1, Math.round(scale / 2));
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o], [0, o * 2]]) paint(dx, dy, outline);
  }
  paint(0, 0, color);
  x0 += 0;
}

// ---------- Small helpers ----------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Deterministic PRNG for scenery so the stage looks the same every time. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// ---------- Sprite rasteriser ----------
// A sprite is a grid of palette indices built from a pose (joint positions), then
// given a 1px dark outline. Rasterised once per frame type and cached as a canvas.

class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h);
  }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  get(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : 0;
  }
  dot(x, y, r, c) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) this.set(x + dx, y + dy, c);
  }
  line([x0, y0], [x1, y1], c, r = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, c);
  }
  outline(c) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
    }
    add.forEach(([x, y]) => this.set(x, y, c));
  }
  toCanvas(palette) {
    const [cv, cx] = makeCanvas(this.w, this.h);
    const img = cx.createImageData(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) {
      const p = this.px[i];
      if (!p) continue;
      const [r, g, b] = hexToRgb(palette[p]);
      img.data.set([r, g, b, 255], i * 4);
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }
}

// Player: an original fighter in a hoodie, facing right. 32×40 grid, feet on row 39.
const PLAYER_PAL = [null, '#160f22', '#b07a52', '#3d8a76', '#2b6457', '#2a2d4d', '#efe6d6', '#241a19', '#f0aa4c', '#160f22'];
const P = { OUT: 1, SKIN: 2, HOOD: 3, SHADE: 4, PANTS: 5, SHOE: 6, HAIR: 7, CORD: 8, EYE: 9 };

const POSES = {
  idle0: { hip: [15, 25], chest: [16, 14], head: [17, 7], aB: [[12, 19], [18, 17]], aF: [[21, 19], [24, 13]], lB: [[12, 31], [10, 38]], lF: [[19, 31], [21, 38]] },
  idle1: { hip: [15, 26], chest: [16, 15], head: [17, 8], aB: [[12, 20], [18, 18]], aF: [[21, 20], [24, 14]], lB: [[12, 32], [10, 38]], lF: [[19, 32], [21, 38]] },
  jab: { hip: [15, 25], chest: [17, 14], head: [18, 7], aB: [[13, 20], [18, 18]], aF: [[23, 14], [30, 13]], lB: [[11, 31], [8, 38]], lF: [[20, 31], [23, 38]] },
  kick: { hip: [14, 24], chest: [12, 14], head: [11, 7], aB: [[8, 18], [6, 13]], aF: [[16, 19], [20, 14]], lB: [[14, 31], [13, 38]], lF: [[22, 23], [31, 20]] },
  uppercut: { hip: [15, 26], chest: [17, 14], head: [17, 7], aB: [[12, 20], [15, 22]], aF: [[23, 12], [24, 3]], lB: [[11, 32], [8, 38]], lF: [[20, 32], [22, 38]] },
  block: { hip: [14, 25], chest: [14, 14], head: [14, 8], aB: [[19, 18], [21, 9]], aF: [[22, 17], [20, 8]], lB: [[11, 31], [8, 38]], lF: [[18, 31], [20, 38]] },
  hit: { hip: [15, 26], chest: [12, 15], head: [9, 9], aB: [[8, 18], [4, 14]], aF: [[16, 20], [20, 24]], lB: [[12, 32], [9, 38]], lF: [[19, 32], [22, 38]] },
  getup: { hip: [15, 31], chest: [16, 21], head: [17, 14], aB: [[12, 26], [14, 31]], aF: [[20, 26], [21, 30]], lB: [[12, 37], [7, 38]], lF: [[21, 32], [21, 38]] },
  down: { hip: [19, 35], chest: [10, 35], head: [4, 34], aB: [[8, 31], [12, 30]], aF: [[14, 32], [17, 30]], lB: [[24, 36], [30, 37]], lF: [[24, 34], [30, 35]] },
};

function rasterPlayer(pose) {
  const g = new Grid(32, 40);
  const p = POSES[pose];
  const [hx, hy] = p.head;
  // back limbs first (in shade)
  g.line(p.chest, p.aB[0], P.SHADE, 1); g.line(p.aB[0], p.aB[1], P.SHADE, 1); g.dot(...p.aB[1], 1, P.SKIN);
  g.line(p.hip, p.lB[0], P.PANTS, 1); g.line(p.lB[0], p.lB[1], P.PANTS, 1);
  g.line([p.lB[1][0] - 1, p.lB[1][1]], [p.lB[1][0] + 2, p.lB[1][1]], P.SHOE, 0);
  // torso (hoodie)
  g.line(p.chest, p.hip, P.HOOD, 3);
  g.line([p.hip[0] - 3, p.hip[1]], [p.hip[0] + 3, p.hip[1]], P.SHADE, 0);
  g.set(p.chest[0] + 1, p.chest[1] + 1, P.CORD); g.set(p.chest[0] + 1, p.chest[1] + 3, P.CORD);
  // front leg
  g.line(p.hip, p.lF[0], P.PANTS, 1); g.line(p.lF[0], p.lF[1], P.PANTS, 1);
  g.line([p.lF[1][0] - 1, p.lF[1][1]], [p.lF[1][0] + 2, p.lF[1][1]], P.SHOE, 0);
  // head: hood, face, fringe, eye
  g.dot(hx, hy, 5, P.HOOD);
  g.dot(hx + 1, hy + 1, 3, P.SKIN);
  g.line([hx - 2, hy - 2], [hx + 3, hy - 2], P.HAIR, 0);
  g.set(hx + 3, hy, P.EYE);
  g.set(hx + 2, hy + 3, P.SHADE);
  // front arm on top
  g.line(p.chest, p.aF[0], P.HOOD, 1); g.line(p.aF[0], p.aF[1], P.HOOD, 1); g.dot(...p.aF[1], 1, P.SKIN);
  g.outline(P.OUT);
  return g.toCanvas(PLAYER_PAL);
}

// Anxiety: an original shadow creature with glowing eyes. Built per size bucket and
// frame: idle A/B (flicker), throw (tendril out towards the player), hit (squash, X eyes).
function rasterAnxiety(bucket, frame, darkness) {
  const rx = 7 + bucket * 0.65;
  const ry = rx * 1.12;
  const w = Math.ceil(rx * 2 + 22);
  const h = Math.ceil(ry * 2 + 16);
  const g = new Grid(w, h);
  const cx = w / 2 + 4;
  const cy = h - ry - 2;
  const squash = frame === 'hit' ? [1.12, 0.86] : [1, 1];
  const phase = frame === 'idleB' ? 1.3 : frame === 'throw' ? 2.1 : 0;
  const BODY = 2; const CORE = 3; const RIM = 4; const EYE = 5; const GLOW = 6; const MOUTH = 7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (rx * squash[0]);
      const dy = (y - cy) / (ry * squash[1]);
      const ang = Math.atan2(dy, dx);
      // wobbly edge + wisps on top
      let edge = 1 + 0.07 * Math.sin(ang * 5 + phase) + 0.05 * Math.sin(ang * 9 - phase * 2);
      if (dy < -0.2) edge += 0.22 * Math.max(0, Math.sin(ang * 4 + phase * 1.5)) ** 3;
      const d = Math.hypot(dx, dy);
      if (d < edge && dy < 0.98) g.set(x, y, d < edge * 0.55 ? CORE : d > edge - 0.12 && dx < 0 ? RIM : BODY);
    }
  }
  if (frame === 'throw') {
    g.line([cx - rx * 0.6, cy + 1], [cx - rx - 8, cy - 4], BODY, 2);
    g.dot(cx - rx - 9, cy - 5, 2, RIM);
  }
  // eyes
  const ex = Math.round(rx * 0.32);
  const ey = Math.round(cy - ry * 0.2);
  const eyeR = Math.max(1, Math.round(rx / 9));
  [cx - ex - 2, cx + ex - 3].forEach((x) => {
    if (frame === 'hit') {
      g.line([x - eyeR, ey - eyeR], [x + eyeR, ey + eyeR], EYE, 0);
      g.line([x - eyeR, ey + eyeR], [x + eyeR, ey - eyeR], EYE, 0);
    } else {
      g.dot(x, ey, eyeR + 1, GLOW);
      g.dot(x, ey, eyeR, EYE);
    }
  });
  // mouth: jagged when throwing, a thin line otherwise
  const my = Math.round(cy + ry * 0.25);
  if (frame === 'throw') {
    for (let i = -3; i <= 3; i++) g.set(cx - 3 + i * 1.5, my + (i % 2 ? 1 : -1), MOUTH);
    g.dot(cx - 3, my + 1, 1, MOUTH);
  } else if (bucket > 2) {
    for (let i = -2; i <= 2; i++) g.set(cx - 3 + i * 2, my + (i % 2 ? 0 : 1), MOUTH);
  }
  g.outline(1);
  const pal = [
    null,
    '#07050c',
    mix('#4a3d68', '#1a1028', darkness),
    mix('#3a2f54', '#0d0816', darkness),
    mix('#7a68a8', '#3d2a5e', darkness),
    '#fff3b0',
    mix('#ffb347', '#ff6a3d', darkness),
    mix('#c9b8ff', '#ff8a6b', darkness),
  ];
  return { canvas: g.toCanvas(pal), w, h, mouth: [cx - rx - 6, cy - 4] };
}

// ---------- Stage: a Kochi rooftop at night ----------

function buildStage() {
  const rnd = seeded(2024);
  const SW = ARENA_W + 64; // wider than the arena for parallax

  // Sky with dithered bands, stars and a moon.
  const [sky, s] = makeCanvas(ARENA_W, ARENA_H);
  const bands = ['#0b0a1d', '#0f0d26', '#15122f', '#1c1638', '#251b42', '#33234c', '#46304f'];
  for (let y = 0; y < 100; y++) {
    const t = (y / 100) * (bands.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    for (let x = 0; x < ARENA_W; x++) {
      const dither = ((x + y) % 2 ? 0.25 : 0.75);
      s.fillStyle = f > dither ? bands[Math.min(i + 1, bands.length - 1)] : bands[i];
      s.fillRect(x, y, 1, 1);
    }
  }
  s.fillStyle = '#46304f';
  s.fillRect(0, 100, ARENA_W, 44);
  // moon (crescent)
  s.fillStyle = '#f3e7c4';
  for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
    if (x * x + y * y <= 49 && (x - 3) * (x - 3) + (y + 1) * (y + 1) > 30) s.fillRect(132 + x, 50 + y, 1, 1);
  }
  const stars = Array.from({ length: 46 }, () => [Math.floor(rnd() * ARENA_W), 34 + Math.floor(rnd() * 40), rnd()]);
  stars.forEach(([x, y]) => { s.fillStyle = '#8c86b8'; s.fillRect(x, y, 1, 1); });

  // Far: harbour water, far shore lights and cantilevered fishing nets.
  const [far, f] = makeCanvas(SW, ARENA_H);
  f.fillStyle = '#0e1030';
  f.fillRect(0, 84, SW, 30);
  for (let y = 86; y < 114; y += 3) {
    for (let x = 0; x < SW; x += 1) {
      if (rnd() < 0.08) { f.fillStyle = rnd() < 0.5 ? '#2b2f66' : '#3a3470'; f.fillRect(x, y, 2 + Math.floor(rnd() * 4), 1); }
    }
  }
  f.fillStyle = '#0a0a20';
  f.fillRect(0, 80, SW, 5);
  for (let x = 0; x < SW; x += 3) if (rnd() < 0.35) { f.fillStyle = rnd() < 0.7 ? '#f7c76b' : '#9fe0d4'; f.fillRect(x, 81 + Math.floor(rnd() * 2), 1, 1); }
  // Fishing nets: tall timber frames tipped over the water with a sagging net.
  [[30, 1], [70, -1], [262, 1]].forEach(([nx, dir]) => {
    f.strokeStyle = '#05040e';
    f.lineWidth = 1;
    f.beginPath();
    f.moveTo(nx, 84); f.lineTo(nx + dir * 16, 60);
    f.moveTo(nx + dir * 4, 84); f.lineTo(nx + dir * 22, 62);
    f.moveTo(nx + dir * 16, 60); f.lineTo(nx + dir * 30, 74);
    f.moveTo(nx + dir * 22, 62); f.lineTo(nx + dir * 8, 74);
    f.stroke();
    f.fillStyle = '#05040e';
    for (let i = 0; i <= 22; i++) {
      const x = nx + dir * (8 + i);
      const y = 74 + Math.round(Math.sin((i / 22) * Math.PI) * 4);
      f.fillRect(x, y, 1, 1);
      if (i % 3 === 0) f.fillRect(x, y - 1, 1, 1);
    }
  });

  // Mid: city skyline with lit windows and a church spire.
  const [mid, m] = makeCanvas(SW, ARENA_H);
  let x = 0;
  const lights = [];
  while (x < SW) {
    const bw = 10 + Math.floor(rnd() * 18);
    const bh = 14 + Math.floor(rnd() * 32);
    const top = 104 - bh;
    m.fillStyle = rnd() < 0.5 ? '#100d24' : '#141029';
    m.fillRect(x, top, bw, bh + 40);
    for (let wy = top + 3; wy < 100; wy += 4) for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
      if (rnd() < 0.28) { const c = rnd() < 0.8 ? '#f5c76b' : '#86d8c8'; m.fillStyle = c; m.fillRect(wx, wy, 1, 2); lights.push([wx, wy, c]); }
    }
    x += bw + Math.floor(rnd() * 3);
  }
  m.fillStyle = '#120f27';
  m.fillRect(150, 52, 8, 52);
  m.beginPath(); m.moveTo(149, 52); m.lineTo(154, 38); m.lineTo(159, 52); m.fill();
  m.fillStyle = '#f5c76b';
  m.fillRect(153, 58, 2, 3);
  m.fillStyle = '#e8e2d0';
  m.fillRect(154, 34, 1, 5); m.fillRect(152, 35, 5, 1);

  // Near: coconut palms (silhouettes with a hint of green).
  const [near, n] = makeCanvas(SW, ARENA_H);
  const palm = (bx, lean, height) => {
    let px = bx;
    let py = 116;
    n.fillStyle = '#0a0814';
    for (let i = 0; i < height; i++) {
      px += lean * (0.15 + i / height * 0.6);
      py -= 1;
      n.fillRect(Math.round(px) - 1, py, 3, 1);
      if (i % 4 === 0) { n.fillStyle = '#1a1626'; n.fillRect(Math.round(px) - 1, py, 3, 1); n.fillStyle = '#0a0814'; }
    }
    const top = [Math.round(px), py];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      const len = 16 + (k % 3) * 4;
      for (let j = 0; j < len; j++) {
        const fx = top[0] + Math.cos(a) * j;
        const fy = top[1] + Math.sin(a) * j * 0.55 + (j * j) / (len * 1.6);
        n.fillStyle = j % 3 === 0 ? '#16302a' : '#0b1512';
        n.fillRect(Math.round(fx), Math.round(fy), 2, 1);
        if (j % 2 === 0) n.fillRect(Math.round(fx), Math.round(fy) + 1, 1, 2);
      }
    }
    n.fillStyle = '#2a2016';
    n.fillRect(top[0] - 2, top[1] + 1, 2, 2); n.fillRect(top[0] + 1, top[1] + 2, 2, 2);
  };
  palm(18, 0.9, 74);
  palm(282, -0.8, 82);
  palm(296, -0.4, 60);

  // Rooftop (moves 1:1 with the camera): parapet, floor, water tank, antenna, clothesline.
  const [roof, r] = makeCanvas(SW, ARENA_H);
  r.fillStyle = '#4a4258';
  r.fillRect(0, 106, SW, 2);
  r.fillStyle = '#342e44';
  r.fillRect(0, 108, SW, 8);
  for (let i = 0; i < SW; i += 12) { r.fillStyle = '#2b2639'; r.fillRect(i, 108, 1, 8); }
  r.fillStyle = '#3b3447';
  r.fillRect(0, 116, SW, 28);
  for (let y = 120; y < ARENA_H; y += 7) { r.fillStyle = '#332d40'; r.fillRect(0, y, SW, 1); }
  for (let y = 116; y < ARENA_H; y += 7) for (let i = (y % 14 ? 0 : 9); i < SW; i += 18) { r.fillStyle = '#332d40'; r.fillRect(i, y, 1, 7); }
  r.fillStyle = '#5a5168';
  r.fillRect(0, 116, SW, 1);
  // water tank on a stand (classic black rooftop tank)
  r.fillStyle = '#2a2436';
  r.fillRect(236, 98, 2, 10); r.fillRect(258, 98, 2, 10);
  r.fillStyle = '#121018';
  r.fillRect(232, 70, 32, 30);
  r.fillRect(234, 68, 28, 2);
  r.fillStyle = '#1e1a28';
  for (let yy = 74; yy < 100; yy += 6) r.fillRect(232, yy, 32, 1);
  r.fillStyle = '#2c2638';
  r.fillRect(236, 70, 2, 30);
  r.fillStyle = '#121018';
  r.fillRect(244, 64, 8, 4);
  // antenna + clothesline
  r.fillStyle = '#1b1726';
  r.fillRect(40, 70, 1, 38); r.fillRect(34, 74, 13, 1); r.fillRect(36, 80, 9, 1);
  // potted plants on the parapet
  [[112, '#1d3a2e'], [150, '#25452f']].forEach(([px, leaf]) => {
    r.fillStyle = '#6b3e2e'; r.fillRect(px, 100, 7, 6);
    r.fillStyle = leaf; r.fillRect(px - 1, 95, 9, 5); r.fillRect(px + 2, 92, 3, 3);
  });

  return { sky, far, mid, near, roof, stars, lights, SW };
}

// ---------- Renderer ----------

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const stage = buildStage();
  const playerFrames = {};
  const anxietyFrames = new Map();
  const whiteCache = new Map();

  const playerSprite = (pose) => (playerFrames[pose] ||= rasterPlayer(pose));
  const anxietySprite = (bucket, frame, dark) => {
    const key = `${bucket}:${frame}:${dark}`;
    if (!anxietyFrames.has(key)) anxietyFrames.set(key, rasterAnxiety(bucket, frame, dark / 4));
    return anxietyFrames.get(key);
  };
  const white = (src) => {
    if (whiteCache.has(src)) return whiteCache.get(src);
    const [c, x] = makeCanvas(src.width, src.height);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, c.width, c.height);
    whiteCache.set(src, c);
    return c;
  };

  function drawStage(t, camX, reduced) {
    ctx.drawImage(stage.sky, 0, 0);
    if (!reduced) {
      stage.stars.forEach(([x, y, p], i) => {
        if (Math.sin(t / 700 + p * 40 + i) > 0.85) { ctx.fillStyle = '#e8e4ff'; ctx.fillRect(x, y, 1, 1); }
      });
    }
    const off = (k) => Math.round(-32 - camX * k);
    ctx.drawImage(stage.far, off(0.15), 0);
    // ships drifting across the harbour
    const ships = [[(t / 900) % (ARENA_W + 80) - 40, 90, 22], [ARENA_W - ((t / 1400 + 120) % (ARENA_W + 80)) + 20, 97, 30]];
    ships.forEach(([sx, sy, len]) => {
      const x = Math.round(sx - camX * 0.15);
      ctx.fillStyle = '#06061a';
      ctx.fillRect(x, sy, len, 3);
      ctx.fillRect(x + 3, sy - 3, len * 0.5, 3);
      ctx.fillRect(x + len * 0.6, sy - 6, 3, 6);
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(x + 4, sy - 2, 1, 1); ctx.fillRect(x + 8, sy - 2, 1, 1);
      ctx.fillStyle = '#ff6b5e';
      ctx.fillRect(x + len - 1, sy - 1, 1, 1);
      ctx.fillStyle = 'rgba(255,210,122,0.35)';
      ctx.fillRect(x + 3, sy + 4, 6, 1);
    });
    ctx.drawImage(stage.mid, off(0.35), 0);
    if (!reduced) {
      const i = Math.floor(t / 1200) % stage.lights.length;
      const [lx, ly] = stage.lights[i];
      ctx.fillStyle = '#100d24';
      ctx.fillRect(lx + off(0.35), ly, 1, 2);
    }
    ctx.drawImage(stage.near, off(0.6), 0);
    ctx.drawImage(stage.roof, off(1), 0);
  }

  function drawPlayer(scene, camX) {
    const pose = scene.playerPose;
    const sprite = playerSprite(pose === 'idle' ? (Math.floor(scene.t / 450) % 2 ? 'idle1' : 'idle0') : pose);
    const lunge = pose === 'jab' || pose === 'uppercut' ? 6 : pose === 'kick' ? 4 : pose === 'hit' ? -6 : 0;
    const x = Math.round(PLAYER_X - 32 + lunge - camX);
    const y = FLOOR_Y - 80;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(PLAYER_X - 18 - camX), FLOOR_Y - 1, 36, 3);
    ctx.drawImage(sprite, x, y, 64, 80);
    if (scene.playerFlash) ctx.drawImage(white(sprite), x, y, 64, 80);
  }

  function drawAnxiety(scene, camX) {
    const size = Math.max(0.02, scene.anxietySize);
    const bucket = Math.max(0, Math.min(14, Math.round(size * 14)));
    const dark = Math.max(0, Math.min(4, Math.round(size * 4)));
    let frame = scene.anxietyPose;
    if (frame === 'idle') frame = scene.reduced ? 'idleA' : (Math.floor(scene.t / 260) % 5 === 0 ? 'idleB' : 'idleA');
    const spr = anxietySprite(bucket, frame, dark);
    const sc = 2;
    const x = Math.round(ANXIETY_X - (spr.w * sc) / 2 - camX + (frame === 'hit' ? 5 : 0));
    const y = Math.round(FLOOR_Y + 2 - spr.h * sc);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(Math.round(ANXIETY_X - spr.w * 0.7 - camX), FLOOR_Y - 1, Math.round(spr.w * 1.4), 3);
    ctx.drawImage(spr.canvas, x, y, spr.w * sc, spr.h * sc);
    if (scene.anxietyFlash) ctx.drawImage(white(spr.canvas), x, y, spr.w * sc, spr.h * sc);
  }

  function bar(x, y, w, frac, ghost, fromRight, color) {
    ctx.fillStyle = '#100b1c';
    ctx.fillRect(x - 1, y - 1, w + 2, 9);
    ctx.fillStyle = '#3a1020';
    ctx.fillRect(x, y, w, 7);
    const fill = Math.round(w * Math.max(0, Math.min(1, frac)));
    const g = Math.round(w * Math.max(0, Math.min(1, ghost)));
    // P1 is anchored at the centre and drains left→right; P2 mirrors it.
    const fx = (len) => (fromRight ? x + w - len : x);
    ctx.fillStyle = '#e8483f';
    ctx.fillRect(fx(g), y, g, 7);
    ctx.fillStyle = color[0];
    ctx.fillRect(fx(fill), y, fill, 5);
    ctx.fillStyle = color[1];
    ctx.fillRect(fx(fill), y + 5, fill, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(fx(fill), y, fill, 1);
  }

  function portrait(x, y, which) {
    ctx.fillStyle = '#100b1c';
    ctx.fillRect(x, y, 14, 14);
    ctx.fillStyle = which === 'you' ? '#2b6457' : '#2a1d40';
    ctx.fillRect(x + 1, y + 1, 12, 12);
    if (which === 'you') {
      ctx.drawImage(playerSprite('idle0'), 11, 1, 13, 13, x + 1, y + 1, 12, 12);
    } else {
      ctx.fillStyle = '#1a1028';
      ctx.fillRect(x + 2, y + 4, 10, 9); ctx.fillRect(x + 3, y + 3, 8, 1); ctx.fillRect(x + 5, y + 2, 2, 1);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(x + 4, y + 6, 2, 2); ctx.fillRect(x + 8, y + 6, 2, 2);
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(x + 4, y + 6, 1, 1); ctx.fillRect(x + 8, y + 6, 1, 1);
    }
  }

  function drawHud(h) {
    drawText(ctx, `STREAK ${h.streak}`, 4, 2, { color: '#ffe08a', outline: '#120c1c' });
    drawText(ctx, `SCORE ${String(h.score).padStart(4, '0')}`, ARENA_W - 4, 2, { color: '#ffe08a', outline: '#120c1c', align: 'right' });
    portrait(3, 11, 'you');
    portrait(ARENA_W - 17, 11, 'anx');
    bar(19, 13, 96, h.playerHp / h.playerMax, h.playerGhost / h.playerMax, true, ['#ffd23f', '#d99a1e']);
    bar(ARENA_W - 115, 13, 96, h.anxietyHp / h.anxietyMax, h.anxietyGhost / h.anxietyMax, false, ['#ffd23f', '#d99a1e']);
    // K.O. badge between the bars
    ctx.fillStyle = '#100b1c';
    ctx.fillRect(117, 11, 22, 11);
    ctx.fillStyle = h.koLit ? '#e8483f' : '#5a1f2a';
    ctx.fillRect(118, 12, 20, 9);
    drawText(ctx, 'KO', 128, 13, { color: h.koLit ? '#fff3b0' : '#c98b7a', align: 'center' });
    drawText(ctx, h.playerName, 19, 23, { color: '#f4ecff', outline: '#120c1c' });
    drawText(ctx, h.anxietyName, ARENA_W - 19, 23, { color: '#f4ecff', outline: '#120c1c', align: 'right' });
    drawText(ctx, String(Math.max(0, Math.ceil(h.timer))).padStart(2, '0'), 128, 24, {
      scale: 2, color: ['#fff3b0', '#ffb347'], outline: '#120c1c', align: 'center',
    });
    for (let i = 0; i < h.rounds; i++) {
      ctx.fillStyle = '#120c1c';
      ctx.fillRect(119 + i * 7, 41, 5, 5);
      ctx.fillStyle = i < h.round ? '#ffd23f' : '#3a2a4a';
      ctx.fillRect(120 + i * 7, 42, 3, 3);
    }
  }

  function drawBanner(b, t, reduced) {
    if (!b) return;
    const age = t - b.at;
    const base = b.scale || 4;
    const scale = reduced ? base : age < 90 ? base + 3 : age < 160 ? base + 1 : base;
    const lines = String(b.text).split('\n');
    const lh = 9 * scale;
    const y0 = ARENA_H / 2 - (lines.length * lh) / 2 - 4;
    lines.forEach((ln, i) => {
      let s = scale;
      while (s > 1 && textWidth(ln, s) > ARENA_W - 12) s -= 1;
      drawText(ctx, ln, ARENA_W / 2, y0 + i * lh, { scale: s, color: b.color || ['#fff3b0', '#ffb347'], outline: '#1a0f12', align: 'center' });
    });
  }

  function drawFloaters(list, t, camX) {
    list.forEach((fl) => {
      const age = t - fl.at;
      const k = Math.min(1, age / fl.life);
      ctx.globalAlpha = fl.static ? 1 : 1 - k * k;
      drawText(ctx, fl.text, fl.x - camX, fl.y - (fl.static ? 0 : k * 18), {
        scale: fl.scale || 2, color: fl.color || ['#fff3b0', '#ffb347'], outline: '#1a0f12', align: 'center',
      });
    });
    ctx.globalAlpha = 1;
  }

  function drawParticles(list, t, camX) {
    list.forEach((p) => {
      const age = (t - p.at) / 1000;
      if (age > p.life) return;
      const x = p.x + p.vx * age - camX;
      const y = p.y + p.vy * age + 60 * age * age;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(x), Math.round(y), p.size, p.size);
    });
  }

  /** Draws one frame. `scene` is assembled by ui.js. */
  function draw(scene) {
    const reduced = scene.reduced;
    let camX = reduced ? 0 : Math.sin(scene.t / 2600) * 5;
    let shakeX = 0;
    let shakeY = 0;
    if (!reduced && scene.shakeUntil > scene.t) {
      const k = (scene.shakeUntil - scene.t) / 250;
      shakeX = Math.round((Math.sin(scene.t * 1.7) * 2) * k);
      shakeY = Math.round((Math.cos(scene.t * 2.3) * 1.5) * k);
    }
    ctx.setTransform(1, 0, 0, 1, shakeX, shakeY);
    drawStage(scene.t, camX, reduced);
    drawAnxiety(scene, camX);
    drawPlayer(scene, camX);
    drawParticles(scene.particles, scene.t, camX);
    drawFloaters(scene.floaters, scene.t, camX);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHud(scene.hud);
    drawBanner(scene.banner, scene.t, reduced);
    if (scene.dim) {
      ctx.fillStyle = 'rgba(8,6,16,0.55)';
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    }
    camX += 0;
  }

  return { draw, anxietyMouth: () => [ANXIETY_X - 30, 70] };
}

/** Small standalone preview of anxiety for the strength screen. */
export function drawAnxietyPreview(canvas, size) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = canvas.width;
  const H = canvas.height;
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#15122f');
  grd.addColorStop(1, '#3b2a4c');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3b3447';
  ctx.fillRect(0, H - 10, W, 10);
  ctx.fillStyle = '#5a5168';
  ctx.fillRect(0, H - 10, W, 1);
  const bucket = Math.max(0, Math.min(14, Math.round(size * 14)));
  const spr = rasterAnxiety(bucket, 'idleA', Math.round(size * 4) / 4);
  const sc = 2;
  ctx.drawImage(spr.canvas, Math.round(W / 2 - (spr.w * sc) / 2), H - 8 - spr.h * sc, spr.w * sc, spr.h * sc);
}
