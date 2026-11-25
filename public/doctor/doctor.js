/* NaviSpace Hospital – doctor portal: own appointments (done / no-show / move / cancel), leave, profile + photo + weekly sessions.
   A doctor can only see and change their own data (row level security + nav_* functions). */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const t12 = t => { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`; };
  const dayLabel = s => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  const WD = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const STATUS = { booked: "Booked", completed: "Done", cancelled: "Cancelled", no_show: "No-show" };
  function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000); }

  const cfg = window.NAVI_CONFIG;
  if (!cfg || !window.supabase) { $("login").hidden = false; $("lmsg").textContent = "Supabase is not configured (admin/config.js)."; return; }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const kickMail = () => fetch(`${cfg.supabaseUrl}/functions/v1/send-mail`, { method: "POST", headers: { apikey: cfg.supabaseKey, "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  const S = { doc: null, tab: "today", appts: [], open: null, sessions: [] };

  $("lform").addEventListener("submit", async e => {
    e.preventDefault(); $("lmsg").textContent = "…";
    const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("pw").value });
    if (error) { $("lmsg").textContent = error.message; return; }
    await start();
  });
  $("dp-out").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  async function start() {
    const { data: id } = await sb.rpc("nav_my_doctor_id");
    if (!id) { $("login").hidden = false; $("lmsg").textContent = "This login isn't linked to a doctor. Ask the hospital admin."; await sb.auth.signOut(); return; }
    const { data: doc } = await sb.from("nav_doctors").select("*").eq("id", id).single();
    S.doc = doc; $("login").hidden = true; $("dp-out").hidden = false; $("dp-tabs").hidden = false;
    $("dp-title").innerHTML = `${esc(doc.name)}<small>${esc(doc.speciality)}</small>`;
    render();
  }
  $("dp-tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; S.tab = b.dataset.tab; S.open = null; document.querySelectorAll("#dp-tabs button").forEach(x => x.setAttribute("aria-selected", x === b)); render(); });

  async function render() {
    if (["today", "upcoming", "past"].includes(S.tab)) return renderAppts();
    if (S.tab === "leave") return renderLeave();
    return renderProfile();
  }

  /* ── appointments ─────────────────────────────────────────────────────── */
  async function renderAppts() {
    const today = ymd(new Date());
    let q = sb.from("nav_appointments").select("*").eq("doctor_id", S.doc.id);
    if (S.tab === "today") q = q.eq("appt_date", today).order("slot_time");
    else if (S.tab === "upcoming") q = q.gt("appt_date", today).lte("appt_date", addDays(today, 60)).order("appt_date").order("slot_time");
    else q = q.lt("appt_date", today).gte("appt_date", addDays(today, -60)).order("appt_date", { ascending: false }).order("slot_time");
    const { data, error } = await q.limit(500);
    if (error) { toast(error.message, true); return; }
    S.appts = data;
    const c = s => data.filter(a => a.status === s).length;
    let h = S.tab === "today" ? `<div class="dpsum"><span><b>${c("booked")}</b>waiting</span><span><b>${c("completed")}</b>done</span><span><b>${data.filter(a => a.kind === "online" && a.status === "booked").length}</b>online</span><span><b>${c("cancelled")}</b>cancelled</span></div>` : "";
    if (!data.length) h += `<div class="empty">${S.tab === "today" ? "No appointments today." : S.tab === "upcoming" ? "No upcoming appointments in the next 60 days." : "No appointments in the last 60 days."}</div>`;
    let lastDay = null;
    for (const a of data) {
      if (S.tab !== "today" && a.appt_date !== lastDay) { h += `<h4 class="dpday">${dayLabel(a.appt_date)}</h4>`; lastDay = a.appt_date; }
      const open = S.open === a.id;
      h += `<article class="appt ${a.status}" data-a="${a.id}">
        <div class="apHead"><span class="apTime">${t12(a.slot_time)}</span><span class="apName">${esc(a.patient_name)}</span><span class="pill st-${a.status}">${STATUS[a.status]}</span></div>
        <div class="apMeta"><span>${a.kind === "online" ? "Online video" : "Clinic visit"}</span><span>${a.age != null ? a.age + " yrs" : ""}${a.gender ? " · " + esc(a.gender) : ""}</span>
          <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a><span class="mono">${esc(a.ref)}</span></div>
        ${a.reason ? `<div class="apReason">${esc(a.reason)}</div>` : ""}
        ${a.cancel_reason ? `<div class="apMeta">Cancelled by ${esc(a.cancelled_by)} — ${esc(a.cancel_reason)}</div>` : ""}
        ${a.status === "booked" ? `<div class="apActs">
          ${a.video_url ? `<a class="tbtn join" href="${esc(a.video_url)}" target="_blank" rel="noopener">Join video</a>` : ""}
          <button class="tbtn" data-act="completed">Done</button><button class="tbtn" data-act="no_show">No-show</button>
          <button class="tbtn" data-more="1">${open ? "Close" : "Move / cancel"}</button></div>
          ${open ? `<div class="apMore">
            <div class="row"><input type="date" id="mv-date" value="${a.appt_date}" min="${today}"><select id="mv-time"><option value="">Loading…</option></select></div>
            <input type="text" id="mv-reason" placeholder="Reason for the patient (e.g. Emergency surgery)">
            <div class="apActs"><button class="tbtn" data-act="reschedule">Move to this time</button><button class="danger" data-act="cancel">Cancel appointment</button></div>
            <p class="hint">The patient gets an email with the reason and a link to book again.</p></div>` : ""}` : ""}
      </article>`;
    }
    $("dp-main").innerHTML = h;
    if (S.open) loadMoveSlots();
  }
  async function loadMoveSlots() {
    const a = S.appts.find(x => x.id === S.open), sel = $("mv-time"); if (!a || !sel) return;
    const { data } = await sb.rpc("nav_doctor_slots", { p_doctor: S.doc.id, p_date: $("mv-date").value, p_mode: a.kind });
    const free = (data || []).filter(x => x.available);
    sel.innerHTML = `<option value="">${free.length ? "Pick a time…" : "No free slots that day"}</option>` + free.map(x => `<option value="${x.slot.slice(0, 5)}">${t12(x.slot)}</option>`).join("");
  }
  $("dp-main").addEventListener("change", e => { if (e.target.id === "mv-date") loadMoveSlots(); });
  $("dp-main").addEventListener("click", async e => {
    const card = e.target.closest("[data-a]");
    if (card && e.target.closest("[data-more]")) { S.open = S.open === card.dataset.a ? null : card.dataset.a; return renderAppts(); }
    const b = card && e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, args = { p_id: card.dataset.a, p_action: act, p_reason: act === "cancel" || act === "reschedule" ? ($("mv-reason")?.value || "") : "" };
    if (act === "reschedule") { args.p_date = $("mv-date").value; args.p_time = $("mv-time").value; if (!args.p_time) { toast("Pick a new time.", true); return; } }
    if (act === "cancel" && !confirm("Cancel this appointment? The patient will be emailed.")) return;
    const { error } = await sb.rpc("nav_staff_update", args);
    if (error) { toast(error.message, true); return; }
    if (act === "cancel" || act === "reschedule") kickMail();
    S.open = null; toast({ completed: "Marked done.", no_show: "Marked no-show.", cancel: "Cancelled — patient notified.", reschedule: "Moved — patient notified." }[act]); renderAppts();
  });

  /* ── leave ────────────────────────────────────────────────────────────── */
  async function renderLeave() {
    const { data } = await sb.from("nav_doctor_leaves").select("*").eq("doctor_id", S.doc.id).gte("to_date", ymd(new Date())).order("from_date");
    $("dp-main").innerHTML = `<section class="card"><h3>Add leave</h3>
      <p class="hint">Patients can't book on these days. Existing bookings on these days are cancelled and the patients get an email with a link to rebook.</p>
      <div class="row"><label class="field"><span class="lbl">From</span><input type="date" id="lv-from" min="${ymd(new Date())}"></label><label class="field"><span class="lbl">To</span><input type="date" id="lv-to" min="${ymd(new Date())}"></label></div>
      <label class="field"><span class="lbl">Reason (shown to patients)</span><input type="text" id="lv-reason" placeholder="e.g. Attending a conference"></label>
      <button class="primary" id="lv-add">Add leave</button></section>
      <section class="card"><h3>Upcoming leave</h3>${(data || []).map(l => `<div class="lvrow">${dayLabel(l.from_date)}${l.to_date !== l.from_date ? " – " + dayLabel(l.to_date) : ""} · ${esc(l.reason || "Leave")} <button class="linkbtn" data-lvrm="${l.id}">Remove</button></div>`).join("") || '<p class="hint">None.</p>'}</section>`;
  }

  /* ── profile ──────────────────────────────────────────────────────────── */
  async function renderProfile() {
    const d = S.doc;
    const { data: ss } = await sb.from("nav_doctor_sessions").select("*").eq("doctor_id", d.id).order("mode").order("weekday").order("start_time");
    S.sessions = (ss || []).map(x => ({ weekday: x.weekday, start_time: x.start_time.slice(0, 5), end_time: x.end_time.slice(0, 5), mode: x.mode }));
    const initials = d.name.replace(/^Dr\.?\s*/i, "").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    $("dp-main").innerHTML = `<section class="card"><h3>Profile — what patients see</h3>
      <div class="photoRow">${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : `<span class="ph">${esc(initials)}</span>`}
        <div><label class="tbtn">Upload photo<input type="file" id="ph" accept="image/jpeg,image/png,image/webp" hidden></label>${d.photo_url ? ' <button class="linkbtn" id="ph-rm">Remove</button>' : ""}<p class="hint">A clear, front-facing photo works best.</p></div></div>
      <label class="field"><span class="lbl">Role / designation</span><input type="text" id="p-designation" value="${esc(d.designation)}" maxlength="120"></label>
      <label class="field"><span class="lbl">Qualification</span><input type="text" id="p-qualification" value="${esc(d.qualification)}" maxlength="160"></label>
      <div class="row"><label class="field"><span class="lbl">Experience (years)</span><input type="number" id="p-experience_years" min="0" max="70" value="${d.experience_years ?? ""}"></label>
      <label class="field"><span class="lbl">Languages</span><input type="text" id="p-languages" value="${esc(d.languages)}" maxlength="120"></label></div>
      <label class="field"><span class="lbl">About you</span><textarea id="p-bio" rows="5" maxlength="1200">${esc(d.bio)}</textarea></label></section>
      <section class="card"><h3>Weekly sessions</h3>
      <div class="row"><label class="field"><span class="lbl">Minutes per patient</span><select id="p-slot_minutes">${[10, 15, 20, 30].map(m => `<option value="${m}"${m === d.slot_minutes ? " selected" : ""}>${m} min</option>`).join("")}</select></label>
      <label class="chk"><input type="checkbox" id="p-online_enabled"${d.online_enabled ? " checked" : ""}> I offer online consultations</label></div>
      <table class="stable" id="sess"></table>
      <div class="apActs"><button class="tbtn" data-add="inperson">+ Clinic session</button><button class="tbtn" data-add="online">+ Online session</button></div></section>
      <button class="primary" id="p-save">Save profile & sessions</button>
      <section class="card"><h3>Change password</h3><div class="row"><input type="password" id="pw1" placeholder="New password (8+)" autocomplete="new-password"><button class="tbtn" id="pw-save">Change password</button></div></section>`;
    drawSessions();
  }
  function drawSessions() {
    $("sess").innerHTML = S.sessions.map((s, i) => `<tr data-i="${i}"><td><select data-k="weekday">${WD.slice(1).map((w, j) => `<option value="${j + 1}"${j + 1 === s.weekday ? " selected" : ""}>${w}</option>`).join("")}</select></td>
      <td><input type="time" data-k="start_time" value="${s.start_time}"></td><td><input type="time" data-k="end_time" value="${s.end_time}"></td>
      <td><select data-k="mode"><option value="inperson"${s.mode === "inperson" ? " selected" : ""}>Clinic</option><option value="online"${s.mode === "online" ? " selected" : ""}>Online</option></select></td>
      <td><button class="linkbtn" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`).join("") || '<tr><td class="hint">No sessions — patients cannot book you.</td></tr>';
  }
  async function resizeImage(file, max = 480) {
    const img = await createImageBitmap(file); const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, "image/webp", 0.85));
  }
  $("dp-main").addEventListener("input", e => {
    const tr = e.target.closest("[data-i]"); if (!tr || !e.target.dataset.k) return;
    const s = S.sessions[+tr.dataset.i]; s[e.target.dataset.k] = e.target.dataset.k === "weekday" ? +e.target.value : e.target.value;
  });
  $("dp-main").addEventListener("change", async e => {
    if (e.target.id !== "ph" || !e.target.files[0]) return;
    try {
      const blob = await resizeImage(e.target.files[0]), path = `${S.doc.id}/photo-${Date.now()}.webp`;
      const { error } = await sb.storage.from("doctor-photos").upload(path, blob, { contentType: "image/webp", upsert: true }); if (error) throw error;
      const url = sb.storage.from("doctor-photos").getPublicUrl(path).data.publicUrl;
      const { error: e2 } = await sb.rpc("nav_doctor_save_profile", { p: { photo_url: url } }); if (e2) throw e2;
      S.doc.photo_url = url; toast("Photo updated."); renderProfile();
    } catch (err) { toast("Upload failed: " + (err.message || err), true); }
  });
  $("dp-main").addEventListener("click", async e => {
    const t = e.target.closest("button"); if (!t) return;
    try {
      if (t.dataset.add) { S.sessions.push({ weekday: 1, start_time: t.dataset.add === "online" ? "14:00" : "09:00", end_time: t.dataset.add === "online" ? "15:00" : "13:00", mode: t.dataset.add }); return drawSessions(); }
      if (t.dataset.rm != null) { S.sessions.splice(+t.dataset.rm, 1); return drawSessions(); }
      if (t.id === "ph-rm") { const { error } = await sb.rpc("nav_doctor_save_profile", { p: { photo_url: "" } }); if (error) throw error; S.doc.photo_url = null; return renderProfile(); }
      if (t.id === "p-save") {
        if (S.sessions.some(s => s.end_time <= s.start_time)) { toast("Each session must end after it starts.", true); return; }
        const p = { sessions: S.sessions };
        for (const k of ["designation", "qualification", "experience_years", "languages", "bio", "slot_minutes"]) p[k] = $("p-" + k).value;
        p.online_enabled = $("p-online_enabled").checked;
        const { error } = await sb.rpc("nav_doctor_save_profile", { p }); if (error) throw error;
        const { data } = await sb.from("nav_doctors").select("*").eq("id", S.doc.id).single(); S.doc = data;
        toast("Saved. Patients see the changes right away."); return renderProfile();
      }
      if (t.id === "pw-save") { const pw = $("pw1").value; if (pw.length < 8) { toast("Use at least 8 characters.", true); return; } const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; $("pw1").value = ""; toast("Password changed."); return; }
      if (t.id === "lv-add") {
        const f = $("lv-from").value, to = $("lv-to").value || f; if (!f) { toast("Pick the dates.", true); return; }
        const { data, error } = await sb.rpc("nav_add_leave", { p_from: f, p_to: to, p_reason: $("lv-reason").value }); if (error) throw error;
        kickMail(); toast(data.cancelled ? `Leave added — ${data.cancelled} booking(s) cancelled, patients notified.` : "Leave added."); return renderLeave();
      }
      if (t.dataset.lvrm) { const { error } = await sb.rpc("nav_remove_leave", { p_id: t.dataset.lvrm }); if (error) throw error; toast("Leave removed."); return renderLeave(); }
    } catch (err) { toast(err.message || String(err), true); }
  });

  const { data: s } = await sb.auth.getSession();
  if (s.session) await start(); else $("login").hidden = false;
})();
