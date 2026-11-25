// Booking data access. Live: Supabase RPCs (nav_* functions, see supabase/booking_schema.sql)
// with the publishable key, then a nudge to the send-mail function. Sample/demo builds: the same
// rules run in memory on the bundled sample data, so the pitch demo works offline.
import { DATA_MODE } from '../data/api/index.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isLive = () => DATA_MODE === 'live';

async function rest(path, opts = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.message || `Request failed (${r.status})`);
  return body;
}
const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
const kickMail = () => { fetch(`${URL_}/functions/v1/send-mail`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); };

// ── demo engine (mirrors the SQL rules) ─────────────────────────────────────
let seedP = null;
const seed = () => (seedP ||= import('../data/hospitalSeed.json').then((m) => m.default));
const mem = [];                                       // bookings made in this browser tab (demo only)
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const isoDow = (s) => { const d = new Date(`${s}T00:00:00`); return ((d.getDay() + 6) % 7) + 1; };
const DAYS_AHEAD = 14;
function demoDocs(db) { return db.doctors.map((d) => ({ ...d, id: d.id || d.code })); }
function demoSlots(db, doctorId, date, mode) {
  const d = demoDocs(db).find((x) => x.id === doctorId);
  if (!d || d.booking_enabled === false || (mode === 'online' && !d.online_enabled)) return [];
  const today = ymd(new Date()), nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const out = [];
  for (const s of db.sessions.filter((x) => x.doctor_code === d.code && x.mode === mode && x.weekday === isoDow(date))) {
    for (let t = toMin(s.start_time); t + d.slot_minutes <= toMin(s.end_time); t += d.slot_minutes) {
      const slot = fromMin(t);
      out.push({ slot, available: !(date === today && t <= nowMin + 15) && !mem.some((b) => b.doctor_id === d.id && b.date === date && b.time === slot && b.status === 'booked') });
    }
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot));
}
function demoLabSlots(db, date, tests) {
  const T = db.lab_tests.filter((t) => tests.includes(t.code));
  if (!T.length || T.length !== tests.length) return [];
  const scan = T.some((t) => t.category !== 'lab');
  if (scan && (T.length > 1 || isoDow(date) === 7)) return [];
  const [open, close, step, cap] = scan ? ['08:00', '18:00', 20, 1] : ['07:00', '13:00', 15, 8];
  const today = ymd(new Date()), nowMin = new Date().getHours() * 60 + new Date().getMinutes(), room = scan ? T[0].room_code : 'lab:collection';
  const out = [];
  for (let t = toMin(open); t + step <= toMin(close); t += step) {
    const slot = fromMin(t);
    const used = mem.filter((b) => b.kind === 'lab' && b.status === 'booked' && b.date === date && b.time === slot && b.room_code === room).length;
    out.push({ slot, free: date === today && t <= nowMin + 15 ? 0 : Math.max(0, cap - used) });
  }
  return out;
}
const nextDays = () => Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return ymd(d); });
const fail = (m) => { throw new Error(m); };

// ── public API ──────────────────────────────────────────────────────────────
export async function doctorSessions(doctor) {
  if (isLive()) return rest(`nav_doctor_sessions?doctor_id=eq.${doctor.id}&order=weekday,start_time`);
  const db = await seed();
  return db.sessions.filter((s) => s.doctor_code === doctor.code);
}
export async function doctorDays(doctorId, mode) {
  if (isLive()) return rpc('nav_doctor_days', { p_doctor: doctorId, p_mode: mode });
  const db = await seed();
  return nextDays().map((day) => ({ day, free: demoSlots(db, doctorId, day, mode).filter((s) => s.available).length }));
}
export async function doctorSlots(doctorId, date, mode) {
  if (isLive()) return (await rpc('nav_doctor_slots', { p_doctor: doctorId, p_date: date, p_mode: mode })).map((x) => ({ slot: x.slot.slice(0, 5), available: x.available }));
  return demoSlots(await seed(), doctorId, date, mode);
}
export async function labTests() {
  if (isLive()) return rest('nav_lab_tests?active=eq.true&order=sort');
  return (await seed()).lab_tests;
}
export async function labDays() { return nextDays().map((day) => ({ day, free: null })); }
export async function labSlots(date, tests) {
  if (isLive()) return (await rpc('nav_lab_slots', { p_date: date, p_tests: tests })).map((x) => ({ slot: x.slot.slice(0, 5), available: x.free > 0, free: x.free }));
  return demoLabSlots(await seed(), date, tests).map((x) => ({ ...x, available: x.free > 0 }));
}

export async function book(p) {
  if (isLive()) { const r = await rpc('nav_book', { p }); kickMail(); return r; }
  const db = await seed();
  if (!p.consent) fail('Please accept the consent to book.');
  const phone = String(p.phone || '').replace(/[^0-9+]/g, '');
  if (phone.length < 10) fail('Please enter a valid mobile number.');
  if (mem.filter((b) => b.phone === phone && b.status === 'booked').length >= 3) fail('This mobile number already has 3 upcoming bookings. Please cancel one first.');
  let room_code;
  if (p.kind === 'lab') {
    const T = db.lab_tests.filter((t) => p.tests.includes(t.code));
    if (T.length > 1 && T.some((t) => t.category !== 'lab')) fail('Scans and heart tests are booked one at a time. Book lab tests together, and each scan separately.');
    if (!(demoLabSlots(db, p.date, p.tests).find((x) => x.slot === p.time)?.free > 0)) fail('That slot is full or not available. Please pick another.');
    room_code = T.some((t) => t.category !== 'lab') ? T[0].room_code : 'lab:collection';
  } else {
    if (!demoSlots(db, p.doctor_id, p.date, p.kind).find((x) => x.slot === p.time)?.available) fail('That slot was just taken or is not available. Please pick another.');
    room_code = demoDocs(db).find((d) => d.id === p.doctor_id)?.room_code;
  }
  const ref = 'NH-' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01OI]/g, 'X');
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const video_url = p.kind === 'online' ? `https://meet.jit.si/NaviSpace-${ref}-${Math.random().toString(36).slice(2, 10)}` : null;
  mem.push({ ...p, phone, ref, token, video_url, room_code, status: 'booked' });
  return { ref, token, date: p.date, time: p.time, video_url, room_code, kind: p.kind, home_collection: !!p.home_collection && p.kind === 'lab' && room_code === 'lab:collection', demo: true };
}

export async function getBooking(ref, token) {
  if (isLive()) return rpc('nav_get_booking', { p_ref: ref, p_token: token });
  const db = await seed();
  const b = mem.find((x) => x.ref === String(ref).toUpperCase() && x.token === token);
  if (!b) return null;
  const d = b.doctor_id ? demoDocs(db).find((x) => x.id === b.doctor_id) : null;
  return {
    ref: b.ref, kind: b.kind, status: b.status, date: b.date, time: b.time, doctor: d?.name, speciality: d?.speciality, doctor_id: b.doctor_id,
    room_code: b.room_code === 'lab:collection' ? 'sample-collection' : b.room_code, video_url: b.video_url, name: b.name,
    tests: db.lab_tests.filter((t) => (b.tests || []).includes(t.code)).map((t) => t.name), cancel_reason: b.cancel_reason, cancelled_by: b.cancelled_by, home_collection: !!b.home_collection,
  };
}
export async function findBooking(ref, phone) {
  if (isLive()) return rpc('nav_find_booking', { p_ref: ref, p_phone: phone });
  const b = mem.find((x) => x.ref === String(ref).trim().toUpperCase() && x.phone === String(phone).replace(/[^0-9+]/g, ''));
  return b ? { ref: b.ref, token: b.token } : null;
}
export async function cancelBooking(ref, token, reason) {
  if (isLive()) { const r = await rpc('nav_cancel_booking', { p_ref: ref, p_token: token, p_reason: reason || '' }); kickMail(); return r; }
  const b = mem.find((x) => x.ref === ref && x.token === token && x.status === 'booked');
  if (!b) fail('Booking not found or already cancelled.');
  Object.assign(b, { status: 'cancelled', cancelled_by: 'patient', cancel_reason: reason || null });
  return { ok: true };
}
