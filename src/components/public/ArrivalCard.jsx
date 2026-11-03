import React from 'react';
import { Check, Tag, Heart } from 'lucide-react';

// Shown once the last step is done. Never opens on its own mid-route.
export default function ArrivalCard({ place, offers = [], doctors = [], onOffer, onDone, isMobile }) {
  return (
    <div className={'arrival' + (isMobile ? ' mobile' : '')} role="status" aria-live="polite">
      <h2><span className="arrTick" aria-hidden="true"><Check size={20} strokeWidth={3} /></span>You have arrived</h2>
      <p className="arrPlace">{place.name}<small>{place.floor}{place.subtitle ? ` · ${place.subtitle}` : ''}</small></p>
      {doctors.length > 0 && <p className="arrDocs">{doctors.map((d) => d.name).join(' · ')}</p>}
      {offers.length > 0 && (
        <div className="arrOffers">
          {offers.slice(0, 2).map((o) => (
            <button key={o.id} type="button" className="offerRow" onClick={() => onOffer(o.id)}>
              <span className="offerTag"><Tag size={12} aria-hidden="true" />{o.discount_percent ? `${o.discount_percent}%` : 'Offer'}</span>
              <span className="offerMain"><b>{o.title}</b></span>
            </button>
          ))}
        </div>
      )}
      <p className="arrKind"><Heart size={14} aria-hidden="true" /> Wishing you a speedy recovery. Please check in at the desk.</p>
      <button type="button" className="route" onClick={onDone}>Done</button>
    </div>
  );
}
