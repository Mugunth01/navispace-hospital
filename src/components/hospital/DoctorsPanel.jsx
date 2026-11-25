import React, { useMemo, useState } from 'react';
import { Search, FlaskConical, Ticket } from 'lucide-react';
import { searchDoctors, DoctorRow, openBooking } from './common.jsx';

// Doctors directory: search by name or speciality, filter by speciality, and
// go straight to the consultation room.
export default function DoctorsPanel({ model, onRoom, onDirections }) {
  const [q, setQ] = useState('');
  const [spec, setSpec] = useState('');
  const specs = useMemo(() => [...new Set(model.doctors.map((d) => d.speciality.split(' · ')[0]))].sort(), [model]);
  const list = useMemo(() => searchDoctors(model, q).filter((d) => !spec || d.speciality.startsWith(spec)), [model, q, spec]);
  return (
    <div className="searchPanel hDoctors">
      <div className="hBookBar">
        <button type="button" onClick={() => openBooking({ type: 'lab' })}><FlaskConical size={16} aria-hidden="true" /> Lab tests &amp; scans</button>
        <button type="button" onClick={() => openBooking({ type: 'find' })}><Ticket size={16} aria-hidden="true" /> My booking</button>
      </div>
      <div className="srInput">
        <Search size={17} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Doctor name or speciality…" aria-label="Search doctors" />
      </div>
      <div className="hChips" role="group" aria-label="Speciality">
        <button type="button" className={'mChip' + (spec ? '' : ' on')} aria-pressed={!spec} onClick={() => setSpec('')}>All</button>
        {specs.map((s) => <button key={s} type="button" className={'mChip' + (spec === s ? ' on' : '')} aria-pressed={spec === s} onClick={() => setSpec(spec === s ? '' : s)}>{s}</button>)}
      </div>
      <div className="srGroup">
        <div className="srHead">Doctors · {list.length}</div>
        {!list.length && <div className="muted small srEmpty">No doctor matches “{q}”.</div>}
        {list.map((d) => <DoctorRow key={d.id || d.name} d={d} model={model} onRoom={onRoom} onDirections={onDirections} />)}
      </div>
    </div>
  );
}
