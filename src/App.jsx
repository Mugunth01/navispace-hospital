import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Scene from './three/Scene.jsx';
import DesktopPanel from './components/DesktopPanel.jsx';
import TopBar from './components/TopBar.jsx';
import TransitPanel from './components/TransitPanel.jsx';
import TransportStep from './components/TransportStep.jsx';
import MobileShell from './components/mobile/MobileShell.jsx';
import MobileNavigationCard from './components/mobile/MobileNavigationCard.jsx';
import RoamBar from './components/RoamBar.jsx';
import FloorBar, { NavHeaderControls } from './components/FloorBar.jsx';
import RoomPage from './components/hospital/RoomPage.jsx';
import ArrivalCard from './components/public/ArrivalCard.jsx';
const HuntHud = () => null;
const PromoSlider = () => null;
import { useIsMobile } from './hooks/useIsMobile.js';
import { METRES_PER_UNIT, DEFAULT_START, OUTLINE, floorIndex, isParking } from './data/floors.js';
import { buildModel, qrPlace } from './data/model.js';
import { api, DATA_MODE } from './data/api/index.js';
import { turnByTurn } from './utils/routing.js';
import { planJourney, stepFloor, walkOnFloor } from './utils/journey.js';
import { WALK_SPEED_MPS, RIDE_MS, EXIT_MS } from './utils/guide.js';
import { roamGraph, nearestRoamNode, stepRoam, buildTour, nearestTourIndex, startRoam, frontViewPose } from './utils/roam.js';
import { loadTheme, saveTheme, loadColourMode, saveColourMode } from './utils/storage.js';
import './components/public/public.css';

// Bounding box of a set of [x,y] points → camera framing target.
// Never tighter than minHalf, so a 5 m leg still shows its surroundings.
function boundsOf(points, pad = 1.5, minHalf = 6.5) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, halfX: Math.max(minHalf, (x1 - x0) / 2 + pad), halfY: Math.max(minHalf, (y1 - y0) / 2 + pad) };
}
const M = METRES_PER_UNIT;
const params = () => { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } };

// Loads the mall data (Supabase, or the demo snapshot), then hands a model
// to the app. The demo adapter answers synchronously so tests render at once.
export default function App() {
  const [bundle, setBundle] = useState(() => api.peekPublic());
  const [err, setErr] = useState(null);
  const load = useCallback(() => { setErr(null); api.loadPublic().then(setBundle).catch((e) => setErr(e.message || 'Could not load the hospital map.')); }, []);
  useEffect(() => { if (!bundle) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const model = useMemo(() => (bundle ? buildModel(bundle) : null), [bundle]);
  if (!model) {
    return (
      <div className="splash" role={err ? 'alert' : 'status'}>
        <div className="splashLogo">Navi<span>Space</span></div>
        {err ? <><p>Couldn't load the hospital map: {err}</p><button type="button" className="route" onClick={load}>Try again</button></> : <p>Loading NaviSpace…</p>}
      </div>
    );
  }
  return <MallApp model={model} />;
}


function pointAlongPath(path, progress) {
  if (!path?.length) return { point: null, heading: 0, distance: 0 };
  if (path.length === 1) return { point: path[0], heading: 0, distance: 0 };
  const segs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const len = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    segs.push({ a: path[i - 1], b: path[i], len }); total += len;
  }
  if (!total) return { point: path[0], heading: 0, distance: 0 };
  let wanted = Math.max(0, Math.min(1, progress)) * total;
  for (const seg of segs) {
    if (wanted <= seg.len || seg === segs.at(-1)) {
      const t = seg.len ? Math.max(0, Math.min(1, wanted / seg.len)) : 0;
      return {
        point: [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t],
        heading: Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]),
        distance: Math.max(0, total - (total - wanted)),
      };
    }
    wanted -= seg.len;
  }
  const last = segs.at(-1);
  return { point: last.b, heading: Math.atan2(last.b[1] - last.a[1], last.b[0] - last.a[0]), distance: total };
}

function MallApp({ model }) {
  const FLOOR_BOUNDS = useMemo(() => boundsOf(OUTLINE, 0.5), []);
  const isMobile = useIsMobile();
  const sceneRef = useRef(null);

  // QR start (?at=CODE) and deep links (?to=G-G12).
  const qrCode = useMemo(() => params().get('at'), []);
  const qr = useMemo(() => qrPlace(model, qrCode), [model, qrCode]);
  const [qrError, setQrError] = useState(() => !!qrCode && !qr);
  useEffect(() => { if (qr) api.track('qr_scan', { code: qrCode }); }, [qr, qrCode]);
  const places = model.places;
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const getPlace = (id) => (id ? placeById.get(id) || null : null);
  const listed = useMemo(() => places.filter((p) => !p.hidden), [places]);

  const [start, setStartRaw] = useState(() => { const f = params().get('from'); return f && placeById.get(f) ? f : qr ? qr.id : DEFAULT_START; });
  const [startKnown, setStartKnown] = useState(() => !!qr || !!(params().get('from') && placeById.get(params().get('from'))));       // a real location, not the default
  const [dest, setDest] = useState(() => {
    const t = params().get('to') || (typeof window !== 'undefined' ? decodeURIComponent(window.location.hash.slice(1)) : '');
    if (!t) return null;
    return placeById.get(t) ? t : model.unitByCode.get(t)?.id || null;
  });
  const [transportPref, setTransportPref] = useState('lift');
  function setStart(id) { setStartRaw(id); setStartKnown(true); }

  const [floor, setFloor] = useState(() => getPlace(params().get('from') || (qr ? qr.id : DEFAULT_START))?.floor || getPlace(DEFAULT_START)?.floor || 'G');
  const [stepIdx, setStepIdx] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [walkProgress, setWalkProgress] = useState(0);
  const [walkPlaying, setWalkPlaying] = useState(false);
  // 'walk' | 'cabin' (inside the lift, waiting for a floor) | 'ride' (doors shut, floor counter)
  //   | 'exit' (doors open, the guide steps out) | 'ready' (out of the lift, waiting for "Start walking")
  const [guidePhase, setGuidePhase] = useState('walk');
  const [pov, setPov] = useState('follow');           // 'follow' (behind the guide) | 'first' (first person)
  const [liftExit, setLiftExit] = useState(null);     // where the lift doorway stands on the new floor
  const [rideTo, setRideTo] = useState(null);
  const [walkSpeed, setWalkSpeed] = useState(1);        // 1x | 2x | 4x
  const [fadeKey, setFadeKey] = useState(0);
  const walkAnimRef = useRef(null);
  const [overview, setOverview] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [panelCore, setPanelCore] = useState(null);
  const [sheet, setSheet] = useState(null);        // {type:'store', id} | {type:'offer', id} | {type:'promotion', id}
  const [tab, setTab] = useState('map');            // mobile tabs / desktop panel
  // Other parts of the app (e.g. a game's "Use my points") can ask for a tab.
  useEffect(() => { const go = (e) => setTab(e.detail); window.addEventListener('navispace:open-tab', go); return () => window.removeEventListener('navispace:open-tab', go); }, []);
  // …or a store page (a notification about a favourite store, the favourites list).
  const openStoreRef = useRef(null);
  openStoreRef.current = (id) => openStore(id);
  useEffect(() => { const go = (e) => openStoreRef.current?.(e.detail); window.addEventListener('navispace:open-store', go); return () => window.removeEventListener('navispace:open-store', go); }, []);
  // Panda Hunt on the map: { gameId }; the HUD reports the board (suspects / checked / found) to draw.
  const [hunt, setHunt] = useState(null), [huntBoard, setHuntBoard] = useState(null), [huntPick, setHuntPick] = useState(null);
  const huntStartRef = useRef(null), huntMovedRef = useRef(false);
  huntStartRef.current = (gameId) => {
    if (navigating) endJourney();
    exitRoam(); setSheet(null); setPanelCore(null); setHighlightType(null); setTab('map');
    huntMovedRef.current = false; setHuntBoard(null); setHuntPick(null); setHunt({ gameId });
  };
  useEffect(() => { const go = (e) => huntStartRef.current?.(e.detail); window.addEventListener('navispace:hunt', go); return () => window.removeEventListener('navispace:hunt', go); }, []);
  const onHuntBoard = useCallback((b) => {
    setHuntBoard(b);
    if (b?.floor && !huntMovedRef.current) { huntMovedRef.current = true; setFloor(b.floor); }   // go to the game's floor once
  }, []);
  const [viewMode, setViewMode] = useState('3d');
  const [theme, setTheme] = useState(() => loadTheme());
  const [colourMode, setColourModeRaw] = useState(() => loadColourMode());
  function setColourMode(m) { setColourModeRaw(m); saveColourMode(m); }
  const [highlightType, setHighlightType] = useState(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; saveTheme(theme); }, [theme]);

  // ---- parking ----------------------------------------------------------
  const [saved, setSaved] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [parkBusy, setParkBusy] = useState(false);
  const [parkErr, setParkErr] = useState(null);
  useEffect(() => { api.parking.get().then(setSaved).catch(() => {}); }, []);
  async function saveCar(slot) {
    setParkBusy(true); setParkErr(null);
    try { setSaved(await api.parking.save(slot.slotId)); window.setTimeout(() => setSelectedSlot((cur) => (cur && cur.slotId === slot.slotId ? null : cur)), 2000); } catch (e) { setParkErr(e.message); } finally { setParkBusy(false); }
  }
  async function clearCar() { setParkBusy(true); try { await api.parking.clear(); setSaved(null); } catch (e) { setParkErr(e.message); } finally { setParkBusy(false); } }
  function returnToVehicle() {
    if (!saved) return;
    const id = `slot-${saved.slot_id}`;
    if (!placeById.get(id)) { setParkErr('That bay is no longer on the map. Look for it on the parking deck.'); return; }
    directionsTo(id);
  }
  function pickSlot(slot) { setSelectedSlot(slot); if (!isMobile) setTab('parking'); }

  // ---- route --------------------------------------------------------------
  const s = getPlace(start), d = getPlace(dest);
  const storesFor = useCallback((f) => model.unitsByFloor[f] || [], [model]);
  const plan = useMemo(() => planJourney({ start: s, dest: d, mode: transportPref, storesFor }), [s, d, transportPref, storesFor]);

  // A new plan starts at its first step, on the floor that step is on.
  const keepFloorRef = useRef(null);                 // floor to stay on after a journey ends
  useEffect(() => {
    setStepIdx(0); setPanelCore(null); setArrived(false); setWalkProgress(0); setWalkPlaying(false);
    clearTransportTimer(); setLiftExit(null); setRideTo(null);
    // Re-planning from inside a lift (another floor chosen): you are still in the cabin.
    setGuidePhase(navigatingRef.current && plan?.ok && plan.steps[0]?.type === 'lift' ? 'cabin' : 'walk');
    if (keepFloorRef.current) { setFloor(keepFloorRef.current); keepFloorRef.current = null; }
    else if (plan?.ok && plan.steps.length) setFloor(stepFloor(plan.steps[0]));
    else if (s) setFloor(s.floor);
  }, [plan, start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!plan?.ok || plan.same) setNavigating(false); }, [plan]);

  const step = plan?.ok ? plan.steps[stepIdx] || null : null;
  const walkHere = plan?.ok ? walkOnFloor(plan, floor) : null;
  const route = walkHere?.path || null;

  const transportTimerRef = useRef(null);
  const navigatingRef = useRef(false); navigatingRef.current = navigating;
  function clearTransportTimer() { if (transportTimerRef.current) { window.clearTimeout(transportTimerRef.current); transportTimerRef.current = null; } }
  useEffect(() => () => { if (transportTimerRef.current) window.clearTimeout(transportTimerRef.current); }, []);

  // Go to a journey step. While navigating, boarding a lift cuts to the inside
  // of the cabin; arriving by lift ('exit') opens the doors and the guide steps
  // out, then waits there until the person taps "Start walking".
  function goToStep(i, phase) {
    if (!plan?.ok || i < 0 || i >= plan.steps.length) return;
    const next = plan.steps[i];
    const ph = phase || (navigatingRef.current && next.type === 'lift' ? 'cabin' : 'walk');
    clearTransportTimer();
    setStepIdx(i);
    setFloor(stepFloor(next));
    setOverview(false);
    setWalkProgress(0);
    setRideTo(null);
    const car = plan.steps[i - 1];
    if (ph === 'exit' && next.type === 'walk' && next.path?.length && car?.type === 'lift') {
      const p0 = pointAlongPath(next.path, 0);
      // The guide steps out of the real lift car, which opens its doors on the walkway side.
      setLiftExit({ point: p0.point, heading: p0.heading, floor: stepFloor(next), core: [car.x, car.y] });
      setViewMode('2d');   // step out into a top view: the guide standing at the doors, then "I'm on this floor"
      setWalkPlaying(false);
      setGuidePhase('exit');
      transportTimerRef.current = window.setTimeout(() => { transportTimerRef.current = null; setGuidePhase('ready'); }, EXIT_MS);
    } else {
      setLiftExit(null);
      setWalkPlaying(next?.type === 'walk' && (ph === 'walk' || ph === 'exit'));
      setGuidePhase(ph === 'exit' ? 'walk' : ph);
    }
    if (ph === 'cabin') { setViewMode('3d'); setFadeKey((k) => k + 1); }
  }
  // Doors shut, floor counter runs for a few seconds, then `done`.
  function rideThen(toFloor, done) {
    clearTransportTimer();
    setWalkPlaying(false); setRideTo(toFloor); setGuidePhase('ride');
    transportTimerRef.current = window.setTimeout(() => { transportTimerRef.current = null; setFadeKey((k) => k + 1); done(); }, RIDE_MS);
  }
  // The guide has walked up to the lift doors and waits there. Pressing a floor button steps inside,
  // the doors close and the ride takes about five seconds.
  function pickLiftFloor(f) {
    if (!plan?.ok) return;
    const i = stepIdx + 1, nxt = plan.steps[i];
    if (!nxt || nxt.type !== 'lift') return;
    goToStep(i, 'cabin');
    if (f === nxt.to) rideThen(nxt.to, () => { if (i + 1 < plan.steps.length) goToStep(i + 1, 'exit'); else setFloor(nxt.to); });
    else rideThen(f, () => setStart(`lift-${nxt.coreId}-${f}`));
  }
  function startWalkingFromLift() { clearTransportTimer(); setViewMode('3d'); setGuidePhase('walk'); setWalkPlaying(true); }

  function advance() {
    if (!plan?.ok) return;
    const more = stepIdx + 1 < plan.steps.length;
    if (step?.type === 'lift' && navigating) {
      if (guidePhase === 'ride') return;
      rideThen(step.to, () => { if (more) goToStep(stepIdx + 1, 'exit'); else setFloor(step.to); });
      return;
    }
    if (more) goToStep(stepIdx + 1, 'walk');
    else if (step?.type !== 'walk') setFloor(step.to);
  }
  function chooseLiftFloor(f) {
    if (!step || step.type !== 'lift') return;
    if (f === step.to) { advance(); return; }
    if (!navigating) { setStart(`lift-${step.coreId}-${f}`); return; }
    if (guidePhase === 'ride') return;
    rideThen(f, () => setStart(`lift-${step.coreId}-${f}`));
  }
  function startNavigation() {
    if (!plan?.ok || plan.same) return;
    exitRoam();
    goToStep(0, plan.steps[0]?.type === 'lift' ? 'cabin' : 'walk');
    setNavigating(true); setArrived(false); setSheet(null); setTab('map');
    api.track('navigate_start', { storeId: d?.storeId || undefined });
  }
  function arrive() {
    setArrived(true); setFloor(d.floor);
    api.track('navigate_arrive', { storeId: d?.storeId || undefined });
  }
  function exitNavigation() { clearTransportTimer(); setNavigating(false); setArrived(false); setOverview(false); setWalkPlaying(false); setWalkProgress(0); setGuidePhase('walk'); setLiftExit(null); setRideTo(null); }
  // Journey over (arrived + Done, or End): back to a plain map of the floor you are on, no route, no pins.
  function endJourney() {
    keepFloorRef.current = arrived && d ? d.floor : floor;
    setSheet(null); setHighlightType(null); setDest(null); exitNavigation(); setPanelCore(null);
  }
  function clearRoute() { setDest(null); exitNavigation(); setPanelCore(null); }
  function swapEnds() { if (s && d && !d.hidden) { setStart(d.id); setDest(s.id); } }
  function freeNavigateFloor(f) { setFloor(f); setTouring(false); }
  // Eye = first person. Turning it on drops the top view; turning it off goes back to the guide (follow) view.
  function changePov(next) { setPov(next); if (next === 'first') setViewMode('3d'); }

  // ---- street view: look around the floor without a destination ------------
  // ‹ › step along the corridors, "Tour this floor" takes a round of the whole floor
  // (pause / resume any time), and "Front view" on a store page stands you in front of it.
  const [roam, setRoam] = useState(null);      // { point, heading, tick, settle, eyeZ?, pitch?, fov?, label, placeId? }
  const [touring, setTouring] = useState(false);
  const [toured, setToured] = useState(false);   // a tour is under way (paused) → the button says "Resume"
  const [tourSpeed, setTourSpeed] = useState(1);
  const tourRef = useRef({ floor: null, seq: null, i: 0 });
  const floorRef = useRef(floor); floorRef.current = floor;
  function exitRoam() { setRoam(null); setTouring(false); setToured(false); tourRef.current = { floor: null, seq: null, i: 0 }; }
  function setViewModeSafe(m) { if (m === '2d') exitRoam(); setViewMode(m); }
  function toggleRoam() {
    if (roam) { exitRoam(); return; }
    if (navigatingRef.current) return;
    const near = s && s.floor === floor ? s.door || [s.x, s.y] : null;
    const r = startRoam(floor, near, [FLOOR_BOUNDS.x, FLOOR_BOUNDS.y]);
    if (!r) return;
    setViewMode('3d'); setSheet(null); setPanelCore(null); setTab('map');
    setRoam({ point: r.point, heading: r.heading, tick: 1, settle: 0, label: 'Street view' });
  }
  // In a shop's front view, ‹ › go to the previous / next shopfront along the corridors.
  function frontStep(dir) {
    const all = storesList.filter((x) => x.mapped && x.door && !x.decor);
    const open = all.filter((x) => !x.vacant);
    const list = open.length >= 2 ? open : all;               // browse real shops; empty units only when there is nothing else
    if (list.length < 2) return;
    const g = roamGraph(floor), tour = buildTour(g, g.nodes.keys().next().value);
    const ranked = list.map((x) => ({ x, r: nearestTourIndex(tour, x.door) })).sort((a, b) => a.r - b.r || (a.x.id < b.x.id ? -1 : 1)).map((o) => o.x);
    const i = ranked.findIndex((x) => x.id === roam.placeId);
    frontView(ranked[(i + (dir >= 0 ? 1 : -1) + ranked.length) % ranked.length].id);
  }
  function leaveFront() {
    const g = roamGraph(floor), key = nearestRoamNode(g, roam.point);
    setRoam((r) => ({ ...r, point: g.nodes.get(key), tick: (r.tick || 0) + 1, eyeZ: undefined, pitch: 0, fov: undefined, placeId: null, label: 'Street view' }));
  }
  function roamStep(dir) {
    if (!roam) return;
    if (roam.placeId) { frontStep(dir); return; }
    setTouring(false);                                   // moving by hand pauses the tour
    const g = roamGraph(floor);
    const m = stepRoam(g, nearestRoamNode(g, roam.point), sceneRef.current?.getFacing?.() ?? roam.heading, dir);
    if (!m) return;
    setRoam((r) => {
      const fromFront = r.eyeZ != null;                  // leaving a shop's front view: back to eye level
      return { ...r, point: m.point, heading: m.heading, settle: (r.settle || 0) + 1, label: 'Street view', placeId: null,
        ...(fromFront ? { tick: (r.tick || 0) + 1, eyeZ: undefined, pitch: 0, fov: undefined } : {}) };
    });
  }
  function toggleTour() {
    if (touring) { setTouring(false); return; }
    if (!roam) return;
    const g = roamGraph(floor), t = tourRef.current, cur = t.seq && t.floor === floor ? t.seq[t.i] : null;
    if (!cur || Math.hypot(cur.point[0] - roam.point[0], cur.point[1] - roam.point[1]) > 2.5) {
      tourRef.current = { floor, seq: buildTour(g, nearestRoamNode(g, roam.point)), i: 0 };   // paused somewhere else: start a fresh round from here
    }
    setRoam((r) => (r.eyeZ != null ? { ...r, tick: (r.tick || 0) + 1, eyeZ: undefined, pitch: 0, fov: undefined, placeId: null, label: 'Street view' } : r));
    setToured(true); setTouring(true);
  }
  useEffect(() => {
    if (!touring) return undefined;
    let timer;
    const delay = 820 / tourSpeed;
    const tick = () => {
      const t = tourRef.current;
      if (!t.seq || t.floor !== floorRef.current) { setTouring(false); return; }
      if (t.i + 1 >= t.seq.length) { setTouring(false); setToured(false); return; }        // round complete
      t.i += 1;
      const v = t.seq[t.i];
      setRoam((r) => (r ? { ...r, point: v.point, heading: v.heading } : r));
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
    return () => window.clearTimeout(timer);
  }, [touring, tourSpeed]);
  function frontView(placeId) {
    const p = placeById.get(placeId);
    if (!p) return;
    const c = typeof document !== 'undefined' ? document.querySelector('.map canvas, .mMapArea canvas') : null;
    const aspect = c?.clientHeight ? c.clientWidth / c.clientHeight : (typeof window !== 'undefined' && window.innerHeight ? window.innerWidth / window.innerHeight : 1.6);
    const pose = frontViewPose(p, aspect);
    if (!pose) return;
    setFloor(p.floor); setSheet(null); setViewMode('3d'); setTab('map'); setTouring(false); setToured(false);
    tourRef.current = { floor: null, seq: null, i: 0 };
    setRoam((r) => ({ point: pose.point, heading: pose.heading, eyeZ: pose.eyeZ, pitch: pose.pitch, fov: pose.fov, tick: (r?.tick || 0) + 1, settle: r?.settle || 0, label: p.name, placeId: p.id }));
  }

  // ---- selection / sheets --------------------------------------------------
  function openStore(placeOrStoreId) {
    const p = typeof placeOrStoreId === 'string' ? (placeById.get(placeOrStoreId) || model.placeByStore.get(placeOrStoreId)) : placeOrStoreId;
    if (!p) return;
    setFloor(p.floor); setSheet({ type: 'store', id: p.id });
    if (isMobile) setTab('map');
  }
  function openOffer(id) { setSheet({ type: 'offer', id }); }
  const resumeWalkRef = useRef(false);
  function openPromotion(p) {
    if (navigating && walkPlaying) { resumeWalkRef.current = true; setWalkPlaying(false); }   // don't walk away while reading an ad
    setSheet({ type: 'promotion', id: p.id }); if (isMobile) setTab('map');
  }
  function closeSheet() {
    setSheet(null);
    if (resumeWalkRef.current) { resumeWalkRef.current = false; if (navigatingRef.current) setWalkPlaying(true); }
  }
  function directionsTo(id) { exitRoam(); resumeWalkRef.current = false; setSheet(null); setDest(id); setNavigating(false); setTab('map'); }
  function startFrom(id) { setSheet(null); setStart(id); setTab('map'); }
  function pickOnMap(id) {
    const p = placeById.get(id);
    if (hunt && huntBoard) { setHuntPick({ storeId: p?.storeId || null, n: Date.now() }); return; }   // Panda Hunt: a tap checks the store
    if (p) setSheet({ type: 'store', id });
  }
  function showFacility(f) {
    if (f.floor) setFloor(f.floor);
    setTab('map');
    const kind = /lift/.test(f.kind) ? 'lift' : /restroom|washroom/.test(f.kind) ? 'restroom' : null;
    if (kind) setHighlightType(kind);
  }
  function showFloor(code) { setFloor(code); setTab(isParking(code) && !isMobile ? 'parking' : 'map'); if (!isParking(code)) setSelectedSlot(null); }
  function showSlot(slot) { setFloor(slot.floor); setSelectedSlot(slot); setTab(isMobile ? 'map' : 'parking'); }

  // Nearest restroom / fire exit to where you are (your start). Same floor first;
  // otherwise the closest floor that has one (the basements have no restroom, so
  // that means a lift up to G). Open to everyone, saved car or not.
  function nearestFacility(kind) {
    if (!s) return null;
    const [sx, sy] = s.door || [s.x, s.y];
    let best = null, bs = Infinity;
    for (const p of places) {
      if (p.facility !== kind) continue;
      const sc = Math.abs(floorIndex(p.floor) - floorIndex(s.floor)) * 1000 + Math.hypot((p.door?.[0] ?? p.x) - sx, (p.door?.[1] ?? p.y) - sy);
      if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }
  function goNearest(kind) {
    const p = nearestFacility(kind);
    if (!p) return;
    setHighlightType(kind === 'restroom' ? 'restroom' : null);
    directionsTo(p.id);
  }

  // Rough walking distance from where you are (only when that is known).
  const distanceTo = useMemo(() => {
    if (!startKnown || !s) return null;
    return (p) => Math.round((Math.hypot(p.x - s.x, p.y - s.y) + Math.abs(floorIndex(p.floor) - floorIndex(s.floor)) * 15) * M);
  }, [startKnown, s]);

  // ---- real-time walking simulation --------------------------------------
  useEffect(() => {
    if (!navigating || arrived || step?.type !== 'walk' || overview || !walkPlaying || !step.path?.length) return undefined;
    const started = performance.now();
    const initial = walkProgress;
    const speedMps = WALK_SPEED_MPS * walkSpeed;
    const duration = Math.max(1200, ((step.length * M) * (1 - initial) / speedMps) * 1000);
    const tick = (now) => {
      const p = Math.min(1, initial + (now - started) / duration * (1 - initial));
      setWalkProgress(p);
      if (p < 1) walkAnimRef.current = requestAnimationFrame(tick);
      else setWalkPlaying(false);
    };
    walkAnimRef.current = requestAnimationFrame(tick);
    return () => { if (walkAnimRef.current) cancelAnimationFrame(walkAnimRef.current); };
  }, [navigating, arrived, stepIdx, step?.type, step?.path, step?.length, overview, walkPlaying, walkSpeed]);

  const walkPose = useMemo(() => pointAlongPath(step?.type === 'walk' ? step.path : route, walkProgress), [step, route, walkProgress]);
  const walkRemaining = step?.type === 'walk' ? Math.max(0, Math.round((step.length * (1 - walkProgress)) * M)) : 0;
  const stepGuidePose = useMemo(() => {
    if (step?.type !== 'lift' || !route?.length) return null;
    return pointAlongPath(route, 1);
  }, [step, route]);

  // ---- camera -------------------------------------------------------------
  const huntPts = useMemo(() => (huntBoard && floor === huntBoard.floor
    ? [...huntBoard.candidates].map((id) => model.placeByStore.get(id)).filter((p) => p && p.floor === floor).map((p) => [p.x, p.y]) : []), [huntBoard, floor, model]);
  const focus = useMemo(() => {
    if (huntPts.length && !route) return boundsOf(huntPts, 2);               // Panda Hunt: frame the suspects
    if (route) return boundsOf(d && d.floor === floor && walkHere?.toId === d.id ? [...route, [d.x, d.y]] : route);
    if (step && step.type !== 'walk' && floor === step.from) return { x: step.x, y: step.y, halfX: 6, halfY: 6 };
    const sel = sheet?.type === 'store' ? placeById.get(sheet.id) : selectedSlot;
    if (sel && sel.floor === floor) return { x: sel.x, y: sel.y, halfX: 6.5, halfY: 6.5 };
    if (s && s.floor === floor && (d || startKnown)) return { x: s.door?.[0] ?? s.x, y: s.door?.[1] ?? s.y, halfX: 7, halfY: 7 };
    // Wide hospital plan: a phone shows the wing around where you are; a desktop shows the whole floor.
    if (isMobile) {
      const sx = s && s.floor === floor ? s.door?.[0] ?? s.x : FLOOR_BOUNDS.x;
      const half = 11, lo = FLOOR_BOUNDS.x - FLOOR_BOUNDS.halfX + half, hi = FLOOR_BOUNDS.x + FLOOR_BOUNDS.halfX - half;
      return { x: Math.min(hi, Math.max(lo, sx)), y: FLOOR_BOUNDS.y, halfX: half, halfY: 8 };
    }
    return { x: FLOOR_BOUNDS.x, y: FLOOR_BOUNDS.y - 1, halfX: FLOOR_BOUNDS.halfX * 0.72, halfY: FLOOR_BOUNDS.halfY * 0.7 };
  }, [route, step, s, d, floor, walkHere, startKnown, isMobile, sheet, selectedSlot, placeById, huntPts]);

  // Pixels of map hidden under the phone's top card (FROM/TO card, or just the floor title).
  const inset = navigating || tab !== 'map' || hunt ? 64 : 118;
  const camState = useMemo(() => {
    if (roam && !navigating) {
      return { mode: 'walk', pov: 'first', roam: true, point: roam.point, heading: roam.heading, walkId: `roam-${floor}`, viewId: floor,
        tick: roam.tick, settle: roam.settle, eyeZ: roam.eyeZ, pitch: roam.pitch, fov: roam.fov, moving: touring, remaining: 99, focus };
    }
    if (navigating && arrived && d && floor === d.floor) return { mode: 'arrival', focus: { x: d.x, y: d.y, halfX: 5.5, halfY: 5.5 } };
    if (navigating && step && !overview) {
      if (step.type === 'lift' && floor === step.from && (guidePhase === 'cabin' || guidePhase === 'ride')) {
        return { mode: 'lift', focus };
      }
      if (step.type === 'walk' && floor === step.floor && step.path?.length > 1) {
        const pose = walkPose.point ? walkPose : pointAlongPath(step.path, 0);
        const base = { point: pose.point, heading: pose.heading, walkId: stepIdx, focus };
        if (guidePhase === 'exit' || guidePhase === 'ready') return { mode: 'exit', ...base, exitFrom: liftExit?.core };
        return { mode: 'walk', ...base, pov, moving: walkPlaying, remaining: step.length * (1 - walkProgress) };
      }
      if (step.type !== 'walk' && floor === step.from) {
        const door = route ? route.at(-1) : [step.x, step.y];
        return { mode: 'transit', focus: { x: (step.x + door[0]) / 2, y: (step.y + door[1]) / 2, halfX: 4.5, halfY: 4.5 } };
      }
    }
    return { mode: 'overview', focus };
  }, [navigating, arrived, d, floor, step, overview, focus, route, walkPose, guidePhase, pov, walkPlaying, liftExit, roam, touring]);
  const cam = useMemo(() => ({ ...camState, inset }), [camState, inset]);

  // Where you are: FROM, or while navigating, the start of the current step.
  const youAreHere = useMemo(() => {
    if (navigating && !arrived && viewMode === '2d') {   // top view has no guide: show a plain dot where you are
      if (guidePhase === 'exit' || guidePhase === 'ready') return null;   // the guide is standing there instead
      return step?.type === 'walk' && step.floor === floor && step.path ? walkPose.point || step.path[0] : null;
    }
    if (navigating && !arrived) return null;   // the panda shows where you are; start / lift pins stay fixed
    if (navigating && !arrived && step) {
      if (step.type === 'walk' && step.floor === floor && step.path) return walkPose.point || step.path[0];
      if (step.type !== 'walk' && step.from === floor) return route ? route.at(-1) : [step.x, step.y];
      return null;
    }
    if (arrived) return null;
    return s && s.floor === floor ? s.door || [s.x, s.y] : null;
  }, [navigating, arrived, step, floor, s, route, walkPose, guidePhase, viewMode]);

  // "You are here" only when we actually know it (QR scan or a chosen FROM);
  // otherwise name the assumed start, e.g. "Main Entrance".
  // While navigating, only the first step still starts where you were known to be.
  const youLabel = viewMode === '2d' ? '' : navigating && step
    ? (stepIdx === 0 && startKnown ? 'You are here' : step.type === 'walk' ? step.fromName : `${step.type === 'lift' ? `Lift ${step.coreId}` : 'Escalator'}`)
    : startKnown ? 'You are here' : `${s?.name || 'Start'}`;
  const [searchQuery, setSearchQuery] = useState('');
  function quickSearch(q) { setSearchQuery(q); setTab('search'); }
  function showRestrooms() { setTab('map'); if (isParking(floor)) setFloor('G'); setHighlightType('restroom'); }
  const dist = walkHere ? Math.round(walkHere.length * M) : 0;
  const totalDist = plan?.ok ? Math.round(plan.total * M) : 0;
  const shownDestId = d && floor === d.floor ? d.id : null;
  const nextAfterWalk = walkHere && plan?.ok ? plan.steps[plan.steps.indexOf(walkHere) + 1] : null;
  const destLabel = walkHere ? (nextAfterWalk && nextAfterWalk.type !== 'walk'
    ? `${nextAfterWalk.type === 'lift' ? `Lift ${nextAfterWalk.coreId}` : 'Escalator'} → ${nextAfterWalk.to}` : walkHere.toName) : null;
  // Walk to the lift is finished: the guide stands at the doors, floor buttons are shown.
  const nextStep = navigating && plan?.ok && step?.type === 'walk' ? plan.steps[stepIdx + 1] : null;
  const liftDoor = nextStep?.type === 'lift' && walkProgress >= 0.995 && !walkPlaying && !overview && guidePhase === 'walk' ? nextStep : null;
  const destAt = walkHere && nextAfterWalk && nextAfterWalk.type !== 'walk' && nextAfterWalk.x != null ? [nextAfterWalk.x, nextAfterWalk.y] : null;   // the lift / escalator itself
  const storesList = model.unitsByFloor[floor] || [];
  const landmark = useMemo(() => {
    const doors = storesList.filter((x) => x.mapped && x.door && !x.vacant);
    return ([px, py]) => {
      let best = null, bd = 1.6;
      for (const x of doors) { const dd = Math.hypot(x.door[0] - px, x.door[1] - py); if (dd < bd) { bd = dd; best = x.name; } }
      return best;
    };
  }, [storesList]);
  const steps = useMemo(() => (walkHere ? turnByTurn(walkHere.path, walkHere.toName, M, landmark) : []), [walkHere, landmark]);
  const activeCore = step && step.type !== 'walk' && floor === step.from ? step.coreId : panelCore?.id;
  const offerStoreIds = useMemo(() => new Set(model.offers.map((o) => o.store_id)), [model]);
  const routeFloors = useMemo(() => (plan?.ok ? [...new Set(plan.steps.flatMap((x) => (x.type === 'walk' ? [x.floor] : [x.from, x.to])))] : []), [plan]);
  const floorRow = model.floorByCode[floor];
  const parkingHere = isParking(floor) ? model.parkingByFloor[floor] : null;

  const sceneElement = (
    <Scene
      ref={sceneRef}
      floor={floor} storesList={storesList} parking={parkingHere} route={arrived ? null : route} destId={shownDestId} onPick={pickOnMap}
      onPickSlot={pickSlot} selectedSlotId={selectedSlot?.slotId} savedSlotId={saved?.slot_id}
      onLift={(id) => setPanelCore({ kind: 'lift', id })} onCore={(kind, id) => setPanelCore({ kind, id })} activeCore={activeCore} theme={theme} destLabel={destLabel} destAt={destAt}
      highlightType={highlightType} viewMode={viewMode} cam={cam}
      isMobile={isMobile} offerIds={offerStoreIds} selectedId={sheet?.type === 'store' ? sheet.id : null} colourMode={colourMode}
      youAreHere={youAreHere} youLabel={youLabel}
      walkProgress={walkProgress} walkPose={walkPose} guidePhase={guidePhase} stepGuidePose={stepGuidePose} navigating={navigating} arrived={arrived}
      guideMoving={walkPlaying} guideSpeed={walkSpeed} liftExit={liftExit}
      liftTrip={step?.type === 'lift' ? { from: step.from, to: rideTo || step.to } : null}
      hunt={hunt && huntBoard && floor === huntBoard.floor ? huntBoard : null}
      pin={navigating && arrived && d && floor === d.floor ? { x: d.x, y: d.y, label: d.name } : null}
      startLabel={walkHere && walkHere.length > 3 && (navigating || walkHere.fromName !== s?.name) && !(navigating && (guidePhase === 'exit' || guidePhase === 'ready')) ? walkHere.fromName : null}
    />
  );
  const transport = step && step.type !== 'walk' ? (
    <TransportStep step={step} floor={floor} onContinue={advance} onChooseFloor={chooseLiftFloor} onShow={() => goToStep(stepIdx)}
      riding={navigating && guidePhase === 'ride'} rideTo={rideTo}
      flight={step.type === 'escalator' ? [plan.steps.filter((x) => x.type === 'escalator').indexOf(step) + 1, plan.steps.filter((x) => x.type === 'escalator').length] : null} />
  ) : null;

  // Sheets (store page / offer detail), linked to each other.
  let sheetEl = null;
  if (sheet?.type === 'store') {
    const p = placeById.get(sheet.id);
    if (p) sheetEl = (
      <RoomPage place={p} floor={model.floorByCode[p.floor]} doctors={model.doctorsByPlace.get(p.id) || []} isMobile={isMobile}
        onDirections={() => directionsTo(p.id)} onStartHere={() => startFrom(p.id)} onClose={closeSheet}
        onFrontView={!navigating && p.mapped ? () => frontView(p.id) : undefined} />
    );
  }
  const arrival = navigating && arrived && d ? (
    <ArrivalCard place={d} isMobile={isMobile} offers={[]} doctors={model.doctorsByPlace.get(d.id) || []}
      onOffer={openOffer} onDone={endJourney} />
  ) : null;
  const navCard = navigating && !arrived ? (
    <MobileNavigationCard plan={plan} stepIdx={stepIdx} step={step} floor={floor} steps={steps} dist={dist} transport={transport}
      onNext={() => goToStep(stepIdx + 1)} onArrive={arrive} onExit={endJourney} overview={overview} setOverview={setOverview}
      onBackToStep={() => goToStep(stepIdx)} desktop={!isMobile} walkPlaying={walkPlaying} walkRemaining={walkRemaining}
      onToggleWalk={() => { if (walkProgress >= 0.995) { setWalkProgress(0); setWalkPlaying(true); } else setWalkPlaying((v) => !v); }} onRestartWalk={() => { setWalkProgress(0); setWalkPlaying(true); setGuidePhase('walk'); }}
      pov={pov} setPov={changePov} walkSpeed={walkSpeed} setWalkSpeed={setWalkSpeed} guidePhase={guidePhase} onStartWalking={startWalkingFromLift}
      liftDoor={liftDoor} onPickFloor={pickLiftFloor} />
  ) : null;
  const huntHud = hunt && !navigating && !sheetEl ? (
    <HuntHud gameId={hunt.gameId} pick={huntPick} floor={floor} onBoard={onHuntBoard} onGoFloor={freeNavigateFloor}
      onExit={() => { setHunt(null); setHuntBoard(null); setHuntPick(null); }} />
  ) : null;
  const roamBar = roam && !navigating && !sheetEl && !hunt ? (
    <RoamBar desktop={!isMobile} label={roam.label} floorName={floorRow?.name} onBack={() => roamStep(-1)} onForward={() => roamStep(1)}
      touring={touring} toured={toured} onToggleTour={toggleTour} speed={tourSpeed} onSpeed={setTourSpeed} onExit={exitRoam}
      front={!!roam.placeId} onLeaveFront={leaveFront}
      onDetails={roam.placeId ? () => setSheet({ type: 'store', id: roam.placeId }) : null} />
  ) : null;
  // View drop-down: Standard / Street / Top normally; Follow / First person / Top while walking a route.
  const viewValue = navigating ? (viewMode === '2d' ? 'top' : pov === 'first' ? 'first' : 'follow') : roam ? 'street' : viewMode === '2d' ? 'top' : 'std';
  const viewOptions = navigating
    ? [['follow', 'Follow view'], ['first', 'First person'], ['top', 'Top view']]
    : [['std', 'Standard view'], ['street', 'Street view'], ['top', 'Top view']];
  function pickView(v) {
    if (navigating) {
      if (v === 'top') setViewModeSafe('2d');
      else if (v === 'first') changePov('first');
      else { setViewMode('3d'); setPov('follow'); }
      return;
    }
    if (v === 'top') { setViewModeSafe('2d'); return; }
    if (v === 'street') { if (viewMode === '2d') setViewMode('3d'); if (!roam) toggleRoam(); return; }
    if (roam) exitRoam();
    setViewMode('3d');
  }
  const floorBar = (
    <FloorBar floor={floor} setFloor={freeNavigateFloor} navigating={navigating}
      viewValue={viewValue} viewOptions={viewOptions} onView={pickView} />
  );
  const navHeaderCtl = navigating ? (
    <NavHeaderControls floor={floor} destFloor={d?.floor} viewValue={viewValue} viewOptions={viewOptions} onView={pickView} />
  ) : null;
  const shared = {
    model, places: listed, getPlace, start, setStart, dest, setDest, startPlace: s, destPlace: d, onSwap: swapEnds, clearRoute,
    transportPref, setTransportPref, plan, stepIdx, goToStep, dist, totalDist, steps, floor,
    onStartNavigation: startNavigation, navigating,
    tab, setTab, distanceTo, openStore, openOffer, openPromotion, showFacility, showFloor, showSlot,
    parking: { saved, selectedSlot, onSelectSlot: showSlot, onSave: saveCar, onClear: clearCar, onReturn: returnToVehicle, busy: parkBusy, error: parkErr, setFloor: freeNavigateFloor },
    onSearch: (q, results) => api.track('search', { q: q.slice(0, 60), results }),
    onPromoView: (p) => api.track('promotion_view', { storeId: p.store_id, promotionId: p.id }),
    demo: DATA_MODE === 'demo',
    directionsTo, searchQuery, quickSearch, showRestrooms,
    savedCar: saved, onReturnToVehicle: returnToVehicle, onNearest: goNearest,
    qrNote: qrError ? <div className="qrNote" role="alert">That QR code isn't recognised — starting from Main Entrance.<button type="button" onClick={() => setQrError(false)}>OK</button></div> : null,
  };

  const fade = fadeKey > 0 && typeof document !== 'undefined' ? createPortal(<div key={fadeKey} className="liftFade" aria-hidden="true" />, document.body) : null;

  if (isMobile) {
    return (
      <>
      <MobileShell
        {...shared}
        scene={sceneElement} sceneRef={sceneRef} floorTitle={floorBar} navHeaderCtl={navHeaderCtl}
        theme={theme} setTheme={setTheme} viewMode={viewMode} setViewMode={setViewModeSafe}
        roaming={!!roam || !!hunt} roamBar={roamBar || huntHud} hunting={!!hunt}
        colourMode={colourMode} setColourMode={setColourMode}
        onSelectDestination={directionsTo} onSelectStart={startFrom}
        sheet={sheetEl} navCard={navCard} arrival={arrival} onExitNavigation={endJourney}
        setHighlightType={setHighlightType}
      />
      {fade}
      </>
    );
  }

  return (
    <>
    <div className="app">
      <DesktopPanel {...shared} />
      <main>
        <TopBar viewMode={viewMode} setViewMode={setViewModeSafe} theme={theme} setTheme={setTheme} colourMode={colourMode} setColourMode={setColourMode}
          navigating={navigating} overview={overview} setOverview={setOverview} demo={DATA_MODE === 'demo'} />
        <div className="map">
          {shared.qrNote}
          {floorBar}
          {navHeaderCtl && <div className="deskNavHead"><span className="deskNavTo">Navigating to <b>{d?.name}</b></span>{navHeaderCtl}</div>}
          {!roam && !navigating && <div className="legend">
            <span className="lg lift">Lift</span><span className="lg stairs">Stairs</span><span className="lg wc">Restroom</span>
          </div>}
          {sceneElement}
          {roamBar}
          {huntHud}
          {!navigating && transport && floor === step.from && <div className="liftPanel">{transport}</div>}
          {panelCore && !(transport && floor === step?.from) && (
            <TransitPanel kind={panelCore.kind} coreId={panelCore.id} floor={floor} onManualFloor={freeNavigateFloor} close={() => setPanelCore(null)} />
          )}
          {navCard && !sheetEl && (
            <div className="deskNav">
              {navCard}
              {model.promotions.length > 0 && <div className="mNavAd deskAd"><PromoSlider promotions={model.promotions} onPromotion={openPromotion} onPromoView={shared.onPromoView} /></div>}
            </div>
          )}
          {arrival}
          {sheetEl}
        </div>
      </main>
    </div>
    {fade}
    </>
  );
}
