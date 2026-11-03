// Turns a data bundle (the rows the public can read from Supabase, or the
// demo snapshot) into what the map, router and screens use.
//
// Business data (stores, categories, offers) and physical placement
// (map_entities of one map version) are joined here. Walkway centre lines,
// lifts, escalators and stairs are fixed building geometry from floors.js.
import { FLOORS, anchorPlaces, lifts, nearestOnWalkways, restrooms, stairs } from './floors.js';

const r3 = (n) => +(+n).toFixed(3);
import { istDate } from './api/util.js';
// The mall's calendar day (India time) — offers start and end on local dates.
export const today = () => istDate();

function bbox(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: r3((x0 + x1) / 2), y: r3((y0 + y1) / 2), w: r3(x1 - x0), d: r3(y1 - y0) };
}

// Geometry is stored as {poly:[[x,y]...]} or a rectangle {x,y,w,d,rot}.
export function polyOf(geometry) {
  if (!geometry) return null;
  if (Array.isArray(geometry.poly) && geometry.poly.length >= 3) return geometry.poly.map(([x, y]) => [r3(x), r3(y)]);
  const { x, y, w, d } = geometry;
  if ([x, y, w, d].every((v) => typeof v === 'number')) {
    const rot = ((geometry.rot || 0) * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [r3(x + u * c - v * s), r3(y + u * s + v * c)]);
  }
  return null;
}

export const DATA_SOURCE_LABEL = {
  MALL_PROVIDED: 'Mall-provided',
  OFFICIAL_WEBSITE: 'Official website',
  VERIFIED_FLOOR_PLAN: 'Verified floor plan',
  PUBLIC_REFERENCE: 'Public reference',
  SCHEMATIC: 'Schematic',
  ADMIN_CREATED: 'Admin-created',
};

export function isOfferLive(o, day = today()) {
  return o.status === 'APPROVED' && o.valid_from <= day && o.valid_until >= day;
}
export function isPromotionLive(p, day = today()) {
  return p.status === 'APPROVED' && p.starts_at <= day && p.ends_at >= day;
}

/**
 * bundle: { mall, floors, categories, stores, store_categories, map_version,
 *           entities, parking_zones, parking_slots, qr_anchors, facilities,
 *           offers, promotions, demo? }
 * opts.publicOnly: drop anything the public must not see even if present
 * (hidden stores, unapproved / out-of-date offers) — the database already
 * enforces this with RLS; this is a second guard for the demo adapter.
 */
export function buildModel(bundle, { publicOnly = true } = {}) {
  const day = today();
  const floors = [...bundle.floors].sort((a, b) => a.level - b.level);
  const floorById = new Map(floors.map((f) => [f.id, f]));
  const floorByCode = Object.fromEntries(floors.map((f) => [f.code, f]));
  const categories = [...bundle.categories].sort((a, b) => a.name.localeCompare(b.name));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const catsOfStore = new Map();
  for (const sc of bundle.store_categories || []) {
    const c = catById.get(sc.category_id);
    if (!c) continue;
    if (!catsOfStore.has(sc.store_id)) catsOfStore.set(sc.store_id, []);
    catsOfStore.get(sc.store_id).push(c);
  }
  for (const list of catsOfStore.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const stores = (bundle.stores || [])
    .filter((s) => !publicOnly || s.status !== 'HIDDEN')
    .map((s) => {
      const cats = catsOfStore.get(s.id) || [];
      return { ...s, floor: floorById.get(s.floor_id)?.code || null, categories: cats, category: cats[0] || null };
    });
  const storeById = new Map(stores.map((s) => [s.id, s]));

  // ---- map entities -> blocks per floor ---------------------------------
  const zoneById = new Map((bundle.parking_zones || []).map((z) => [z.id, z]));
  const slotById = new Map((bundle.parking_slots || []).map((s) => [s.id, s]));
  const unitsByFloor = Object.fromEntries(FLOORS.map(([f]) => [f, []]));
  const parkingByFloor = Object.fromEntries(FLOORS.map(([f]) => [f, { zones: [], slots: [] }]));

  for (const e of bundle.entities || []) {
    const fl = floorById.get(e.floor_id);
    const poly = polyOf(e.geometry);
    if (!fl || !poly || !unitsByFloor[fl.code]) continue;
    const bb = bbox(poly);
    const floor = fl.code;
    if (e.kind === 'PARKING_ZONE') {
      const z = zoneById.get(e.parking_zone_id);
      parkingByFloor[floor].zones.push({ id: e.parking_zone_id, entityId: e.id, name: z?.name || e.label || e.code, color: z?.color || '#2f80ff', isDemo: z ? z.is_demo : true, poly, ...bb, dataSource: e.data_source });
      continue;
    }
    if (e.kind === 'PARKING_SLOT') {
      const s = slotById.get(e.parking_slot_id), z = zoneById.get(e.parking_zone_id || s?.zone_id);
      if (!s) continue;
      const door = Array.isArray(e.door) ? [r3(e.door[0]), r3(e.door[1])] : null;
      parkingByFloor[floor].slots.push({
        id: `slot-${s.id}`, slotId: s.id, entityId: e.id, code: s.code, floor, zoneId: z?.id || null,
        zoneName: z?.name || '', color: z?.color || '#2f80ff', isDemo: z ? z.is_demo : true,
        accessible: !!s.is_accessible, ev: !!s.is_ev, poly, ...bb, door, dataSource: e.data_source,
      });
      continue;
    }
    const store = e.store_id ? storeById.get(e.store_id) : null;
    const decor = e.kind === 'SERVICE' || (e.store_id && !store);   // hidden store = plain block
    const code = e.code || (store?.unit_code) || e.id.slice(0, 6);
    const vacant = store?.status === 'VACANT';
    const name = decor ? (e.label || code) : store ? store.name : (e.label || `Unit ${code}`);
    const rec = {
      id: `${floor}-${code}`, entityId: e.id, kind: e.kind, unit: code, floor, ...bb, poly,
      name, storeId: store?.id || null, store,
      subtitle: decor ? null : vacant ? 'Available store space' : store?.category?.name || (e.kind === 'STALL' ? 'Store' : null),
      color: store?.category?.color || null, categoryId: store?.category?.id || null,
      vacant: !!vacant, hidden: store ? store.searchable === false : false, nameTa: store?.name_ta || null,
      // Anything with a door can be routed to; service blocks are drawn only.
      mapped: !decor && Array.isArray(e.door), decor: !!decor,
      dataSource: e.data_source,
    };
    if (rec.mapped) {
      rec.door = [r3(e.door[0]), r3(e.door[1])];
      const n = nearestOnWalkways(floor, rec.door);
      if (n.dist > 0.05) rec.spur = n.point;
    }
    unitsByFloor[floor].push(rec);
  }

  // ---- places (everything routable) -------------------------------------
  const liftPlaces = lifts.flatMap((l) => l.floors.map((f) => ({
    id: `lift-${l.id}-${f}`, name: `Lift ${l.id} · ${f}`, floor: f, x: l.x, y: l.y, w: 0.6, d: 0.6, door: l.at, hidden: true, kind: 'LIFT',
  })));
  const slotPlaces = Object.values(parkingByFloor).flatMap((p) => p.slots.filter((s) => s.door).map((s) => ({
    id: s.id, name: `Parking ${s.floor} · ${s.code}`, floor: s.floor, x: s.x, y: s.y, w: s.w, d: s.d, door: s.door, hidden: true, kind: 'PARKING_SLOT', slot: s,
  })));
  // Safety facilities everybody can route to: the restroom block on every retail
  // floor, and the fire stairs (the way out) on every floor including the basements.
  // Hidden = reachable from "Nearest …", not listed among stores.
  // Hospital: restrooms and stairs are per floor (they come from the rooms table).
  const restroomPlaces = restrooms.map((r) => ({
    id: `wc-${r.id}`, name: 'Restroom', floor: r.floor, x: r.x, y: r.y, w: r.w, d: r.d, door: r.at, hidden: true, kind: 'FACILITY', facility: 'restroom',
  }));
  const fireExitPlaces = stairs.map((st) => ({
    id: `fx-${st.id}`, name: st.label || 'Stairs', floor: st.floor, x: st.x, y: st.y, w: st.w, d: st.d, door: st.at, hidden: true, kind: 'FACILITY', facility: 'fire',
  }));
  const anchors = anchorPlaces.map((p) => ({ ...p, kind: 'ANCHOR' }));
  // QR anchors (database) are starting points; one that sits on an entrance
  // or lift lobby simply points at that place.
  const qrPlaces = [], qrAlias = {};
  for (const q of bundle.qr_anchors || []) {
    const floor = floorById.get(q.floor_id)?.code;
    if (!floor || q.active === false) continue;
    const same = anchors.find((a) => a.floor === floor && Math.min(Math.hypot(a.x - q.x, a.y - q.y), Math.hypot(a.door[0] - q.x, a.door[1] - q.y)) < 0.5);
    if (same) { qrAlias[q.code.toLowerCase()] = same.id; continue; }
    const n = nearestOnWalkways(floor, [q.x, q.y]);
    const id = `qr-${q.code}`;
    qrAlias[q.code.toLowerCase()] = id;
    qrPlaces.push({ id, name: q.label, floor, x: q.x, y: q.y, w: 0.6, d: 0.6, door: n.dist <= 0.05 ? [q.x, q.y] : n.point, kind: 'QR', code: q.code });
  }
  const unitPlaces = Object.values(unitsByFloor).flat().filter((u) => u.mapped);
  const places = [...anchors, ...qrPlaces, ...liftPlaces, ...unitPlaces, ...slotPlaces, ...restroomPlaces, ...fireExitPlaces];
  const placeById = new Map(places.map((p) => [p.id, p]));
  const placeByStore = new Map(unitPlaces.filter((u) => u.storeId).map((u) => [u.storeId, u]));

  // ---- offers / promotions -----------------------------------------------
  const withStore = (o) => ({ ...o, store: storeById.get(o.store_id) || null, place: placeByStore.get(o.store_id) || null });
  const offers = (bundle.offers || []).filter((o) => !publicOnly || isOfferLive(o, day)).map(withStore).filter((o) => o.store);
  const promotions = (bundle.promotions || []).filter((p) => !publicOnly || isPromotionLive(p, day)).map(withStore).filter((p) => p.store);
  const offersByStore = new Map();
  for (const o of offers) { if (!offersByStore.has(o.store_id)) offersByStore.set(o.store_id, []); offersByStore.get(o.store_id).push(o); }

  const qr = (bundle.qr_anchors || []).filter((q) => q.active !== false).map((q) => ({ ...q, floor: floorById.get(q.floor_id)?.code }));
  const facilities = (bundle.facilities || []).map((f) => ({ ...f, floor: f.floor_id ? floorById.get(f.floor_id)?.code || null : null }));

  // Doctors sit in a room (the room's code); the room is where "navigate" goes.
  const unitByCode = new Map(unitPlaces.map((u) => [u.unit, u]));
  const doctors = (bundle.doctors || []).filter((x) => x.active !== false)
    .map((x) => ({ ...x, place: unitByCode.get(x.room_code) || null })).filter((x) => x.place)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  const doctorsByPlace = new Map();
  for (const x of doctors) { if (!doctorsByPlace.has(x.place.id)) doctorsByPlace.set(x.place.id, []); doctorsByPlace.get(x.place.id).push(x); }

  return {
    doctors, doctorsByPlace, unitByCode, settings: bundle.settings || {}, source: bundle.source,
    mall: bundle.mall, demo: !!bundle.demo, version: bundle.map_version,
    floors, floorByCode, categories, catById, stores, storeById,
    unitsByFloor, parkingByFloor, places, placeById, placeByStore,
    offers, offersByStore, promotions, qr, qrAlias, facilities,
    hasParking: () => false,
  };
}

// The place a QR code (?at=CODE) stands for, or null if unknown.
export function qrPlace(model, code) {
  const id = code ? model.qrAlias[String(code).toLowerCase()] : null;
  return id ? model.placeById.get(id) || null : null;
}
