# NaviSpace Hospital — v5 pilot (navigation + appointments)

Indoor navigation for a hospital, built on the **NaviSpace (Brookefields) map engine**: the same
3D look, FROM / TO route card, panda guide, view modes (Standard · Street · Top, and Follow · First person · Top
while navigating), "Front view" of a block, and the lift-cabin sequence. The mall's offers, rewards, games,
parking and visitor login are removed; doctors, hospital departments and **appointments** are added:
doctor visits, online (video) consultations and lab tests / scans, a **doctor portal**, and email notifications.
It is a generic product: every name, room, doctor and test comes from the database and is edited in the admin.

## What's in the box
| Path | What it is |
|---|---|
| `dist/` | **Ready to host.** Upload this folder to Netlify / Vercel / any static host. `dist/admin/` = admin, `dist/doctor/` = doctor portal. |
| `src/` | Visitor app source (React + react-three-fiber) |
| `src/data/floors.js` | Hospital geometry, installed at start-up from the database (`configureLayout`) |
| `src/data/api/index.js` | Reads the `nav_*` tables over Supabase REST (no client library → small bundle) |
| `src/components/hospital/` | Doctors tab, search with doctors, room page, quick tiles, menu |
| `src/booking/` | Booking overlay (doctor profile, slots, form, confirmation, my booking, lab tests). Loaded only when opened (~10 KB gz) |
| `public/admin/` | Admin: layout editor, Doctors (profile, photo, sessions, login, leave), Bookings + email outbox, Lab tests, booking settings |
| `public/doctor/` | Doctor portal: today / upcoming / past appointments, move / cancel, leave, profile + photo + weekly sessions |
| `scripts/hospital-layout.mjs` | Generates the sample 2-floor layout + doctors (`npm run layout`); v4 = KMCH-scale ground plan |
| `supabase/hospital_schema.sql`, `booking_schema.sql`, `hospital_seed.sql` | Layout tables, booking tables + functions (RLS on), sample data |
| `supabase/functions/send-mail`, `admin-doctor-account` | Edge functions: email sender, admin creates doctor logins |
| `src/__tests__/hospitalRouting.test.js` | Every start point → every room on both floors must route |

## Run
```bash
npm install
npm run dev        # http://localhost:5173  (admin: /admin/)
npm test           # route sweep: every start point × every room, both floors
npm run build      # -> dist/   (reads the live Supabase tables)
npm run build:singlefile   # one self-contained HTML demo on the bundled sample data
```

## Links and QR codes
- Destination: `/?to=cardiology-room-101` (any room code; also `#cardiology-room-101`)
- Start + destination (kiosk poster / appointment slip): `/?from=kiosk-reception&to=x-ray`
- Start points in the sample: `main-entrance` (OPD block, south side), `emergency-entrance`, `kiosk-reception`, `kiosk-1f-lifts`

## Supabase
Project `navispace-hospital` (`xjpntesuntkspxgzxvey`, Mumbai), org "mugunthanr01@gmail.com's Org".
This version uses its **own tables**: `nav_settings, nav_floors, nav_rooms, nav_walkways, nav_start_points, nav_doctors`.
The earlier v2 tables in the same project (`rooms`, `doctors`, …) were **not touched**.
Everyone can read; only emails in `public.admins` can write (`yashwanthsurya97@gmail.com` is listed).

**First admin login:** Supabase → Authentication → URL Configuration → set Site URL to your hosted address.
Open `/admin/`, "First time? Create your account" with the admin email, confirm the email, sign in.

## Editing the hospital (admin)
- **Layout:** rooms are rectangles with one door; corridors are rectangles. Routes follow each corridor's
  centre line; a side corridor that runs into another is joined automatically. Every room needs an
  English and a Tamil name; a red "door" warning means the door doesn't touch a corridor (not routable).
- **Lifts / stairs:** give the rooms on each floor the same *link group* (e.g. `LIFT-A`). Lift rooms are drawn
  as lift cars (about one car per 1.2 units of wall).
- **Garden / service area:** drawn but never routed.
- **Doctors:** name, speciality, qualification, room, OPD days and hours, show/hide. Search finds doctors by
  name or speciality and "Directions" goes to their room. A room with doctors can't be deleted until they move.
- Visitors see changes the next time they open the map.

## Why it is lighter than the earlier hospital demo
- The NaviSpace engine draws each room as one extruded block (no per-room furniture), repeated props are instanced.
- Room-name textures are capped at 100 px per map unit (the mall used up to 256): about 6× less texture memory.
- The visitor bundle has no Supabase client, no portals, no games: ~73 KB + ~315 KB gzipped (mall: 500 KB+),
  and the app code downloads while the data loads.

## Scale (from v4, modelled on KMCH's ground floor)
- Footprint 96 x 40 map units = **240 m x 100 m** per floor (v3 was 162 m x 68 m: ~2.2x the area).
- OPD-block entrance lobby in the middle of the south side (Registration, Cash Counters, Insurance Desk,
  May I Help You, OP Pharmacy, Admissions); one 240 m main spine with wings left and right around garden
  courtyards (v5 below). Walks from the entrance to the far wings are ~135-175 m (KMCH: ~120-140 m).
- Ground floor departments follow KMCH's ground floor: Radiology (X-Ray 1 & 2, CT, MRI, Cath Lab, Cath Lab 2),
  Rehabilitation (Physio, Occupational/Speech therapy), Administration (HR, Purchase, Legal, Admin),
  Patient care (Baby Feeding Room, Children's Play Area), ENT Procedure Room, Security Office, IP Pharmacy,
  plus Emergency, Laboratory/Blood Bank and Cafeteria near the entrance.

## v5: 4-column wings, more lifts, real lab names
- Each wing has **two corridors and four room columns**, joined at the far end by a cross corridor, so routes can go
  up one side and come back the other (left / right loop). 5 wide wings + the entrance lobby per floor.
- **4 lift banks** (A, B beside the lobby; C west; D east), 4 staircases, 4 restrooms per floor.
- Laboratory wing with the real department names: Sample Collection, Biochemistry, Haematology, Clinical Pathology,
  Microbiology, Histopathology, Cytology, Immunology & Serology, Molecular Diagnostics (PCR), Blood Bank, Transfusion Medicine…
  Radiology: X-Ray 1–2, CT, MRI, Ultrasound 1–2, Doppler, Mammography, DEXA, Fluoroscopy, Cath Lab 1–2, Nuclear Medicine, PET-CT.
- 268 rooms, **71 fictional doctors** (random names from a fixed seed, with designation, experience, languages, bio
  and weekly sessions), 30 bookable lab tests and scans with preparation notes and prices.

## Appointments
**Patients** (no account needed): Doctors tab → doctor → profile → *Book clinic visit* or *Book online consultation* →
date + time → name, mobile, email, age, reason, consent → booking ID. *Lab tests & scans*: pick several lab tests (one
collection slot) or one scan → date + time (home collection if every test allows it) → booking ID with preparation notes.
The confirmation offers Directions inside the hospital (the map routes to the room), Add to Google Calendar, the video link
(online: a free Jitsi room per booking), and a manage link. *My booking* (booking ID + mobile) shows / cancels a booking.

Rules enforced in the database (not just the screen): one patient per doctor slot, no past slots, doctor leave days
blocked, at most 3 upcoming bookings per mobile number, one booking per doctor per day per mobile, scans one at a time
(and not on Sundays), lab slot capacity, consent required. Patients never read the bookings table; they use functions that
return only their own booking, by ID + secret token.

**Doctors** (`/doctor/`, login created by the admin): Today / Upcoming / Past lists with patient, age, phone, reason;
*Done*, *No-show*, *Move* (free slots only) and *Cancel* (reason is emailed to the patient with a rebook link);
*Leave* (cancels the bookings in those days and emails each patient); *Profile*: photo, role, qualification, experience,
languages, about, minutes per patient, online on/off, weekly clinic and online sessions; change password.
A doctor sees only their own appointments.

**Admin** (`/admin/`): Doctors → profile fields, photo upload, weekly sessions, *Create login* (email + password, no
email needed), reset password, remove login, add leave. Bookings → filter by date / type / status, details, done /
no-show / move / cancel; Email outbox → every email with a preview and its status. Lab tests → edit name, room, prep,
price, home collection; Booking settings → booking window, lab and scan hours, lab capacity, app address for email links,
help line, sender name.

## Email (EmailJS, sent from admin@tefnotech.com)
Emails: booking confirmed, cancelled (by the patient / by the hospital), moved, doctor leave. The database queues them;
the `send-mail` edge function renders each one and sends it through **EmailJS** (free: 200 emails/month).
- EmailJS template `template_hospital` (already created): subject `{{subject}}`, to `{{to_email}}`, from name `{{from_name}}`,
  reply-to admin@tefnotech.com, "Do not save private data" on. Body = `supabase/emailjs-template.html`, filled with named fields:
  `hospital_name heading accent patient_name message booking_id booking_type who_label who date_time location`
  plus optional `previous_date_time` (moved), `prep` (lab), `button1..3_label/_url`, `support_line`.
- EmailJS → Email Services: connect the **admin@tefnotech.com** mailbox (this is what makes it the sender).
- EmailJS → Account → Security: tick **Allow EmailJS API for non-browser applications** (the function sends from the server, so the
  private key never reaches the browser).
- Supabase → Edge Functions → Secrets: `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`
  (optional `EMAILJS_TEMPLATE_ID`, default `template_hospital`).
Until these are set, emails are marked *skipped* in the admin outbox with a full preview. (Brevo / Resend still work as fallbacks.)

## Admin login
One admin: **admin@tefnotech.com** (the only row in `public.admins`). The admin page has no sign-up; create the account once in
Supabase → Authentication → Users → *Add user* (email + password, auto-confirm). Doctors get their logins from the admin.

## Going live on a Supabase project
1. SQL editor: run `supabase/hospital_schema.sql` (fresh project only), then `supabase/booking_schema.sql`, then
   `supabase/hospital_seed.sql` (sample hospital — replaces layout, doctors, tests and bookings).
2. Deploy the functions: `supabase functions deploy send-mail --no-verify-jwt` and
   `supabase functions deploy admin-doctor-account --no-verify-jwt` (both check their callers themselves).
3. `public.admins` holds the one admin email; create that user in Supabase → Authentication; set the EmailJS secrets above.
4. `.env` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; `public/admin/config.js` → the same; `npm run build`; host `dist/`.

## Known limits
- Sample layout and doctors are fictional, scaled and arranged after KMCH's public wayfinder (department names only;
  no real doctors). KMCH's spine runs diagonally; here corridors are straight. Replace from Royal Care's plans in the admin.
- Position = the chosen start point (entrance / kiosk QR). A live "blue dot" needs BLE beacons later.
- No payments, no patient accounts (booking ID + mobile instead), no SMS/WhatsApp yet, no reminder the day before
  (needs a scheduled job; the outbox is ready for it). Times use the hospital time zone in Booking settings (default Asia/Kolkata).
- Patient data (name, phone, reason) is personal data under India's DPDP Act: the form asks for consent, only admins and the
  patient's own doctor can read it. Set a retention policy before a real launch.
- Navigation simulates walking along the route (same as the mall demo).
- The UI is English; room names are stored in Tamil too, but there is no Tamil switch yet.
