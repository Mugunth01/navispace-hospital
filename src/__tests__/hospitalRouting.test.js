import { describe, it, expect } from 'vitest';
import seed from '../data/hospitalSeed.json';
import { configureLayout, lifts, stairs, restrooms, walkwaySegments, anchorPlaces } from '../data/floors.js';
import { toBundle } from '../data/api/index.js';
import { buildModel } from '../data/model.js';
import { planJourney } from '../utils/journey.js';

configureLayout(seed);
const model = buildModel(toBundle(seed, 'sample'));
const units = Object.values(model.unitsByFloor).flat().filter((u) => u.mapped);

describe('hospital layout', () => {
  it('installs floors, corridors and cores', () => {
    expect(walkwaySegments('G').length).toBe(10);  // main spine + 9 wings
    expect(lifts.length).toBeGreaterThan(1);
    expect(lifts.every((l) => l.floors.length === 2)).toBe(true);
    expect(stairs.length).toBe(6);
    expect(restrooms.length).toBe(8);
    expect(anchorPlaces.length).toBe(4);
    expect(units.length).toBeGreaterThan(220);
  });
  it('every start reaches every room (and every walk stays short of absurd)', () => {
    const fails = [];
    let n = 0;
    for (const a of anchorPlaces) for (const u of units) {
      const p = planJourney({ start: model.placeById.get(a.id), dest: u, storesFor: (f) => model.unitsByFloor[f] });
      n++;
      if (!p?.ok) { fails.push(`${a.id} -> ${u.id}`); continue; }
      const straight = Math.hypot(u.x - model.placeById.get(a.id).x, u.y - model.placeById.get(a.id).y);
      if (a.floor === u.floor && p.total > straight * 3 + 12) fails.push(`detour ${a.id} -> ${u.id} ${p.total.toFixed(1)} vs ${straight.toFixed(1)}`);
    }
    expect(fails).toEqual([]);
    expect(n).toBeGreaterThan(400);
  });
  it('restrooms and stairs are reachable', () => {
    for (const p of model.places.filter((x) => x.kind === 'FACILITY')) {
      const s = model.placeById.get(anchorPlaces[0].id);
      expect(planJourney({ start: s, dest: p, storesFor: (f) => model.unitsByFloor[f] })?.ok, p.id).toBe(true);
    }
  });
  it('doctors resolve to rooms', () => {
    expect(model.doctors.length).toBe(seed.doctors.length);
    expect(model.doctors.every((d) => d.place && d.place.mapped)).toBe(true);
  });
});
