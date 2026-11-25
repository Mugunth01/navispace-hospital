// admin-doctor-account: the hospital admin creates / resets / removes a doctor's login.
// Called from /admin with the admin's own session token. Only emails in public.admins may use it.
// body: { action: 'create' | 'reset' | 'remove', doctor_id, email?, password? }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = token ? await sb.auth.getUser(token) : { data: null };
  const email = who?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Please sign in again." }, 401);
  const { data: adm } = await sb.from("admins").select("email").ilike("email", email).maybeSingle();
  if (!adm) return json({ error: "Only hospital admins can manage doctor logins." }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const { action, doctor_id } = body ?? {};
  const newEmail = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const { data: d0 } = await sb.from("nav_doctors").select("id,name").eq("id", doctor_id).maybeSingle();
  if (!d0) return json({ error: "Doctor not found." }, 404);
  const { data: acc } = await sb.from("nav_doctor_accounts").select("user_id,email").eq("doctor_id", doctor_id).maybeSingle();
  const doc = { ...d0, user_id: acc?.user_id ?? null, email: acc?.email ?? null };
  if (password && password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  if (action === "create") {
    if (doc.user_id) return json({ error: "This doctor already has a login. Use reset instead." }, 409);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail) || !password) return json({ error: "Enter the doctor's email and a password (8+ characters)." }, 400);
    const { data: adminRow } = await sb.from("admins").select("email").ilike("email", newEmail).maybeSingle();
    if (adminRow) return json({ error: "That email belongs to an admin. Use a separate email for the doctor." }, 400);
    const { data, error } = await sb.auth.admin.createUser({ email: newEmail, password, email_confirm: true, user_metadata: { role: "doctor", doctor_id } });
    if (error) return json({ error: /registered|exists/i.test(error.message) ? "A login with this email already exists." : error.message }, 400);
    const { error: e2 } = await sb.from("nav_doctor_accounts").insert({ doctor_id, user_id: data.user.id, email: newEmail });
    if (e2) { await sb.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
    return json({ ok: true, email: newEmail });
  }
  if (action === "reset") {
    if (!doc.user_id) return json({ error: "This doctor has no login yet." }, 400);
    const patch: Record<string, unknown> = {};
    if (password) patch.password = password;
    if (newEmail && newEmail !== doc.email) { patch.email = newEmail; patch.email_confirm = true; }
    if (!Object.keys(patch).length) return json({ error: "Nothing to change." }, 400);
    const { error } = await sb.auth.admin.updateUserById(doc.user_id, patch);
    if (error) return json({ error: error.message }, 400);
    if (patch.email) await sb.from("nav_doctor_accounts").update({ email: newEmail }).eq("doctor_id", doctor_id);
    return json({ ok: true });
  }
  if (action === "remove") {
    if (doc.user_id) await sb.auth.admin.deleteUser(doc.user_id);   // cascades to nav_doctor_accounts
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
});
