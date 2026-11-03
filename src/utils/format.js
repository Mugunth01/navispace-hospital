// Small display-formatting helpers shared by the mobile UI. Deliberately NOT
// routing logic — these just format numbers that App.jsx already computed
// from the real routing functions (utils/routing.js). Mirrors the one-line
// walking-time formula the desktop Sidebar already uses inline, so both UIs
// show the same estimate without a second routing implementation.
export function etaMinutes(distMetres) {
  if (!distMetres) return null;
  return Math.max(1, Math.ceil(distMetres / 55));
}

export function formatMetres(m) {
  if (!m && m !== 0) return '—';
  return `${Math.round(m)} m`;
}
