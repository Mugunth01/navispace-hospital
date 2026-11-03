import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import HospitalMenu from '../hospital/HospitalMenu.jsx';

// Compact top bar: branded normally, "Navigating to X" while navigating.
export default function MobileHeader({ title, navigating, destName, onExitNavigation, theme, setTheme, colourMode, setColourMode, demo, navControls }) {
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
    <header className="mHeader">
      <div className="mHeaderTitles">
        <b>{title || 'NaviSpace'}</b>
        <small>NaviSpace · Indoor navigation{demo && <span className="demoPill small">Sample data</span>}</small>
      </div>
      <div className="mMenuWrap" ref={wrap}>
        <button type="button" className="mIconBtn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Menu size={20} /></button>
        {menuOpen && (
          <div className="mMenuSheet acMenu" role="menu">
            <HospitalMenu theme={theme} setTheme={setTheme} colourMode={colourMode} setColourMode={setColourMode} onClose={() => setMenuOpen(false)} />
          </div>
        )}
      </div>
    </header>
  );
}
