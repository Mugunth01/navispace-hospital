import React from 'react';
import { Store } from 'lucide-react';
import { RoomIcon } from './hospital/common.jsx';

// Lift and escalator glyphs drawn to match the green map signs (lucide has neither).
export function LiftIcon({ size = 18, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <rect x="3.5" y="3" width="17" height="18" rx="2" /><path d="M12 3v18" />
      <path d="M6.5 9.5 8.2 7l1.8 2.5M14 14.5l1.8 2.5 1.7-2.5" />
    </svg>
  );
}
export function EscalatorIcon({ size = 18, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M3 19h4.5L16 8h5" /><circle cx="11" cy="6" r="1.6" /><path d="M11 9.5 9.5 13" />
    </svg>
  );
}

export function CategoryIcon({ size = 18 }) {
  return <Store size={size} strokeWidth={1.8} aria-hidden="true" />;
}
export function PlaceIcon({ place, size = 18 }) {
  return <RoomIcon place={place} size={size} />;
}
