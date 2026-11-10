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
        const { data, error } = await supabase.from('profiles').select('*, sessions(started_at,last_seen_at,synced_at,status,activity)').eq('role', 'staff').order('full_name').order('started_at', { referencedTable: 'sessions', ascending: false }).limit(1, { referencedTable: 'sessions' })
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
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const latest = member.sessions?.[0]
  const name = draft?.name ?? member.full_name
  const active = draft?.active ?? member.active
  const conflict = draft && (draft.originalName !== member.full_name || draft.originalActive !== member.active)

  function edit(changes) {
    setMessage('')
    setDraft((previous) => {
      const next = { ...(previous || { name: member.full_name, active: member.active, originalName: member.full_name, originalActive: member.active }), ...changes }
      return next.name === next.originalName && next.active === next.originalActive ? null : next
    })
  }

  async function save(event) {
    event.preventDefault()
    if (busy || conflict) return
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.rpc('update_staff', {
        staff_id: member.id, display_name: name.trim(), enabled: active,
        expected_display_name: draft?.originalName ?? member.full_name,
        expected_enabled: draft?.originalActive ?? member.active,
      })
      if (error) throw error
      setDraft(null)
      setMessage('Staff account updated.')
      onSaved()
    } catch (cause) {
      setMessage(cause.message)
      if (cause.code === '40001') onSaved()
    }
    finally { setBusy(false) }
  }
  return <section className="cloud-panel"><h2>{member.full_name}</h2><p className="muted">{member.email}</p><span className="status-pill">{!member.active ? 'Disabled' : latest ? sessionStatus(latest) : 'No sessions'}</span><p className="muted">Last seen: {dateTime(latest?.last_seen_at)}</p>
    <form className="cloud-form" onSubmit={save}><label>Display name<input value={name} required maxLength={100} disabled={busy} onChange={(event) => edit({ name: event.target.value })} /></label><label className="check-label"><input type="checkbox" checked={active} disabled={busy} onChange={(event) => edit({ active: event.target.checked })} />Account enabled</label>
      {conflict && <p role="alert">This staff account changed while you were editing. Load the latest details before saving. <button type="button" disabled={busy} onClick={() => { setDraft(null); setMessage('') }}>Load latest details</button></p>}
      <button disabled={busy || Boolean(conflict)}>{busy ? 'Saving…' : 'Save staff account'}</button>{message && <p role="status">{message}</p>}</form>
  </section>
}
