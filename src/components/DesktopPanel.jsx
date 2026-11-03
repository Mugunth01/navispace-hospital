import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Navigation, Search, Route, Stethoscope } from 'lucide-react';
import { etaMinutes } from '../utils/format.js';
import { LiftIcon, EscalatorIcon } from './icons.jsx';
import HospitalSearch from './hospital/HospitalSearch.jsx';
import DoctorsPanel from './hospital/DoctorsPanel.jsx';
import HomeTiles from './hospital/HomeTiles.jsx';

const PREFS = [{ id: 'lift', Icon: LiftIcon, label: 'Lift' }];
const WalkDot = () => <span className="stepDot" aria-hidden="true" />;
const STEP_ICON = { walk: WalkDot, lift: LiftIcon, escalator: EscalatorIcon };
const stepText = (s) => (s.type === 'walk' ? `Walk to ${s.toName} (${s.floor})`
  : s.type === 'lift' ? `Lift ${s.coreId}: ${s.from} → ${s.to}` : `Escalator: ${s.from} → ${s.to}`);
const TABS = [['map', 'Directions', Route], ['search', 'Search', Search], ['doctors', 'Doctors', Stethoscope]];
import { floorOptions, categoryOptions, filterPlaces, topStores } from '../utils/placeFilter.js';
const label = (p) => `${p.name} · ${p.floor}`;

// Desktop left panel: directions and search (promotions slide on the home view).
export default function DesktopPanel(props) {
  const { model, tab, setTab } = props;
  return (
    <aside>
      <div className="logo hLogo">{model.settings?.hospital_name || 'Hospital'}</div>
      <div className="sub">NaviSpace indoor navigation</div>
      <nav className="deskTabs" aria-label="Sections">
        {TABS.map(([id, text, Icon]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden="true" />{text}
          </button>
        ))}
      </nav>
      {tab === 'map' && <Directions {...props} />}
      {tab === 'search' && <section><HospitalSearch key={props.searchQuery} initialQuery={props.searchQuery} model={model} onRoom={(u) => props.openStore(u)} onDirections={props.directionsTo} onNearest={props.onNearest} /></section>}
      {tab === 'doctors' && <section><DoctorsPanel model={model} onRoom={(u) => props.openStore(u)} onDirections={props.directionsTo} /></section>}
    </aside>
  );
}

function Directions({
  places, start, setStart, dest, setDest, onSwap, transportPref, setTransportPref, plan, stepIdx, goToStep,
  dist, totalDist = 0, steps = [], floor, clearRoute, onStartNavigation, navigating, model, openPromotion, onPromoView,
  getPlace, savedCar, onReturnToVehicle, onNearest,
}) {
  const [search, setSearch] = useState('');
  const [floorF, setFloorF] = useState('');
  const [catF, setCatF] = useState('');
  const cats = useMemo(() => categoryOptions(places), [places]);
  const opts = useMemo(() => filterPlaces(places, { floor: floorF, category: catF, query: search }), [places, search, floorF, catF]);
  const fromOpts = useMemo(() => filterPlaces(places, { floor: floorF }), [places, floorF]);
  const topIds = useMemo(() => new Set(topStores(places, 10).map((p) => p.id)), [places]);
  // "Top stores" first, then everything else A-Z (stable order inside each group).
  const grouped = (list) => [list.filter((p) => topIds.has(p.id)), list.filter((p) => !topIds.has(p.id))];
  const cross = plan?.ok && plan.steps.some((s) => s.type !== 'walk');
  return (
    <>
      <section className="deskPick">
        <label>Show places on</label>
        <div className="pickFilters" role="group" aria-label="Filter places">
          <select aria-label="Filter by floor" value={floorF} onChange={(e) => setFloorF(e.target.value)}>
            <option value="">All floors</option>
            {floorOptions().map((f) => <option key={f.code} value={f.code}>{f.name.replace(' Floor', '')}</option>)}
          </select>
          <select aria-label="Filter by category" value={catF} onChange={(e) => setCatF(e.target.value)}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label htmlFor="fromSel">From (Start)</label>
        <select id="fromSel" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From">
          {savedCar && <option value={`slot-${savedCar.slot_id}`}>My vehicle · {savedCar.floor_code} · {savedCar.slot_code}</option>}
          {!places.some((p) => p.id === start) && start !== (savedCar && `slot-${savedCar.slot_id}`) && <option value={start}>{start}</option>}
          {!fromOpts.some((p) => p.id === start) && places.some((p) => p.id === start) && <option value={start}>{label(places.find((p) => p.id === start))}</option>}
          {(([top, rest]) => <>{top.length > 0 && <optgroup label="Popular">{top.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup>}<optgroup label="All places">{rest.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup></>)(grouped(fromOpts))}
        </select>
        <button type="button" className="ghost small swapBtn" onClick={onSwap} disabled={!dest} aria-label="Swap start and destination"><ArrowUpDown size={14} aria-hidden="true" /> Swap</button>

        <label htmlFor="toSearch">To (Destination)</label>
        <input id="toSearch" value={search} onChange={(e) => {
          setSearch(e.target.value);
          const q = e.target.value.trim().toLowerCase();
          const doc = q.length > 2 && model.doctors.find((x) => x.name.toLowerCase().replace(/^dr\.?\s*/, '').includes(q.replace(/^dr\.?\s*/, '')));
          const first = q && (places.find((p) => p.name.toLowerCase().includes(q)) || doc?.place);
          if (first) setDest(first.id);
        }} placeholder="Type a department or doctor…" />
        <select value={dest ?? ''} onChange={(e) => setDest(e.target.value || null)} disabled={!opts.length} aria-label="To">
          <option value="">Search destination…</option>
          {savedCar && <option value={`slot-${savedCar.slot_id}`}>Back to my vehicle · {savedCar.floor_code} · {savedCar.slot_code}</option>}
          {dest && !opts.some((p) => p.id === dest) && dest !== (savedCar && `slot-${savedCar.slot_id}`) && getPlace?.(dest) && <option value={dest}>{label(getPlace(dest))}</option>}
          {(([top, rest]) => <>{top.length > 0 && <optgroup label="Popular">{top.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup>}<optgroup label="All departments">{rest.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup></>)(grouped(opts))}
        </select>
        {!opts.length && <div className="warnNote noMatch">No place matches{search ? ` “${search}”` : ' these filters'}.</div>}
        <HomeTiles model={model} className="deskTiles" onDirections={(id) => setDest(id)} onNearest={onNearest} onSearch={(q) => setSearch(q)} />
      </section>

      <section>
        <label>Route</label>
        {!plan && <div className="note">Pick a destination — the route appears on the map.</div>}
        {plan && !plan.ok && <div className="warnNote">{plan.error}</div>}
        {plan?.ok && (
          <>
            <div className="stats">
              <div><small>Walking distance</small><b>{totalDist || '—'} m</b></div>
              <div><small>Estimated time</small><b>{totalDist ? `${etaMinutes(totalDist)} min` : '—'}</b></div>
            </div>
            {plan.note && <div className="adviseNote">{plan.note}</div>}
            {!plan.same && !navigating && <button type="button" className="route startNav" onClick={onStartNavigation}><Navigation size={15} aria-hidden="true" /> Start</button>}
            {cross && (
              <ol className="journeySteps">
                {plan.steps.map((s, i) => (
                  <li key={i} className={i === stepIdx ? 'on' : i < stepIdx ? 'done' : ''}>
                    <button type="button" onClick={() => goToStep(i)}>{React.createElement(STEP_ICON[s.type], { size: 15 })}<span>{stepText(s)}</span></button>
                  </li>
                ))}
              </ol>
            )}
            {steps.length > 0 && (
              <>
                <small className="stepsHead">On {floor} · {dist} m</small>
                <ol className="steps">{steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </>
            )}
          </>
        )}
        {dest && <button className="ghost small" onClick={clearRoute}>Clear route</button>}
      </section>
    </>
  );
}
