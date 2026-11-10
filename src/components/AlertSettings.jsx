import { useState } from 'react'
import { ALERT_NAMES, DEFAULT_THRESHOLDS } from '../lib/settings.js'

export default function AlertSettings({ settings, session }) {
  const [draft, setDraft] = useState(null)
  const [message, setMessage] = useState('')
  const values = draft || Object.fromEntries(Object.entries(settings.thresholds).map(([key, ms]) => [key, ms / 1000]))
  async function save(event) {
    event.preventDefault()
    setMessage('')
    try {
      const next = Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map((key) => [key, Number(values[key]) * 1000]))
      await settings.save(next)
      setDraft(null)
      setMessage('Alert timings saved. They will apply to your next new session.')
    } catch (cause) { setMessage(cause.message) }
  }
  return <main className="team-main">
    <div className="team-page-heading"><p className="eyebrow">PERSONAL SETTINGS</p><h1>Your alert timings.</h1><p>Choose how long each condition must continue before your alarm starts. Your admin can see the timings used in your session results.</p></div>
    <section className="cloud-panel account-panel"><h2>Seconds before an alert</h2>
      <p className="muted">Use whole seconds from 1 to 60. A brief blink or glance below the threshold does not start an alarm. Stable screen-facing recovery still takes one second.</p>
      {settings.error && <p className="cloud-error" role="alert">{settings.error} <button onClick={settings.retry}>Retry settings</button></p>}
      {!settings.ready && <p role="status">Loading your saved settings…</p>}
      <form className="cloud-form" onSubmit={save}>
        {Object.entries(ALERT_NAMES).map(([key, label]) => <label key={key}>{label} (seconds)<input type="number" min="1" max="60" step="1" required disabled={!settings.ready || settings.saving} value={values[key]} onChange={(event) => { setDraft({ ...values, [key]: event.target.value }); setMessage('') }} /></label>)}
        <button className="cloud-primary" disabled={!settings.ready || settings.saving}>{settings.saving ? 'Saving…' : 'Save alert timings'}</button>
        {message && <p role="status">{message}</p>}
      </form>
      {session?.status === 'active' && <div className="session-policy"><strong>Current session settings stay fixed, including after a break.</strong>{Object.entries(ALERT_NAMES).map(([key, label]) => <span key={key}>{label}: {session.thresholds[key] / 1000}s</span>)}</div>}
    </section>
  </main>
}
