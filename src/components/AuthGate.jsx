import { useEffect, useState } from 'react'
import { Focus, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { finishBrowserGoogleSignIn, startGoogleSignIn } from '../lib/googleSignIn.js'

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [request, setRequest] = useState(null)
  const [googleBusy, setGoogleBusy] = useState(() => !window.focuswatchDesktop && new URL(window.location.href).searchParams.has('code'))

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    // The auth event callback does not await another Supabase call (auth lock).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) { setProfile(null); setRequest(null); setLoading(false) }
    })
    let cancelled = false
    finishBrowserGoogleSignIn().catch((cause) => { if (!cancelled) setError(`Google sign-in failed: ${cause.message}`) }).finally(() => { if (!cancelled) setGoogleBusy(false) })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  const userId = session?.user.id
  const googleIdentity = session?.user.app_metadata?.providers?.includes('google') || session?.user.identities?.some((identity) => identity.provider === 'google') || false
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setRequest(null)
    let running = false
    async function load() {
      if (running) return
      running = true
      try {
        const { data, error: problem } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
        if (problem) throw problem
        if (cancelled) return
        // Keep a previously verified profile on transient network failure. A
        // successful disabled/missing result immediately removes app access.
        setProfile(data?.active ? data : null)
        if (data) {
          setRequest(null)
          setError(data.active ? '' : 'Your team account is disabled. Contact your admin.')
        } else if (googleIdentity) {
          const { data: application, error: applicationError } = await supabase.rpc('request_staff_access')
          if (applicationError) throw applicationError
          if (cancelled) return
          setRequest(application)
          setError('')
        } else {
          setError('Your team account is not provisioned. Staff can request access using Continue with Google, or contact the admin.')
        }
      } catch (cause) {
        if (!cancelled) setError(`Account access unavailable: ${cause.message}. If setup is incomplete, see supabase/GOOGLE_SETUP.md.`)
      } finally {
        running = false
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Pending users enter the workspace automatically after the admin approves.
    const timer = window.setInterval(load, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [userId, googleIdentity, attempt])

  async function login(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { error: problem } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (problem) setError(problem.message)
      else setPassword('')
    } catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }

  async function signOut() {
    try {
      const { error: problem } = await supabase.auth.signOut({ scope: 'local' })
      if (problem) throw problem
      setError('')
      return null
    } catch (cause) {
      setError(cause.message || 'Sign-out failed. Please try again.')
      return cause
    }
  }

  async function googleLogin() {
    setGoogleBusy(true)
    setError('')
    try { await startGoogleSignIn() }
    catch (cause) { setError(`Google sign-in failed: ${cause.message}`) }
    finally { setGoogleBusy(false) }
  }

  const pending = request?.status === 'pending'
  const rejected = request?.status === 'rejected'

  if (profile && profile.id === userId && session) return children({ profile, signOut })
  return <div className="auth-page"><section className="auth-card">
    <span className="brand-icon"><Focus size={26} /></span>
    <p className="eyebrow">FOCUSWATCH AI · TEAM WORKSPACE</p>
    <h1>{loading ? 'Opening your workspace…' : pending ? 'Pending admin approval' : rejected ? 'Request not approved' : session ? 'Account setup' : 'Welcome back.'}</h1>
    <p className="muted">{pending ? 'Your verified Gmail registration has been sent to the admin. Monitoring becomes available after approval. This page checks for updates every 30 seconds.' : rejected ? 'The admin declined your registration request. Contact your admin if you believe this was a mistake.' : 'Staff: continue with Google to request access or sign in. Existing assigned accounts can also use email and password.'}</p>
    {request && <div className="registration-status"><strong>{request.full_name}</strong><span>{request.email}</span><span className="status-pill">{request.status}</span></div>}
    {!supabase && <p role="alert">Supabase is not configured. Copy .env.example to .env.local, fill in the project URL and publishable key, then restart the app.</p>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
    {!loading && !session && supabase && <>
      <button className="google-signin" onClick={googleLogin} disabled={googleBusy || busy}><GoogleIcon />{googleBusy ? 'Waiting for Google…' : 'Continue with Google'}</button>
      <p className="auth-google-note">Verified @gmail.com accounts · Admin approval required for new staff</p>
      {googleBusy && window.focuswatchDesktop && <div className="google-wait" role="status"><p>Complete sign-in in your browser, then return here.</p><button className="text-button" onClick={() => window.focuswatchDesktop.cancelGoogleSignIn().catch((cause) => setError(cause.message))}>Cancel Google sign-in</button></div>}
      <div className="auth-divider">or use your assigned account</div>
      <form onSubmit={login} className="cloud-form">
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="cloud-primary" disabled={busy || googleBusy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form></>}
    {!loading && session && <div className="cloud-actions"><button onClick={() => setAttempt((value) => value + 1)}>{request ? 'Check approval status' : 'Retry account setup'}</button><button onClick={signOut}>Sign out</button></div>}
    <div className="auth-foot"><ShieldCheck size={16} /> Private team · Staff & admin access</div>
  </section></div>
}

function GoogleIcon() {
  return <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4.1 6v5h6.6c3.8-3.5 6.1-8.6 6.1-14.7Z" /><path fill="#34A853" d="M24 44c5.4 0 9.9-1.8 13.2-4.8l-6.6-5c-1.8 1.2-4 1.9-6.6 1.9-5.2 0-9.7-3.5-11.3-8.2H5.9v5.2A20 20 0 0 0 24 44Z" /><path fill="#FBBC05" d="M12.7 27.9a12 12 0 0 1 0-7.8v-5.2H5.9a20 20 0 0 0 0 18.2l6.8-5.2Z" /><path fill="#EA4335" d="M24 11.9c2.9 0 5.4 1 7.4 2.9l5.6-5.6A19 19 0 0 0 24 4 20 20 0 0 0 5.9 14.9l6.8 5.2A12 12 0 0 1 24 11.9Z" /></svg>
}
