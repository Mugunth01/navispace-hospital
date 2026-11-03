import React, { useState } from 'react';
import { FLOORS, floorIndex } from '../data/floors.js';
import { LiftIcon, EscalatorIcon } from './icons.jsx';

// The UI for the vertical step you're on. Lift and escalator deliberately
// behave differently:
//   Lift       — one press: a big button for the planned floor; the other
//                floors the lift serves are one tap away ("Another floor?").
//   Escalator  — Current floor → Next floor, one flight at a time, Continue.
// Shared by the desktop map panel and the mobile navigation card.
export default function TransportStep({ step, floor, onContinue, onChooseFloor, onShow, flight, riding = false, rideTo = null }) {
  const up = floorIndex(step.to) > floorIndex(step.from);
  if (floor !== step.from) {
    return (
      <div className="tStep">
        <div className="tTitle">{step.type === 'lift' ? <LiftIcon /> : <EscalatorIcon />} {step.type === 'lift' ? `Lift ${step.coreId}` : 'Escalator'} on {step.from}</div>
        <button type="button" className="route small" onClick={onShow}>Show {step.from}</button>
      </div>
    );
  }
  if (step.type === 'lift' && riding) {
    return (
      <div className="tStep tRiding" role="status" aria-label={`Riding lift ${step.coreId}`}>
        <div className="tHead">
          <span className="tBadge"><LiftIcon size={20} /></span>
          <div><b>Riding Lift {step.coreId}…</b><small>{step.from} → {rideTo || step.to} · doors closing</small></div>
        </div>
      </div>
    );
  }
  if (step.type === 'lift') return <LiftStep step={step} up={up} onChooseFloor={onChooseFloor} />;
  return (
    <div className="tStep" role="group" aria-label="Escalator">
      <div className="tHead">
        <span className="tBadge"><EscalatorIcon size={20} /></span>
        <div><b>Escalator {up ? 'up' : 'down'}</b><small>{flight && flight[1] > 1 ? `Flight ${flight[0]} of ${flight[1]} · one floor at a time` : 'One floor at a time'}</small></div>
      </div>
      <div className="tFlow">
        <div><small>Current floor</small><b>{step.from}</b></div>
        <span aria-hidden="true">{up ? '↑' : '↓'}</span>
        <div><small>Next floor</small><b>{step.to}</b></div>
      </div>
      <button type="button" className="route tBig" onClick={onContinue}>Continue to {step.to}</button>
    </div>
  );
}

// Lift: select the destination floor once. The planned floor is the big
// button; any other floor the lift serves is one tap behind "Another floor?".
function LiftStep({ step, up, onChooseFloor }) {
  const [more, setMore] = useState(false);
  const others = FLOORS.map((f) => f[0]).filter((f) => step.floors.includes(f) && f !== step.to).reverse();
  return (
    <div className="tStep" role="group" aria-label={`Lift ${step.coreId}`}>
      <div className="tHead">
        <span className="tBadge"><LiftIcon size={20} /></span>
        <div><b>Take Lift {step.coreId}</b><small>{up ? 'Up' : 'Down'} from {step.from} · select your floor</small></div>
      </div>
      <button type="button" className="route tBig" aria-label={`Go to ${step.to} (your destination floor)`} onClick={() => onChooseFloor(step.to)}>
        Go to {step.to}
      </button>
      {more ? (
        <div className="tChips" aria-label="Other floors">
          {others.map((f) => (
            <button key={f} type="button" disabled={f === step.from} className={f === step.from ? 'current' : ''}
              aria-label={`Go to ${f}`} onClick={() => onChooseFloor(f)}>{f}</button>
          ))}
        </div>
      ) : (
        <button type="button" className="linkBtn tMore" onClick={() => setMore(true)}>Another floor?</button>
      )}
    </div>
  );
}
