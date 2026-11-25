import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Menu, ArrowUpDown, X } from 'lucide-react';
import HospitalMenu from '../hospital/HospitalMenu.jsx';

// Top bar, like the NaviSpace mall app: logo, hospital name and menu, then the start / destination card,
// so the map below stays clear. While navigating it becomes "Navigating to X".
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
        <span className="mLogo" aria-hidden="true">{(title || 'H').trim()[0].toUpperCase()}</span>
        <div className="mHeaderTitles">
          <b>{title || 'NaviSpace'}</b>
          <small>NaviSpace · Indoor navigation{demo && <span className="demoPill small">Sample data</span>}</small>
        </div>
        <div className="mMenuWrap" ref={wrap}>
          <button type="button" className="mIconBtn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Menu size={22} /></button>
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

// Always two rows, like the mall app: start (with its floor) over destination, swap on the right.
function RouteRows({ startPlace, destPlace, onEditStart, onEditDest, onSwap, onClearDest }) {
  return (
    <div className="mRouteCard inHeader" aria-label="Route">
      <div className="mRouteRows">
        <button type="button" className="mRouteField" onClick={onEditStart} aria-label={`From: ${startPlace?.name ?? 'choose starting point'}`}>
          <span className="mDot mDotFrom" aria-hidden="true" />
          <span className="mRouteText"><b>{startPlace?.name ?? 'Choose starting point'}</b></span>
          {startPlace && <span className="mRouteFloor">{startPlace.floor}</span>}
        </button>
        <div className="mRouteDivider" />
        <div className="mRouteFieldWrap">
          <button type="button" className="mRouteField" onClick={onEditDest} aria-label={`To: ${destPlace?.name ?? 'search destination'}`}>
            <span className="mDot mDotTo" aria-hidden="true" />
            <span className="mRouteText"><b className={destPlace ? '' : 'placeholder'}>{destPlace?.name ?? 'Search destination'}</b></span>
            {destPlace && <span className="mRouteFloor">{destPlace.floor}</span>}
          </button>
          {destPlace && <button type="button" className="mClearBtn" aria-label="Clear destination" onClick={onClearDest}><X size={18} /></button>}
        </div>
      </div>
      <button type="button" className="mSwapBtn" aria-label="Swap start and destination" disabled={!destPlace} onClick={onSwap}><ArrowUpDown size={20} /></button>
    </div>
  );
}
