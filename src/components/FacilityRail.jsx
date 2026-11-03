import React from 'react';

// Same colour language as the in-map signs.
const FACILITIES = [
  { id: 'lift', label: 'Lifts', cls: 'lift', glyph: '⇅' },
  { id: 'escalator', label: 'Escalators', cls: 'esc', glyph: '⟋' },
  { id: 'stairs', label: 'Stairs', cls: 'stairs', glyph: '⌐' },
  { id: 'restroom', label: 'Restrooms', cls: 'wc', glyph: 'WC' },
];

export default function FacilityRail({ highlightType, setHighlightType }) {
  return (
    <div className="facilityRail">
      {FACILITIES.map((f) => (
        <button key={f.id} className={`facBtn ${f.cls}` + (highlightType === f.id ? ' on' : '')} title={f.label}
          onClick={() => setHighlightType(highlightType === f.id ? null : f.id)}>
          <span>{f.glyph}</span><small>{f.label}</small>
        </button>
      ))}
    </div>
  );
}
