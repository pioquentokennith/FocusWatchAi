import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { createSessionLedger, createSessionOutbox } from '../lib/sessionRecorder.js'

export function useSessionRecorder(userId) {
  const ledger = useRef(null)
  const outbox = useRef(null)
  const [sync, setSync] = useState({ pending: 0, error: '' })
  const [ready, setReady] = useState(false)

  const checkpoint = useCallback(() => {
    if (ledger.current) outbox.current?.put(ledger.current.snapshot())
  }, [])
  const finish = useCallback((status = 'completed') => {
    if (ledger.current) {
      outbox.current?.put(ledger.current.snapshot(performance.now(), status))
      ledger.current = null
    }
    return outbox.current?.flush()
  }, [])
  const start = useCallback(() => {
    if (ledger.current || !outbox.current) return
    ledger.current = createSessionLedger({ device: window.focuswatchDesktop ? 'desktop' : 'browser' })
    checkpoint()
    void outbox.current.flush()
  }, [checkpoint])
  const observe = useCallback((detection, time) => ledger.current?.observe(detection, time), [])
  const retry = useCallback(() => outbox.current?.flush(), [])

  useEffect(() => {
    let mounted = true
    let releaseLock
    let saveTimer
    let syncTimer
    const controller = new AbortController()
    setReady(false)
    function initialize() {
      if (!mounted) return
      try {
        outbox.current = createSessionOutbox(userId, {
          send: async (snapshot) => {
            // The owner is verified again by SQL, even if accounts change while
            // this request is waiting on token refresh or the network.
            const { error } = await supabase.rpc('save_session', { snapshot: { ...snapshot, user_id: userId } }).abortSignal(AbortSignal.timeout(15000))
            if (error) throw error
          },
          onChange: (next) => { if (mounted) setSync(next) },
        })
        setReady(true)
      } catch {
        setSync({ pending: 0, error: 'Local session storage is unavailable or damaged. Monitoring cannot be recorded on this device.' })
        return
      }
      void retry()
      saveTimer = window.setInterval(checkpoint, 5000)
      syncTimer = window.setInterval(retry, 15000)
    }
    // A second tab must not recover/overwrite the first tab's live outbox.
    if (navigator.locks) {
      setSync({ pending: 0, error: 'Opening local recording storage. If another FocusWatchAI window is open for this account, close it to continue here.' })
      navigator.locks.request(`focuswatch.recorder.${userId}`, { signal: controller.signal }, async () => {
        if (!mounted) return
        initialize()
        await new Promise((resolve) => { releaseLock = resolve })
      }).catch((cause) => { if (mounted) setSync({ pending: 0, error: cause.message }) })
    } else initialize()
    const interrupted = () => { void finish('interrupted') }
    window.addEventListener('online', retry)
    window.addEventListener('pagehide', interrupted)
    window.addEventListener('beforeunload', interrupted)
    return () => {
      mounted = false
      window.clearInterval(saveTimer)
      window.clearInterval(syncTimer)
      window.removeEventListener('online', retry)
      window.removeEventListener('pagehide', interrupted)
      window.removeEventListener('beforeunload', interrupted)
      const pending = finish('interrupted')
      outbox.current = null
      controller.abort()
      Promise.resolve(pending).finally(() => releaseLock?.())
    }
  }, [userId, checkpoint, finish, retry])

  return { start, finish, observe, retry, sync, ready }
}
