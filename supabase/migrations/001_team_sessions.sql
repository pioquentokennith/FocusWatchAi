-- Run once in the Supabase SQL Editor as the project owner.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (length(full_name) between 1 and 100),
  role text not null check (role in ('admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_team_admin on public.profiles (role) where role = 'admin';

create function public.limit_team_size() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(870011);
  if new.role = 'staff' and (select count(*) from public.profiles where role = 'staff' and id <> new.id) >= 10 then
    raise exception 'This team supports up to 10 staff accounts';
  end if;
  return new;
end;
$$;
create trigger limit_team_size before insert or update on public.profiles
for each row execute function public.limit_team_size();

create function public.is_team_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;
create function public.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff' and active);
$$;

create table public.sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  ended_at timestamptz,
  status text not null check (status in ('active', 'completed', 'interrupted')),
  device text not null check (device in ('desktop', 'browser')),
  revision bigint not null check (revision > 0),
  duration_ms bigint not null check (duration_ms >= 0),
  totals jsonb not null,
  event_counts jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  check (last_seen_at >= started_at),
  check (ended_at is null or ended_at >= started_at),
  check ((status = 'active' and ended_at is null) or (status <> 'active' and ended_at = last_seen_at))
);
create index sessions_staff_date on public.sessions (user_id, started_at desc);
create index sessions_date on public.sessions (started_at desc);

create table public.detection_events (
  session_id uuid not null references public.sessions(id) on delete cascade,
  id uuid not null,
  kind text not null check (kind in ('EYES_CLOSED', 'LOOKING_AWAY', 'NO_FACE')),
  started_at timestamptz not null,
  ended_at timestamptz,
  observed_ms bigint not null check (observed_ms >= 0),
  primary key (session_id, id),
  check (ended_at is null or ended_at >= started_at)
);

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.detection_events enable row level security;

create policy profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or public.is_team_admin());
create policy sessions_read on public.sessions for select to authenticated
using (public.is_team_admin() or (user_id = auth.uid() and public.is_active_staff()));
create policy events_read on public.detection_events for select to authenticated
using (exists (select 1 from public.sessions s where s.id = session_id));

-- No client INSERT/UPDATE/DELETE grants: validated RPCs are the write boundary.
revoke all on public.profiles, public.sessions, public.detection_events from public, anon, authenticated;
grant select on public.profiles, public.sessions, public.detection_events to authenticated;

create function public.save_session(snapshot jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := (snapshot->>'id')::uuid;
  uid uuid := auth.uid();
  started timestamptz := (snapshot->>'started_at')::timestamptz;
  seen timestamptz := (snapshot->>'last_seen_at')::timestamptz;
  ended timestamptz := (snapshot->>'ended_at')::timestamptz;
  rev bigint := (snapshot->>'revision')::bigint;
  duration bigint := (snapshot->>'duration_ms')::bigint;
  total bigint := 0;
  amount bigint;
  key text;
  item jsonb;
  affected integer;
begin
  if not public.is_active_staff() then raise exception 'Active staff access required'; end if;
  if (snapshot->>'user_id')::uuid is distinct from uid then
    raise exception 'Session owner does not match signed-in staff';
  end if;
  if sid is null or started is null or seen is null or rev is null or duration is null
     or seen < started or rev < 1 or duration < 0 or started > now() + interval '5 minutes'
     or seen > now() + interval '5 minutes'
     or abs(extract(epoch from (seen - started)) * 1000 - duration) > 10 then
    raise exception 'Invalid session timing';
  end if;
  foreach key in array array['ON_SCREEN','EYES_CLOSED','LOOKING_AWAY','NO_FACE','CALIBRATING','UNKNOWN'] loop
    amount := (snapshot->'totals'->>key)::bigint;
    if amount is null or amount < 0 then raise exception 'Invalid coverage totals'; end if;
    total := total + amount;
  end loop;
  if total <> duration then raise exception 'Coverage must equal session duration'; end if;
  if jsonb_typeof(snapshot->'events') is distinct from 'array' then raise exception 'Events must be an array'; end if;

  insert into public.sessions (id, user_id, started_at, last_seen_at, ended_at, status, device, revision, duration_ms, totals)
  values (sid, uid, started, seen, ended, snapshot->>'status', snapshot->>'device', rev, duration, snapshot->'totals')
  on conflict (id) do update set
    last_seen_at = excluded.last_seen_at, ended_at = excluded.ended_at, status = excluded.status,
    revision = excluded.revision, duration_ms = excluded.duration_ms, totals = excluded.totals, synced_at = now()
  where public.sessions.user_id = uid and public.sessions.started_at = started
    and public.sessions.status = 'active' and public.sessions.revision < rev
    and public.sessions.last_seen_at <= seen;
  get diagnostics affected = row_count;
  if affected = 0 then
    if exists (select 1 from public.sessions where id = sid and user_id <> uid) then
      raise exception 'Session belongs to another staff member';
    end if;
    return; -- An old/retried snapshot cannot overwrite a newer or final record.
  end if;

  for item in select value from jsonb_array_elements(snapshot->'events') loop
    if (item->>'started_at')::timestamptz < started
       or (item->>'started_at')::timestamptz > seen
       or (item->>'ended_at')::timestamptz > seen
       or (item->>'observed_ms')::bigint > extract(epoch from (coalesce((item->>'ended_at')::timestamptz, seen) - (item->>'started_at')::timestamptz)) * 1000 + 10
       or (ended is not null and item->>'ended_at' is null) then
      raise exception 'Invalid event timing';
    end if;
    insert into public.detection_events (session_id, id, kind, started_at, ended_at, observed_ms)
    values (sid, (item->>'id')::uuid, item->>'kind', (item->>'started_at')::timestamptz, (item->>'ended_at')::timestamptz, (item->>'observed_ms')::bigint)
    on conflict (session_id, id) do update set ended_at = excluded.ended_at, observed_ms = excluded.observed_ms;
  end loop;
  update public.sessions set event_counts = (
    select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
      select kind, count(*) n from public.detection_events where session_id = sid group by kind
    ) counts
  ) where id = sid;
end;
$$;

create function public.update_staff(staff_id uuid, display_name text, enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_team_admin() then raise exception 'Admin access required'; end if;
  update public.profiles set full_name = trim(display_name), active = enabled where id = staff_id and role = 'staff';
  if not found then raise exception 'Staff account not found'; end if;
end;
$$;

-- Provision accounts ONLY from SQL Editor, after adding users in Authentication.
-- No execution grant to authenticated or anon, so clients cannot assign roles.
create function public.provision_team_member(member_email text, display_name text, member_role text default 'staff') returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(member_email));
  if uid is null then raise exception 'Create this user in Authentication > Users first'; end if;
  insert into public.profiles (id, email, full_name, role)
  values (uid, lower(trim(member_email)), trim(display_name), member_role);
  return uid;
end;
$$;

revoke all on function public.is_team_admin(), public.is_active_staff(), public.limit_team_size(), public.save_session(jsonb), public.update_staff(uuid,text,boolean), public.provision_team_member(text,text,text) from public, anon, authenticated;
grant execute on function public.is_team_admin(), public.is_active_staff(), public.save_session(jsonb), public.update_staff(uuid,text,boolean) to authenticated;
commit;
