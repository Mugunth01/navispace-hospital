import React from 'react';
import './hospital.css';
import {
  Stethoscope, Microscope, Ambulance, Pill, BedDouble, Coffee, Info, Toilet, DoorOpen, MapPin, Footprints,
} from 'lucide-react';
import { LiftIcon } from '../icons.jsx';

const BY_CAT = { opd: Stethoscope, diagnostics: Microscope, emergency: Ambulance, pharmacy: Pill, inpatient: BedDouble, amenities: Coffee, services: Info };
export const catOf = (p) => p?.store?.category?.id || p?.categoryId || null;

export function RoomIcon({ place, size = 18 }) {
  if (place?.kind === 'LIFT') return <LiftIcon size={size} />;
  if (place?.kind === 'FACILITY') { const I = place.facility === 'restroom' ? Toilet : Footprints; return <I size={size} strokeWidth={1.8} aria-hidden="true" />; }
  if (place?.kind === 'ANCHOR') { const I = place.category === 'services' && place.id?.startsWith('kiosk') ? MapPin : DoorOpen; return <I size={size} strokeWidth={1.8} aria-hidden="true" />; }
  const I = BY_CAT[catOf(place)] || Stethoscope;
  return <I size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export const floorName = (model, code) => model?.floorByCode?.[code]?.name || code;

// "Ground Floor · Diagnostics"
export function roomSub(model, p) {
  return [floorName(model, p.floor), p.store?.category?.name].filter(Boolean).join(' · ');
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '');
// Doctors match on name ("rajesh", "dr raj"), speciality ("cardio") or the room name.
export function searchDoctors(model, q) {
  const t = norm(q).replace(/^dr\.?\s*/, '').trim();
  if (!t) return model.doctors;
  return model.doctors.filter((d) => [d.name.replace(/^dr\.?\s*/i, ''), d.speciality, d.place?.name, d.qualification].some((x) => norm(x).includes(t)));
}
export function searchRooms(model, q) {
  const t = norm(q).trim();
  const units = Object.values(model.unitsByFloor).flat().filter((u) => u.mapped && !u.hidden);
  if (!t) return units;
  const score = (u) => (norm(u.name).startsWith(t) ? 0 : norm(u.name).split(/\s+/).some((w) => w.startsWith(t)) ? 1 : 2);
  return units.filter((u) => [u.name, u.store?.category?.name, u.store?.keywords, u.nameTa].some((x) => norm(x).includes(t)))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function DoctorAvatar({ name }) {
  const initials = name.replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span className="hDocAvatar" aria-hidden="true">{initials}</span>;
}

export function DoctorRow({ d, model, onRoom, onDirections, compact = false }) {
  return (
    <div className={'hDocRow' + (compact ? ' compact' : '')}>
      <button type="button" className="hDocMain" onClick={() => onRoom?.(d.place)}>
        <DoctorAvatar name={d.name} />
        <span className="hDocText">
          <b>{d.name}</b>
          <small>{d.speciality}{d.qualification && !compact ? ` · ${d.qualification}` : ''}</small>
          <small className="hDocWhere">{d.place.name} · {floorName(model, d.place.floor)}{d.hours ? ` · ${d.days ? `${d.days} ` : ''}${d.hours}` : ''}</small>
        </span>
      </button>
      {onDirections && <button type="button" className="srDir" onClick={() => onDirections(d.place.id)}>Directions</button>}
    </div>
  );
}
