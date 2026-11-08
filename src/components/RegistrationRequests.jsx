import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { dateTime } from './SessionInsights.jsx'

const PAGE_SIZE = 20

export default function RegistrationRequests() {
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(0)
  const [requests, setRequests] = useState([])
  const [count, setCount] = useState(0)
  const [staffCount, setStaffCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [queue, team] = await Promise.all([
          supabase.from('registration_requests').select('*', { count: 'exact' }).eq('status', status).order('requested_at').order('user_id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'staff'),
        ])
        if (queue.error) throw queue.error
        if (team.error) throw team.error
        if (queue.count === null || team.count === null) throw new Error('Could not read registration totals. Refresh requests to try again.')
        if (!cancelled) { setRequests(queue.data); setCount(queue.count); setStaffCount(team.count); setError('') }
      } catch (cause) { if (!cancelled) setError(cause.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    setLoading(true)
    load()
    const timer = window.setInterval(load, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [status, page, refresh])

  async function review(request, decision) {
    setBusy(request.user_id)
    setError('')
    setMessage('')
    try {
      const { error } = await supabase.rpc('review_staff_request', { request_id: request.user_id, decision })
      if (error) throw error
      setMessage(`${request.full_name}: ${decision === 'approved' ? 'approved as staff' : 'request rejected'}.`)
      setPage(0)
      setRefresh((value) => value + 1)
    } catch (cause) { setError(cause.message) }
    finally { setBusy(null) }
  }

  return <main className="team-main">
    <div className="team-page-heading"><p className="eyebrow">GOOGLE REGISTRATION</p><h1>Registration requests.</h1><p>{staffCount} of 10 staff slots occupied. Pending and rejected requests do not use a slot. Disabled staff keep their slot and historical records.</p></div>
    <section className="cloud-panel filters"><label>Request status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); setMessage('') }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><button onClick={() => setRefresh((value) => value + 1)}>Refresh requests</button><span className="muted">Checks every 30 seconds</span></section>
    {error && <p role="alert" className="cloud-error">{error}</p>}
    {message && <p role="status" className="review-success">{message}</p>}
    {staffCount >= 10 && status === 'pending' && <p className="muted">All staff slots are occupied. New requests can remain pending; the database will prevent further approvals.</p>}
    <section className="cloud-panel"><div className="cloud-section-title"><h2>{status[0].toUpperCase() + status.slice(1)} requests</h2><span>{count} total</span></div>
      {loading && <p role="status">Loading requests…</p>}
      {!loading && !requests.length && !error && <p className="empty-state">No {status} registration requests.</p>}
      {!!requests.length && <div className="table-scroll"><table><thead><tr><th>Name</th><th>Verified Gmail</th><th>Requested</th><th>{status === 'pending' ? 'Review' : 'Reviewed'}</th></tr></thead><tbody>{requests.map((request) => <tr key={request.user_id}><td>{request.full_name}</td><td>{request.email}</td><td>{dateTime(request.requested_at)}</td><td>{status === 'pending' ? <div className="review-actions"><button disabled={Boolean(busy) || staffCount >= 10 || loading} onClick={() => review(request, 'approved')}>Approve</button><button disabled={Boolean(busy) || loading} onClick={() => review(request, 'rejected')}>Reject</button>{busy === request.user_id && <span>Saving…</span>}</div> : dateTime(request.reviewed_at)}</td></tr>)}</tbody></table></div>}
      <div className="pagination"><button disabled={!page || loading || Boolean(busy)} onClick={() => setPage(page - 1)}>Previous requests</button><span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span><button disabled={(page + 1) * PAGE_SIZE >= count || loading || Boolean(busy)} onClick={() => setPage(page + 1)}>Next requests</button></div>
    </section>
  </main>
}
