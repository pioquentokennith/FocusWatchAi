import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { EVENT_KINDS, COVERAGE_STATES } from '../lib/sessionRecorder.js'
import { STATE_LABELS } from '../lib/attentionEngine.js'

const PAGE_SIZE = 25
export function duration(ms = 0) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`
}
export const dateTime = (value) => value ? new Date(value).toLocaleString() : '—'
export function sessionStatus(session) {
  return session.status === 'active' ? Date.now() - new Date(session.last_seen_at).getTime() > 60000 ? 'Connection lost' : 'Monitoring' : session.status === 'completed' ? 'Completed' : 'Interrupted'
}

export default function SessionInsights({ profile }) {
  const admin = profile.role === 'admin'
  const [members, setMembers] = useState([])
  const [staff, setStaff] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        if (from && to && from > to) throw new Error('The start date must be before the end date.')
        let query = supabase.from('sessions').select('*, profiles(full_name)', { count: 'exact' }).order('started_at', { ascending: false }).order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        if (!admin) query = query.eq('user_id', profile.id)
        else if (staff) query = query.eq('user_id', staff)
        if (from) query = query.gte('started_at', new Date(`${from}T00:00:00`).toISOString())
        if (to) {
          const nextDay = new Date(`${to}T00:00:00`)
          nextDay.setDate(nextDay.getDate() + 1)
          query = query.lt('started_at', nextDay.toISOString())
        }
        const { data, count: total, error: problem } = await query
        if (problem) throw problem
        if (!cancelled) { setRows(data); setCount(total); setError('') }
      } catch (cause) { if (!cancelled) setError(cause.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    setLoading(true)
    load()
    const timer = window.setInterval(load, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [profile.id, admin, staff, from, to, page, refresh])

  useEffect(() => {
    if (!admin) return
    let cancelled = false
    supabase.from('profiles').select('id,full_name').eq('role', 'staff').order('full_name').then(({ data, error }) => {
      if (!cancelled) { if (error) setError(error.message); else setMembers(data) }
    }).catch((cause) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true }
  }, [admin])

  function filter(setter, value) { setter(value); setPage(0); setSelected(null) }
  const totals = rows.reduce((sum, row) => ({ duration: sum.duration + row.duration_ms, events: sum.events + Object.values(row.event_counts).reduce((a, b) => a + b, 0) }), { duration: 0, events: 0 })
  return <main className="team-main">
    <div className="team-page-heading"><p className="eyebrow">SESSION INSIGHTS</p><h1>{admin ? 'Your team, in view.' : 'Your monitoring history.'}</h1><p>Camera-observed conditions and session coverage. Looking away is not a measure of productivity.</p></div>
    <section className="cloud-panel filters" aria-label="Session filters">
      {admin && <label>Staff<select value={staff} onChange={(event) => filter(setStaff, event.target.value)}><option value="">All staff</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>}
      <label>From<input type="date" value={from} onChange={(event) => filter(setFrom, event.target.value)} /></label>
      <label>Through<input type="date" value={to} onChange={(event) => filter(setTo, event.target.value)} /></label>
      <button onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
    </section>
    {error && <p role="alert" className="cloud-error">Could not load insights: {error}</p>}
    <div className="insight-stats"><div><span>Matching sessions</span><strong>{count}</strong></div><div><span>Camera time · this page</span><strong>{duration(totals.duration)}</strong></div><div><span>Sustained events · this page</span><strong>{totals.events}</strong></div></div>
    <section className="cloud-panel"><div className="cloud-section-title"><h2>Session history</h2><span className="muted">Refreshes every 30 seconds · local time</span></div>
      {loading && <p role="status">Loading sessions…</p>}
      {!loading && !error && !rows.length && <p className="empty-state">No sessions yet. Recorded camera sessions will appear here after syncing.</p>}
      {!!rows.length && <div className="table-scroll"><table><thead><tr>{admin && <th>Staff</th>}<th>Started</th><th>Camera time</th><th>Status</th><th>Eyes closed</th><th>Looking away</th><th>No face</th><th>Details</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}>{admin && <td>{row.profiles?.full_name || 'Staff'}</td>}<td>{dateTime(row.started_at)}</td><td>{duration(row.duration_ms)}</td><td><span className="status-pill">{sessionStatus(row)}</span></td>{EVENT_KINDS.map((kind) => <td key={kind}>{row.event_counts[kind] || 0}</td>)}<td><button aria-label={`View session ${dateTime(row.started_at)}`} onClick={() => setSelected(row)}>View</button></td></tr>)}
      </tbody></table></div>}
      <div className="pagination"><button disabled={!page || loading} onClick={() => { setPage(page - 1); setSelected(null) }}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span><button disabled={(page + 1) * PAGE_SIZE >= count || loading} onClick={() => { setPage(page + 1); setSelected(null) }}>Next</button></div>
    </section>
    {selected && <SessionDetail key={selected.id} session={rows.find((row) => row.id === selected.id) || selected} onClose={() => setSelected(null)} />}
  </main>
}

function SessionDetail({ session, onClose }) {
  const [events, setEvents] = useState([])
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    supabase.from('detection_events').select('*', { count: 'exact' }).eq('session_id', session.id).order('started_at').order('id').range(page * 100, page * 100 + 99).then(({ data, count, error }) => {
      if (cancelled) return
      setError(error?.message || '')
      if (!error) { setEvents(data); setCount(count) }
    }).catch((cause) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true }
  }, [session.id, session.revision, page])
  return <section className="cloud-panel session-detail" aria-label="Session details">
    <div className="cloud-section-title"><h2>Session details</h2><button onClick={onClose}>Close details</button></div>
    <p className="muted">{dateTime(session.started_at)} → {session.ended_at ? dateTime(session.ended_at) : 'No confirmed end'} · {session.device} · {sessionStatus(session)}</p>
    <p className="muted">Last device observation: {dateTime(session.last_seen_at)} · Server sync: {dateTime(session.synced_at)}</p>
    <h3>Observation coverage</h3><div className="coverage-grid">{COVERAGE_STATES.map((kind) => <div key={kind}><span>{STATE_LABELS[kind]}</span><strong>{duration(session.totals[kind])}</strong></div>)}</div>
    <p className="muted">Coverage includes brief conditions below the three-second alert threshold. Uncertain time includes loading, missing frames, and inference interruptions.</p>
    <h3>Event timeline</h3><p className="muted">One event per sustained condition per alarm episode. Observed duration excludes uncertain gaps, even when the alarm remains active.</p>
    {error && <p role="alert" className="cloud-error">{error}</p>}
    {!error && !events.length && <p className="empty-state">No sustained detection events in this session.</p>}
    {!!events.length && <div className="table-scroll"><table><thead><tr><th>Condition</th><th>Started</th><th>Episode ended</th><th>Observed duration</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{STATE_LABELS[event.kind]}</td><td>{dateTime(event.started_at)}</td><td>{event.ended_at ? dateTime(event.ended_at) : 'Ongoing episode'}</td><td>{duration(event.observed_ms)}</td></tr>)}</tbody></table></div>}
    {count > 100 && <div className="pagination"><button disabled={!page} onClick={() => setPage(page - 1)}>Previous events</button><span>Page {page + 1}</span><button disabled={(page + 1) * 100 >= count} onClick={() => setPage(page + 1)}>Next events</button></div>}
  </section>
}
