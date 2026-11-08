// Test-only network fixtures. Production authentication never has a bypass.
export const STAFF_ID = '00000000-0000-4000-8000-000000000002'
export const ADMIN_ID = '00000000-0000-4000-8000-000000000001'

export async function mockSupabase(page, { role = 'staff', signedIn = true, seed = false, google = false, provisioned = true, requestStatus = 'pending', seedRequests = false, staffSlots = 1 } = {}) {
  const own = { id: role === 'admin' ? ADMIN_ID : STAFF_ID, email: `${role}@example.test`, full_name: role === 'admin' ? 'Team Admin' : 'Staff One', role, active: true }
  const staff = { id: STAFF_ID, email: 'staff@example.test', full_name: 'Staff One', role: 'staff', active: true, sessions: [] }
  if (google) own.email = 'staff@gmail.com'
  const user = { id: own.id, email: own.email, aud: 'authenticated', role: 'authenticated', app_metadata: { providers: [google ? 'google' : 'email'] }, user_metadata: {}, created_at: new Date().toISOString() }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = ['header', Buffer.from(JSON.stringify({ sub: own.id, exp: expires, role: 'authenticated' })).toString('base64url'), 'signature'].join('.')
  const session = { access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expires, user }
  const saved = []
  const sessions = seed ? [{
    id: '00000000-0000-4000-8000-000000000099', user_id: STAFF_ID, started_at: '2026-11-08T01:00:00Z', last_seen_at: '2026-11-08T01:01:00Z', ended_at: '2026-11-08T01:01:00Z', synced_at: '2026-11-08T01:01:01Z',
    device: 'desktop', status: 'completed', revision: 1, duration_ms: 60000, event_counts: { NO_FACE: 1 }, profiles: { full_name: staff.full_name },
    totals: { ON_SCREEN: 50000, NO_FACE: 5000, UNKNOWN: 5000, CALIBRATING: 0, EYES_CLOSED: 0, LOOKING_AWAY: 0 },
    events: [{ id: 'event-one', kind: 'NO_FACE', started_at: '2026-11-08T01:00:10Z', ended_at: '2026-11-08T01:00:15Z', observed_ms: 5000 }],
  }] : []
  const application = { user_id: STAFF_ID, full_name: 'Staff One', email: 'staff@gmail.com', status: requestStatus, requested_at: new Date().toISOString(), reviewed_at: null }
  const controls = { saved, sessions, staff, own, provisioned, application, staffSlots, requests: seedRequests ? [application] : [], oauthExchanges: [], authorizations: [] }

  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', 'content-range': `0-${Math.max(0, body?.length - 1)}/${Array.isArray(body) ? body.length : 1}` }, body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/authorize') {
      controls.authorizations.push(Object.fromEntries(url.searchParams))
      const redirect = new URL(url.searchParams.get('redirect_to'))
      redirect.searchParams.set('code', 'fixture-google-code')
      return route.fulfill({ status: 302, headers: { location: redirect.href }, body: '' })
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'pkce') controls.oauthExchanges.push(request.postDataJSON())
      return reply(session)
    }
    if (url.pathname === '/auth/v1/user') return reply(user)
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname === '/rest/v1/profiles') {
      if (request.method() === 'HEAD') return route.fulfill({ headers: { 'access-control-expose-headers': 'content-range', 'content-range': `*/${controls.staffSlots}` }, body: '' })
      return reply(url.searchParams.has('id') ? controls.provisioned ? [own] : [] : [staff])
    }
    if (url.pathname === '/rest/v1/rpc/request_staff_access') return reply(application)
    if (url.pathname === '/rest/v1/registration_requests') return reply(controls.requests.filter((entry) => `eq.${entry.status}` === url.searchParams.get('status')))
    if (url.pathname === '/rest/v1/rpc/review_staff_request') {
      const { request_id, decision } = request.postDataJSON()
      const entry = controls.requests.find((value) => value.user_id === request_id)
      if (decision === 'approved' && controls.staffSlots >= 10) return reply({ message: 'All 10 staff slots are occupied. This request remains pending' }, 400)
      entry.status = decision
      entry.reviewed_at = new Date().toISOString()
      if (decision === 'approved') controls.staffSlots++
      return reply(entry)
    }
    if (url.pathname === '/rest/v1/sessions') {
      let matches = sessions
      const filters = url.searchParams.getAll('started_at')
      for (const filter of filters) {
        if (filter.startsWith('gte.')) matches = matches.filter((row) => new Date(row.started_at) >= new Date(filter.slice(4)))
        if (filter.startsWith('lt.')) matches = matches.filter((row) => new Date(row.started_at) < new Date(filter.slice(3)))
      }
      return reply(matches)
    }
    if (url.pathname === '/rest/v1/detection_events') return reply(sessions.find((row) => `eq.${row.id}` === url.searchParams.get('session_id'))?.events || [])
    if (url.pathname === '/rest/v1/rpc/save_session') {
      const { snapshot } = request.postDataJSON()
      saved.push(snapshot)
      const index = sessions.findIndex((row) => row.id === snapshot.id)
      const row = { ...snapshot, user_id: STAFF_ID, synced_at: new Date().toISOString(), profiles: { full_name: staff.full_name }, event_counts: snapshot.events.reduce((counts, event) => ({ ...counts, [event.kind]: (counts[event.kind] || 0) + 1 }), {}) }
      if (index >= 0) sessions[index] = row
      else sessions.unshift(row)
      return reply(null)
    }
    if (url.pathname === '/rest/v1/rpc/update_staff') {
      const { display_name, enabled } = request.postDataJSON()
      staff.full_name = display_name
      staff.active = enabled
      return reply(null)
    }
    return reply({ message: `Unhandled fixture: ${url.pathname}` }, 400)
  })
  if (signedIn) await page.addInitScript((session) => localStorage.setItem('focuswatch.auth', JSON.stringify(session)), session)
  return controls
}
