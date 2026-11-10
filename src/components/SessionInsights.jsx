import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { EVENT_KINDS, COVERAGE_STATES } from '../lib/sessionRecorder.js'
import { STATE_LABELS } from '../lib/attentionEngine.js'
import { ALERT_NAMES, normalizeThresholds } from '../lib/settings.js'
import { datePreset, downloadReport, eventTotal, localTimezone, reportArguments, reportTotals } from '../lib/reporting.js'

const PAGE_SIZE = 25
export function duration(ms = 0) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`
}
export const dateTime = (value) => value ? new Date(value).toLocaleString() : '—'
export function sessionStatus(session) {
  return session.status === 'active' ? Date.now() - new Date(session.synced_at || session.last_seen_at).getTime() > 60000 ? 'Connection unknown' : session.activity === 'paused' ? 'On break' : 'Monitoring' : session.status === 'completed' ? 'Completed' : 'Interrupted'
}

export default function SessionInsights({ profile }) {
  const admin = profile.role === 'admin'
  const [members, setMembers] = useState([])
  const [staff, setStaff] = useState('')
  const [from, setFrom] = useState(() => datePreset().from)
  const [to, setTo] = useState(() => datePreset().to)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [report, setReport] = useState(null)
  const [reportPage, setReportPage] = useState(0)
  const [exportMessage, setExportMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    let running = false
    async function load() {
      if (running) return
      running = true
      try {
        const args = reportArguments(from, to, admin ? staff : profile.id)
        let query = supabase.from('sessions').select('*, profiles(full_name)', { count: 'exact' }).order('started_at', { ascending: false }).order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        if (!admin) query = query.eq('user_id', profile.id)
        else if (staff) query = query.eq('user_id', staff)
        query = query.gte('started_at', args.range_start).lt('started_at', args.range_end)
        const [history, summary] = await Promise.all([
          query.abortSignal(AbortSignal.timeout(15000)),
          supabase.rpc('session_report', args).abortSignal(AbortSignal.timeout(15000)),
        ])
        if (history.error) throw history.error
        if (summary.error) throw summary.error
        if (!cancelled) {
          setRows(history.data); setCount(history.count); setReport(summary.data); setError('')
          setSelected((previous) => previous ? history.data.find((row) => row.id === previous.id) || previous : null)
        }
      } catch (cause) { if (!cancelled) setError(cause.message) }
      finally { running = false; if (!cancelled) setLoading(false) }
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

  function filter(setter, value) { setter(value); setPage(0); setSelected(null); setReport(null); setReportPage(0); setRows([]); setCount(0); setExportMessage('') }
  function preset(days) { const range = datePreset(days); filter(setFrom, range.from); filter(setTo, range.to); setRefresh((value) => value + 1) }
  const reportRows = report?.rows || []
  const totals = reportTotals(reportRows)
  const timezone = report?.timezone || localTimezone()
  function exportCsv() {
    try { downloadReport(reportRows, timezone, from, to); setExportMessage('CSV export prepared for all matching sessions.') }
    catch (cause) { setExportMessage(`Could not export: ${cause.message}`) }
  }
  return <main className="team-main">
    <div className="team-page-heading"><p className="eyebrow">SESSION INSIGHTS</p><h1>{admin ? 'Your team, in view.' : 'Your monitoring history.'}</h1><p>Camera-observed conditions and session coverage. Looking away is not a measure of productivity.</p></div>
    <section className="cloud-panel filters" aria-label="Session filters">
      {admin && <label>Staff<select value={staff} onChange={(event) => filter(setStaff, event.target.value)}><option value="">All staff</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>}
      <label>From<input type="date" value={from} onChange={(event) => filter(setFrom, event.target.value)} /></label>
      <label>Through<input type="date" value={to} onChange={(event) => filter(setTo, event.target.value)} /></label>
      <button onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      <button onClick={() => preset(1)}>Today</button><button onClick={() => preset(7)}>Last 7 days</button>
      <button disabled={loading || Boolean(error) || !reportRows.length} onClick={exportCsv}>Export daily CSV</button>
    </section>
    <p className="muted report-note">Timezone: {timezone}. Summaries include all matching sessions, grouped by their start date. An overnight session is included in full on the day it started. Active sessions include only their last synced time.</p>
    {exportMessage && <p role="status">{exportMessage}</p>}
    {error && <p role="alert" className="cloud-error">Could not load insights: {error}</p>}
    <div className="insight-stats four"><div><span>Matching sessions</span><strong>{totals.sessions}</strong></div><div><span>Camera time · all matches</span><strong>{duration(totals.camera_ms)}</strong></div><div><span>Break time · all matches</span><strong>{duration(totals.break_ms)}</strong></div><div><span>Sustained events · all matches</span><strong>{eventTotal(totals)}</strong></div></div>
    {!!reportRows.length && <section className="cloud-panel"><div className="cloud-section-title"><h2>Daily summaries</h2><span className="muted">Whole date range · CSV includes every row</span></div><div className="table-scroll"><table><thead><tr><th>Session start date</th>{admin && <th>Staff</th>}<th>Sessions</th><th>Camera time</th><th>Breaks</th><th>Screen-facing</th><th>Uncertain</th><th>Events</th></tr></thead><tbody>{reportRows.slice(reportPage * 10, reportPage * 10 + 10).map((row) => <tr key={`${row.day}-${row.user_id}`}><td>{row.day}</td>{admin && <td>{row.full_name}</td>}<td>{row.sessions}</td><td>{duration(row.camera_ms)}</td><td>{duration(row.break_ms)}</td><td>{duration(row.on_screen_ms)}</td><td>{duration(row.unknown_ms)}</td><td>{eventTotal(row)}</td></tr>)}</tbody></table></div>{reportRows.length > 10 && <div className="pagination"><button disabled={!reportPage} onClick={() => setReportPage(reportPage - 1)}>Previous summaries</button><span>Page {reportPage + 1} of {Math.ceil(reportRows.length / 10)}</span><button disabled={(reportPage + 1) * 10 >= reportRows.length} onClick={() => setReportPage(reportPage + 1)}>Next summaries</button></div>}</section>}
    <section className="cloud-panel"><div className="cloud-section-title"><h2>Session history</h2><span className="muted">Refreshes every 30 seconds · local time</span></div>
      {loading && <p role="status">Loading sessions…</p>}
      {!loading && !error && !rows.length && <p className="empty-state">No sessions yet. Recorded camera sessions will appear here after syncing.</p>}
      {!!rows.length && <div className="table-scroll"><table><thead><tr>{admin && <th>Staff</th>}<th>Started</th><th>Camera time</th><th>Break time</th><th>Status</th><th>Eyes closed</th><th>Looking away</th><th>No face</th><th>Details</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}>{admin && <td>{row.profiles?.full_name || 'Staff'}</td>}<td>{dateTime(row.started_at)}</td><td>{duration(row.duration_ms - (row.break_ms || 0))}</td><td>{duration(row.break_ms)}</td><td><span className="status-pill">{sessionStatus(row)}</span></td>{EVENT_KINDS.map((kind) => <td key={kind}>{row.event_counts[kind] || 0}</td>)}<td><button aria-label={`View session ${dateTime(row.started_at)}`} onClick={() => setSelected(row)}>View</button></td></tr>)}
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
  const [breaks, setBreaks] = useState([])
  const [breakCount, setBreakCount] = useState(0)
  const [breakPage, setBreakPage] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('detection_events').select('*', { count: 'exact' }).eq('session_id', session.id).order('started_at').order('id').range(page * 100, page * 100 + 99).abortSignal(AbortSignal.timeout(15000)),
      supabase.from('session_breaks').select('*', { count: 'exact' }).eq('session_id', session.id).order('started_at').order('id').range(breakPage * 100, breakPage * 100 + 99).abortSignal(AbortSignal.timeout(15000)),
    ]).then(([events, pauses]) => {
      if (cancelled) return
      if (events.error || pauses.error) throw events.error || pauses.error
      setError('')
      setEvents(events.data); setCount(events.count)
      setBreaks(pauses.data); setBreakCount(pauses.count)
    }).catch((cause) => { if (!cancelled) setError(cause.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session.id, session.revision, page, breakPage])
  return <section className="cloud-panel session-detail" aria-label="Session details">
    <div className="cloud-section-title"><h2>Session details</h2><button onClick={onClose}>Close details</button></div>
    <p className="muted">{dateTime(session.started_at)} → {session.ended_at ? dateTime(session.ended_at) : 'No confirmed end'} · {session.device} · {sessionStatus(session)}</p>
    <p className="muted">Last device observation: {dateTime(session.last_seen_at)} · Server sync: {dateTime(session.synced_at)}</p>
    <div className="session-policy"><strong>Alert timings used in this session</strong>{Object.entries(ALERT_NAMES).map(([key, label]) => <span key={key}>{label}: {normalizeThresholds(session.thresholds)[key] / 1000}s</span>)}</div>
    <h3>Observation coverage</h3><div className="coverage-grid">{COVERAGE_STATES.map((kind) => <div key={kind}><span>{STATE_LABELS[kind]}</span><strong>{duration(session.totals[kind])}</strong></div>)}</div>
    <p className="muted">Coverage includes brief conditions below this session’s configured alert thresholds. Uncertain time includes loading, missing frames, and inference interruptions. Break time is separate from coverage.</p>
    <h3>Event timeline</h3><p className="muted">One event per sustained condition per alarm episode. Observed duration excludes uncertain gaps, even when the alarm remains active.</p>
    {error && <p role="alert" className="cloud-error">{error}</p>}
    {loading && <p role="status">Loading session details…</p>}
    {!loading && !error && !events.length && <p className="empty-state">No sustained detection events in this session.</p>}
    {!!events.length && <div className="table-scroll"><table><thead><tr><th>Condition</th><th>Started</th><th>Episode ended</th><th>Observed duration</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{STATE_LABELS[event.kind]}</td><td>{dateTime(event.started_at)}</td><td>{event.ended_at ? dateTime(event.ended_at) : 'Ongoing episode'}</td><td>{duration(event.observed_ms)}</td></tr>)}</tbody></table></div>}
    {count > 100 && <div className="pagination"><button disabled={!page} onClick={() => setPage(page - 1)}>Previous events</button><span>Page {page + 1}</span><button disabled={(page + 1) * 100 >= count} onClick={() => setPage(page + 1)}>Next events</button></div>}
    <h3>Recorded breaks · {duration(session.break_ms)}</h3>
    {!loading && !error && !breaks.length && <p className="muted">No recorded breaks in this session.</p>}
    {!!breaks.length && <div className="table-scroll"><table><thead><tr><th>Reason</th><th>Started</th><th>Ended</th><th>Duration</th><th>Note</th></tr></thead><tbody>{breaks.map((entry) => <tr key={entry.id}><td>{entry.reason}</td><td>{dateTime(entry.started_at)}</td><td>{entry.ended_at ? dateTime(entry.ended_at) : sessionStatus(session) === 'Connection unknown' ? 'No confirmed end' : 'On break'}</td><td>{duration(entry.duration_ms)}</td><td>{entry.note || '—'}</td></tr>)}</tbody></table></div>}
    {breakCount > 100 && <div className="pagination"><button disabled={!breakPage} onClick={() => setBreakPage(breakPage - 1)}>Previous breaks</button><span>Page {breakPage + 1}</span><button disabled={(breakPage + 1) * 100 >= breakCount} onClick={() => setBreakPage(breakPage + 1)}>Next breaks</button></div>}
  </section>
}
