import React from 'react';
import { FLOORS } from '../../data/floors.js';

// Vertical floor rail (top floor first), used on phone and desktop. Route
// floors get a blue bar, the start floor a hollow dot, the destination a red
// dot. Switching floors never alters the route — it only changes which
// floor's part of it is drawn.
export default function MobileFloorSelector({ floor, setFloor, routeFloors = [], startFloor, destFloor }) {
  return (
    <div className="mFloorRail" role="tablist" aria-label="Floor">
      {[...FLOORS].reverse().map(([code, name]) => (
        <button key={code} type="button" role="tab" aria-selected={floor === code} aria-label={name}
          className={'mFloorPill' + (floor === code ? ' on' : '') + (routeFloors.includes(code) ? ' onRoute' : '')}
          onClick={() => setFloor(code)}>
          {code}
          {destFloor === code && <span className="railDest" aria-hidden="true" />}
          {startFloor === code && destFloor !== code && <span className="railStart" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
