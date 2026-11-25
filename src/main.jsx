import React from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './data/api/index.js';
import '@fontsource-variable/inter';
import './style.css';

// 1. Load the hospital layout and install it (data/floors.js) before the first render.
// 2. Map labels are painted into canvas textures once, so wait (briefly) for the font.
const root = createRoot(document.getElementById('root'));
const fontReady = document.fonts?.load ? document.fonts.load("600 13px 'Inter Variable'").catch(() => {}) : Promise.resolve();
// The app code downloads in parallel with the data; nothing in it reads the
// layout until it renders, so the order of evaluation does not matter.
Promise.all([boot(), import('./App.jsx'), Promise.race([fontReady, new Promise((r) => setTimeout(r, 1200))])])
  .then(([, { default: App }]) => root.render(<App />))
  .catch((e) => {
    console.error(e);
    document.getElementById('root').innerHTML = '<p style="padding:24px;font-family:sans-serif">Could not load the hospital map. Please refresh.</p>';
  });

// A trackpad pinch over the header or tabs must not zoom the whole page (it cut off the left edge and left a
// gap under the tabs); the map handles its own zoom.
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault());
