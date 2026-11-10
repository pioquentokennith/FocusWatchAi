-- FocusWatchAI 0.5: run once after 003. Existing sessions/clients keep 3s defaults.
begin;

create function public.valid_alert_thresholds(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare key text; amount numeric;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(value)) <> 3 then return false; end if;
  foreach key in array array['EYES_CLOSED','LOOKING_AWAY','NO_FACE'] loop
    if jsonb_typeof(value->key) is distinct from 'number' then return false; end if;
    amount := (value->>key)::numeric;
    if amount < 1000 or amount > 60000 or mod(amount, 1000) <> 0 then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.staff_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  thresholds jsonb not null default '{"EYES_CLOSED":3000,"LOOKING_AWAY":3000,"NO_FACE":3000}' check (public.valid_alert_thresholds(thresholds)),
  updated_at timestamptz not null default now()
);
alter table public.staff_settings enable row level security;
create policy own_settings_read on public.staff_settings for select to authenticated
using (user_id = auth.uid() and public.is_active_staff());
revoke all on public.staff_settings from public, anon, authenticated;
grant select on public.staff_settings to authenticated;

create function public.update_my_alert_settings(alert_thresholds jsonb) returns public.staff_settings
language plpgsql security definer set search_path = '' as $$
declare result public.staff_settings;
begin
  if not public.is_active_staff() then raise exception 'Active staff access required'; end if;
  if not public.valid_alert_thresholds(alert_thresholds) then
    raise exception 'Use whole seconds from 1 to 60 for each alert' using errcode = '22023';
  end if;
  insert into public.staff_settings(user_id, thresholds) values (auth.uid(), alert_thresholds)
  on conflict (user_id) do update set thresholds = excluded.thresholds, updated_at = now()
  returning * into result;
  return result;
end;
$$;

alter table public.sessions
  add column activity text not null default 'monitoring' check (activity in ('monitoring','paused','stopped')),
  add column break_ms bigint not null default 0 check (break_ms >= 0 and break_ms <= duration_ms),
  add column thresholds jsonb not null default '{"EYES_CLOSED":3000,"LOOKING_AWAY":3000,"NO_FACE":3000}' check (public.valid_alert_thresholds(thresholds));
update public.sessions set activity = 'stopped' where status <> 'active';
alter table public.sessions add constraint session_activity_matches_status
check ((status = 'active' and activity in ('monitoring','paused')) or (status <> 'active' and activity = 'stopped'));

create table public.session_breaks (
  session_id uuid not null references public.sessions(id) on delete cascade,
  id uuid not null,
  reason text not null check (reason in ('Lunch','Personal','Meeting','Other')),
  note text not null default '' check (length(note) <= 250),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms bigint not null check (duration_ms >= 0),
  primary key (session_id, id),
  check (ended_at is null or ended_at >= started_at)
);
alter table public.session_breaks enable row level security;
create policy breaks_read on public.session_breaks for select to authenticated
using (exists (select 1 from public.sessions s where s.id = session_id));
revoke all on public.session_breaks from public, anon, authenticated;
grant select on public.session_breaks to authenticated;

create or replace function public.save_session(snapshot jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := (snapshot->>'id')::uuid;
  uid uuid := auth.uid();
  started timestamptz := (snapshot->>'started_at')::timestamptz;
  seen timestamptz := (snapshot->>'last_seen_at')::timestamptz;
  ended timestamptz := (snapshot->>'ended_at')::timestamptz;
  rev bigint := (snapshot->>'revision')::bigint;
  duration bigint := (snapshot->>'duration_ms')::bigint;
  paused bigint := coalesce((snapshot->>'break_ms')::bigint, 0);
  mode text := coalesce(snapshot->>'activity', case when snapshot->>'status' = 'active' then 'monitoring' else 'stopped' end);
  settings jsonb := coalesce(snapshot->'thresholds', '{"EYES_CLOSED":3000,"LOOKING_AWAY":3000,"NO_FACE":3000}'::jsonb);
  break_list jsonb := coalesce(snapshot->'breaks', '[]'::jsonb);
  total bigint := 0;
  break_total bigint := 0;
  open_breaks integer := 0;
  previous_end timestamptz := started;
  break_start timestamptz;
  break_end timestamptz;
  amount bigint;
  key text;
  item jsonb;
  affected integer;
begin
  if not public.is_active_staff() then raise exception 'Active staff access required'; end if;
  if (snapshot->>'user_id')::uuid is distinct from uid then raise exception 'Session owner does not match signed-in staff'; end if;
  if sid is null or started is null or seen is null or rev is null or duration is null
     or seen < started or rev < 1 or duration < 0 or paused < 0 or paused > duration
     or started > now() + interval '5 minutes' or seen > now() + interval '5 minutes'
     or abs(extract(epoch from (seen - started)) * 1000 - duration) > 10 then
    raise exception 'Invalid session timing' using errcode = '22023';
  end if;
  if not public.valid_alert_thresholds(settings) then raise exception 'Invalid alert thresholds' using errcode = '22023'; end if;
  foreach key in array array['ON_SCREEN','EYES_CLOSED','LOOKING_AWAY','NO_FACE','CALIBRATING','UNKNOWN'] loop
    amount := (snapshot->'totals'->>key)::bigint;
    if amount is null or amount < 0 then raise exception 'Invalid coverage totals' using errcode = '22023'; end if;
    total := total + amount;
  end loop;
  if total + paused <> duration then raise exception 'Coverage and breaks must equal session duration' using errcode = '22023'; end if;
  if jsonb_typeof(snapshot->'events') is distinct from 'array' then raise exception 'Events must be an array' using errcode = '22023'; end if;
  if jsonb_typeof(break_list) is distinct from 'array' then raise exception 'Breaks must be an array' using errcode = '22023'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(break_list)) <> jsonb_array_length(break_list) then
    raise exception 'Break IDs must be unique' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(break_list) loop
    break_start := (item->>'started_at')::timestamptz;
    break_end := (item->>'ended_at')::timestamptz;
    amount := (item->>'duration_ms')::bigint;
    if break_start is null or amount is null or amount < 0 or break_start < previous_end or break_start > seen
       or coalesce(break_end, seen) < break_start or coalesce(break_end, seen) > seen
       or abs(extract(epoch from (coalesce(break_end, seen) - break_start)) * 1000 - amount) > 1 then
      raise exception 'Invalid or overlapping break timing' using errcode = '22023';
    end if;
    if break_end is null then open_breaks := open_breaks + 1; end if;
    previous_end := coalesce(break_end, seen);
    break_total := break_total + amount;
  end loop;
  if break_total <> paused or (mode = 'paused' and open_breaks <> 1) or (mode <> 'paused' and open_breaks <> 0) then
    raise exception 'Break duration or activity is inconsistent' using errcode = '22023';
  end if;

  insert into public.sessions (id, user_id, started_at, last_seen_at, ended_at, status, device, revision, duration_ms, totals, activity, break_ms, thresholds)
  values (sid, uid, started, seen, ended, snapshot->>'status', snapshot->>'device', rev, duration, snapshot->'totals', mode, paused, settings)
  on conflict (id) do update set
    last_seen_at = excluded.last_seen_at, ended_at = excluded.ended_at, status = excluded.status,
    revision = excluded.revision, duration_ms = excluded.duration_ms, totals = excluded.totals,
    activity = excluded.activity, break_ms = excluded.break_ms, synced_at = now()
  where public.sessions.user_id = uid and public.sessions.started_at = started
    and public.sessions.status = 'active' and public.sessions.revision < rev
    and public.sessions.last_seen_at <= seen and public.sessions.thresholds = settings;
  get diagnostics affected = row_count;
  if affected = 0 then
    if exists (select 1 from public.sessions where id = sid and user_id <> uid) then raise exception 'Session belongs to another staff member'; end if;
    if exists (select 1 from public.sessions where id = sid and status = 'active' and revision < rev and thresholds <> settings) then
      raise exception 'Session alert thresholds cannot change after starting' using errcode = '22023';
    end if;
    return;
  end if;

  for item in select value from jsonb_array_elements(snapshot->'events') loop
    if (item->>'started_at')::timestamptz < started or (item->>'started_at')::timestamptz > seen
       or (item->>'ended_at')::timestamptz > seen
       or (item->>'observed_ms')::bigint > extract(epoch from (coalesce((item->>'ended_at')::timestamptz, seen) - (item->>'started_at')::timestamptz)) * 1000 + 10
       or ((snapshot->>'status' <> 'active' or mode = 'paused') and item->>'ended_at' is null) then
      raise exception 'Invalid event timing' using errcode = '22023';
    end if;
    insert into public.detection_events (session_id, id, kind, started_at, ended_at, observed_ms)
    values (sid, (item->>'id')::uuid, item->>'kind', (item->>'started_at')::timestamptz, (item->>'ended_at')::timestamptz, (item->>'observed_ms')::bigint)
    on conflict (session_id, id) do update set ended_at = excluded.ended_at, observed_ms = excluded.observed_ms;
  end loop;
  for item in select value from jsonb_array_elements(break_list) loop
    insert into public.session_breaks (session_id, id, reason, note, started_at, ended_at, duration_ms)
    values (sid, (item->>'id')::uuid, item->>'reason', coalesce(item->>'note',''), (item->>'started_at')::timestamptz, (item->>'ended_at')::timestamptz, (item->>'duration_ms')::bigint)
    on conflict (session_id, id) do update set ended_at = excluded.ended_at, duration_ms = excluded.duration_ms;
  end loop;
  update public.sessions set event_counts = (
    select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
      select kind, count(*) n from public.detection_events where session_id = sid group by kind
    ) counts
  ) where id = sid;
end;
$$;

-- SECURITY INVOKER deliberately preserves the same staff/admin RLS as history.
-- A JSON result includes all groups, independently of PostgREST's row/page limit.
create function public.session_report(range_start timestamptz, range_end timestamptz, report_timezone text, staff_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not (public.is_active_staff() or public.is_team_admin()) then raise exception 'Team access required'; end if;
  if range_start is null or range_end is null or range_start >= range_end then raise exception 'Invalid report dates' using errcode = '22023'; end if;
  if not exists(select 1 from pg_timezone_names where name = report_timezone) then raise exception 'Invalid report timezone' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.day desc, g.full_name, g.user_id), '[]'::jsonb) into result from (
    select (s.started_at at time zone report_timezone)::date as day, s.user_id, p.full_name,
      count(*) as sessions, sum(s.duration_ms) as session_ms,
      sum(s.duration_ms - s.break_ms) as camera_ms, sum(s.break_ms) as break_ms,
      sum((s.totals->>'ON_SCREEN')::bigint) as on_screen_ms,
      sum((s.totals->>'EYES_CLOSED')::bigint) as eyes_closed_ms,
      sum((s.totals->>'LOOKING_AWAY')::bigint) as looking_away_ms,
      sum((s.totals->>'NO_FACE')::bigint) as no_face_ms,
      sum((s.totals->>'CALIBRATING')::bigint) as calibrating_ms,
      sum((s.totals->>'UNKNOWN')::bigint) as unknown_ms,
      sum(coalesce((s.event_counts->>'EYES_CLOSED')::bigint,0)) as eyes_closed_events,
      sum(coalesce((s.event_counts->>'LOOKING_AWAY')::bigint,0)) as looking_away_events,
      sum(coalesce((s.event_counts->>'NO_FACE')::bigint,0)) as no_face_events
    from public.sessions s join public.profiles p on p.id=s.user_id
    where s.started_at >= range_start and s.started_at < range_end and (staff_id is null or s.user_id = staff_id)
    group by (s.started_at at time zone report_timezone)::date, s.user_id, p.full_name
  ) g;
  return jsonb_build_object('rows', result, 'timezone', report_timezone, 'basis', 'session_start');
end;
$$;

revoke all on function public.valid_alert_thresholds(jsonb), public.update_my_alert_settings(jsonb), public.session_report(timestamptz,timestamptz,text,uuid) from public, anon, authenticated;
grant execute on function public.update_my_alert_settings(jsonb), public.session_report(timestamptz,timestamptz,text,uuid) to authenticated;
-- Existing save_session execution grants are preserved by CREATE OR REPLACE.
commit;
