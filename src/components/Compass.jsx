import React from 'react';

export default function Compass() {
  return (
    <div className="compass" title="North. On the mall's boards north is toward the bottom of the page (the north gate is at the bottom), so the arrow points toward you in the default view.">
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="21" fill="rgba(10,20,30,.55)" stroke="#4a6577" strokeWidth="1.5" />
        <polygon points="24,42 28,24 24,28 20,24" fill="#ff5267" />
        <polygon points="24,6 28,24 24,20 20,24" fill="#c7d6db" />
        <text x="24" y="39" textAnchor="middle" fontSize="7" fill="#eaf3f7" fontWeight="700">N</text>
      </svg>
    </div>
  );
}
