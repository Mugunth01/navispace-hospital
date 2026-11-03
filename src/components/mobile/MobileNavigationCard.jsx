import React, { useState } from 'react';
import { Navigation, Map as MapIcon, Eye, Pause, Play, RotateCcw } from 'lucide-react';
import { WALK_SPEED_MPS } from '../../utils/guide.js';

// Card shown while navigating. One card per journey step:
//   walk       next instruction, distance left, a compact control bar, and "I'm at …"
//   lift       the lift's floor picker (TransportStep)
//   escalator  current / next floor and Continue (TransportStep)
// Kept deliberately small so the map (and the sponsored banner below the card)
// keep their room: no help paragraphs, one row of icon controls.
const SPEEDS = [1, 2, 4];

export default function MobileNavigationCard({ plan, stepIdx, step, floor, steps, dist, transport, onNext, onArrive, onExit, overview, setOverview, onBackToStep, desktop, walkPlaying, walkRemaining, onToggleWalk, onRestartWalk, pov = 'follow', setPov, walkSpeed = 1, setWalkSpeed, guidePhase = 'walk', onStartWalking, liftDoor = null, onPickFloor }) {
  const [moreFloors, setMoreFloors] = useState(false);
  if (!plan?.ok || !step) return null;
  const last = stepIdx === plan.steps.length - 1;
  const leaving = guidePhase === 'exit' || guidePhase === 'ready';
  const onStepFloor = floor === (step.type === 'walk' ? step.floor : step.from);
  const minutes = Math.max(1, Math.ceil(walkRemaining / (WALK_SPEED_MPS * walkSpeed) / 60));
  const started = walkRemaining !== dist;
  const nextSpeed = () => setWalkSpeed(SPEEDS[(SPEEDS.indexOf(walkSpeed) + 1) % SPEEDS.length]);

  return (
    <div className={'mNavCard' + (desktop ? ' desktop' : '')} role="region" aria-label="Navigation">
      <div className="mNavTop">
        <span className="mNavProgress"><span>Step {stepIdx + 1} of {plan.steps.length}</span>{step.type === 'walk' && step.toName && <span className="mNavDest"> · {step.toName}</span>}</span>
        {step.type !== 'walk' && (
          <button type="button" className="mNavToggle" aria-pressed={overview} onClick={() => setOverview(!overview)}>
            {overview ? <>Walk view</> : <><MapIcon size={14} aria-hidden="true" /> Overview</>}
          </button>
        )}
      </div>
      {!onStepFloor ? (
        <div className="mNavInstruction"><span>Your current step is on {step.type === 'walk' ? step.floor : step.from}.</span>
          <button type="button" className="mGhostBtn" onClick={onBackToStep}>Show it</button></div>
      ) : step.type === 'walk' ? (
        <>
          <div className="mNavInstruction">
            <span className="mNavArrowWrap"><Navigation className="mNavArrow" size={20} aria-hidden="true" /></span>
            <span className="mNavText">
              <span className="mNavMain">{steps[0] || `Walk to ${step.toName}`}</span>
              {steps.length > 2 && <small className="mNavThen">Then: {steps[1]}</small>}
            </span>
            <span className="mNavEta" aria-label={`${walkRemaining} metres, about ${minutes} minutes`}><b>{walkRemaining} m</b><small>{minutes} min</small></span>
          </div>
          {liftDoor && (
            <div className="mLiftWait" role="group" aria-label={`Lift ${liftDoor.coreId}`}>
              <span className="mLiftWaitTxt">Waiting for Lift {liftDoor.coreId}…</span>
              <button type="button" className="mLiftGo" aria-label={`Go to ${liftDoor.to} (your destination floor)`} onClick={() => onPickFloor(liftDoor.to)}>{liftDoor.to}</button>
              <button type="button" className="mLiftMore" aria-expanded={moreFloors} onClick={() => setMoreFloors((v) => !v)}>Other floor</button>
              {moreFloors && (
                <div className="mFloorBtns" aria-label="Other floors">
                  {liftDoor.floors.slice().reverse().filter((f) => f !== liftDoor.from && f !== liftDoor.to).map((f) => (
                    <button key={f} type="button" aria-label={`Go to ${f}`} onClick={() => onPickFloor(f)}>{f}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {leaving ? (
            <div className="mLiftOut" role="status">
              <b>{guidePhase === 'exit' ? 'Lift doors opening…' : `You're out of the lift on ${step.floor}`}</b>
              <span>{guidePhase === 'exit' ? 'Your guide is stepping out.' : 'This is where you are. Tap below to start walking.'}</span>
            </div>
          ) : (
            <div className="mNavBar" role="group" aria-label="Walking controls">
              {!(walkRemaining === 0 && started) && (
                <button type="button" className="mBarPlay" onClick={onToggleWalk} aria-pressed={walkPlaying}>
                  {walkPlaying ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
                  <span>{walkPlaying ? 'Pause' : started ? 'Resume' : 'Start'}</span>
                </button>
              )}
              <button type="button" className="mBarIcon" onClick={onRestartWalk} aria-label="Restart walk" title="Restart"><RotateCcw size={17} aria-hidden="true" /></button>
              {setWalkSpeed && <button type="button" className="mBarIcon mBarSpeed" onClick={nextSpeed} aria-label={`Walking speed ${walkSpeed}x. Tap to change`} title="Speed">{walkSpeed}×</button>}
              {setPov && <button type="button" className="mBarIcon" aria-pressed={pov === 'first'} onClick={() => setPov(pov === 'first' ? 'follow' : 'first')}
                aria-label={pov === 'first' ? 'Switch to follow view' : 'Switch to first person'} title={pov === 'first' ? 'Follow view' : 'First person'}><Eye size={17} aria-hidden="true" /></button>}
            </div>
          )}
          <div className="mNavActions">
            {leaving
              ? <button type="button" className="mPrimaryBtn" onClick={onStartWalking}>I'm on this floor · Start walking</button>
              : <>
                {!last && !liftDoor && <button type="button" className="mPrimaryBtn" onClick={onNext}>I'm at {step.toName}</button>}
                {last && <button type="button" className="mPrimaryBtn" onClick={onArrive}>I've arrived</button>}
              </>}
            <button type="button" className="mGhostBtn" onClick={onExit}>End</button>
          </div>
        </>
      ) : transport}
    </div>
  );
}
