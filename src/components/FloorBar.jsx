import React from 'react';
import { FLOORS } from '../data/floors.js';

// Short floor label used in the headers: Ground floor → GF, the rest keep their code (1F, 2F, B1 …).
export const floorShort = (code) => (code === 'G' ? 'GF' : code);

// A compact drop-down. The width is the width of its longest option — no padding to fill a row.
export function ViewSelect({ value, options, onChange, label = 'View', className = '' }) {
  return (
    <select className={'floorSel ' + className} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}

// Top-left of the map: two small drop-downs — the floor (full name) and the view
// (Standard / Street / Top). While walking a route neither is shown here: the current
// floor and the view drop-down move into the header instead (see NavHeaderControls).
export default function FloorBar({ floor, setFloor, navigating = false, viewValue, viewOptions, onView }) {
  if (navigating) return null;
  return (
    <div className="floorBar">
      <ViewSelect label="Change floor" value={floor} onChange={setFloor} options={[...FLOORS].reverse()} />
      {viewOptions && <ViewSelect label="Change view" value={viewValue} onChange={onView} options={viewOptions} />}
    </div>
  );
}

// Header strip shown while navigating: where you are now (GF), where you are heading
// (→ 1F) and the view drop-down on the right.
export function NavHeaderControls({ floor, destFloor, viewValue, viewOptions, onView }) {
  const name = FLOORS.find(([c]) => c === floor)?.[1] || floor;
  return (
    <div className="navHeadCtl">
      <span className="mFloorChip now" title={name} aria-label={`You are on ${name}`}>{floorShort(floor)}</span>
      {destFloor && destFloor !== floor && <span className="mFloorChip dest" aria-label={`Destination floor ${destFloor}`}>→ {floorShort(destFloor)}</span>}
      {viewOptions && <ViewSelect label="Change view" className="compact" value={viewValue} onChange={onView} options={viewOptions} />}
    </div>
  );
}
