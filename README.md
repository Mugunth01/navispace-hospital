# NaviSpace Hospital — v4 pilot

Indoor navigation for a hospital, built on the **NaviSpace (Brookefields) map engine**: the same
3D look, FROM / TO route card, panda guide, view modes (Standard · Street · Top, and Follow · First person · Top
while navigating), "Front view" of a block, and the lift-cabin sequence. The mall's offers, rewards, games,
parking and visitor login are removed; doctors and hospital departments are added.

## What's in the box
| Path | What it is |
|---|---|
| `dist/` | **Ready to host.** Upload this folder to Netlify / Vercel / any static host. `dist/admin/` is the admin. |
| `src/` | Visitor app source (React + react-three-fiber) |
| `src/data/floors.js` | Hospital geometry, installed at start-up from the database (`configureLayout`) |
| `src/data/api/index.js` | Reads the `nav_*` tables over Supabase REST (no client library → small bundle) |
| `src/components/hospital/` | Doctors tab, search with doctors, room page, quick tiles, menu |
| `public/admin/` | Admin: layout editor + Doctors (plain JS, Supabase login) |
| `scripts/hospital-layout.mjs` | Generates the sample 2-floor layout + doctors (`npm run layout`); v4 = KMCH-scale ground plan |
| `supabase/hospital_schema.sql`, `hospital_seed.sql` | Tables (RLS on) and the sample data |
| `src/__tests__/hospitalRouting.test.js` | Every start point → every room on both floors must route |

## Run
```bash
npm install
npm run dev        # http://localhost:5173  (admin: /admin/)
npm test           # route sweep: 4 starts × 234 rooms, both floors
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

## v4 layout (modelled on KMCH's ground floor)
- Footprint 96 x 40 map units = **240 m x 100 m** per floor (v3 was 162 m x 68 m: ~2.2x the area).
- OPD-block entrance lobby in the middle of the south side (Registration, Cash Counters, Insurance Desk,
  May I Help You, OP Pharmacy, Admissions); one 240 m main spine; 9 wings (4 left, 5 right) of 10 rooms each,
  around 10 garden courtyards. Walks from the entrance to the far wings are ~160-175 m (KMCH: ~120-140 m).
- Ground floor departments follow KMCH's ground floor: Radiology (X-Ray 1 & 2, CT, MRI, Cath Lab, Cath Lab 2),
  Rehabilitation (Physio, Occupational/Speech therapy), Administration (HR, Purchase, Legal, Admin),
  Patient care (Baby Feeding Room, Children's Play Area), ENT Procedure Room, Security Office, IP Pharmacy,
  plus Emergency, Laboratory/Blood Bank and Cafeteria near the entrance.
- Two lift banks (main + west), three stairs, four restrooms per floor. 234 searchable rooms in total.

## Known limits
- Sample layout and doctors are fictional, scaled and arranged after KMCH's public wayfinder (department names only;
  no real doctors). KMCH's spine runs diagonally; here corridors are straight. Replace from Royal Care's plans in the admin.
- Position = the chosen start point (entrance / kiosk QR). A live "blue dot" needs BLE beacons later.
- Navigation simulates walking along the route (same as the mall demo).
- The UI is English; room names are stored in Tamil too, but there is no Tamil switch yet.
