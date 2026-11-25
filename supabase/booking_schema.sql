-- NaviSpace Hospital v5: doctor profiles, schedules, leave, lab tests, appointments, email outbox.
-- Apply after hospital_schema.sql. Patients book without an account through the nav_* functions
-- below (security definer); nobody can read appointments directly except admins and the doctor concerned.

-- ── Settings for booking ──────────────────────────────────────────────────────
alter table public.nav_settings
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists booking_days_ahead int not null default 14 check (booking_days_ahead between 1 and 90),
  add column if not exists lab_open time not null default '07:00',
  add column if not exists lab_close time not null default '13:00',
  add column if not exists lab_slot_capacity int not null default 8 check (lab_slot_capacity between 1 and 50),
  add column if not exists imaging_open time not null default '08:00',
  add column if not exists imaging_close time not null default '18:00',
  add column if not exists app_url text not null default '',
  add column if not exists support_phone text not null default '',
  add column if not exists mail_from_name text not null default '';

-- ── Doctor profile + login link ───────────────────────────────────────────────
alter table public.nav_doctors
  add column if not exists code text unique,
  add column if not exists designation text not null default '',
  add column if not exists bio text not null default '' check (length(bio) <= 1200),
  add column if not exists experience_years int check (experience_years between 0 and 70),
  add column if not exists languages text not null default 'English, Tamil',
  add column if not exists photo_url text,
  add column if not exists slot_minutes int not null default 15 check (slot_minutes between 5 and 60),
  add column if not exists booking_enabled boolean not null default true,
  add column if not exists online_enabled boolean not null default false;

-- Doctor logins live in their own table: nav_doctors is public, login emails are not.
create table if not exists public.nav_doctor_accounts (
  doctor_id uuid primary key references public.nav_doctors(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- Weekly sessions (1 = Monday … 7 = Sunday). mode: in-person OPD or online consultation.
create table if not exists public.nav_doctor_sessions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.nav_doctors(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null, end_time time not null check (end_time > start_time),
  mode text not null default 'inperson' check (mode in ('inperson','online'))
);
create index if not exists nav_doctor_sessions_doc_idx on public.nav_doctor_sessions(doctor_id);

create table if not exists public.nav_doctor_leaves (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.nav_doctors(id) on delete cascade,
  from_date date not null, to_date date not null check (to_date >= from_date),
  reason text not null default '' check (length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists nav_doctor_leaves_doc_idx on public.nav_doctor_leaves(doctor_id);

-- ── Lab tests and scans ───────────────────────────────────────────────────────
create table if not exists public.nav_lab_tests (
  code text primary key check (code ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(trim(name)) > 0),
  category text not null default 'lab' check (category in ('lab','imaging','cardiac')),
  department text not null default '',
  room_code text not null references public.nav_rooms(code) on update cascade on delete restrict,
  sample text not null default '', prep text not null default '', turnaround text not null default '',
  price int check (price >= 0), home_collection boolean not null default false,
  active boolean not null default true, sort int not null default 0
);

-- ── Appointments ──────────────────────────────────────────────────────────────
create table if not exists public.nav_appointments (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  kind text not null check (kind in ('inperson','online','lab')),
  doctor_id uuid references public.nav_doctors(id) on delete set null,
  test_codes text[] not null default '{}',
  room_code text,
  appt_date date not null, slot_time time not null,
  status text not null default 'booked' check (status in ('booked','cancelled','completed','no_show')),
  patient_name text not null check (length(trim(patient_name)) between 2 and 80),
  phone text not null check (phone ~ '^[0-9+ -]{8,16}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  age int check (age between 0 and 120),
  gender text check (gender in ('female','male','other')),
  reason text not null default '' check (length(reason) <= 500),
  home_collection boolean not null default false,
  address text check (length(address) <= 300),
  video_url text,
  cancel_token uuid not null default gen_random_uuid(),
  cancel_reason text, cancelled_by text check (cancelled_by in ('patient','doctor','admin')),
  doctor_note text,
  consent boolean not null check (consent),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'lab') = (doctor_id is null) or status <> 'booked')
);
-- One patient per doctor slot.
create unique index if not exists nav_appt_doctor_slot_uq on public.nav_appointments(doctor_id, appt_date, slot_time) where status = 'booked';
create index if not exists nav_appt_date_idx on public.nav_appointments(appt_date);
create index if not exists nav_appt_phone_idx on public.nav_appointments(phone);
drop trigger if exists nav_appointments_touch on public.nav_appointments;
create trigger nav_appointments_touch before update on public.nav_appointments for each row execute function public.touch_updated_at();

-- ── Email outbox (the send-mail edge function renders + sends queued rows) ────
create table if not exists public.nav_email_outbox (
  id bigint generated always as identity primary key,
  appointment_id uuid references public.nav_appointments(id) on delete cascade,
  kind text not null check (kind in ('booked','cancelled_patient','cancelled_hospital','rescheduled','leave_cancel')),
  to_email text not null,
  extra jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  subject text, html text, provider text, error text,
  created_at timestamptz not null default now(), sent_at timestamptz
);
create index if not exists nav_email_outbox_status_idx on public.nav_email_outbox(status) where status = 'queued';

-- ── Helpers ───────────────────────────────────────────────────────────────────
create or replace function public.nav_my_doctor_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.doctor_id from public.nav_doctor_accounts a where a.user_id = auth.uid() limit 1;
$$;

create or replace function public.nav_today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select s.timezone from public.nav_settings s where s.id = 1), 'Asia/Kolkata'))::date;
$$;
create or replace function public.nav_now_time() returns time
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select s.timezone from public.nav_settings s where s.id = 1), 'Asia/Kolkata'))::time;
$$;

create or replace function public.nav_queue_email(p_appt uuid, p_kind text, p_extra jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select a.email into v_email from public.nav_appointments a where a.id = p_appt;
  if v_email is not null and length(v_email) > 3 then
    insert into public.nav_email_outbox(appointment_id, kind, to_email, extra) values (p_appt, p_kind, v_email, coalesce(p_extra, '{}'));
  end if;
end $$;

-- Free slots for a doctor on a day. mode: 'inperson' | 'online'.
create or replace function public.nav_doctor_slots(p_doctor uuid, p_date date, p_mode text default 'inperson')
returns table(slot time, available boolean)
language plpgsql stable security definer set search_path = '' as $$
declare d record; s record; t time; v_today date := public.nav_today(); v_now time := public.nav_now_time(); v_ahead int;
begin
  select booking_days_ahead into v_ahead from public.nav_settings where id = 1;
  if p_date < v_today or p_date > v_today + coalesce(v_ahead, 14) then return; end if;
  select * into d from public.nav_doctors where id = p_doctor and active and booking_enabled;
  if not found then return; end if;
  if p_mode = 'online' and not d.online_enabled then return; end if;
  if exists (select 1 from public.nav_doctor_leaves l where l.doctor_id = p_doctor and p_date between l.from_date and l.to_date) then return; end if;
  for s in select * from public.nav_doctor_sessions x where x.doctor_id = p_doctor and x.mode = p_mode and x.weekday = extract(isodow from p_date)::int order by x.start_time loop
    t := s.start_time;
    while t + make_interval(mins => d.slot_minutes) <= s.end_time loop
      slot := t;
      available := not (p_date = v_today and t <= v_now + interval '15 minutes')
        and not exists (select 1 from public.nav_appointments a where a.doctor_id = p_doctor and a.appt_date = p_date and a.slot_time = t and a.status = 'booked');
      return next;
      exit when t + make_interval(mins => d.slot_minutes) < t;  -- midnight wrap guard
      t := t + make_interval(mins => d.slot_minutes);
    end loop;
  end loop;
end $$;

-- Free-slot counts for the next N days (date chips in the booking screen).
create or replace function public.nav_doctor_days(p_doctor uuid, p_mode text default 'inperson')
returns table(day date, free int)
language sql stable security definer set search_path = '' as $$
  select g::date, (select count(*)::int from public.nav_doctor_slots(p_doctor, g::date, p_mode) x where x.available)
  from generate_series(public.nav_today(), public.nav_today() + coalesce((select booking_days_ahead from public.nav_settings where id = 1), 14), interval '1 day') g;
$$;

-- Lab / scan slots. Lab tests (blood, urine…) share collection slots of 15 min with lab_slot_capacity patients each.
-- A scan or cardiac test is one patient per 20-min slot in its room (Mon–Sat).
create or replace function public.nav_lab_slots(p_date date, p_tests text[])
returns table(slot time, free int)
language plpgsql stable security definer set search_path = '' as $$
declare st record; v_cat text; v_room text; v_step int; v_cap int; v_open time; v_close time; t time;
        v_today date := public.nav_today(); v_now time := public.nav_now_time(); v_n int;
begin
  select * into st from public.nav_settings where id = 1;
  if p_date < v_today or p_date > v_today + coalesce(st.booking_days_ahead, 14) or coalesce(array_length(p_tests, 1), 0) = 0 then return; end if;
  select case when bool_or(category <> 'lab') then 'scan' else 'lab' end, min(room_code), count(*)
    into v_cat, v_room, v_n from public.nav_lab_tests where code = any(p_tests) and active;
  if v_n <> array_length(p_tests, 1) then return; end if;
  if v_cat = 'scan' and (v_n > 1 or extract(isodow from p_date) = 7) then return; end if;
  if v_cat = 'lab' then v_step := 15; v_cap := st.lab_slot_capacity; v_open := st.lab_open; v_close := st.lab_close;
  else v_step := 20; v_cap := 1; v_open := st.imaging_open; v_close := st.imaging_close; end if;
  t := v_open;
  while t + make_interval(mins => v_step) <= v_close loop
    slot := t;
    if p_date = v_today and t <= v_now + interval '15 minutes' then free := 0;
    else
      select greatest(0, v_cap - count(*))::int into free from public.nav_appointments a
       where a.kind = 'lab' and a.status = 'booked' and a.appt_date = p_date and a.slot_time = t
         and (case when v_cat = 'lab' then a.room_code = 'lab:collection' else a.room_code = v_room end);
    end if;
    return next;
    t := t + make_interval(mins => v_step);
  end loop;
end $$;

-- Book. p = {kind, doctor_id?, tests?[], date, time, name, phone, email?, age?, gender?, reason?, home_collection?, address?, consent}
create or replace function public.nav_book(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_kind text := p->>'kind'; v_doc uuid; v_date date := (p->>'date')::date; v_time time := (p->>'time')::time;
        v_tests text[]; v_room text; v_ref text; v_id uuid; v_token uuid; v_video text; v_ok boolean; v_free int; v_phone text;
        v_home boolean := coalesce((p->>'home_collection')::boolean, false);
begin
  if coalesce((p->>'consent')::boolean, false) is not true then raise exception 'Please accept the consent to book.'; end if;
  v_phone := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
  if length(v_phone) < 10 then raise exception 'Please enter a valid mobile number.'; end if;
  -- Fair use: at most 3 upcoming bookings per mobile number.
  if (select count(*) from public.nav_appointments a where a.phone = v_phone and a.status = 'booked' and a.appt_date >= public.nav_today()) >= 3 then
    raise exception 'This mobile number already has 3 upcoming bookings. Please cancel one first.';
  end if;
  if v_kind in ('inperson','online') then
    v_doc := (p->>'doctor_id')::uuid;
    select x.available into v_ok from public.nav_doctor_slots(v_doc, v_date, v_kind) x where x.slot = v_time;
    if v_ok is not true then raise exception 'That slot was just taken or is not available. Please pick another.'; end if;
    if exists (select 1 from public.nav_appointments a where a.phone = v_phone and a.doctor_id = v_doc and a.appt_date = v_date and a.status = 'booked') then
      raise exception 'You already have a booking with this doctor on that day.';
    end if;
    select d.room_code into v_room from public.nav_doctors d where d.id = v_doc;
  elsif v_kind = 'lab' then
    select array_agg(distinct t) into v_tests from jsonb_array_elements_text(coalesce(p->'tests', '[]')) t;
    if coalesce(array_length(v_tests, 1), 0) = 0 then raise exception 'Please choose at least one test.'; end if;
    if array_length(v_tests, 1) > 1 and exists (select 1 from public.nav_lab_tests where code = any(v_tests) and category <> 'lab') then
      raise exception 'Scans and heart tests are booked one at a time. Book lab tests together, and each scan separately.';
    end if;
    if exists (select 1 from public.nav_lab_tests where code = any(v_tests) and category <> 'lab') and extract(isodow from v_date) = 7 then
      raise exception 'Scans are not done on Sundays. Please pick another day.';
    end if;
    select x.free into v_free from public.nav_lab_slots(v_date, v_tests) x where x.slot = v_time;
    if coalesce(v_free, 0) < 1 then raise exception 'That slot is full or not available. Please pick another.'; end if;
    if (select bool_or(category <> 'lab') from public.nav_lab_tests where code = any(v_tests)) then
      select min(room_code) into v_room from public.nav_lab_tests where code = any(v_tests);
      v_home := false;
    else
      v_room := 'lab:collection';
      if v_home and exists (select 1 from public.nav_lab_tests where code = any(v_tests) and not home_collection) then
        raise exception 'Home collection is not available for one of the selected tests.';
      end if;
      if v_home and length(trim(coalesce(p->>'address', ''))) < 10 then raise exception 'Please enter the full address for home collection.'; end if;
    end if;
  else
    raise exception 'Unknown booking type.';
  end if;

  loop
    v_ref := 'NH-' || upper(substr(translate(md5(gen_random_uuid()::text), '01', 'XY'), 1, 6));
    exit when not exists (select 1 from public.nav_appointments where ref = v_ref);
  end loop;
  if v_kind = 'online' then v_video := 'https://meet.jit.si/NaviSpace-' || v_ref || '-' || substr(md5(gen_random_uuid()::text), 1, 8); end if;

  insert into public.nav_appointments(ref, kind, doctor_id, test_codes, room_code, appt_date, slot_time, patient_name, phone, email, age, gender, reason, home_collection, address, video_url, consent)
  values (v_ref, v_kind, v_doc, coalesce(v_tests, '{}'), v_room, v_date, v_time, trim(p->>'name'), v_phone, nullif(trim(coalesce(p->>'email', '')), ''),
          nullif(p->>'age', '')::int, nullif(p->>'gender', ''), left(coalesce(p->>'reason', ''), 500), v_home, nullif(trim(coalesce(p->>'address', '')), ''), v_video, true)
  returning id, cancel_token into v_id, v_token;
  perform public.nav_queue_email(v_id, 'booked');
  return jsonb_build_object('ref', v_ref, 'token', v_token, 'date', v_date, 'time', to_char(v_time, 'HH24:MI'), 'video_url', v_video, 'room_code', v_room, 'kind', v_kind, 'home_collection', v_home);
exception when unique_violation then
  raise exception 'That slot was just taken. Please pick another.';
end $$;

-- Patient: view / cancel with the booking ID + secret token from the confirmation.
create or replace function public.nav_get_booking(p_ref text, p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref', a.ref, 'kind', a.kind, 'status', a.status, 'date', a.appt_date, 'time', to_char(a.slot_time, 'HH24:MI'),
    'doctor', d.name, 'speciality', d.speciality, 'doctor_id', a.doctor_id, 'room_code', coalesce(nullif(a.room_code, 'lab:collection'), 'sample-collection'),
    'tests', (select coalesce(jsonb_agg(t.name order by t.sort), '[]') from public.nav_lab_tests t where t.code = any(a.test_codes)),
    'video_url', a.video_url, 'name', a.patient_name, 'cancel_reason', a.cancel_reason, 'cancelled_by', a.cancelled_by, 'home_collection', a.home_collection)
  from public.nav_appointments a left join public.nav_doctors d on d.id = a.doctor_id
  where a.ref = upper(trim(p_ref)) and a.cancel_token = p_token;
$$;

-- "My booking": find by booking ID + the mobile number used (returns the token for view/cancel).
create or replace function public.nav_find_booking(p_ref text, p_phone text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref', a.ref, 'token', a.cancel_token)
  from public.nav_appointments a
  where a.ref = upper(trim(p_ref)) and a.phone = regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
$$;

create or replace function public.nav_cancel_booking(p_ref text, p_token uuid, p_reason text default '')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.nav_appointments set status = 'cancelled', cancelled_by = 'patient', cancel_reason = left(nullif(trim(p_reason), ''), 300)
   where ref = upper(trim(p_ref)) and cancel_token = p_token and status = 'booked' returning id into v_id;
  if v_id is null then raise exception 'Booking not found or already cancelled.'; end if;
  perform public.nav_queue_email(v_id, 'cancelled_patient');
  return jsonb_build_object('ok', true);
end $$;

-- Doctor (own appointments) or admin (any): complete / no-show / cancel / reschedule.
create or replace function public.nav_staff_update(p_id uuid, p_action text, p_reason text default '', p_date date default null, p_time time default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a record; v_ok boolean; v_free int;
begin
  select * into a from public.nav_appointments where id = p_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not ((select public.is_admin()) or (a.doctor_id is not null and a.doctor_id = public.nav_my_doctor_id())) then raise exception 'Not allowed.'; end if;
  if p_action in ('completed','no_show') then
    update public.nav_appointments set status = p_action, doctor_note = coalesce(nullif(trim(p_reason), ''), doctor_note) where id = p_id;
  elsif p_action = 'cancel' then
    if a.status <> 'booked' then raise exception 'Only booked appointments can be cancelled.'; end if;
    update public.nav_appointments set status = 'cancelled', cancelled_by = case when (select public.is_admin()) and a.doctor_id is distinct from public.nav_my_doctor_id() then 'admin' else 'doctor' end,
      cancel_reason = left(coalesce(nullif(trim(p_reason), ''), 'Unavoidable reasons'), 300) where id = p_id;
    perform public.nav_queue_email(p_id, 'cancelled_hospital', jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Unavoidable reasons')));
  elsif p_action = 'reschedule' then
    if a.status <> 'booked' then raise exception 'Only booked appointments can be moved.'; end if;
    if a.kind = 'lab' then
      select x.free into v_free from public.nav_lab_slots(p_date, a.test_codes) x where x.slot = p_time;
      if coalesce(v_free, 0) < 1 then raise exception 'The new slot is not available.'; end if;
    else
      select x.available into v_ok from public.nav_doctor_slots(a.doctor_id, p_date, a.kind) x where x.slot = p_time;
      if v_ok is not true then raise exception 'The new slot is not available.'; end if;
    end if;
    update public.nav_appointments set appt_date = p_date, slot_time = p_time where id = p_id;
    perform public.nav_queue_email(p_id, 'rescheduled', jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), ''), 'old_date', a.appt_date, 'old_time', to_char(a.slot_time, 'HH24:MI')));
  else
    raise exception 'Unknown action.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Leave: blocks the dates and cancels the bookings in them (patients are emailed with a rebook link).
create or replace function public.nav_add_leave(p_from date, p_to date, p_reason text default '', p_doctor uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_doc uuid := coalesce(p_doctor, public.nav_my_doctor_id()); r record; n int := 0;
begin
  if v_doc is null then raise exception 'No doctor selected.'; end if;
  if not ((select public.is_admin()) or v_doc = public.nav_my_doctor_id()) then raise exception 'Not allowed.'; end if;
  if p_to < p_from then raise exception 'End date is before start date.'; end if;
  insert into public.nav_doctor_leaves(doctor_id, from_date, to_date, reason) values (v_doc, p_from, p_to, left(coalesce(p_reason, ''), 300));
  for r in update public.nav_appointments set status = 'cancelled', cancelled_by = 'doctor', cancel_reason = left(coalesce(nullif(trim(p_reason), ''), 'Doctor on leave'), 300)
            where doctor_id = v_doc and status = 'booked' and appt_date between p_from and p_to returning id loop
    perform public.nav_queue_email(r.id, 'leave_cancel', jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Doctor on leave')));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cancelled', n);
end $$;

create or replace function public.nav_remove_leave(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.nav_doctor_leaves l where l.id = p_id and ((select public.is_admin()) or l.doctor_id = public.nav_my_doctor_id());
end $$;

-- Doctor edits own profile + weekly sessions (admin edits the tables directly).
create or replace function public.nav_doctor_save_profile(p jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_doc uuid := public.nav_my_doctor_id(); s jsonb;
begin
  if v_doc is null then raise exception 'Not a doctor account.'; end if;
  update public.nav_doctors set
    designation = left(coalesce(p->>'designation', designation), 120), qualification = left(coalesce(p->>'qualification', qualification), 160),
    bio = left(coalesce(p->>'bio', bio), 1200), languages = left(coalesce(p->>'languages', languages), 120),
    experience_years = coalesce(nullif(p->>'experience_years', '')::int, experience_years),
    photo_url = case when p ? 'photo_url' then nullif(p->>'photo_url', '') else photo_url end,
    slot_minutes = coalesce(nullif(p->>'slot_minutes', '')::int, slot_minutes),
    online_enabled = coalesce((p->>'online_enabled')::boolean, online_enabled)
  where id = v_doc;
  if p ? 'sessions' then
    delete from public.nav_doctor_sessions where doctor_id = v_doc;
    for s in select * from jsonb_array_elements(p->'sessions') loop
      insert into public.nav_doctor_sessions(doctor_id, weekday, start_time, end_time, mode)
      values (v_doc, (s->>'weekday')::smallint, (s->>'start_time')::time, (s->>'end_time')::time, coalesce(s->>'mode', 'inperson'));
    end loop;
  end if;
end $$;

-- ── Row level security ────────────────────────────────────────────────────────
alter table public.nav_doctor_sessions enable row level security;
alter table public.nav_doctor_leaves enable row level security;
alter table public.nav_lab_tests enable row level security;
alter table public.nav_appointments enable row level security;
alter table public.nav_email_outbox enable row level security;
alter table public.nav_doctor_accounts enable row level security;
drop policy if exists "admin or self read" on public.nav_doctor_accounts;
create policy "admin or self read" on public.nav_doctor_accounts for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

drop policy if exists "public read" on public.nav_doctor_sessions;
create policy "public read" on public.nav_doctor_sessions for select to anon, authenticated using (true);
drop policy if exists "public read" on public.nav_lab_tests;
create policy "public read" on public.nav_lab_tests for select to anon, authenticated using (true);
drop policy if exists "public read" on public.nav_doctor_leaves;
create policy "public read" on public.nav_doctor_leaves for select to anon, authenticated using (true);
do $$
declare t text;
begin
  foreach t in array array['nav_doctor_sessions','nav_doctor_leaves','nav_lab_tests'] loop
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;
drop policy if exists "staff read" on public.nav_appointments;
create policy "staff read" on public.nav_appointments for select to authenticated
  using ((select public.is_admin()) or (doctor_id is not null and doctor_id = (select public.nav_my_doctor_id())));
drop policy if exists "admin read" on public.nav_email_outbox;
create policy "admin read" on public.nav_email_outbox for select to authenticated using ((select public.is_admin()));

-- Functions: patients (anon) may only use the booking ones.
revoke all on function public.nav_queue_email(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.nav_staff_update(uuid, text, text, date, time) from public, anon;
revoke all on function public.nav_add_leave(date, date, text, uuid) from public, anon;
revoke all on function public.nav_remove_leave(uuid) from public, anon;
revoke all on function public.nav_doctor_save_profile(jsonb) from public, anon;
grant execute on function public.nav_staff_update(uuid, text, text, date, time) to authenticated;
grant execute on function public.nav_add_leave(date, date, text, uuid) to authenticated;
grant execute on function public.nav_remove_leave(uuid) to authenticated;
grant execute on function public.nav_doctor_save_profile(jsonb) to authenticated;
grant execute on function public.nav_doctor_slots(uuid, date, text), public.nav_doctor_days(uuid, text), public.nav_lab_slots(date, text[]),
  public.nav_book(jsonb), public.nav_get_booking(text, uuid), public.nav_find_booking(text, text), public.nav_cancel_booking(text, uuid, text), public.nav_my_doctor_id(),
  public.nav_today() to anon, authenticated;

-- ── Doctor photos (public bucket; a doctor writes only their own folder) ──────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doctor-photos', 'doctor-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "doctor photos write" on storage.objects;
create policy "doctor photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'doctor-photos' and ((select public.is_admin()) or (storage.foldername(name))[1] = (select public.nav_my_doctor_id())::text));
drop policy if exists "doctor photos update" on storage.objects;
create policy "doctor photos update" on storage.objects for update to authenticated
  using (bucket_id = 'doctor-photos' and ((select public.is_admin()) or (storage.foldername(name))[1] = (select public.nav_my_doctor_id())::text));
drop policy if exists "doctor photos delete" on storage.objects;
create policy "doctor photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'doctor-photos' and ((select public.is_admin()) or (storage.foldername(name))[1] = (select public.nav_my_doctor_id())::text));
