import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { dateTime, sessionStatus } from './SessionInsights.jsx'

export default function TeamMembers() {
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data, error } = await supabase.from('profiles').select('*, sessions(started_at,last_seen_at,status)').eq('role', 'staff').order('full_name').order('started_at', { referencedTable: 'sessions', ascending: false }).limit(1, { referencedTable: 'sessions' })
        if (error) throw error
        if (!cancelled) { setMembers(data); setError('') }
      } catch (cause) { if (!cancelled) setError(cause.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    const timer = window.setInterval(load, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refresh])
  return <main className="team-main"><div className="team-page-heading"><p className="eyebrow">ONE TEAM · TEN STAFF</p><h1>Team members.</h1><p>{members.length} of 10 staff accounts provisioned. Approve Google applicants from Registration requests.</p></div>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    {loading && <p role="status">Loading team…</p>}
    {!loading && !members.length && !error && <section className="cloud-panel empty-state">No approved staff yet. Staff can use Continue with Google to request access. Review their applications under Registration requests.</section>}
    <div className="member-grid">{members.map((member) => <Member key={member.id} member={member} onSaved={() => setRefresh((value) => value + 1)} />)}</div>
  </main>
}

function Member({ member, onSaved }) {
  const [name, setName] = useState(member.full_name)
  const [active, setActive] = useState(member.active)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const latest = member.sessions?.[0]
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const { error } = await supabase.rpc('update_staff', { staff_id: member.id, display_name: name.trim(), enabled: active })
      if (error) throw error
      setMessage('Staff account updated.')
      onSaved()
    } catch (cause) { setMessage(cause.message) }
    finally { setBusy(false) }
  }
  return <section className="cloud-panel"><h2>{member.full_name}</h2><p className="muted">{member.email}</p><span className="status-pill">{!member.active ? 'Disabled' : latest ? sessionStatus(latest) : 'No sessions'}</span><p className="muted">Last seen: {dateTime(latest?.last_seen_at)}</p>
    <form className="cloud-form" onSubmit={save}><label>Display name<input value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} /></label><label className="check-label"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Account enabled</label><button disabled={busy}>{busy ? 'Saving…' : 'Save staff account'}</button>{message && <p role="status">{message}</p>}</form>
  </section>
}
