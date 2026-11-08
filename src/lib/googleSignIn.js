import { supabase } from './supabase.js'

let exchangePromise

// One exchange per page load, including React StrictMode's double effect mount.
export function finishBrowserGoogleSignIn() {
  if (window.focuswatchDesktop || !supabase) return Promise.resolve()
  if (exchangePromise) return exchangePromise
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error') || new URLSearchParams(url.hash.slice(1)).get('error')
  if (!code && !error) return Promise.resolve()
  exchangePromise = (async () => {
    try {
      if (error) throw new Error('Google sign-in was cancelled or denied. Please try again.')
      const { error: problem } = await supabase.auth.exchangeCodeForSession(code)
      if (problem) throw problem
    } finally {
      for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key)
      if (error) url.hash = ''
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  })()
  return exchangePromise
}

export async function startGoogleSignIn() {
  const desktop = window.focuswatchDesktop
  let started = false
  try {
    const redirectTo = desktop ? await desktop.beginGoogleSignIn() : `${window.location.origin}${import.meta.env.BASE_URL}`
    started = Boolean(desktop)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    })
    if (error) throw error
    if (!data.url) throw new Error('Google sign-in is not configured. Ask your admin to enable the Google provider in Supabase.')
    if (!desktop) { window.location.assign(data.url); return }
    await desktop.openGoogleSignIn(data.url)
    const outcome = await desktop.waitForGoogleSignIn()
    if (outcome.error) throw new Error(outcome.error)
    const { error: problem } = await supabase.auth.exchangeCodeForSession(outcome.code)
    if (problem) throw problem
  } catch (error) {
    if (started) await desktop.cancelGoogleSignIn().catch(() => {})
    throw error
  }
}
