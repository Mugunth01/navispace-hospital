import React from 'react';
import { FLOORS } from '../data/floors.js';

const KIND_META = {
  lift: { icon: '🛗', label: 'LIFT' },
  escalator: { icon: '⇗', label: 'ESCALATOR' },
  stairs: { icon: '🪜', label: 'STAIRS' },
};

// Info panel for a lift/escalator/stairs clicked on the map outside of a
// journey. A lift offers a floor grid to browse to that floor.
export default function TransitPanel({ kind, coreId, floor, onManualFloor, close }) {
  const meta = KIND_META[kind] || KIND_META.lift;
  return (
    <div className="liftPanel">
      <div className="lpTitle">{meta.icon} {meta.label} {coreId}<button onClick={close} aria-label="Close">×</button></div>
      <div className="display">Current floor <b>{floor}</b></div>
      {kind === 'lift' && (
        <>
          <div className="orJump">View floor:</div>
          <div className="liftBtns">
            {FLOORS.map((f) => (
              <button key={f[0]} className={f[0] === floor ? 'current' : ''} onClick={() => onManualFloor(f[0])}>{f[0]}</button>
            ))}
          </div>
        </>
      )}
      {kind === 'stairs' && <div className="note">Fire-escape stairs — emergency use only, not used for routing.</div>}
    </div>
  );
}
