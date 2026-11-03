import React, { useState } from 'react';
import { etaMinutes, formatMetres } from '../../utils/format.js';
import { LiftIcon, EscalatorIcon, PlaceIcon } from '../icons.jsx';

const TRAVEL_MODES = [
  { id: 'lift', Icon: LiftIcon, label: 'Lift' },
  { id: 'escalator', Icon: EscalatorIcon, label: 'Escalator' },
];
const WalkDot = () => <span className="stepDot" aria-hidden="true" />;
const STEP_ICON = { walk: WalkDot, lift: LiftIcon, escalator: EscalatorIcon };
const stepText = (s) => (s.type === 'walk' ? `Walk to ${s.toName}` : s.type === 'lift' ? `Lift ${s.coreId} · ${s.from} → ${s.to}` : `Escalator · ${s.from} → ${s.to}`);

// Compact route summary. Collapsed: destination, time, distance, Start.
// Expanded: travel mode and the full step list. Kept short so the route on
// the map stays visible above it.
export default function MobileRouteSheet({ destPlace, plan, totalDist, transportPref, onChangeTravelMode, onStart }) {
  const [open, setOpen] = useState(false);
  if (!destPlace || !plan) return null;
  const cross = plan.ok && plan.steps.some((s) => s.type !== 'walk');
  const crossFloor = plan.ok ? cross : true;

  return (
    <div className={'mSheet mRouteSheet' + (open ? ' open' : '')} role="region" aria-label={`Route to ${destPlace.name}`}>
      <button type="button" className="mSheetHandleBtn" aria-label={open ? 'Collapse route details' : 'Expand route details'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mSheetHandle" />
      </button>
      <div className="mSheetTitle">
        <span className="mSheetIcon"><PlaceIcon place={destPlace} size={20} /></span>
        <div className="mSheetTitleText">
          <b>{destPlace.name}</b>
          {plan.ok
            ? <small>{plan.same ? plan.note : `${etaMinutes(totalDist) ?? 1} min · ${formatMetres(totalDist)} walk · ${destPlace.floor}`}</small>
            : <small className="err">{plan.error}</small>}
        </div>
        {plan.ok && !plan.same && <button type="button" className="mStartBtn" onClick={onStart}>Start</button>}
      </div>
      {plan.note && !plan.same && <div className="mAdviseNote">{plan.note}</div>}
      {false && crossFloor && (
        <div className="mSeg" role="radiogroup" aria-label="Travel between floors by">
          {TRAVEL_MODES.map(({ id, Icon, label }) => (
            <button key={id} type="button" role="radio" aria-checked={transportPref === id}
              className={transportPref === id ? 'on' : ''} onClick={() => onChangeTravelMode(id)}>
              <Icon size={17} />{label}
            </button>
          ))}
        </div>
      )}
      {open && plan.ok && (
        <ol className="mStepList">
          {plan.steps.map((s, i) => <li key={i}>{React.createElement(STEP_ICON[s.type], { size: 16 })}{stepText(s)}{s.type === 'walk' && <small>{s.floor}</small>}</li>)}
        </ol>
      )}
    </div>
  );
}
