// Viewport-based mobile detection (item 30 of the mobile spec) — deliberately
// NOT navigator.userAgent, which lies constantly (desktop Chrome devtools
// device emulation, foldables, unusual tablets). matchMedia against the same
// breakpoint the CSS uses is the source of truth, and it updates live on
// resize/orientation change, not just at first render.
//
// jsdom (this project's test environment) does not implement matchMedia —
// window.matchMedia is undefined there. That is intentional and already the
// pattern used elsewhere in this codebase (see utils/storage.js loadTheme):
// treat it as "can't tell, assume desktop" rather than throwing, so the
// existing component-tree tests keep exercising the desktop UI unchanged.
import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 767;

function safeMatchMedia(query) {
  try {
    return typeof window !== 'undefined' ? window.matchMedia?.(query) ?? null : null;
  } catch {
    return null;
  }
}

// Width-only was wrong for a rotated phone (spec red-team item 26 — "Rotate
// phone: UI reorganizes without breaking"): a 375x812 portrait phone
// measures 812x375 in landscape, which is *wider* than the breakpoint, so a
// pure max-width query flipped a rotated phone straight into the desktop
// sidebar layout instead of the mobile shell's own landscape handling
// (mobile.css already has a `(max-width:767px) and (orientation:landscape)`
// rule for exactly this case — it never got a chance to apply). Matching on
// *either* axis keeps any of the spec's target phones — up to 430x932 — in
// the mobile shell in both orientations, while a normal desktop window
// (naturally wide AND tall) still resolves to the desktop UI.
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const query = `(max-width: ${breakpoint}px), (max-height: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(() => safeMatchMedia(query)?.matches ?? false);

  useEffect(() => {
    const mq = safeMatchMedia(query);
    if (!mq) return; // no matchMedia support (jsdom tests) — stay desktop
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange); // older Safari
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, [query]);

  return isMobile;
}
