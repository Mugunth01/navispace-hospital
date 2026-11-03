// Pure camera math, deliberately kept out of the R3F render layer so it can be
// unit-tested without a WebGL context.
//
// IMPORTANT: the scene is authored Z-UP — the floor plate lies in the XY plane
// and every height is a z offset. three.js defaults camera.up to (0,1,0), which
// silently made OrbitControls measure its polar angle from the wrong axis; the
// 2D and Walk presets were clamped to angles unrelated to the views they are
// named after. Everything below assumes, and Scene.jsx enforces, up = +Z.

export const UP = [0, 0, 1];

// Rotation about the atrium's vertical axis is clamped to ±60°. Azimuth 0 is
// the south/front elevation, so the usable arc is front-left to front-right.
export const AZIMUTH_LIMIT = Math.PI / 3;

const DEG = Math.PI / 180;

// Polar angle measured from +Z: 0 = straight down, 90° = horizontal eye level.
export const PRESETS = {
  // "standard straight view" — low and head-on, not a top-down plan.
  // 52° reads like the reference render: high enough to see every walkway,
  // low enough that shop blocks, lifts and escalators read as 3D.
  straight: { polar: 42 * DEG, dist: 40 },
  walk: { polar: 76 * DEG, dist: 14 },
  top: { polar: 0.0001, dist: 82 },
};

export function presetName(viewMode, walkView) {
  if (viewMode === '2d') return 'top';
  if (walkView) return 'walk';
  return 'straight';
}

// Camera position for a preset, placed on the -Y (front) side of the focus
// point so that it sits at azimuth 0, the centre of the allowed rotation arc.
// `distOverride` (e.g. from fitCameraDistance) replaces the preset's fixed
// distance while keeping its polar angle — used on mobile so the same named
// views (straight/walk/top) auto-fit to whatever aspect ratio the phone has.
export function cameraPosition(name, focus = { x: 0, y: 0 }, distOverride) {
  const { polar, dist } = PRESETS[name];
  const d = distOverride ?? dist;
  return [focus.x, focus.y - d * Math.sin(polar), d * Math.cos(polar)];
}

// Polar angle of a position about the focus point, measured from +Z, in degrees.
// This is what OrbitControls clamps against once camera.up is +Z.
export function polarDegFromZ([x, y, z], focus = { x: 0, y: 0 }) {
  const dx = x - focus.x, dy = y - focus.y, dz = z;
  const r = Math.hypot(dx, dy, dz);
  return r === 0 ? 0 : Math.acos(dz / r) / DEG;
}

// Azimuth about the +Z axis, in degrees, 0 = viewing from -Y (front).
export function azimuthDeg([x, y], focus = { x: 0, y: 0 }) {
  return Math.atan2(x - focus.x, -(y - focus.y)) / DEG;
}

// --------------------------------------------------------------------------
// Auto-fit: frame a box around the focus point for the real canvas size.
// --------------------------------------------------------------------------
// Rough silhouette height including signs/lift towers, used only to keep a
// little headroom above the floor plate when the camera is looking down at
// a shallow angle (a tall thing viewed edge-on reads taller on screen).
export const BUILDING_HEIGHT = 3.2;
// Matches <Canvas camera={{ fov: 36 }}> in Scene.jsx — three.js fov is the
// *vertical* field of view.
export const FOV_Y_DEG = 32;

// Distance that fits a bounding box (halfX, halfY around the focus) fully
// inside the VISIBLE part of the canvas — a "contain" fit, so both ends of a
// route stay on screen. topInset: pixels at the top of the canvas covered by
// UI (the mobile FROM/TO card); the camera renders onto a virtual canvas that
// is that much taller (see Scene.jsx setViewOffset) so the focus sits in the
// middle of what you can actually see.
export function fitBoundsDistance({
  width, height, topInset = 0, polarRad, halfX, halfY, fill = 0.68,
  height3d = BUILDING_HEIGHT, fovYDeg = FOV_Y_DEG, minDistance = 9, maxDistance = 120,
}) {
  if (!width || !height) return 40;
  const tan = Math.tan((fovYDeg * DEG) / 2);
  const virtualH = height + topInset, visibleH = height - topInset;
  const elevation = Math.PI / 2 - polarRad;
  const apparentHalfY = halfY * Math.sin(elevation) + (height3d / 2) * Math.cos(elevation);
  const dX = (halfX * virtualH) / (width * fill * tan);
  const dY = (apparentHalfY * virtualH) / (visibleH * fill * tan);
  return Math.min(Math.max(dX, dY, minDistance), maxDistance);
}
