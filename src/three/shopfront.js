// Canvas textures for the first-person shopfronts: name signboard, glass door,
// lit display window and a striped awning. Cached per input so 60 stores share
// a handful of textures instead of allocating one each.
import * as THREE from 'three';

const cache = new Map();
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function make(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function memo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let s = seed || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x9cc7e6;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = (hex) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const mixHex = (a, b, t) => {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// Brand-style signboard: category colour, big name, a thin light border.
export function shopSignTexture(name, color, { active = false, vacant = false } = {}) {
  return memo(`sign|${name}|${color}|${active}|${vacant}`, () => make(512, 128, (c, w, h) => {
    const bg = vacant ? '#55657a' : mixHex(color, '#000000', lum(color) > 0.62 ? 0.5 : 0.18);
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = active ? '#ff3b3b' : 'rgba(255,255,255,.75)'; c.lineWidth = active ? 10 : 4;
    c.strokeRect(active ? 5 : 7, active ? 5 : 7, w - (active ? 10 : 14), h - (active ? 10 : 14));
    const text = (name || '').toUpperCase();
    const dark = lum(bg) > 0.72;
    c.fillStyle = dark ? '#1b1b1f' : '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    let size = active || vacant ? 54 : 66;
    do { c.font = `800 ${size}px ${FONT}`; size -= 2; } while (c.measureText(text).width > w - 56 && size > 18);
    c.fillText(text, w / 2, active || vacant ? h * 0.44 : h * 0.52);
    if (vacant && !active) {
      c.font = `700 22px ${FONT}`; c.fillStyle = '#cfe0f2';
      c.fillText('AVAILABLE · TO LET', w / 2, h * 0.8);
    }
    if (active) {
      c.font = `700 22px ${FONT}`; c.fillStyle = '#ffd9d9';
      c.fillText('YOUR DESTINATION', w / 2, h * 0.82);
    }
  }));
}

// A lit display window: warm interior, shelves with products, glass reflection.
export function shopWindowTexture(color, seedKey, vacant = false) {
  return memo(`win|${color}|${seedKey}|${vacant}`, () => make(256, 256, (c, w, h) => {
    if (vacant) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4f7fb'); g.addColorStop(1, '#dfe6ee');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9d2dd'; c.fillRect(0, h * 0.72, w, h * 0.28);          // bare floor
      c.fillStyle = '#ffffff'; c.fillRect(w * 0.2, h * 0.14, w * 0.6, h * 0.46);
      c.strokeStyle = '#55657a'; c.lineWidth = 5; c.strokeRect(w * 0.2, h * 0.14, w * 0.6, h * 0.46);
      c.fillStyle = '#e5484d'; c.fillRect(w * 0.2, h * 0.14, w * 0.6, h * 0.16);
      c.fillStyle = '#ffffff'; c.font = `800 34px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('TO LET', w / 2, h * 0.22);
      c.fillStyle = '#55657a'; c.font = `700 20px ${FONT}`; c.fillText('Retail space', w / 2, h * 0.42); c.fillText('available', w / 2, h * 0.52);
    } else {
      const r = rng(hash(seedKey));
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#fff7e4'); g.addColorStop(1, '#f0d9a8');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // back wall panel in the shop colour
      c.fillStyle = mixHex(color, '#ffffff', 0.55); c.fillRect(0, 0, w, h * 0.5);
      // shelves + products
      for (let row = 0; row < 3; row++) {
        const y = 66 + row * 66;
        c.fillStyle = 'rgba(70,50,30,.55)'; c.fillRect(8, y, w - 16, 5);
        let x = 14;
        while (x < w - 36) {
          const bw = 18 + r() * 26, bh = 16 + r() * 34, kind = r();
          c.fillStyle = mixHex(color, ['#ffffff', '#222222', '#c0392b', '#2c7be5'][Math.floor(r() * 4)], 0.15 + r() * 0.55);
          if (kind < 0.25) { c.beginPath(); c.ellipse(x + bw / 2, y - bh * 0.5, bw * 0.28, bh * 0.5, 0, 0, Math.PI * 2); c.fill(); c.fillRect(x + bw * 0.4, y - bh * 0.1, bw * 0.2, bh * 0.1); }
          else c.fillRect(x, y - bh, bw, bh);
          x += bw + 6 + r() * 10;
        }
      }
      // ceiling spots
      c.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(32 + i * 64, 8, 5, 0, Math.PI * 2); c.fill(); }
    }
    // glass reflection
    const refl = c.createLinearGradient(0, 0, w, h);
    refl.addColorStop(0, 'rgba(255,255,255,.35)'); refl.addColorStop(0.35, 'rgba(255,255,255,0)'); refl.addColorStop(0.7, 'rgba(255,255,255,.12)'); refl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = refl; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2b2f36'; c.lineWidth = 10; c.strokeRect(0, 0, w, h);
  }));
}

// Glass entrance door with a handle bar and a warm glow from inside.
export function shopDoorTexture(vacant = false) {
  return memo(`door|${vacant}`, () => make(128, 256, (c, w, h) => {
    if (vacant) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#eef3f8'); g.addColorStop(1, '#d4dde8');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.45)';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.55, 0); c.lineTo(0, h * 0.5); c.fill();
    } else {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffeec6'); g.addColorStop(1, '#f6cf88');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(40,60,80,.18)'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.55, 0); c.lineTo(0, h * 0.5); c.fill();
    }
    c.strokeStyle = '#20242b'; c.lineWidth = 12; c.strokeRect(0, 0, w, h);
    c.fillStyle = '#d4d9df'; c.fillRect(w * 0.12, h * 0.4, 8, h * 0.22); c.fillRect(w * 0.88 - 8, h * 0.4, 8, h * 0.22);
    c.strokeStyle = '#20242b'; c.lineWidth = 4; c.beginPath(); c.moveTo(w / 2, 6); c.lineTo(w / 2, h - 6); c.stroke();
  }));
}

export function awningTexture(color) {
  return memo(`awn|${color}`, () => make(256, 32, (c, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#ffffff' : color; c.fillRect((i * w) / n, 0, w / n, h); }
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }));
}

// Soft pool of shop light on the corridor floor (used additively).
export function lightPoolTexture() {
  return memo('pool', () => make(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,224,160,.9)'); g.addColorStop(1, 'rgba(255,224,160,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }));
}
