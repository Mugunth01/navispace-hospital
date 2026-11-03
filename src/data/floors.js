// ============================================================================
// NaviSpace Hospital — building geometry (single source of truth for the map).
//
// The mall version of this file held fixed, hand-traced geometry. Here the
// layout comes from the hospital database (rooms, corridors, start points) and
// is installed once at start-up by configureLayout(), BEFORE the app modules
// are imported (see main.jsx). Every export keeps the name the NaviSpace engine
// expects; arrays are filled in place so imports stay live.
//
// Coordinates: map units (1 unit = 2.5 m), x east, y north, z up.
// Database rectangles are stored with z = -y (north is "up" in the admin plan).
// ============================================================================

export const FLOORS = [];            // [code, name] lowest first
export const floorInfo = {};
export const isParking = () => false;
export const floorIndex = (f) => FLOORS.findIndex((x) => x[0] === f);
export const isOpenFloor = () => false;
export const hasAtriumVoid = () => false;
export const hasAtriumCourt = () => false;

// Department colours (soft, one hue per group; used by "colour by category").
export const CATEGORIES = {
  opd: { color: '#8fd0c4', label: 'Outpatient (OPD)' },
  diagnostics: { color: '#94bcee', label: 'Diagnostics' },
  emergency: { color: '#f2a9a2', label: 'Emergency' },
  services: { color: '#f6c47e', label: 'Patient services' },
  pharmacy: { color: '#a8dba0', label: 'Pharmacy' },
  inpatient: { color: '#c9b3ea', label: 'Day care & wards' },
  amenities: { color: '#eed9a6', label: 'Amenities' },
  unit: { color: '#d9dce1', label: 'Room' },
  custom: { color: '#9cc7e6', label: 'Custom block' },
};
export const CATEGORY_LIST = Object.entries(CATEGORIES).filter(([k]) => k !== 'custom' && k !== 'unit');

export const METRES_PER_UNIT = 2.5;
export const WALK_W = 2.4;                 // corridors are 6 m wide
export const WALK_HALF = WALK_W / 2;

export const OUTLINE = [];
export const SHELL = { cx: 0, cy: 0, halfX: 10, halfY: 10 };
export const BOUNDS = { minX: -10, maxX: 10, minY: -10, maxY: 10 };

export const lifts = [];
export const escalators = [];
export const escalatorFloors = [];
export const escalatorLinks = [];
export const stairs = [];             // per floor: { id, floor, x, y, w, d, at, label }
export const restrooms = [];          // per floor: { id, floor, x, y, w, d, at }
export const fireExits = [];
export const kiosks = [];             // per floor: { id, floor, x, y, w, d }
export const gardens = [];            // per floor: { id, floor, poly, x, y, w, d }
export const anchorPlaces = [];       // entrances and kiosks = starting points
export const entrances = [];          // { floor, x, y, name, side }
export const boardAnchors = [];
export const tablesFor = () => [];
export const floorVoids = () => ({ polys: [], circles: [] });
export const baseStores = () => [];
export let DEFAULT_START = null;
export const DEFAULT_DEST = null;
export const NORTH_IS_NEGATIVE_Y = false;
// Kept for the mall scene code paths that still reference them.
export const RING2 = { x: 0, y: 0, R: 0, voidR: 0 };
export const LOBBY_GAP = [0, 0];

const segs = {};                      // floor -> [[a,b],...] walkway centre lines
const r3 = (n) => +(+n).toFixed(3);

// DB rectangle (top-left x, z = -y) -> map rectangle.
export const rectOf = (o) => ({ x0: o.x, x1: o.x + o.w, y0: -o.z - o.d, y1: -o.z });
const inRect = (p, r, pad = 0.02) => p[0] >= r.x0 - pad && p[0] <= r.x1 + pad && p[1] >= r.y0 - pad && p[1] <= r.y1 + pad;

function projectOnSeg(p, [a, b]) {
  const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2)) : 0;
  const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { q, d: Math.hypot(q[0] - p[0], q[1] - p[1]) };
}

// Corridor rectangles -> centre lines, joined where one corridor runs into another.
function corridorLines(rects) {
  const lines = rects.map((r) => {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    return (r.x1 - r.x0) >= (r.y1 - r.y0) ? [[r.x0, cy], [r.x1, cy]] : [[cx, r.y0], [cx, r.y1]];
  });
  const out = lines.map(([a, b]) => [[r3(a[0]), r3(a[1])], [r3(b[0]), r3(b[1])]]);
  lines.forEach((ln, i) => ln.forEach((p) => {
    rects.forEach((r, j) => {
      if (i === j || !inRect(p, r, 0.3)) return;
      const { q, d } = projectOnSeg(p, lines[j]);
      if (d > 0.01) out.push([[r3(p[0]), r3(p[1])], [r3(q[0]), r3(q[1])]]);
    });
  }));
  // Corridors that merely touch side by side also get joined at the overlap.
  return out;
}

export function walkwaySegments(floor) { return segs[floor] || []; }
export function nearestOnWalkways(floor, p) {
  let best = null, bd = Infinity;
  for (const s of walkwaySegments(floor)) {
    const { q, d } = projectOnSeg(p, s);
    if (d < bd) { bd = d; best = q; }
  }
  if (!best) return { point: [p[0], p[1]], dist: Infinity };
  return { point: [r3(best[0]), r3(best[1])], dist: bd };
}

// The door of a room: middle of the chosen wall (door_pos along it), pushed
// 0.3 units out into the corridor so it sits on the walkway band.
export function doorOfRoom(r, out = 0.3) {
  const R = rectOf(r), t = r.door_pos ?? 0.5;
  switch (r.door_side) {
    case 'N': return [r3(R.x0 + (R.x1 - R.x0) * t), r3(R.y1 + out)];
    case 'S': return [r3(R.x0 + (R.x1 - R.x0) * t), r3(R.y0 - out)];
    case 'W': return [r3(R.x0 - out), r3(R.y1 - (R.y1 - R.y0) * t)];
    default: return [r3(R.x1 + out), r3(R.y1 - (R.y1 - R.y0) * t)];
  }
}

/**
 * Install a hospital layout. `db` = rows as stored in Supabase:
 * { floors, rooms, walkways, start_points }.
 */
export function configureLayout(db) {
  const floors = [...db.floors].sort((a, b) => a.level - b.level);
  FLOORS.length = 0;
  floors.forEach((f) => { FLOORS.push([f.id, f.name_en]); floorInfo[f.id] = { kind: 'hospital', walk: 'paths', theme: f.name_en, letter: f.id }; });
  for (const k of Object.keys(segs)) delete segs[k];
  for (const f of floors) segs[f.id] = corridorLines(db.walkways.filter((w) => w.floor_id === f.id).map(rectOf));

  // Building outline: everything drawn, plus a small margin.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of [...db.rooms, ...db.walkways]) { const R = rectOf(o); x0 = Math.min(x0, R.x0); x1 = Math.max(x1, R.x1); y0 = Math.min(y0, R.y0); y1 = Math.max(y1, R.y1); }
  if (!isFinite(x0)) { x0 = -10; y0 = -10; x1 = 10; y1 = 10; }
  const m = 0.2;
  OUTLINE.length = 0; OUTLINE.push([x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]);
  Object.assign(BOUNDS, { minX: x0 - m, maxX: x1 + m, minY: y0 - m, maxY: y1 + m });
  Object.assign(SHELL, { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, halfX: (x1 - x0) / 2 + 1, halfY: (y1 - y0) / 2 + 1 });

  // Cores. Lifts: one record per car; cars of a link group serve every floor that has the group.
  lifts.length = 0; stairs.length = 0; restrooms.length = 0; gardens.length = 0; kiosks.length = 0; entrances.length = 0; anchorPlaces.length = 0;
  const groups = new Map();
  for (const r of db.rooms.filter((x) => x.category === 'lift')) {
    const g = r.link_group || r.code;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  let letter = 0;
  for (const [, rs] of groups) {
    const base = [...rs].sort((a, b) => floorIndex(a.floor_id) - floorIndex(b.floor_id))[0];
    const R = rectOf(base), horiz = base.door_side === 'N' || base.door_side === 'S';
    const len = horiz ? R.x1 - R.x0 : R.y1 - R.y0, n = Math.max(1, Math.min(4, Math.round(len / 1.2)));
    const served = [...new Set(rs.map((r) => r.floor_id))].sort((a, b) => floorIndex(a) - floorIndex(b));
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      const x = horiz ? R.x0 + len * k : (R.x0 + R.x1) / 2, y = horiz ? (R.y0 + R.y1) / 2 : R.y0 + len * k;
      const door = horiz ? [x, base.door_side === 'N' ? R.y1 + 0.3 : R.y0 - 0.3] : [base.door_side === 'E' ? R.x1 + 0.3 : R.x0 - 0.3, y];
      const at = nearestOnWalkways(base.floor_id, door).point;
      lifts.push({ id: String.fromCharCode(65 + letter++), type: 'lift', x: r3(x), y: r3(y), at, floors: served, group: base.link_group || base.code });
    }
  }
  for (const r of db.rooms) {
    const R = rectOf(r), c = { x: r3((R.x0 + R.x1) / 2), y: r3((R.y0 + R.y1) / 2), w: r3(R.x1 - R.x0), d: r3(R.y1 - R.y0) };
    const at = () => nearestOnWalkways(r.floor_id, doorOfRoom(r)).point;
    if (r.category === 'stairs') stairs.push({ id: r.code, floor: r.floor_id, ...c, at: at(), label: r.name_en, name_ta: r.name_ta });
    else if (r.category === 'restroom') restrooms.push({ id: r.code, floor: r.floor_id, ...c, at: at() });
    else if (r.category === 'garden') gardens.push({ id: r.code, floor: r.floor_id, ...c, name: r.name_en });
  }
  for (const p of [...db.start_points].sort((a, b) => (a.kind === 'entrance' ? 0 : 1) - (b.kind === 'entrance' ? 0 : 1) || floorIndex(a.floor_id) - floorIndex(b.floor_id))) {
    const pt = [r3(p.x), r3(-p.z)];
    const n = nearestOnWalkways(p.floor_id, pt);
    anchorPlaces.push({ id: p.code, name: p.name_en, name_ta: p.name_ta, floor: p.floor_id, x: pt[0], y: pt[1], w: 0.6, d: 0.6, category: 'services', door: n.dist <= 0.05 ? pt : n.point, kind: p.kind === 'entrance' ? 'entry' : 'kiosk' });
    if (p.kind === 'entrance') {
      const d = [[Math.abs(pt[0] - x0), 'W'], [Math.abs(pt[0] - x1), 'E'], [Math.abs(pt[1] - y0), 'S'], [Math.abs(pt[1] - y1), 'N']].sort((a, b) => a[0] - b[0])[0];
      entrances.push({ floor: p.floor_id, x: pt[0], y: pt[1], name: p.name_en, side: d[1] });
    } else {
      kiosks.push({ id: p.code, floor: p.floor_id, x: pt[0], y: r3(pt[1] + WALK_HALF - 0.45), w: 0.9, d: 0.6 });
    }
  }
  DEFAULT_START = anchorPlaces.find((a) => a.kind === 'entry')?.id || anchorPlaces[0]?.id || null;
}
