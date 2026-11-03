// Per-viewer display preferences only. All mall data lives in Supabase.
const THEME_KEY = 'navispace_theme';

// Theme: saved choice, else dark (the reference look).
export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* storage blocked */ }
  return 'dark';
}
export function saveTheme(t) { try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ } }

// Store colouring on the map: 'neutral' (cream, the reference look) or
// 'category' (colour by store type). A per-viewer preference.
const COLOUR_KEY = 'navispace_store_colours';
export function loadColourMode() {
  try { return localStorage.getItem(COLOUR_KEY) === 'category' ? 'category' : 'neutral'; } catch { return 'neutral'; }
}
export function saveColourMode(m) { try { localStorage.setItem(COLOUR_KEY, m); } catch { /* storage blocked */ } }
