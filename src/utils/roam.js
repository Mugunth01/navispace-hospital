// Free "street view" roaming: move along the corridors of a floor without a
// destination, take a guided round of the floor, or stand in front of a shop.
// Pure functions only (no three.js / React) so the tests can run them directly.
import { walkwayGraph } from './routing.js';
import { escalators, lifts } from '../data/floors.js';

// Distance between viewpoints, in scene units (1 unit = METRES_PER_UNIT metres).
export const ROAM_STEP = 2;
// One arrow press moves at least this far, so tight ring corridors don't crawl.
const MIN_HOP = 1.7;
// A move must be at least this well aligned with the wanted direction.
const MIN_ALIGN = 0.3;

const TAU = Math.PI * 2;
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------------------
// Dense viewpoint graph: the walkway graph with extra nodes along long edges.
// ---------------------------------------------------------------------------
const cache = new Map();
export function roamGraph(floor) {
  if (cache.has(floor)) return cache.get(floor);
  const g = walkwayGraph(floor);
  const nodes = new Map(), adj = new Map();
  const add = (k, p) => { if (!nodes.has(k)) { nodes.set(k, p); adj.set(k, []); } };
  const link = (a, b) => { if (a !== b && !adj.get(a).includes(b)) { adj.get(a).push(b); adj.get(b).push(a); } };
  for (const [k, p] of g.nodes) add(k, p);
  for (const [u, list] of g.adj) {
    for (const [v, w] of list) {
      if (u > v) continue;                                    // each edge once
      const [ux, uy] = g.nodes.get(u), [vx, vy] = g.nodes.get(v);
      const n = Math.max(1, Math.round(w / ROAM_STEP));
      let prev = u;
      for (let i = 1; i < n; i++) {
        const k = `${u}|${v}|${i}`;
        add(k, [ux + ((vx - ux) * i) / n, uy + ((vy - uy) * i) / n]);
        link(prev, k); prev = k;
      }
      link(prev, v);
    }
  }
  const out = { nodes, adj };
  if (cache.size > 40) cache.clear();
  cache.set(floor, out);
  return out;
}

export function nearestRoamNode(graph, [x, y]) {
  let best = null, bd = Infinity;
  for (const [k, p] of graph.nodes) {
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

const angleOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

// Best neighbour of `key` for a wanted direction `want` (radians), or null.
function pickNeighbour(graph, key, want, exclude) {
  const p = graph.nodes.get(key);
  let best = null, bc = MIN_ALIGN;
  for (const n of graph.adj.get(key) || []) {
    if (n === exclude) continue;
    const q = graph.nodes.get(n);
    const c = Math.cos(wrapAngle(angleOf(p, q) - want));
    if (c > bc) { bc = c; best = n; }
  }
  return best;
}

// Walk from `key` roughly towards `want`, until at least MIN_HOP has been covered
// (or the corridor ends / turns away). Returns { key, point, heading, dist } or null.
export function hop(graph, key, want) {
  let cur = key, dir = want, dist = 0, prev = null;
  for (let i = 0; i < 8 && dist < MIN_HOP; i++) {
    const nxt = pickNeighbour(graph, cur, dir, prev);
    if (!nxt) break;
    const a = graph.nodes.get(cur), b = graph.nodes.get(nxt);
    dist += Math.hypot(b[0] - a[0], b[1] - a[1]);
    dir = angleOf(a, b); prev = cur; cur = nxt;
  }
  if (cur === key) return null;
  return { key: cur, point: graph.nodes.get(cur), heading: dir, dist };
}

// One press of ›  (forward) or ‹  (back) while looking along `facing`.
//   ›  tries ahead, then the right-hand side (so it works facing a shopfront);
//   ‹  tries behind, then the left-hand side.
// `heading` is where the camera should face afterwards: moving forward turns
// you to follow the corridor, anything else keeps looking where you were.
export function stepRoam(graph, key, facing, dir) {
  const fwd = dir >= 0;
  const first = fwd ? facing : facing + Math.PI;
  const side = fwd ? facing - Math.PI / 2 : facing + Math.PI / 2;
  let m = hop(graph, key, first);
  let forward = !!m && fwd;
  if (!m) { m = hop(graph, key, side); forward = false; }
  if (!m) return null;
  return { key: m.key, point: m.point, heading: forward ? m.heading : facing };
}

// ---------------------------------------------------------------------------
// A round of the floor: visit every corridor, nearest-unvisited first, then come
// back to the start. Returns evenly spaced viewpoints [{ point, heading }].
// ---------------------------------------------------------------------------
function bfsToNearest(graph, from, visited) {
  const prev = new Map([[from, null]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const k = q[i];
    if (k !== from && !visited.has(k)) {
      const path = [];
      for (let c = k; c !== from; c = prev.get(c)) path.push(c);
      return path.reverse();
    }
    for (const n of graph.adj.get(k) || []) if (!prev.has(n)) { prev.set(n, k); q.push(n); }
  }
  return null;
}
function pathTo(graph, from, to) {
  if (from === to) return [];
  const prev = new Map([[from, null]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const k = q[i];
    if (k === to) { const path = []; for (let c = to; c !== from; c = prev.get(c)) path.push(c); return path.reverse(); }
    for (const n of graph.adj.get(k) || []) if (!prev.has(n)) { prev.set(n, k); q.push(n); }
  }
  return [];
}

export function tourKeys(graph, startKey) {
  if (!graph.nodes.has(startKey)) return [];
  const seq = [startKey], visited = new Set([startKey]);
  let cur = startKey;
  for (let guard = 0; guard < graph.nodes.size + 5; guard++) {
    const path = bfsToNearest(graph, cur, visited);
    if (!path) break;
    for (const k of path) { seq.push(k); visited.add(k); }
    cur = seq[seq.length - 1];
  }
  seq.push(...pathTo(graph, cur, startKey));
  return seq;
}

// Resample the node sequence into evenly spaced viewpoints so the tour glides at
// a constant pace even where the corridor is made of short ring segments.
export function buildTour(graph, startKey, spacing = 1.6) {
  const keys = tourKeys(graph, startKey);
  const pts = keys.map((k) => graph.nodes.get(k));
  if (pts.length < 2) return pts.length ? [{ point: pts[0], heading: 0 }] : [];
  const out = [];
  let carry = 0;
  let heading = angleOf(pts[0], pts[1]);
  out.push({ point: pts[0], heading });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    heading = angleOf(a, b);
    let t = spacing - carry;
    while (t <= len) {
      out.push({ point: [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len], heading });
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  return out;
}

// Index of the tour viewpoint nearest to a point (to resume a paused tour).
export function nearestTourIndex(tour, [x, y]) {
  let best = 0, bd = Infinity;
  tour.forEach((t, i) => { const d = (t.point[0] - x) ** 2 + (t.point[1] - y) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---------------------------------------------------------------------------
// Front view of a shop: where to stand and where to look so the whole shopfront
// fills the screen. Works from the raw footprint (no three.js).
// ---------------------------------------------------------------------------
export function footprintOf(d) {
  return d.poly || [[d.x - d.w / 2, d.y - d.d / 2], [d.x + d.w / 2, d.y - d.d / 2], [d.x + d.w / 2, d.y + d.d / 2], [d.x - d.w / 2, d.y + d.d / 2]];
}

// The edge of the footprint nearest the door: its middle, length and outward normal.
export function shopFace(d) {
  if (!d?.door) return null;
  const pts = footprintOf(d);
  let best = null;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) return;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const t = Math.max(0, Math.min(L, (d.door[0] - a[0]) * ux + (d.door[1] - a[1]) * uy));
    const dist = Math.hypot(a[0] + ux * t - d.door[0], a[1] + uy * t - d.door[1]);
    if (!best || dist < best.dist) {
      let nx = -uy, ny = ux;
      if (nx * (m[0] - d.x) + ny * (m[1] - d.y) < 0) { nx = -nx; ny = -ny; }       // point away from the shop
      best = { dist, mid: m, L, nx, ny };
    }
  });
  return best;
}

export const FRONT_EYE_Z = 1.3;     // above the 0.9 high blocks opposite, so nothing hides the facade
export const FRONT_FOV = 78;
const FRONT_FOV_WIDE = 96;   // widest lens used when an escalator forces a closer stand
const STORE_HEIGHT = 0.9;

// Escalators and lift banks stand in the middle of the floor; a front view must not look
// through one (or stand inside one) when it faces a shop across the atrium side.
const BLOCKERS = [
  ...escalators.map((e) => ({ x: e.x, y: e.y, hx: 0.62, hy: e.d / 2 + 0.55 })),
  ...lifts.map((l) => ({ x: l.x, y: l.y, hx: 0.6, hy: 0.6 })),
];
export function segHitsRect(a, b, r, pad = 0.25) {
  const x0 = r.x - r.hx - pad, x1 = r.x + r.hx + pad, y0 = r.y - r.hy - pad, y1 = r.y + r.hy + pad;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}
const sightClear = (from, to) => !BLOCKERS.some((r) => segHitsRect(from, to, r));

// aspect = canvas width / height. Returns null when the shop has no door/face.
// Stands as far back as the whole frontage needs, but never behind an escalator or lift:
// if something is in the way it steps closer and opens the lens wider instead.
export function frontViewPose(d, aspect = 1.6) {
  const face = shopFace(d);
  if (!face) return null;
  const ar = Math.max(0.5, aspect);
  const hfov = 2 * Math.atan(Math.tan((FRONT_FOV * Math.PI) / 360) * ar);
  const ideal = Math.min(9, Math.max(2.4, (face.L / 2 / Math.tan(hfov / 2)) * 1.1 + 0.6));
  const at = (dist) => [face.mid[0] + face.nx * dist, face.mid[1] + face.ny * dist];
  let dist = ideal;
  while (dist > 2.4 && !sightClear(at(dist), face.mid)) dist = Math.max(2.4, dist - 0.3);
  // vertical lens needed to keep the whole frontage in frame from this (possibly closer) spot
  let fov = FRONT_FOV;
  if (dist < ideal - 0.01) {
    const need = 2 * Math.atan(Math.tan(Math.atan((face.L / 2) * 1.08 / dist)) / ar) * (180 / Math.PI);
    fov = Math.min(FRONT_FOV_WIDE, Math.max(FRONT_FOV, need));
  }
  return {
    point: at(dist),
    heading: Math.atan2(-face.ny, -face.nx),
    eyeZ: FRONT_EYE_Z,
    pitch: -Math.atan((FRONT_EYE_Z - STORE_HEIGHT * 0.55) / dist),
    fov,
  };
}

// First viewpoint for plain street view: the given spot (or the floor's middle),
// snapped to a corridor and facing into the floor.
export function startRoam(floor, near, centre) {
  const g = roamGraph(floor);
  const key = nearestRoamNode(g, near || centre || [0, 0]);
  if (!key) return null;
  const p = g.nodes.get(key);
  const want = centre || p;
  let best = null, bd = Infinity;
  for (const n of g.adj.get(key) || []) {
    const q = g.nodes.get(n);
    const d = Math.hypot(q[0] - want[0], q[1] - want[1]);
    if (d < bd) { bd = d; best = q; }
  }
  return { point: p, heading: best ? angleOf(p, best) : Math.PI / 2 };
}

export { TAU };
