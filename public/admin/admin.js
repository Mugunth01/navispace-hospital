/* NaviSpace Hospital – admin: layout editor (rooms, corridors, start points) and doctors, backed by Supabase.
   Units are map units (1 unit = 2.5 m). Rectangles are stored with their top-left corner; the plan shows north up. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SNAP = 0.2, snap = v => Math.round(v / SNAP) * SNAP;
  const r2 = v => Math.round(v * 100) / 100;

  const CATEGORIES = {
    opd: { color: "#8fd0c4", en: "Outpatient (OPD)" }, diagnostics: { color: "#94bcee", en: "Diagnostics" },
    emergency: { color: "#f2a9a2", en: "Emergency" }, services: { color: "#f6c47e", en: "Patient services" },
    pharmacy: { color: "#a8dba0", en: "Pharmacy" }, inpatient: { color: "#c9b3ea", en: "Day care & wards" },
    amenities: { color: "#eed9a6", en: "Amenities" }, restroom: { color: "#9ec9ea", en: "Restrooms" },
    lift: { color: "#7d8894", en: "Lifts" }, stairs: { color: "#f3b37a", en: "Stairs" },
    garden: { color: "#9cc98a", en: "Garden / courtyard (not routed)" }, service: { color: "#cfd3d8", en: "Service area (not routed)" },
  };
  const NOT_ROUTED = new Set(["garden", "service"]);

  const ROOM_COLS = ["code", "floor_id", "name_en", "name_ta", "category", "x", "z", "w", "d", "door_side", "door_pos", "door_width", "link_group", "keywords", "searchable"];
  const WALK_COLS = ["floor_id", "name", "x", "z", "w", "d"];
  const START_COLS = ["code", "floor_id", "kind", "name_en", "name_ta", "x", "z"];
  const DOC_COLS = ["name", "speciality", "qualification", "room_code", "days", "hours", "active", "sort"];
  const TABLES = { rooms: ROOM_COLS, walkways: WALK_COLS, start_points: START_COLS, doctors: DOC_COLS };
  const T = t => "nav_" + t;

  const svg = $("plan");
  const A = { sb: null, user: null, data: null, orig: null, floor: null, sel: null, vb: null, drag: null, confirmDel: false, mode: "layout", doc: null };

  function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000); }

  /* ---------- geometry ---------- */
  function doorInfo(r) {
    const t = r.door_pos ?? 0.5;
    if (r.door_side === "N") return { x: r.x + r.w * t, z: r.z };
    if (r.door_side === "S") return { x: r.x + r.w * t, z: r.z + r.d };
    if (r.door_side === "W") return { x: r.x, z: r.z + r.d * t };
    return { x: r.x + r.w, z: r.z + r.d * t };
  }
  const OUT = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  function doorTouchesWalkway(r) {
    if (NOT_ROUTED.has(r.category)) return true;
    const d = doorInfo(r), o = OUT[r.door_side], px = d.x + o[0] * 0.3, pz = d.z + o[1] * 0.3;
    return A.data.walkways.some(w => w.floor_id === r.floor_id && px >= w.x - 0.01 && px <= w.x + w.w + 0.01 && pz >= w.z - 0.01 && pz <= w.z + w.d + 0.01);
  }
  function floorBounds(f) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const o of [...A.data.rooms, ...A.data.walkways].filter(o => o.floor_id === f)) { x0 = Math.min(x0, o.x); z0 = Math.min(z0, o.z); x1 = Math.max(x1, o.x + o.w); z1 = Math.max(z1, o.z + o.d); }
    if (!isFinite(x0)) return { x0: -10, z0: -10, x1: 10, z1: 10 };
    return { x0, z0, x1, z1 };
  }

  /* ---------- auth ---------- */
  const cfg = window.NAVI_CONFIG;
  if (!cfg || !cfg.supabaseUrl || !window.supabase) { $("login").hidden = false; $("lmsg").textContent = "Supabase is not configured. Fill in admin/config.js."; return; }
  A.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  let signUp = false;
  $("lmode").addEventListener("click", () => { signUp = !signUp; $("lbtn").textContent = signUp ? "Create account" : "Sign in"; $("lmode").textContent = signUp ? "Have an account? Sign in" : "First time? Create your account"; $("lmsg").textContent = ""; });
  $("lform").addEventListener("submit", async e => {
    e.preventDefault(); const email = $("email").value.trim(), password = $("pw").value; const m = $("lmsg"); m.className = "lmsg"; m.textContent = "…";
    if (signUp) {
      const { data, error } = await A.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href } });
      if (error) { m.textContent = error.message; return; }
      if (!data.session) { m.className = "lmsg ok"; m.textContent = "Account created. Open the confirmation email, then sign in here."; signUp = false; $("lbtn").textContent = "Sign in"; return; }
    } else {
      const { error } = await A.sb.auth.signInWithPassword({ email, password });
      if (error) { m.textContent = error.message; return; }
    }
    await afterLogin();
  });
  $("signout").addEventListener("click", async () => { await A.sb.auth.signOut(); location.reload(); });

  async function afterLogin() {
    const { data: u } = await A.sb.auth.getUser(); A.user = u.user;
    const { data: ok, error } = await A.sb.rpc("is_admin");
    if (error || !ok) { $("login").hidden = false; $("lmsg").textContent = `${A.user ? A.user.email : "This account"} is not an admin. Add the email to the admins table in Supabase.`; await A.sb.auth.signOut(); return; }
    $("login").hidden = true; $("signout").hidden = false; $("who").textContent = A.user.email;
    await load();
  }

  /* ---------- data ---------- */
  async function load() {
    const q = t => A.sb.from(T(t)).select("*");
    const res = await Promise.all(["settings", "floors", "rooms", "walkways", "start_points", "doctors"].map(q));
    const bad = res.find(r => r.error); if (bad) { toast("Could not load: " + bad.error.message, true); return; }
    const [s, f, r, w, p, d] = res.map(x => x.data);
    A.data = { settings: s[0] || { id: 1, hospital_name: "", hospital_name_ta: "" }, floors: f.sort((a, b) => a.level - b.level), rooms: r, walkways: w, start_points: p, doctors: d.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) };
    A.orig = JSON.parse(JSON.stringify(A.data));
    if (!A.floor || !A.data.floors.some(x => x.id === A.floor)) A.floor = A.data.floors[0].id;
    A.sel = null; fitView(); renderTabs(); renderPlan(); renderInsp(); renderDocs(); updateSave();
  }
  const list = type => A.data[type];
  const item = () => A.sel && list(A.sel.type).find(x => x.id === A.sel.id);
  const roomByCode = code => A.data.rooms.find(r => r.code === code);

  function errorsOf(type, o) {
    const e = [];
    if (type === "rooms") {
      if (!o.name_en.trim()) e.push("English name is required");
      if (!o.name_ta.trim()) e.push("Tamil name is required");
      if (!o.code.trim()) e.push("Code is required");
      else if (A.data.rooms.some(r => r !== o && r.code === o.code)) e.push("Code is already used by another room");
      if (o.w < 1 || o.d < 1) e.push("Rooms must be at least 1 × 1 unit (2.5 m)");
      if ((o.category === "lift" || o.category === "stairs") && !o.link_group) e.push("Lifts and stairs need a link group (the same on every floor) to connect floors");
    } else if (type === "start_points") {
      if (!o.name_en.trim() || !o.name_ta.trim()) e.push("Both names are required");
      if (!o.code.trim()) e.push("Code is required");
      else if (A.data.start_points.some(r => r !== o && r.code === o.code)) e.push("Code is already used");
    } else if (type === "doctors") {
      if (!o.name.trim()) e.push("Name is required");
      if (!o.speciality.trim()) e.push("Speciality is required");
      if (!roomByCode(o.room_code)) e.push("Pick the room the doctor sits in");
    } else if (o.w < 1 || o.d < 1) e.push("Corridors must be at least 1 unit wide");
    return e;
  }
  const overlaps = r => A.data.rooms.some(o => o !== r && o.floor_id === r.floor_id && r.x < o.x + o.w - 0.01 && r.x + r.w > o.x + 0.01 && r.z < o.z + o.d - 0.01 && r.z + r.d > o.z + 0.01);
  const warnOf = r => !doorTouchesWalkway(r) ? "Door does not open onto a corridor" : overlaps(r) ? "Overlaps another block" : "";
  const pick = (o, cols) => Object.fromEntries(cols.map(c => [c, o[c] === undefined ? null : o[c]]));
  function changes() {
    const out = { upserts: {}, deletes: {}, settings: JSON.stringify(A.data.settings) !== JSON.stringify(A.orig.settings), count: 0 };
    Object.keys(TABLES).forEach(t => {
      const before = new Map(A.orig[t].map(x => [x.id, JSON.stringify(pick(x, TABLES[t]))]));
      out.upserts[t] = A.data[t].filter(x => before.get(x.id) !== JSON.stringify(pick(x, TABLES[t])));
      out.deletes[t] = A.orig[t].filter(x => !A.data[t].some(y => y.id === x.id)).map(x => x.id);
      out.count += out.upserts[t].length + out.deletes[t].length;
    });
    if (out.settings) out.count++;
    return out;
  }
  function allErrors() { const e = []; Object.keys(TABLES).forEach(t => A.data[t].forEach(o => { if (errorsOf(t, o).length) e.push([t, o]); })); return e; }
  function updateSave() { const c = changes(); const b = $("save"); b.disabled = !c.count; b.textContent = c.count ? `Save ${c.count} change${c.count > 1 ? "s" : ""}` : "Saved"; }

  $("save").addEventListener("click", async () => {
    const bad = allErrors();
    if (bad.length) {
      const [t, o] = bad[0];
      if (t === "doctors") { setMode("docs"); A.doc = o.id; renderDocs(); } else { setMode("layout"); A.floor = o.floor_id; A.sel = { type: t, id: o.id }; renderTabs(); renderPlan(); renderInsp(); }
      toast("Fix the highlighted fields before saving (every block and doctor needs a name).", true); return;
    }
    const c = changes(); $("save").disabled = true; $("save").textContent = "Saving…";
    try {
      // Doctors go first on delete (they point at rooms) and last on insert.
      for (const t of ["doctors", "start_points", "rooms", "walkways"]) if (c.deletes[t].length) { const { error } = await A.sb.from(T(t)).delete().in("id", c.deletes[t]); if (error) throw error; }
      for (const t of ["rooms", "walkways", "start_points", "doctors"]) if (c.upserts[t].length) {
        const rows = c.upserts[t].map(x => Object.assign({ id: x.id }, pick(x, TABLES[t])));
        const { error } = await A.sb.from(T(t)).upsert(rows, { onConflict: "id" }); if (error) throw error;
      }
      if (c.settings) { const { error } = await A.sb.from(T("settings")).update({ hospital_name: A.data.settings.hospital_name, hospital_name_ta: A.data.settings.hospital_name_ta }).eq("id", 1); if (error) throw error; }
      const keep = A.sel; await load(); A.sel = keep && list(keep.type).some(x => x.id === keep.id) ? keep : null; renderPlan(); renderInsp();
      toast("Saved. Visitors see the change the next time they open the map.");
    } catch (err) {
      const m = String(err.message || err);
      toast(/foreign key|violates/.test(m) ? "Save failed: a room that still has doctors can't be deleted. Move its doctors to another room first." : "Save failed: " + m, true);
      updateSave();
    }
  });
  window.addEventListener("beforeunload", e => { if (A.data && changes().count) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- mode ---------- */
  function setMode(m) {
    A.mode = m;
    $("m-layout").setAttribute("aria-pressed", m === "layout"); $("m-docs").setAttribute("aria-pressed", m === "docs");
    $("layoutView").hidden = m !== "layout"; $("docsView").hidden = m !== "docs";
    $("layoutTools").hidden = m !== "layout"; $("ftabs").hidden = m !== "layout";
    if (m === "docs") renderDocs();
  }
  $("m-layout").addEventListener("click", () => setMode("layout"));
  $("m-docs").addEventListener("click", () => setMode("docs"));

  /* ---------- toolbar ---------- */
  function renderTabs() { $("ftabs").innerHTML = A.data.floors.map(f => `<button data-f="${esc(f.id)}" aria-pressed="${f.id === A.floor}">${esc(f.name_en)}</button>`).join(""); }
  $("ftabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; A.floor = b.dataset.f; A.sel = null; renderTabs(); fitView(); renderPlan(); renderInsp(); });
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
  const centre = () => ({ x: snap(A.vb.x + A.vb.w / 2), z: snap(A.vb.y + A.vb.h / 2) });
  $("add-room").addEventListener("click", () => {
    const c = centre(); const o = { id: uid(), code: "", floor_id: A.floor, name_en: "", name_ta: "", category: "opd", x: r2(c.x - 1.8), z: r2(c.z - 2), w: 3.6, d: 4, door_side: "S", door_pos: 0.5, door_width: 1.6, link_group: null, keywords: "", searchable: true, _auto: true };
    A.data.rooms.push(o); select("rooms", o.id, true);
  });
  $("add-walk").addEventListener("click", () => { const c = centre(); const o = { id: uid(), floor_id: A.floor, name: "Corridor", x: r2(c.x - 8), z: r2(c.z - 1.2), w: 16, d: 2.4 }; A.data.walkways.push(o); select("walkways", o.id); });
  $("add-start").addEventListener("click", () => { const c = centre(); const o = { id: uid(), code: "", floor_id: A.floor, kind: "kiosk", name_en: "", name_ta: "", x: c.x, z: c.z, _auto: true }; A.data.start_points.push(o); select("start_points", o.id, true); });
  function select(type, id, focusName) { A.sel = type ? { type, id } : null; A.confirmDel = false; renderPlan(); renderInsp(); updateSave(); if (focusName) { const n = $("f-name_en"); if (n) n.focus(); } }

  /* ---------- plan (SVG) ---------- */
  function fitView() {
    const b = floorBounds(A.floor); const pad = 3;
    A.vb = { x: b.x0 - pad, y: b.z0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.z1 - b.z0 + pad * 2 };
    applyVB();
  }
  function applyVB() { svg.setAttribute("viewBox", `${A.vb.x} ${A.vb.y} ${A.vb.w} ${A.vb.h}`); svg.setAttribute("preserveAspectRatio", "xMidYMid meet"); }
  function toWorld(e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const m = svg.getScreenCTM().inverse(); const r = p.matrixTransform(m); return { x: r.x, z: r.y }; }
  function nameLines(o) {
    const fs = Math.max(0.28, Math.min(0.62, (o.w * 0.92) / Math.max(4, (o.name_en || "Unnamed").length * 0.56)));
    return { fs, en: o.name_en || "Unnamed", ta: o.name_ta || "பெயரில்லை" };
  }
  function renderPlan() {
    if (!A.data) return;
    const f = A.floor, sel = A.sel, b = floorBounds(f);
    let h = "";
    for (let x = Math.floor(b.x0 - 6); x <= b.x1 + 6; x++) h += `<line class="${x % 5 ? "p-grid" : "p-grid5"}" x1="${x}" y1="${b.z0 - 6}" x2="${x}" y2="${b.z1 + 6}"/>`;
    for (let z = Math.floor(b.z0 - 6); z <= b.z1 + 6; z++) h += `<line class="${z % 5 ? "p-grid" : "p-grid5"}" x1="${b.x0 - 6}" y1="${z}" x2="${b.x1 + 6}" y2="${z}"/>`;
    A.data.walkways.filter(w => w.floor_id === f).forEach(w => {
      const s = sel && sel.type === "walkways" && sel.id === w.id;
      h += `<rect class="p-walk${s ? " p-sel" : ""}" data-t="walkways" data-id="${w.id}" x="${w.x}" y="${w.z}" width="${w.w}" height="${w.d}"/>`;
    });
    A.data.rooms.filter(r => r.floor_id === f).forEach(r => {
      const cat = CATEGORIES[r.category] || CATEGORIES.services, s = sel && sel.type === "rooms" && sel.id === r.id;
      const bad = errorsOf("rooms", r).length, warn = warnOf(r);
      h += `<rect class="p-room${s ? " p-sel" : ""}" data-t="rooms" data-id="${r.id}" x="${r.x}" y="${r.z}" width="${r.w}" height="${r.d}" fill="color-mix(in srgb, ${cat.color} 35%, #ffffff)" ${bad ? 'stroke-dasharray=".3 .2" stroke="#D93A3F"' : ""}/>`;
      if (!NOT_ROUTED.has(r.category)) {
        const di = doorInfo(r), hw = r.door_width / 2, horiz = r.door_side === "N" || r.door_side === "S";
        h += `<line class="p-door" stroke="${warn ? "#D93A3F" : "#2F80FF"}" x1="${horiz ? di.x - hw : di.x}" y1="${horiz ? di.z : di.z - hw}" x2="${horiz ? di.x + hw : di.x}" y2="${horiz ? di.z : di.z + hw}"/>`;
      }
      const L = nameLines(r);
      h += `<text class="p-text" x="${r.x + r.w / 2}" y="${r.z + r.d / 2 - L.fs * 0.5}" font-size="${L.fs}" font-weight="600"${r.name_en ? "" : ' fill="#D93A3F"'}>${esc(L.en)}</text>`;
      h += `<text class="p-text p-sub" x="${r.x + r.w / 2}" y="${r.z + r.d / 2 + L.fs * 0.75}" font-size="${L.fs * 0.82}"${r.name_ta ? "" : ' fill="#D93A3F"'}>${esc(L.ta)}</text>`;
    });
    A.data.start_points.filter(p => p.floor_id === f).forEach(p => {
      const s = sel && sel.type === "start_points" && sel.id === p.id;
      h += `<circle class="p-start${s ? " p-sel" : ""}" data-t="start_points" data-id="${p.id}" cx="${p.x}" cy="${p.z}" r="0.6" fill="#2F80FF"/>`;
      h += `<text class="p-text" x="${p.x}" y="${p.z - 1}" font-size="0.5" font-weight="600">${esc(p.name_en || "Unnamed start")}</text>`;
    });
    const o = item();
    if (o && A.sel.type !== "start_points" && o.floor_id === f) {
      [["nw", o.x, o.z], ["se", o.x + o.w, o.z + o.d], ["ne", o.x + o.w, o.z], ["sw", o.x, o.z + o.d]].forEach(([k, x, z]) => (h += `<rect class="p-handle" data-h="${k}" x="${x - 0.3}" y="${z - 0.3}" width=".6" height=".6" rx=".1"/>`));
    }
    svg.innerHTML = h;
  }
  svg.addEventListener("pointerdown", e => {
    const p = toWorld(e), hEl = e.target.closest("[data-h]"), el = e.target.closest("[data-id]");
    svg.setPointerCapture(e.pointerId);
    if (hEl) { const o = item(); A.drag = { kind: "resize", h: hEl.dataset.h, p, o0: { ...o } }; return; }
    if (el) {
      if (!A.sel || A.sel.id !== el.dataset.id) select(el.dataset.t, el.dataset.id);
      const o = item(); A.drag = { kind: "move", p, o0: { ...o }, moved: false }; return;
    }
    A.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vb0: { ...A.vb }, moved: false };
  });
  svg.addEventListener("pointermove", e => {
    const d = A.drag; if (!d) return;
    if (d.kind === "pan") {
      const r = svg.getBoundingClientRect(), k = Math.max(A.vb.w / r.width, A.vb.h / r.height);
      A.vb.x = d.vb0.x - (e.clientX - d.sx) * k; A.vb.y = d.vb0.y - (e.clientY - d.sy) * k; d.moved = true; applyVB(); return;
    }
    const p = toWorld(e), dx = p.x - d.p.x, dz = p.z - d.p.z, o = item(); if (!o) return;
    if (d.kind === "move") { o.x = r2(snap(d.o0.x + dx)); o.z = r2(snap(d.o0.z + dz)); d.moved = true; }
    else {
      const min = 1;
      if (d.h.includes("w")) { const nx = snap(Math.min(d.o0.x + dx, d.o0.x + d.o0.w - min)); o.w = r2(d.o0.w + (d.o0.x - nx)); o.x = r2(nx); }
      if (d.h.includes("e")) o.w = r2(Math.max(min, snap(d.o0.w + dx)));
      if (d.h.includes("n")) { const nz = snap(Math.min(d.o0.z + dz, d.o0.z + d.o0.d - min)); o.d = r2(d.o0.d + (d.o0.z - nz)); o.z = r2(nz); }
      if (d.h.includes("s")) o.d = r2(Math.max(min, snap(d.o0.d + dz)));
    }
    renderPlan(); syncGeomFields(); updateSave();
  });
  const endDrag = () => { if (A.drag && A.drag.kind === "pan" && !A.drag.moved) select(null); A.drag = null; };
  svg.addEventListener("pointerup", endDrag); svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("wheel", e => {
    e.preventDefault(); const p = toWorld(e), k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    A.vb = { x: p.x - (p.x - A.vb.x) * k, y: p.z - (p.z - A.vb.y) * k, w: A.vb.w * k, h: A.vb.h * k }; applyVB();
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if (A.mode !== "layout") return;
    const o = item(); if (!o || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const mv = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] }[e.key];
    if (mv) { e.preventDefault(); o.x = r2(o.x + mv[0]); o.z = r2(o.z + mv[1]); renderPlan(); syncGeomFields(); updateSave(); }
    if (e.key === "Escape") select(null);
  });

  /* ---------- inspector ---------- */
  const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const num = (k, v, label, step = 0.2) => `<label class="field"><span class="lbl">${label}</span><input type="number" step="${step}" id="f-${k}" data-k="${k}" data-num="1" value="${v}"></label>`;
  const txt = (k, v, label, bad, lang) => `<label class="field"><span class="lbl">${label}</span><input type="text" id="f-${k}" data-k="${k}" value="${esc(v || "")}"${bad ? ' class="bad"' : ""}${lang ? ` lang="${lang}"` : ""}></label>`;
  const visitorUrl = () => new URL("../", location.href).href;
  function renderInsp() {
    const el = $("insp"), o = item();
    if (!A.data) return;
    if (!o) {
      const rooms = A.data.rooms.filter(r => r.floor_id === A.floor).sort((a, b) => (a.name_en || "").localeCompare(b.name_en || ""));
      el.innerHTML = `<h3>Hospital</h3>
        ${txt("hospital_name", A.data.settings.hospital_name, "Name (English)")}${txt("hospital_name_ta", A.data.settings.hospital_name_ta, "Name (Tamil)", false, "ta")}
        <h3>Blocks on this floor <span class="hint">(${rooms.length})</span></h3>
        <p class="hint">Every block needs an English and a Tamil name. Click a block on the plan or in this list to edit it.</p>
        <ul class="blist">${rooms.map(r => { const bad = errorsOf("rooms", r).length, w = warnOf(r); return `<li><button data-pick="${r.id}"><i class="sw" style="background:${(CATEGORIES[r.category] || {}).color}"></i><span>${esc(r.name_en || "Unnamed block")}</span>${bad ? '<span class="warn-dot">needs name</span>' : w ? '<span class="warn-dot">door</span>' : ""}</button></li>`; }).join("")}</ul>`;
      return;
    }
    const t = A.sel.type, errs = errorsOf(t, o);
    let h = "";
    if (t === "rooms") {
      const warn = warnOf(o), docs = A.data.doctors.filter(d => d.room_code === o.code);
      h = `<h3>Room / block</h3>
        ${txt("name_en", o.name_en, "Name (English) *", !o.name_en.trim())}${txt("name_ta", o.name_ta, "Name (Tamil) *", !o.name_ta.trim(), "ta")}
        <label class="field"><span class="lbl">Category</span><select data-k="category">${Object.entries(CATEGORIES).map(([k, c]) => opt(k, o.category, c.en)).join("")}</select></label>
        ${NOT_ROUTED.has(o.category) ? "" : `${txt("keywords", o.keywords, "Search keywords (e.g. scan, heart)")}
        <div class="row"><label class="field"><span class="lbl">Door side</span><select data-k="door_side">${[["N", "Top"], ["S", "Bottom"], ["W", "Left"], ["E", "Right"]].map(([k, l]) => opt(k, o.door_side, l)).join("")}</select></label>
        ${num("door_width", o.door_width, "Door width (units)", 0.2)}</div>
        <label class="field"><span class="lbl">Door position along the wall</span><input type="range" min="0.05" max="0.95" step="0.05" data-k="door_pos" data-num="1" value="${o.door_pos}"></label>
        ${warn ? `<p class="err">${warn}. Visitors can't be routed here until the door touches a corridor and blocks don't overlap.</p>` : ""}
        ${o.category === "lift" || o.category === "stairs" ? txt("link_group", o.link_group, "Link group (same on every floor, e.g. LIFT-A)", !o.link_group) : ""}
        <label class="chk"><input type="checkbox" data-k="searchable"${o.searchable ? " checked" : ""}> Show in visitor search</label>`}
        <div class="row4">${num("x", o.x, "X")}${num("z", o.z, "Y")}${num("w", o.w, "Width")}${num("d", o.d, "Depth")}</div>
        ${txt("code", o.code, "Code (used in links and QR)")}<p class="hint mono" id="qrlink">${esc(visitorUrl())}?to=${esc(o.code)}</p>
        ${docs.length ? `<p class="hint">Doctors here: ${docs.map(d => esc(d.name)).join(", ")}</p>` : ""}`;
    } else if (t === "walkways") {
      h = `<h3>Corridor</h3>${txt("name", o.name, "Label")}
        <p class="hint">Routes follow the centre line of each corridor. Keep corridors at least 2.4 units (6 m) wide, let side corridors run into the main one, and make sure every room door touches a corridor.</p>
        <div class="row4">${num("x", o.x, "X")}${num("z", o.z, "Y")}${num("w", o.w, "Width")}${num("d", o.d, "Depth")}</div>`;
    } else {
      h = `<h3>Start point</h3>${txt("name_en", o.name_en, "Name (English) *", !o.name_en.trim())}${txt("name_ta", o.name_ta, "Name (Tamil) *", !o.name_ta.trim(), "ta")}
        <label class="field"><span class="lbl">Type</span><select data-k="kind">${opt("entrance", o.kind, "Entrance")}${opt("kiosk", o.kind, "Kiosk / QR poster")}</select></label>
        <div class="row">${num("x", o.x, "X")}${num("z", o.z, "Y")}</div>
        ${txt("code", o.code, "Code")}<p class="hint">QR link: <span class="mono">${esc(visitorUrl())}?from=${esc(o.code)}</span></p>`;
    }
    h += errs.length ? errs.map(x => `<p class="err">${esc(x)}</p>`).join("") : "";
    h += `<div class="row"><button class="tbtn" id="done">Done</button><button class="danger${A.confirmDel ? " sure" : ""}" id="del">${A.confirmDel ? "Click again to delete" : "Delete"}</button></div>`;
    el.innerHTML = h;
  }
  function syncGeomFields() { const o = item(); if (!o) return; ["x", "z", "w", "d"].forEach(k => { const f = $("f-" + k); if (f && document.activeElement !== f) f.value = o[k]; }); }
  const slug = s => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  function uniqueCode(base, type, self) { let c = base || "room", n = 2; while (A.data[type].some(x => x !== self && x.code === c)) c = `${base}-${n++}`; return c; }
  $("insp").addEventListener("input", e => {
    const k = e.target.dataset.k; if (!k) return;
    if (!item()) { A.data.settings[k] = e.target.value; updateSave(); return; }
    const o = item();
    let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (e.target.dataset.num) { v = parseFloat(v); if (!isFinite(v)) return; }
    if (k === "link_group") v = v.trim() || null;
    if (k === "code") {
      o._auto = false; const old = o.code; v = slug(v) || v;
      if (A.sel.type === "rooms") A.data.doctors.forEach(d => { if (d.room_code === old) d.room_code = v; });   // doctors follow the room
    }
    o[k] = v;
    if (k === "name_en" && o._auto && "code" in o) o.code = uniqueCode(slug(v) || (A.sel.type === "rooms" ? "room" : "start"), A.sel.type, o);
    if (k === "category") { if (["lift", "stairs", "garden", "service"].includes(v)) o.searchable = false; else if (!o.searchable && v !== "restroom") o.searchable = true; }
    renderPlan(); updateSave();
    if (e.target.tagName === "SELECT" || e.target.type === "checkbox" || k === "door_side") renderInsp();
    else { refreshErrors(o); e.target.classList.toggle("bad", (k === "name_en" || k === "name_ta") && !String(v).trim()); }
  });
  function refreshErrors(o) {
    const el = $("insp"); el.querySelectorAll("p.err").forEach(p => p.remove());
    const anchor = el.querySelector(".row:last-child");
    [A.sel.type === "rooms" ? warnOf(o) : ""].concat(errorsOf(A.sel.type, o)).filter(Boolean).forEach(x => { const p = document.createElement("p"); p.className = "err"; p.textContent = x; anchor.before(p); });
    const c = $("f-code"); if (c && document.activeElement !== c) c.value = o.code;
    const q = $("qrlink"); if (q) q.textContent = visitorUrl() + "?to=" + o.code;
  }
  $("insp").addEventListener("change", e => { if (e.target.dataset.k === "door_pos" || e.target.dataset.k === "code") renderPlan(); });
  $("insp").addEventListener("click", e => {
    const pk = e.target.closest("[data-pick]"); if (pk) return select("rooms", pk.dataset.pick);
    if (e.target.closest("#done")) return select(null);
    if (e.target.closest("#del")) {
      const o = item();
      if (A.sel.type === "rooms" && A.data.doctors.some(d => d.room_code === o.code)) { toast("This room still has doctors. Move them to another room in Doctors first.", true); return; }
      if (!A.confirmDel) { A.confirmDel = true; return renderInsp(); }
      A.data[A.sel.type] = A.data[A.sel.type].filter(x => x.id !== A.sel.id); select(null);
    }
  });

  /* ---------- doctors ---------- */
  const floorName = id => A.data.floors.find(f => f.id === id)?.name_en || id;
  const routable = () => A.data.rooms.filter(r => !["lift", "stairs", "garden", "service"].includes(r.category)).sort((a, b) => floorName(a.floor_id).localeCompare(floorName(b.floor_id)) || a.name_en.localeCompare(b.name_en, undefined, { numeric: true }));
  function renderDocs() {
    if (!A.data) return;
    const q = ($("dq").value || "").trim().toLowerCase();
    const rows = A.data.doctors.filter(d => !q || [d.name, d.speciality, roomByCode(d.room_code)?.name_en].some(x => String(x || "").toLowerCase().includes(q)));
    $("dbody").innerHTML = rows.map(d => {
      const r = roomByCode(d.room_code), bad = errorsOf("doctors", d).length;
      return `<tr data-doc="${d.id}" class="${A.doc === d.id ? "on" : ""}"><td><b>${esc(d.name || "Unnamed doctor")}</b><small>${esc(d.speciality)}${d.qualification ? " · " + esc(d.qualification) : ""}</small></td>
        <td>${r ? `${esc(r.name_en)}<small>${esc(floorName(r.floor_id))}</small>` : '<span class="err">No room</span>'}</td>
        <td>${esc(d.days)}<small>${esc(d.hours)}</small></td><td><span class="pill${d.active ? "" : " off"}">${d.active ? "Shown" : "Hidden"}</span>${bad ? ' <span class="err">fix</span>' : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="4" class="muted">No doctors match.</td></tr>`;
    const d = A.data.doctors.find(x => x.id === A.doc), el = $("dinsp");
    if (!d) { el.innerHTML = `<h3>Doctors</h3><p class="hint">${A.data.doctors.length} doctors. Pick one to edit, or add a new doctor. Visitors find doctors by name or speciality, and "Directions" takes them to the doctor's room.</p>`; return; }
    const errs = errorsOf("doctors", d);
    el.innerHTML = `<h3>Doctor</h3>
      <label class="field"><span class="lbl">Name *</span><input type="text" data-dk="name" value="${esc(d.name)}"${d.name.trim() ? "" : ' class="bad"'} placeholder="Dr. …"></label>
      <label class="field"><span class="lbl">Speciality *</span><input type="text" data-dk="speciality" value="${esc(d.speciality)}" placeholder="e.g. Cardiology"></label>
      <label class="field"><span class="lbl">Qualification</span><input type="text" data-dk="qualification" value="${esc(d.qualification)}" placeholder="e.g. MD, DM (Cardiology)"></label>
      <label class="field"><span class="lbl">Room *</span><select data-dk="room_code"><option value="">Choose a room…</option>${routable().map(r => opt(r.code, d.room_code, `${floorName(r.floor_id)} · ${r.name_en}`)).join("")}</select></label>
      <div class="row"><label class="field"><span class="lbl">OPD days</span><input type="text" data-dk="days" value="${esc(d.days)}" placeholder="Mon–Sat"></label>
      <label class="field"><span class="lbl">Hours</span><input type="text" data-dk="hours" value="${esc(d.hours)}" placeholder="09:00–13:00"></label></div>
      <label class="chk"><input type="checkbox" data-dk="active"${d.active ? " checked" : ""}> Show to visitors</label>
      ${errs.map(x => `<p class="err">${esc(x)}</p>`).join("")}
      <div class="row"><button class="tbtn" id="ddone">Done</button><button class="danger${A.confirmDel ? " sure" : ""}" id="ddel">${A.confirmDel ? "Click again to delete" : "Delete"}</button></div>`;
  }
  $("dq").addEventListener("input", renderDocs);
  $("dbody").addEventListener("click", e => { const tr = e.target.closest("[data-doc]"); if (tr) { A.doc = tr.dataset.doc; A.confirmDel = false; renderDocs(); } });
  $("add-doc").addEventListener("click", () => {
    const o = { id: uid(), name: "", speciality: "", qualification: "", room_code: "", days: "Mon–Sat", hours: "", active: true, sort: (A.data.doctors.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1) };
    A.data.doctors.push(o); A.doc = o.id; A.confirmDel = false; renderDocs(); updateSave(); document.querySelector('[data-dk="name"]')?.focus();
  });
  $("dinsp").addEventListener("input", e => {
    const k = e.target.dataset.dk; if (!k) return;
    const d = A.data.doctors.find(x => x.id === A.doc); if (!d) return;
    d[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    updateSave();
    // re-render the table row without stealing focus from the form
    const focusKey = document.activeElement?.dataset?.dk, pos = document.activeElement?.selectionStart;
    renderDocs();
    if (focusKey) { const f = document.querySelector(`[data-dk="${focusKey}"]`); if (f) { f.focus(); if (pos != null && f.setSelectionRange) try { f.setSelectionRange(pos, pos); } catch (_) {} } }
  });
  $("dinsp").addEventListener("click", e => {
    if (e.target.closest("#ddone")) { A.doc = null; renderDocs(); return; }
    if (e.target.closest("#ddel")) {
      if (!A.confirmDel) { A.confirmDel = true; renderDocs(); return; }
      A.data.doctors = A.data.doctors.filter(x => x.id !== A.doc); A.doc = null; A.confirmDel = false; renderDocs(); updateSave();
    }
  });

  /* ---------- start ---------- */
  const { data: sess } = await A.sb.auth.getSession();
  if (sess.session) await afterLogin(); else $("login").hidden = false;
})();
