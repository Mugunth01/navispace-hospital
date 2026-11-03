import React, { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import HospitalMenu from './hospital/HospitalMenu.jsx';

export default function TopBar({ viewMode, setViewMode, theme, setTheme, colourMode, setColourMode, navigating, overview, setOverview, demo }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const first = '';
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target) && !e.target.closest?.('.rwOverlay')) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <header>
      <div className="seg" role="group" aria-label="View">
        <button className={viewMode === '3d' ? 'active' : ''} aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')}>3D View</button>
        <button className={viewMode === '2d' ? 'active' : ''} aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>2D Plan</button>
        {navigating && <button className={overview ? 'active' : ''} aria-pressed={overview} onClick={() => setOverview(!overview)}>Route overview</button>}
      </div>
      <div className="topSpacer" />
      {demo && <span className="demoPill" title="Could not reach the hospital database — showing the bundled sample layout">Sample data</span>}
      <div className="mMenuWrap" ref={wrap}>
        <button type="button" className="deskMenuBtn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          {first && <span className="acAvatar sm" aria-hidden="true">{first[0].toUpperCase()}</span>}
          {first && <span className="deskMenuName">{first}</span>}
          <Menu size={18} aria-hidden="true" />
        </button>
        {open && (
          <div className="mMenuSheet acMenu" role="menu">
            <HospitalMenu theme={theme} setTheme={setTheme} colourMode={colourMode} setColourMode={setColourMode} onClose={() => setOpen(false)} />
          </div>
        )}
      </div>
    </header>
  );
}
