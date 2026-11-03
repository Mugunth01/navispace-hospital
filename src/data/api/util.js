// Random per-browser token that keys an anonymous parking session. Kept in
// localStorage (a per-viewer convenience); losing it only forgets the car.
const TOKEN_KEY = 'navispace_device_token';
export function deviceToken() {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t || !/^[0-9a-f-]{36}$/.test(t)) { t = uuid(); localStorage.setItem(TOKEN_KEY, t); }
    return t;
  } catch { return SESSION_TOKEN; }
}
export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
const SESSION_TOKEN = uuid();

// Calendar dates follow India time (the mall's), not UTC.
const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export const istDate = (d = new Date()) => IST.format(typeof d === 'string' ? new Date(d) : d);
