// Canvas-drawn textures: shopfront roof labels, facility signs and floor tile.
// Drawn locally (no font/image downloads) so the single-file build stays
// self-contained, and painted ON the geometry so labels are depth-correct
// instead of floating DOM overlays.
import * as THREE from 'three';

const cache = new Map();
const FONT = "'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif";

function tex(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

// Store name (up to two lines) + a smaller subtitle (category), painted on
// the block's roof and auto-fit to it: the name is always there, shrinking
// first and truncating with an ellipsis only when even the smallest size
// can't fit.
export function roofLabel(name, sub, w, d) {
  const k = `roof|${name}|${sub}|${w}|${d}`;
  if (cache.has(k)) return cache.get(k);
  const S = Math.min(100, 1000 / Math.max(w, d)), cw = Math.max(8, Math.round(w * S)), ch = Math.max(8, Math.round(d * S));   // capped so ~60 rooms a floor stay light on phones
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const maxW = cw * 0.9, maxH = ch * 0.9;
  const font = (px) => `700 ${px}px ${FONT}`;
  const split = (text) => {
    const words = text.split(' ');
    if (words.length < 2) return [text];
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const l = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const m = Math.max(...l.map((x) => g.measureText(x).width));
      if (!best || m < best.m) best = { l, m };
    }
    return best.l;
  };
  const MIN = Math.max(9, S * 0.16);
  let size = Math.min(ch * 0.34, S * 0.46), lines = [name];
  const fits = () => {
    g.font = font(size);
    const widest = Math.max(...lines.map((x) => g.measureText(x).width));
    const h = size * 1.1 * lines.length + (sub ? size * 0.75 : 0);
    return widest <= maxW && h <= maxH;
  };
  for (;;) {
    g.font = font(size);
    lines = g.measureText(name).width > maxW ? split(name) : [name];
    if (fits() || size <= MIN) break;
    size -= Math.max(1, size * 0.06);
  }
  g.font = font(size);
  // Truncate only if the smallest size still overflows.
  lines = lines.map((x) => {
    if (g.measureText(x).width <= maxW) return x;
    let t = x;
    while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  });
  const showSub = sub && size * 1.1 * lines.length + size * 0.75 <= maxH;
  const total = size * 1.1 * lines.length + (showSub ? size * 0.8 : 0);
  let y = ch / 2 - total / 2 + size * 0.55;
  g.fillStyle = '#231f1a';
  for (const x of lines) { g.fillText(x, cw / 2, y); y += size * 1.1; }
  if (showSub) {
    g.font = `600 ${size * 0.62}px ${FONT}`;
    g.fillStyle = '#6f6556';
    let t = sub;
    while (t.length > 1 && g.measureText(t).width > maxW) t = `${t.slice(0, -2)}…`;
    g.fillText(t, cw / 2, y - size * 0.12);
  }
  const t = tex(c);
  cache.set(k, t);
  return t;
}

// Painted floor text (parking bay numbers, zone names, "LIFT LOBBY").
export function floorText(text, color = '#ffffff', w = 1, d = 0.5, weight = 800) {
  const k = `ft|${text}|${color}|${w}|${d}|${weight}`;
  if (cache.has(k)) return cache.get(k);
  const S = 128, cw = Math.round(w * S), ch = Math.round(d * S);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  let size = ch * 0.8;
  g.font = `${weight} ${size}px ${FONT}`;
  while (g.measureText(text).width > cw * 0.92 && size > 6) { size -= 1; g.font = `${weight} ${size}px ${FONT}`; }
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cw / 2, ch / 2 + size * 0.05);
  const t = tex(c);
  cache.set(k, t);
  return t;
}

// Asphalt with a faint aggregate speckle.
export function asphaltTexture(base = '#3a3e45') {
  const k = `asphalt|${base}`;
  if (cache.has(k)) return cache.get(k);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${v * 0.06})` : `rgba(0,0,0,${v * 0.12})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  const t = tex(c, [10, 30]);
  cache.set(k, t);
  return t;
}

// Square wayfinding sign, like the ones in the reference render.
const SIGN = {
  lift: '#0e9f4f', stairs: '#f08a24', escalator: '#0e9f4f', restroom: '#2f80ff', service: '#138a86', entrance: '#1f6fe0',
};
export function signTexture(kind) {
  const k = `sign|${kind}`;
  if (cache.has(k)) return cache.get(k);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = 36;
  g.fillStyle = '#ffffff';
  roundRect(g, 4, 4, S - 8, S - 8, r + 4); g.fill();
  g.fillStyle = SIGN[kind] || '#555';
  roundRect(g, 14, 14, S - 28, S - 28, r); g.fill();
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
  if (kind === 'lift') {
    g.lineWidth = 10; g.strokeRect(62, 52, 132, 152);
    g.beginPath(); g.moveTo(128, 56); g.lineTo(128, 200); g.stroke();
    tri(g, 95, 92, 22, true); tri(g, 161, 164, 22, false);
  } else if (kind === 'stairs') {
    g.beginPath(); g.moveTo(52, 196); g.lineTo(96, 196); g.lineTo(96, 158); g.lineTo(136, 158); g.lineTo(136, 120); g.lineTo(176, 120); g.lineTo(176, 82); g.lineTo(206, 82); g.stroke();
    g.beginPath(); g.arc(90, 86, 14, 0, Math.PI * 2); g.fill();
  } else if (kind === 'escalator') {
    g.beginPath(); g.moveTo(52, 190); g.lineTo(98, 190); g.lineTo(168, 96); g.lineTo(206, 96); g.stroke();
    g.beginPath(); g.arc(124, 96, 14, 0, Math.PI * 2); g.fill();
    g.lineWidth = 12; g.beginPath(); g.moveTo(124, 118); g.lineTo(112, 150); g.stroke();
  } else if (kind === 'restroom') {
    g.lineWidth = 8; g.beginPath(); g.moveTo(128, 50); g.lineTo(128, 206); g.stroke();
    person(g, 84, false); person(g, 172, true);
  } else if (kind === 'service') {
    g.beginPath(); g.arc(128, 78, 16, 0, Math.PI * 2); g.fill();
    g.fillRect(114, 108, 28, 90);
  } else if (kind === 'entrance') {
    g.lineWidth = 16; g.beginPath(); g.moveTo(128, 200); g.lineTo(128, 70); g.stroke();
    tri(g, 128, 70, 38, true);
  }
  const t = tex(c);
  cache.set(k, t);
  return t;
}
function tri(g, x, y, s, up) {
  g.beginPath();
  if (up) { g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.6); g.lineTo(x - s, y + s * 0.6); }
  else { g.moveTo(x, y + s); g.lineTo(x + s, y - s * 0.6); g.lineTo(x - s, y - s * 0.6); }
  g.closePath(); g.fill();
}
function person(g, x, skirt) {
  g.beginPath(); g.arc(x, 76, 15, 0, Math.PI * 2); g.fill();
  if (skirt) { g.beginPath(); g.moveTo(x, 100); g.lineTo(x + 26, 156); g.lineTo(x - 26, 156); g.closePath(); g.fill(); }
  else g.fillRect(x - 18, 100, 36, 56);
  g.fillRect(x - 14, 150, 10, 50); g.fillRect(x + 4, 150, 10, 50);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Polished floor tiles with faint grout lines.
export function tileTexture(base, grout, repeat = [17, 13]) {
  const k = `tile|${base}|${grout}|${repeat}`;
  if (cache.has(k)) return cache.get(k);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  // soft marble mottling
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 10 + Math.random() * 40, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = grout; g.lineWidth = 2;
  g.strokeRect(1, 1, S - 2, S - 2);
  const t = tex(c, repeat);
  cache.set(k, t);
  return t;
}

// Small orange "% OFFER" badge shown on stores that have live offers.
export function offerBadgeTexture() {
  const k = 'offer-badge';
  if (cache.has(k)) return cache.get(k);
  const W = 256, H = 112, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; roundRect(g, 2, 2, W - 4, H - 4, 50); g.fill();
  g.fillStyle = '#ff7a00'; roundRect(g, 10, 10, W - 20, H - 20, 44); g.fill();
  g.fillStyle = '#fff'; g.font = `800 58px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('% OFFER', W / 2, H / 2 + 3);
  const t = tex(c);
  cache.set(k, t);
  return t;
}

// Panda Hunt markers above a store: 'q' a suspect (gold ?), 'x' checked — not here (red ✕), 'panda' found it.
export function huntBadgeTexture(kind) {
  const k = `hunt|${kind}`;
  if (cache.has(k)) return cache.get(k);
  const S = 160, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  const disc = (r, col) => { g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
  disc(m - 2, '#ffffff');
  disc(m - 10, kind === 'x' ? '#e5484d' : kind === 'panda' ? '#2fb35a' : '#ffb800');
  g.lineWidth = 6; g.strokeStyle = '#1b1b1b'; g.beginPath(); g.arc(m, m, m - 10, 0, Math.PI * 2); g.stroke();
  if (kind === 'panda') {
    const dot = (x, y, r, col) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
    dot(m - 30, m - 30, 17, '#1b1b1b'); dot(m + 30, m - 30, 17, '#1b1b1b');             // ears
    dot(m, m + 6, 46, '#ffffff'); g.lineWidth = 4; g.stroke();                            // face
    g.fillStyle = '#1b1b1b';
    g.beginPath(); g.ellipse(m - 18, m, 11, 15, -0.5, 0, Math.PI * 2); g.fill();         // eye patches
    g.beginPath(); g.ellipse(m + 18, m, 11, 15, 0.5, 0, Math.PI * 2); g.fill();
    dot(m - 17, m - 2, 4, '#ffffff'); dot(m + 17, m - 2, 4, '#ffffff');
    dot(m, m + 20, 7, '#1b1b1b');                                                         // nose
    g.beginPath(); g.arc(m, m + 24, 12, 0.2 * Math.PI, 0.8 * Math.PI); g.lineWidth = 4; g.strokeStyle = '#1b1b1b'; g.stroke();
  } else {
    g.fillStyle = '#ffffff'; g.font = `900 ${kind === 'x' ? 88 : 104}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#1b1b1b'; const t = kind === 'x' ? '✕' : '?';
    g.strokeText(t, m, m + 6); g.fillText(t, m, m + 6);
  }
  const t = tex(c);
  cache.set(k, t);
  return t;
}

// Screen-space store label: name (up to two lines) + unit code, dark text
// with a soft light halo so it reads on cream blocks and on the floor.
// Returned size is in CSS pixels; the canvas is drawn at 2x for sharpness.
export function labelTexture(name, unit) {
  const k = `label|${name}|${unit}`;
  if (cache.has(k)) return cache.get(k);
  const R = 2, NAME = 13 * R, UNIT = 11 * R, PAD = 3 * R, MAXW = 120 * R;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = `650 ${NAME}px ${FONT}`;
  let lines = [name];
  if (g.measureText(name).width > MAXW && name.includes(' ')) {
    const words = name.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const l = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const w = Math.max(...l.map((s) => g.measureText(s).width));
      if (!best || w < best.w) best = { l, w };
    }
    lines = best.l;
  }
  const textW = Math.min(MAXW, Math.max(...lines.map((s) => g.measureText(s).width), unit ? (g.font = `500 ${UNIT}px ${FONT}`, g.measureText(unit).width) : 0));
  const W = Math.ceil(textW + PAD * 2), H = Math.ceil(PAD * 2 + lines.length * NAME * 1.15 + (unit ? UNIT * 1.2 : 0));
  c.width = W; c.height = H;
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.lineJoin = 'round';
  let y = PAD;
  g.font = `650 ${NAME}px ${FONT}`;
  for (const s of lines) {
    g.fillStyle = '#1b2433'; g.fillText(s, W / 2, y, W - PAD);
    y += NAME * 1.15;
  }
  if (unit) {
    g.font = `600 ${UNIT}px ${FONT}`;
    g.fillStyle = '#6b5e43'; g.fillText(unit, W / 2, y + 1);
  }
  const t = tex(c);
  const out = { texture: t, w: W / R, h: H / R };
  cache.set(k, out);
  return out;
}

// Unit code alone ("G7"), for blocks too small on screen for their name.
export function unitTexture(unit) {
  const k = `unit|${unit}`;
  if (cache.has(k)) return cache.get(k);
  const R = 2, SZ = 11 * R, PAD = 2 * R;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = `600 ${SZ}px ${FONT}`;
  const W = Math.ceil(g.measureText(unit).width + PAD * 2), H = Math.ceil(SZ * 1.25 + PAD * 2);
  c.width = W; c.height = H;
  g.font = `600 ${SZ}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillStyle = '#6b5e43'; g.fillText(unit, W / 2, PAD);
  const out = { texture: tex(c), w: W / R, h: H / R };
  cache.set(k, out);
  return out;
}
