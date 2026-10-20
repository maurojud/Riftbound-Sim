-- Riftbound Table: komplettes Datenbankschema
-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen.

create extension if not exists pgcrypto with schema extensions;

-- ───────── Profile (Benutzername + Master-Flag) ─────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  is_admin boolean not null default false
);
alter table public.profiles enable row level security;
create policy "profiles lesen" on public.profiles for select to authenticated using (true);
-- Absichtlich keine Update-Policy: niemand kann sich selbst zum Master machen.

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- ───────── Karten (nur der Master darf schreiben) ─────────
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'Unit',
  image_url text not null,
  image_path text,
  color text,                        -- Runenfarbe/Domain, z. B. Fury, Calm, Mind, Body, Chaos, Order
  color2 text,                       -- zweite Farbe, nur für Legends und Signature-Karten
  signature boolean not null default false,  -- Signature-Karte (z. B. Signature Spell)
  code text,                         -- Set-Nummer, z. B. SFD-042
  energy integer,                    -- Kosten
  might integer,
  power integer,
  power_colors text,                 -- Farben der Power-Kosten, z. B. Fury,Mind
  token_type text,                   -- Unit | Gear | Spell | Battlefield | Other (nur bei Art Token)
  bf_mode text,                      -- extra (3. Battlefield) | overlay (über ein Battlefield gelegt)
  enters_ready boolean,              -- true = kommt bereit, false = getappt, leer = Standard
  legend_energy integer,             -- Legend übernimmt so viel Energy
  legend_power integer,              -- Legend übernimmt so viel Power
  legend_kinds text,                 -- Kartenarten, für die das gilt (leer = alle)
  legend_tap boolean,                -- false = Legend wird beim Kosten-Übernehmen nicht getappt
  created_at timestamptz not null default now()
);
alter table public.cards enable row level security;
create policy "cards lesen" on public.cards for select to authenticated using (true);
create policy "cards master schreiben" on public.cards for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ───────── Decks (jeder nur seine eigenen) ─────────
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null,
  cards jsonb not null default '[]',   -- [{ "card_id": "...", "qty": 3 }]
  created_at timestamptz not null default now()
);
alter table public.decks enable row level security;
create policy "decks eigene" on public.decks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────── Sessions ─────────
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles(id),
  settings jsonb not null default '{}',
  state jsonb not null default '{"players":{}}',
  created_at timestamptz not null default now()
);
create table public.session_secrets (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  password_hash text not null
);
alter table public.session_secrets enable row level security; -- keine Policy = Zugriff nur über Funktionen

create table public.session_members (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('host', 'player', 'spectator')),
  seat int check (seat between 1 and 4),
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create unique index session_seat_unique on public.session_members (session_id, seat) where seat is not null;

alter table public.sessions enable row level security;
alter table public.session_members enable row level security;

create function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.session_members where session_id = sid and user_id = auth.uid())
$$;
create policy "sessions mitglieder lesen" on public.sessions for select to authenticated using (public.is_member(id));
create policy "members mitglieder lesen" on public.session_members for select to authenticated using (public.is_member(session_id));

-- ───────── Funktionen (einziger Schreibweg für Sessions) ─────────
create function public.create_session(p_password text, p_settings jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_code text; v_id uuid; i int; tries int := 0;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if length(coalesce(p_password, '')) < 1 then raise exception 'Passwort fehlt'; end if;
  loop
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.sessions where code = v_code);
    tries := tries + 1;
    if tries > 20 then raise exception 'Kein freier Code'; end if;
  end loop;
  insert into public.sessions (code, host_id, settings) values (v_code, auth.uid(), coalesce(p_settings, '{}')) returning id into v_id;
  insert into public.session_secrets values (v_id, crypt(p_password, gen_salt('bf')));
  insert into public.session_members (session_id, user_id, role) values (v_id, auth.uid(), 'host');
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create function public.join_session(p_code text, p_password text, p_role text default 'player')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions; m public.session_members; v_exists boolean; v_seat int;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into s from public.sessions where code = upper(trim(p_code));
  if not found then raise exception 'Session nicht gefunden'; end if;
  if not exists (select 1 from public.session_secrets where session_id = s.id and password_hash = crypt(p_password, password_hash)) then
    raise exception 'Falsches Passwort';
  end if;
  select * into m from public.session_members where session_id = s.id and user_id = auth.uid();
  v_exists := found;
  if p_role = 'player' then
    if v_exists and m.seat is not null then return s.id; end if;
    select min(n) into v_seat from generate_series(1, 4) n
      where n not in (select seat from public.session_members where session_id = s.id and seat is not null);
    if v_seat is null then raise exception 'Alle 4 Plätze sind belegt'; end if;
    if v_exists then
      update public.session_members set seat = v_seat where session_id = s.id and user_id = auth.uid();
    else
      insert into public.session_members (session_id, user_id, role, seat) values (s.id, auth.uid(), 'player', v_seat);
    end if;
  elsif not v_exists then
    insert into public.session_members (session_id, user_id, role) values (s.id, auth.uid(), 'spectator');
  end if;
  return s.id;
end $$;

create function public.set_seat_state(p_session uuid, p_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_seat int;
begin
  select seat into v_seat from public.session_members where session_id = p_session and user_id = auth.uid();
  if v_seat is null then raise exception 'Kein Spielerplatz in dieser Session'; end if;
  update public.sessions
     set state = jsonb_set(coalesce(state, '{"players":{}}'::jsonb), array['players', v_seat::text], p_state, true)
   where id = p_session;
end $$;

-- Zug und Fokus (Reihenfolge der Spieler)
create or replace function public.set_table(p_session uuid, p_table jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.session_members
    where session_id = p_session and user_id = auth.uid() and seat is not null
  ) then
    raise exception 'Kein Spielerplatz in dieser Session';
  end if;
  update public.sessions
     set state = jsonb_set(coalesce(state, '{"players":{}}'::jsonb), '{table}', p_table, true)
   where id = p_session;
end $$;

create function public.update_settings(p_session uuid, p_settings jsonb)
returns void language sql security definer set search_path = public as $$
  update public.sessions set settings = p_settings where id = p_session and host_id = auth.uid();
$$;

-- ───────── Realtime ─────────
alter table public.sessions replica identity full;
alter table public.session_members replica identity full;
alter publication supabase_realtime add table public.sessions, public.session_members;

-- ───────── Storage für Kartenbilder ─────────
insert into storage.buckets (id, name, public) values ('cards', 'cards', true) on conflict (id) do nothing;
create policy "cards bucket master insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'cards' and public.is_admin());
create policy "cards bucket master update" on storage.objects for update to authenticated
  using (bucket_id = 'cards' and public.is_admin());
create policy "cards bucket master delete" on storage.objects for delete to authenticated
  using (bucket_id = 'cards' and public.is_admin());
