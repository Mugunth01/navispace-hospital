import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowLeft, Video, MapPin, CalendarPlus, CheckCircle2, Languages, Award, Clock, FlaskConical, ScanLine, HeartPulse, Home, Search, Copy } from 'lucide-react';
import * as B from './api.js';
import { DoctorAvatar } from '../components/hospital/common.jsx';
import './booking.css';

// One overlay for everything appointment-related. req:
//   {type:'profile', doctorId} | {type:'doctor', doctorId, mode} | {type:'lab'} | {type:'manage', ref, token} | {type:'find'}
const WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDay = (s, long = false) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
const rupees = (n) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);
function sessionsText(sess, mode) {
  const s = sess.filter((x) => x.mode === mode);
  if (!s.length) return null;
  const byTime = new Map();
  for (const x of s) { const k = `${fmtTime(x.start_time.slice(0, 5))} – ${fmtTime(x.end_time.slice(0, 5))}`; byTime.set(k, [...(byTime.get(k) || []), x.weekday]); }
  return [...byTime].map(([t, days]) => `${[...new Set(days)].sort().map((d) => WD[d]).join(', ')} · ${t}`);
}
function gcalUrl(title, date, time, mins, where) {
  const s = `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const [h, m] = time.split(':').map(Number), e = new Date(2000, 0, 1, h, m + mins);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${s}/${date.replace(/-/g, '')}T${pad(e.getHours())}${pad(e.getMinutes())}00&ctz=Asia/Kolkata&location=${encodeURIComponent(where)}`;
}

export default function BookingSheet({ model, req, onClose, onDirections }) {
  const [view, setView] = useState(req);
  useEffect(() => setView(req), [req]);
  const doctor = view.doctorId ? model.doctors.find((d) => d.id === view.doctorId || d.code === view.doctorId) : null;
  const where = (code) => { const u = model.unitByCode.get(code); return u ? `${u.name} · ${model.floorByCode[u.floor]?.name || u.floor}` : ''; };
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  let title = 'Book appointment', body = null, back = null;
  if ((view.type === 'profile' || view.type === 'doctor') && !doctor) body = <div className="bkEmpty">This doctor is not available for booking.</div>;
  else if (view.type === 'profile') { title = 'Doctor profile'; body = <Profile d={doctor} where={where} onBook={(mode) => setView({ type: 'doctor', doctorId: doctor.id, mode })} onDirections={() => onDirections(doctor.room_code)} />; }
  else if (view.type === 'doctor') {
    title = view.mode === 'online' ? 'Online consultation' : 'Book clinic visit';
    back = () => setView({ type: 'profile', doctorId: doctor.id });
    body = <DoctorBooking key={doctor.id + view.mode} d={doctor} mode={view.mode} where={where} onDone={(r) => setView({ type: 'done', res: r, doctorId: doctor.id })} />;
  } else if (view.type === 'lab') { title = 'Lab tests & scans'; body = <LabBooking model={model} where={where} onDone={(r, tests) => setView({ type: 'done', res: r, tests })} />; }
  else if (view.type === 'done') { title = 'Booking confirmed'; body = <Done res={view.res} d={doctor} tests={view.tests} where={where} onDirections={onDirections} onManage={() => setView({ type: 'manage', ref: view.res.ref, token: view.res.token })} />; }
  else if (view.type === 'manage') { title = 'My booking'; body = <Manage ref_={view.ref} token={view.token} where={where} onDirections={onDirections} onRebook={(docId) => setView(docId ? { type: 'profile', doctorId: docId } : { type: 'lab' })} />; }
  else if (view.type === 'find') { title = 'My booking'; body = <Find onFound={(r) => setView({ type: 'manage', ref: r.ref, token: r.token })} />; }

  return (
    <div className="bkScrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bkSheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="bkHead">
          {back ? <button type="button" className="bkIcon" onClick={back} aria-label="Back"><ArrowLeft size={18} /></button> : <span className="bkIconSp" />}
          <h2>{title}</h2>
          <button type="button" className="bkIcon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="bkBody">{body}</div>
        {B.isLive() ? null : <div className="bkDemo">Demo mode · bookings stay in this browser tab and no email is sent.</div>}
      </div>
    </div>
  );
}

function Photo({ d, size = 72 }) {
  return d.photo_url ? <img className="bkPhoto" src={d.photo_url} alt="" width={size} height={size} style={{ width: size, height: size }} /> : <span className="bkPhotoInit" style={{ width: size, height: size }}><DoctorAvatar name={d.name} /></span>;
}

function Profile({ d, where, onBook, onDirections }) {
  const [sess, setSess] = useState(null);
  useEffect(() => { B.doctorSessions(d).then(setSess).catch(() => setSess([])); }, [d]);
  const opd = sess && sessionsText(sess, 'inperson'), online = sess && sessionsText(sess, 'online');
  return (
    <div className="bkProfile">
      <div className="bkDocHead">
        <Photo d={d} size={76} />
        <div>
          <h3>{d.name}</h3>
          <div className="bkDesig">{d.designation || d.speciality}</div>
          <div className="bkMuted">{d.speciality}{d.qualification ? ` · ${d.qualification}` : ''}</div>
        </div>
      </div>
      <div className="bkFacts">
        {d.experience_years != null && <span><Award size={14} /> {d.experience_years} yrs experience</span>}
        {d.languages && <span><Languages size={14} /> {d.languages}</span>}
      </div>
      {d.bio && <p className="bkBio">{d.bio}</p>}
      <div className="bkCard">
        <div className="bkRow"><MapPin size={16} /><div><b>{where(d.room_code)}</b><button type="button" className="bkLink" onClick={onDirections}>Directions</button></div></div>
        <div className="bkRow"><Clock size={16} /><div>
          <b>Clinic (OPD)</b>{sess == null ? <div className="bkMuted">Loading…</div> : opd ? opd.map((t) => <div key={t} className="bkMuted">{t}</div>) : <div className="bkMuted">{d.days} {d.hours}</div>}
        </div></div>
        {online && <div className="bkRow"><Video size={16} /><div><b>Online consultation</b>{online.map((t) => <div key={t} className="bkMuted">{t}</div>)}</div></div>}
      </div>
      {d.booking_enabled === false
        ? <div className="bkNote">Walk in — no appointment needed ({d.speciality}).</div>
        : <div className="bkActions">
            <button type="button" className="route" onClick={() => onBook('inperson')}>Book clinic visit</button>
            {d.online_enabled && <button type="button" className="ghost" onClick={() => onBook('online')}><Video size={15} /> Book online consultation</button>}
          </div>}
    </div>
  );
}

// Date chips + grouped slot grid.
function SlotPicker({ loadDays, loadSlots, value, onChange, deps = [], note }) {
  const [days, setDays] = useState(null), [day, setDay] = useState(null), [slots, setSlots] = useState(null), [err, setErr] = useState('');
  const auto = React.useRef(0);   // >0 while the picker is choosing the first day itself
  useEffect(() => {
    setDays(null); setDay(null); setSlots(null);
    loadDays().then((ds) => { setDays(ds); auto.current = 1; const first = ds.find((x) => x.free == null || x.free > 0); setDay(first?.day || null); }).catch((e) => setErr(e.message));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!day) return; setSlots(null); onChange(null);
    loadSlots(day).then((list) => {
      // Nothing left today (e.g. the lab closed at 1 pm)? Move on to the next day by itself, a few times at most.
      if (auto.current && auto.current < 6 && !list.some((s) => s.available) && days) {
        const i = days.findIndex((x) => x.day === day), next = days.slice(i + 1).find((x) => x.free == null || x.free > 0);
        if (next) { auto.current++; setDay(next.day); return; }
      }
      auto.current = 0; setSlots(list);
    }).catch((e) => setErr(e.message));
  }, [day, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const g = [['Morning', []], ['Afternoon', []], ['Evening', []]];
    for (const s of slots || []) g[+s.slot.slice(0, 2) < 12 ? 0 : +s.slot.slice(0, 2) < 17 ? 1 : 2][1].push(s);
    return g.filter(([, l]) => l.length);
  }, [slots]);
  if (err) return <div className="bkErr" role="alert">{err}</div>;
  if (!days) return <div className="bkMuted">Loading dates…</div>;
  return (
    <div className="bkPicker">
      <div className="bkDays" role="listbox" aria-label="Date">
        {days.map((x) => {
          const off = x.free === 0;
          return (
            <button key={x.day} type="button" role="option" aria-selected={day === x.day} disabled={off} className={'bkDay' + (day === x.day ? ' on' : '')} onClick={() => { auto.current = 0; setDay(x.day); }}>
              <span>{fmtDay(x.day).split(' ')[0].replace(',', '')}</span><b>{new Date(`${x.day}T00:00:00`).getDate()}</b>
              <small>{x.free == null ? new Date(`${x.day}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }) : off ? '—' : `${x.free} free`}</small>
            </button>
          );
        })}
      </div>
      {note}
      {!day ? <div className="bkMuted">No free dates in the next two weeks.</div>
        : slots == null ? <div className="bkMuted">Loading times…</div>
        : !slots.length ? <div className="bkMuted">No sessions on {fmtDay(day, true)}.</div>
        : groups.map(([label, list]) => (
          <div key={label} className="bkSlotGroup">
            <div className="bkSlotHead">{label}</div>
            <div className="bkSlots">
              {list.map((s) => (
                <button key={s.slot} type="button" disabled={!s.available} aria-pressed={value?.time === s.slot && value?.date === day}
                  className={'bkSlot' + (value?.time === s.slot && value?.date === day ? ' on' : '')} onClick={() => onChange({ date: day, time: s.slot })}>
                  {fmtTime(s.slot)}{s.free > 1 && s.free < 4 ? <small> · {s.free} left</small> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function PatientForm({ busy, err, onSubmit, submitLabel, extra }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', age: '', gender: '', reason: '', consent: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const ok = f.name.trim().length >= 2 && f.phone.replace(/\D/g, '').length >= 10 && f.consent;
  return (
    <form className="bkForm" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(f); }}>
      <label>Patient name<input value={f.name} onChange={set('name')} autoComplete="name" required maxLength={80} /></label>
      <div className="bkTwo">
        <label>Mobile number<input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" required placeholder="10-digit mobile" maxLength={16} /></label>
        <label>Email <span className="bkOpt">(for confirmation)</span><input type="email" value={f.email} onChange={set('email')} autoComplete="email" maxLength={120} /></label>
      </div>
      <div className="bkTwo">
        <label>Age<input value={f.age} onChange={set('age')} inputMode="numeric" maxLength={3} /></label>
        <label>Gender<select value={f.gender} onChange={set('gender')}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
      </div>
      {extra}
      <label>Reason for visit <span className="bkOpt">(optional)</span><textarea value={f.reason} onChange={set('reason')} rows={2} maxLength={500} /></label>
      <label className="bkCheck"><input type="checkbox" checked={f.consent} onChange={set('consent')} />
        <span>I agree that the hospital may store these details to manage this booking and contact me about it.</span></label>
      {err && <div className="bkErr" role="alert">{err}</div>}
      <button type="submit" className="route" disabled={!ok || busy}>{busy ? 'Booking…' : submitLabel}</button>
    </form>
  );
}

function Summary({ items }) {
  return <div className="bkSummary">{items.filter(Boolean).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>;
}

function DoctorBooking({ d, mode, where, onDone }) {
  const [pick, setPick] = useState(null), [step, setStep] = useState(1), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function submit(f) {
    setBusy(true); setErr('');
    try { onDone(await B.book({ kind: mode, doctor_id: d.id, date: pick.date, time: pick.time, ...f })); }
    catch (e) { setErr(e.message); if (/slot/i.test(e.message)) { setStep(1); setPick(null); } }
    finally { setBusy(false); }
  }
  return (
    <div>
      <div className="bkMini"><Photo d={d} size={40} /><div><b>{d.name}</b><div className="bkMuted">{d.speciality} · {mode === 'online' ? 'Video call' : where(d.room_code)}</div></div></div>
      {step === 1 ? (
        <>
          <h4 className="bkStep">1 · Choose a date and time</h4>
          <SlotPicker value={pick} onChange={setPick} deps={[d.id, mode]} loadDays={() => B.doctorDays(d.id, mode)} loadSlots={(day) => B.doctorSlots(d.id, day, mode)} />
          {err && <div className="bkErr" role="alert">{err}</div>}
          <button type="button" className="route bkNext" disabled={!pick} onClick={() => setStep(2)}>Continue</button>
        </>
      ) : (
        <>
          <Summary items={[['When', `${fmtDay(pick.date, true)}, ${fmtTime(pick.time)}`], ['Type', mode === 'online' ? 'Online consultation (video link by email)' : 'Clinic visit']]} />
          <button type="button" className="bkLink" onClick={() => setStep(1)}>Change time</button>
          <h4 className="bkStep">2 · Patient details</h4>
          <PatientForm busy={busy} err={err} onSubmit={submit} submitLabel="Confirm booking" />
        </>
      )}
    </div>
  );
}

const CATS = [['lab', 'Lab tests', FlaskConical], ['imaging', 'Scans', ScanLine], ['cardiac', 'Heart & lung', HeartPulse]];
function LabBooking({ where, onDone }) {
  const [tests, setTests] = useState(null), [cat, setCat] = useState('lab'), [sel, setSel] = useState([]), [q, setQ] = useState('');
  const [step, setStep] = useState(1), [pick, setPick] = useState(null), [home, setHome] = useState(false), [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { B.labTests().then(setTests).catch((e) => setErr(e.message)); }, []);
  if (!tests) return err ? <div className="bkErr">{err}</div> : <div className="bkMuted">Loading tests…</div>;
  const chosen = tests.filter((t) => sel.includes(t.code));
  const scan = chosen.some((t) => t.category !== 'lab');
  const homeOk = chosen.length > 0 && !scan && chosen.every((t) => t.home_collection);
  const list = tests.filter((t) => t.category === cat && (!q || `${t.name} ${t.department}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (t) => {
    if (t.category !== 'lab') setSel(sel.includes(t.code) ? [] : [t.code]);            // one scan per booking
    else setSel(scan ? [t.code] : sel.includes(t.code) ? sel.filter((c) => c !== t.code) : [...sel, t.code]);
  };
  async function submit(f) {
    setBusy(true); setErr('');
    try { onDone(await B.book({ kind: 'lab', tests: sel, date: pick.date, time: pick.time, home_collection: home && homeOk, address: home ? address : '', ...f }), chosen); }
    catch (e) { setErr(e.message); if (/slot/i.test(e.message)) { setStep(2); setPick(null); } }
    finally { setBusy(false); }
  }
  const total = chosen.reduce((s, t) => s + (t.price || 0), 0);
  if (step === 1) return (
    <div>
      <div className="bkTabs" role="tablist">
        {CATS.map(([id, label, I]) => <button key={id} type="button" role="tab" aria-selected={cat === id} className={cat === id ? 'on' : ''} onClick={() => setCat(id)}><I size={15} /> {label}</button>)}
      </div>
      <div className="bkSearch"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests…" aria-label="Search tests" /></div>
      <div className="bkTests">
        {list.map((t) => (
          <label key={t.code} className={'bkTest' + (sel.includes(t.code) ? ' on' : '')}>
            <input type={t.category === 'lab' ? 'checkbox' : 'radio'} checked={sel.includes(t.code)} onChange={() => toggle(t)} name={t.category === 'lab' ? undefined : 'scan'} />
            <div><b>{t.name}</b><small>{t.department} · {t.sample !== '—' ? `${t.sample} · ` : ''}Report: {t.turnaround}</small><small className="bkPrep">{t.prep}</small></div>
            <span className="bkPrice">{rupees(t.price)}</span>
          </label>
        ))}
      </div>
      <div className="bkBar">
        <div>{chosen.length ? <><b>{chosen.length} selected</b> · {rupees(total)}<div className="bkMuted small">{scan ? 'Scans are booked one at a time.' : 'Pay at the counter.'}</div></> : <span className="bkMuted">Pick lab tests (several) or one scan.</span>}</div>
        <button type="button" className="route" disabled={!chosen.length} onClick={() => setStep(2)}>Continue</button>
      </div>
    </div>
  );
  return (
    <div>
      <Summary items={[['Tests', chosen.map((t) => t.name).join(', ')], ['Where', home && homeOk ? 'Home sample collection' : where(scan ? chosen[0].room_code : 'sample-collection')], ['Estimated', rupees(total)]]} />
      <button type="button" className="bkLink" onClick={() => { setStep(1); setPick(null); }}>Change tests</button>
      {step === 2 ? (
        <>
          <h4 className="bkStep">Choose a date and time</h4>
          {homeOk && <label className="bkCheck bkHome"><input type="checkbox" checked={home} onChange={(e) => setHome(e.target.checked)} /><span><Home size={14} /> Home sample collection — our phlebotomist comes to you in this time slot</span></label>}
          <SlotPicker value={pick} onChange={setPick} deps={[sel.join(',')]} loadDays={B.labDays} loadSlots={(day) => B.labSlots(day, sel)}
            note={scan ? <div className="bkMuted small">Scans: Monday to Saturday.</div> : null} />
          {err && <div className="bkErr" role="alert">{err}</div>}
          <button type="button" className="route bkNext" disabled={!pick} onClick={() => setStep(3)}>Continue</button>
        </>
      ) : (
        <>
          <Summary items={[['When', `${fmtDay(pick.date, true)}, ${fmtTime(pick.time)}`]]} />
          <button type="button" className="bkLink" onClick={() => setStep(2)}>Change time</button>
          <div className="bkPrepBox"><b>Before you come</b>{chosen.map((t) => <div key={t.code}>• <b>{t.name}:</b> {t.prep}</div>)}</div>
          <h4 className="bkStep">Patient details</h4>
          <PatientForm busy={busy} err={err} onSubmit={submit} submitLabel="Confirm booking"
            extra={home && homeOk ? <label>Address for home collection<textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} required maxLength={300} /></label> : null} />
        </>
      )}
    </div>
  );
}

function Done({ res, d, tests, where, onDirections, onManage }) {
  const [copied, setCopied] = useState(false);
  const roomCode = res.room_code === 'lab:collection' ? 'sample-collection' : res.room_code;
  const place = res.kind === 'online' ? 'Online (video call)' : res.home_collection ? 'Home sample collection' : where(roomCode);
  const link = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?booking=${res.ref}&t=${res.token}` : '';
  return (
    <div className="bkDone">
      <CheckCircle2 size={46} className="bkOk" />
      <div className="bkRef">Booking ID <b>{res.ref}</b></div>
      <Summary items={[
        d ? ['Doctor', `${d.name} · ${d.speciality}`] : ['Tests', (tests || []).map((t) => t.name).join(', ')],
        ['When', `${fmtDay(res.date, true)}, ${fmtTime(res.time)}`], ['Where', place],
      ]} />
      <p className="bkMuted small">{B.isLive() ? 'A confirmation email with these details is on its way (if you gave an email).' : 'In the live system the patient also gets a confirmation email with these details.'} Please arrive 15 minutes early.</p>
      <div className="bkActions">
        {res.video_url && <a className="route bkA" href={res.video_url} target="_blank" rel="noopener noreferrer"><Video size={15} /> Video link (opens at your time)</a>}
        {res.kind !== 'online' && !res.home_collection && <button type="button" className="route" onClick={() => onDirections(roomCode)}><MapPin size={15} /> Directions inside the hospital</button>}
        <a className="ghost bkA" href={gcalUrl(`Appointment · ${d ? d.name : 'Lab'}`, res.date, res.time, d?.slot_minutes || 15, res.video_url || place)} target="_blank" rel="noopener noreferrer"><CalendarPlus size={15} /> Add to Google Calendar</a>
        <button type="button" className="ghost" onClick={() => { navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {}); }}><Copy size={15} /> {copied ? 'Link copied' : 'Copy booking link'}</button>
        <button type="button" className="bkLink" onClick={onManage}>View or cancel this booking</button>
      </div>
    </div>
  );
}

function Manage({ ref_, token, where, onDirections, onRebook }) {
  const [b, setB] = useState(undefined), [confirm, setConfirm] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const load = () => B.getBooking(ref_, token).then((x) => setB(x || null)).catch((e) => { setErr(e.message); setB(null); });
  useEffect(() => { load(); }, [ref_, token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (b === undefined) return <div className="bkMuted">Loading booking…</div>;
  if (!b) return <div className="bkErr" role="alert">{err || 'Booking not found. Check the link in your confirmation email.'}</div>;
  const STATUS = { booked: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed', no_show: 'Missed' };
  async function cancel() { setBusy(true); setErr(''); try { await B.cancelBooking(ref_, token, reason); setConfirm(false); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <div>
      <div className="bkRef">Booking ID <b>{b.ref}</b> <span className={'bkStatus ' + b.status}>{STATUS[b.status]}</span></div>
      <Summary items={[
        b.doctor ? ['Doctor', `${b.doctor} · ${b.speciality}`] : ['Tests', (b.tests || []).join(', ')],
        ['When', `${fmtDay(b.date, true)}, ${fmtTime(b.time)}`],
        ['Where', b.kind === 'online' ? 'Online (video call)' : b.home_collection ? 'Home sample collection' : where(b.room_code)],
        b.status === 'cancelled' && ['Reason', `${b.cancelled_by === 'patient' ? 'Cancelled by you' : 'Cancelled by the hospital'}${b.cancel_reason ? ` — ${b.cancel_reason}` : ''}`],
      ]} />
      {err && <div className="bkErr" role="alert">{err}</div>}
      {b.status === 'booked' && !confirm && (
        <div className="bkActions">
          {b.video_url && <a className="route bkA" href={b.video_url} target="_blank" rel="noopener noreferrer"><Video size={15} /> Join video consultation</a>}
          {b.kind !== 'online' && !b.home_collection && <button type="button" className="route" onClick={() => onDirections(b.room_code)}><MapPin size={15} /> Directions</button>}
          <button type="button" className="ghost warn" onClick={() => setConfirm(true)}>Cancel booking</button>
        </div>
      )}
      {confirm && (
        <div className="bkCard">
          <b>Cancel this booking?</b>
          <label className="bkForm">Reason (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></label>
          <div className="bkActions row"><button type="button" className="ghost" onClick={() => setConfirm(false)}>Keep it</button><button type="button" className="route danger" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Yes, cancel'}</button></div>
        </div>
      )}
      {b.status === 'cancelled' && <button type="button" className="route" onClick={() => onRebook(b.doctor_id)}>Book a new slot</button>}
    </div>
  );
}

function Find({ onFound }) {
  const [ref, setRef] = useState(''), [phone, setPhone] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await B.findBooking(ref, phone); if (r) onFound(r); else setErr('No booking matches this ID and mobile number.'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="bkForm" onSubmit={go}>
      <p className="bkMuted">Enter the booking ID from your confirmation and the mobile number you booked with.</p>
      <label>Booking ID<input value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="NH-XXXXXX" required maxLength={12} /></label>
      <label>Mobile number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required maxLength={16} /></label>
      {err && <div className="bkErr" role="alert">{err}</div>}
      <button type="submit" className="route" disabled={busy}>{busy ? 'Finding…' : 'Find my booking'}</button>
    </form>
  );
}
