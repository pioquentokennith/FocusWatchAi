-- Run ONCE after 001_team_sessions.sql. Existing accounts and sessions are preserved.
begin;

create table public.registration_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (email ~ '^[^@[:space:]]+@gmail[.]com$'),
  full_name text not null check (length(full_name) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  check ((status = 'pending' and reviewed_at is null) or (status <> 'pending' and reviewed_at is not null))
);
create index registration_requests_queue on public.registration_requests (status, requested_at);
alter table public.registration_requests enable row level security;
create policy registration_requests_read on public.registration_requests for select to authenticated
using (user_id = auth.uid() or public.is_team_admin());
revoke all on public.registration_requests from public, anon, authenticated;
grant select on public.registration_requests to authenticated;

-- Use Google identity data, not editable raw_user_meta_data or client arguments.
create function public.verified_google_applicant(applicant_id uuid)
returns table (email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select lower(i.identity_data->>'email'),
    left(coalesce(nullif(trim(i.identity_data->>'full_name'), ''),
      nullif(trim(i.identity_data->>'name'), ''), split_part(i.identity_data->>'email', '@', 1)), 100)
  from auth.identities i join auth.users u on u.id = i.user_id
  where i.user_id = applicant_id and i.provider = 'google'
    and i.identity_data->>'email_verified' = 'true'
    and lower(i.identity_data->>'email') ~ '^[^@[:space:]]+@gmail[.]com$'
    and lower(i.identity_data->>'email') = lower(u.email)
    and u.email_confirmed_at is not null
  limit 1;
$$;

create function public.request_staff_access() returns public.registration_requests
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  applicant record;
  request public.registration_requests;
begin
  if uid is null then raise exception 'Sign in with Google first'; end if;
  -- Serialize against approvals and manual provisioning for this small team.
  perform pg_advisory_xact_lock(870011);
  if exists (select 1 from public.profiles where id = uid) then
    select * into request from public.registration_requests where user_id = uid;
    return request;
  end if;
  select * into applicant from public.verified_google_applicant(uid);
  if not found then raise exception 'Staff registration requires a verified @gmail.com Google account'; end if;
  insert into public.registration_requests (user_id, email, full_name)
  values (uid, applicant.email, applicant.full_name)
  on conflict (user_id) do nothing;
  -- Repeated sign-ins never reset a rejected request or consume a staff slot.
  select * into request from public.registration_requests where user_id = uid;
  return request;
end;
$$;

create function public.review_staff_request(request_id uuid, decision text)
returns public.registration_requests
language plpgsql security definer set search_path = '' as $$
declare
  request public.registration_requests;
  applicant record;
begin
  if not public.is_team_admin() then raise exception 'Admin access required'; end if;
  if decision is null or decision not in ('approved', 'rejected') then raise exception 'Invalid review decision'; end if;
  -- Same lock as limit_team_size: competing approvals cannot take the last slot twice.
  perform pg_advisory_xact_lock(870011);
  select * into request from public.registration_requests where user_id = request_id for update;
  if not found then raise exception 'Registration request not found'; end if;
  if request.status = decision then return request; end if;
  if request.status <> 'pending' then raise exception 'This request has already been reviewed'; end if;
  if decision = 'approved' then
    if exists (select 1 from public.profiles where id = request_id) then raise exception 'Account is already provisioned'; end if;
    select * into applicant from public.verified_google_applicant(request_id);
    if not found or applicant.email <> request.email then
      raise exception 'Applicant must still have the same verified Gmail Google identity';
    end if;
    if (select count(*) from public.profiles where role = 'staff') >= 10 then
      raise exception 'All 10 staff slots are occupied. This request remains pending';
    end if;
    insert into public.profiles (id, email, full_name, role, active)
    values (request_id, applicant.email, request.full_name, 'staff', true);
  end if;
  update public.registration_requests set status = decision, reviewed_at = now(), reviewed_by = auth.uid()
  where user_id = request_id returning * into request;
  return request;
end;
$$;

revoke all on function public.verified_google_applicant(uuid), public.request_staff_access(), public.review_staff_request(uuid,text) from public, anon, authenticated;
grant execute on function public.request_staff_access(), public.review_staff_request(uuid,text) to authenticated;
commit;
