import React, { useMemo, useState } from 'react';
import { FLOORS } from '../../data/floors.js';
import { ArrowLeft, Toilet, Footprints, Car } from 'lucide-react';
import { searchDoctors, DoctorAvatar } from '../hospital/common.jsx';
import { PlaceIcon, LiftIcon, EscalatorIcon } from '../icons.jsx';
import { floorOptions, categoryOptions, filterPlaces, topStores } from '../../utils/placeFilter.js';

// Facilities aren't routable places; picking one highlights it on the map.
const FACILITY_SHORTCUTS = [
  { id: 'lift', label: 'Lifts', icon: <LiftIcon />, keywords: ['lift', 'elevator'] },
  { id: 'restroom', label: 'Restrooms', icon: 'WC', keywords: ['restroom', 'toilet', 'washroom', 'wc'] },
];

// One search sheet for both ends of the route. mode='start' opens on the
// common starting points; mode='destination' on popular places.
export default function MobileSearch({ model, places, onSelect, onClose, onHighlightFacility, mode = 'destination', savedCar = null, onReturnToVehicle, onNearest }) {
  const [q, setQ] = useState('');
  const [floorF, setFloorF] = useState('');
  const [catF, setCatF] = useState('');
  const filtering = !!(floorF || catF);
  const cats = useMemo(() => categoryOptions(places), [places]);
  const query = q.trim().toLowerCase();
  const isStart = mode === 'start';

  const results = useMemo(() => {
    if (!query && filtering) return filterPlaces(places, { floor: floorF, category: catF }).slice(0, 200);
    if (!query) return [];
    if (filtering) return filterPlaces(places, { floor: floorF, category: catF, query }).slice(0, 200);
    // "2f" / "b1" lists that floor; otherwise match name or category.
    if (FLOORS.some((f) => f[0].toLowerCase() === query)) return places.filter((p) => p.floor.toLowerCase() === query).slice(0, 60);
    return places.filter((p) => p.name.toLowerCase().includes(query) || String(p.unit || '').toLowerCase() === query
      || (p.store?.categories || []).some((c) => c.name.toLowerCase().includes(query))).slice(0, 40);
  }, [places, query, floorF, catF, filtering]);

  const docs = useMemo(() => (!isStart && query && model ? searchDoctors(model, query).slice(0, 8) : []), [model, query, isStart]);
  const allList = useMemo(() => filterPlaces(places, {}).filter((p) => !(p.kind === 'UNIT' && p.vacant)).slice(0, 150), [places]);

  const suggestions = useMemo(() => {
    const entries = places.filter((p) => p.kind === 'QR' || (p.kind === 'ANCHOR' && p.category === 'services'));
    if (isStart) return [...entries, ...places.filter((p) => p.kind === 'ANCHOR' && p.category === 'parking')];
    return [...topStores(places, 10), ...entries];
  }, [places, isStart]);

  const facilityMatches = useMemo(() => {
    if (!query || isStart) return [];
    return FACILITY_SHORTCUTS.filter((f) => f.id !== 'restroom' && f.keywords.some((k) => k.includes(query) || query.includes(k)));
  }, [query, isStart]);

  // Quick rows sit at the very top of the destination search: this visitor's own
  // saved car first, then the nearest restroom / fire exit (for everyone).
  const wantsCar = /^(car|veh|park|my )/.test(query) || 'vehicle'.startsWith(query);
  const wantsWc = /^(rest|toil|wash|wc|loo)/.test(query);
  const wantsFire = /^(fire|exit|emerg|escape|stair)/.test(query);
  const quick = (key, Icon, title, sub, onClick, cls = '') => (
    <button type="button" key={key} className={'mSearchRow mQuickRow ' + cls} onClick={onClick}>
      <span className="mSearchRowIcon"><Icon size={18} strokeWidth={1.9} aria-hidden="true" /></span>
      <span className="mSearchRowMain"><b>{title}</b><small>{sub}</small></span>
    </button>
  );
  const quickRows = [];
  if (isStart && savedCar && (!query || wantsCar)) {
    // Parked and saved the bay: it can be the starting point too ("From: my vehicle").
    quickRows.push(quick('car-from', Car, 'My vehicle', `${savedCar.floor_code} · ${savedCar.slot_code}`, () => onSelect(`slot-${savedCar.slot_id}`), 'mQuickCar'));
  }
  if (!isStart && onNearest) {
    if (!query || wantsWc) quickRows.push(quick('wc', Toilet, 'Nearest restroom', 'Closest one to where you are', () => onNearest('restroom')));
    if (!query || wantsFire) quickRows.push(quick('fire', Footprints, 'Nearest stairs', 'Closest staircase to where you are', () => onNearest('fire')));
  }

  const row = (p) => {
    const sub = p.kind === 'UNIT' ? p.subtitle || '' : p.kind === 'ANCHOR' || p.kind === 'QR' ? (p.id.startsWith('kiosk') ? 'Kiosk / QR point' : 'Entrance') : '';
    return (
      <button type="button" key={p.id} className="mSearchRow" onClick={() => onSelect(p.id)}>
        <span className="mSearchRowIcon"><PlaceIcon place={p} /></span>
        <span className="mSearchRowMain"><b>{p.name}</b><small>{p.floor}{sub ? ` · ${sub}` : ''}</small></span>
      </button>
    );
  };

  return (
    <div className="mSearchOverlay" role="dialog" aria-modal="true" aria-label={isStart ? 'Starting point' : 'Destination'}>
      <div className="mSearchBar">
        <button type="button" className="mIconBtn" aria-label="Close search" onClick={onClose}><ArrowLeft size={20} /></button>
        <div className="mSearchTitle">{isStart ? 'Starting point' : 'Destination'}</div>
      </div>
      <div className="mSearchInputWrap">
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={isStart ? 'Search starting point…' : 'Department, doctor or room…'}
          aria-label={isStart ? 'Search starting point' : 'Search destination'}
        />
      </div>
      <div className="mPickFilters" aria-label="Filters">
        <div className="mChipRow" role="group" aria-label="Floor">
          <button type="button" className={'mChip' + (floorF ? '' : ' on')} aria-pressed={!floorF} onClick={() => setFloorF('')}>All floors</button>
          {floorOptions().map((f) => <button key={f.code} type="button" className={'mChip' + (floorF === f.code ? ' on' : '')} aria-pressed={floorF === f.code} onClick={() => setFloorF(floorF === f.code ? '' : f.code)}>{f.code}</button>)}
        </div>
        {!isStart && (
          <div className="mChipRow" role="group" aria-label="Category">
            <button type="button" className={'mChip' + (catF ? '' : ' on')} aria-pressed={!catF} onClick={() => setCatF('')}>All categories</button>
            {cats.map((c) => <button key={c} type="button" className={'mChip' + (catF === c ? ' on' : '')} aria-pressed={catF === c} onClick={() => setCatF(catF === c ? '' : c)}>{c}</button>)}
          </div>
        )}
      </div>
      <div className="mSearchResults">
        {quickRows.length > 0 && <div className="mQuickBlock"><div className="mSearchSection">{query ? 'Nearby' : 'Quick access'}</div>{quickRows}</div>}
        {!query && !filtering && (
          <>
            <div className="mSearchSection">{isStart ? 'Entrances & kiosks' : 'Popular'}</div>
            {suggestions.map(row)}
            <div className="mSearchSection">All {isStart ? 'places' : 'departments & rooms'} · A–Z</div>
            {(isStart ? places : allList).filter((p) => !suggestions.includes(p)).slice().sort((a, b) => a.name.localeCompare(b.name)).map(row)}
          </>
        )}
        {query && !results.length && !docs.length && !facilityMatches.length && !quickRows.length && <div className="mSearchHint">No matches for &ldquo;{q}&rdquo;.</div>}
        {facilityMatches.map((f) => (
          <button type="button" key={f.id} className="mSearchRow mSearchRowFacility" onClick={() => { onHighlightFacility(f.id); onClose(); }}>
            <span className="mSearchRowIcon">{f.icon}</span>
            <span className="mSearchRowMain"><b>{f.label}</b><small>Highlight on this floor</small></span>
          </button>
        ))}
        {docs.length > 0 && <div className="mSearchSection">Doctors</div>}
        {docs.map((d) => (
          <button type="button" key={'doc-' + (d.id || d.name)} className="mSearchRow" onClick={() => onSelect(d.place.id)}>
            <span className="mSearchRowIcon"><DoctorAvatar name={d.name} /></span>
            <span className="mSearchRowMain"><b>{d.name}</b><small>{d.speciality} · {d.place.name} · {d.place.floor}</small></span>
          </button>
        ))}
        {docs.length > 0 && results.length > 0 && <div className="mSearchSection">Departments & rooms</div>}
        {results.map(row)}
      </div>
    </div>
  );
}
