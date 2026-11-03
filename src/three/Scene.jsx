import React, { useMemo, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { MapControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import {
  lifts, escalators, stairs, restrooms, escalatorFloors, OUTLINE, WALK_W, BOUNDS,
  floorVoids, walkwaySegments, kiosks, tablesFor, fireExits, isParking, FLOORS, gardens, entrances,
} from '../data/floors.js';
import { UP, cameraPosition, PRESETS, fitBoundsDistance, FOV_Y_DEG } from '../utils/camera.js';
import { segHitsRect } from '../utils/roam.js';
import { CABIN_ORIGIN, EYE_HEIGHT, RIDE_MS } from '../utils/guide.js';
import { shopSignTexture, shopWindowTexture, shopDoorTexture, awningTexture, lightPoolTexture } from './shopfront.js';
import { signTexture, offerBadgeTexture, huntBadgeTexture, tileTexture, roofLabel, floorText, asphaltTexture } from './textures.js';

// Look: dark navy surroundings, polished light floor, cream store blocks
// with screen-space labels, green wayfinding signs, realistic lifts and
// escalators. Hierarchy: route > start/destination > stores > transport >
// labels > floor.
const STORE_H = 0.9;
const MOBILE_TOP_INSET = 118;   // px of the canvas under the FROM/TO card
const noRay = () => null;
const ROUTE_ORDER = 20;         // renderOrder that keeps the route above everything
const PALETTE = {
  dark: {
    bg: '#0f1b33', slabEdge: '#1a2640', asphalt: '#3a3e45', aisle: '#2f3339', floor: '#e2dccd', grout: 'rgba(120,105,80,.10)', walk: '#f7f4ee', parkFloor: '#c9ccd2', parkWalk: '#e3e5e9',
    wall: '#3a4660', wallCap: '#56647f', voidC: '#2a3852', rim: '#e6f2fa',
    store: '#efe6d2', anchor: '#e8dcc0', side: '#bfaf8c', edge: '#b8a987', decor: '#d6d1c6', parking: '#d7dbe2',
    chip: 'rgba(14,26,46,.92)', chipBorder: '#2b4a7a', chipText: '#fff', hemi: 2.45, sun: 1.45,
  },
  light: {
    bg: '#dfe5ed', slabEdge: '#b9c2ce', asphalt: '#4b5058', aisle: '#3a3e45', floor: '#ece8df', grout: 'rgba(120,105,80,.10)', walk: '#fbf9f4', parkFloor: '#d3d6db', parkWalk: '#eceef1',
    wall: '#9aa6b8', wallCap: '#b8c2d0', voidC: '#9eabbd', rim: '#ffffff',
    store: '#efe6d2', anchor: '#e8dcc0', side: '#cbbe9f', edge: '#b8a987', decor: '#d6d1c6', parking: '#dfe2e8',
    chip: 'rgba(255,255,255,.95)', chipBorder: '#c9d3de', chipText: '#1b2a3c', hemi: 2.45, sun: 1.45,
  },
};

// --------------------------------------------------------------------------
// Camera. App passes a camera *state*:
//   overview  whole floor / whole route, tilted 3D (or the 2D plan)
//   walk      Google-Maps style: low, behind you, facing along the route
//   transit   framed on the lift / escalator you are taking
//   arrival   framed on the destination
// Changes between states are animated; the user can still pan/zoom freely
// until the state changes again.
const WALK_POLAR = (58 * Math.PI) / 180;
const WALK_AHEAD = 2.4;
const FP_FOV = 74;
const FP_FOV_MIN = 40, FP_FOV_MAX = 100;
const WALK_MIN_DIST = 5, WALK_MAX_DIST = 34;           // third-person zoom range while walking
const LIFT_FOV = 66;                                   // wide-angle, like looking round a real lift car
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function goalFor(cam, viewMode, size, isMobile, fov) {
  const top = viewMode === '2d';
  // Inside the lift cabin: just behind the guide, doors ahead. Drag to look around.
  if (!top && cam?.mode === 'lift') {
    const [ox, oy] = CABIN_ORIGIN;
    return { pos: [ox, oy + 0.15 - 1.5, 1.25], target: [ox, oy + 0.15], tz: 1.2, offset: 0, free: true };
  }
  // Stepping out of the lift: a close three-quarter view of the doorway.
  if (!top && cam?.mode === 'exit' && cam.point) {
    const [px, py] = cam.point;
    const h = cam.heading ?? Math.PI / 2;
    const [cx, cy] = cam.exitFrom || [px - Math.cos(h), py - Math.sin(h)];
    const m = Math.hypot(px - cx, py - cy) || 1, dx = (px - cx) / m, dy = (py - cy) / m, lx = -dy, ly = dx;
    return { pos: [px + dx * 2.9 + lx * 2.4, py + dy * 2.9 + ly * 2.4, 2.3], target: [(cx + px) / 2, (cy + py) / 2], tz: 0.65, offset: 0, free: true };
  }
  const walk = !top && cam?.mode === 'walk' && cam.point;
  if (walk) {
    const h = cam.heading ?? Math.PI / 2, dx = Math.cos(h), dy = Math.sin(h);
    const tx = cam.point[0] + dx * WALK_AHEAD, ty = cam.point[1] + dy * WALK_AHEAD;
    const d = isMobile ? 15 : 13, horiz = d * Math.sin(WALK_POLAR);
    return { pos: [tx - dx * horiz, ty - dy * horiz, d * Math.cos(WALK_POLAR)], target: [tx, ty], offset: 0, free: true };
  }
  const name = top ? 'top' : 'straight';
  const { x = 0, y = 0, halfX = 8, halfY = 8 } = cam?.focus || {};   // top view after the lift: the whole way from the lift to the destination
  const inset = isMobile ? cam?.inset ?? MOBILE_TOP_INSET : 0;
  const dist = fitBoundsDistance({ width: size.width, height: size.height, topInset: inset, polarRad: PRESETS[name].polar, halfX, halfY });
  let ty = y;
  if (inset && name === 'top') ty = y + (inset / 2) * ((2 * dist * Math.tan((fov * Math.PI) / 360)) / size.height);
  return { pos: cameraPosition(name, { x, y: ty }, dist), target: [x, ty], offset: name === 'top' ? 0 : inset, free: false };
}
function applyOffset(camera, size, offset) {
  if (offset) camera.setViewOffset(size.width, size.height + offset, 0, 0, size.width, size.height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function CameraRig({ cam, viewMode, isMobile, apiRef }) {
  const { camera, controls, size, gl } = useThree();
  const anim = useRef(null), first = useRef(true);
  const walkPointRef = useRef(null);
  const wasWalkRef = useRef(false);
  const prevModeRef = useRef(null);
  const prevPovRef = useRef(null);
  const walkManualRef = useRef(false);
  const walkSettleRef = useRef(0);                      // timestamp until which the damping tail still counts as "user is steering"
  const walkOffsetRef = useRef(0);
  const walkPolarOffsetRef = useRef(0);
  const walkPanRef = useRef({ x: 0, y: 0 });
  const walkDistRef = useRef(null);
  const headingRef = useRef(0);                         // eased heading: corners turn smoothly
  const fpLook = useRef({ yaw: 0, pitch: 0, dragging: false, last: 0, recentre: false });
  const eyeRef = useRef(null);                          // eased eye position while roaming (street view)
  const eyeViewRef = useRef(null);
  const tickRef = useRef(null);                         // last "jump" (front view / entering street view) applied
  const settleRef = useRef(0);                          // last arrow step: the head turns back to the corridor
  const liftLock = useRef(false);                       // cabin view stays exactly framed until you drag
  const baseDist = isMobile ? 15 : 13;
  const goal = goalFor(cam, viewMode, size, isMobile, FOV_Y_DEG);
  const isWalk = viewMode !== '2d' && cam?.mode === 'walk' && cam.point;
  const isFP = !!isWalk && cam.pov === 'first';
  // Overview/transit/arrival states animate to their framed target. Walking is
  // different: the route moves underneath the camera while the user remains
  // free to look around, so we translate the camera/target by the route delta.
  const key = isWalk
    ? `walk|${cam.walkId ?? 0}|${isFP ? 'fp' : 'follow'}|${cam.tick ?? 0}|${cam.settle ?? 0}|${size.width}|${size.height}`
    : [goal.pos.map((v) => v.toFixed(2)).join(','), goal.target.map((v) => v.toFixed(2)).join(','), goal.tz ?? 0, goal.offset, size.width, size.height].join('|');
  const goalRef = useRef(goal); goalRef.current = goal;
  const go = (g, instant) => {
    camera.up.set(...UP);
    applyOffset(camera, size, g.offset);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (instant || reduce || !controls) {
      camera.position.set(...g.pos);
      if (controls) { controls.target.set(g.target[0], g.target[1], g.tz ?? 0); controls.update(); }
      anim.current = null;
      return;
    }
    anim.current = {
      t0: performance.now(), dur: 1100,
      p0: camera.position.clone(), t0v: controls.target.clone(),
      p1: new THREE.Vector3(...g.pos), t1: new THREE.Vector3(g.target[0], g.target[1], g.tz ?? 0),
    };
  };
  const setFov = (v) => { if (camera.fov !== v) { camera.fov = v; camera.updateProjectionMatrix(); } };

  // Third-person: remember how the user rotated / zoomed / panned, so the view
  // keeps that framing while it follows the guide. The view is captured on every
  // frame while a gesture is running AND while OrbitControls' damping tail is
  // still settling, so a pinch never snaps back or loses its last bit of motion.
  const captureWalkView = () => {
    if (cam?.heading == null || !cam?.point) return;
    const dx = controls.target.x - camera.position.x;
    const dy = controls.target.y - camera.position.y;
    walkOffsetRef.current = angleDiff(Math.atan2(dy, dx), headingRef.current);
    const off = camera.position.clone().sub(controls.target);
    const currentPolar = Math.acos(THREE.MathUtils.clamp(off.z / Math.max(off.length(), 0.0001), -1, 1));
    walkPolarOffsetRef.current = THREE.MathUtils.clamp(currentPolar - WALK_POLAR, -0.45, 0.45);
    walkDistRef.current = THREE.MathUtils.clamp(off.length(), WALK_MIN_DIST, WALK_MAX_DIST);
    const h = headingRef.current + walkOffsetRef.current;
    const tx = cam.point[0] + Math.cos(h) * WALK_AHEAD, ty = cam.point[1] + Math.sin(h) * WALK_AHEAD;
    let px = controls.target.x - tx, py = controls.target.y - ty;
    const m = Math.hypot(px, py);
    if (m > 16) { px *= 16 / m; py *= 16 / m; }
    walkPanRef.current = { x: px, y: py };
  };
  useEffect(() => {
    if (!controls) return undefined;
    const onStart = () => { anim.current = null; if (isWalk && !isFP) { walkManualRef.current = true; walkSettleRef.current = 0; } liftLock.current = false; };
    const onEnd = () => {
      walkManualRef.current = false;      // never leave the flag stuck when the mode changed mid-gesture
      if (!isWalk || isFP) return;
      walkSettleRef.current = performance.now() + 600;      // let the damping tail finish before the follow-cam takes over
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [controls, isWalk, isFP]); // eslint-disable-line react-hooks/exhaustive-deps

  // The phone must never zoom the *page* while the visitor pinches the map
  // (iOS Safari fires its own gesture events on top of touch events).
  useEffect(() => {
    const el = gl.domElement;
    const stop = (e) => e.preventDefault();
    const evs = ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu'];   // a context menu swallows the pointerup and leaves a drag "stuck"
    evs.forEach((n) => el.addEventListener(n, stop, { passive: false }));
    return () => evs.forEach((n) => el.removeEventListener(n, stop));
  }, [gl]);

  // Pinch zoom that does not depend on OrbitControls' own two-finger state
  // (which can go stale after a mode change and then ignore pinches). Every
  // touch is tracked here, in every camera mode; OrbitControls only does the
  // one-finger drag. Zoom goes through the same zoomBy() the + / - buttons use.
  const zoomByRef = useRef(() => {});
  const lookRef = useRef(() => {});
  const fpRef = useRef(false); fpRef.current = isFP;
  useEffect(() => {
    const el = gl.domElement;
    const pts = new Map();
    let last = 0, lastMid = null;
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const scrub = () => {                                   // drop any stale pointer OrbitControls still remembers
      window.setTimeout(() => {
        if (pts.size || !controls) return;
        try { if (Array.isArray(controls._pointers)) controls._pointers.length = 0; if (controls._pointerPositions) for (const k of Object.keys(controls._pointerPositions)) delete controls._pointerPositions[k]; } catch { /* ignore */ }
      }, 0);
    };
    const down = (e) => {
      if (e.pointerType === 'mouse') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { last = spread(); lastMid = mid(); anim.current = null; liftLock.current = false; }
    };
    const move = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size < 2 || fpRef.current) return;
      const s = spread();
      if (last > 0) zoomByRef.current(THREE.MathUtils.clamp(last / s, 0.8, 1.25));   // fingers apart = zoom in
      last = s;
      const m = mid();                                                               // both fingers sliding = turn (sideways) / tilt (up-down)
      if (lastMid) lookRef.current((m.x - lastMid.x) * 0.006, (m.y - lastMid.y) * -0.005);
      lastMid = m;
    };
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      last = pts.size === 2 ? spread() : 0; lastMid = pts.size === 2 ? mid() : null;
      if (pts.size === 0) scrub();
    };
    const reset = () => { pts.clear(); last = 0; lastMid = null; scrub(); };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true); el.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', reset);
    return () => {
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', reset);
    };
  }, [gl, controls]);

  // First person: drag = look around (our own yaw/pitch, the eye stays put);
  // two fingers = pinch to zoom the field of view; wheel zooms on a desktop.
  useEffect(() => {
    if (!isFP) return undefined;
    const el = gl.domElement, st = fpLook.current;
    const pts = new Map();                                  // pointerId -> {x, y}
    let pinch0 = 0, fov0 = FP_FOV;
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const down = (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      st.dragging = true; st.last = performance.now(); st.recentre = false;
      if (pts.size === 2) { pinch0 = spread(); fov0 = camera.fov; }
    };
    const move = (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { pts.clear(); st.dragging = false; st.last = performance.now(); return; }   // button was released somewhere we never heard about
      if (pts.size >= 2) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        setFov(THREE.MathUtils.clamp(fov0 * (pinch0 / spread()), FP_FOV_MIN, FP_FOV_MAX));   // fingers apart = zoom in
      } else {
        st.yaw += (e.clientX - p.x) * 0.0055;
        st.pitch = THREE.MathUtils.clamp(st.pitch + (e.clientY - p.y) * 0.0042, -0.95, 0.75);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      st.last = performance.now();
    };
    const up = (e) => {
      pts.delete(e.pointerId);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      st.dragging = pts.size > 0; st.last = performance.now();     // one finger left after a pinch keeps looking around
    };
    const wheel = (e) => { e.preventDefault(); setFov(THREE.MathUtils.clamp(camera.fov * (e.deltaY > 0 ? 1.06 : 0.94), FP_FOV_MIN, FP_FOV_MAX)); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    const drop = () => { pts.clear(); st.dragging = false; };
    window.addEventListener('blur', drop); window.addEventListener('pointerup', drop); el.addEventListener('lostpointercapture', up);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', drop); window.removeEventListener('pointerup', drop); el.removeEventListener('lostpointercapture', up);
      st.dragging = false;
    };
  }, [isFP, gl, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Switching view (e.g. street view <-> overview) must never inherit a half-finished drag.
    if (controls) { try { if (Array.isArray(controls._pointers)) controls._pointers.length = 0; if (controls._pointerPositions) for (const k of Object.keys(controls._pointerPositions)) delete controls._pointerPositions[k]; } catch { /* ignore */ } }
    const mode = cam?.mode;
    const prevMode = prevModeRef.current;
    if (isWalk) {
      // Entering walk mode: establish the view once. Do not re-frame on every
      // path sample, otherwise the user's look/rotation is lost.
      const entering = !wasWalkRef.current || !walkPointRef.current || prevPovRef.current !== cam.pov;
      if (entering) {
        headingRef.current = cam.heading ?? 0;
        walkOffsetRef.current = 0; walkPolarOffsetRef.current = 0; walkPanRef.current = { x: 0, y: 0 }; walkDistRef.current = null; walkSettleRef.current = 0;
        fpLook.current.yaw = 0; fpLook.current.pitch = 0;
        if (isFP) {
          setFov(FP_FOV); camera.clearViewOffset(); camera.up.set(...UP);
          anim.current = null;
        } else {
          setFov(FOV_Y_DEG);
          go(goal, prevMode !== 'exit');          // after stepping out of a lift, swing round behind the guide
        }
        walkPointRef.current = [...cam.point];
      }
      if (isFP && cam.roam) {
        // A "jump" (entering street view, a shop's front view) resets how you are looking;
        // an arrow step just lets your head turn back to the corridor.
        if (tickRef.current !== (cam.tick ?? 0)) {
          tickRef.current = cam.tick ?? 0;
          fpLook.current.yaw = 0; fpLook.current.pitch = cam.pitch ?? 0; fpLook.current.recentre = false;
          setFov(cam.fov ?? FP_FOV);
        }
        if (settleRef.current !== (cam.settle ?? 0)) { settleRef.current = cam.settle ?? 0; fpLook.current.recentre = true; }
      }
      wasWalkRef.current = true;
      if (isFP) anim.current = null;
    } else {
      wasWalkRef.current = false;
      walkPointRef.current = null;
      eyeRef.current = null; tickRef.current = null;
      setFov(mode === 'lift' ? LIFT_FOV : FOV_Y_DEG);
      go(goal, first.current || mode === 'lift' || prevMode === 'lift');
      first.current = false;
    }
    liftLock.current = mode === 'lift';
    prevModeRef.current = mode;
    prevPovRef.current = cam?.pov;
  }, [key, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, delta) => {
    if (!controls) return;
    if (liftLock.current && cam?.mode === 'lift') {
      const g = goalRef.current;
      camera.position.set(...g.pos);
      controls.target.set(g.target[0], g.target[1], g.tz ?? 0);
      controls.update();
      return;
    }
    if (isWalk && cam?.point) {
      headingRef.current += angleDiff(cam.heading ?? 0, headingRef.current) * (1 - Math.exp(-delta * 7));
      if (isFP) {
        const st = fpLook.current;
        if (st.recentre && !st.dragging) {
          st.yaw *= Math.exp(-delta * 7);                                     // same rate as the heading, so the view direction stays put
          if (Math.abs(st.yaw) < 0.004) { st.yaw = 0; st.recentre = false; }
        } else if (!cam.roam && !st.dragging && performance.now() - st.last > 2500) {
          const k = Math.exp(-delta * 2.2); st.yaw *= k; st.pitch *= k;     // drift back to the road ahead (navigation only; street view stays where you look)
        }
        const h = headingRef.current + st.yaw;
        const bob = cam.moving ? Math.sin(state.clock.elapsedTime * 11.5) * 0.012 : 0;
        let px = cam.point[0], py = cam.point[1], pz = EYE_HEIGHT;
        if (cam.roam) {
          // Street view: glide to each new viewpoint instead of jumping.
          const tz = cam.eyeZ ?? EYE_HEIGHT;
          const eye = eyeRef.current;
          if (!eye || eyeViewRef.current !== cam.viewId) { eyeRef.current = { x: px, y: py, z: tz }; eyeViewRef.current = cam.viewId; }
          else { const k = 1 - Math.exp(-delta * 6); eye.x += (px - eye.x) * k; eye.y += (py - eye.y) * k; eye.z += (tz - eye.z) * k; }
          px = eyeRef.current.x; py = eyeRef.current.y; pz = eyeRef.current.z;
        }
        const z = pz + bob, cp = Math.cos(st.pitch);
        // Near the end of a leg the eye eases back so you see the whole shopfront / lift, not just a door.
        const back = 1.9 * smooth(1 - (cam.remaining ?? 99) / 2.6);
        const ex = px - Math.cos(headingRef.current) * back, ey = py - Math.sin(headingRef.current) * back;
        camera.position.set(ex, ey, z);
        camera.lookAt(ex + Math.cos(h) * cp, ey + Math.sin(h) * cp, z + Math.sin(st.pitch));
        walkPointRef.current = [...cam.point];
        return;
      }
      const prev = walkPointRef.current;
      const ddx = prev ? cam.point[0] - prev[0] : 0, ddy = prev ? cam.point[1] - prev[1] : 0;
      const a = anim.current;
      if (a) {
        // Swinging round behind the guide: keep tracking it while it starts to walk.
        if (ddx || ddy) for (const v of [a.p0, a.p1, a.t0v, a.t1]) { v.x += ddx; v.y += ddy; }
        const k = Math.min(1, (performance.now() - a.t0) / a.dur), e = ease(k);
        camera.position.lerpVectors(a.p0, a.p1, e);
        controls.target.lerpVectors(a.t0v, a.t1, e);
        controls.update();
        if (k >= 1) anim.current = null;
        walkPointRef.current = [...cam.point];
        return;
      }
      if (ddx || ddy) {
        camera.position.x += ddx; camera.position.y += ddy;
        controls.target.x += ddx; controls.target.y += ddy;
      }
      const steering = walkManualRef.current || performance.now() < walkSettleRef.current;
      if (steering) {
        controls.update();                                  // user gesture (or its damping tail) drives the camera
        captureWalkView();
        walkPointRef.current = [...cam.point];
        return;
      }
      {
        const h = headingRef.current + walkOffsetRef.current;
        const dirX = Math.cos(h), dirY = Math.sin(h);
        const d = walkDistRef.current ?? baseDist;
        const polar = THREE.MathUtils.clamp(WALK_POLAR + walkPolarOffsetRef.current, 0.35, 1.18);
        const horiz = d * Math.sin(polar);
        const pan = walkPanRef.current;
        camera.position.x = cam.point[0] - dirX * horiz + pan.x;
        camera.position.y = cam.point[1] - dirY * horiz + pan.y;
        camera.position.z = d * Math.cos(polar);
        controls.target.x = cam.point[0] + dirX * WALK_AHEAD + pan.x;
        controls.target.y = cam.point[1] + dirY * WALK_AHEAD + pan.y;
        controls.target.z = 0;
      }
      walkPointRef.current = [...cam.point];
      controls.update();
      return;
    }
    const a = anim.current;
    if (!a) return;
    const k = Math.min(1, (performance.now() - a.t0) / a.dur), e = ease(k);
    camera.position.lerpVectors(a.p0, a.p1, e);
    controls.target.lerpVectors(a.t0v, a.t1, e);
    controls.update();
    if (k >= 1) anim.current = null;
  });
  const zoomBy = (factor) => {
    if (!controls) return;
    anim.current = null; liftLock.current = false;
    if (isFP) { setFov(THREE.MathUtils.clamp(camera.fov * factor, FP_FOV_MIN, FP_FOV_MAX)); return; }
    const off = new THREE.Vector3().copy(camera.position).sub(controls.target);
    if (isWalk) {
      // The follow-cam rebuilds the camera from walkDistRef every frame, so zoom
      // must change that remembered distance, not just the camera.
      const nd = THREE.MathUtils.clamp((walkDistRef.current ?? off.length()) * factor, WALK_MIN_DIST, WALK_MAX_DIST);
      walkDistRef.current = nd;
      off.setLength(nd);
      camera.position.copy(controls.target).add(off);
      controls.update();
      return;
    }
    off.setLength(THREE.MathUtils.clamp(off.length() * factor, controls.minDistance ?? 1, controls.maxDistance ?? Infinity));
    camera.position.copy(controls.target).add(off);
    controls.update();
  };
  zoomByRef.current = zoomBy;
  // Turn / tilt from the on-screen buttons, in every camera mode.
  //   dyaw   > 0 turns the view to the left, < 0 to the right (radians)
  //   dpitch > 0 looks / tilts up (towards the horizon), < 0 down
  const look = (dyaw, dpitch) => {
    if (!controls) return;
    anim.current = null; liftLock.current = false;
    if (isFP) {
      const st = fpLook.current;
      st.yaw += dyaw; st.pitch = THREE.MathUtils.clamp(st.pitch + dpitch, -0.95, 0.75);
      st.last = performance.now(); st.recentre = false;
      return;
    }
    if (isWalk) {                                         // follow camera rebuilds itself from these offsets every frame
      walkOffsetRef.current = angleDiff(walkOffsetRef.current + dyaw, 0);
      walkPolarOffsetRef.current = THREE.MathUtils.clamp(walkPolarOffsetRef.current + dpitch, -0.45, 0.45);
      return;
    }
    const off = camera.position.clone().sub(controls.target);
    const r = off.length() || 1;
    const phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(off.z / r, -1, 1)) + dpitch, controls.minPolarAngle ?? 0.05, controls.maxPolarAngle ?? 1.5);
    const th = Math.atan2(off.y, off.x) + dyaw;
    off.set(r * Math.sin(phi) * Math.cos(th), r * Math.sin(phi) * Math.sin(th), r * Math.cos(phi));
    camera.position.copy(controls.target).add(off);
    controls.update();
  };
  lookRef.current = look;
  useImperativeHandle(apiRef, () => ({
    zoomBy(factor) { zoomByRef.current(factor); },
    look(dyaw, dpitch) { look(dyaw, dpitch); },
    // Direction (radians) the first-person camera is facing right now, or null.
    getFacing() { return isFP ? headingRef.current + fpLook.current.yaw : null; },
    recenter() {
      if (isFP) { fpLook.current.yaw = 0; fpLook.current.pitch = 0; setFov(FP_FOV); return; }
      if (isWalk && cam?.point) {
        headingRef.current = cam.heading ?? 0;
        go(goalRef.current, true);
        walkPointRef.current = [...cam.point];
        walkOffsetRef.current = 0; walkPolarOffsetRef.current = 0; walkPanRef.current = { x: 0, y: 0 }; walkDistRef.current = null; walkSettleRef.current = 0;
      } else {
        go(goalRef.current, false);
      }
    },
  }), [camera, controls, size.width, size.height, isWalk, isFP, cam?.point]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Keep panning on the building: the target can't leave the floor outline's box.
function PanLimit({ disabled = false }) {
  const { controls, camera } = useThree();
  const off = useRef(disabled); off.current = disabled;
  useEffect(() => {
    if (!controls) return undefined;
    const clamp = () => {
      if (off.current) return;
      const t = controls.target;
      const cx = THREE.MathUtils.clamp(t.x, BOUNDS.minX - 2, BOUNDS.maxX + 2);
      const cy = THREE.MathUtils.clamp(t.y, BOUNDS.minY - 2, BOUNDS.maxY + 2);
      if (cx !== t.x || cy !== t.y) {
        camera.position.x += cx - t.x; camera.position.y += cy - t.y;
        t.x = cx; t.y = cy;
      }
    };
    controls.addEventListener('change', clamp);
    return () => controls.removeEventListener('change', clamp);
  }, [controls, camera]);
  return null;
}

// --------------------------------------------------------------------------
// Floor plate, walkable corridors, low perimeter wall
// --------------------------------------------------------------------------
function insideOutline(x, y) {
  let c = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i], [xj, yj] = OUTLINE[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const outlineShape = () => { const sh = new THREE.Shape(); OUTLINE.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath(); return sh; };

function wallPieces(floor) {
  const out = [];
  for (let i = 0; i < OUTLINE.length; i++) {
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % OUTLINE.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    // Entrances on this floor leave a 3.2-unit opening in the wall they sit on.
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const cuts = entrances.filter((e) => e.floor === floor).map((e) => {
      const t = (e.x - a[0]) * ux + (e.y - a[1]) * uy, off = Math.abs((e.x - a[0]) * uy - (e.y - a[1]) * ux);
      return off < 1.0 && t > 0 && t < len ? t : null;
    }).filter((t) => t != null).sort((m, n) => m - n);
    let from = 0;
    const P = (t) => [a[0] + ux * t, a[1] + uy * t];
    for (const t of cuts) { if (t - 1.6 > from) out.push([P(from), P(t - 1.6)]); from = t + 1.6; }
    if (from < len) out.push([P(from), b]);
  }
  return out;
}


function Slab({ floor, pal }) {
  const shape = useMemo(outlineShape, []);
  const walls = useMemo(() => wallPieces(floor), [floor]);
  const parking = isParking(floor);
  const tile = useMemo(() => (parking ? asphaltTexture(pal.asphalt) : tileTexture(pal.floor, pal.grout, [Math.round((BOUNDS.maxX - BOUNDS.minX) / 2.2), Math.round((BOUNDS.maxY - BOUNDS.minY) / 2.2)])), [parking, pal]);
  const H = 0.45;
  return (
    <group>
      {/* The slab body's top face used to sit at exactly z=0, the same height as the tiled floor, so the two
          fought for the pixel and showed moving stripes whenever the camera moved. It now stops just below. */}
      <mesh position={[0, 0, -0.74]}>
        <extrudeGeometry args={[shape, { depth: 0.72, bevelEnabled: false }]} />
        <meshStandardMaterial color={pal.slabEdge} roughness={0.9} />
      </mesh>
      <mesh receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial map={tile} roughness={parking ? 0.9 : 0.35} metalness={0.05}  />
      </mesh>
      {walls.map(([a, b], i) => {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        return (
          <group key={i} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]} rotation={[0, 0, ang]}>
            <mesh position={[0, 0, H / 2]}><boxGeometry args={[L + 0.28, 0.28, H]} /><meshStandardMaterial color={pal.wall} roughness={0.8} /></mesh>
            <mesh position={[0, 0, H + 0.02]}><boxGeometry args={[L + 0.3, 0.3, 0.04]} /><meshStandardMaterial color={pal.wallCap} roughness={0.6} /></mesh>
          </group>
        );
      })}
    </group>
  );
}

// Walkable corridors: a slightly brighter band on the polished floor.
function Walkways({ floor, stores, pal }) {
  const segs = useMemo(() => {
    const s = walkwaySegments(floor).map(([a, b]) => [a, b]);
    stores.forEach((st) => { if (st.spur && st.door) s.push([st.door, st.spur]); });
    return s;
  }, [floor, stores]);
  // Round joints only where corridors meet (a dead end against the outer wall stays square).
  const joints = useMemo(() => {
    const m = new Map();
    segs.forEach(([a, b]) => [a, b].forEach((p) => { const k = `${p[0].toFixed(2)},${p[1].toFixed(2)}`; const e = m.get(k); m.set(k, { p, n: (e?.n || 0) + 1 }); }));
    return [...m.values()].filter((e) => e.n > 1).map((e) => e.p);
  }, [segs]);
  const parking = isParking(floor);
  const W = parking ? 1.76 : WALK_W;
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: parking ? pal.aisle : pal.walk, roughness: parking ? 0.9 : 0.3 }), [parking, pal]);
  // Painted lane arrows on the drive aisles (both ways: the real traffic
  // direction isn't published, so no one-way is implied).
  const arrows = useMemo(() => {
    if (!parking) return [];
    const out = [];
    walkwaySegments(floor).forEach(([a, b]) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 3.2) return;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), nx = -Math.sin(ang), ny = Math.cos(ang);
      for (let t = 1.6; t < L - 1.2; t += 4.2) {
        const x = a[0] + ((b[0] - a[0]) * t) / L, y = a[1] + ((b[1] - a[1]) * t) / L;
        out.push([x + nx * 0.42, y + ny * 0.42, ang], [x - nx * 0.42, y - ny * 0.42, ang + Math.PI]);
      }
    });
    return out;
  }, [floor, parking]);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const disc = useMemo(() => new THREE.CircleGeometry(0.5, 20), []);
  return (
    <group position={[0, 0, 0.012]}>
      {segs.map(([a, b], i) => {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return <mesh key={i} geometry={plane} material={mat} receiveShadow scale={[L, W, 1]} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]} rotation={[0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])]} />;
      })}
      {joints.map((p, i) => <mesh key={'j' + i} geometry={disc} material={mat} receiveShadow scale={[W, W, 1]} position={[p[0], p[1], 0.004]} />)}
      {arrows.map(([x, y, a], i) => (
        <mesh key={'a' + i} geometry={chevronGeo} position={[x, y, 0.008]} rotation={[0, 0, a]} scale={[2.6, 2.6, 1]}>
          <meshBasicMaterial color="#f5f5f0" transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

// Atrium openings: a dark recess (the floor below) edged by a glass
// balustrade with a bright rim, so they read as holes, not blocks.
function Atrium({ floor, pal, clear = false }) {
  const { polys, circles } = useMemo(() => floorVoids(floor), [floor]);
  const shapes = useMemo(() => polys.map((p) => { const sh = new THREE.Shape(); p.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath(); return sh; }), [polys]);
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfe8f5', transparent: true, opacity: 0.28, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }), []);
  const rim = useMemo(() => new THREE.MeshStandardMaterial({ color: pal.rim, roughness: 0.3, metalness: 0.4 }), [pal.rim]);
  return (
    <group>
      {shapes.map((sh, i) => <mesh key={i} position={[0, 0, 0.02]}><shapeGeometry args={[sh]} /><meshStandardMaterial color={pal.voidC} roughness={1} /></mesh>)}
      {!clear && polys.map((p, i) => p.map((a, k) => {
        const b = p[(k + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) return null;
        return (
          <group key={`${i}-${k}`} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]} rotation={[0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])]}>
            <mesh position={[0, 0, 0.28]} material={glass}><boxGeometry args={[L, 0.04, 0.5]} /></mesh>
            <mesh position={[0, 0, 0.55]} material={rim}><boxGeometry args={[L + 0.02, 0.07, 0.05]} /></mesh>
          </group>
        );
      }))}
      {circles.map((c, i) => (
        <group key={'c' + i} position={[c.x, c.y, 0]}>
          <mesh position={[0, 0, 0.02]}><circleGeometry args={[c.r, 48]} /><meshStandardMaterial color={pal.voidC} roughness={1} /></mesh>
          <mesh position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]} material={glass}><cylinderGeometry args={[c.r, c.r, 0.5, 48, 1, true]} /></mesh>
          <mesh position={[0, 0, 0.55]} material={rim}><torusGeometry args={[c.r, 0.035, 8, 48]} /></mesh>
        </group>
      ))}
    </group>
  );
}

// Round pillars at the atrium corners and potted plants along the
// balustrades — instanced so they cost two draw calls each.
// Shortest distance from a point to a polyline (the route).
function distToPath(p, path) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * (bx - ax)), p[1] - (ay + t * (by - ay))));
  }
  return best;
}

function Decor({ floor, route = null }) {
  const { pillars, plants } = useMemo(() => {
    const pl = [], pt = [];
    if (isParking(floor)) {
      // structural column grid between the drive aisles
      // Only where a column can stand: inside the shell, clear of the drive aisles.
      const segs = walkwaySegments(floor);
      const clear = (x, y) => segs.every(([a, b]) => {
        const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2));
        return Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1]))) > 1.1;
      });
      for (let y = -22; y <= 20; y += 4.5) for (const x of [-4.5, 3.4]) if (insideOutline(x, y) && clear(x, y)) pl.push([x, y]);
      return { pillars: [], plants: pt };      // parking columns are drawn by ParkingColumns
    }
    const { polys, circles } = floorVoids(floor);
    for (const p of polys) {
      const cx = p.reduce((n, q) => n + q[0], 0) / p.length, cy = p.reduce((n, q) => n + q[1], 0) / p.length;
      // pillars at the polygon's extreme ends, plants spaced along the long edges
      const byY = [...p].sort((a, b) => a[1] - b[1]);
      for (const q of [byY[0], byY[byY.length - 1]]) pl.push([q[0] + (cx - q[0]) * 0.12, q[1] + (cy - q[1]) * 0.12]);
      for (let k = 0; k < p.length; k++) {
        const a = p[k], b = p[(k + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.floor(L / 4.5);
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
          pt.push([x + (cx - x) * 0.08 / Math.max(1, Math.abs(cx - x)), y]);
        }
      }
    }
    for (const c of circles) for (let d = 45; d < 360; d += 90) {
      const r = (d * Math.PI) / 180; pt.push([c.x + Math.cos(r) * (c.r - 0.25), c.y + Math.sin(r) * (c.r - 0.25)]);
    }
    // Keep the way you walk clear: no plant or pillar within reach of the route line.
    if (route && route.length > 1) return { pillars: pl.filter((q) => distToPath(q, route) > 1.6), plants: pt.filter((q) => distToPath(q, route) > 1.8) };
    return { pillars: pl, plants: pt };
  }, [floor, route]);
  const refs = { pil: useRef(), pot: useRef(), leaf: useRef() };
  useEffect(() => {
    const m = new THREE.Matrix4();
    pillars.forEach(([x, y], i) => { m.makeTranslation(x, y, 0.75); refs.pil.current?.setMatrixAt(i, m); });
    plants.forEach(([x, y], i) => {
      m.makeTranslation(x, y, 0.14); refs.pot.current?.setMatrixAt(i, m);
      m.makeTranslation(x, y, 0.42); refs.leaf.current?.setMatrixAt(i, m);
    });
    for (const r of Object.values(refs)) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  }, [pillars, plants]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {pillars.length > 0 && (
        <instancedMesh ref={refs.pil} args={[null, null, pillars.length]} castShadow key={'p' + pillars.length}>
          <cylinderGeometry args={[0.17, 0.17, 1.5, 20]} /><meshStandardMaterial color="#dad3c3" roughness={0.5} />
        </instancedMesh>
      )}
      {plants.length > 0 && (
        <>
          <instancedMesh ref={refs.pot} args={[null, null, plants.length]} key={'o' + plants.length}>
            <cylinderGeometry args={[0.16, 0.12, 0.28, 12]} /><meshStandardMaterial color="#6b5a48" roughness={0.8} />
          </instancedMesh>
          <instancedMesh ref={refs.leaf} args={[null, null, plants.length]} castShadow key={'l' + plants.length}>
            <icosahedronGeometry args={[0.26, 1]} /><meshStandardMaterial color="#3f7d4a" roughness={0.9} flatShading />
          </instancedMesh>
        </>
      )}
    </group>
  );
}

function Props({ floor, clear = false }) {
  const tables = useMemo(() => tablesFor(floor), [floor]);
  return (
    <group>
      {!clear && kiosks.filter((k) => k.floor === floor).map((k) => (
        <group key={k.id} position={[k.x, k.y, 0]}>
          <mesh castShadow position={[0, 0, 0.3]}><boxGeometry args={[k.w, k.d, 0.6]} /><meshStandardMaterial color="#efe6d2" roughness={0.6} /></mesh>
          <mesh position={[0, 0, 0.62]}><boxGeometry args={[k.w + 0.1, k.d + 0.1, 0.05]} /><meshStandardMaterial color="#b8a987" /></mesh>
        </group>
      ))}
      {!clear && tables.map((t, i) => (
        <mesh key={i} position={[t[0], t[1], 0.1]}><cylinderGeometry args={[0.22, 0.22, 0.14, 12]} /><meshStandardMaterial color="#d8c3a0" roughness={0.7} /></mesh>
      ))}
      {!isParking(floor) && fireExits.map((f, i) => (
        <mesh key={'fx' + i} position={[f[0], f[1], 0.03]}><circleGeometry args={[0.12, 12]} /><meshBasicMaterial color="#0e9f4f" /></mesh>
      ))}
    </group>
  );
}

// Garden courtyards between the wings: lawn, a hedge border, trees and benches.
// Instanced, so every garden on the floor costs a handful of draw calls.
function Gardens({ floor }) {
  const list = useMemo(() => gardens.filter((g) => g.floor === floor), [floor]);
  const trees = useMemo(() => {
    const out = [];
    for (const g of list) {
      const nx = Math.max(1, Math.floor((g.w - 1.2) / 2.6)), ny = Math.max(1, Math.floor((g.d - 1.2) / 2.6));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        if ((i + j) % 2) continue;
        out.push([g.x - g.w / 2 + 0.6 + (g.w - 1.2) * ((i + 0.5) / nx), g.y - g.d / 2 + 0.6 + (g.d - 1.2) * ((j + 0.5) / ny)]);
      }
    }
    return out;
  }, [list]);
  const refs = { trunk: useRef(), crown: useRef() };
  useEffect(() => {
    const m = new THREE.Matrix4();
    trees.forEach(([x, y], i) => {
      m.makeTranslation(x, y, 0.25); refs.trunk.current?.setMatrixAt(i, m);
      m.makeTranslation(x, y, 0.75); refs.crown.current?.setMatrixAt(i, m);
    });
    for (const r of Object.values(refs)) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  }, [trees]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  return (
    <group raycast={noRay}>
      {list.map((g) => (
        <group key={g.id} position={[g.x, g.y, 0]}>
          <mesh position={[0, 0, 0.03]} receiveShadow><boxGeometry args={[g.w, g.d, 0.06]} /><meshStandardMaterial color="#7fae6a" roughness={1} /></mesh>
          {[[0, g.d / 2 - 0.1, g.w, 0.2], [0, -g.d / 2 + 0.1, g.w, 0.2], [g.w / 2 - 0.1, 0, 0.2, g.d], [-g.w / 2 + 0.1, 0, 0.2, g.d]].map(([x, y, w, d], i) => (
            <mesh key={i} position={[x, y, 0.16]} castShadow><boxGeometry args={[w, d, 0.32]} /><meshStandardMaterial color="#4c7f45" roughness={0.9} /></mesh>
          ))}
          <mesh position={[0, 0, 0.065]}><boxGeometry args={[Math.min(1, g.w * 0.25), g.d - 0.6, 0.02]} /><meshStandardMaterial color="#e3d8c2" roughness={0.9} /></mesh>
        </group>
      ))}
      {trees.length > 0 && <>
        <instancedMesh key={'t' + trees.length} ref={refs.trunk} args={[null, null, trees.length]} castShadow>
          <cylinderGeometry args={[0.07, 0.09, 0.5, 8]} /><meshStandardMaterial color="#6b5236" roughness={0.9} />
        </instancedMesh>
        <instancedMesh key={'c' + trees.length} ref={refs.crown} args={[null, null, trees.length]} castShadow>
          <icosahedronGeometry args={[0.5, 1]} /><meshStandardMaterial color="#3f7d4a" roughness={0.9} flatShading />
        </instancedMesh>
      </>}
    </group>
  );
}

// --------------------------------------------------------------------------
// Stores: cream blocks (or category colours, a viewer setting) with a thin
// storefront band in the category colour, the name painted on the roof, and
// a clear gap to their neighbours.
// --------------------------------------------------------------------------
const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
const mix = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const BLOCK_GAP = 0.16;   // per side -> ~0.32 units between neighbours

function footprint(d) {
  return d.poly || [[d.x - d.w / 2, d.y - d.d / 2], [d.x + d.w / 2, d.y - d.d / 2], [d.x + d.w / 2, d.y + d.d / 2], [d.x - d.w / 2, d.y + d.d / 2]];
}
// Move every edge of a polygon inward by t (mitred corners).
export function insetPoly(poly, t) {
  const pts = poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-4; });
  const n = pts.length;
  if (n < 3) return poly;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const sgn = area > 0 ? 1 : -1;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = (-(b[1] - a[1]) / L) * sgn, ny = ((b[0] - a[0]) / L) * sgn;   // inward normal
    return { a: [a[0] + nx * t, a[1] + ny * t], d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
  });
  return pts.map((p, i) => {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    if (Math.abs(den) < 1e-6) return l2.a;
    const u = ((l2.a[0] - l1.a[0]) * l2.d[1] - (l2.a[1] - l1.a[1]) * l2.d[0]) / den;
    const q = [l1.a[0] + l1.d[0] * u, l1.a[1] + l1.d[1] * u];
    // Guard against spikes on very sharp corners.
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > t * 4 ? l2.a : q;
  });
}

// ---- Shopfront photo uploaded from the store login -------------------------
const frontTexCache = new Map();
function useFrontTexture(url) {
  const [rec, setRec] = useState(() => (url ? frontTexCache.get(url) || null : null));
  useEffect(() => {
    if (!url) { setRec(null); return undefined; }
    const hit = frontTexCache.get(url);
    if (hit) { setRec(hit); return undefined; }
    let live = true;
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const r = { tex, aspect: (tex.image?.width || 1) / (tex.image?.height || 1) };
      frontTexCache.set(url, r);
      if (live) setRec(r);
    }, undefined, () => {});                        // a broken link just keeps the plain shopfront
    return () => { live = false; };
  }, [url]);
  return rec;
}

// The photo, "cover"-fitted onto the vertical face of the store block that has the door.
function FrontImage({ rec, W, H, x, y, theta }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(W, H);
    const ap = W / H, ai = rec.aspect, uv = g.attributes.uv;
    let rx = 1, ry = 1;
    if (ai > ap) rx = ap / ai; else ry = ai / ap;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (1 - rx) / 2 + uv.getX(i) * rx, (1 - ry) / 2 + uv.getY(i) * ry);
    return g;
  }, [rec, W, H]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group position={[x, y, 0]} rotation={[0, 0, theta]}>
      <mesh position={[0, -0.12, H / 2]} rotation={[Math.PI / 2, 0, 0]} geometry={geo} raycast={() => null}>
        <meshBasicMaterial map={rec.tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Store({ d, active, selected, onPick, highlight, hasOffer, pal, colourMode, fp = false, clear = false, hunt = null }) {
  const [hovered, setHovered] = useState(false);
  const decor = d.decor;
  // Tiny per-block height offset: when two blocks overlap (e.g. after a resize) their roofs are no longer
  // exactly coplanar, so the roofs / labels stop flickering (z-fighting).
  const jitter = useMemo(() => { let h = 0; for (const ch of String(d.id)) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h % 7) * 0.0025; }, [d.id]);
  const H = (decor ? 0.35 : STORE_H) + jitter;
  const catColor = d.color || '#9cc7e6';
  const base = decor ? pal.decor : colourMode === 'category' && d.color && !d.vacant ? d.color : d.anchor ? pal.anchor : pal.store;
  const top = active ? mix(base, '#e5484d', 0.14) : base;
  const pts = useMemo(() => {
    const raw = footprint(d);
    return insetPoly(raw, Math.min(BLOCK_GAP, Math.min(d.w, d.d) * 0.2));
  }, [d]);
  const geo = useMemo(() => {
    const sh = new THREE.Shape();
    pts.forEach(([x, y], i) => { const px = x - d.x, py = y - d.y; if (i) sh.lineTo(px, py); else sh.moveTo(px, py); });
    sh.closePath();
    const bevel = decor ? 0 : 0.04;
    return new THREE.ExtrudeGeometry(sh, { depth: H - bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  }, [pts, d.x, d.y, H, decor]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 35), [geo]);
  const frontRec = useFrontTexture(!decor && !d.vacant && d.door ? d.store?.front_image_url || null : null);
  const mats = useMemo(() => [
    new THREE.MeshStandardMaterial({ color: top, roughness: 0.65 }),
    new THREE.MeshStandardMaterial({ color: shade(base === pal.store || base === pal.anchor ? pal.side : base, base === pal.store || base === pal.anchor ? 1 : 0.8), roughness: 0.8 }),
  ], [top, base, pal]);
  useEffect(() => () => { geo.dispose(); edges.dispose(); }, [geo, edges]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  useEffect(() => {
    // Panda Hunt: suspects glow gold (pulsing, below), checked stores turn red, the found store green.
    const H = { cand: ['#ffb800', 0.3], picked: ['#e5484d', 0.4], found: ['#2fb35a', 0.45] }[hunt];
    mats[0].emissive.set(H ? H[0] : selected ? '#2f80ff' : '#ffffff');
    mats[0].emissiveIntensity = H ? H[1] : selected ? 0.18 : hovered && !decor ? 0.08 : 0;
  }, [selected, hovered, mats, decor, hunt]);
  useFrame(({ clock }) => { if (hunt === 'cand') mats[0].emissiveIntensity = (hovered ? 0.42 : 0.22) + Math.sin(clock.elapsedTime * 3.2) * 0.12; });
  // Name + category on the roof, always there (see roofLabel).
  const label = useMemo(() => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = (Math.max(...xs) - Math.min(...xs)) * 0.94, dd = (Math.max(...ys) - Math.min(...ys)) * 0.94;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2 - d.x, cy = (Math.max(...ys) + Math.min(...ys)) / 2 - d.y;
    return { tex: roofLabel(d.name, decor ? '' : d.subtitle || '', +w.toFixed(2), +dd.toFixed(2)), w, d: dd, cx, cy };
  }, [pts, d.name, d.subtitle, d.x, d.y, decor]);
  // Storefront band on the edge nearest the door (category colour).
  const front = useMemo(() => {
    if (!d.door || decor) return null;
    let best = null;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist = Math.hypot(m[0] - d.door[0], m[1] - d.door[1]), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 0.3 && (!best || dist < best.dist)) best = { dist, m, L, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    });
    if (!best) return null;
    const k = 0.06 / Math.max(0.1, Math.hypot(best.m[0] - d.x, best.m[1] - d.y));
    return { ...best, m: [best.m[0] - (best.m[0] - d.x) * k, best.m[1] - (best.m[1] - d.y) * k] };
  }, [pts, d.door, d.x, d.y, decor]);
  // Uploaded shopfront photo: sits on the same edge as the door, facing outwards.
  const facade = useMemo(() => {
    if (!frontRec || !front) return null;
    const nx0 = -Math.sin(front.ang), ny0 = Math.cos(front.ang);
    const out = nx0 * (front.m[0] - d.x) + ny0 * (front.m[1] - d.y) >= 0 ? 1 : -1;
    return { W: front.L + 0.08, H: H + 0.02, x: front.m[0] - d.x, y: front.m[1] - d.y, theta: Math.atan2(nx0 * out, -(ny0 * out)) };
  }, [frontRec, front, d.x, d.y, H]);
  // First-person only: a real-looking shopfront on the edge that has the door.
  const shop = useMemo(() => {
    if (!fp || !d.door || decor || facade) return null;
    let best = null;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.5) return;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const t = Math.max(0, Math.min(L, (d.door[0] - a[0]) * ux + (d.door[1] - a[1]) * uy));
      const px = a[0] + ux * t, py = a[1] + uy * t;
      const dist = Math.hypot(px - d.door[0], py - d.door[1]);
      if (!best || dist < best.dist) best = { dist, a, ux, uy, L, t };
    });
    if (!best) return null;
    const W = Math.min(best.L * 0.92, 3.2);
    const t = Math.max(W / 2, Math.min(best.L - W / 2, best.t));
    const cx = best.a[0] + best.ux * t, cy = best.a[1] + best.uy * t;
    const ang = Math.atan2(best.uy, best.ux);
    const s = (d.door[0] - cx) * -best.uy + (d.door[1] - cy) * best.ux >= 0 ? 1 : -1;
    return { W, x: cx - d.x, y: cy - d.y, rot: ang + (s > 0 ? Math.PI : 0) };
  }, [fp, d.door, d.x, d.y, pts, decor, facade]);
  function handleClick(e) { e.stopPropagation(); if (!decor) onPick(d.id); }
  const noRay = () => null;
  return (
    <group position={[d.x, d.y, 0]} onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); if (!decor) { setHovered(true); document.body.style.cursor = 'pointer'; } }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = 'auto'; }}>
      <mesh castShadow receiveShadow geometry={geo} material={mats} />
      <lineSegments geometry={edges} raycast={noRay}><lineBasicMaterial color={active ? '#e5484d' : pal.edge} transparent opacity={active ? 1 : 0.7} /></lineSegments>
      <mesh position={[label.cx, label.cy, H + 0.03]} raycast={noRay} renderOrder={3}>
        <planeGeometry args={[label.w, label.d]} />
        <meshBasicMaterial map={label.tex} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
      </mesh>
      {front && !facade && (
        <mesh position={[front.m[0] - d.x, front.m[1] - d.y, H * 0.55]} rotation={[0, 0, front.ang]} raycast={noRay}>
          <boxGeometry args={[front.L * 0.7, 0.05, H * 0.5]} /><meshStandardMaterial color={d.vacant ? '#b9b2a4' : catColor} roughness={0.5} />
        </mesh>
      )}
      {highlight && !decor && <mesh position={[0, 0, 0.03]}><ringGeometry args={[Math.min(1.1, Math.max(d.w, d.d) * 0.38), Math.min(1.25, Math.max(d.w, d.d) * 0.44), 40]} /><meshBasicMaterial color="#ffc53d" /></mesh>}
      {hasOffer && !decor && !clear && !hunt && <OfferBadge x={d.w * 0.3} y={d.d * 0.28} z={H + 0.5} />}
      {hunt && !decor && <HuntBadge kind={hunt === 'cand' ? 'q' : hunt === 'picked' ? 'x' : 'panda'} z={H + 0.75} />}
      {hunt && hunt !== 'picked' && !decor && <mesh position={[0, 0, 0.03]} raycast={noRay}><ringGeometry args={[Math.min(1.1, Math.max(d.w, d.d) * 0.38), Math.min(1.3, Math.max(d.w, d.d) * 0.46), 40]} /><meshBasicMaterial color={hunt === 'found' ? '#2fb35a' : '#ffb800'} /></mesh>}
      {facade && <FrontImage rec={frontRec} {...facade} />}
      {shop && <Shopfront d={d} shop={shop} active={active} color={catColor} />}
      {active && d.door && <Entrance d={d} />}
    </group>
  );
}

// Shopfront seen from the corridor: name signboard, glass door, lit display
// windows, striped awning and a pool of light on the floor.
// Local frame: x along the facade, -y points out into the corridor, z up.
function Shopfront({ d, shop, active, color }) {
  const noRay = () => null;
  const vacant = !!d.vacant;
  const { W } = shop;
  const doorW = W < 1.3 ? Math.min(0.5, W * 0.7) : 0.5;
  const winW = Math.max(0, (W - doorW) / 2 - 0.05);
  const signW = Math.min(W * 0.72, 1.6);
  const sign = shopSignTexture(d.name || 'Store', color, { active, vacant });
  const door = shopDoorTexture(vacant);
  const win = shopWindowTexture(color, d.id || d.name, vacant);
  const awn = awningTexture(vacant ? '#868c96' : color);
  const pool = lightPoolTexture();
  const FACE = 0.07;                                    // just proud of the block face
  const upright = [Math.PI / 2, 0, 0];
  const plane = (w, h, z, y, map, extra = {}) => (
    <mesh position={[extra.x || 0, -y, z]} rotation={upright} raycast={noRay} renderOrder={extra.order || 0}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={map} toneMapped={false} />
    </mesh>
  );
  return (
    <group position={[shop.x, shop.y, 0]} rotation={[0, 0, shop.rot]}>
      {plane(signW, signW / 4, 0.69, FACE + 0.012, sign)}
      <mesh position={[0, -(FACE - 0.005), 0.69]} raycast={noRay}><boxGeometry args={[signW + 0.05, 0.03, signW / 4 + 0.05]} /><meshStandardMaterial color="#20242b" roughness={0.6} /></mesh>
      {plane(doorW, 0.38, 0.24, FACE, door, { x: 0 })}
      {winW > 0.15 && plane(winW, 0.38, 0.24, FACE, win, { x: -(doorW / 2 + 0.05 + winW / 2) })}
      {winW > 0.15 && plane(winW, 0.38, 0.24, FACE, win, { x: doorW / 2 + 0.05 + winW / 2 })}
      <mesh position={[0, -(FACE + 0.045), 0.455]} rotation={[-0.45, 0, 0]} raycast={noRay}>
        <boxGeometry args={[W * 0.96, 0.12, 0.012]} /><meshBasicMaterial map={awn} toneMapped={false} />
      </mesh>
      <mesh position={[0, -(FACE + 0.35), 0.012]} raycast={noRay}>
        <planeGeometry args={[W * 1.1, 0.9]} />
        <meshBasicMaterial map={pool} transparent opacity={vacant ? 0 : 0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, -(FACE + 0.1), 0.014]} raycast={noRay}><planeGeometry args={[doorW + 0.1, 0.16]} /><meshBasicMaterial color="#3a3f48" /></mesh>
    </group>
  );
}


function OfferBadge({ x, y, z }) {
  const map = useMemo(offerBadgeTexture, []);
  return <sprite position={[x, y, z]} scale={[1.05, 0.46, 1]} renderOrder={16}><spriteMaterial map={map} toneMapped={false} depthTest={false} /></sprite>;
}

function HuntBadge({ kind, z }) {
  const map = useMemo(() => huntBadgeTexture(kind), [kind]);
  const ref = useRef();
  const big = kind === 'panda' ? 1.9 : 1.35;
  useFrame(({ clock }) => { if (ref.current && kind !== 'x') ref.current.position.z = z + Math.sin(clock.elapsedTime * 2.6) * 0.12; });
  return <sprite ref={ref} position={[0, 0, z]} scale={[big, big, 1]} renderOrder={17}><spriteMaterial map={map} toneMapped={false} depthTest={false} /></sprite>;
}

// Destination entrance: a red threshold bar on the store's door.
function Entrance({ d }) {
  const dx = d.door[0] - d.x, dy = d.door[1] - d.y;
  return (
    <mesh position={[dx, dy, 0.06]} rotation={[0, 0, Math.atan2(dy, dx)]} renderOrder={ROUTE_ORDER - 1}>
      <boxGeometry args={[0.16, 1.0, 0.05]} /><meshBasicMaterial color="#e5484d" depthTest={false} />
    </mesh>
  );
}

// --------------------------------------------------------------------------
// Lifts and escalators — modelled to look like the real thing
// --------------------------------------------------------------------------
// Wayfinding sign at a fixed 30 px on screen at any zoom, like a map icon.
function Sign({ kind, z = 2.1, onClick }) {
  const map = useMemo(() => signTexture(kind), [kind]);
  const ref = useRef();
  const { camera, size } = useThree();
  useFrame(() => {
    const fullH = camera.view?.enabled ? camera.view.fullHeight : size.height;
    const k = (30 * 2 * Math.tan(((camera.fov / camera.zoom) * Math.PI) / 360)) / fullH;
    ref.current?.scale.set(k, k, 1);
  });
  return <sprite ref={ref} position={[0, 0, z]} onClick={onClick} renderOrder={14}><spriteMaterial map={map} toneMapped={false} sizeAttenuation={false} depthTest={false} /></sprite>;
}
function Halo({ r, on, color = '#ffc53d' }) {
  if (!on) return null;
  return <mesh position={[0, 0, 0.03]}><ringGeometry args={[r, r + 0.14, 40]} /><meshBasicMaterial color={color} /></mesh>;
}
function hoverProps(set) {
  return {
    onPointerOver: (e) => { e.stopPropagation(); set(true); document.body.style.cursor = 'pointer'; },
    onPointerOut: (e) => { e.stopPropagation(); set(false); document.body.style.cursor = 'auto'; },
  };
}
const tag = (bg) => ({ pointerEvents: 'none', color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: bg, padding: '3px 8px', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,.3)' });

// Low metalness on purpose: with no environment map, true metals render near-black.
const steel = new THREE.MeshStandardMaterial({ color: '#c3c9d0', metalness: 0.25, roughness: 0.35 });
const doorGlass = new THREE.MeshStandardMaterial({ color: '#2a3441', metalness: 0.1, roughness: 0.15 });
const doorLine = new THREE.MeshBasicMaterial({ color: '#8b96a3' });

// One lift car: stainless cabinet, dark glass doors with a centre seam.
function Lift({ l, active, highlight, onClick }) {
  const [hov, setHov] = useState(false);
  const click = (e) => { e.stopPropagation(); onClick(l.id); };
  return (
    <group position={[l.x, l.y, 0]} onClick={click} {...hoverProps(setHov)}>
      <mesh castShadow position={[0, 0, 0.8]} material={steel}><boxGeometry args={[0.92, 0.92, 1.6]} /></mesh>
      <mesh position={[0, -0.465, 0.66]} material={doorGlass}><boxGeometry args={[0.62, 0.02, 1.2]} /></mesh>
      <mesh position={[0, -0.478, 0.66]} material={doorLine}><boxGeometry args={[0.02, 0.01, 1.2]} /></mesh>
      <mesh position={[0, 0, 1.62]}><boxGeometry args={[0.96, 0.96, 0.05]} /><meshStandardMaterial color="#9aa4b0" metalness={0.2} roughness={0.35} /></mesh>
      <Halo r={0.72} on={highlight || active} color={active ? '#2f80ff' : '#ffc53d'} />
      {hov && !active && <Html center zIndexRange={[3, 1]} position={[0, 0, 2.2]} style={tag('#14213d')}>Lift {l.id}</Html>}
    </group>
  );
}

// Lifts grouped into banks (cars sharing a row) with ONE green sign per bank.
function LiftBanks({ floor, activeCore, highlight, onClick }) {
  const banks = useMemo(() => {
    const m = new Map();
    for (const l of lifts.filter((x) => x.floors.includes(floor))) { const k = l.y.toFixed(2); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return [...m.values()];
  }, [floor]);
  return (
    <group>
      {banks.map((bank, i) => {
        const cx = bank.reduce((n, l) => n + l.x, 0) / bank.length;
        return (
          <group key={i}>
            {bank.map((l) => <Lift key={l.id} l={l} active={activeCore === l.id} highlight={highlight} onClick={onClick} />)}
            <group position={[cx, bank[0].y, 0]}><Sign kind="lift" z={2.35} onClick={(e) => { e.stopPropagation(); onClick(bank[0].id); }} /></group>
          </group>
        );
      })}
    </group>
  );
}

// Escalator: brushed-metal truss and skirts, ribbed treads with yellow
// safety edges, glass balustrades with black handrails, steel landing
// plates, and chevrons gliding along the steps in the direction of travel.
function Escalator({ e, highlight, active, onClick }) {
  const [hov, setHov] = useState(false);
  const rise = 1.0, up = e.dir === 'up';
  const W = Math.min(0.95, e.w * 1.2);
  const L = Math.hypot(e.d, rise), ang = (up ? 1 : -1) * Math.atan2(rise, e.d);
  const click = (ev) => { ev.stopPropagation(); onClick(e.id); };
  const N = 14;
  const chevrons = useRef([]);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.35) % 1;
    chevrons.current.forEach((m, i) => { if (m) m.position.y = -L / 2 + (((i / 3) + t) % 1) * L; });
  });
  return (
    <group position={[e.x, e.y, 0]} onClick={click} {...hoverProps(setHov)}>
      {[-1, 1].map((s) => <mesh key={s} position={[0, s * (e.d / 2 + 0.25), 0.02]} material={steel}><boxGeometry args={[W + 0.12, 0.5, 0.04]} /></mesh>)}
      <group position={[0, 0, rise / 2 + 0.05]} rotation={[ang, 0, 0]}>
        {[-1, 1].map((s) => <mesh key={s} castShadow position={[s * (W / 2 - 0.04), 0, -0.02]} material={steel}><boxGeometry args={[0.08, L, 0.3]} /></mesh>)}
        <mesh position={[0, 0, -0.12]} material={steel}><boxGeometry args={[W, L, 0.08]} /></mesh>
        {Array.from({ length: N }, (_, i) => (
          <group key={i} position={[0, -L / 2 + (i + 0.5) * (L / N), 0.06]}>
            <mesh><boxGeometry args={[W - 0.16, L / N - 0.02, 0.03]} /><meshStandardMaterial color="#8a939e" metalness={0.2} roughness={0.45} /></mesh>
            <mesh position={[0, L / N / 2 - 0.02, 0.018]}><boxGeometry args={[W - 0.16, 0.022, 0.006]} /><meshBasicMaterial color="#f2c94c" /></mesh>
          </group>
        ))}
        {[0, 1, 2].map((i) => (
          <mesh key={i} ref={(m) => { chevrons.current[i] = m; }} position={[0, 0, 0.09]} rotation={[0, 0, up ? Math.PI / 2 : -Math.PI / 2]} geometry={chevronGeo} scale={[1.6, 1.6, 1]}>
            <meshBasicMaterial color={up ? '#0e9f4f' : '#f08a24'} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * (W / 2 - 0.05), 0, 0.36]}><boxGeometry args={[0.03, L, 0.52]} /><meshStandardMaterial color="#cfe8f5" transparent opacity={0.3} roughness={0.05} depthWrite={false} /></mesh>
            <mesh position={[s * (W / 2 - 0.05), 0, 0.64]}><boxGeometry args={[0.08, L + 0.1, 0.07]} /><meshStandardMaterial color="#1c1f24" roughness={0.4} /></mesh>
          </group>
        ))}
      </group>
      <Halo r={1.5} on={highlight || active} color={active ? '#2f80ff' : '#ffc53d'} />
      {/* one sign per up/down pair, centred between them at the far end */}
      {up && <group position={[0.5, e.d / 2 + 0.3, 0]}><Sign kind="escalator" z={2.05} onClick={click} /></group>}
      {hov && !active && <Html center zIndexRange={[3, 1]} position={[0, 0, 2.6]} style={tag('#14213d')}>Escalator {up ? '▲ up' : '▼ down'}</Html>}
    </group>
  );
}

function Stairs({ s, highlight, active, onClick }) {
  const [hov, setHov] = useState(false);
  const dirx = s.x - s.at[0], diry = s.y - s.at[1];
  const along = Math.abs(dirx) > Math.abs(diry) ? 'x' : 'y';
  const len = along === 'x' ? s.w : s.d, wid = along === 'x' ? s.d : s.w, sgn = Math.sign(along === 'x' ? dirx : diry) || 1;
  const n = 6;
  const click = (e) => { e.stopPropagation(); onClick(s.id); };
  return (
    <group position={[s.x, s.y, 0]} onClick={click} {...hoverProps(setHov)}>
      {Array.from({ length: n }, (_, i) => {
        const off = sgn * (-len / 2 + (i + 0.5) * (len / n)), h = 0.09 * (i + 1);
        const pos = along === 'x' ? [off, 0, h / 2] : [0, off, h / 2];
        const size = along === 'x' ? [len / n + 0.01, wid, h] : [wid, len / n + 0.01, h];
        return <mesh key={i} position={pos}><boxGeometry args={size} /><meshStandardMaterial color={i % 2 ? '#d3cabd' : '#ddd5c9'} roughness={0.8} /></mesh>;
      })}
      <Halo r={Math.max(s.w, s.d) * 0.6} on={highlight || active} />
      {(hov || active) && <Html center zIndexRange={[3, 1]} position={[0, 0, 1.6]} style={tag('#e8702a')}>{s.label}</Html>}
    </group>
  );
}

function Restroom({ r, highlight }) {
  return (
    <group position={[r.x, r.y, 0]}>
      <mesh castShadow position={[0, 0, 0.3]}><boxGeometry args={[r.w, r.d, 0.6]} /><meshStandardMaterial color="#cfe3ee" roughness={0.8} /></mesh>
      <Halo r={1.2} on={highlight} />
      <Sign kind="restroom" z={1.6} />
    </group>
  );
}

// --------------------------------------------------------------------------
// Route: thick blue path with a white casing, moving chevrons, start dot and
// destination pin. Drawn without depth testing so nothing can hide it.
// --------------------------------------------------------------------------
function roundCorners(route, r = 0.5) {
  if (!route || route.length < 3) return route;
  const out = [route[0]];
  for (let i = 1; i < route.length - 1; i++) {
    const [p, c, n] = [route[i - 1], route[i], route[i + 1]];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = [c[0] - ((c[0] - p[0]) / l1) * rr, c[1] - ((c[1] - p[1]) / l1) * rr];
    const b = [c[0] + ((n[0] - c[0]) / l2) * rr, c[1] + ((n[1] - c[1]) / l2) * rr];
    for (let t = 0; t <= 1.0001; t += 0.25) {
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  out.push(route[route.length - 1]);
  return out;
}

// Point + heading at distance s along a polyline.
function sampler(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  return {
    total,
    at(s) {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
      const [a, b] = [pts[i - 1], pts[i]];
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    },
  };
}


const chevronGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0.09, 0); s.lineTo(-0.06, 0.1); s.lineTo(-0.06, 0.045); s.lineTo(0.02, 0); s.lineTo(-0.06, -0.045); s.lineTo(-0.06, -0.1); s.closePath();
  return new THREE.ShapeGeometry(s);
})();

// Route: a clean blue line with a dark casing and soft glow, and faint
// chevrons flowing along it. Drawn without depth testing so nothing hides it.
function RouteLine({ route, occlude = true }) {
  const pts = useMemo(() => roundCorners(route), [route]);
  const pts3 = useMemo(() => pts.map((p) => [p[0], p[1], 0.14]), [pts]);
  const samp = useMemo(() => sampler(pts), [pts]);
  const GAP = 1.4;
  const count = Math.min(90, Math.floor(samp.total / GAP));
  const refs = useRef([]);
  useFrame(({ clock }) => {
    const shift = (clock.elapsedTime * 0.9) % GAP;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const p = samp.at(Math.min(samp.total, 0.4 + i * GAP + shift));
      m.position.set(p.x, p.y, 0.16);
      m.rotation.z = p.ang;
    });
  });
  const common = { depthTest: occlude, depthWrite: false, transparent: true };
  return (
    <group>
      <Line points={pts3} color="#2f80ff" lineWidth={14} opacity={0.18} renderOrder={ROUTE_ORDER} {...common} />
      <Line points={pts3} color="#0b1a3a" lineWidth={8} opacity={0.55} renderOrder={ROUTE_ORDER + 1} {...common} />
      <Line points={pts3} color="#2f80ff" lineWidth={5} renderOrder={ROUTE_ORDER + 2} {...common} />
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} ref={(m) => { refs.current[i] = m; }} geometry={chevronGeo} renderOrder={ROUTE_ORDER + 3}>
          <meshBasicMaterial color="#ffffff" opacity={0.75} {...common} />
        </mesh>
      ))}
    </group>
  );
}

const chip = (bg, fg = '#fff') => ({ pointerEvents: 'none', background: bg, color: fg, fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 6, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.35)' });

function StartPin({ x, y, label }) {
  const common = { depthTest: false, depthWrite: false, transparent: true };
  return (
    <group position={[x, y, 0.2]}>
      <mesh renderOrder={ROUTE_ORDER + 4}><circleGeometry args={[0.45, 32]} /><meshBasicMaterial color="#2f80ff" opacity={0.2} {...common} /></mesh>
      <mesh renderOrder={ROUTE_ORDER + 5}><circleGeometry args={[0.27, 32]} /><meshBasicMaterial color="#ffffff" {...common} /></mesh>
      <mesh renderOrder={ROUTE_ORDER + 6}><circleGeometry args={[0.19, 32]} /><meshBasicMaterial color="#2f80ff" {...common} /></mesh>
      {label && <Html center position={[0, 0, 1.0]} zIndexRange={[4, 2]} style={chip('#2f80ff')}>{label}</Html>}
    </group>
  );
}
// Where this floor's walk ends when it isn't the destination (a lift or
// escalator): a small dark marker and chip, no pin.
function TransferMarker({ x, y, label, at }) {
  const common = { depthTest: false, depthWrite: false, transparent: true };
  return (
    <group position={[x, y, 0.2]}>
      <mesh renderOrder={ROUTE_ORDER + 4}><circleGeometry args={[0.29, 32]} /><meshBasicMaterial color="#ffffff" {...common} /></mesh>
      <mesh renderOrder={ROUTE_ORDER + 5}><circleGeometry args={[0.2, 32]} /><meshBasicMaterial color="#0e9f4f" {...common} /></mesh>
      {label && <Html center position={at ? [at[0] - x, at[1] - y, 2.3 - 0.2] : [0, 0, 1.2]} zIndexRange={[4, 2]} style={{ ...chip('#0e1a2e'), border: '1px solid #0e9f4f' }}>{label}</Html>}
    </group>
  );
}
function DestPin({ x, y, label }) {
  const g = useRef();
  useFrame(({ clock }) => { if (g.current) g.current.position.z = 0.1 * Math.sin(clock.elapsedTime * 2.2); });
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0, 0.18]} renderOrder={ROUTE_ORDER + 3}><circleGeometry args={[0.36, 32]} /><meshBasicMaterial color="#e5484d" transparent opacity={0.3} depthTest={false} /></mesh>
      <group ref={g}>
        <mesh castShadow position={[0, 0, 1.75]}><sphereGeometry args={[0.36, 24, 18]} /><meshStandardMaterial color="#e5484d" roughness={0.4} /></mesh>
        <mesh position={[0, 0, 1.77]}><sphereGeometry args={[0.14, 16, 12]} /><meshBasicMaterial color="#fff" /></mesh>
        <mesh castShadow position={[0, 0, 1.22]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.31, 0.9, 24]} /><meshStandardMaterial color="#e5484d" roughness={0.4} /></mesh>
      </group>
      {label && <Html center position={[0, 0, 2.6]} zIndexRange={[4, 2]} style={chip('#e5484d')}>{label}</Html>}
    </group>
  );
}

// --------------------------------------------------------------------------
// Parking decks: zone tint, painted bay lines and numbers, accessible bays,
// the saved car, and the lift lobby. Bays are clickable to save your car.
// --------------------------------------------------------------------------
function ParkingLayer({ floor, parking, selectedSlotId, savedSlotId, onPickSlot }) {
  const { zones, slots } = parking;
  const lines = useMemo(() => {
    const pos = [];
    for (const sl of slots) {
      // Three painted sides; the side facing the aisle (nearest the door) stays open.
      const p = sl.poly;
      let open = -1, bd = Infinity;
      if (sl.door) p.forEach((a, i) => { const b = p[(i + 1) % p.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dd = Math.hypot(m[0] - sl.door[0], m[1] - sl.door[1]); if (dd < bd) { bd = dd; open = i; } });
      p.forEach((a, i) => { if (i === open) return; const b = p[(i + 1) % p.length]; pos.push(a[0], a[1], 0.03, b[0], b[1], 0.03); });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [slots]);
  useEffect(() => () => lines.dispose(), [lines]);
  const zoneShapes = useMemo(() => zones.map((z) => { const sh = new THREE.Shape(); z.poly.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath(); return { z, sh }; }), [zones]);
  return (
    <group>
      {zoneShapes.map(({ z, sh }) => (
        <mesh key={z.id} position={[0, 0, 0.006]}><shapeGeometry args={[sh]} /><meshBasicMaterial color={z.color} transparent opacity={0.1} depthWrite={false} /></mesh>
      ))}
      <lineSegments geometry={lines}><lineBasicMaterial color="#f4f4ef" /></lineSegments>
      <Line points={[...OUTLINE, OUTLINE[0]].map(([x, y]) => [x * 0.985, y * 0.995, 0.035])} color="#f5b700" lineWidth={2} transparent opacity={0.8} />
      <ParkedCars slots={slots} skipIds={[selectedSlotId, savedSlotId]} />
      <ParkingColumns floor={floor} />
      {slots.map((sl) => <Bay key={sl.id} sl={sl} selected={sl.slotId === selectedSlotId} saved={sl.slotId === savedSlotId} onPick={onPickSlot} />)}
      {zones.map((z) => (
        <mesh key={'zl' + z.id} position={[z.x, z.y, 0.02]}>
          <planeGeometry args={[2.4, 0.6]} />
          <meshBasicMaterial map={floorText(z.name.toUpperCase(), z.color, 2.4, 0.6, 800)} transparent depthWrite={false} opacity={0.75} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
function Bay({ sl, selected, saved, onPick }) {
  const p = sl.poly;
  const ang = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
  const w = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), l = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
  const fill = saved ? '#12a150' : selected ? '#2f80ff' : sl.accessible ? '#2563eb' : sl.ev ? '#0f766e' : null;
  const [hov, setHov] = useState(false);
  return (
    <group position={[sl.x, sl.y, 0]} rotation={[0, 0, ang]}
      onClick={(e) => { e.stopPropagation(); onPick?.(sl); }}
      onPointerOver={(e) => { e.stopPropagation(); setHov(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHov(false); document.body.style.cursor = 'auto'; }}>
      <mesh position={[0, 0, 0.015]}>
        <planeGeometry args={[w * 0.9, l * 0.94]} />
        <meshBasicMaterial color={fill || '#ffffff'} transparent opacity={fill ? (saved || selected ? 0.85 : 0.45) : hov ? 0.12 : 0.001} depthWrite={false} />
      </mesh>
      <mesh position={[0, -l * 0.3, 0.025]} rotation={[0, 0, Math.PI / 2]}>
        <planeGeometry args={[l * 0.34, w * 0.8]} />
        <meshBasicMaterial map={floorText(sl.code, '#ffffff', +(l * 0.34).toFixed(2), +(w * 0.8).toFixed(2), 700)} transparent depthWrite={false} opacity={0.85} toneMapped={false} />
      </mesh>
      {sl.accessible && !saved && (
        <mesh position={[0, l * 0.12, 0.025]}><planeGeometry args={[w * 0.7, w * 0.7]} /><meshBasicMaterial map={floorText('♿', '#ffffff', 0.7, 0.7, 400)} transparent depthWrite={false} toneMapped={false} /></mesh>
      )}
      {(saved || selected) && (
        <>
          <Line points={[[-w * 0.46, -l * 0.47, 0.05], [w * 0.46, -l * 0.47, 0.05], [w * 0.46, l * 0.47, 0.05], [-w * 0.46, l * 0.47, 0.05], [-w * 0.46, -l * 0.47, 0.05]]} color="#38bdf8" lineWidth={9} opacity={0.35} transparent depthTest={false} renderOrder={ROUTE_ORDER} />
          <Line points={[[-w * 0.46, -l * 0.47, 0.06], [w * 0.46, -l * 0.47, 0.06], [w * 0.46, l * 0.47, 0.06], [-w * 0.46, l * 0.47, 0.06], [-w * 0.46, -l * 0.47, 0.06]]} color="#bae6fd" lineWidth={3} depthTest={false} renderOrder={ROUTE_ORDER + 1} />
        </>
      )}
      {saved && <CarMarker l={l} />}
    </group>
  );
}
function CarMarker({ l }) {
  const g = useRef();
  useFrame(({ clock }) => { if (g.current) g.current.position.z = 1.4 + 0.12 * Math.sin(clock.elapsedTime * 2.2); });
  return (
    <group>
      <mesh position={[0, l * 0.05, 0.25]} castShadow><boxGeometry args={[0.72, 1.3, 0.42]} /><meshStandardMaterial color="#e5e7eb" roughness={0.35} metalness={0.2} /></mesh>
      <mesh position={[0, l * 0.05, 0.55]}><boxGeometry args={[0.6, 0.72, 0.3]} /><meshStandardMaterial color="#1f2937" roughness={0.2} /></mesh>
      <group ref={g}><mesh><sphereGeometry args={[0.2, 16, 12]} /><meshBasicMaterial color="#12a150" /></mesh></group>
    </group>
  );
}

// ---- Basement look: parked cars, banded columns with the deck letter, hazard bases ----
const CAR_COLOURS = ['#f4f4f2', '#f4f4f2', '#dfe2e7', '#c5c9d0', '#8d939c', '#1b1d22', '#24262d', '#1f3b7a', '#8c2a2a', '#d9dce1'];
const hash01 = (str, k = 0) => { let h = 2166136261 ^ k; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

function ParkedCars({ slots, skipIds = [] }) {
  const cars = useMemo(() => {
    const out = [];
    for (const sl of slots) {
      if (skipIds.includes(sl.slotId) || hash01(sl.slotId, 7) < 0.34) continue;           // about two bays in three are taken
      const p = sl.poly;
      const ang = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
      const w = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), l = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
      out.push({ x: sl.x, y: sl.y, ang, w, l, c: CAR_COLOURS[Math.floor(hash01(sl.slotId, 3) * CAR_COLOURS.length)], flip: hash01(sl.slotId, 11) < 0.5 ? 1 : -1 });
    }
    return out;
  }, [slots, skipIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const refs = { body: useRef(), glass: useRef(), roof: useRef(), wheel: useRef() };
  useEffect(() => {
    const o = new THREE.Object3D(), col = new THREE.Color();
    const put = (mesh, i, c, lx, ly, lz, sx, sy, sz, rotX = 0) => {
      o.position.set(c.x, c.y, 0); o.rotation.set(0, 0, c.ang); o.updateMatrix();
      const base = o.matrix.clone();
      const loc = new THREE.Object3D(); loc.position.set(lx, ly * c.flip, lz); loc.scale.set(sx, sy, sz); loc.rotation.set(rotX, 0, 0); loc.updateMatrix();
      mesh.setMatrixAt(i, base.multiply(loc.matrix));
    };
    cars.forEach((c, i) => {
      put(refs.body.current, i, c, 0, 0, 0.2, c.w * 0.72, c.l * 0.86, 0.26);
      put(refs.glass.current, i, c, 0, -c.l * 0.03, 0.43, c.w * 0.62, c.l * 0.46, 0.2);
      put(refs.roof.current, i, c, 0, -c.l * 0.03, 0.54, c.w * 0.6, c.l * 0.38, 0.05);
      refs.body.current.setColorAt(i, col.set(c.c)); refs.roof.current.setColorAt(i, col.set(c.c));
      [[-1, 0.29], [1, 0.29], [-1, -0.29], [1, -0.29]].forEach(([sx, sy], k) => {
        const m = refs.wheel.current, j = i * 4 + k;
        o.position.set(c.x, c.y, 0); o.rotation.set(0, 0, c.ang); o.updateMatrix();
        const loc = new THREE.Object3D(); loc.position.set(sx * c.w * 0.36, sy * c.l * c.flip, 0.1); loc.rotation.set(0, 0, Math.PI / 2); loc.updateMatrix();
        m.setMatrixAt(j, o.matrix.clone().multiply(loc.matrix));
      });
    });
    for (const r of Object.values(refs)) if (r.current) { r.current.instanceMatrix.needsUpdate = true; if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true; }
  }, [cars]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cars.length) return null;
  const n = cars.length, key = 'cars' + n;
  return (
    <group raycast={noRay}>
      <instancedMesh key={key + 'b'} ref={refs.body} args={[null, null, n]} castShadow raycast={noRay}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.45} /></instancedMesh>
      <instancedMesh key={key + 'g'} ref={refs.glass} args={[null, null, n]} raycast={noRay}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#141a24" roughness={0.1} metalness={0.7} /></instancedMesh>
      <instancedMesh key={key + 'r'} ref={refs.roof} args={[null, null, n]} raycast={noRay}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.45} /></instancedMesh>
      <instancedMesh key={key + 'w'} ref={refs.wheel} args={[null, null, n * 4]} raycast={noRay}><cylinderGeometry args={[0.1, 0.1, 0.09, 12]} /><meshStandardMaterial color="#0c0d10" roughness={0.9} /></instancedMesh>
    </group>
  );
}

function ParkingColumns({ floor }) {
  const spots = useMemo(() => {
    const out = [], segs = walkwaySegments(floor);
    const clear = (x, y) => segs.every(([a, b]) => {
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2));
      return Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1]))) > 1.3;
    });
    for (let y = -22; y <= 20; y += 4.5) for (const x of [-4.5, 3.4]) if (insideOutline(x, y) && clear(x, y)) out.push([x, y]);
    return out;
  }, [floor]);
  const tex = useMemo(() => floorText(floor, '#ffffff', 0.4, 0.4, 900), [floor]);
  return (
    <group raycast={noRay}>
      {spots.map(([x, y], i) => (
        <group key={i} position={[x, y, 0]}>
          <mesh castShadow position={[0, 0, 0.8]}><boxGeometry args={[0.42, 0.42, 1.6]} /><meshStandardMaterial color="#cfd4dc" roughness={0.55} /></mesh>
          <mesh position={[0, 0, 1.62]}><boxGeometry args={[0.52, 0.52, 0.08]} /><meshStandardMaterial color="#9aa1ad" roughness={0.5} /></mesh>
          <mesh position={[0, 0, 0.95]}><boxGeometry args={[0.45, 0.45, 0.46]} /><meshStandardMaterial color="#1e4fa8" roughness={0.45} /></mesh>
          {[[0, -0.226, 0], [0, 0.226, Math.PI], [0.226, 0, Math.PI / 2], [-0.226, 0, -Math.PI / 2]].map(([px, py, rz], k) => (
            <mesh key={k} position={[px, py, 0.95]} rotation={[Math.PI / 2, rz, 0]}><planeGeometry args={[0.36, 0.36]} /><meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} /></mesh>
          ))}
          <mesh position={[0, 0, 0.07]}><boxGeometry args={[0.54, 0.54, 0.14]} /><meshStandardMaterial color="#f5b700" roughness={0.6} /></mesh>
          <mesh position={[0, 0, 0.13]}><boxGeometry args={[0.55, 0.55, 0.035]} /><meshStandardMaterial color="#15161a" roughness={0.7} /></mesh>
          <mesh position={[0.62, 0, 1.25]}><boxGeometry args={[0.9, 0.05, 0.05]} /><meshBasicMaterial color="#e8f6ff" toneMapped={false} /></mesh>
        </group>
      ))}
    </group>
  );
}
function LiftLobby() {
  const xs = lifts.map((l) => l.x), ys = lifts.map((l) => l.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 0.9, Math.max(...xs) + 0.9, Math.min(...ys) - 0.9, Math.max(...ys) + 0.9];
  const tile = useMemo(() => tileTexture('#d8d4cb', 'rgba(90,80,60,.18)', [4, 3]), []);
  return (
    <group>
      <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, 0.008]}><planeGeometry args={[x1 - x0, y1 - y0]} /><meshStandardMaterial map={tile} roughness={0.4} /></mesh>
      <mesh position={[(x0 + x1) / 2, y1 + 0.35, 0.02]}>
        <planeGeometry args={[3.2, 0.55]} /><meshBasicMaterial map={floorText('LIFT LOBBY', '#f2c94c', 3.2, 0.55, 800)} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// "You are here": pulsing blue dot that follows FROM. Kept mounted and
// toggled, since unmounting drei <Html> on a floor switch throws in React 19.
function YouAreHere({ point, label = 'You are here' }) {
  const ring = useRef();
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = (clock.elapsedTime % 1.6) / 1.6;
    ring.current.scale.setScalar(0.6 + t * 1.2);
    ring.current.material.opacity = 0.45 * (1 - t);
  });
  const common = { depthTest: false, depthWrite: false, transparent: true };
  const [x, y] = point || [0, 0];
  return (
    <group position={[x, y, 0.22]} visible={!!point}>
      <mesh ref={ring} renderOrder={ROUTE_ORDER + 4}><circleGeometry args={[0.7, 40]} /><meshBasicMaterial color="#2f80ff" opacity={0.4} {...common} /></mesh>
      <mesh renderOrder={ROUTE_ORDER + 5}><circleGeometry args={[0.3, 32]} /><meshBasicMaterial color="#ffffff" {...common} /></mesh>
      <mesh renderOrder={ROUTE_ORDER + 6}><circleGeometry args={[0.22, 32]} /><meshBasicMaterial color="#2f80ff" {...common} /></mesh>
      <Html center position={[0, 0, 1.1]} zIndexRange={[4, 2]} style={{ ...chip('#2f80ff'), display: point && label ? 'block' : 'none' }}>{label}</Html>
    </group>
  );
}


// --------------------------------------------------------------------------
// The panda guide, the lift cabin and the lift doorway. Everything is built
// from primitives (no model files), so it stays light on phones.
// --------------------------------------------------------------------------
const PANDA_WHITE = new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.85 });
const PANDA_BLACK = new THREE.MeshStandardMaterial({ color: '#18181c', roughness: 0.65 });
const PANDA_CHEEK = new THREE.MeshBasicMaterial({ color: '#ffb3b8', transparent: true, opacity: 0.55 });
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => { const k = clamp01(t); return k * k * (3 - 2 * k); };

function usePandaRig() {
  return { body: useRef(), head: useRef(), armL: useRef(), armR: useRef(), legL: useRef(), legR: useRef() };
}
// Walk cycle (moving) or a calm idle with a slow look-around (standing).
function animatePanda(r, t, moving, gait = 1) {
  const w = 11.5 * gait;
  const s = moving ? Math.sin(t * w) : 0;
  if (r.legL.current) r.legL.current.rotation.x = s * 0.75;
  if (r.legR.current) r.legR.current.rotation.x = -s * 0.75;
  if (r.armL.current) r.armL.current.rotation.x = -s * 0.65;
  if (r.armR.current) r.armR.current.rotation.x = s * 0.65;
  if (r.body.current) {
    r.body.current.position.y = moving ? Math.abs(Math.cos(t * w)) * 0.04 : Math.sin(t * 2.1) * 0.008;
    r.body.current.rotation.y = moving ? s * 0.08 : 0;
  }
  if (r.head.current) {
    r.head.current.rotation.y = moving ? 0 : Math.sin(t * 0.7) * 0.4;
    r.head.current.rotation.x = moving ? 0 : Math.sin(t * 0.9 + 1) * 0.06;
  }
}

// Y-up model (face = +Z) wrapped so it stands in the Z-up world, face along +Y.
function PandaModel({ rig }) {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <group ref={rig.body}>
        <mesh castShadow material={PANDA_WHITE} position={[0, 0.56, 0]} scale={[1, 1.08, 0.9]}><sphereGeometry args={[0.27, 24, 18]} /></mesh>
        <mesh material={PANDA_BLACK} position={[0, 0.72, 0]} scale={[1.03, 0.26, 0.93]}><sphereGeometry args={[0.27, 24, 12]} /></mesh>
        <mesh material={PANDA_WHITE} position={[0, 0.42, -0.25]}><sphereGeometry args={[0.06, 12, 10]} /></mesh>
        <group ref={rig.head} position={[0, 0.98, 0]}>
          <mesh castShadow material={PANDA_WHITE} scale={[1.15, 0.95, 1]}><sphereGeometry args={[0.24, 24, 18]} /></mesh>
          <mesh material={PANDA_BLACK} position={[-0.19, 0.2, -0.02]}><sphereGeometry args={[0.078, 14, 12]} /></mesh>
          <mesh material={PANDA_BLACK} position={[0.19, 0.2, -0.02]}><sphereGeometry args={[0.078, 14, 12]} /></mesh>
          <mesh material={PANDA_BLACK} position={[-0.1, 0.03, 0.19]} rotation={[0, 0, 0.55]} scale={[0.8, 1.25, 0.45]}><sphereGeometry args={[0.07, 14, 12]} /></mesh>
          <mesh material={PANDA_BLACK} position={[0.1, 0.03, 0.19]} rotation={[0, 0, -0.55]} scale={[0.8, 1.25, 0.45]}><sphereGeometry args={[0.07, 14, 12]} /></mesh>
          <mesh material={PANDA_WHITE} position={[-0.098, 0.045, 0.232]}><sphereGeometry args={[0.02, 10, 8]} /></mesh>
          <mesh material={PANDA_WHITE} position={[0.098, 0.045, 0.232]}><sphereGeometry args={[0.02, 10, 8]} /></mesh>
          <mesh material={PANDA_BLACK} position={[-0.098, 0.045, 0.246]}><sphereGeometry args={[0.011, 8, 6]} /></mesh>
          <mesh material={PANDA_BLACK} position={[0.098, 0.045, 0.246]}><sphereGeometry args={[0.011, 8, 6]} /></mesh>
          <mesh material={PANDA_BLACK} position={[0, -0.03, 0.243]} scale={[1.4, 0.9, 1]}><sphereGeometry args={[0.032, 12, 10]} /></mesh>
          <mesh material={PANDA_CHEEK} position={[-0.16, -0.05, 0.17]} scale={[1, 0.7, 0.3]}><sphereGeometry args={[0.04, 10, 8]} /></mesh>
          <mesh material={PANDA_CHEEK} position={[0.16, -0.05, 0.17]} scale={[1, 0.7, 0.3]}><sphereGeometry args={[0.04, 10, 8]} /></mesh>
        </group>
        <group ref={rig.armL} position={[-0.3, 0.74, 0]}>
          <mesh castShadow material={PANDA_BLACK} position={[0, -0.14, 0.02]} rotation={[0, 0, 0.12]}><capsuleGeometry args={[0.07, 0.2, 6, 10]} /></mesh>
        </group>
        <group ref={rig.armR} position={[0.3, 0.74, 0]}>
          <mesh castShadow material={PANDA_BLACK} position={[0, -0.14, 0.02]} rotation={[0, 0, -0.12]}><capsuleGeometry args={[0.07, 0.2, 6, 10]} /></mesh>
        </group>
        <group ref={rig.legL} position={[-0.12, 0.34, 0]}>
          <mesh castShadow material={PANDA_BLACK} position={[0, -0.14, 0.02]}><capsuleGeometry args={[0.088, 0.14, 6, 10]} /></mesh>
        </group>
        <group ref={rig.legR} position={[0.12, 0.34, 0]}>
          <mesh castShadow material={PANDA_BLACK} position={[0, -0.14, 0.02]}><capsuleGeometry args={[0.088, 0.14, 6, 10]} /></mesh>
        </group>
      </group>
    </group>
  );
}

// The doors of the REAL lift car (no extra structure): they open on the face
// that looks at the walkway, light up inside, and the guide steps out of them.
const LIFT_HALF = 0.46;                  // half-size of the lift box drawn by <Lift>
const DOOR_H = 1.3;
const liftFrame = new THREE.MeshStandardMaterial({ color: '#262b33', metalness: 0.2, roughness: 0.5 });
const liftDoorMat = new THREE.MeshStandardMaterial({ color: '#8b95a1', metalness: 0.25, roughness: 0.45 });
const liftGlow = new THREE.MeshBasicMaterial({ color: '#ffe7ae' });
const lampOn = new THREE.MeshBasicMaterial({ color: '#27c46b' });
export function liftFaceAngle(core, point) {
  const dx = point[0] - core[0], dy = point[1] - core[1];
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : Math.PI) : (dy >= 0 ? Math.PI / 2 : -Math.PI / 2);
}
function LiftExitDoors({ exit, phase }) {
  const left = useRef(), right = useRef(), glow = useRef();
  const phaseStart = useRef(performance.now());
  useEffect(() => { phaseStart.current = performance.now(); }, [phase]);
  useFrame(() => {
    const el = performance.now() - phaseStart.current;
    const open = phase === 'exit' ? smooth((el - 350) / 800)
      : phase === 'ready' ? 1
      : 1 - smooth((el - 1500) / 900);          // walking away: the doors close behind you
    const sc = Math.max(0.04, 1 - open * 0.96);   // each leaf retracts into its pocket
    if (left.current) left.current.scale.y = sc;
    if (right.current) right.current.scale.y = sc;
    if (glow.current) glow.current.visible = open > 0.03;
  });
  if (!exit?.point || !exit.core) return null;
  const [cx, cy] = exit.core;
  const x = LIFT_HALF + 0.004;
  return (
    <group position={[cx, cy, 0]} rotation={[0, 0, liftFaceAngle(exit.core, exit.point)]}>
      <mesh ref={glow} material={liftGlow} position={[x + 0.004, 0, 0.05 + DOOR_H / 2]}><boxGeometry args={[0.01, 0.74, DOOR_H]} /></mesh>
      <group ref={left} position={[x + 0.018, -0.37, 0.05]}><mesh material={liftDoorMat} position={[0, 0.185, DOOR_H / 2]}><boxGeometry args={[0.03, 0.37, DOOR_H]} /></mesh></group>
      <group ref={right} position={[x + 0.018, 0.37, 0.05]}><mesh material={liftDoorMat} position={[0, -0.185, DOOR_H / 2]}><boxGeometry args={[0.03, 0.37, DOOR_H]} /></mesh></group>
      <mesh material={liftFrame} position={[x + 0.02, -0.395, 0.05 + DOOR_H / 2]}><boxGeometry args={[0.045, 0.05, DOOR_H + 0.06]} /></mesh>
      <mesh material={liftFrame} position={[x + 0.02, 0.395, 0.05 + DOOR_H / 2]}><boxGeometry args={[0.045, 0.05, DOOR_H + 0.06]} /></mesh>
      <mesh material={liftFrame} position={[x + 0.02, 0, 0.05 + DOOR_H + 0.04]}><boxGeometry args={[0.045, 0.84, 0.07]} /></mesh>
      <mesh material={lampOn} position={[x + 0.046, 0, 0.05 + DOOR_H + 0.04]}><boxGeometry args={[0.01, 0.14, 0.03]} /></mesh>
    </group>
  );
}

// The guide in the mall. `moving` = walking animation, otherwise standing.
// While `phase === 'exit'` it walks out of the lift car `exitFrom` onto the path.
function GuideCharacter({ pose, phase = 'walk', visible = true, moving = true, exitFrom = null, speed = 1, big = false }) {
  const group = useRef();
  const rig = usePandaRig();
  const phaseStart = useRef(performance.now());
  const [labelOn, setLabelOn] = useState(true);
  const labelRef = useRef(true);
  useEffect(() => { phaseStart.current = performance.now(); }, [phase]);
  const [x, y] = pose?.point || [0, 0];
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    let heading = pose?.heading || 0;
    let px = x, py = y, walking = phase === 'walk' && moving;
    let hidden = false;
    if (phase === 'exit' && exitFrom) {
      // Doors open first; then the guide walks from inside the car to the first path point.
      const k = clamp01((performance.now() - phaseStart.current - 1100) / 1500), e = smooth(k);
      px = exitFrom[0] + (x - exitFrom[0]) * e; py = exitFrom[1] + (y - exitFrom[1]) * e;
      const move = Math.atan2(y - exitFrom[1], x - exitFrom[0]);
      heading = move + angleDiff(heading, move) * smooth((k - 0.65) / 0.35);
      walking = k > 0 && k < 1;
      hidden = k <= 0;                                   // still inside the closed car
    }
    group.current.position.set(px, py, 0.12);
    group.current.scale.setScalar(big ? 2.4 : 1);   // seen from above the guide has to be easy to spot
    group.current.rotation.z = heading + Math.PI / 2;
    animatePanda(rig, t, walking, 1 + (speed - 1) * 0.28);
    if (labelRef.current === hidden) { labelRef.current = !hidden; setLabelOn(!hidden); }
  });
  return (
    <group ref={group} visible={visible} renderOrder={ROUTE_ORDER + 20}>
      <PandaModel rig={rig} />
      <Html center position={[0, 0, 1.5]} zIndexRange={[9, 7]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', display: visible && labelOn ? 'block' : 'none' }}>
        {phase === 'walk' && moving
          ? <div className="followMe" role="status"><span>Follow me</span><i aria-hidden="true">›››</i></div>
          : <div className="guideTag">🐼 Navi</div>}
      </Html>
    </group>
  );
}

// --------------------------------------------------------------------------
// Inside the lift. The cabin is built far from the mall (CABIN_ORIGIN); the
// camera teleports in while the guide stands, the doors close and the floor
// counter runs from `from` to `to`.
// --------------------------------------------------------------------------
const CAB = { W: 3.6, D: 3.6, H: 2.8, doorW: 1.6, doorH: 2.2 };
const cabWall = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.15, roughness: 0.45 });
const cabWallLow = new THREE.MeshStandardMaterial({ color: '#8d949e', metalness: 0.2, roughness: 0.45 });
const cabCeil = new THREE.MeshStandardMaterial({ color: '#eceef1', roughness: 0.8 });
const cabFloor = new THREE.MeshStandardMaterial({ color: '#34373e', roughness: 0.35, metalness: 0.1 });
const cabinGlow = new THREE.MeshBasicMaterial({ color: '#fff6dc' });
const cabDoor = new THREE.MeshStandardMaterial({ color: '#9ea6b1', metalness: 0.1, roughness: 0.7 });
const cabRail = new THREE.MeshStandardMaterial({ color: '#e7ebf0', metalness: 0.5, roughness: 0.25 });
const lobbyWall = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.9 });

function displayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (label, dir) => {
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0d12'; c.fillRect(0, 0, 256, 96);
    c.fillStyle = '#ff8a1f'; c.font = '800 62px ui-monospace, Menlo, Consolas, monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, 148, 52);
    c.font = '800 40px sans-serif';
    c.fillText(dir > 0 ? '▲' : dir < 0 ? '▼' : '', 40, 52);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

function LiftCabin({ from, to, phase }) {
  const [ox, oy] = CABIN_ORIGIN;
  const rig = usePandaRig();
  const panda = useRef(), dl = useRef(), dr = useRef(), shake = useRef();
  const phaseStart = useRef(performance.now());
  useEffect(() => { phaseStart.current = performance.now(); }, [phase]);
  const disp = useMemo(displayTexture, []);
  const shown = useRef(null);
  const fromI = FLOORS.findIndex((f) => f[0] === from), toI = FLOORS.findIndex((f) => f[0] === to);
  const { W, D, H, doorW, doorH } = CAB;
  const pocket = (W - doorW) / 2, half = doorW / 4;
  useFrame(({ clock }) => {
    const el = performance.now() - phaseStart.current;
    let open, idx = fromI, dir = 0;
    if (phase === 'ride') {
      open = 0;
      const k = clamp01(el / RIDE_MS);
      idx = Math.round(fromI + (toI - fromI) * k); dir = Math.sign(toI - fromI);
      if (shake.current) { shake.current.position.z = Math.sin(el * 0.05) * 0.004 * (k < 0.15 || k > 0.85 ? 0.4 : 1); }
    } else {
      open = 1 - smooth((el - 300) / 850);        // you step in, the doors slide shut
    }
    const label = FLOORS[Math.max(0, Math.min(FLOORS.length - 1, idx))][0];
    const sig = `${label}|${dir}`;
    if (shown.current !== sig) { shown.current = sig; disp.draw(label, dir); }
    if (dl.current) dl.current.position.x = -half - open * doorW / 2;
    if (dr.current) dr.current.position.x = half + open * doorW / 2;
    animatePanda(rig, clock.elapsedTime, false);
  });
  useEffect(() => () => disp.tex.dispose(), [disp]);
  const btns = FLOORS.map((f, i) => ({ code: f[0], x: i % 2 ? 0.1 : -0.1, z: 1.5 - Math.floor(i / 2) * 0.17 }));
  return (
    <group position={[ox, oy, 0]}>
      <pointLight position={[0, 0, H - 0.35]} intensity={3.2} distance={8} decay={1.6} color="#fff3d6" />
      <group ref={shake}>
        {/* floor, ceiling and a lit ceiling panel */}
        <mesh material={cabFloor} position={[0, 0, -0.025]}><boxGeometry args={[W, D, 0.05]} /></mesh>
        <mesh material={cabCeil} position={[0, 0, H + 0.025]}><boxGeometry args={[W, D, 0.05]} /></mesh>
        <mesh material={cabinGlow} position={[0, 0, H - 0.01]}><boxGeometry args={[1.5, 1.5, 0.02]} /></mesh>
        {/* back and side walls, two-tone with a handrail */}
        {[[0, -D / 2, 0], [-W / 2, 0, -Math.PI / 2], [W / 2, 0, Math.PI / 2]].map(([x, y, r], i) => (
          <group key={i} position={[x, y, 0]} rotation={[0, 0, r]}>
            <mesh material={cabWallLow} position={[0, 0, 0.5]}><boxGeometry args={[W, 0.05, 1.0]} /></mesh>
            <mesh material={cabWall} position={[0, 0.003, 1.8]}><boxGeometry args={[W, 0.05, 1.6]} /></mesh>
            <mesh material={cabRail} position={[0, 0.09, 1.0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.025, 0.025, W - 0.4, 10]} /></mesh>
          </group>
        ))}
        {/* front wall: pockets, header with the floor display, two sliding doors */}
        <mesh material={cabWall} position={[-(W / 2 - pocket / 2), D / 2, doorH / 2]}><boxGeometry args={[pocket, 0.12, doorH]} /></mesh>
        <mesh material={cabWall} position={[(W / 2 - pocket / 2), D / 2, doorH / 2]}><boxGeometry args={[pocket, 0.12, doorH]} /></mesh>
        <mesh material={cabWall} position={[0, D / 2, doorH + (H - doorH) / 2]}><boxGeometry args={[W, 0.12, H - doorH]} /></mesh>
        <mesh position={[0, D / 2 - 0.07, doorH + 0.3]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[1.1, 0.4]} /><meshBasicMaterial map={disp.tex} toneMapped={false} /></mesh>
        <mesh ref={dl} material={cabDoor} position={[-half, D / 2 - 0.02, doorH / 2]}><boxGeometry args={[doorW / 2, 0.05, doorH]} /></mesh>
        <mesh ref={dr} material={cabDoor} position={[half, D / 2 - 0.02, doorH / 2]}><boxGeometry args={[doorW / 2, 0.05, doorH]} /></mesh>
        {/* a bright lobby behind the doors, visible while they are open */}
        <mesh material={lobbyWall} position={[0, D / 2 + 1.6, 1.3]}><boxGeometry args={[W + 2, 0.1, 2.6]} /></mesh>
        <mesh material={cabFloor} position={[0, D / 2 + 0.8, -0.025]}><boxGeometry args={[W, 1.6, 0.05]} /></mesh>
        {/* button panel on the right wall: the chosen floor lights up */}
        <group position={[W / 2 - 0.06, 0.95, 0]}>
          <mesh material={cabRail} position={[0, 0, 1.25]}><boxGeometry args={[0.03, 0.42, 0.95]} /></mesh>
          {btns.map((b) => (
            <mesh key={b.code} position={[-0.03, b.x, b.z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.04, 0.04, 0.02, 14]} />
              <meshStandardMaterial color={b.code === to && phase === 'ride' ? '#ffb02e' : '#2a2d33'} emissive={b.code === to && phase === 'ride' ? '#ff8a00' : '#000000'} emissiveIntensity={1.2} />
            </mesh>
          ))}
        </group>
        {/* the guide, standing in the middle, facing the doors (+Y) */}
        <group ref={panda} position={[0, 0.15, 0.05]} rotation={[0, 0, Math.PI]}>
          <PandaModel rig={rig} />
        </group>
      </group>
    </group>
  );
}

// --------------------------------------------------------------------------
const Scene = forwardRef(function Scene({
  floor, storesList, parking, route, destId, onPick, onPickSlot, onLift, onCore, activeCore,
  highlightType, viewMode, cam, theme = 'dark', destLabel, destAt, startLabel,
  isMobile = false, offerIds, selectedId, youAreHere, youLabel, pin, colourMode = 'neutral', selectedSlotId, savedSlotId, walkPose, guidePhase = 'walk', stepGuidePose = null, navigating = false, arrived = false,
  liftTrip = null, liftExit = null, guideMoving = false, guideSpeed = 1, hunt = null,
}, ref) {
  const escHere = escalatorFloors.includes(floor);
  const parkingFloor = isParking(floor);
  const streetClear = !!cam?.roam;
  // Street / front view: an escalator beside the eye or in the line of sight is hidden, so the
  // shopfront and the walkway stay clear (the map still shows it from every other view).
  const escInTheWay = (e) => {
    if (!streetClear || !cam?.point) return false;
    const r = { x: e.x, y: e.y, hx: 0.62, hy: e.d / 2 + 0.55 };
    const [px, py] = cam.point;
    const nx = Math.max(r.x - r.hx, Math.min(px, r.x + r.hx)), ny = Math.max(r.y - r.hy, Math.min(py, r.y + r.hy));
    if (Math.hypot(px - nx, py - ny) < 5) return true;
    const h = cam.heading ?? 0;
    return segHitsRect([px, py], [px + Math.cos(h) * 18, py + Math.sin(h) * 18], r, 0.6);
  };                       // street / front view: no props between the eye and the shopfronts
  const pal = PALETTE[theme] || PALETTE.dark;
  useEffect(() => () => { document.body.style.cursor = 'auto'; }, [floor]);
  const dpr = isMobile ? Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2) : [1.5, 2];   // never below 1.5x: sharper edges and text on 1x screens
  const shadowMapSize = isMobile ? 1024 : 2048;
  const top = viewMode === '2d';
  const inCabin = cam?.mode === 'lift' && !top;
  const atExit = cam?.mode === 'exit' && !top;
  const fp = cam?.mode === 'walk' && cam.pov === 'first' && !top;
  const free = (cam?.mode === 'walk' || inCabin || atExit) && !top;
  const walking = cam?.mode === 'walk' && !top && !fp;      // third-person follow camera: zoom about the guide, not the finger
  // Drag = rotate, right-drag / two fingers = pan, wheel / pinch = zoom (like a game camera).
  // Mouse: left-drag = turn + tilt, right-drag = pan, wheel = zoom (the top plan swaps left/right so a plain drag slides the plan).
  // Touch: one finger turns (walking / street view) or pans (map); two fingers pinch to zoom and slide to turn / tilt.
  const orbit = top
    ? { mouseButtons: { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }, touches: { ONE: THREE.TOUCH.PAN, TWO: -1 } }
    : { mouseButtons: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }, touches: { ONE: free ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN, TWO: -1 } };
  const inOverview = cam?.mode === 'overview' && !top;
  const guidePose = cam?.mode === 'walk' || cam?.mode === 'exit' ? walkPose : cam?.mode === 'transit' ? stepGuidePose : (stepGuidePose || walkPose);
  const guideShown = !!(navigating && !arrived && !fp && !inCabin && (!top || cam?.mode === 'exit')
    && (((cam?.mode === 'walk' || cam?.mode === 'exit' || inOverview) && guidePose?.point) || (cam?.mode === 'transit' && stepGuidePose)));
  return (
    <Canvas shadows flat dpr={dpr} camera={{ position: [0, -30, 24], fov: FOV_Y_DEG, up: UP, near: 0.3, far: 300 }} gl={{ antialias: true }}>
      <color attach="background" args={[pal.bg]} />
      <hemisphereLight args={['#ffffff', '#c3ccd8', pal.hemi]} />
      <directionalLight castShadow position={[-12, -16, 40]} intensity={pal.sun}
        shadow-mapSize-width={shadowMapSize} shadow-mapSize-height={shadowMapSize} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={4}
        shadow-camera-left={BOUNDS.minX - 2} shadow-camera-right={BOUNDS.maxX + 2} shadow-camera-top={BOUNDS.maxY + 8} shadow-camera-bottom={BOUNDS.minY - 8} />
      <CameraRig cam={cam} viewMode={viewMode} isMobile={isMobile} apiRef={ref} />
      <PanLimit disabled={inCabin} />

      <Slab floor={floor} pal={pal} />
      <Walkways floor={floor} stores={storesList} pal={pal} />
      <Atrium floor={floor} pal={pal} clear={streetClear} />
      {!streetClear && <Decor floor={floor} route={route} />}
      <Props floor={floor} clear={streetClear} />
      <Gardens floor={floor} />
      {parkingFloor && <LiftLobby />}
      {parkingFloor && parking && <ParkingLayer floor={floor} parking={parking} selectedSlotId={selectedSlotId} savedSlotId={savedSlotId} onPickSlot={onPickSlot} />}

      {storesList.map((d) => (
        <Store key={d.id} d={d} active={destId === d.id} selected={selectedId === d.id} onPick={onPick} fp={fp} clear={streetClear}
          highlight={highlightType === 'store'} hasOffer={offerIds?.has(d.storeId)} pal={pal} colourMode={colourMode}
          hunt={hunt && d.storeId ? (hunt.found === d.storeId ? 'found' : hunt.picked.has(d.storeId) ? 'picked' : hunt.candidates.has(d.storeId) ? 'cand' : null) : null} />
      ))}
      <LiftBanks floor={floor} activeCore={activeCore} highlight={highlightType === 'lift'} onClick={onLift} />
      {escHere && escalators.map((e) => (
        <group key={e.id} visible={!escInTheWay(e)}><Escalator e={e} highlight={highlightType === 'escalator'} active={activeCore === e.id} onClick={(id) => onCore?.('escalator', id)} /></group>
      ))}
      {stairs.filter((st) => st.floor === floor).map((st) => (
        <Stairs key={st.id} s={st} highlight={highlightType === 'stairs'} active={activeCore === st.id} onClick={(id) => onCore?.('stairs', id)} />
      ))}
      {!parkingFloor && restrooms.filter((r) => r.floor === floor).map((r) => <Restroom key={r.id} r={r} highlight={highlightType === 'restroom'} />)}

      {/* Kept mounted on every floor and only hidden: unmounting a drei <Html>
          on a floor switch throws a React 19 removeChild error. */}
      {entrances.map((e, i) => {
        const o = { W: [-1.4, 0], E: [1.4, 0], S: [0, -1.4], N: [0, 1.4] }[e.side] || [0, 0];
        return (
          <Html key={'ent' + i} center position={[e.x + o[0], e.y + o[1], 0.2]} zIndexRange={[2, 0]} style={{ display: floor === e.floor ? 'block' : 'none', pointerEvents: 'none', background: '#0e9f4f', color: '#fff', fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 8, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.3)' }}>
            {e.name}
          </Html>
        );
      })}

      <YouAreHere point={youAreHere} label={youLabel} />
      {/* Keep the mascot mounted across walk/transit transitions. React 19 + drei
          <Html> can throw removeChild when this subtree is conditionally mounted
          while the Canvas scene is reconciling. Visibility is safer than unmounting. */}
      <GuideCharacter
        pose={guidePose}
        phase={guidePhase}
        moving={guideMoving}
        speed={guideSpeed}
        exitFrom={liftExit?.core || null}
        big={top}
        visible={guideShown}
      />
      {navigating && !arrived && liftExit?.point && liftExit.floor === floor && !top && <LiftExitDoors exit={liftExit} phase={guidePhase} />}
      {inCabin && <LiftCabin from={liftTrip?.from} to={liftTrip?.to} phase={guidePhase} />}
      {!route && pin && <DestPin x={pin.x} y={pin.y} label={pin.label} />}
      {route && <RouteLine route={route} />}
      {route && startLabel && <StartPin x={route[0][0]} y={route[0][1]} label={startLabel} />}
      {route && (destId
        ? <DestPin x={route.at(-1)[0]} y={route.at(-1)[1]} label={destLabel} />
        : <TransferMarker x={route.at(-1)[0]} y={route.at(-1)[1]} label={destLabel} at={destAt} />)}

      <MapControls makeDefault enabled={!fp} enableDamping dampingFactor={0.12} screenSpacePanning={false} {...orbit}
        enablePan={!inCabin}
        minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity}
        minPolarAngle={inCabin ? 1.05 : 0.02} maxPolarAngle={inCabin ? 1.75 : 1.45}
        minDistance={inCabin ? 1.0 : atExit ? 2 : walking ? WALK_MIN_DIST : 6} maxDistance={inCabin ? 1.6 : walking ? WALK_MAX_DIST : 120} zoomToCursor={!inCabin && !walking} />
    </Canvas>
  );
});

export default Scene;
