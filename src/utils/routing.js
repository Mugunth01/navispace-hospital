import {
  lifts, escalators, stairs, restrooms, kiosks, escalatorFloors,
  walkwaySegments, nearestOnWalkways, anchorPlaces,
} from '../data/floors.js';

export function key(x, y) { return `${x.toFixed(2)},${y.toFixed(2)}`; }
const P = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p);

// Footprints used only to stop admin-added blocks overlapping fixed furniture.
export function coreFootprints() {
  return [
    ...lifts.map((l) => ({ x: l.x, y: l.y, w: 1.3, d: 1.3 })),
    ...stairs.map((t) => ({ x: t.x, y: t.y, w: t.w, d: t.d })),
    ...restrooms.map((r) => ({ x: r.x, y: r.y, w: r.w, d: r.d })),
    ...escalators.map((e) => ({ x: e.x, y: e.y, w: e.w, d: e.d })),
    ...kiosks,
  ];
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a, top = a[0][1], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Walkway graph for 'paths' floors.
// ---------------------------------------------------------------------------
function onSegment(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const L = Math.hypot(bx - ax, by - ay); if (L < 1e-9) return null;
  const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (L * L);
  if (t <= 1e-6 || t >= 1 - 1e-6) return null;
  const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
  return d < 0.02 ? t : null;
}
function intersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 1e-6 || t > 1 - 1e-6 || u < 1e-6 || u > 1 - 1e-6) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

// segments: [[a,b],...]; returns { nodes: Map(key -> [x,y]), adj: Map(key -> [[key, w]]) }
export function buildGraph(segments, extra = []) {
  const pts = [...extra];
  segments.forEach(([a, b]) => pts.push(a, b));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const x = intersect(segments[i][0], segments[i][1], segments[j][0], segments[j][1]);
    if (x) pts.push(x);
  }
  const nodes = new Map(), adj = new Map();
  const addNode = (p) => { const k = key(p[0], p[1]); if (!nodes.has(k)) { nodes.set(k, [+p[0].toFixed(3), +p[1].toFixed(3)]); adj.set(k, []); } return k; };
  const link = (p, q) => {
    const a = addNode(p), b = addNode(q); if (a === b) return;
    const w = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!adj.get(a).some(([k]) => k === b)) { adj.get(a).push([b, w]); adj.get(b).push([a, w]); }
  };
  for (const [a, b] of segments) {
    const inner = pts.map((p) => ({ p, t: onSegment(p, a, b) })).filter((o) => o.t != null).sort((m, n) => m.t - n.t).map((o) => o.p);
    const chain = [a, ...inner, b];
    for (let i = 1; i < chain.length; i++) link(chain[i - 1], chain[i]);
  }
  return { nodes, adj };
}

export function dijkstra(graph, startKey, goalKey) {
  const dist = new Map([[startKey, 0]]), prev = new Map(), heap = new MinHeap(), done = new Set();
  heap.push(0, startKey);
  while (heap.size) {
    const k = heap.pop();
    if (done.has(k)) continue; done.add(k);
    if (k === goalKey) break;
    for (const [n, w] of graph.adj.get(k) || []) {
      const nd = dist.get(k) + w;
      if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, k); heap.push(nd, n); }
    }
  }
  if (!dist.has(goalKey)) return null;
  const path = [goalKey]; let k = goalKey;
  while (prev.has(k)) { k = prev.get(k); path.push(k); }
  return path.reverse().map((kk) => graph.nodes.get(kk));
}

// Points people stand on to use a core or an anchor. They are added to the
// graph so a route always starts/ends exactly there, not at the nearest vertex.
const standing = (floor) => [
  ...lifts.map((l) => l.at), ...stairs.map((t) => t.at), ...restrooms.map((r) => r.at),
  ...(escalatorFloors.includes(floor) ? escalators.flatMap((e) => [e.at, e.arrive]) : []),
  ...anchorPlaces.filter((p) => p.floor === floor).map((p) => p.door),
];
const graphCache = new Map();
export function walkwayGraph(floor, stores = []) {
  const sig = floor + '|' + stores.map((s) => `${s.id}:${s.door}:${s.spur}`).join(';');
  if (graphCache.has(sig)) return graphCache.get(sig);
  const segs = walkwaySegments(floor).map(([a, b]) => [[...a], [...b]]);
  for (const s of stores) if (s.spur && s.door) segs.push([s.door, s.spur]);
  const g = buildGraph(segs, standing(floor));
  if (graphCache.size > 60) graphCache.clear();
  graphCache.set(sig, g);
  return g;
}

// Remove collinear interior points so the drawn line has clean corners.
function simplify(path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [a, b, c] = [out[out.length - 1], path[i], path[i + 1]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-4) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// One entry point for "walk from A to B on this floor". A and B are anything
// with a `door` ([x,y]) or {x,y}. Returns an array of [x,y] or null.
// ---------------------------------------------------------------------------
const MAX_SNAP = 1.2;   // units (~3 m): door-to-corridor distance allowed
export const doorOf = (p) => (p.door ? { x: p.door[0], y: p.door[1] } : P(p));

// Join a point to the walkway graph at the closest spot on the closest edge
// (splitting that edge), on a copy so the cached graph is never mutated.
// Returns null if the point is more than MAX_SNAP from every walkway.
function attach(graph, p, tag) {
  let best = null;
  for (const [u, list] of graph.adj) {
    const [ux, uy] = graph.nodes.get(u);
    for (const [v, w] of list) {
      if (u > v) continue;                       // each edge once
      const [vx, vy] = graph.nodes.get(v);
      const L2 = (vx - ux) ** 2 + (vy - uy) ** 2;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - ux) * (vx - ux) + (p.y - uy) * (vy - uy)) / L2)) : 0;
      const q = [ux + t * (vx - ux), uy + t * (vy - uy)], d = Math.hypot(q[0] - p.x, q[1] - p.y);
      if (!best || d < best.d) best = { u, v, w, t, q, d };
    }
  }
  if (!best || best.d > MAX_SNAP) return null;
  const { u, v, w, t, q } = best;
  if (t < 1e-3) return { graph, key: u, q };
  if (t > 1 - 1e-3) return { graph, key: v, q };
  const k = `@${tag}`;
  const nodes = new Map(graph.nodes).set(k, q);
  const adj = new Map(graph.adj);
  adj.set(k, [[u, w * t], [v, w * (1 - t)]]);
  adj.set(u, [...adj.get(u), [k, w * t]]);
  adj.set(v, [...adj.get(v), [k, w * (1 - t)]]);
  return { graph: { nodes, adj }, key: k, q };
}

export function routeOnFloor(floor, from, to, stores = []) {
  const a = doorOf(from), b = doorOf(to);
  const A = attach(walkwayGraph(floor, stores), a, 'a');
  const B = A && attach(A.graph, b, 'b');
  if (!A || !B) return null;                     // not on/next to a walkway: no fake connector
  const nodes = dijkstra(B.graph, A.key, B.key);
  if (!nodes) return null;
  const path = [...nodes];
  // The only off-graph pieces are the short perpendicular links (≤ MAX_SNAP).
  if (Math.hypot(path[0][0] - a.x, path[0][1] - a.y) > 0.05) path.unshift([a.x, a.y]);
  const [tx, ty] = path[path.length - 1];
  if (Math.hypot(tx - b.x, ty - b.y) > 0.05) path.push([b.x, b.y]);
  return simplify(path);
}

export const pathLength = (route) => (route ? route.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0), 0) : 0);

// ---------------------------------------------------------------------------
// Vertical cores
// ---------------------------------------------------------------------------
export const coreWithDoor = (c) => ({ ...c, door: c.at });

// ---------------------------------------------------------------------------
// Turn-by-turn from a polyline, relative to the walker (no compass words —
// a phone has no "north" on screen). `landmark(point)` may return a nearby
// store name to anchor a turn ("Turn left at Zenith Bazaar").
// ---------------------------------------------------------------------------
export function turnByTurn(route, destName, M = 2.6, landmark = () => null) {
  if (!route || route.length < 2) return [];
  const legs = [];
  for (let i = 1; i < route.length; i++) {
    const dx = route[i][0] - route[i - 1][0], dy = route[i][1] - route[i - 1][1];
    legs.push({ ang: Math.atan2(dy, dx), len: Math.hypot(dx, dy), at: route[i - 1] });
  }
  // merge near-straight legs (ring arcs) so the list stays readable
  const merged = [];
  for (const l of legs) {
    const last = merged[merged.length - 1];
    // bends under 35° are part of the same leg (ring arcs, gentle curves)
    if (last) { let d = l.ang - last.endAng; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.61) { last.len += l.len; last.bend += Math.abs(d); last.endAng = l.ang; continue; } }
    merged.push({ ang: l.ang, endAng: l.ang, len: l.len, at: l.at, bend: 0 });
  }
  const walk = (l, m) => (l.bend > 0.5 ? `follow the corridor for ${m} m` : `walk ${m} m`);
  const steps = merged.map((l, i) => {
    const m = Math.max(1, Math.round(l.len * M));
    if (i === 0) return l.bend > 0.5 ? `Follow the corridor for ${m} m` : `Walk straight for ${m} m`;
    let d = l.ang - merged[i - 1].endAng; d = Math.atan2(Math.sin(d), Math.cos(d));
    const side = d > 0 ? 'left' : 'right';
    const lm = landmark(l.at);
    // Hairpins happen where a corridor leaves an atrium ring at a sharp angle;
    // "turn around" would read as "go back", so name the side instead.
    if (Math.abs(d) > (150 * Math.PI) / 180) return `Make a sharp ${side}${lm ? ` at ${lm}` : ''}, then ${walk(l, m)}`;
    if (Math.abs(d) > 1.1) return `Turn ${side}${lm ? ` at ${lm}` : ''}, then ${walk(l, m)}`;
    return `Keep ${side}${lm ? ` past ${lm}` : ''} for ${m} m`;
  });
  steps.push(`Arrive at ${destName}`);
  return steps;
}

// Closest point on any walkway of this floor — used to give admin blocks a spur.
export function nearestWalkwayPoint(floor, p) {
  const r = nearestOnWalkways(floor, [p.x, p.y]);
  return { point: r.point, dist: r.dist };
}
