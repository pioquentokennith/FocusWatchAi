import { useState } from 'react'
import { Focus, LogOut } from 'lucide-react'
import App from '../App.jsx'
import { useSessionRecorder } from '../hooks/useSessionRecorder.js'
import { supabase } from '../lib/supabase.js'
import SessionInsights from './SessionInsights.jsx'
import TeamMembers from './TeamMembers.jsx'
import RegistrationRequests from './RegistrationRequests.jsx'
import AlertSettings from './AlertSettings.jsx'
import TeamOverview from './TeamOverview.jsx'
import { useStaffSettings } from '../hooks/useStaffSettings.js'

export default function TeamWorkspace({ profile, signOut }) {
  const admin = profile.role === 'admin'
  const [tab, setTab] = useState(admin ? 'overview' : 'monitor')
  const [leaving, setLeaving] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const recorder = useSessionRecorder(profile.id)
  const settings = useStaffSettings(profile.id, !admin)

  async function logout() {
    setLeaving(true)
    setLogoutError('')
    // Persist before unmount/sign-out; a slow network must not hold the camera open.
    void recorder.finish()
    try {
      const problem = await signOut()
      if (problem) throw problem
    } catch (cause) {
      setLogoutError(`Could not sign out: ${cause.message || 'Connection unavailable'}. Please try again.`)
    } finally { setLeaving(false) }
  }

  const tabs = [...(admin ? [['overview', 'Overview']] : [['monitor', 'Monitor'], ['settings', 'Alert settings']]), ['insights', admin ? 'Team insights' : 'My insights'], ...(admin ? [['requests', 'Registration requests'], ['team', 'Team']] : []), ['account', 'Account']]
  return <div className="team-workspace">
    <header className="team-header"><div className="team-brand"><Focus size={25} /><strong>FocusWatch<span>AI</span></strong></div>
      <nav aria-label="Team navigation">{tabs.map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <div className="team-identity"><span>{profile.full_name}<small>{profile.role}</small></span><button onClick={logout} disabled={leaving} aria-label="Sign out"><LogOut size={17} /></button></div>
    </header>
    {logoutError && <p className="cloud-error" role="alert">{logoutError}</p>}
    {!admin && <div className={`sync-banner ${recorder.sync.error ? 'sync-warning' : ''}`} role="status">
      <span>{recorder.sync.error || (recorder.sync.pending ? `${recorder.sync.pending} session(s) waiting to sync` : 'All sessions synced')} · Only session metadata is shared</span>
      <button onClick={recorder.retry}>Sync now</button>
    </div>}
    {!admin && !leaving && <div hidden={tab !== 'monitor'}><App recorder={recorder} profile={profile} settings={settings} /></div>}
    {!admin && recorder.session?.status === 'active' && tab !== 'monitor' && <div className="active-session-banner" role="status">{recorder.session.activity === 'paused' ? `On break · ${recorder.session.currentBreak.reason} · Camera off` : 'Your camera session is still monitoring.'}<button onClick={() => setTab('monitor')}>Return to session</button></div>}
    {tab === 'overview' && admin && <TeamOverview />}
    {tab === 'settings' && !admin && <AlertSettings settings={settings} session={recorder.session} />}
    {tab === 'insights' && <SessionInsights profile={profile} />}
    {tab === 'team' && admin && <TeamMembers />}
    {tab === 'requests' && admin && <RegistrationRequests />}
    {tab === 'account' && <Account profile={profile} />}
  </div>
}

function Account({ profile }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function change(event) {
    event.preventDefault()
    if (password !== confirm) { setMessage('Passwords do not match.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      setMessage(error ? error.message : 'Password updated.')
      if (!error) { setPassword(''); setConfirm('') }
    } catch (cause) { setMessage(cause.message) }
    finally { setBusy(false) }
  }
  return <main className="team-main"><div className="team-page-heading"><p className="eyebrow">YOUR ACCOUNT</p><h1>{profile.full_name}</h1><p>{profile.email} · {profile.role}</p></div>
    <section className="cloud-panel account-panel"><h2>Change password</h2><form className="cloud-form" onSubmit={change}>
      <label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <p className="muted">Use at least 12 characters.</p><button className="cloud-primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      {message && <p role="status">{message}</p>}
    </form></section>
  </main>
}
