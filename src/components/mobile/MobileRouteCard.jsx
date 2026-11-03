import React from 'react';
import { ArrowUpDown, ChevronRight, X } from 'lucide-react';

// Always-visible FROM / TO card at the top of the map. Both rows are real
// buttons that open their own search, in any order, any number of times.
export default function MobileRouteCard({ startPlace, destPlace, onEditStart, onEditDest, onSwap, onClearDest }) {
  return (
    <div className="mRouteCard" aria-label="Route">
      <div className="mRouteRows">
        <button type="button" className="mRouteField" onClick={onEditStart} aria-label={`From: ${startPlace?.name ?? 'choose starting point'}`}>
          <span className="mDot mDotFrom" aria-hidden="true" />
          <span className="mRouteText"><small>FROM</small><b>{startPlace?.name ?? 'Choose starting point'}</b></span>
          {startPlace && <span className="mRouteFloor">{startPlace.floor}</span>}
          <ChevronRight className="mChevron" size={18} aria-hidden="true" />
        </button>
        <div className="mRouteDivider" />
        <div className="mRouteFieldWrap">
          <button type="button" className="mRouteField" onClick={onEditDest} aria-label={`To: ${destPlace?.name ?? 'search destination'}`}>
            <span className="mDot mDotTo" aria-hidden="true" />
            <span className="mRouteText"><small>TO</small><b className={destPlace ? '' : 'placeholder'}>{destPlace?.name ?? 'Search destination'}</b></span>
            {destPlace && <span className="mRouteFloor">{destPlace.floor}</span>}
            {!destPlace && <ChevronRight className="mChevron" size={18} aria-hidden="true" />}
          </button>
          {destPlace && <button type="button" className="mClearBtn" aria-label="Clear destination" onClick={onClearDest}><X size={18} /></button>}
        </div>
      </div>
      <button type="button" className="mSwapBtn" aria-label="Swap start and destination" disabled={!destPlace} onClick={onSwap}><ArrowUpDown size={18} /></button>
    </div>
  );
}
