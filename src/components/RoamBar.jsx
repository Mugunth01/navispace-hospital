import React from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, X } from 'lucide-react';

const SPEEDS = [1, 2, 4];

// Street view bar: ‹ › step along the corridor, "Tour floor" takes a round of the
// whole floor (pause / resume any time). Look around by dragging, or with the
// turn / tilt / zoom buttons.
export default function RoamBar({ label, floorName, onBack, onForward, touring, toured, onToggleTour, speed, onSpeed, onExit, onDetails, desktop, front = false, onLeaveFront }) {
  const next = () => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  return (
    <div className={'roamBar' + (desktop ? ' desktop' : '')} role="region" aria-label="Street view">
      <div className="roamTop">
        <span className="roamLabel"><b>{label}</b>{floorName && <small> · {floorName}</small>}</span>
        {front && onLeaveFront && <button type="button" className="roamLink" onClick={onLeaveFront}>Walk</button>}
        {onDetails && <button type="button" className="roamLink" onClick={onDetails}>Room details</button>}
        <button type="button" className="roamClose" aria-label="Exit street view" title="Exit street view" onClick={onExit}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="roamRow">
        <button type="button" className="roamArrow" aria-label={front ? 'Previous shop' : 'Step back'} title={front ? 'Previous shop' : 'Step back'} onClick={onBack}><ChevronLeft size={24} aria-hidden="true" /></button>
        <button type="button" className={'roamTour' + (touring ? ' on' : '')} aria-pressed={touring} onClick={onToggleTour}>
          {touring ? <><Pause size={16} aria-hidden="true" /> Pause tour</> : <><Play size={16} aria-hidden="true" /> {toured ? 'Resume tour' : 'Tour this floor'}</>}
        </button>
        <button type="button" className="roamSpeed" aria-label={`Tour speed ${speed}x`} title="Tour speed" onClick={next}>{speed}×</button>
        <button type="button" className="roamArrow" aria-label={front ? 'Next shop' : 'Step forward'} title={front ? 'Next shop' : 'Step forward'} onClick={onForward}><ChevronRight size={24} aria-hidden="true" /></button>
      </div>
    </div>
  );
}
