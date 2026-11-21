-- ============================================================
-- Lounge: Datenbank einrichten (Supabase, Free-Tier)
-- Supabase-Dashboard > SQL Editor > New query > alles einfügen > Run
-- ============================================================

-- 1) Profile (öffentlicher Nutzername; E-Mail bleibt in Supabase Auth und ist für andere nicht sichtbar)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

-- 2) Live-Status (was macht jemand gerade)
create table if not exists public.presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activity text,
  updated_at timestamptz not null default now()
);

-- 3) Freundschaften
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);

-- 4) News (hier veröffentlichst du als Admin Beiträge)
create table if not exists public.news (
  id bigint generated always as identity primary key,
  title text not null,
  tag text default 'News',
  summary text,
  body text,
  image_url text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

-- Hilfsfunktionen
create or replace function public.username_free(name text) returns boolean
language sql security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;
grant execute on function public.username_free(text) to anon, authenticated;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;

-- Profil automatisch beim Registrieren anlegen (Nutzername kommt aus der Anmeldung)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data ->> 'username' is not null then
    insert into public.profiles (id, username) values (new.id, lower(new.raw_user_meta_data ->> 'username'))
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Zugriffsregeln (Row Level Security): der öffentliche anon-Schlüssel darf nur das hier
alter table public.profiles enable row level security;
alter table public.presence enable row level security;
alter table public.friendships enable row level security;
alter table public.news enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists presence_read on public.presence;
create policy presence_read on public.presence for select to authenticated using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
drop policy if exists presence_write on public.presence;
create policy presence_write on public.presence for insert to authenticated with check (user_id = auth.uid());
drop policy if exists presence_update on public.presence;
create policy presence_update on public.presence for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists presence_delete on public.presence;
create policy presence_delete on public.presence for delete to authenticated using (user_id = auth.uid());

drop policy if exists fr_read on public.friendships;
create policy fr_read on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
drop policy if exists fr_insert on public.friendships;
create policy fr_insert on public.friendships for insert to authenticated with check (requester = auth.uid() and status = 'pending');
drop policy if exists fr_accept on public.friendships;
create policy fr_accept on public.friendships for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists fr_delete on public.friendships;
create policy fr_delete on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

-- News: jeder darf veröffentlichte Beiträge lesen, schreiben nur du im Dashboard (Service-Rolle umgeht die Regeln)
drop policy if exists news_read on public.news;
create policy news_read on public.news for select to anon, authenticated using (published);

-- Beispiel-Beiträge
insert into public.news (title, tag, summary, body) values
 ('Neues Update 1.4 – What''s New', 'Update', 'Accounts, Freunde, News-Ticker und frei platzierbare Uhr.',
  E'Neu in Version 1.4:\n- Konto mit E-Mail oder Google\n- Freunde mit Live-Status\n- News-Ticker unten rechts\n- Uhr, Datum und Willkommensspruch einzeln verschiebbar\n- Flüssigere Animationen'),
 ('Tipp: Strg + L', 'Tipp', 'Das Overlay-Menü öffnet sich über jeder Lounge-App.',
  E'Drück Strg + L, um zurück zu Lounge zu springen, das Vollbild zu beenden, Splitscreen zu starten oder Lounge zu schließen.');


-- ============================================================
-- Statistik: aktive Nutzer (ab Lounge 1.4.1)
-- ============================================================
create table if not exists public.daily_active (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.daily_active enable row level security;
drop policy if exists da_insert on public.daily_active;
create policy da_insert on public.daily_active for insert to authenticated with check (user_id = auth.uid());

create or replace view public.stats as
select
  (select count(*) from auth.users)                                                        as registriert,
  (select count(*) from public.presence where updated_at > now() - interval '2 minutes')   as jetzt_online,
  (select count(distinct user_id) from public.daily_active where day = current_date)       as aktiv_heute,
  (select count(distinct user_id) from public.daily_active where day > current_date - 7)   as aktiv_7_tage,
  (select count(distinct user_id) from public.daily_active where day > current_date - 30)  as aktiv_30_tage;
-- Die Statistik ist nur für dich im Dashboard sichtbar, nicht über die App-Schlüssel:
revoke all on public.stats from anon, authenticated;
