import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { normalizeThresholds, validThresholds } from '../lib/settings.js'

export function useStaffSettings(userId, enabled = true) {
  const [thresholds, setThresholds] = useState(() => normalizeThresholds())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(false)
  const key = `focuswatch.settings.v1.${userId}`
  useEffect(() => {
    if (!enabled) return
    mounted.current = true
    let cancelled = false
    setReady(false)
    async function load() {
      try {
        const { data, error } = await supabase.from('staff_settings').select('thresholds').eq('user_id', userId).maybeSingle().abortSignal(AbortSignal.timeout(15000))
        if (error) throw error
        if (cancelled) return
        const next = normalizeThresholds(data?.thresholds)
        setThresholds(next)
        setReady(true)
        setError('')
        try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Cloud settings remain usable. */ }
      } catch (cause) {
        if (cancelled) return
        let cached
        try { cached = JSON.parse(localStorage.getItem(key)) } catch { /* No usable cache. */ }
        if (validThresholds(cached)) { setThresholds(cached); setReady(true) }
        setError(validThresholds(cached) ? 'Using your last saved alert timings on this device. Reconnect to check for updates.' : `Cannot load your alert timings: ${cause.message}. Retry before starting a session.`)
      }
    }
    void load()
    return () => { cancelled = true; mounted.current = false }
  }, [userId, key, enabled, attempt])

  const save = useCallback(async (next) => {
    if (!validThresholds(next)) throw new Error('Use whole seconds from 1 to 60 for each alert.')
    setSaving(true)
    try {
      const { error } = await supabase.rpc('update_my_alert_settings', { alert_thresholds: next }).abortSignal(AbortSignal.timeout(15000))
      if (error) throw error
      if (!mounted.current) return
      setThresholds({ ...next })
      setReady(true)
      setError('')
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Keep the confirmed cloud value. */ }
    } finally { if (mounted.current) setSaving(false) }
  }, [key])
  return { thresholds, ready, error, saving, save, retry: () => setAttempt((value) => value + 1) }
}
