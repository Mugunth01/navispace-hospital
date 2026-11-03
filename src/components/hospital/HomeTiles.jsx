import React from 'react';
import { Stethoscope, Microscope, Ambulance, Pill, Coffee, Toilet, Info, Banknote } from 'lucide-react';

// Quick destinations, like the hospital app home screen: one tap = route there.
// Each tile names the room codes it prefers; the first that exists wins.
const TILES = [
  { label: 'Emergency', Icon: Ambulance, color: '#e5484d', codes: ['emergency-triage'], cat: 'emergency' },
  { label: 'Reception', Icon: Info, color: '#e09b2d', codes: ['reception-registration'], cat: 'services' },
  { label: 'Pharmacy', Icon: Pill, color: '#2fa35a', codes: ['pharmacy-op'], cat: 'pharmacy' },
  { label: 'Laboratory', Icon: Microscope, color: '#4f7fe0', codes: ['sample-collection', 'clinical-laboratory'], cat: 'diagnostics' },
  { label: 'OPD clinics', Icon: Stethoscope, color: '#21a39a', search: 'opd' },
  { label: 'Billing', Icon: Banknote, color: '#8e6ad6', codes: ['billing-insurance'], cat: 'services' },
  { label: 'Cafeteria', Icon: Coffee, color: '#d97706', codes: ['cafeteria'], cat: 'amenities' },
  { label: 'Restrooms', Icon: Toilet, color: '#3b82c4', nearest: 'restroom' },
];

export default function HomeTiles({ model, onDirections, onNearest, onSearch, className = '' }) {
  const go = (t) => {
    if (t.nearest) return onNearest(t.nearest);
    if (t.search) return onSearch(t.search);
    const p = t.codes.map((c) => model.unitByCode.get(c)).find(Boolean)
      || Object.values(model.unitsByFloor).flat().find((u) => u.mapped && u.store?.category?.id === t.cat);
    if (p) onDirections(p.id);
  };
  return (
    <div className={'hTiles ' + className} role="group" aria-label="Quick destinations">
      {TILES.map((t) => (
        <button key={t.label} type="button" className="hTile" onClick={() => go(t)} style={{ '--tc': t.color }}>
          <span className="hTileIcon"><t.Icon size={20} strokeWidth={1.9} aria-hidden="true" /></span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
