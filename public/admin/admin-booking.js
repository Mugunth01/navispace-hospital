/* NaviSpace Hospital – admin add-on: doctor sessions / login / leave / photo, bookings + email outbox, lab tests, booking settings.
   Uses the shared state from admin.js (window.NaviAdmin). Writes go through RLS (admins only) or the nav_* functions. */
(function () {
  "use strict";
  const N = window.NaviAdmin; if (!N) return;
  const { A, esc, toast } = N;
  const $ = id => document.getElementById(id);
  const WD = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const t12 = t => { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`; };
  const dayLabel = s => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const fnUrl = name => `${N.cfg.supabaseUrl}/functions/v1/${name}`;
  const kickMail = () => fetch(fnUrl("send-mail"), { method: "POST", headers: { apikey: N.cfg.supabaseKey, "Content-Type": "application/json" }, body: "{}" }).then(r => r.json()).catch(() => null);
  const KIND = { inperson: "Clinic visit", online: "Online", lab: "Lab / scan" };
  const STATUS = { booked: "Booked", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };

  /* ── Doctor: weekly sessions, login, leave, photo ─────────────────────── */
  function summarise(doc) {
    const s = A.data.doctor_sessions.filter(x => x.doctor_id === doc.id && x.mode === "inperson").sort((a, b) => a.weekday - b.weekday);
    if (!s.length) return;
    const days = [...new Set(s.map(x => x.weekday))], run = days.every((d, i) => !i || d === days[i - 1] + 1);
    doc.days = run && days.length > 2 ? `${WD[days[0]]}–${WD[days[days.length - 1]]}` : days.map(d => WD[d]).join(", ");
    doc.hours = `${s[0].start_time}–${s[0].end_time}`;
  }
  N.hooks.doctor = async (d, el) => {
    const saved = A.orig.doctors.some(x => x.id === d.id);
    const sess = A.data.doctor_sessions.filter(x => x.doctor_id === d.id).sort((a, b) => a.mode.localeCompare(b.mode) || a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    const acc = A.accounts.get(d.id);
    el.innerHTML = `
      <div class="field"><span class="lbl">Weekly sessions</span>
        <table class="stable">${sess.map(s => `<tr data-s="${s.id}">
          <td><select data-sk="weekday">${WD.slice(1).map((w, i) => N.opt(String(i + 1), String(s.weekday), w)).join("")}</select></td>
          <td><input type="time" data-sk="start_time" value="${s.start_time}"></td><td><input type="time" data-sk="end_time" value="${s.end_time}"></td>
          <td><select data-sk="mode">${N.opt("inperson", s.mode, "Clinic")}${N.opt("online", s.mode, "Online")}</select></td>
          <td><button class="linkbtn" data-srm="${s.id}" aria-label="Remove session">✕</button></td></tr>`).join("") || '<tr><td class="muted">No sessions — patients can\'t book this doctor yet.</td></tr>'}</table>
        <div class="row3"><button class="tbtn" data-sadd="inperson">+ Clinic</button><button class="tbtn" data-sadd="online">+ Online</button><button class="tbtn" data-spreset="1">Mon–Sat 9–1</button></div>
        <p class="hint">Sessions are saved with the Save button. Slots = session length ÷ minutes per patient.</p></div>
      <h3>Doctor login</h3>
      ${!saved ? '<p class="hint">Save the new doctor first, then create a login.</p>'
        : acc ? `<p class="hint">Login: <b>${esc(acc.email)}</b> — the doctor signs in at <span class="mono">${esc(new URL("../doctor/", location.href).href)}</span></p>
            <div class="row"><input type="text" id="lg-pw" placeholder="New password (8+)" autocomplete="new-password"><button class="tbtn" id="lg-reset">Reset password</button></div>
            <button class="danger" id="lg-remove">Remove login</button>`
        : `<div class="row"><input type="email" id="lg-email" placeholder="doctor@hospital.com"><input type="text" id="lg-pw" placeholder="Password (8+)" autocomplete="new-password"></div>
            <button class="tbtn" id="lg-create">Create login</button><p class="hint">Share the email and password with the doctor; they can change the password after signing in.</p>`}
      <h3>Leave</h3>
      ${saved ? `<div class="row"><input type="date" id="lv-from"><input type="date" id="lv-to"></div>
        <input type="text" id="lv-reason" placeholder="Reason shown to patients (e.g. Conference)">
        <button class="tbtn" id="lv-add">Add leave — cancels bookings on these days</button><div id="lv-list" class="hint">Loading…</div>` : '<p class="hint">Save the doctor first.</p>'}`;
    if (saved) {
      const { data } = await A.sb.from("nav_doctor_leaves").select("*").eq("doctor_id", d.id).gte("to_date", ymd(new Date())).order("from_date");
      const L = $("lv-list"); if (L) L.innerHTML = (data || []).map(l => `<div class="lvrow">${dayLabel(l.from_date)}${l.to_date !== l.from_date ? " – " + dayLabel(l.to_date) : ""} · ${esc(l.reason || "Leave")} <button class="linkbtn" data-lvrm="${l.id}">Remove</button></div>`).join("") || "No upcoming leave.";
    }
  };
  const curDoc = () => A.data.doctors.find(x => x.id === A.doc);
  const redrawExtra = () => { const d = curDoc(); if (d) N.hooks.doctor(d, $("dextra")); };
  async function callAccount(body) {
    const { data: s } = await A.sb.auth.getSession();
    const r = await fetch(fnUrl("admin-doctor-account"), { method: "POST", headers: { apikey: N.cfg.supabaseKey, Authorization: `Bearer ${s.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: "No answer from the login service. Is the admin-doctor-account function deployed?" }));
    if (!r.ok || j.error) throw new Error(j.error || r.status);
    return j;
  }
  async function resizeImage(file, max = 480) {
    const img = await createImageBitmap(file); const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, "image/webp", 0.85));
  }
  document.addEventListener("input", e => {
    const tr = e.target.closest?.("[data-s]"); if (!tr || !e.target.dataset.sk) return;
    const s = A.data.doctor_sessions.find(x => x.id === tr.dataset.s); if (!s) return;
    s[e.target.dataset.sk] = e.target.dataset.sk === "weekday" ? Number(e.target.value) : e.target.value;
    const d = curDoc(); if (d) summarise(d); N.updateSave();
  });
  $("dinsp").addEventListener("change", async e => {
    if (e.target.id !== "dphoto" || !e.target.files[0]) return;
    const d = curDoc(); if (!d) return;
    try {
      toast("Uploading photo…");
      const blob = await resizeImage(e.target.files[0]), path = `${d.id}/photo-${Date.now()}.webp`;
      const { error } = await A.sb.storage.from("doctor-photos").upload(path, blob, { contentType: "image/webp", upsert: true }); if (error) throw error;
      d.photo_url = A.sb.storage.from("doctor-photos").getPublicUrl(path).data.publicUrl; N.updateSave(); N.renderDocs(); toast("Photo uploaded — press Save to publish it.");
    } catch (err) { toast("Photo upload failed: " + (err.message || err), true); }
  });
  $("dinsp").addEventListener("click", async e => {
    const d = curDoc(); if (!d) return;
    const t = e.target.closest("button"); if (!t) return;
    try {
      if (t.id === "dphoto-rm") { d.photo_url = null; N.updateSave(); N.renderDocs(); return; }
      if (t.dataset.srm) { A.data.doctor_sessions = A.data.doctor_sessions.filter(x => x.id !== t.dataset.srm); summarise(d); N.updateSave(); redrawExtra(); return; }
      if (t.dataset.sadd) { A.data.doctor_sessions.push({ id: N.uid(), doctor_id: d.id, weekday: 1, start_time: t.dataset.sadd === "online" ? "14:00" : "09:00", end_time: t.dataset.sadd === "online" ? "15:00" : "13:00", mode: t.dataset.sadd }); N.updateSave(); redrawExtra(); return; }
      if (t.dataset.spreset) {
        A.data.doctor_sessions = A.data.doctor_sessions.filter(x => !(x.doctor_id === d.id && x.mode === "inperson"));
        for (let w = 1; w <= 6; w++) A.data.doctor_sessions.push({ id: N.uid(), doctor_id: d.id, weekday: w, start_time: "09:00", end_time: "13:00", mode: "inperson" });
        summarise(d); N.updateSave(); N.renderDocs(); return;
      }
      if (t.id === "lg-create") { const j = await callAccount({ action: "create", doctor_id: d.id, email: $("lg-email").value, password: $("lg-pw").value }); A.accounts.set(d.id, { doctor_id: d.id, email: j.email }); toast("Login created for " + j.email); redrawExtra(); return; }
      if (t.id === "lg-reset") { await callAccount({ action: "reset", doctor_id: d.id, password: $("lg-pw").value }); toast("Password changed."); $("lg-pw").value = ""; return; }
      if (t.id === "lg-remove") { if (!confirm("Remove this doctor's login? Their appointments stay.")) return; await callAccount({ action: "remove", doctor_id: d.id }); A.accounts.delete(d.id); toast("Login removed."); redrawExtra(); return; }
      if (t.id === "lv-add") {
        const f = $("lv-from").value, to = $("lv-to").value || f; if (!f) { toast("Pick the leave dates.", true); return; }
        const { data, error } = await A.sb.rpc("nav_add_leave", { p_from: f, p_to: to, p_reason: $("lv-reason").value, p_doctor: d.id }); if (error) throw error;
        kickMail(); toast(data.cancelled ? `Leave added. ${data.cancelled} booking(s) cancelled — patients with an email are notified.` : "Leave added. No bookings were affected."); redrawExtra(); return;
      }
      if (t.dataset.lvrm) { const { error } = await A.sb.rpc("nav_remove_leave", { p_id: t.dataset.lvrm }); if (error) throw error; toast("Leave removed (cancelled bookings stay cancelled)."); redrawExtra(); }
    } catch (err) { toast(err.message || String(err), true); }
  });

  /* ── Bookings ─────────────────────────────────────────────────────────── */
  const B = { rows: [], sel: null, view: "list", mail: [], tests: new Map() };
  $("af").value = ymd(new Date()); $("at").value = addDays(ymd(new Date()), 14);
  async function loadAppts() {
    if (!B.tests.size) { const { data } = await A.sb.from("nav_lab_tests").select("code,name"); (data || []).forEach(t => B.tests.set(t.code, t.name)); }
    let q = A.sb.from("nav_appointments").select("*").gte("appt_date", $("af").value || "1900-01-01").lte("appt_date", $("at").value || "2999-01-01").order("appt_date").order("slot_time").limit(1000);
    if ($("ak").value) q = q.eq("kind", $("ak").value);
    if ($("as").value) q = q.eq("status", $("as").value);
    const { data, error } = await q; if (error) { toast("Could not load bookings: " + error.message, true); return; }
    B.rows = data; renderAppts();
  }
  const docName = id => A.data.doctors.find(x => x.id === id)?.name || "—";
  const what = a => a.kind === "lab" ? a.test_codes.map(c => B.tests.get(c) || c).join(", ") : docName(a.doctor_id);
  function renderAppts() {
    const q = $("aq").value.trim().toLowerCase();
    const rows = B.rows.filter(a => !q || [a.patient_name, a.phone, a.ref, what(a)].some(x => String(x).toLowerCase().includes(q)));
    const c = s => rows.filter(a => a.status === s).length;
    $("astats").innerHTML = `<span><b>${rows.length}</b> bookings</span><span><b>${c("booked")}</b> booked</span><span><b>${c("completed")}</b> completed</span><span><b>${c("cancelled")}</b> cancelled</span><span><b>${c("no_show")}</b> no-show</span>`;
    $("abody").innerHTML = rows.map(a => `<tr data-a="${a.id}" class="${B.sel === a.id ? "on" : ""}"><td><b>${dayLabel(a.appt_date)}</b><small>${t12(a.slot_time)} · ${KIND[a.kind]}</small></td>
      <td>${esc(a.patient_name)}<small>${esc(a.phone)} · ${esc(a.ref)}</small></td><td>${esc(what(a))}</td>
      <td><span class="pill st-${a.status}">${STATUS[a.status]}</span></td></tr>`).join("") || '<tr><td colspan="4" class="muted">No bookings in this range.</td></tr>';
    renderApptInsp();
  }
  function renderApptInsp() {
    const a = B.rows.find(x => x.id === B.sel), el = $("ainsp");
    if (!a) { el.innerHTML = `<h3>Bookings</h3><p class="hint">Patients book from the visitor app (Doctors tab). Pick a booking to mark it done, move it, or cancel it — the patient gets an email for cancellations and moves.</p>`; return; }
    el.innerHTML = `<h3>${esc(a.patient_name)} <span class="pill st-${a.status}">${STATUS[a.status]}</span></h3>
      <p class="hint mono">${esc(a.ref)} · booked ${new Date(a.created_at).toLocaleString("en-IN")}</p>
      <dl class="kv"><dt>When</dt><dd>${dayLabel(a.appt_date)}, ${t12(a.slot_time)}</dd><dt>Type</dt><dd>${KIND[a.kind]}${a.home_collection ? " · home collection" : ""}</dd>
      <dt>${a.kind === "lab" ? "Tests" : "Doctor"}</dt><dd>${esc(what(a))}</dd>
      <dt>Phone</dt><dd><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></dd><dt>Email</dt><dd>${esc(a.email || "—")}</dd>
      <dt>Age / gender</dt><dd>${a.age ?? "—"} / ${esc(a.gender || "—")}</dd><dt>Reason</dt><dd>${esc(a.reason || "—")}</dd>
      ${a.address ? `<dt>Address</dt><dd>${esc(a.address)}</dd>` : ""}${a.video_url ? `<dt>Video</dt><dd><a href="${esc(a.video_url)}" target="_blank" rel="noopener">Open video room</a></dd>` : ""}
      ${a.cancel_reason ? `<dt>Cancelled</dt><dd>by ${esc(a.cancelled_by)} — ${esc(a.cancel_reason)}</dd>` : ""}</dl>
      ${a.status === "booked" ? `<div class="row"><button class="tbtn" data-act="completed">Mark done</button><button class="tbtn" data-act="no_show">No-show</button></div>
        <h3>Move</h3><div class="row"><input type="date" id="mv-date" value="${a.appt_date}"><select id="mv-time"><option value="">Pick a time…</option></select></div>
        <input type="text" id="mv-reason" placeholder="Reason for the patient (optional)"><button class="tbtn" data-act="reschedule">Move booking</button>
        <h3>Cancel</h3><input type="text" id="cx-reason" placeholder="Reason (e.g. Doctor in emergency surgery)"><button class="danger" data-act="cancel">Cancel and email the patient</button>` : ""}`;
    if (a.status === "booked") loadMoveSlots(a);
  }
  async function loadMoveSlots(a) {
    const date = $("mv-date").value, sel = $("mv-time");
    const { data } = a.kind === "lab" ? await A.sb.rpc("nav_lab_slots", { p_date: date, p_tests: a.test_codes }) : await A.sb.rpc("nav_doctor_slots", { p_doctor: a.doctor_id, p_date: date, p_mode: a.kind });
    const free = (data || []).filter(x => x.available ?? x.free > 0);
    sel.innerHTML = `<option value="">${free.length ? "Pick a time…" : "No free slots"}</option>` + free.map(x => `<option value="${x.slot.slice(0, 5)}">${t12(x.slot)}</option>`).join("");
  }
  $("abody").addEventListener("click", e => { const tr = e.target.closest("[data-a]"); if (tr) { B.sel = tr.dataset.a; renderAppts(); } });
  $("ainsp").addEventListener("change", e => { if (e.target.id === "mv-date") loadMoveSlots(B.rows.find(x => x.id === B.sel)); });
  $("ainsp").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, a = B.rows.find(x => x.id === B.sel);
    const args = { p_id: a.id, p_action: act, p_reason: act === "cancel" ? $("cx-reason").value : act === "reschedule" ? $("mv-reason").value : "" };
    if (act === "reschedule") { args.p_date = $("mv-date").value; args.p_time = $("mv-time").value; if (!args.p_time) { toast("Pick a new time.", true); return; } }
    if (act === "cancel" && !confirm("Cancel this booking and email the patient?")) return;
    const { error } = await A.sb.rpc("nav_staff_update", args);
    if (error) { toast(error.message, true); return; }
    if (act === "cancel" || act === "reschedule") kickMail();
    toast({ completed: "Marked done.", no_show: "Marked as no-show.", cancel: "Cancelled — patient notified.", reschedule: "Moved — patient notified." }[act]);
    loadAppts();
  });
  ["af", "at", "ak", "as"].forEach(id => $(id).addEventListener("change", () => B.view === "list" ? loadAppts() : loadMail()));
  $("aq").addEventListener("input", () => B.view === "list" ? renderAppts() : renderMail());
  $("a-reload").addEventListener("click", () => B.view === "list" ? loadAppts() : loadMail());

  /* ── Email outbox ─────────────────────────────────────────────────────── */
  const MAIL_KIND = { booked: "Confirmation", cancelled_patient: "Cancelled by patient", cancelled_hospital: "Cancelled by hospital", rescheduled: "Moved", leave_cancel: "Doctor leave" };
  function setView(v) {
    B.view = v; $("a-list").setAttribute("aria-pressed", v === "list"); $("a-mail").setAttribute("aria-pressed", v === "mail");
    $("atable").hidden = v !== "list"; $("mtable").hidden = v !== "mail"; $("astats").hidden = v !== "list";
    ["af", "at", "ak", "as"].forEach(id => ($(id).closest("label") || $(id)).hidden = v !== "list");
    v === "list" ? loadAppts() : loadMail();
  }
  $("a-list").addEventListener("click", () => setView("list"));
  $("a-mail").addEventListener("click", () => setView("mail"));
  async function loadMail() {
    const { data, error } = await A.sb.from("nav_email_outbox").select("*").order("id", { ascending: false }).limit(200);
    if (error) { toast(error.message, true); return; }
    B.mail = data; renderMail();
  }
  function renderMail() {
    const q = $("aq").value.trim().toLowerCase();
    const rows = B.mail.filter(m => !q || [m.to_email, m.subject].some(x => String(x || "").toLowerCase().includes(q)));
    $("mbody").innerHTML = rows.map(m => `<tr data-m="${m.id}" class="${B.msel === m.id ? "on" : ""}"><td>${new Date(m.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
      <td>${esc(m.to_email)}</td><td>${esc(MAIL_KIND[m.kind])}<small>${esc(m.subject || "(not rendered yet)")}</small></td><td><span class="pill ml-${m.status}">${m.status}</span></td></tr>`).join("") || '<tr><td colspan="4" class="muted">No emails yet.</td></tr>';
    const m = B.mail.find(x => x.id === B.msel), el = $("ainsp");
    const queued = B.mail.filter(x => x.status === "queued").length;
    el.innerHTML = `<h3>Email outbox</h3><p class="hint">Emails go out through the <b>send-mail</b> function (free Brevo tier: 300/day). Without an email key they are marked <i>skipped</i> but you can still preview them here.</p>
      <button class="tbtn" id="m-send">Send queued now${queued ? ` (${queued})` : ""}</button>
      ${m ? `<p class="hint">${esc(m.to_email)} · ${m.status}${m.error ? " · " + esc(m.error) : ""}</p>${m.html ? `<iframe class="mprev" title="Email preview" sandbox srcdoc="${esc(m.html)}"></iframe>` : '<p class="hint">Not rendered yet — press "Send queued now".</p>'}` : '<p class="hint">Pick an email to preview it.</p>'}`;
  }
  $("mbody").addEventListener("click", e => { const tr = e.target.closest("[data-m]"); if (tr) { B.msel = Number(tr.dataset.m); renderMail(); } });
  $("ainsp").addEventListener("click", async e => { if (e.target.id !== "m-send") return; const r = await kickMail(); toast(r ? `Processed ${r.processed || 0}: ${r.sent || 0} sent, ${r.skipped || 0} skipped, ${r.failed || 0} failed.` : "Could not reach the send-mail function.", !r); loadMail(); });

  /* ── Lab tests + booking settings ─────────────────────────────────────── */
  const L = { rows: [], sel: null, settings: false };
  const CAT = { lab: "Lab test", imaging: "Scan", cardiac: "Heart & lung" };
  async function loadLabs() { const { data, error } = await A.sb.from("nav_lab_tests").select("*").order("sort"); if (error) { toast(error.message, true); return; } L.rows = data; renderLabs(); }
  const roomName = code => { const r = A.data.rooms.find(x => x.code === code); return r ? `${r.name_en} · ${N.floorName(r.floor_id)}` : code; };
  function renderLabs() {
    const q = $("lq").value.trim().toLowerCase();
    $("lbody").innerHTML = L.rows.filter(t => !q || `${t.name} ${t.department}`.toLowerCase().includes(q)).map(t => `<tr data-l="${esc(t.code)}" class="${L.sel === t.code ? "on" : ""}">
      <td><b>${esc(t.name)}</b><small>${CAT[t.category]} · ${esc(t.department)}</small></td><td>${esc(roomName(t.room_code))}</td><td>${t.price != null ? "₹" + t.price : "—"}</td>
      <td><span class="pill${t.active ? "" : " off"}">${t.active ? "Bookable" : "Hidden"}</span></td></tr>`).join("");
    const t = L.rows.find(x => x.code === L.sel), el = $("linsp");
    if (L.settings) return renderSettings();
    if (!t) { el.innerHTML = `<h3>Lab tests & scans</h3><p class="hint">${L.rows.length} bookable items. Lab tests share sample-collection slots; each scan or heart test is one patient per 20-minute slot in its room. "Where" is where the map sends the patient.</p>`; return; }
    el.innerHTML = `<h3>${t._new ? "New test" : "Test / scan"}</h3>
      <label class="field"><span class="lbl">Name *</span><input type="text" data-lk="name" value="${esc(t.name)}"></label>
      <div class="row"><label class="field"><span class="lbl">Type</span><select data-lk="category">${Object.entries(CAT).map(([k, v]) => N.opt(k, t.category, v)).join("")}</select></label>
      <label class="field"><span class="lbl">Department</span><input type="text" data-lk="department" value="${esc(t.department)}"></label></div>
      <label class="field"><span class="lbl">Where (room on the map)</span><select data-lk="room_code">${N.routable().map(r => N.opt(r.code, t.room_code, `${N.floorName(r.floor_id)} · ${r.name_en}`)).join("")}</select></label>
      <div class="row"><label class="field"><span class="lbl">Sample</span><input type="text" data-lk="sample" value="${esc(t.sample)}"></label><label class="field"><span class="lbl">Report time</span><input type="text" data-lk="turnaround" value="${esc(t.turnaround)}"></label></div>
      <label class="field"><span class="lbl">Preparation (shown to the patient)</span><textarea rows="2" data-lk="prep">${esc(t.prep)}</textarea></label>
      <div class="row"><label class="field"><span class="lbl">Price (₹)</span><input type="number" min="0" data-lk="price" value="${t.price ?? ""}"></label>
      ${t._new ? `<label class="field"><span class="lbl">Code</span><input type="text" data-lk="code" value="${esc(t.code)}" placeholder="e.g. hba1c"></label>` : ""}</div>
      <label class="chk"><input type="checkbox" data-lk="home_collection"${t.home_collection ? " checked" : ""}> Home sample collection available</label>
      <label class="chk"><input type="checkbox" data-lk="active"${t.active ? " checked" : ""}> Patients can book it</label>
      <div class="row"><button class="save" id="l-save">Save test</button><button class="tbtn" id="l-done">Close</button></div>`;
  }
  $("lq").addEventListener("input", renderLabs);
  $("lbody").addEventListener("click", e => { const tr = e.target.closest("[data-l]"); if (tr) { L.sel = tr.dataset.l; L.settings = false; renderLabs(); } });
  $("add-lab").addEventListener("click", () => { const code = "new-test"; L.rows = L.rows.filter(x => !x._new); L.rows.unshift({ _new: true, code, name: "", category: "lab", department: "", room_code: "sample-collection", sample: "Blood", prep: "", turnaround: "Same day", price: null, home_collection: false, active: true, sort: L.rows.length + 1 }); L.sel = code; L.settings = false; renderLabs(); });
  $("linsp").addEventListener("input", e => {
    const k = e.target.dataset.lk; if (!k) return; const t = L.rows.find(x => x.code === L.sel); if (!t) return;
    const v = e.target.type === "checkbox" ? e.target.checked : k === "price" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value;
    if (k === "code") { t.code = v; L.sel = v; } else t[k] = v;
  });
  $("linsp").addEventListener("click", async e => {
    if (e.target.id === "l-done") { L.rows = L.rows.filter(x => !x._new); L.sel = null; renderLabs(); return; }
    if (e.target.id === "s-save") return saveSettings();
    if (e.target.id !== "l-save") return;
    const t = L.rows.find(x => x.code === L.sel); if (!t.name.trim()) { toast("Name is required.", true); return; }
    if (!/^[a-z0-9-]{2,40}$/.test(t.code)) { toast("Code: 2–40 lowercase letters, digits or dashes.", true); return; }
    const { _new, ...row } = t;
    const { error } = await A.sb.from("nav_lab_tests").upsert(row, { onConflict: "code" });
    if (error) { toast(error.message, true); return; }
    toast("Saved."); L.sel = t.code; loadLabs();
  });

  const SET = [["booking_days_ahead", "Patients can book up to (days ahead)", "number"], ["lab_open", "Lab collection opens", "time"], ["lab_close", "Lab collection closes", "time"],
    ["lab_slot_capacity", "Lab patients per 15-min slot", "number"], ["imaging_open", "Scans from", "time"], ["imaging_close", "Scans until", "time"],
    ["app_url", "Visitor app address (used in email links)", "url"], ["support_phone", "Help line shown in emails", "text"], ["mail_from_name", "Email sender name", "text"]];
  function renderSettings() {
    const s = A.data.settings;
    $("linsp").innerHTML = `<h3>Booking settings</h3>${SET.map(([k, l, type]) => `<label class="field"><span class="lbl">${l}</span><input type="${type}" data-sk2="${k}" value="${esc(String(s[k] ?? "").slice(0, type === "time" ? 5 : 200))}"></label>`).join("")}
      <p class="hint">Doctor slots come from each doctor's weekly sessions (Doctors tab).</p><div class="row"><button class="save" id="s-save">Save settings</button></div>`;
  }
  $("bk-settings").addEventListener("click", () => { L.settings = true; L.sel = null; renderLabs(); });
  async function saveSettings() {
    const patch = {}; document.querySelectorAll("[data-sk2]").forEach(i => { patch[i.dataset.sk2] = i.type === "number" ? Number(i.value) : i.value; });
    const { error } = await A.sb.from("nav_settings").update(patch).eq("id", 1);
    if (error) { toast(error.message, true); return; }
    Object.assign(A.data.settings, patch); Object.assign(A.orig.settings, patch); toast("Booking settings saved.");
  }

  N.hooks.mode = m => { if (m === "appts") setView(B.view); if (m === "labs") loadLabs(); };
})();
