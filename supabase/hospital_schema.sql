-- NaviSpace Hospital v3 tables (applied to project xjpntesuntkspxgzxvey as migration "nav_v3_tables").
-- On a fresh Supabase project, first create public.admins + public.is_admin() + public.touch_updated_at()
-- (see the bottom of this file), then run this, then hospital_seed.sql, then add your admin email.
create table public.nav_settings (
  id int primary key default 1 check (id = 1),
  hospital_name text not null,
  hospital_name_ta text not null default '',
  updated_at timestamptz not null default now()
);
create table public.nav_floors (id text primary key, level int not null unique, name_en text not null, name_ta text not null);
create table public.nav_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  floor_id text not null references public.nav_floors(id) on delete cascade,
  name_en text not null check (length(trim(name_en)) > 0),
  name_ta text not null check (length(trim(name_ta)) > 0),
  category text not null check (category in ('opd','diagnostics','emergency','services','inpatient','amenities','pharmacy','restroom','lift','stairs','garden','service')),
  x double precision not null, z double precision not null,
  w double precision not null check (w >= 1), d double precision not null check (d >= 1),
  door_side text not null default 'S' check (door_side in ('N','S','E','W')),
  door_pos double precision not null default 0.5 check (door_pos between 0 and 1),
  door_width double precision not null default 1.6 check (door_width between 0.6 and 6),
  link_group text, keywords text not null default '', searchable boolean not null default true,
  updated_at timestamptz not null default now()
);
create index nav_rooms_floor_idx on public.nav_rooms(floor_id);
create table public.nav_walkways (
  id uuid primary key default gen_random_uuid(),
  floor_id text not null references public.nav_floors(id) on delete cascade,
  name text not null default 'Corridor',
  x double precision not null, z double precision not null,
  w double precision not null check (w >= 1), d double precision not null check (d >= 1),
  updated_at timestamptz not null default now()
);
create index nav_walkways_floor_idx on public.nav_walkways(floor_id);
create table public.nav_start_points (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  floor_id text not null references public.nav_floors(id) on delete cascade,
  kind text not null default 'kiosk' check (kind in ('entrance','kiosk')),
  name_en text not null check (length(trim(name_en)) > 0),
  name_ta text not null check (length(trim(name_ta)) > 0),
  x double precision not null, z double precision not null
);
create table public.nav_doctors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  speciality text not null check (length(trim(speciality)) > 0),
  qualification text not null default '',
  room_code text not null references public.nav_rooms(code) on update cascade on delete restrict,
  days text not null default '', hours text not null default '',
  active boolean not null default true, sort int not null default 0,
  updated_at timestamptz not null default now()
);
create index nav_doctors_room_idx on public.nav_doctors(room_code);
create trigger nav_rooms_touch before update on public.nav_rooms for each row execute function public.touch_updated_at();
create trigger nav_walkways_touch before update on public.nav_walkways for each row execute function public.touch_updated_at();
create trigger nav_settings_touch before update on public.nav_settings for each row execute function public.touch_updated_at();
create trigger nav_doctors_touch before update on public.nav_doctors for each row execute function public.touch_updated_at();
do $$
declare t text;
begin
  foreach t in array array['nav_settings','nav_floors','nav_rooms','nav_walkways','nav_start_points','nav_doctors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy "admin delete" on public.%I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

-- Shared helpers (already present in the pilot project; needed only on a fresh project):
-- create table public.admins (email text primary key);  alter table public.admins enable row level security;
-- create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $f$
--   select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))); $f$;
-- revoke all on function public.is_admin() from public; grant execute on function public.is_admin() to authenticated;
-- create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $f$
--   begin new.updated_at = now(); return new; end; $f$;
-- insert into public.admins(email) values ('you@example.com');
