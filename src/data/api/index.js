// NaviSpace Hospital — public data access.
//
// Reads the layout (nav_floors, nav_rooms, nav_walkways, nav_start_points),
// doctors and settings straight from Supabase's REST endpoint with the
// publishable key (read-only for the public; writes are admin-only via RLS).
// Plain fetch keeps the visitor bundle small — no client library needed.
// If Supabase can't be reached, the bundled sample layout is used and the app
// shows a "Sample data" badge.
import { configureLayout, doorOfRoom, rectOf, CATEGORIES } from '../floors.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export let DATA_MODE = 'sample';

async function fetchLive() {
  if (!URL_ || !KEY || import.meta.env.VITE_DATA_MODE === 'demo') throw new Error('not configured');
  const get = async (t, q = 'select=*') => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(`${URL_}/rest/v1/${t}?${q}`, { headers: { apikey: KEY }, signal: ctl.signal });
      if (!r.ok) throw new Error(`${t}: ${r.status}`);
      return r.json();
    } finally { clearTimeout(timer); }
  };
  const [settings, floors, rooms, walkways, start_points, doctors] = await Promise.all([
    get('nav_settings'), get('nav_floors'), get('nav_rooms'), get('nav_walkways'), get('nav_start_points'), get('nav_doctors', 'select=*&active=eq.true'),
  ]);
  if (!floors.length || !rooms.length) throw new Error('empty layout');
  return { settings: settings[0] || {}, floors, rooms, walkways, start_points, doctors };
}

const NOT_PLACES = new Set(['lift', 'stairs', 'restroom', 'garden']);

// Database rows -> the bundle shape model.js (from the mall app) understands.
export function toBundle(db, source) {
  const floors = db.floors.map((f) => ({ id: f.id, code: f.id, name: f.name_en, name_ta: f.name_ta, level: f.level, is_parking: false, plan_status: 'SCHEMATIC' }));
  const categories = Object.entries(CATEGORIES).filter(([k]) => k !== 'custom' && k !== 'unit').map(([id, c]) => ({ id, name: c.label, slug: id, color: c.color }));
  const stores = [], store_categories = [], entities = [];
  for (const r of db.rooms) {
    if (NOT_PLACES.has(r.category)) continue;
    const R = rectOf(r), poly = [[R.x0, R.y0], [R.x1, R.y0], [R.x1, R.y1], [R.x0, R.y1]];
    if (r.category === 'service') {
      entities.push({ id: `e-${r.code}`, floor_id: r.floor_id, kind: 'SERVICE', code: r.code, label: r.name_en, geometry: { poly }, data_source: 'SCHEMATIC' });
      continue;
    }
    stores.push({ id: r.code, floor_id: r.floor_id, unit_code: r.code, name: r.name_en, name_ta: r.name_ta, status: 'OPEN', searchable: r.searchable !== false, keywords: r.keywords || '', description: null });
    if (CATEGORIES[r.category]) store_categories.push({ store_id: r.code, category_id: r.category });
    entities.push({ id: `e-${r.code}`, floor_id: r.floor_id, kind: 'UNIT', code: r.code, store_id: r.code, geometry: { poly }, door: doorOfRoom(r), data_source: 'SCHEMATIC' });
  }
  return {
    source, settings: db.settings, mall: { name: db.settings?.hospital_name || 'Hospital', metadata: {} }, demo: source !== 'live',
    floors, categories, stores, store_categories, entities, map_version: null,
    parking_zones: [], parking_slots: [], qr_anchors: [], facilities: [], offers: [], promotions: [],
    doctors: (db.doctors || []).map((d) => ({ ...d })),
  };
}

let bundle = null;
// Load once, install the geometry, keep the bundle for App.
export async function boot() {
  let db, source = 'live';
  try { db = await fetchLive(); } catch (e) {
    if (import.meta.env.MODE !== 'test') console.warn('NaviSpace Hospital: using the bundled sample layout –', e.message || e);
    db = (await import('../hospitalSeed.json')).default; source = 'sample';
  }
  DATA_MODE = source;
  configureLayout(db);
  bundle = toBundle(db, source);
  return bundle;
}

const noop = async () => null;
export const api = {
  mode: 'hospital',
  peekPublic: () => bundle,
  loadPublic: async () => bundle || boot(),
  track: () => {},
  parking: { get: noop, save: noop, clear: noop },
};
