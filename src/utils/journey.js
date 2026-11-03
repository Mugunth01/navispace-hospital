// Journey planner: turns (start, destination, travel mode) into an explicit
// list of steps — WALK, LIFT, ESCALATOR — each with its own behaviour:
//   LIFT       one vertical step; the rider picks the destination floor once.
//   ESCALATOR  one step per flight (G→1F, 1F→2F, ...), with a walk between
//              flights when the next escalator is elsewhere.
// Walks come from the walkway graph (routing.js); if any walk is impossible
// the whole plan fails with ok:false — never a straight "fake" line.
import { lifts, escalatorLinks, escalatorFloors, floorIndex } from '../data/floors.js';
import { routeOnFloor, pathLength } from './routing.js';

export const NO_ROUTE = 'No walkable route found.';

const pt = (p) => (p.door ? { x: p.door[0], y: p.door[1] } : { x: p.x, y: p.y });
const straight = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const coreStop = (c, label) => ({ id: c.id, name: label, x: c.at[0], y: c.at[1], door: c.at });

function walkStep(floor, from, to, storesFor) {
  if (straight(pt(from), pt(to)) < 0.05) return { type: 'walk', floor, path: null, length: 0 };   // already there
  const path = routeOnFloor(floor, from, to, storesFor(floor));
  if (!path) return null;
  return { type: 'walk', floor, path, length: pathLength(path), fromName: from.name, toName: to.name, toId: to.id };
}

function liftPlan(start, dest, storesFor, note = null) {
  const a = pt(start), b = pt(dest);
  // Try lifts nearest-first (walk to lift + lift to destination), keep the
  // first one both walks can actually reach.
  const ranked = lifts
    .filter((l) => l.floors.includes(start.floor) && l.floors.includes(dest.floor))
    .map((l) => ({
      l,
      score: straight(a, { x: l.at[0], y: l.at[1] }) + straight(b, { x: l.at[0], y: l.at[1] }),
      // Lifts in a row share one walkway point; prefer the car actually standing next to it.
      gap: Math.hypot(l.x - l.at[0], l.y - l.at[1]),
    }))
    .sort((m, n) => m.score - n.score || m.gap - n.gap);
  for (const { l } of ranked) {
    const stop = coreStop(l, `Lift ${l.id}`);
    const first = walkStep(start.floor, start, stop, storesFor);
    const last = first && walkStep(dest.floor, stop, dest, storesFor);
    if (first && last) {
      return finish([first, { type: 'lift', coreId: l.id, from: start.floor, to: dest.floor, floors: l.floors, x: l.x, y: l.y }, last], note);
    }
  }
  return { ok: false, error: NO_ROUTE, steps: [] };
}

function escalatorPlan(start, dest, storesFor, closed) {
  const up = floorIndex(dest.floor) > floorIndex(start.floor);
  const served = escalatorFloors.includes(start.floor) && escalatorFloors.includes(dest.floor);
  if (!served) {
    const where = escalatorFloors.includes(start.floor) ? dest.floor : start.floor;
    return liftPlan(start, dest, storesFor, `Escalators don't reach ${where} — using a lift instead.`);
  }
  const steps = [];
  let pos = start, floor = start.floor;
  while (floor !== dest.floor) {
    const next = escalatorFloors[escalatorFloors.indexOf(floor) + (up ? 1 : -1)];
    const flights = escalatorLinks.filter((e) => e.fromFloor === floor && e.toFloor === next && e.available && !closed.has(e.id));
    // Pick the flight with the shortest real walk, tie-broken toward the destination.
    let best = null;
    for (const e of flights) {
      const stop = coreStop(e, `Escalator ${e.direction === 'up' ? '▲' : '▼'} to ${next}`);
      const w = walkStep(floor, pos, stop, storesFor);
      if (!w) continue;
      const score = w.length + 0.5 * straight(pt(stop), pt(dest));
      if (!best || score < best.score) best = { e, stop, w, score };
    }
    if (!best) {
      return liftPlan(start, dest, storesFor, `No working escalator from ${floor} to ${next} — using a lift instead.`);
    }
    if (best.w.path) steps.push(best.w);
    steps.push({ type: 'escalator', coreId: best.e.stack, linkId: best.e.id, from: floor, to: next, direction: best.e.direction, x: best.e.x, y: best.e.y });
    pos = { id: `${best.e.id}@${next}`, name: `Escalator from ${floor}`, floor: next, door: best.e.arrive };
    floor = next;
  }
  const last = walkStep(dest.floor, pos, dest, storesFor);
  if (!last) return { ok: false, error: NO_ROUTE, steps: [] };
  steps.push(last);
  return finish(steps, null);
}

function finish(allSteps, note) {
  const steps = allSteps.filter((s) => s.type !== 'walk' || s.path);   // drop zero-length walks
  return { ok: true, steps, note, total: steps.reduce((n, s) => n + (s.type === 'walk' ? s.length : 0), 0) };
}

/**
 * start/dest: places ({id, name, floor, door|x,y}).
 * mode: 'lift' | 'escalator'.
 * storesFor(floor): the store list for that floor (custom blocks, renames).
 * closed: Set of escalator link ids that are out of service.
 */
export function planJourney({ start, dest, mode = 'lift', storesFor = () => [], closed = new Set() }) {
  if (!start || !dest) return null;
  if (start.id === dest.id) return { ok: true, steps: [], total: 0, note: `You're already at ${dest.name}.`, same: true };
  if (start.floor === dest.floor) {
    const w = walkStep(start.floor, start, dest, storesFor);
    return w ? finish([w], null) : { ok: false, error: NO_ROUTE, steps: [] };
  }
  return mode === 'escalator' ? escalatorPlan(start, dest, storesFor, closed) : liftPlan(start, dest, storesFor);
}

// Where you are standing when a step begins — used to pick the floor to show.
export const stepFloor = (s) => (s.type === 'walk' ? s.floor : s.from);

// The walk drawn on a given floor (a journey never walks the same floor twice).
export const walkOnFloor = (plan, floor) => plan?.steps?.find((s) => s.type === 'walk' && s.floor === floor) || null;

export function describeStep(s) {
  if (s.type === 'lift') return `Take Lift ${s.coreId} from ${s.from} to ${s.to}`;
  if (s.type === 'escalator') return `Escalator ${s.direction === 'up' ? 'up' : 'down'}: ${s.from} → ${s.to}`;
  return `Walk to ${s.toName} on ${s.floor}`;
}
