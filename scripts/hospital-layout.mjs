// Sample hospital layout for the NaviSpace Hospital pilot (Ground + First floor).
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
const DEPTH = 3.6;                  // room depth from the corridor (9 m)
const X0 = -48, X1 = 48;            // main corridor ends (building walls at ±48.2)
const YTOP = 20;                    // rooms end here (walls at ±20.2)
const NORTH = [-30, -8, 14, 34];    // branch corridors to the left (north)
const SOUTH = [-38, -18, 0, 20, 40]; // branch corridors to the right (south); 0 = entrance lobby
const LOBBY = 0, ER_WING = -38;
const r2 = (n) => Math.round(n * 100) / 100;

// Cores (identical position on both floors so lifts and stairs line up).
const LIFTS = [{ x0: 3.2, x1: 6.8, group: 'LIFT-A', code: 'lifts-a', name: 'Lifts (main)' }, { x0: -21.8, x1: -18.2, group: 'LIFT-B', code: 'lifts-b', name: 'Lifts (west)' }]; // north side of the main corridor
const STAIRS = [{ code: 'stairs-w', x0: -47.4, x1: -45, side: 1, label: 'Stairs (west)' }, { code: 'stairs-c', x0: 7.4, x1: 9, side: 1, label: 'Stairs (central)' }, { code: 'stairs-e', x0: 45, x1: 47.4, side: 1, label: 'Stairs (east)' }];
const WCS = [{ x0: 23.2, x1: 25.8, side: 1 }, { x0: -7.4, x1: -5, side: -1 }, { x0: 29, x1: 31.6, side: -1 }, { x0: -43.6, x1: -41, side: 1 }];

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

// Every slot is a rectangle in map units {x0,x1,y0,y1} with a door side
// ('N'|'S'|'E'|'W' = which wall faces the corridor) and a "zone" used to
// pick the department.
function slots() {
  const out = [];
  // Branch rooms: three per side of each branch.
  for (const [list, s] of [[NORTH, 1], [SOUTH, -1]]) {
    for (const xb of list) {
      const ys = split(H, YTOP, 3.8);   // 5 rooms per side
      for (const [side, x0, x1, door] of [['L', xb - H - DEPTH, xb - H, 'E'], ['R', xb + H, xb + H + DEPTH, 'W']]) {
        ys.forEach(([a, b], i) => {
          const y0 = s > 0 ? a : -b, y1 = s > 0 ? b : -a;
          out.push({ zone: `${s > 0 ? 'N' : 'S'}${xb}`, order: i * 2 + (side === 'L' ? 0 : 1), x0, x1, y0, y1, door });
        });
      }
    }
  }
  // Main-corridor rooms between the wings.
  for (const [list, s] of [[NORTH, 1], [SOUTH, -1]]) {
    let free = [[X0 + 0.6, X1 - 0.6]];
    for (const xb of list) free = minus(free, [xb - H - DEPTH, xb + H + DEPTH]);
    if (s > 0) for (const l of LIFTS) free = minus(free, [l.x0, l.x1]);
    for (const st of STAIRS) if (st.side === s) free = minus(free, [st.x0, st.x1]);
    for (const w of WCS) if (w.side === s) free = minus(free, [w.x0, w.x1]);
    for (const [a, b] of free.filter(([a, b]) => b - a >= 2.4)) {   // slivers stay plain wall
      split(a, b, 3.4).forEach(([x0, x1]) => out.push({ zone: `C${s > 0 ? 'N' : 'S'}`, order: x0, x0, x1, y0: s > 0 ? H : -H - DEPTH, y1: s > 0 ? H + DEPTH : -H, door: s > 0 ? 'S' : 'N' }));
    }
  }
  return out;
}

// Courtyards / service blocks behind the main-corridor rooms (no corridor access).
function backBlocks() {
  const out = [];
  for (const [list, s] of [[NORTH, 1], [SOUTH, -1]]) {
    let free = [[X0 + 0.6, X1 - 0.6]];
    for (const xb of list) free = minus(free, [xb - H - DEPTH, xb + H + DEPTH]);
    for (const [a, b] of free.filter(([a, b]) => b - a >= 2.4)) {
      const y0 = s > 0 ? H + DEPTH + 0.5 : -YTOP, y1 = s > 0 ? YTOP : -(H + DEPTH + 0.5);
      out.push({ x0: a + 0.2, x1: b - 0.2, y0, y1, garden: b - a >= 6 });
    }
  }
  return out;
}

// Ten rooms per wing (5 per side, nearest the main corridor first). Ground floor
// follows KMCH's departments: radiology + cath labs, rehabilitation, administration,
// patient care, IP pharmacy, plus the public desks around the entrance lobby.
const DEPT = {
  G: {
    'S0': ['Registration', 'Cash Counter 1', 'Insurance Desk', 'May I Help You', 'OP Pharmacy', 'Cash Counter 2', 'Admissions', 'Patient Relations', 'Medical Records', 'Wheelchair Desk'],
    'S-38': ['Emergency Triage', 'Resuscitation', 'Trauma Bay', 'Minor OT', 'ER Observation', 'Emergency Pharmacy', 'Emergency Cash Counter', 'Ambulance Desk', 'Security Office', 'Plaster Room'],
    'S-18': ['Sample Collection', 'Clinical Laboratory', 'Blood Bank', 'Microbiology', 'Report Collection', 'ECG Room', 'Echo Lab', 'TMT (Stress Test)', 'Nuclear Medicine', 'PET-CT'],
    S20: ['Cafeteria', 'Baby Feeding Room', "Children's Play Area", 'Prayer Room', 'ATM & Bank', 'Gift & Flower Shop', 'Waiting Lounge A', 'Waiting Lounge B', 'Optical Store', 'Lost & Found'],
    S40: ['Physiotherapy', 'Occupational Therapy', 'Speech Therapy', 'Hydrotherapy', 'Sports Rehabilitation', 'Dietician', 'Vaccination Centre', 'Dental Clinic', 'ENT Procedure Room', 'Audiology'],
    'N-30': ['Radiology Reception', 'X-Ray 1', 'X-Ray 2', 'CT Scan', 'MRI', 'Ultrasound', 'Mammography', 'Cath Lab', 'Cath Lab 2', 'Radiology Reporting'],
    'N-8': ['General Medicine · Room 1', 'General Medicine · Room 2', 'General Medicine · Room 3', 'General Medicine · Room 4', 'Diabetology', 'Executive Health Check', 'Family Medicine', 'Infectious Diseases', 'Geriatrics', 'Day Care Unit'],
    N14: ['IP Pharmacy', 'Dialysis Unit', 'Endoscopy Suite', 'Pulmonary Function Lab', 'Sleep Lab', 'Pain Clinic', 'Wound Care', 'Minor Procedure Room', 'Pre-op Assessment', 'Central Store'],
    N34: ['HR Office', 'Purchase Office', 'Administrative Office', 'Legal Office', 'Medical Superintendent', 'Nursing Office', 'Finance & Accounts', 'IT Help Desk', 'Conference Room', 'Training Hall'],
    CN: ['Security Desk', 'Patient Lounge', 'Nurse Station', 'Doctors Lounge', 'Waiting Lounge C', 'Insurance Help', 'Social Services', 'Interpreter Desk', 'Feedback Desk', 'Waiting Lounge D', 'Housekeeping', 'Linen Room', 'Biomedical Engineering', 'Staff Lounge', 'Store Room', 'Waiting Lounge E'],
    CS: ['Main Waiting Hall', 'Health Check Lounge', 'Waiting Lounge F', 'Pharmacy Store', 'Waiting Lounge G', 'Ambulance Bay Desk', 'Help Desk (east)', 'Waiting Lounge H', 'Billing (east)', 'Waiting Lounge I', 'Report Collection (east)', 'Waiting Lounge J', 'Help Desk (west)', 'Waiting Lounge K', 'Billing (west)', 'Waiting Lounge L'],
  },
  '1F': {
    'S0': ['OPD Waiting Atrium', 'OPD Billing 1F', 'Help Desk 1F', 'Pharmacy 1F', 'Sample Collection 1F', 'Waiting 1F-A', 'Waiting 1F-B', 'Nutrition Clinic', 'Counselling', 'Vaccination 1F'],
    'N-30': ['Cardiology · Room 101', 'Cardiology · Room 102', 'Cardiology · Room 103', 'Cardiac Cath Lab', 'Echo Lab 1F', 'Cardiac Rehab', 'Cardiothoracic Surgery · Room 107', 'Vascular Surgery · Room 108', 'Heart Failure Clinic', 'Cardiology Waiting'],
    'N-8': ['Neurology · Room 111', 'Neurology · Room 112', 'Neurosurgery · Room 113', 'EEG & EMG Lab', 'Stroke Clinic', 'Memory Clinic', 'Epilepsy Clinic', 'Neuro Rehab', 'Movement Disorders Clinic', 'Neurology Waiting'],
    N14: ['Orthopaedics · Room 121', 'Orthopaedics · Room 122', 'Spine Clinic', 'Sports Injury Clinic', 'Plaster Room 1F', 'Rheumatology', 'Hand Surgery · Room 127', 'Paediatric Orthopaedics', 'Bone Densitometry', 'Orthopaedics Waiting'],
    N34: ['Psychiatry · Room 171', 'Psychology', 'Pain Clinic 1F', 'Pre-op Assessment 1F', 'Anaesthesia Clinic', 'Plastic Surgery · Room 176', 'General Surgery · Room 177', 'General Surgery · Room 178', 'Bariatric Clinic', 'Surgery Waiting'],
    'S-38': ['Paediatrics · Room 131', 'Paediatrics · Room 132', 'Neonatology', 'Obstetrics & Gynaecology · Room 134', 'Obstetrics & Gynaecology · Room 135', 'Fertility Clinic', 'Antenatal Clinic', 'Lactation Room', 'Child Development Clinic', "Women & Children Waiting"],
    'S-18': ['Gastroenterology · Room 141', 'Gastroenterology · Room 142', 'Endoscopy Suite 1F', 'Nephrology · Room 144', 'Dialysis Unit 1F', 'Hepatology', 'Liver Transplant Clinic', 'Kidney Transplant Clinic', 'Colorectal Clinic', 'Gastro Waiting'],
    S20: ['ENT · Room 151', 'ENT · Room 152', 'Ophthalmology · Room 153', 'Ophthalmology · Room 154', 'Dermatology · Room 155', 'Audiology 1F', 'Cosmetology', 'Optometry', 'Laser Room', 'ENT & Eye Waiting'],
    S40: ['Oncology Day Care', 'Medical Oncology · Room 162', 'Pulmonology · Room 163', 'Pulmonary Function Lab 1F', 'Urology · Room 165', 'Endocrinology · Room 166', 'Surgical Oncology · Room 167', 'Radiation Oncology Desk', 'Chemotherapy Suite', 'Oncology Waiting'],
    CN: ['OPD Waiting 1F-C', 'Nurse Station 1F', 'Doctors Lounge 1F', 'Waiting 1F-D', 'Store Room 1F', 'Staff Lounge 1F', 'Waiting 1F-E', 'Seminar Room', 'Library', 'Waiting 1F-F', 'Records 1F', 'Linen Room 1F', 'Waiting 1F-G', 'Meeting Room', 'Help Desk 1F (east)', 'Waiting 1F-H'],
    CS: ['Wound Care 1F', 'Waiting 1F-I', 'OPD Billing 1F (west)', 'Waiting 1F-J', 'Sample Collection 1F (east)', 'Waiting 1F-K', 'Pharmacy 1F (east)', 'Waiting 1F-L', 'Waiting 1F-M', 'Help Desk 1F (west)', 'Waiting 1F-N', 'Waiting 1F-O', 'Store Room 1F (east)', 'Waiting 1F-P', 'Waiting 1F-Q', 'Waiting 1F-R'],
  },
};

function categoryOf(name) {
  const n = name.toLowerCase();
  if (/emergency|triage|resus|trauma|minor ot|er obs/.test(n)) return 'emergency';
  if (/x-ray|ct |ct scan|pet-ct|nuclear|densitometry|mri|ultrasound|mammo|radiology|laboratory|sample|blood bank|microbio|ecg|tmt|echo|eeg|cath|endoscopy|lab\b|function lab|sleep lab|audiology/.test(n)) return 'diagnostics';
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
    LIFTS.forEach((l) => rooms.push(room(fid, `${l.code}-${fid.toLowerCase()}`, l.name, 'மின்தூக்கி', 'lift', { x0: l.x0, x1: l.x1, y0: H + 0.2, y1: H + 2.2, door: 'S' }, l.group, false)));
    STAIRS.forEach((st) => rooms.push(room(fid, `${st.code}-${fid.toLowerCase()}`, st.label, 'படிக்கட்டு', 'stairs', { x0: st.x0, x1: st.x1, y0: H + 0.2, y1: H + 2.8, door: 'S' }, st.code.toUpperCase(), false)));
    WCS.forEach((w, i) => rooms.push(room(fid, `restroom-${i + 1}-${fid.toLowerCase()}`, 'Restrooms', 'கழிவறைகள்', 'restroom',
      w.side > 0 ? { x0: w.x0, x1: w.x1, y0: H + 0.2, y1: H + 2.6, door: 'S' } : { x0: w.x0, x1: w.x1, y0: -H - 2.6, y1: -H - 0.2, door: 'N' }, null, true)));
    // courtyards / service
    backBlocks().forEach((b, i) => rooms.push(room(fid, `${b.garden ? 'garden' : 'service'}-${i + 1}-${fid.toLowerCase()}`,
      b.garden ? (fid === 'G' ? 'Garden Courtyard' : 'Terrace Garden') : 'Service Area', b.garden ? 'தோட்டம்' : 'சேவைப் பகுதி', b.garden ? 'garden' : 'service', { ...b, door: 'S' }, null, false)));
    // corridors (rectangles; the app takes their centre lines)
    walkways.push({ floor_id: fid, name: 'Main corridor', x: X0, y0: -H, x1: X1, y1: H });
    NORTH.forEach((xb) => walkways.push({ floor_id: fid, name: `Wing ${xb < 0 ? 'W' : 'E'}${Math.abs(xb)} (left)`, x: xb - H, y0: 0, x1: xb + H, y1: YTOP }));
    SOUTH.forEach((xb) => walkways.push({ floor_id: fid, name: xb === LOBBY ? 'Entrance lobby' : `Wing ${xb < 0 ? 'W' : 'E'}${Math.abs(xb)} (right)`, x: xb - H, y0: fid === 'G' && (xb === ER_WING || xb === LOBBY) ? -YTOP - 0.2 : -YTOP, x1: xb + H, y1: 0 }));
  }
  start_points.push(
    { code: 'main-entrance', floor_id: 'G', kind: 'entrance', name_en: 'Main Entrance (OPD Block)', name_ta: 'முதன்மை நுழைவாயில் (ஓபிடி)', x: LOBBY, y: -YTOP },
    { code: 'emergency-entrance', floor_id: 'G', kind: 'entrance', name_en: 'Emergency Entrance', name_ta: 'அவசர நுழைவாயில்', x: ER_WING, y: -YTOP },
    { code: 'kiosk-reception', floor_id: 'G', kind: 'kiosk', name_en: 'Kiosk · Reception', name_ta: 'கியோஸ்க் · வரவேற்பு', x: -2, y: 0 },
    { code: 'kiosk-1f-lifts', floor_id: '1F', kind: 'kiosk', name_en: 'Kiosk · First Floor Lifts', name_ta: 'கியோஸ்க் · முதல் தள மின்தூக்கி', x: 5, y: 0 },
  );
  return { settings: { hospital_name: 'Demo Super Speciality Hospital', hospital_name_ta: 'டெமோ சூப்பர் ஸ்பெஷாலிட்டி மருத்துவமனை' }, floors, rooms, walkways, start_points, doctors: doctors(rooms) };
}

function room(floor_id, code, name_en, name_ta, category, s, link_group = null, searchable = true) {
  return {
    code, floor_id, name_en, name_ta, category,
    x0: r2(s.x0), x1: r2(s.x1), y0: r2(s.y0), y1: r2(s.y1), door_side: s.door, door_pos: 0.5,
    door_width: category === 'lift' ? 3 : 1.6, link_group, keywords: '',
    searchable: searchable && !['garden', 'service', 'lift', 'stairs'].includes(category),
  };
}

// Fictional doctors for the demo (not real people).
const DOCS = [
  ['Dr. Arun Prakash', 'Cardiology', 'MD, DM (Cardiology)', 'cardiology-room-101', 'Mon–Sat', '09:30–13:30'],
  ['Dr. Meena Sundaram', 'Cardiology', 'MD, DNB (Cardiology)', 'cardiology-room-102', 'Mon–Fri', '14:00–18:00'],
  ['Dr. Karthik Raman', 'Interventional Cardiology', 'MD, DM, FSCAI', 'cardiology-room-103', 'Tue, Thu, Sat', '10:00–14:00'],
  ['Dr. Lakshmi Narayanan', 'Neurology', 'MD, DM (Neurology)', 'neurology-room-111', 'Mon–Sat', '09:00–13:00'],
  ['Dr. Vignesh Balaji', 'Neurology', 'MD, DM (Neurology)', 'neurology-room-112', 'Mon–Fri', '16:00–20:00'],
  ['Dr. Senthil Kumar', 'Neurosurgery', 'MS, MCh (Neurosurgery)', 'neurosurgery-room-113', 'Mon, Wed, Fri', '11:00–15:00'],
  ['Dr. Priya Ramesh', 'Orthopaedics', 'MS (Ortho)', 'orthopaedics-room-121', 'Mon–Sat', '09:30–13:30'],
  ['Dr. Rajesh Kannan', 'Orthopaedics · Joint Replacement', 'MS (Ortho), FRCS', 'orthopaedics-room-122', 'Mon–Fri', '15:00–19:00'],
  ['Dr. Divya Mohan', 'Spine Surgery', 'MS, MCh (Spine)', 'spine-clinic', 'Tue, Thu', '10:00–14:00'],
  ['Dr. Anitha Selvam', 'Paediatrics', 'MD (Paediatrics)', 'paediatrics-room-131', 'Mon–Sat', '09:00–13:00'],
  ['Dr. Gokul Krishnan', 'Paediatrics', 'MD, DCH', 'paediatrics-room-132', 'Mon–Sat', '17:00–20:00'],
  ['Dr. Kavitha Arumugam', 'Obstetrics & Gynaecology', 'MS (OG), DNB', 'obstetrics-gynaecology-room-134', 'Mon–Sat', '10:00–14:00'],
  ['Dr. Sangeetha Velu', 'Obstetrics & Gynaecology', 'MS (OG)', 'obstetrics-gynaecology-room-135', 'Mon–Fri', '15:00–19:00'],
  ['Dr. Manoj Subramanian', 'Gastroenterology', 'MD, DM (Gastro)', 'gastroenterology-room-141', 'Mon–Sat', '09:30–13:30'],
  ['Dr. Revathi Shankar', 'Gastroenterology', 'MD, DM (Gastro)', 'gastroenterology-room-142', 'Mon, Wed, Fri', '14:00–18:00'],
  ['Dr. Hariharan Mani', 'Nephrology', 'MD, DM (Nephrology)', 'nephrology-room-144', 'Mon–Sat', '10:00–14:00'],
  ['Dr. Deepa Chandran', 'ENT', 'MS (ENT)', 'ent-room-151', 'Mon–Sat', '09:00–13:00'],
  ['Dr. Suresh Babu', 'ENT · Head & Neck', 'MS (ENT), DNB', 'ent-room-152', 'Tue–Sat', '15:00–19:00'],
  ['Dr. Nithya Rajan', 'Ophthalmology', 'MS (Ophth)', 'ophthalmology-room-153', 'Mon–Sat', '09:30–13:30'],
  ['Dr. Prakash Iyer', 'Ophthalmology · Retina', 'MS, FRCS (Ophth)', 'ophthalmology-room-154', 'Mon, Thu', '14:00–18:00'],
  ['Dr. Shalini Ganesh', 'Dermatology', 'MD (DVL)', 'dermatology-room-155', 'Mon–Sat', '10:00–14:00'],
  ['Dr. Ramya Venkatesh', 'Medical Oncology', 'MD, DM (Oncology)', 'medical-oncology-room-162', 'Mon–Fri', '10:00–15:00'],
  ['Dr. Ashok Kumar', 'Pulmonology', 'MD (Pulmonology)', 'pulmonology-room-163', 'Mon–Sat', '09:00–13:00'],
  ['Dr. Bharath Raj', 'Urology', 'MS, MCh (Urology)', 'urology-room-165', 'Mon–Sat', '15:00–19:00'],
  ['Dr. Uma Maheswari', 'Endocrinology', 'MD, DM (Endo)', 'endocrinology-room-166', 'Mon–Fri', '09:30–13:30'],
  ['Dr. Saravanan P', 'Psychiatry', 'MD (Psychiatry)', 'psychiatry-room-171', 'Mon–Sat', '10:00–14:00'],
  ['Dr. Jayanthi Murugan', 'General Medicine', 'MD (Gen Med)', 'general-medicine-room-1', 'Mon–Sat', '08:00–14:00'],
  ['Dr. Naveen Kumar', 'General Medicine', 'MD (Gen Med)', 'general-medicine-room-2', 'Mon–Sat', '14:00–20:00'],
  ['Dr. Sowmya Ravi', 'Diabetology', 'MD, Dip. Diabetology', 'diabetology', 'Mon–Sat', '08:30–12:30'],
  ['Dr. Venkat Raman', 'Emergency Medicine', 'MD (Emergency Med)', 'emergency-triage', 'All days', '24 hours'],
  ['Dr. Pooja Srinivasan', 'Dental Surgery', 'BDS, MDS', 'dental-clinic', 'Mon–Sat', '10:00–18:00'],
  ['Dr. Arjun Mohan', 'Physiotherapy', 'BPT, MPT (Ortho)', 'physiotherapy', 'Mon–Sat', '08:00–17:00'],
];
function doctors(rooms) {
  const codes = new Set(rooms.map((r) => r.code));
  return DOCS.map(([name, speciality, qualification, room_code, days, hours], i) => {
    if (!codes.has(room_code)) throw new Error(`doctor room missing: ${room_code}`);
    return { name, speciality, qualification, room_code, days, hours, sort: i + 1 };
  });
}

// Database rows use z = -y and the top-left corner (admin plan: north is up).
export function toDb(L) {
  const rect = (o) => ({ x: o.x0 ?? o.x, z: -(o.y1), w: r2((o.x1) - (o.x0 ?? o.x)), d: r2(o.y1 - o.y0) });
  return {
    settings: L.settings, floors: L.floors,
    rooms: L.rooms.map((r) => { const { x0, x1, y0, y1, ...rest } = r; return { ...rest, ...rect({ x0, x1, y0, y1 }) }; }),
    walkways: L.walkways.map((w) => ({ floor_id: w.floor_id, name: w.name, ...rect({ x0: w.x, x1: w.x1, y0: w.y0, y1: w.y1 }) })),
    start_points: L.start_points.map((p) => ({ ...p, z: r2(-p.y), y: undefined })).map(({ y, ...p }) => p),
    doctors: L.doctors,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const db = toDb(generate());
  fs.writeFileSync(new URL('../src/data/hospitalSeed.json', import.meta.url), JSON.stringify(db));
  const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const ins = (t, rows) => rows.length ? `insert into public.nav_${t}(${Object.keys(rows[0]).join(',')}) values\n${rows.map((r) => `(${Object.values(r).map(q).join(',')})`).join(',\n')};` : '';
  const sql = [
    '-- NaviSpace Hospital sample layout (generated by scripts/hospital-layout.mjs). Clears and reloads the layout tables.',
    'delete from public.nav_doctors; delete from public.nav_start_points; delete from public.nav_walkways; delete from public.nav_rooms; delete from public.nav_floors; delete from public.nav_settings;',
    ins('settings', [{ id: 1, ...db.settings }]), ins('floors', db.floors), ins('rooms', db.rooms), ins('walkways', db.walkways), ins('start_points', db.start_points), ins('doctors', db.doctors),
  ].join('\n');
  fs.mkdirSync(new URL('../supabase/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../supabase/hospital_seed.sql', import.meta.url), sql + '\n');
  const per = (f) => db.rooms.filter((r) => r.floor_id === f && r.searchable).length;
  console.log(`rooms ${db.rooms.length} (searchable G ${per('G')}, 1F ${per('1F')}), walkways ${db.walkways.length}, doctors ${db.doctors.length}`);
}
