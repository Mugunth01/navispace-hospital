import React from 'react';
import { X, MapPin, Navigation, Eye } from 'lucide-react';
import { RoomIcon, DoctorAvatar } from './common.jsx';

// A department / room: where it is, the doctors who sit there, and the
// navigation actions (Directions, Front view, Start here).
export default function RoomPage({ place, floor, doctors = [], onDirections, onStartHere, onFrontView, onClose, isMobile }) {
  const cat = place.store?.category;
  return (
    <div className={'pubSheet storePage hRoom' + (isMobile ? ' mobile' : '')} role="dialog" aria-label={place.name}>
      <button type="button" className="sheetClose" aria-label="Close" onClick={onClose}><X size={18} /></button>
      <div className="spHead">
        <span className="spLogo spLogoIcon" style={{ color: cat?.color }}><RoomIcon place={place} size={24} /></span>
        <div className="spTitle">
          <h2>{place.name}</h2>
          <small>{cat?.name || 'Room'}{place.nameTa && place.nameTa !== place.name ? ` · ${place.nameTa}` : ''}</small>
        </div>
      </div>
      <div className="spMeta"><span><MapPin size={14} aria-hidden="true" /> {floor?.name || place.floor}</span></div>
      <div className="spActions">
        <button type="button" className="route" onClick={onDirections}><Navigation size={15} aria-hidden="true" /> Directions</button>
        {onFrontView && place.door && <button type="button" className="ghost frontBtn" onClick={onFrontView}><Eye size={15} aria-hidden="true" /> Front view</button>}
        <button type="button" className="ghost" onClick={onStartHere}>Start here</button>
      </div>
      {doctors.length > 0 && <>
        <h3 className="spH3">Doctors here</h3>
        <div className="hRoomDocs">
          {doctors.map((d) => (
            <div key={d.id || d.name} className="hRoomDoc">
              <DoctorAvatar name={d.name} />
              <span><b>{d.name}</b><small>{d.speciality}{d.qualification ? ` · ${d.qualification}` : ''}</small><small>{[d.days, d.hours].filter(Boolean).join(' · ')}</small></span>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}
