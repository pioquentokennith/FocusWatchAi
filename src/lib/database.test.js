// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSessionLedger } from './sessionRecorder.js'

let db
const admin = '00000000-0000-4000-8000-000000000001'
const one = '00000000-0000-4000-8000-000000000002'
const two = '00000000-0000-4000-8000-000000000003'
const user = async (id, role = 'authenticated') => {
  await db.exec(`reset role; set role ${role};`)
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
}
const save = (snapshot) => db.query('select public.save_session($1::jsonb)', [JSON.stringify({ user_id: one, ...snapshot })])
function sample() {
  const log = createSessionLedger({ device: 'desktop', time: 0, wallTime: Date.now() - 20000 })
  for (let time = 0; time <= 4000; time += 100) log.observe({ state: 'NO_FACE', seconds: time / 1000, alarmActive: time >= 3000, alert: time === 3000 ? 'NO_FACE' : null }, time)
  return log
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
    create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), provider text, identity_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
  `)
  await db.exec(await readFile(new URL('../../supabase/migrations/001_team_sessions.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/migrations/002_google_registration.sql', import.meta.url), 'utf8'))
}, 60000)
beforeEach(async () => {
  await db.exec('reset role; truncate public.detection_events, public.sessions, public.profiles, auth.users cascade;')
  for (const [id, email, role] of [[admin, 'admin@test.local', 'admin'], [one, 'one@test.local', 'staff'], [two, 'two@test.local', 'staff']]) {
    await db.query('insert into auth.users (id,email) values ($1,$2)', [id, email])
    await db.query('select public.provision_team_member($1,$2,$3)', [email, email, role])
  }
})
afterAll(async () => { await db?.close() })

describe('PostgreSQL team access and sync', () => {
  it('isolates staff records and allows the admin to read the entire team', async () => {
    await user(one)
    await save(sample().snapshot(4000, 'completed'))
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(1)
    expect((await db.query('select * from public.detection_events')).rows).toHaveLength(1)
    await user(two)
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(0)
    expect((await db.query('select * from public.detection_events')).rows).toHaveLength(0)
    expect((await db.query('select * from public.profiles')).rows).toHaveLength(1)
    await user(admin)
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(1)
    expect((await db.query('select * from public.detection_events')).rows).toHaveLength(1)
    expect((await db.query('select * from public.profiles')).rows).toHaveLength(3)
    await user('', 'anon')
    await expect(db.query('select * from public.sessions')).rejects.toThrow(/permission denied/)
  })

  it('denies self promotion, direct writes, provisioning, and staff management by staff', async () => {
    await user(one)
    await expect(db.query("update public.profiles set role = 'admin' where id = $1", [one])).rejects.toThrow(/permission denied/)
    await expect(db.query("select public.provision_team_member('one@test.local','One','admin')")).rejects.toThrow(/permission denied/)
    await expect(db.query('select public.update_staff($1,$2,$3)', [two, 'Two', false])).rejects.toThrow(/Admin access required/)
    await expect(db.query('delete from public.sessions')).rejects.toThrow(/permission denied/)
  })

  it('deduplicates retries, ignores old snapshots, and protects final records', async () => {
    await user(one)
    const log = sample()
    const active = log.snapshot(4000)
    const final = log.snapshot(5000, 'completed')
    await save(active)
    await save(active)
    await save(final)
    await save(active)
    await save({ ...active, revision: 99 })
    const { rows } = await db.query('select * from public.sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'completed', duration_ms: 5000, event_counts: { NO_FACE: 1 } })
    expect((await db.query('select * from public.detection_events')).rows).toHaveLength(1)
    await user(two)
    await expect(save({ ...final, revision: 100 })).rejects.toThrow(/owner does not match/)
    await expect(save({ ...final, user_id: two, revision: 100 })).rejects.toThrow(/another staff member/)
  })

  it('rolls back the entire snapshot if event timing or coverage is invalid', async () => {
    await user(one)
    const snapshot = sample().snapshot(4000, 'completed')
    await expect(save({ ...snapshot, totals: { ...snapshot.totals, UNKNOWN: 9999 } })).rejects.toThrow(/Coverage/)
    await expect(save({ ...snapshot, events: [{ ...snapshot.events[0], observed_ms: 999999 }] })).rejects.toThrow(/event timing/)
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(0)
  })

  it('blocks disabled staff immediately at the database', async () => {
    await user(one)
    const snapshot = sample().snapshot(4000, 'completed')
    await save(snapshot)
    await user(admin)
    await db.query('select public.update_staff($1,$2,$3)', [one, 'One', false])
    await user(one)
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(0)
    await expect(save(snapshot)).rejects.toThrow(/Active staff access required/)
    await user(admin)
    await expect(save(snapshot)).rejects.toThrow(/Active staff access required/)
  })

  it('rejects an old account’s queued new session after switching accounts', async () => {
    await user(two)
    await expect(save(sample().snapshot(4000, 'completed'))).rejects.toThrow(/owner does not match/)
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(0)
  })

  it('enforces the one-admin and ten-staff team limits', async () => {
    for (let i = 4; i <= 12; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      await db.query('insert into auth.users (id,email) values ($1,$2)', [id, `${i}@test.local`])
      if (i <= 11) await db.query('select public.provision_team_member($1,$2)', [`${i}@test.local`, `Staff ${i}`])
    }
    await expect(db.query("select public.provision_team_member('12@test.local','Too many','staff')")).rejects.toThrow(/10 staff/)
    await expect(db.query("select public.provision_team_member('12@test.local','Second admin','admin')")).rejects.toThrow(/one_team_admin/)
  })
})

async function applicant(index, { provider = 'google', email = `applicant${index}@gmail.com`, verified = true } = {}) {
  await db.exec('reset role')
  const id = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  await db.query('insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),$3)', [id, email, JSON.stringify({ provider: 'google', email_verified: true, role: 'admin' })])
  if (provider) await db.query('insert into auth.identities (user_id,provider,identity_data) values ($1,$2,$3)', [id, provider, JSON.stringify({ email, email_verified: verified, full_name: `Applicant ${index}` })])
  await user(id)
  return id
}
const requestAccess = () => db.query('select (public.request_staff_access()).*')
const review = (id, decision = 'approved') => db.query('select (public.review_staff_request($1,$2)).*', [id, decision])

describe('verified Google registration and admin approval', () => {
  it('keeps pending requests outside profiles and isolates applicants from team data', async () => {
    const id = await applicant(1)
    expect((await requestAccess()).rows[0]).toMatchObject({ user_id: id, status: 'pending', email: 'applicant1@gmail.com' })
    await requestAccess()
    expect((await db.query('select * from public.registration_requests')).rows).toHaveLength(1)
    expect((await db.query('select * from public.profiles')).rows).toHaveLength(0)
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(0)
    await expect(save(sample().snapshot(4000))).rejects.toThrow(/Active staff/)
    await applicant(2)
    expect((await db.query('select * from public.registration_requests')).rows).toHaveLength(0)
    await requestAccess()
    expect((await db.query('select * from public.registration_requests')).rows).toHaveLength(1)
    await user(admin)
    expect((await db.query('select * from public.registration_requests')).rows).toHaveLength(2)
  })

  it('requires verified Google Gmail identity and ignores spoofed user metadata', async () => {
    for (const [index, options] of [
      [1, { provider: null }], [2, { provider: 'email' }], [3, { email: 'person@company.com' }],
      [4, { verified: false }], [5, { email: 'person@gmail.com.evil.test' }],
    ]) {
      await applicant(index, options)
      await expect(requestAccess()).rejects.toThrow(/verified @gmail.com/)
    }
    const id = await applicant(6)
    await db.exec('reset role')
    await db.query("update auth.users set email = 'different@gmail.com' where id = $1", [id])
    await user(id)
    await expect(requestAccess()).rejects.toThrow(/verified @gmail.com/)
  })

  it('blocks client approval and direct writes, while an admin approval creates only a staff role', async () => {
    const id = await applicant(1)
    await requestAccess()
    await expect(review(id)).rejects.toThrow(/Admin access required/)
    await expect(db.query("update public.registration_requests set status = 'approved'")).rejects.toThrow(/permission denied/)
    await expect(db.query('select * from public.verified_google_applicant($1)', [id])).rejects.toThrow(/permission denied/)
    await user(one)
    await expect(review(id)).rejects.toThrow(/Admin access required/)
    await user(admin)
    await expect(review(id, 'admin')).rejects.toThrow(/Invalid review/)
    await review(id)
    await review(id) // Retrying a successful approval is harmless.
    const { rows } = await db.query('select * from public.profiles where id = $1', [id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'staff', active: true })
    expect((await db.query('select * from public.registration_requests where user_id = $1', [id])).rows[0]).toMatchObject({ status: 'approved', reviewed_by: admin })
    await user(id)
    await save({ ...sample().snapshot(4000, 'completed'), user_id: id })
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(1)
  })

  it('allows pending requests beyond capacity but atomically refuses the eleventh approved staff', async () => {
    const ids = []
    for (let index = 1; index <= 11; index++) {
      ids.push(await applicant(index))
      await requestAccess()
    }
    await user(admin)
    expect((await db.query("select * from public.profiles where role = 'staff'")).rows).toHaveLength(2)
    // Two staff were provisioned by the common fixture, leaving eight slots.
    for (const id of ids.slice(0, 8)) await review(id)
    await expect(review(ids[8])).rejects.toThrow(/All 10 staff slots/)
    expect((await db.query('select * from public.registration_requests where user_id = $1', [ids[8]])).rows[0]).toMatchObject({ status: 'pending', reviewed_at: null })
    expect((await db.query("select * from public.profiles where role = 'staff'")).rows).toHaveLength(10)
    await db.query('select public.update_staff($1,$2,false)', [one, 'Disabled staff'])
    await expect(review(ids[9])).rejects.toThrow(/All 10 staff slots/)
  })

  it('retains rejection across sign-ins and never provisions a rejected applicant', async () => {
    const id = await applicant(1)
    await requestAccess()
    await user(admin)
    await review(id, 'rejected')
    await review(id, 'rejected')
    await user(id)
    expect((await requestAccess()).rows[0].status).toBe('rejected')
    expect((await db.query('select * from public.profiles')).rows).toHaveLength(0)
    await expect(save(sample().snapshot(4000))).rejects.toThrow(/Active staff/)
  })

  it('rechecks the Google identity on approval and protects existing disabled staff', async () => {
    const id = await applicant(1)
    await requestAccess()
    await db.exec('reset role')
    await db.query('delete from auth.identities where user_id = $1', [id])
    await user(admin)
    await expect(review(id)).rejects.toThrow(/same verified Gmail/)
    await db.query('select public.update_staff($1,$2,false)', [one, 'One'])
    await user(one)
    await requestAccess()
    expect((await db.query('select * from public.registration_requests')).rows).toHaveLength(0)
    expect((await db.query('select active from public.profiles')).rows[0].active).toBe(false)
    await user('', 'anon')
    await expect(requestAccess()).rejects.toThrow(/permission denied/)
  })
})
