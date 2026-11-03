// Shared by the From / To pickers (phone sheet and desktop panel): filter the places by
// floor and category, and surface the "top stores" (named, open brands and the anchors)
// before the long tail of units.
import { FLOORS } from '../data/floors.js';

export const floorOptions = () => [...FLOORS].reverse().map(([code, name]) => ({ code, name }));

const catNames = (p) => (p.store?.categories?.length ? p.store.categories.map((c) => c.name) : p.store?.category?.name ? [p.store.category.name] : []);

export function categoryOptions(places) {
  const set = new Set();
  for (const p of places) for (const n of catNames(p)) set.add(n);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function filterPlaces(places, { floor = '', category = '', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const out = places.filter((p) => {
    if (floor && p.floor !== floor) return false;
    if (category && !catNames(p).includes(category)) return false;
    if (q && !(p.name.toLowerCase().includes(q) || String(p.unit || '').toLowerCase() === q || catNames(p).some((n) => n.toLowerCase().includes(q)))) return false;
    return true;
  });
  return out.sort((a, b) => (a.vacant ? 1 : 0) - (b.vacant ? 1 : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Popular hospital destinations first (when they exist), then the entrances.
const POPULAR = ['emergency-triage', 'reception-registration', 'pharmacy-op', 'sample-collection', 'billing-insurance', 'x-ray', 'ct-scan', 'cafeteria', 'help-desk'];
export function topStores(places, limit = 12) {
  const byUnit = new Map(places.filter((p) => p.unit).map((p) => [p.unit, p]));
  const pop = POPULAR.map((c) => byUnit.get(c)).filter(Boolean);
  const anchors = places.filter((p) => p.kind === 'ANCHOR');
  return [...pop, ...anchors].slice(0, limit);
}
