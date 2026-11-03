import React from 'react';

// Menu: colour theme and room colours (no visitor accounts in the hospital pilot).
export default function HospitalMenu({ theme, setTheme, colourMode, setColourMode, onClose }) {
  return (
    <>
      <div className="mMenuLabel">Appearance</div>
      <div className="mThemeSwitch" role="radiogroup" aria-label="Colour theme">
        {[['light', '☀', 'Light'], ['dark', '☾', 'Dark']].map(([id, glyph, label]) => (
          <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? 'on' : ''} onClick={() => { setTheme(id); onClose?.(); }}>
            <span aria-hidden="true">{glyph}</span>{label}
          </button>
        ))}
      </div>
      <div className="mMenuLabel" style={{ marginTop: 10 }}>Room colours</div>
      <div className="mThemeSwitch" role="radiogroup" aria-label="Room colours">
        {[['neutral', 'Classic'], ['category', 'By department']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={colourMode === id} className={colourMode === id ? 'on' : ''} onClick={() => { setColourMode(id); onClose?.(); }}>{label}</button>
        ))}
      </div>
    </>
  );
}
