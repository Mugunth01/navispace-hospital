// Sample hospital layout for the NaviSpace Hospital pilot (Ground + First floor).
// v5: 4-column wings with a cross corridor (left/right loop), 4 lift banks.
// v4: ground plan modelled on KMCH's campus ground floor (wayfinder.kmchhospitals.com):
// OPD-block entrance lobby in the middle of the south side, one long main spine,
// long wings left (north) and right (south) around garden courtyards, radiology /
// cath labs, rehabilitation and administration in the far wings. ~2.2x the v3 area
// (240 m x 100 m).
//
// Coordinates are NaviSpace map units (1 unit = 2.5 m), x to the east, y to the
// north. The database stores rectangles with z = -y (so north is "up" in the
// admin plan) — see toDb().
//
//   node scripts/hospital-layout.mjs   → writes src/data/hospitalSeed.json and supabase/hospital_seed.sql

export const WALK = 2.4;           // corridor width (6 m)
const H = WALK / 2;
const COL = 3.6;                    // room depth / column width (9 m)
const X0 = -48, X1 = 48;            // main corridor ends (building walls at ±48.2)
const YTOP = 20;                    // rooms end here (walls at ±20.2)
// v5: wide wings. Each wing has TWO corridors and FOUR room columns:
//   [room] corridor [room|room] corridor [room]
// joined at the far end by a cross corridor, so you can go up one corridor
// and come back down the other (left/right loop). Wing centres:
const NORTH = [-30, 0, 30];         // wings to the left (north)
const SOUTH = [-30, 30];            // wings to the right (south)
const LOBBY = 0;                    // entrance lobby: a narrow 2-column wing on the south side
const WING_HALF = 2 * COL + WALK;   // 9.6: half width of a 4-column wing
const CX = COL + H;                 // 4.8: offset of each wing corridor's centre line
const ER_X = -30 - CX;              // emergency entrance = west corridor of the south-west wing
const r2 = (n) => Math.round(n * 100) / 100;

// Cores (identical position on both floors so lifts and stairs line up). side: 1 = north of the main corridor.
const LIFTS = [
  { x0: 6, x1: 9.6, side: -1, group: 'LIFT-A', code: 'lifts-a', name: 'Lifts A (lobby east)' },
  { x0: -9.6, x1: -6, side: -1, group: 'LIFT-B', code: 'lifts-b', name: 'Lifts B (lobby west)' },
  { x0: -16.8, x1: -13.2, side: 1, group: 'LIFT-C', code: 'lifts-c', name: 'Lifts C (west)' },
  { x0: 13.2, x1: 16.8, side: 1, group: 'LIFT-D', code: 'lifts-d', name: 'Lifts D (east)' },
];
const STAIRS = [
  { code: 'stairs-nw', x0: -47.4, x1: -45, side: 1, label: 'Stairs (north-west)' }, { code: 'stairs-ne', x0: 45, x1: 47.4, side: 1, label: 'Stairs (north-east)' },
  { code: 'stairs-sw', x0: -47.4, x1: -45, side: -1, label: 'Stairs (south-west)' }, { code: 'stairs-se', x0: 45, x1: 47.4, side: -1, label: 'Stairs (south-east)' },
];
const WCS = [{ x0: -12.4, x1: -10, side: 1 }, { x0: 10, x1: 12.4, side: 1 }, { x0: -12.4, x1: -10, side: -1 }, { x0: 10, x1: 12.4, side: -1 }];

function split(a, b, target) {
  const n = Math.max(1, Math.round((b - a) / target));
  const w = (b - a) / n;
  return Array.from({ length: n }, (_, i) => [a + i * w, a + (i + 1) * w]);
}
function minus(intervals, cut) {
  const out = [];
  for (const [a, b] of intervals) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out.filter(([a, b]) => b - a > 0.6);
}
const wingsOf = (s) => (s > 0 ? NORTH.map((xb) => [xb, WING_HALF]) : [...SOUTH.map((xb) => [xb, WING_HALF]), [LOBBY, H + COL]]);

// Every slot is a rectangle in map units {x0,x1,y0,y1} with a door side
// ('N'|'S'|'E'|'W' = which wall faces the corridor) and a "zone" used to pick the department.
function slots() {
  const out = [];
  for (const [list, s] of [[NORTH, 1], [SOUTH, -1]]) {
    for (const xb of list) {
      const zone = `${s > 0 ? 'N' : 'S'}${xb}`;
      const outer = split(H, YTOP, 3.8);            // 5 rooms on the outer columns (full depth)
      const inner = split(H, YTOP - WALK, 4);       // 4 rooms on the centre block (stops at the cross corridor)
      const cols = [
        [xb - WING_HALF, xb - WING_HALF + COL, 'E', outer, 0], // faces the west corridor
        [xb - COL, xb, 'W', inner, 1],
        [xb, xb + COL, 'E', inner, 2],
        [xb + WING_HALF - COL, xb + WING_HALF, 'W', outer, 3], // faces the east corridor
      ];
      for (const [x0, x1, door, ys, c] of cols) {
        ys.forEach(([a, b], i) => out.push({ zone, order: i * 4 + c, x0, x1, y0: s > 0 ? a : -b, y1: s > 0 ? b : -a, door }));
      }
    }
  }
  // Entrance lobby: 5 rooms each side of a single corridor.
  split(H, YTOP, 3.8).forEach(([a, b], i) => {
    out.push({ zone: 'S0', order: i * 2, x0: LOBBY - H - COL, x1: LOBBY - H, y0: -b, y1: -a, door: 'E' });
    out.push({ zone: 'S0', order: i * 2 + 1, x0: LOBBY + H, x1: LOBBY + H + COL, y0: -b, y1: -a, door: 'W' });
  });
  // Main-corridor rooms between the wings.
  for (const s of [1, -1]) {
    let free = [[X0 + 0.6, X1 - 0.6]];
    for (const [xb, hw] of wingsOf(s)) free = minus(free, [xb - hw, xb + hw]);
    for (const c of [...LIFTS, ...STAIRS, ...WCS]) if (c.side === s) free = minus(free, [c.x0, c.x1]);
    for (const [a, b] of free.filter(([a, b]) => b - a >= 2.4)) {   // slivers stay plain wall
      split(a, b, 3.4).forEach(([x0, x1]) => out.push({ zone: `C${s > 0 ? 'N' : 'S'}`, order: x0, x0, x1, y0: s > 0 ? H : -H - COL, y1: s > 0 ? H + COL : -H, door: s > 0 ? 'S' : 'N' }));
    }
  }
  return out;
}

// Courtyards / service blocks between the wings, behind the main-corridor rooms.
function backBlocks() {
  const out = [];
  for (const s of [1, -1]) {
    let free = [[X0 + 0.6, X1 - 0.6]];
    for (const [xb, hw] of wingsOf(s)) free = minus(free, [xb - hw, xb + hw]);
    for (const [a, b] of free.filter(([a, b]) => b - a >= 2.4)) {
      const y0 = s > 0 ? H + COL + 0.5 : -YTOP, y1 = s > 0 ? YTOP : -(H + COL + 0.5);
      out.push({ x0: a + 0.2, x1: b - 0.2, y0, y1, garden: b - a >= 6 });
    }
  }
  return out;
}

// 18 rooms per wide wing (nearest the main corridor first), 10 in the lobby wing.
const DEPT = {
  G: {
    S0: ['Registration', 'Cash Counter 1', 'Insurance Desk', 'May I Help You', 'OP Pharmacy', 'Cash Counter 2', 'Admissions', 'Patient Relations', 'Medical Records', 'Wheelchair Desk'],
    'S-30': ['Emergency Triage', 'Resuscitation', 'Trauma Bay', 'Minor OT', 'ER Observation', 'Emergency Pharmacy', 'Emergency Cash Counter', 'ER Nurse Station', 'Emergency X-Ray', 'Plaster Room', 'Burns Dressing', 'Decontamination Room',
      'Ambulance Desk', 'Security Office', 'MLC Desk', 'Poison Control', 'Relatives Waiting', 'Triage Waiting'],
    S30: ['Sample Collection', 'Biochemistry', 'Haematology', 'Clinical Pathology', 'Microbiology', 'Histopathology', 'Cytology', 'Immunology & Serology', 'Molecular Diagnostics (PCR)', 'Blood Bank',
      'Transfusion Medicine', 'Report Collection', 'Home Collection Desk', 'Lab Reception', 'Phlebotomy Bay 2', 'Urine & Stool Collection', 'Lab Quality Office', 'Central Lab Store'],
    'N-30': ['Radiology Reception', 'X-Ray 1', 'X-Ray 2', 'CT Scan', 'MRI', 'Ultrasound 1', 'Ultrasound 2', 'Doppler Studies', 'Mammography', 'DEXA Scan', 'Fluoroscopy', 'Cath Lab', 'Cath Lab 2',
      'Nuclear Medicine', 'PET-CT', 'Radiology Reporting', 'Contrast Prep Room', 'Imaging Waiting'],
    N0: ['General Medicine · Room 1', 'General Medicine · Room 2', 'General Medicine · Room 3', 'General Medicine · Room 4', 'Diabetology', 'Executive Health Check', 'Family Medicine', 'Infectious Diseases',
      'Geriatrics', 'Day Care Unit', 'Dental Clinic', 'Dietician', 'Vaccination Centre', 'ECG Room', 'Echo Lab', 'TMT (Stress Test)', 'Pulmonary Function Lab', 'OPD Nurse Station'],
    N30: ['Physiotherapy', 'Occupational Therapy', 'Speech Therapy', 'Hydrotherapy', 'Sports Rehabilitation', 'Audiology', 'ENT Procedure Room', 'IP Pharmacy', 'Dialysis Unit', 'Endoscopy Suite',
      'HR Office', 'Administrative Office', 'Legal Office', 'Medical Superintendent', 'Nursing Office', 'Finance & Accounts', 'Conference Room', 'Training Hall'],
    CN: ['Cafeteria', 'Nurse Station', 'Baby Feeding Room', "Children's Play Area", 'Doctors Lounge', 'Waiting Lounge A'],
    CS: ['Prayer Room', 'ATM & Bank', 'Main Waiting Hall', 'Gift & Flower Shop', 'Optical Store', 'Lost & Found', 'Help Desk (east)', 'Waiting Lounge B'],
  },
  '1F': {
    S0: ['OPD Waiting Atrium', 'OPD Billing 1F', 'Help Desk 1F', 'Pharmacy 1F', 'Sample Collection 1F', 'Waiting 1F-A', 'Waiting 1F-B', 'Nutrition Clinic', 'Diabetes Education', 'Health Check Lounge'],
    'N-30': ['Cardiology · Room 101', 'Cardiology · Room 102', 'Cardiology · Room 103', 'Cardiology · Room 104', 'Cardiac Cath Lab', 'Echo Lab 1F', 'Cardiac Rehab', 'Cardiothoracic Surgery · Room 108',
      'Vascular Surgery · Room 109', 'Heart Failure Clinic', 'Pacemaker Clinic', 'Holter Monitoring', 'ECG 1F', 'TMT 1F', 'Preventive Cardiology', 'Cardiac Nurse Station', 'Cardio Counselling', 'Cardiology Waiting'],
    N0: ['Neurology · Room 111', 'Neurology · Room 112', 'Neurology · Room 113', 'Neurosurgery · Room 114', 'Neurosurgery · Room 115', 'EEG & EMG Lab', 'Stroke Clinic', 'Memory Clinic',
      'Psychiatry · Room 119', 'Psychology', 'Epilepsy Clinic', 'Movement Disorders Clinic', 'Headache Clinic', 'Neuro Rehab', 'Sleep Lab', 'Counselling Room', 'Neuro Nurse Station', 'Neurology Waiting'],
    N30: ['Orthopaedics · Room 121', 'Orthopaedics · Room 122', 'Orthopaedics · Room 123', 'Orthopaedics · Room 124', 'Spine Clinic', 'Sports Injury Clinic', 'Rheumatology · Room 127', 'Hand Surgery · Room 128',
      'Joint Replacement Clinic', 'Arthroscopy Clinic', 'Paediatric Orthopaedics', 'Pain Clinic', 'Plaster Room 1F', 'Bone Densitometry', 'Physiotherapy 1F', 'Brace & Splint Fitting', 'Ortho Nurse Station', 'Orthopaedics Waiting'],
    'S-30': ['Paediatrics · Room 131', 'Paediatrics · Room 132', 'Paediatrics · Room 133', 'Neonatology', 'Obstetrics & Gynaecology · Room 135', 'Obstetrics & Gynaecology · Room 136', 'Obstetrics & Gynaecology · Room 137',
      'Fertility Clinic', 'Antenatal Clinic', 'Fetal Medicine', 'Paediatric Surgery · Room 141', 'Child Development Clinic', 'Lactation Room', 'Colposcopy', 'Vaccination 1F', 'Paediatric Nurse Station', 'Mother & Baby Lounge', 'Women & Children Waiting'],
    S30: ['Gastroenterology · Room 151', 'Gastroenterology · Room 152', 'Nephrology · Room 153', 'ENT · Room 154', 'ENT · Room 155', 'Ophthalmology · Room 156', 'Ophthalmology · Room 157', 'Dermatology · Room 158',
      'Medical Oncology · Room 159', 'Pulmonology · Room 160', 'Urology · Room 161', 'Endocrinology · Room 162', 'General Surgery · Room 163', 'General Surgery · Room 164', 'Plastic Surgery · Room 165',
      'Endoscopy Suite 1F', 'Chemotherapy Day Care', 'Specialty Waiting'],
    CN: ['Nurse Station 1F', 'Doctors Lounge 1F', 'Seminar Room', 'Library', 'Staff Lounge 1F', 'Store Room 1F'],
    CS: ['Records 1F', 'Waiting 1F-C', 'Linen Room 1F', 'Waiting 1F-D', 'Meeting Room', 'Waiting 1F-E', 'Help Desk 1F (east)', 'Waiting 1F-F'],
  },
};

function categoryOf(name) {
  const n = name.toLowerCase();
  if (/emergency|triage|resus|trauma|minor ot|er obs|er nurse|burns|decontamination|poison|mlc|relatives/.test(n)) return 'emergency';
  if (/x-ray|ct |ct scan|pet-ct|nuclear|densitometry|dexa|doppler|fluoro|holter|pacemaker|biochem|haemat|pathology|histo|cytology|immunology|serology|molecular|transfusion|phlebotomy|collection|lab reception|lab quality|central lab|contrast|imaging|mri|ultrasound|mammo|radiology|laboratory|sample|blood bank|microbio|ecg|tmt|echo|eeg|cath|endoscopy|lab\b|function lab|sleep lab|audiology/.test(n)) return 'diagnostics';
  if (/pharmacy|optical/.test(n)) return 'pharmacy';
  if (/dialysis|day care|neonat|chemotherapy/.test(n)) return 'inpatient';
  if (/cafeteria|atm|prayer|gift|feeding|play area|lounge|waiting|atrium|library/.test(n)) return 'amenities';
  if (/reception|registration|cash|may i help|billing|office|superintendent|finance|it help|conference|training|seminar|meeting|housekeeping|linen|biomedical|feedback|records|central store|help desk|admissions|tpa|insurance|patient relations|medical records|security|wheelchair|ambulance|report|social|interpreter|store room|lost|nurse station|doctors lounge/.test(n)) return 'services';
  return 'opd';
}
const slug = (s) => s.toLowerCase().replace(/·/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TA = {
  'Reception & Registration': 'வரவேற்பு & பதிவு', 'Billing & Insurance': 'கட்டணம் & காப்பீடு', 'Help Desk': 'உதவி மையம்', 'Pharmacy (OP)': 'மருந்தகம்',
  Admissions: 'சேர்க்கை', 'CT Scan': 'சிடி ஸ்கேன்', MRI: 'எம்ஆர்ஐ', Ultrasound: 'அல்ட்ராசவுண்ட்', 'Sample Collection': 'மாதிரி சேகரிப்பு',
  'Clinical Laboratory': 'ஆய்வகம்', 'Blood Bank': 'இரத்த வங்கி', Cafeteria: 'சிற்றுண்டியகம்', 'ATM & Bank': 'ஏடிஎம்',
  Physiotherapy: 'இயன்முறை சிகிச்சை', 'Dental Clinic': 'பல் மருத்துவம்', Cardiology: 'இருதயவியல்', Neurology: 'நரம்பியல்', Orthopaedics: 'எலும்பியல்',
  Paediatrics: 'குழந்தை மருத்துவம்', 'Obstetrics & Gynaecology': 'மகப்பேறு மருத்துவம்', Gastroenterology: 'இரைப்பை குடலியல்', Nephrology: 'சிறுநீரகவியல்',
  ENT: 'காது மூக்கு தொண்டை', Ophthalmology: 'கண் மருத்துவம்', Dermatology: 'தோல் மருத்துவம்', Pulmonology: 'நுரையீரல் மருத்துவம்', Urology: 'சிறுநீரகவியல் (யூராலஜி)',
  Endocrinology: 'நாளமில்லா சுரப்பியியல்', Registration: 'பதிவு', 'Cash Counter 1': 'பணம் செலுத்தும் இடம் 1', 'Cash Counter 2': 'பணம் செலுத்தும் இடம் 2',
  'Insurance Desk': 'காப்பீட்டு மையம்', 'May I Help You': 'உதவி மையம்', 'OP Pharmacy': 'வெளிநோயாளர் மருந்தகம்', 'IP Pharmacy': 'உள்நோயாளர் மருந்தகம்',
  'X-Ray 1': 'எக்ஸ்-ரே 1', 'X-Ray 2': 'எக்ஸ்-ரே 2', 'Cath Lab': 'கேத் லேப்', 'Cath Lab 2': 'கேத் லேப் 2', 'Radiology Reception': 'கதிரியக்கவியல் வரவேற்பு',
  'Occupational Therapy': 'தொழில்சார் சிகிச்சை', 'Baby Feeding Room': 'பாலூட்டும் அறை', "Children's Play Area": 'குழந்தைகள் விளையாட்டுப் பகுதி',
  'Security Office': 'பாதுகாப்பு அலுவலகம்', 'Administrative Office': 'நிர்வாக அலுவலகம்', 'Emergency Triage': 'அவசர சிகிச்சை', 'ENT Procedure Room': 'காது மூக்கு தொண்டை சிகிச்சை அறை', 'Medical Oncology': 'புற்றுநோய் மருத்துவம்', 'General Medicine': 'பொது மருத்துவம்', 'Dialysis Unit': 'டயாலிசிஸ்',
};
const taOf = (name) => {
  if (TA[name]) return TA[name];
  const [dept, room] = name.split(' · ');
  if (room && TA[dept]) return `${TA[dept]} · ${room.replace('Room', 'அறை')}`;
  return name;
};

export function generate() {
  const floors = [{ id: 'G', level: 0, name_en: 'Ground Floor', name_ta: 'தரைத்தளம்' }, { id: '1F', level: 1, name_en: 'First Floor', name_ta: 'முதல் தளம்' }];
  const rooms = [], walkways = [], start_points = [];
  const S = slots();
  for (const f of floors) {
    const fid = f.id, pre = fid === 'G' ? 'G' : '1';
    const used = new Map();
    const zones = {};
    for (const s of S) (zones[s.zone] ||= []).push(s);
    let n = 1;
    for (const [zone, list] of Object.entries(zones)) {
      list.sort((a, b) => a.order - b.order);
      const names = DEPT[fid][zone.replace(/^N(-?\d+)$/, (m, x) => `N${x}`).replace(/^S(-?\d+)$/, (m, x) => `S${x}`)] || [];
      list.forEach((s, i) => {
        const name = names[i] || `Consultation Room ${pre}${String(n).padStart(2, '0')}`;
        let code = slug(name) || `room-${n}`;
        if (used.has(code)) code = `${code}-${n}`;
        used.set(code, 1);
        if (fid === '1F' && !/^1f-|1f$/.test(code)) code = rooms.some((r) => r.code === code) ? `${code}-1f` : code;
        rooms.push(room(fid, code, name, taOf(name), categoryOf(name), s));
        n++;
      });
    }
    // cores
    LIFTS.forEach((l) => rooms.push(room(fid, `${l.code}-${fid.toLowerCase()}`, l.name, 'மின்தூக்கி', 'lift',
      l.side > 0 ? { x0: l.x0, x1: l.x1, y0: H + 0.2, y1: H + 2.2, door: 'S' } : { x0: l.x0, x1: l.x1, y0: -H - 2.2, y1: -H - 0.2, door: 'N' }, l.group, false)));
    STAIRS.forEach((st) => rooms.push(room(fid, `${st.code}-${fid.toLowerCase()}`, st.label, 'படிக்கட்டு', 'stairs',
      st.side > 0 ? { x0: st.x0, x1: st.x1, y0: H + 0.2, y1: H + 2.8, door: 'S' } : { x0: st.x0, x1: st.x1, y0: -H - 2.8, y1: -H - 0.2, door: 'N' }, st.code.toUpperCase(), false)));
    WCS.forEach((w, i) => rooms.push(room(fid, `restroom-${i + 1}-${fid.toLowerCase()}`, 'Restrooms', 'கழிவறைகள்', 'restroom',
      w.side > 0 ? { x0: w.x0, x1: w.x1, y0: H + 0.2, y1: H + 2.6, door: 'S' } : { x0: w.x0, x1: w.x1, y0: -H - 2.6, y1: -H - 0.2, door: 'N' }, null, true)));
    // courtyards / service
    backBlocks().forEach((b, i) => rooms.push(room(fid, `${b.garden ? 'garden' : 'service'}-${i + 1}-${fid.toLowerCase()}`,
      b.garden ? (fid === 'G' ? 'Garden Courtyard' : 'Terrace Garden') : 'Service Area', b.garden ? 'தோட்டம்' : 'சேவைப் பகுதி', b.garden ? 'garden' : 'service', { ...b, door: 'S' }, null, false)));
    // corridors (rectangles; the app takes their centre lines and joins them where they meet)
    walkways.push({ floor_id: fid, name: 'Main corridor', x: X0, y0: -H, x1: X1, y1: H });
    for (const [list, s] of [[NORTH, 1], [SOUTH, -1]]) {
      for (const xb of list) {
        const tag = `${s > 0 ? 'North' : 'South'} wing ${xb < 0 ? 'W' : xb > 0 ? 'E' : 'C'}`;
        for (const [k, cx] of [['west', xb - CX], ['east', xb + CX]]) {
          const toWall = fid === 'G' && s < 0 && Math.abs(cx - ER_X) < 0.01;   // emergency entrance
          walkways.push({ floor_id: fid, name: `${tag} · ${k} corridor`, x: cx - H, x1: cx + H, y0: s > 0 ? 0 : (toWall ? -YTOP - 0.2 : -YTOP), y1: s > 0 ? YTOP : 0 });
        }
        // cross corridor at the far end joins the two (left/right loop)
        walkways.push({ floor_id: fid, name: `${tag} · cross corridor`, x: xb - CX, x1: xb + CX, y0: s > 0 ? YTOP - WALK : -YTOP, y1: s > 0 ? YTOP : -YTOP + WALK });
      }
    }
    walkways.push({ floor_id: fid, name: 'Entrance lobby', x: LOBBY - H, x1: LOBBY + H, y0: fid === 'G' ? -YTOP - 0.2 : -YTOP, y1: 0 });
  }
  start_points.push(
    { code: 'main-entrance', floor_id: 'G', kind: 'entrance', name_en: 'Main Entrance (OPD Block)', name_ta: 'முதன்மை நுழைவாயில் (ஓபிடி)', x: LOBBY, y: -YTOP },
    { code: 'emergency-entrance', floor_id: 'G', kind: 'entrance', name_en: 'Emergency Entrance', name_ta: 'அவசர நுழைவாயில்', x: ER_X, y: -YTOP },
    { code: 'kiosk-reception', floor_id: 'G', kind: 'kiosk', name_en: 'Kiosk · Reception', name_ta: 'கியோஸ்க் · வரவேற்பு', x: -2, y: 0 },
    { code: 'kiosk-1f-lifts', floor_id: '1F', kind: 'kiosk', name_en: 'Kiosk · First Floor Lifts', name_ta: 'கியோஸ்க் · முதல் தள மின்தூக்கி', x: 3, y: 0 },
  );
  const docs = doctors(rooms);
  return { settings: { hospital_name: 'Demo Super Speciality Hospital', hospital_name_ta: 'டெமோ சூப்பர் ஸ்பெஷாலிட்டி மருத்துவமனை' }, floors, rooms, walkways, start_points, doctors: docs.doctors, sessions: docs.sessions, lab_tests: labTests(rooms) };
}

function room(floor_id, code, name_en, name_ta, category, s, link_group = null, searchable = true) {
  return {
    code, floor_id, name_en, name_ta, category,
    x0: r2(s.x0), x1: r2(s.x1), y0: r2(s.y0), y1: r2(s.y1), door_side: s.door, door_pos: 0.5,
    door_width: category === 'lift' ? 3 : 1.6, link_group, keywords: '',
    searchable: searchable && !['garden', 'service', 'lift', 'stairs'].includes(category),
  };
}

// Fictional doctors for the demo: random-looking South Indian names from a fixed seed
// (not real people). One doctor per consultation room / clinic, two in the busiest rooms.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FIRST = ['Arvind', 'Balaji', 'Dinesh', 'Ganesh', 'Harish', 'Kishore', 'Madhan', 'Naresh', 'Prabhu', 'Raghav', 'Sathish', 'Thilak', 'Vasanth', 'Yogesh', 'Ajith', 'Bhaskar', 'Elango', 'Gowtham', 'Jagan', 'Kumaran', 'Mohanraj', 'Santhosh',
  'Aishwarya', 'Bhavani', 'Chitra', 'Dharani', 'Gayathri', 'Hema', 'Indhu', 'Janani', 'Keerthana', 'Mythili', 'Nandhini', 'Pavithra', 'Revathy', 'Sindhu', 'Swetha', 'Vidhya', 'Yamini', 'Kalpana', 'Lavanya', 'Preethi'];
const LAST = ['Ramanan', 'Selvaraj', 'Natarajan', 'Krishnamoorthy', 'Palanisamy', 'Rangasamy', 'Sivakumar', 'Chandrasekar', 'Jayaraman', 'Murugesan', 'Thangavel', 'Kandasamy', 'Raghunathan', 'Venugopal',
  'Sundaresan', 'Gopalakrishnan', 'Periyasamy', 'Duraisamy', 'Annamalai', 'Subbiah', 'Velusamy', 'Ponnusamy'];
const CLINIC_SPEC = {
  Diabetology: 'Diabetology', 'Executive Health Check': 'General Medicine', 'Family Medicine': 'Family Medicine', 'Infectious Diseases': 'Infectious Diseases', Geriatrics: 'Geriatrics',
  'Dental Clinic': 'Dental Surgery', Physiotherapy: 'Physiotherapy', 'Emergency Triage': 'Emergency Medicine', Dietician: 'Clinical Nutrition', 'Spine Clinic': 'Spine Surgery', 'Sports Injury Clinic': 'Sports Medicine',
  'Joint Replacement Clinic': 'Orthopaedics', 'Fertility Clinic': 'Reproductive Medicine', 'Fetal Medicine': 'Fetal Medicine', 'Stroke Clinic': 'Neurology', 'Headache Clinic': 'Neurology', Psychology: 'Clinical Psychology',
  'Heart Failure Clinic': 'Cardiology', 'Pain Clinic': 'Pain Medicine', Neonatology: 'Neonatology', 'Speech Therapy': 'Speech & Language Therapy', Audiology: 'Audiology',
};
const QUAL = {
  Cardiology: 'MD, DM (Cardiology)', Neurology: 'MD, DM (Neurology)', Neurosurgery: 'MS, MCh (Neurosurgery)', Orthopaedics: 'MS (Orthopaedics)', Paediatrics: 'MD (Paediatrics)', 'Obstetrics & Gynaecology': 'MS (OG), DNB',
  Gastroenterology: 'MD, DM (Gastroenterology)', Nephrology: 'MD, DM (Nephrology)', ENT: 'MS (ENT)', Ophthalmology: 'MS (Ophthalmology)', Dermatology: 'MD (DVL)', 'Medical Oncology': 'MD, DM (Medical Oncology)',
  Pulmonology: 'MD (Respiratory Medicine)', Urology: 'MS, MCh (Urology)', Endocrinology: 'MD, DM (Endocrinology)', 'General Surgery': 'MS (General Surgery)', 'Plastic Surgery': 'MS, MCh (Plastic Surgery)',
  Psychiatry: 'MD (Psychiatry)', 'General Medicine': 'MD (General Medicine)', Diabetology: 'MD, Dip. Diabetology', 'Emergency Medicine': 'MD (Emergency Medicine)', 'Dental Surgery': 'BDS, MDS',
  Physiotherapy: 'BPT, MPT (Ortho)', Rheumatology: 'MD, DM (Rheumatology)', 'Paediatric Surgery': 'MS, MCh (Paediatric Surgery)', 'Cardiothoracic Surgery': 'MS, MCh (CTVS)', 'Vascular Surgery': 'MS, MCh (Vascular Surgery)',
  'Hand Surgery': 'MS (Ortho), FNB (Hand Surgery)', 'Spine Surgery': 'MS, FNB (Spine Surgery)', Neonatology: 'MD, DM (Neonatology)', 'Clinical Psychology': 'M.Phil (Clinical Psychology)',
};
const INTEREST = {
  Cardiology: 'coronary angioplasty, heart failure and preventive cardiology', Neurology: 'stroke, epilepsy and headache disorders', Orthopaedics: 'joint replacement and trauma care',
  Paediatrics: 'newborn care, childhood asthma and growth', 'Obstetrics & Gynaecology': 'high-risk pregnancy and minimally invasive gynaecology', Gastroenterology: 'endoscopy, liver disease and IBD',
  ENT: 'sinus surgery, hearing loss and voice disorders', Ophthalmology: 'cataract, glaucoma and retina', Dermatology: 'acne, psoriasis and cosmetic dermatology', 'General Medicine': 'diabetes, hypertension and fever care',
};
const LANGS = ['Malayalam', 'Hindi', 'Telugu', 'Kannada'];
function doctors(rooms) {
  const R = rng(20261124), pick = (a) => a[Math.floor(R() * a.length)];
  const usedNames = new Set(), doctors = [], sessions = [], perSpec = {};
  const fakeName = () => { for (;;) { const n = `Dr. ${pick(FIRST)} ${pick(LAST)}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } };
  const targets = [];
  for (const r of rooms) {
    if (!r.searchable) continue;
    const m = r.name_en.match(/^(.+?) · Room \d+$/);
    const spec = m ? m[1] : CLINIC_SPEC[r.name_en];
    if (!spec) continue;
    targets.push([r, spec]);
    if (/General Medicine · Room [12]$|Cardiology · Room 101|Paediatrics · Room 131|Orthopaedics · Room 121/.test(r.name_en)) targets.push([r, spec]);  // evening doctor too
  }
  targets.forEach(([r, spec], i) => {
    const name = fakeName();
    const k = (perSpec[spec] = (perSpec[spec] || 0) + 1);
    const designation = k === 1 ? 'Senior Consultant & Head of Department' : pick(['Senior Consultant', 'Consultant', 'Consultant', 'Associate Consultant']);
    const exp = k === 1 ? 18 + Math.floor(R() * 12) : 5 + Math.floor(R() * 14);
    const languages = ['English', 'Tamil', ...(R() < 0.5 ? [pick(LANGS)] : [])].join(', ');
    const interest = INTEREST[spec] || `${spec.toLowerCase()} care`;
    const code = name.toLowerCase().replace(/^dr\.\s*/, '').replace(/[^a-z]+/g, '-');
    const emergency = spec === 'Emergency Medicine';
    const evening = targets.filter((t) => t[0] === r).indexOf(targets[i]) === 1 || (!emergency && R() < 0.3);
    const sess = emergency ? [] : evening
      ? [1, 2, 3, 4, 5].map((d) => [d, '16:00', '20:00', 'inperson'])
      : [1, 2, 3, 4, 5, 6].filter((d) => R() < 0.85 || d === 1).map((d) => [d, '09:00', '13:00', 'inperson']);
    const online = !emergency && !['Dental Surgery', 'Physiotherapy', 'Audiology'].includes(spec) && R() < 0.8;
    if (online) for (const d of [1, 3, 5]) sess.push([d, evening ? '20:00' : '14:00', evening ? '21:00' : '15:30', 'online']);
    sess.forEach(([weekday, start_time, end_time, mode]) => sessions.push({ doctor_code: code, weekday, start_time, end_time, mode }));
    const inp = sess.filter((x) => x[3] === 'inperson');
    const days = emergency ? 'All days' : summariseDays(inp.map((x) => x[0]));
    doctors.push({
      code, name, speciality: spec, qualification: QUAL[spec] || 'MBBS, MD', room_code: r.code,
      days, hours: emergency ? '24 hours' : inp.length ? `${inp[0][1]}–${inp[0][2]}` : '',
      designation, bio: `${designation} in ${spec} with ${exp} years of experience. Special interests: ${interest}.`,
      experience_years: exp, languages, slot_minutes: emergency ? 15 : (/Surgery|Psychiatry|Psychology/.test(spec) ? 20 : 15),
      booking_enabled: !emergency, online_enabled: online, sort: i + 1,
    });
  });
  return { doctors, sessions };
}
function summariseDays(ds) {
  const N = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const u = [...new Set(ds)].sort();
  if (!u.length) return '';
  const run = u.every((d, i) => i === 0 || d === u[i - 1] + 1);
  return run && u.length > 2 ? `${N[u[0]]}–${N[u[u.length - 1]]}` : u.map((d) => N[d]).join(', ');
}

// Bookable lab tests and scans. room_code = where the patient goes (the map routes there).
function labTests(rooms) {
  const has = new Set(rooms.map((r) => r.code));
  const T = (code, name, category, department, room_code, sample, prep, tat, price, home = false) => {
    if (!has.has(room_code)) throw new Error(`lab room missing: ${room_code}`);
    return { code, name, category, department, room_code, sample, prep, turnaround: tat, price, home_collection: home };
  };
  const SC = 'sample-collection';
  return [
    T('cbc', 'Complete Blood Count (CBC)', 'lab', 'Haematology', SC, 'Blood', 'No fasting needed', 'Same day', 350, true),
    T('esr', 'ESR', 'lab', 'Haematology', SC, 'Blood', 'No fasting needed', 'Same day', 150, true),
    T('fbs-ppbs', 'Blood Sugar – Fasting & Post-prandial', 'lab', 'Biochemistry', SC, 'Blood', 'Fast 10–12 hours; second sample 2 hours after food', 'Same day', 200, true),
    T('hba1c', 'HbA1c', 'lab', 'Biochemistry', SC, 'Blood', 'No fasting needed', 'Same day', 550, true),
    T('lipid', 'Lipid Profile', 'lab', 'Biochemistry', SC, 'Blood', 'Fast 10–12 hours (water allowed)', 'Same day', 600, true),
    T('lft', 'Liver Function Test (LFT)', 'lab', 'Biochemistry', SC, 'Blood', 'Fast 8 hours preferred', 'Same day', 650, true),
    T('rft', 'Kidney Function Test (RFT)', 'lab', 'Biochemistry', SC, 'Blood', 'No fasting needed', 'Same day', 600, true),
    T('thyroid', 'Thyroid Profile (T3, T4, TSH)', 'lab', 'Biochemistry', SC, 'Blood', 'Morning sample preferred', 'Same day', 650, true),
    T('vitd', 'Vitamin D (25-OH)', 'lab', 'Biochemistry', SC, 'Blood', 'No fasting needed', '24 hours', 1400, true),
    T('b12', 'Vitamin B12', 'lab', 'Biochemistry', SC, 'Blood', 'No fasting needed', '24 hours', 900, true),
    T('crp', 'C-Reactive Protein (CRP)', 'lab', 'Immunology & Serology', SC, 'Blood', 'No fasting needed', 'Same day', 500, true),
    T('dengue', 'Dengue NS1 + IgM/IgG', 'lab', 'Immunology & Serology', SC, 'Blood', 'No fasting needed', 'Same day', 1100, true),
    T('urine-re', 'Urine Routine', 'lab', 'Clinical Pathology', SC, 'Urine', 'First morning sample preferred', 'Same day', 150, true),
    T('urine-culture', 'Urine Culture & Sensitivity', 'lab', 'Microbiology', SC, 'Urine', 'Before starting antibiotics; clean-catch sample', '48–72 hours', 700),
    T('pap', 'Pap Smear', 'lab', 'Cytology', SC, 'Cervical smear', 'Avoid during periods; no douching 48 hours before', '3 days', 900),
    T('biopsy', 'Biopsy (Histopathology)', 'lab', 'Histopathology', 'histopathology', 'Tissue', 'Bring the referral and sample container from the doctor', '3–5 days', 1800),
    T('rtpcr', 'RT-PCR (Respiratory panel)', 'lab', 'Molecular Diagnostics (PCR)', SC, 'Nasal swab', 'No food or drink 30 minutes before', '24 hours', 1500),
    T('blood-group', 'Blood Grouping & Rh', 'lab', 'Blood Bank', 'blood-bank', 'Blood', 'No fasting needed', '1 hour', 150),
    T('master-health', 'Master Health Check-up', 'lab', 'Executive Health Check', 'executive-health-check', 'Blood, urine + scans', 'Fast 10–12 hours; takes about 4 hours', 'Same day', 4500),
    T('xray-chest', 'X-Ray Chest (PA view)', 'imaging', 'Radiology', 'x-ray-1', '—', 'Remove metal objects', '2 hours', 450),
    T('usg-abdomen', 'Ultrasound Abdomen & Pelvis', 'imaging', 'Radiology', 'ultrasound-1', '—', 'Fast 6 hours; full bladder (drink 1 litre water 1 hour before)', 'Same day', 1200),
    T('ct-brain', 'CT Brain (plain)', 'imaging', 'Radiology', 'ct-scan', '—', 'Bring previous scans', 'Same day', 2800),
    T('mri-spine', 'MRI Lumbar Spine', 'imaging', 'Radiology', 'mri', '—', 'Remove all metal; tell us about implants or pacemaker', '24 hours', 6500),
    T('mammo', 'Mammography (both breasts)', 'imaging', 'Radiology', 'mammography', '—', 'No deodorant or powder on the day', '24 hours', 2200),
    T('dexa', 'DEXA Bone Density', 'imaging', 'Radiology', 'dexa-scan', '—', 'No calcium tablets 24 hours before', 'Same day', 2500),
    T('doppler', 'Venous Doppler (legs)', 'imaging', 'Radiology', 'doppler-studies', '—', 'Wear loose clothing', 'Same day', 2400),
    T('ecg', 'ECG', 'cardiac', 'Cardiology', 'ecg-room', '—', 'No preparation', '30 minutes', 250),
    T('echo', 'Echocardiogram (2D Echo)', 'cardiac', 'Cardiology', 'echo-lab', '—', 'No preparation', 'Same day', 2000),
    T('tmt', 'Treadmill Test (TMT)', 'cardiac', 'Cardiology', 'tmt-stress-test', '—', 'Light meal 2 hours before; wear walking shoes', 'Same day', 1800),
    T('pft', 'Pulmonary Function Test', 'cardiac', 'Pulmonology', 'pulmonary-function-lab', '—', 'No inhalers 4 hours before (ask your doctor)', 'Same day', 1200),
  ].map((t, i) => ({ ...t, sort: i + 1 }));
}

// Database rows use z = -y and the top-left corner (admin plan: north is up).
export function toDb(L) {
  const rect = (o) => ({ x: o.x0 ?? o.x, z: -(o.y1), w: r2((o.x1) - (o.x0 ?? o.x)), d: r2(o.y1 - o.y0) });
  return {
    settings: L.settings, floors: L.floors,
    rooms: L.rooms.map((r) => { const { x0, x1, y0, y1, ...rest } = r; return { ...rest, ...rect({ x0, x1, y0, y1 }) }; }),
    walkways: L.walkways.map((w) => ({ floor_id: w.floor_id, name: w.name, ...rect({ x0: w.x, x1: w.x1, y0: w.y0, y1: w.y1 }) })),
    start_points: L.start_points.map((p) => ({ ...p, z: r2(-p.y), y: undefined })).map(({ y, ...p }) => p),
    doctors: L.doctors, sessions: L.sessions, lab_tests: L.lab_tests,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const db = toDb(generate());
  fs.writeFileSync(new URL('../src/data/hospitalSeed.json', import.meta.url), JSON.stringify(db));
  const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const ins = (t, rows) => rows.length ? `insert into public.nav_${t}(${Object.keys(rows[0]).join(',')}) values\n${rows.map((r) => `(${Object.values(r).map(q).join(',')})`).join(',\n')};` : '';
  const sess = db.sessions.map((x) => `((select id from public.nav_doctors where code=${q(x.doctor_code)}),${x.weekday},${q(x.start_time)},${q(x.end_time)},${q(x.mode)})`);
  const sql = [
    '-- NaviSpace Hospital sample layout + doctors + lab tests (generated by scripts/hospital-layout.mjs). Clears and reloads these tables (bookings too).',
    'delete from public.nav_appointments; delete from public.nav_doctor_sessions; delete from public.nav_doctor_leaves; delete from public.nav_doctors; delete from public.nav_lab_tests;',
    'delete from public.nav_start_points; delete from public.nav_walkways; delete from public.nav_rooms; delete from public.nav_floors; delete from public.nav_settings;',
    ins('settings', [{ id: 1, ...db.settings }]), ins('floors', db.floors), ins('rooms', db.rooms), ins('walkways', db.walkways), ins('start_points', db.start_points), ins('doctors', db.doctors),
    `insert into public.nav_doctor_sessions(doctor_id,weekday,start_time,end_time,mode) values\n${sess.join(',\n')};`,
    ins('lab_tests', db.lab_tests),
  ].join('\n');
  fs.mkdirSync(new URL('../supabase/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../supabase/hospital_seed.sql', import.meta.url), sql + '\n');
  const per = (f) => db.rooms.filter((r) => r.floor_id === f && r.searchable).length;
  console.log(`rooms ${db.rooms.length} (searchable G ${per('G')}, 1F ${per('1F')}), walkways ${db.walkways.length}, doctors ${db.doctors.length}, sessions ${db.sessions.length}, lab tests ${db.lab_tests.length}`);
}
