import React, { useMemo, useState } from 'react';
import { Search, Toilet, Footprints, SlidersHorizontal } from 'lucide-react';
import { searchDoctors, searchRooms, roomSub, RoomIcon, DoctorRow } from './common.jsx';

// One search box for departments, rooms and doctors. A doctor result goes to
// the doctor's room; "Directions" routes there straight away.
export default function HospitalSearch({ model, onRoom, onDirections, onNearest, initialQuery = '', autoFocus = false }) {
  const [q, setQ] = useState(initialQuery);
  const [floor, setFloor] = useState('all');
  const [cat, setCat] = useState('all');
  const t = q.trim();
  const docs = useMemo(() => (t ? searchDoctors(model, t) : []), [model, t]);
  const rooms = useMemo(() => searchRooms(model, t).filter((u) => (floor === 'all' || u.floor === floor) && (cat === 'all' || u.store?.category?.id === cat)), [model, t, floor, cat]);
  const usedCats = useMemo(() => model.categories.filter((c) => Object.values(model.unitsByFloor).flat().some((u) => u.store?.category?.id === c.id)), [model]);
  const wantsWc = !t || /^(rest|toil|wash|wc|loo)/i.test(t);
  const wantsStairs = !t || /^(stair|exit|fire)/i.test(t);

  return (
    <div className="searchPanel hSearch">
      <div className="srInput">
        <Search size={17} aria-hidden="true" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Department, doctor or room…" aria-label="Search the hospital" />
      </div>
      {onNearest && (wantsWc || wantsStairs) && (
        <div className="srGroup">
          <div className="srHead">Nearby</div>
          {wantsWc && <div className="srRow"><button type="button" className="srMainBtn" onClick={() => onNearest('restroom')}><span className="srIcon"><Toilet size={18} aria-hidden="true" /></span><span className="srMain"><b>Nearest restroom</b><small>Closest one to where you are</small></span></button></div>}
          {wantsStairs && <div className="srRow"><button type="button" className="srMainBtn" onClick={() => onNearest('fire')}><span className="srIcon"><Footprints size={18} aria-hidden="true" /></span><span className="srMain"><b>Nearest stairs</b><small>Closest staircase to where you are</small></span></button></div>}
        </div>
      )}
      <div className="srFilters" role="group" aria-label="Filters">
        <SlidersHorizontal size={15} aria-hidden="true" />
        <select value={floor} onChange={(e) => setFloor(e.target.value)} aria-label="Floor filter">
          <option value="all">All floors</option>{model.floors.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Department type">
          <option value="all">All departments</option>{usedCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {t && docs.length > 0 && (
        <div className="srGroup">
          <div className="srHead">Doctors · {docs.length}</div>
          {docs.slice(0, 12).map((d) => <DoctorRow key={d.id || d.name} d={d} model={model} onRoom={onRoom} onDirections={onDirections} compact />)}
        </div>
      )}
      <div className="srGroup">
        <div className="srHead">{t ? 'Departments & rooms' : 'All departments & rooms'} · {rooms.length}</div>
        {t && !rooms.length && !docs.length && <div className="muted small srEmpty">No matches for “{q}”. Try “scan”, “heart” or a doctor’s name.</div>}
        {rooms.map((u) => (
          <div key={u.id} className="srRow">
            <button type="button" className="srMainBtn" onClick={() => onRoom(u)}>
              <span className="srIcon" style={{ color: u.store?.category?.color }}><RoomIcon place={u} /></span>
              <span className="srMain"><b>{u.name}</b><small>{roomSub(model, u)}{model.doctorsByPlace.get(u.id)?.length ? ` · ${model.doctorsByPlace.get(u.id).length} doctor${model.doctorsByPlace.get(u.id).length > 1 ? 's' : ''}` : ''}</small></span>
            </button>
            <button type="button" className="srDir" onClick={() => onDirections(u.id)}>Directions</button>
          </div>
        ))}
      </div>
    </div>
  );
}
