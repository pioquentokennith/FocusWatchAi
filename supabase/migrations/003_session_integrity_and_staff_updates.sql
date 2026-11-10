-- Run ONCE after migrations 001 and 002, including on existing installations.
begin;

-- Repair legacy final records using only the device's last confirmed timestamp.
update public.sessions
set ended_at = last_seen_at, revision = revision + 1
where status <> 'active' and ended_at is null;

update public.detection_events e
set ended_at = s.last_seen_at
from public.sessions s
where e.session_id = s.id and s.status <> 'active' and e.ended_at is null;

-- The original end-time CHECK can evaluate to NULL, which PostgreSQL accepts.
alter table public.sessions add constraint sessions_final_end_required
check (status = 'active' or ended_at is not null);

-- Keep the original three-argument RPC for older clients. Updated clients send
-- the fields they last read so a stale form cannot overwrite a concurrent edit.
create or replace function public.update_staff(
  staff_id uuid, display_name text, enabled boolean,
  expected_display_name text, expected_enabled boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_team_admin() then raise exception 'Admin access required'; end if;
  if expected_display_name is null or expected_enabled is null then
    raise exception 'Expected staff details are required' using errcode = '22023';
  end if;
  update public.profiles
  set full_name = trim(display_name), active = enabled
  where id = staff_id and role = 'staff'
    and full_name = expected_display_name and active = expected_enabled;
  if not found then
    if exists (select 1 from public.profiles where id = staff_id and role = 'staff') then
      raise exception 'This staff account changed. Load the latest details before saving.' using errcode = '40001';
    end if;
    raise exception 'Staff account not found';
  end if;
end;
$$;

revoke all on function public.update_staff(uuid,text,boolean,text,boolean) from public, anon, authenticated;
grant execute on function public.update_staff(uuid,text,boolean,text,boolean) to authenticated;
commit;
