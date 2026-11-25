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

// 18 rooms per wide wing (nearest the main corridor first), 10 in the lobby wing, 6 / 8 between the wings.
// 'DOC:<speciality>' = a consultation room: it gets the next room number and is named after its doctor,
// e.g. "Dr. Arvind Ramanan (Cardiology) · 105". '#' in a name = the next room number on that floor.
const D = (spec, n = 1) => Array(n).fill(`DOC:${spec}`);
const R = (label, n) => Array.from({ length: n }, () => label);
export const DEPT = {
  G: {
    S0: ['Registration', 'Cash Counter 1', 'Insurance Desk', 'May I Help You', 'OP Pharmacy', 'Cash Counter 2', 'Admissions', 'Patient Relations', 'Medical Records', 'Wheelchair Desk'],
    'S-30': ['Emergency Triage', 'Resuscitation', 'Trauma Bay', 'Minor OT', 'ER Observation', 'Emergency Pharmacy', 'Emergency Cash Counter', 'ER Nurse Station', 'Emergency X-Ray', 'Plaster Room', 'Burns Dressing', 'Decontamination Room',
      'Ambulance Desk', 'Security Office', 'MLC Desk', 'Poison Control', 'ER Relatives Waiting', 'Triage Waiting'],
    S30: ['Sample Collection', 'Biochemistry', 'Haematology', 'Clinical Pathology', 'Microbiology', 'Histopathology', 'Cytology', 'Immunology & Serology', 'Molecular Diagnostics (PCR)', 'Blood Bank',
      'Transfusion Medicine', 'Report Collection', 'Home Collection Desk', 'Lab Reception', 'Phlebotomy Bay 2', 'Urine & Stool Collection', 'Lab Quality Office', 'Central Lab Store'],
    'N-30': ['Radiology Reception', 'X-Ray 1', 'X-Ray 2', 'CT Scan', 'MRI', 'Ultrasound 1', 'Ultrasound 2', 'Doppler Studies', 'Mammography', 'DEXA Scan', 'Fluoroscopy', 'Cath Lab', 'Cath Lab 2',
      'Nuclear Medicine', 'PET-CT', 'Radiology Reporting', 'Contrast Prep Room', 'Imaging Waiting'],
    N0: ['Executive Health Check', 'ECG Room', 'Echo Lab', 'TMT (Stress Test)', 'Pulmonary Function Lab', 'Health Check Lounge', ...D('General Medicine', 2), ...D('Family Medicine'), ...D('Dental Surgery', 2),
      'Dental X-Ray (OPG)', ...D('Clinical Nutrition'), 'Vaccination Centre', 'Diabetes Education', 'Minor Procedure Room', 'Injection Room', 'OPD Nurse Station'],
    N30: ['Physiotherapy', 'Occupational Therapy', 'Speech Therapy', 'Hydrotherapy', 'Sports Rehabilitation', 'Audiology', 'IP Pharmacy', 'Housekeeping', 'Biomedical Engineering', 'IT Help Desk',
      'HR Office', 'Administrative Office', 'Legal Office', 'Medical Superintendent', 'Nursing Office', 'Finance & Accounts', 'Conference Room', 'Training Hall'],
    CN: ['ATM & Bank', 'Prayer Room', 'Baby Feeding Room', "Children's Play Area", 'Gift & Flower Shop', 'Optical Store'],
    CS: ['Food Court · South Indian Meals', 'Food Court · Tiffin & Dosa', 'Food Court · North Indian & Chinese', 'Food Court · Seating Hall', 'Food Court · Coffee & Tea', 'Food Court · Fresh Juice & Fruits',
      'Food Court · Bakery & Snacks', 'Food Court · Ice Cream & Desserts'],
  },
  '1F': {
    S0: ['OPD Waiting Atrium', 'OPD Billing 1F', 'Help Desk 1F', 'Pharmacy 1F', 'Sample Collection 1F', 'Vitals Check Station', 'Waiting 1F-A', 'Waiting 1F-B', 'Health Check Lounge 1F', 'Wheelchair Bay 1F'],
    'N-30': ['Cardiology Waiting', ...D('Cardiology', 5), ...D('Cardiothoracic Surgery', 2), ...D('Vascular Surgery'), 'Echo Lab 1F', 'ECG 1F', 'Holter Monitoring', 'Pacemaker Clinic', 'Cardiac Rehab', 'Cardio Counselling',
      'Cardiac Procedure Room', 'Cardiac Nurse Station', ...D('Cardiology')],
    N0: ['Neurology Waiting', ...D('Neurology', 4), ...D('Neurosurgery', 2), ...D('Psychiatry', 2), ...D('Clinical Psychology'), 'EEG & EMG Lab', 'Nerve Conduction Lab', 'Memory Clinic', 'Neuro Rehab', 'Counselling Room',
      'Epilepsy Monitoring', 'Neuro Nurse Station', 'Sleep Lab'],
    N30: ['Orthopaedics Waiting', ...D('Orthopaedics', 4), ...D('Spine Surgery'), ...D('Sports Medicine'), ...D('Rheumatology'), ...D('Hand Surgery'), ...D('Pain Medicine'), 'Plaster Room 1F', 'Ortho Procedure Room',
      'Physiotherapy 1F', 'Brace & Splint Fitting', 'Joint School', 'Ortho X-Ray Review', 'Ortho Counselling', 'Ortho Nurse Station'],
    'S-30': ['Women & Children Waiting', ...D('Paediatrics', 3), ...D('Neonatology'), ...D('Obstetrics & Gynaecology', 3), ...D('Reproductive Medicine'), ...D('Fetal Medicine'), ...D('Paediatric Surgery'), 'Antenatal Classes',
      'Lactation Room', 'Colposcopy', 'Vaccination 1F', 'Child Development Clinic', 'Paediatric Nurse Station', 'Mother & Baby Lounge'],
    S30: ['Specialty Waiting', ...D('Gastroenterology', 2), ...D('Nephrology'), ...D('ENT', 2), ...D('Ophthalmology', 2), ...D('Dermatology'), ...D('Pulmonology'), ...D('Urology'), ...D('Endocrinology'), ...D('General Surgery', 2),
      ...D('Plastic Surgery'), 'Eye Refraction Room', 'Audiometry 1F', 'Specialty Nurse Station'],
    CN: ['Nurse Station 1F', 'Doctors Lounge 1F', 'Seminar Room', 'Library', 'Staff Lounge 1F', 'Store Room 1F'],
    CS: ['Records 1F', 'Waiting 1F-C', 'Linen Room 1F', 'Waiting 1F-D', 'Meeting Room', 'Waiting 1F-E', 'Help Desk 1F (east)', 'Water & Snacks Kiosk 1F'],
  },
  '2F': {
    S0: ['Waiting Atrium 2F', 'Billing 2F', 'Help Desk 2F', 'Pharmacy 2F', 'Sample Collection 2F', 'Day Care Admissions', 'Insurance / TPA Desk 2F', 'Waiting 2F-A', 'Waiting 2F-B', 'Vitals Station 2F'],
    'N-30': ['Dialysis Reception', 'Dialysis Bay 1', 'Dialysis Bay 2', 'Dialysis Bay 3', 'Dialysis Bay 4', 'Dialysis Bay 5', 'Dialysis Bay 6', 'Dialysis Isolation Room', ...D('Nephrology', 2), 'Peritoneal Dialysis Training',
      'Vascular Access Clinic', 'Kidney Diet Counselling', 'Transplant Coordinator', 'Dialysis Nurse Station', 'Dialysis Waiting', 'Dialysis Store', 'Water Treatment Plant'],
    N0: ['Endoscopy Reception', 'Endoscopy Suite 1', 'Endoscopy Suite 2', 'Colonoscopy Room', 'ERCP Room', 'Bronchoscopy Room', 'Endoscopy Recovery Bay', ...D('Gastroenterology', 2), ...D('Hepatology'), ...D('Pulmonology'),
      'Liver Clinic', 'Capsule Endoscopy', 'Manometry Lab', 'Endoscopy Nurse Station', 'Endoscopy Waiting', 'Patient Changing Room 2F', 'Scope Cleaning (Reprocessing)'],
    N30: ['Oncology Waiting', 'Chemotherapy Day Care A', 'Chemotherapy Day Care B', 'Chemotherapy Day Care C', 'Chemo Pharmacy (Cytotoxic)', ...D('Medical Oncology', 2), ...D('Surgical Oncology'), ...D('Radiation Oncology'),
      ...D('Clinical Haematology'), ...D('Palliative Medicine'), 'Breast Clinic', 'Radiotherapy Planning', 'Tumour Board Room', 'Oncology Counselling', 'Cancer Support Group Room', 'Wig & Prosthesis Corner', 'Oncology Nurse Station'],
    'S-30': ['Day Care Reception', 'Day Care Ward A (beds 1–8)', 'Day Care Ward B (beds 1–8)', 'Day Care Procedure Room', 'Infusion Bay', 'Blood Transfusion Day Care', 'Minor OT 2F', 'Day Care Recovery',
      ...D('Anaesthesiology', 2), 'Pre-Anaesthesia Check', 'Discharge Lounge', 'Day Care Nurse Station', 'Day Care Pantry', 'Day Care Waiting', 'Patient Changing 2F', 'Linen Room 2F', 'Dirty Utility 2F'],
    S30: ['Medicine Waiting', ...D('General Medicine', 4), ...D('Diabetology', 2), ...D('Endocrinology'), ...D('Infectious Diseases'), ...D('Geriatrics'), ...D('Family Medicine'), ...D('Dermatology'), ...D('ENT'),
      ...D('Ophthalmology'), ...D('Pulmonology'), 'Injection Room 2F', 'Wound Dressing Room', 'Medicine Nurse Station'],
    CN: ['Nurse Station 2F', 'Doctors Lounge 2F', 'Staff Lounge 2F', 'Store Room 2F', 'Counselling Room 2F', 'Prayer Room 2F'],
    CS: ['Water & Snacks Kiosk 2F', 'Waiting 2F-C', 'Linen Room 2F (east)', 'Waiting 2F-D', 'Meeting Room 2F', 'Waiting 2F-E', 'Help Desk 2F (east)', 'Baby Feeding Room 2F'],
  },
  '3F': {
    S0: ['ICU Visitor Desk', 'Relatives Waiting Hall 3F', 'Help Desk 3F', 'Family Counselling Room', 'Pharmacy Satellite 3F', 'Billing 3F', 'Waiting 3F-A', 'Waiting 3F-B', 'Water & Snacks Kiosk 3F', 'Prayer Room 3F'],
    'N-30': ['OT Relatives Waiting', 'OT Reception & Holding', 'Pre-op Holding Bay', 'Operation Theatre 1', 'Operation Theatre 2', 'Operation Theatre 3', 'Operation Theatre 4', 'Operation Theatre 5 (Cardiac)',
      'Operation Theatre 6 (Neuro)', 'Hybrid OT', 'Scrub Area', 'CSSD (Sterile Supply)', 'Anaesthesia Workroom', 'OT Pharmacy', 'OT Store', 'Surgeons Lounge', 'OT Changing (Male)', 'OT Changing (Female)'],
    N0: ['Post-op Recovery (PACU) Nurse Station', 'Recovery Waiting', ...R('Recovery Room #', 16)],
    N30: ['ICU Relatives Waiting', 'MICU · Medical ICU (beds 1–4)', 'MICU · Medical ICU (beds 5–8)', 'MICU · Medical ICU (beds 9–12)', 'MICU Nurse Station', 'MICU Isolation Room', 'SICU · Surgical ICU (beds 1–4)',
      'SICU · Surgical ICU (beds 5–8)', 'SICU · Surgical ICU (beds 9–12)', 'SICU Nurse Station', 'SICU Isolation Room', 'ICU Doctors Room', 'ICU Counselling Room', 'ICU Pharmacy', 'Blood Gas Lab', 'ICU Store',
      'ICU Equipment Room', 'Dirty Utility (ICU)'],
    'S-30': ['NICU / PICU Parents Waiting', 'CCU · Coronary Care (beds 1–4)', 'CCU · Coronary Care (beds 5–8)', 'CCU Nurse Station', 'Cardiac Step-down Unit', 'NICU · Newborn ICU (cots 1–6)', 'NICU · Newborn ICU (cots 7–12)',
      'NICU Nurse Station', 'Breast Milk Room', 'Kangaroo Mother Care Room', 'PICU · Paediatric ICU (beds 1–4)', 'PICU · Paediatric ICU (beds 5–8)', 'PICU Nurse Station', 'Neuro ICU (beds 1–4)', 'Neuro ICU (beds 5–8)',
      'Burns ICU', 'Isolation ICU (negative pressure)', 'Transplant ICU'],
    S30: ['Labour Relatives Waiting', 'Labour Ward Reception', 'Labour Room 1', 'Labour Room 2', 'Labour Room 3', 'Delivery Room 1', 'Delivery Room 2', 'Obstetric OT', 'Newborn Resuscitation Room', 'Labour Nurse Station',
      'HDU · High Dependency (beds 1–4)', 'HDU · High Dependency (beds 5–8)', 'HDU Nurse Station', 'Doctors Duty Room 3F', 'Bedside Dialysis Store', 'Linen Room 3F', 'Dirty Utility 3F', 'Labour Ward Store'],
    CN: ['Nurse Station 3F', 'Blood Bank Satellite', 'Doctors Duty Room 3F (west)', 'Store Room 3F', 'Staff Lounge 3F', 'Equipment Bay 3F'],
    CS: ['Water & Snacks Kiosk 3F (east)', 'Waiting 3F-C', 'Linen Room 3F (east)', 'Waiting 3F-D', 'Meeting Room 3F', 'Waiting 3F-E', 'Help Desk 3F (east)', 'Baby Feeding Room 3F'],
  },
  '4F': {
    S0: ['Ward Reception 4F', 'Visitor Desk 4F', 'Billing & Discharge 4F', 'Pharmacy Satellite 4F', 'Help Desk 4F', 'Waiting 4F-A', 'Waiting 4F-B', 'Dietary Kitchen (Ward Meals)', 'Prayer Room 4F', 'Sample Collection 4F'],
    'N-30': ['Male Ward Nurse Station', 'General Ward A · Male (beds 1–8)', 'General Ward A · Male (beds 9–16)', 'General Ward B · Male (beds 1–8)', 'General Ward B · Male (beds 9–16)', 'Male Ward Treatment Room',
      'Male Ward Pantry', 'Doctors Duty Room 4F', 'Linen Room 4F', 'Dirty Utility 4F', ...R('Semi-Private Room # (2 beds)', 8)],
    N0: ['Post-Surgical Ward Nurse Station', 'Surgical Ward Treatment Room', ...R('Post-op Patient Room #', 16)],
    N30: ['Female Ward Nurse Station', 'General Ward C · Female (beds 1–8)', 'General Ward C · Female (beds 9–16)', 'General Ward D · Female (beds 1–8)', 'General Ward D · Female (beds 9–16)', 'Female Ward Treatment Room',
      'Female Ward Pantry', 'Doctors Duty Room 4F (east)', 'Linen Room 4F (east)', 'Dirty Utility 4F (east)', ...R('Semi-Private Room # (2 beds)', 8)],
    'S-30': ['Maternity Nurse Station', 'Maternity Ward (beds 1–8)', 'Maternity Ward (beds 9–16)', 'Nursery', ...R('Postnatal Room #', 6), 'Paediatric Nurse Station 4F', 'Paediatric Ward (beds 1–8)',
      'Paediatric Ward (beds 9–16)', ...R('Paediatric Room #', 2), 'Play Therapy Room', 'Parents Lounge 4F', 'Breastfeeding Room 4F'],
    S30: ['Private Wing Nurse Station', 'Private Wing Pantry', ...R('Private Room #', 14), 'Deluxe Suite #', 'Deluxe Suite #'],
    CN: ['Nurse Station 4F', 'Store Room 4F', 'Staff Lounge 4F', 'Equipment Bay 4F', 'Counselling Room 4F', 'Visitors Lounge 4F'],
    CS: ['Water & Snacks Kiosk 4F', 'Waiting 4F-C', 'Linen Store 4F', 'Waiting 4F-D', 'Meeting Room 4F', 'Waiting 4F-E', 'Help Desk 4F (east)', 'Baby Feeding Room 4F'],
  },
};

// Staff-only rooms stay on the map but are not offered in visitor search.
const STAFF_ONLY = /dirty utility|linen|store\b|store room|equipment|water treatment|scope cleaning|cssd|anaesthesia workroom|scrub|changing \(|doctors duty|doctors lounge|doctors room|staff lounge|surgeons lounge|pantry|housekeeping|biomedical|lab quality|central lab store|dietary kitchen|tumour board|bedside dialysis store/;
function categoryOf(name, fid, zone) {
  const n = name.toLowerCase();
  if (fid === 'G' && zone === 'S-30') return /pharmacy/.test(n) ? 'pharmacy' : 'emergency';
  if (/food court|cafeteria|snacks kiosk/.test(n)) return 'amenities';
  if (/\b[msnp]?icu\b|\bccu\b|\bhdu\b|operation theatre|hybrid ot|obstetric ot|minor ot|pre-op|recovery|post-op|ward|private room|suite|labour|delivery|nursery|postnatal|paediatric room|step-down|dialysis bay|dialysis isolation|day care|infusion|chemotherapy|isolation|kangaroo|breast milk|resuscitation room|\bpacu\b|holding/.test(n)) return 'inpatient';
  if (/x-ray|ct |ct scan|pet-ct|nuclear|densitometry|dexa|opg|doppler|fluoro|holter|pacemaker|biochem|haemat|pathology|histo|cytology|immunology|serology|molecular|transfusion|phlebotomy|collection|lab reception|contrast|imaging|mri|ultrasound|mammo|radiology|blood bank|microbio|ecg|tmt|echo|eeg|nerve conduction|cath|endoscopy|colonoscopy|ercp|bronchoscopy|manometry|lab\b|function lab|sleep lab|audiology|audiometry|blood gas|refraction|radiotherapy/.test(n)) return 'diagnostics';
  if (/pharmacy|optical/.test(n)) return 'pharmacy';
  if (/atm|prayer|gift|feeding|play area|lounge|waiting|atrium|library|kiosk/.test(n)) return 'amenities';
  if (/reception|registration|cash|may i help|billing|office|superintendent|finance|it help|conference|training|seminar|meeting|housekeeping|linen|biomedical|records|help desk|admissions|tpa|insurance|patient relations|security|wheelchair|ambulance|report|store|nurse station|visitor desk|duty room|pantry|kitchen|utility|equipment|changing|counselling|coordinator|scrub|cssd|workroom|support group|tumour board|prosthesis/.test(n)) return 'services';
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
  return taWords(name);
};

export const FLOOR_LIST = [
  { id: 'G', level: 0, name_en: 'Ground Floor', name_ta: 'தரைத்தளம்', no: 'G' },
  { id: '1F', level: 1, name_en: 'First Floor', name_ta: 'முதல் தளம்', no: '1' },
  { id: '2F', level: 2, name_en: 'Second Floor', name_ta: 'இரண்டாம் தளம்', no: '2' },
  { id: '3F', level: 3, name_en: 'Third Floor', name_ta: 'மூன்றாம் தளம்', no: '3' },
  { id: '4F', level: 4, name_en: 'Fourth Floor', name_ta: 'நான்காம் தளம்', no: '4' },
];
const TA_WORD = [['Recovery Room', 'மீட்பு அறை'], ['Semi-Private Room', 'அரை-தனி அறை'], ['Private Room', 'தனி அறை'], ['Deluxe Suite', 'டீலக்ஸ் அறை'], ['Post-op Patient Room', 'அறுவைக்குப் பின் நோயாளர் அறை'],
  ['Postnatal Room', 'பிரசவத்துக்குப் பின் அறை'], ['Paediatric Room', 'குழந்தைகள் அறை'], ['Food Court', 'உணவகம்'], ['General Ward', 'பொது வார்டு'], ['Operation Theatre', 'அறுவை அரங்கம்'], ['Waiting', 'காத்திருப்பு'],
  ['Nurse Station', 'செவிலியர் நிலையம்'], ['Male', 'ஆண்'], ['Female', 'பெண்'], ['beds', 'படுக்கைகள்'], ['cots', 'தொட்டில்கள்'], ['Help Desk', 'உதவி மையம்'], ['Pharmacy', 'மருந்தகம்'], ['Billing', 'கட்டணம்'],
  ['Dialysis', 'டயாலிசிஸ்'], ['Endoscopy', 'எண்டோஸ்கோபி'], ['Chemotherapy', 'கீமோதெரபி'], ['Labour Room', 'பிரசவ அறை'], ['Delivery Room', 'பிரசவ அறை'], ['Maternity Ward', 'மகப்பேறு வார்டு'], ['Paediatric Ward', 'குழந்தைகள் வார்டு'],
  ['2 beds', '2 படுக்கைகள்'], ['Prayer Room', 'பிரார்த்தனை அறை'], ['Sample Collection', 'மாதிரி சேகரிப்பு']];
// Translate word by word, but only use the result when nothing English is left (no half-Tamil names).
const taWords = (name) => {
  const t = TA_WORD.reduce((x, [en, ta]) => x.split(en).join(ta), name);
  return /[A-Za-z]/.test(t.replace(/\b\d+F\b|\b[GF]\d+\b|\b[A-Z]\b/g, '')) ? name : t;
};

export function generate() {
  const floors = FLOOR_LIST.map(({ no, ...f }) => f);
  const rooms = [], walkways = [], start_points = [];
  const S = slots();
  const zones = {};
  for (const s of S) (zones[s.zone] ||= []).push(s);
  for (const z of Object.values(zones)) z.sort((a, b) => a.order - b.order);
  for (const f of FLOOR_LIST) {
    const fid = f.id, low = fid.toLowerCase();
    let next = 1;                                        // room numbers: 101, 102 … on 1F; G01, G02 … on the ground floor
    const roomNo = () => (fid === 'G' ? `G${String(next++).padStart(2, '0')}` : `${f.no}${String(next++).padStart(2, '0')}`);
    for (const [zone, list] of Object.entries(zones)) {
      const names = DEPT[fid][zone] || [];
      if (names.length !== list.length) throw new Error(`${fid} ${zone}: ${names.length} names for ${list.length} rooms`);
      list.forEach((s, i) => {
        let name = names[i], spec = null, no = null;
        if (name.startsWith('DOC:')) { spec = name.slice(4); no = roomNo(); name = `Consultation Room · ${no}`; }
        else if (name.includes('#')) { no = roomNo(); name = name.replace('#', no); }
        let code = no ? `room-${no.toLowerCase()}` : slug(name);
        if (rooms.some((r) => r.code === code)) code = `${code}-${low}`;
        for (let k = 2; rooms.some((r) => r.code === code); k++) code = `${slug(name)}-${low}-${k}`;
        const cat = spec ? 'opd' : categoryOf(name, fid, zone);
        const r = room(fid, code, name, spec ? `ஆலோசனை அறை · ${no}` : taOf(name), cat, s, null, !STAFF_ONLY.test(name.toLowerCase()));
        r.room_no = no;
        if (spec) r._spec = spec;
        rooms.push(r);
      });
    }
    // cores (same place on every floor so lifts and stairs line up)
    LIFTS.forEach((l) => rooms.push(room(fid, `${l.code}-${low}`, l.name, 'மின்தூக்கி', 'lift',
      l.side > 0 ? { x0: l.x0, x1: l.x1, y0: H + 0.2, y1: H + 2.2, door: 'S' } : { x0: l.x0, x1: l.x1, y0: -H - 2.2, y1: -H - 0.2, door: 'N' }, l.group, false)));
    STAIRS.forEach((st) => rooms.push(room(fid, `${st.code}-${low}`, st.label, 'படிக்கட்டு', 'stairs',
      st.side > 0 ? { x0: st.x0, x1: st.x1, y0: H + 0.2, y1: H + 2.8, door: 'S' } : { x0: st.x0, x1: st.x1, y0: -H - 2.8, y1: -H - 0.2, door: 'N' }, st.code.toUpperCase(), false)));
    WCS.forEach((w, i) => rooms.push(room(fid, `restroom-${i + 1}-${low}`, 'Restrooms', 'கழிவறைகள்', 'restroom',
      w.side > 0 ? { x0: w.x0, x1: w.x1, y0: H + 0.2, y1: H + 2.6, door: 'S' } : { x0: w.x0, x1: w.x1, y0: -H - 2.6, y1: -H - 0.2, door: 'N' }, null, true)));
    // courtyards / service
    const gName = fid === 'G' ? 'Garden Courtyard' : fid === '1F' ? 'Terrace Garden' : 'Open Courtyard (below)';
    backBlocks().forEach((b, i) => rooms.push(room(fid, `${b.garden ? 'garden' : 'service'}-${i + 1}-${low}`,
      b.garden ? gName : 'Service Area', b.garden ? 'தோட்டம்' : 'சேவைப் பகுதி', b.garden ? 'garden' : 'service', { ...b, door: 'S' }, null, false)));
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
    if (fid !== 'G') start_points.push({ code: `kiosk-${low}-lifts`, floor_id: fid, kind: 'kiosk', name_en: `Kiosk · ${f.name_en} Lifts`, name_ta: `கியோஸ்க் · ${f.name_ta} மின்தூக்கி`, x: 3, y: 0 });
  }
  start_points.unshift(
    { code: 'main-entrance', floor_id: 'G', kind: 'entrance', name_en: 'Main Entrance (OPD Block)', name_ta: 'முதன்மை நுழைவாயில் (ஓபிடி)', x: LOBBY, y: -YTOP },
    { code: 'emergency-entrance', floor_id: 'G', kind: 'entrance', name_en: 'Emergency Entrance', name_ta: 'அவசர நுழைவாயில்', x: ER_X, y: -YTOP },
    { code: 'kiosk-reception', floor_id: 'G', kind: 'kiosk', name_en: 'Kiosk · Reception', name_ta: 'கியோஸ்க் · வரவேற்பு', x: -2, y: 0 },
  );
  const docs = doctors(rooms);
  rooms.forEach((r) => delete r._spec);
  return { settings: { hospital_name: 'Demo Super Speciality Hospital', hospital_name_ta: 'டெமோ சூப்பர் ஸ்பெஷாலிட்டி மருத்துவமனை' }, floors, rooms, walkways, start_points, doctors: docs.doctors, sessions: docs.sessions, lab_tests: labTests(rooms) };
}

function room(floor_id, code, name_en, name_ta, category, s, link_group = null, searchable = true) {
  return {
    code, floor_id, name_en, name_ta, category,
    x0: r2(s.x0), x1: r2(s.x1), y0: r2(s.y0), y1: r2(s.y1), door_side: s.door, door_pos: 0.5,
    door_width: category === 'lift' ? 3 : 1.6, link_group, keywords: '', room_no: null,
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
// Clinics that keep their own name (therapy / emergency); every other doctor gets a numbered consultation room named after them.
const CLINIC_SPEC = { 'Emergency Triage': 'Emergency Medicine', Physiotherapy: 'Physiotherapy', 'Speech Therapy': 'Speech & Language Therapy', Audiology: 'Audiology' };
const QUAL = {
  Cardiology: 'MD, DM (Cardiology)', Neurology: 'MD, DM (Neurology)', Neurosurgery: 'MS, MCh (Neurosurgery)', Orthopaedics: 'MS (Orthopaedics)', Paediatrics: 'MD (Paediatrics)', 'Obstetrics & Gynaecology': 'MS (OG), DNB',
  Gastroenterology: 'MD, DM (Gastroenterology)', Nephrology: 'MD, DM (Nephrology)', ENT: 'MS (ENT)', Ophthalmology: 'MS (Ophthalmology)', Dermatology: 'MD (DVL)', 'Medical Oncology': 'MD, DM (Medical Oncology)',
  Pulmonology: 'MD (Respiratory Medicine)', Urology: 'MS, MCh (Urology)', Endocrinology: 'MD, DM (Endocrinology)', 'General Surgery': 'MS (General Surgery)', 'Plastic Surgery': 'MS, MCh (Plastic Surgery)',
  Psychiatry: 'MD (Psychiatry)', 'General Medicine': 'MD (General Medicine)', Diabetology: 'MD, Dip. Diabetology', 'Emergency Medicine': 'MD (Emergency Medicine)', 'Dental Surgery': 'BDS, MDS',
  Physiotherapy: 'BPT, MPT (Ortho)', Rheumatology: 'MD, DM (Rheumatology)', 'Paediatric Surgery': 'MS, MCh (Paediatric Surgery)', 'Cardiothoracic Surgery': 'MS, MCh (CTVS)', 'Vascular Surgery': 'MS, MCh (Vascular Surgery)',
  'Hand Surgery': 'MS (Ortho), FNB (Hand Surgery)', 'Spine Surgery': 'MS, FNB (Spine Surgery)', Neonatology: 'MD, DM (Neonatology)', 'Clinical Psychology': 'M.Phil (Clinical Psychology)',
  Hepatology: 'MD, DM (Hepatology)', 'Surgical Oncology': 'MS, MCh (Surgical Oncology)', 'Radiation Oncology': 'MD (Radiation Oncology)', 'Clinical Haematology': 'MD, DM (Clinical Haematology)',
  'Palliative Medicine': 'MD (Palliative Medicine)', Anaesthesiology: 'MD (Anaesthesiology)', 'Infectious Diseases': 'MD, DM (Infectious Diseases)', Geriatrics: 'MD (Geriatric Medicine)',
  'Family Medicine': 'MD (Family Medicine)', 'Clinical Nutrition': 'M.Sc (Clinical Nutrition)', 'Sports Medicine': 'MD (Sports Medicine)', 'Pain Medicine': 'MD, FIPM (Pain Medicine)',
  'Reproductive Medicine': 'MS (OG), Fellowship (Reproductive Medicine)', 'Fetal Medicine': 'MS (OG), Fellowship (Fetal Medicine)',
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
    if (r._spec) targets.push([r, r._spec]);
    else if (CLINIC_SPEC[r.name_en]) { targets.push([r, CLINIC_SPEC[r.name_en]]); if (r.name_en === 'Emergency Triage') targets.push([r, CLINIC_SPEC[r.name_en]]); }
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
    const evening = !emergency && R() < 0.3;
    if (r._spec) {   // name the room after its doctor: "Dr. Arvind Ramanan (Cardiology) · 105"
      r.name_en = `${name} (${spec}) · ${r.room_no}`;
      r.name_ta = `${name} (${TA[spec] || spec}) · அறை ${r.room_no}`;
      r.keywords = `${spec.toLowerCase()} doctor consultation room ${r.room_no}`;
    }
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
