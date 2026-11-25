import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Menu, ArrowUpDown, ChevronRight, X } from 'lucide-react';
import HospitalMenu from '../hospital/HospitalMenu.jsx';

// Top bar, like the NaviSpace mall app: hospital name + menu, then the route rows, so the map below stays clear.
//   no destination yet  one "Where to?" row, the starting point as a small line underneath
//   destination chosen  FROM / TO rows with swap and clear
// While navigating it becomes "Navigating to X".
export default function MobileHeader({ title, navigating, destName, onExitNavigation, theme, setTheme, colourMode, setColourMode, demo, navControls, route }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {   // tap outside closes the menu (but not taps inside the profile sheet it opened)
    if (!menuOpen) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target) && !e.target.closest?.('.rwOverlay')) setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);
  if (navigating) {
    return (
      <header className="mHeader mHeaderNav">
        <button type="button" className="mIconBtn" aria-label="Stop navigating" onClick={onExitNavigation}><ArrowLeft size={20} /></button>
        <div className="mHeaderTitles"><small>Navigating to</small><b>{destName}</b></div>
        {navControls}
      </header>
    );
  }
  return (
    <div className="mHeaderBox" role="banner">
      <div className="mHeader">
        <div className="mHeaderTitles">
          <b>{title || 'NaviSpace'}{demo && <span className="demoPill small">Sample data</span>}</b>
        </div>
        <div className="mMenuWrap" ref={wrap}>
          <button type="button" className="mIconBtn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Menu size={20} /></button>
          {menuOpen && (
            <div className="mMenuSheet acMenu" role="menu">
              <HospitalMenu theme={theme} setTheme={setTheme} colourMode={colourMode} setColourMode={setColourMode} onClose={() => setMenuOpen(false)} />
            </div>
          )}
        </div>
      </div>
      {route && <RouteRows {...route} />}
    </div>
  );
}

function RouteRows({ startPlace, destPlace, onEditStart, onEditDest, onSwap, onClearDest }) {
  if (!destPlace) {
    return (
      <div className="mWhere" aria-label="Route">
        <span className="mDot mDotTo" aria-hidden="true" />
        <div className="mWhereText">
          <button type="button" className="mWhereTo" onClick={onEditDest}>Where to?</button>
          <button type="button" className="mWhereFrom" onClick={onEditStart} aria-label={`Starting from ${startPlace?.name ?? 'nowhere yet'}. Change`}>
            from <b>{startPlace?.name ?? 'choose starting point'}</b>{startPlace && <> · {startPlace.floor}</>}
          </button>
        </div>
        <button type="button" className="mWhereGo" aria-label="Search destination" onClick={onEditDest}><ChevronRight size={20} /></button>
      </div>
    );
  }
  return (
    <div className="mRouteCard inHeader" aria-label="Route">
      <div className="mRouteRows">
        <button type="button" className="mRouteField" onClick={onEditStart} aria-label={`From: ${startPlace?.name ?? 'choose starting point'}`}>
          <span className="mDot mDotFrom" aria-hidden="true" />
          <span className="mRouteText"><small>FROM</small><b>{startPlace?.name ?? 'Choose starting point'}</b></span>
          {startPlace && <span className="mRouteFloor">{startPlace.floor}</span>}
        </button>
        <div className="mRouteDivider" />
        <div className="mRouteFieldWrap">
          <button type="button" className="mRouteField" onClick={onEditDest} aria-label={`To: ${destPlace.name}`}>
            <span className="mDot mDotTo" aria-hidden="true" />
            <span className="mRouteText"><small>TO</small><b>{destPlace.name}</b></span>
            <span className="mRouteFloor">{destPlace.floor}</span>
          </button>
          <button type="button" className="mClearBtn" aria-label="Clear destination" onClick={onClearDest}><X size={18} /></button>
        </div>
      </div>
      <button type="button" className="mSwapBtn" aria-label="Swap start and destination" onClick={onSwap}><ArrowUpDown size={18} /></button>
    </div>
  );
}
