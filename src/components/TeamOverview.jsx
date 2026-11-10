import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { datePreset, eventTotal, localTimezone, reportArguments, reportTotals, teamStatus } from '../lib/reporting.js'
import { dateTime, duration } from './SessionInsights.jsx'

export default function TeamOverview() {
  const [members, setMembers] = useState([])
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    let running = false
    async function load() {
      setNow(Date.now())
      if (running) return
      running = true
      try {
        const { from, to } = datePreset(1)
        const [team, report] = await Promise.all([
          supabase.from('profiles').select('id,full_name,active,sessions(id,status,activity,started_at,last_seen_at,synced_at)').eq('role', 'staff').order('full_name').order('started_at', { referencedTable: 'sessions', ascending: false }).limit(1, { referencedTable: 'sessions' }).abortSignal(AbortSignal.timeout(12000)),
          supabase.rpc('session_report', reportArguments(from, to)).abortSignal(AbortSignal.timeout(12000)),
        ])
        if (team.error || report.error) throw team.error || report.error
        if (!cancelled) { setMembers(team.data); setRows(report.data.rows); setUpdated(Date.now()); setError('') }
      } catch (cause) { if (!cancelled) setError(cause.message) }
      finally { running = false }
    }
    void load()
    const timer = window.setInterval(load, 15000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refresh])
  const totals = reportTotals(rows)
  const count = (status) => members.filter((member) => teamStatus(member, now) === status).length
  return <main className="team-main">
    <div className="team-page-heading"><p className="eyebrow">TEAM OVERVIEW</p><h1>Your team, in view.</h1><p>Recent monitoring status and today’s results. Each staff member chooses their own alert timings.</p></div>
    <section className="cloud-panel cloud-section-title"><div><strong>Today · {localTimezone()}</strong><p className="muted">Last successful update: {updated ? dateTime(updated) : 'Loading…'} · Refreshes every 15 seconds</p></div><button onClick={() => setRefresh((value) => value + 1)}>Refresh overview</button></section>
    {error && <p className="cloud-error" role="alert">Could not refresh the team: {error}. {updated ? 'Showing the last successful results.' : 'Try refreshing.'}</p>}
    <div className="insight-stats four"><div><span>Monitoring</span><strong>{count('Monitoring')}</strong></div><div><span>On break</span><strong>{count('On break')}</strong></div><div><span>Connection unknown</span><strong>{count('Connection unknown')}</strong></div><div><span>Camera time · today’s sessions</span><strong>{duration(totals.camera_ms)}</strong></div></div>
    <section className="cloud-panel"><h2>Staff activity</h2><p className="muted report-note">Status is based on the latest synced session. After 60 seconds without a sync, an active session becomes connection unknown. Today’s totals include sessions that started today, including their full durations.</p>
      {!updated && !error && <p role="status">Loading team overview…</p>}
      {updated && !members.length && <p className="empty-state">No staff yet. Approve applicants in Registration requests.</p>}
      {!!members.length && <div className="table-scroll"><table><thead><tr><th>Staff</th><th>Status</th><th>Last device observation</th><th>Last server sync</th><th>Sessions today</th><th>Camera time</th><th>Break time</th><th>Events</th></tr></thead><tbody>{members.map((member) => {
        const summary = reportTotals(rows.filter((row) => row.user_id === member.id))
        const latest = member.sessions?.[0]
        return <tr key={member.id}><td>{member.full_name}</td><td><span className={`status-pill status-${teamStatus(member, now).toLowerCase().replaceAll(' ', '-')}`}>{teamStatus(member, now)}</span></td><td>{dateTime(latest?.last_seen_at)}</td><td>{dateTime(latest?.synced_at)}</td><td>{summary.sessions}</td><td>{duration(summary.camera_ms)}</td><td>{duration(summary.break_ms)}</td><td>{eventTotal(summary)}</td></tr>
      })}</tbody></table></div>}
    </section>
  </main>
}
