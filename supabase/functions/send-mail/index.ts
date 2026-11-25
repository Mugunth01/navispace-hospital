// send-mail: renders queued rows of nav_email_outbox and sends them.
// Provider: EmailJS (EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY, optional EMAILJS_TEMPLATE_ID =
// template_hospital). The EmailJS service is the admin@tefnotech.com mailbox; the template is {{{html}}} with
// subject {{subject}}, to {{to_email}}, from name {{from_name}}. Needs "Allow EmailJS API for non-browser
// applications" in EmailJS → Account → Security. Fallbacks: Brevo (BREVO_API_KEY + MAIL_FROM) or Resend (RESEND_API_KEY + MAIL_FROM).
// With no provider configured the rows are marked "skipped" but keep the rendered email,
// so the admin's Outbox still shows exactly what the patient would get.
// Safe to call publicly: it only sends what the database functions queued.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const KIND_LABEL: Record<string, string> = { inperson: "Doctor consultation (in person)", online: "Online consultation (video)", lab: "Lab test / scan" };
function niceDate(d: string, t: string) {
  const dt = new Date(`${d}T${t}:00`);
  const day = dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const [h, m] = t.split(":").map(Number);
  return `${day}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function gcal(title: string, d: string, t: string, mins: number, where: string) {
  const s = `${d.replace(/-/g, "")}T${t.replace(":", "")}00`;
  const end = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +t.slice(0, 2), +t.slice(3, 5) + mins));
  const e = end.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${s}/${e}&ctz=Asia/Kolkata&location=${encodeURIComponent(where)}`;
}

function render(row: any, a: any, doc: any, room: any, floor: any, tests: any[], st: any, appUrl: string) {
  const H = esc(st?.hospital_name || "Hospital");
  const when = niceDate(a.appt_date, a.slot_time.slice(0, 5));
  const what = a.kind === "lab" ? tests.map((t) => t.name).join(", ") : `${doc?.name ?? "Doctor"} · ${doc?.speciality ?? ""}`;
  const where = a.kind === "online" ? "Online (video call)" : a.home_collection ? "Home sample collection" : room ? `${room.name_en}${floor ? ` · ${floor.name_en}` : ""}` : "";
  const roomCode = a.room_code === "lab:collection" ? "sample-collection" : a.room_code;
  const manage = appUrl ? `${appUrl}/?booking=${encodeURIComponent(a.ref)}&t=${a.cancel_token}` : "";
  const directions = appUrl && roomCode && a.kind !== "online" && !a.home_collection ? `${appUrl}/?to=${encodeURIComponent(roomCode)}` : "";
  const rebook = appUrl ? (a.doctor_id ? `${appUrl}/?book=${a.doctor_id}` : `${appUrl}/?book=lab`) : "";
  const reason = row.extra?.reason ? esc(row.extra.reason) : "";
  let subject = "", intro = "", buttons: [string, string][] = [];
  switch (row.kind) {
    case "booked":
      subject = `Booking confirmed · ${a.ref} · ${when}`;
      intro = `Your booking is confirmed. Please arrive 15 minutes early${a.kind === "lab" ? " with this booking ID" : ""}.`;
      buttons = [
        ...(a.video_url ? [["Join video consultation", a.video_url] as [string, string]] : []),
        ...(directions ? [["Directions inside the hospital", directions] as [string, string]] : []),
        ["Add to Google Calendar", gcal(`${a.kind === "lab" ? "Lab test" : "Appointment"} · ${st?.hospital_name ?? ""}`, a.appt_date, a.slot_time.slice(0, 5), doc?.slot_minutes ?? 15, a.video_url || where)],
        ...(manage ? [["View or cancel booking", manage] as [string, string]] : []),
      ];
      break;
    case "cancelled_patient":
      subject = `Booking cancelled · ${a.ref}`;
      intro = "Your booking has been cancelled as you requested.";
      buttons = rebook ? [["Book again", rebook]] : [];
      break;
    case "cancelled_hospital":
    case "leave_cancel":
      subject = `Sorry — your appointment on ${when} is cancelled · ${a.ref}`;
      intro = `We are sorry: ${row.kind === "leave_cancel" ? "the doctor is not available on this day" : "we had to cancel your appointment"}${reason ? ` (${reason})` : ""}. Please choose another slot — it takes a minute.`;
      buttons = rebook ? [["Choose a new slot", rebook]] : [];
      break;
    case "rescheduled":
      subject = `Appointment moved to ${when} · ${a.ref}`;
      intro = `Your appointment has been moved from ${esc(niceDate(row.extra?.old_date, row.extra?.old_time))} to the time below${reason ? ` (${reason})` : ""}. If the new time does not suit you, you can cancel and book again.`;
      buttons = [...(directions ? [["Directions inside the hospital", directions] as [string, string]] : []), ...(manage ? [["View or cancel booking", manage] as [string, string]] : [])];
      break;
  }
  const prep = a.kind === "lab" ? tests.filter((t) => t.prep).map((t) => `<li><b>${esc(t.name)}:</b> ${esc(t.prep)}</li>`).join("") : "";
  const rows: [string, string][] = [["Booking ID", `<b style="font-size:18px;letter-spacing:1px">${esc(a.ref)}</b>`], ["Type", esc(KIND_LABEL[a.kind])], [a.kind === "lab" ? "Tests" : "Doctor", esc(what)], ["Date & time", esc(when)], ["Where", esc(where)]];
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#1d4ed8;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${H}</td></tr>
<tr><td style="padding:22px 24px 6px">
<p style="margin:0 0 6px">Dear ${esc(a.patient_name)},</p>
<p style="margin:0 0 16px;line-height:1.5">${intro}</p>
<table role="presentation" width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="color:#64748b;width:120px;border-bottom:1px solid #f1f5f9">${k}</td><td style="border-bottom:1px solid #f1f5f9">${v}</td></tr>`).join("")}
</table>
${prep && row.kind === "booked" ? `<p style="margin:16px 0 4px;font-weight:600">Before you come</p><ul style="margin:0;padding-left:18px;line-height:1.6;font-size:14px">${prep}</ul>` : ""}
</td></tr>
<tr><td style="padding:14px 24px 8px">${buttons.map(([l, u]) => `<a href="${esc(u)}" style="display:inline-block;margin:0 8px 10px 0;padding:10px 16px;border-radius:9px;background:${l.startsWith("Join") || l.startsWith("Choose") || l.startsWith("Book") ? "#1d4ed8" : "#e0e7ff"};color:${l.startsWith("Join") || l.startsWith("Choose") || l.startsWith("Book") ? "#fff" : "#1e3a8a"};text-decoration:none;font-weight:600;font-size:14px">${esc(l)}</a>`).join("")}</td></tr>
<tr><td style="padding:6px 24px 22px;color:#64748b;font-size:12px;line-height:1.5">${st?.support_phone ? `Questions? Call ${esc(st.support_phone)}. ` : ""}This is an automated message from ${H}. In an emergency, go straight to the Emergency department.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

async function deliver(to: string, subject: string, html: string, fromName: string) {
  const ejsService = Deno.env.get("EMAILJS_SERVICE_ID"), ejsPublic = Deno.env.get("EMAILJS_PUBLIC_KEY"), ejsPrivate = Deno.env.get("EMAILJS_PRIVATE_KEY");
  if (ejsService && ejsPublic && ejsPrivate) {
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: ejsService, template_id: Deno.env.get("EMAILJS_TEMPLATE_ID") || "template_hospital", user_id: ejsPublic, accessToken: ejsPrivate,
        template_params: { to_email: to, subject, html, from_name: fromName } }),
    });
    return r.ok ? { status: "sent", provider: "emailjs", error: null } : { status: "failed", provider: "emailjs", error: `${r.status} ${(await r.text()).slice(0, 300)}` };
  }
  const from = Deno.env.get("MAIL_FROM");
  const brevo = Deno.env.get("BREVO_API_KEY"), resend = Deno.env.get("RESEND_API_KEY");
  if (!from || (!brevo && !resend)) return { status: "skipped", provider: null, error: "No email provider configured (set the EMAILJS_* secrets)" };
  if (brevo) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": brevo, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: to }], subject, htmlContent: html }),
    });
    return r.ok ? { status: "sent", provider: "brevo", error: null } : { status: "failed", provider: "brevo", error: `${r.status} ${(await r.text()).slice(0, 300)}` };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, html }),
  });
  return r.ok ? { status: "sent", provider: "resend", error: null } : { status: "failed", provider: "resend", error: `${r.status} ${(await r.text()).slice(0, 300)}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Claim up to 25 queued rows (rows another call already claimed are not returned).
  const { data: q } = await sb.from("nav_email_outbox").select("id").eq("status", "queued").order("id").limit(25);
  if (!q?.length) return json({ processed: 0 });
  const { data: rows, error } = await sb.from("nav_email_outbox").update({ status: "sending" }).in("id", q.map((r) => r.id)).eq("status", "queued").select("*");
  if (error) return json({ error: error.message }, 500);
  const { data: st } = await sb.from("nav_settings").select("*").eq("id", 1).maybeSingle();
  const appUrl = (st?.app_url || req.headers.get("origin") || "").replace(/\/$/, "");
  const out = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  for (const row of rows ?? []) {
    out.processed++;
    try {
      const { data: a } = await sb.from("nav_appointments").select("*").eq("id", row.appointment_id).single();
      const { data: doc } = a.doctor_id ? await sb.from("nav_doctors").select("*").eq("id", a.doctor_id).maybeSingle() : { data: null };
      const roomCode = a.room_code === "lab:collection" ? "sample-collection" : a.room_code;
      const { data: room } = roomCode ? await sb.from("nav_rooms").select("name_en,floor_id").eq("code", roomCode).maybeSingle() : { data: null };
      const { data: floor } = room ? await sb.from("nav_floors").select("name_en").eq("id", room.floor_id).maybeSingle() : { data: null };
      const { data: tests } = a.test_codes?.length ? await sb.from("nav_lab_tests").select("name,prep,sort").in("code", a.test_codes).order("sort") : { data: [] };
      const { subject, html } = render(row, a, doc, room, floor, tests ?? [], st, appUrl);
      const res = await deliver(row.to_email, subject, html, st?.mail_from_name || st?.hospital_name || "Hospital");
      out[res.status as "sent" | "skipped" | "failed"]++;
      await sb.from("nav_email_outbox").update({ status: res.status, provider: res.provider, error: res.error, subject, html, sent_at: res.status === "sent" ? new Date().toISOString() : null }).eq("id", row.id);
    } catch (e) {
      out.failed++;
      await sb.from("nav_email_outbox").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", row.id);
    }
  }
  return json(out);
});
