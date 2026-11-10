import { BREAK_REASONS, normalizeThresholds } from './settings.js'

export const COVERAGE_STATES = ['ON_SCREEN', 'EYES_CLOSED', 'LOOKING_AWAY', 'NO_FACE', 'CALIBRATING', 'UNKNOWN']
export const EVENT_KINDS = ['EYES_CLOSED', 'LOOKING_AWAY', 'NO_FACE']

// No frames, face geometry, or biometric baselines enter this ledger.
export function createSessionLedger({ device, thresholds: settings, wallTime = Date.now(), time = performance.now(), uuid = () => crypto.randomUUID() }) {
  const thresholds = normalizeThresholds(settings)
  const origin = Math.round(time)
  let cursor = origin
  let observationTime = null
  let state = 'UNKNOWN'
  let revision = 0
  let status = 'active'
  let activity = 'monitoring'
  let breakMs = 0
  let currentBreak = null
  const breaks = []
  const totals = Object.fromEntries(COVERAGE_STATES.map((kind) => [kind, 0]))
  const events = []
  const open = new Map()
  const id = uuid()
  const stamp = (at) => new Date(wallTime + at - origin).toISOString()

  function advance(time) {
    const at = Math.max(cursor, Math.round(time))
    const duration = at - cursor
    if (activity === 'paused') {
      breakMs += duration
      currentBreak.duration_ms += duration
      cursor = at
      return
    }
    const observed = observationTime !== null && at - observationTime <= 750
    const kind = observed ? state : 'UNKNOWN'
    totals[kind] += duration
    if (observed && open.has(kind)) open.get(kind).observed_ms += duration
    cursor = at
  }

  function closeEvents() {
    for (const event of open.values()) event.ended_at = stamp(cursor)
    open.clear()
  }

  return {
    summary(at = performance.now()) {
      const tail = status === 'active' ? Math.max(0, Math.round(at) - cursor) : 0
      const duration = cursor - origin + tail
      const pausedMs = breakMs + (activity === 'paused' ? tail : 0)
      return {
        id, status, activity, thresholds: { ...thresholds }, duration_ms: duration, break_ms: pausedMs, camera_ms: duration - pausedMs,
        break_count: breaks.length,
        currentBreak: currentBreak ? { ...currentBreak, duration_ms: currentBreak.duration_ms + tail } : null,
        counts: Object.fromEntries(EVENT_KINDS.map((kind) => [kind, events.filter((event) => event.kind === kind).length])),
      }
    },
    pause(reason, note = '', at = performance.now()) {
      if (status !== 'active' || activity !== 'monitoring') return false
      if (!BREAK_REASONS.includes(reason)) throw new Error('Select a break reason.')
      advance(at)
      closeEvents()
      observationTime = null
      state = 'UNKNOWN'
      activity = 'paused'
      currentBreak = { id: uuid(), reason, note: note.trim().slice(0, 250), started_at: stamp(cursor), ended_at: null, duration_ms: 0 }
      breaks.push(currentBreak)
      return true
    },
    resume(at = performance.now()) {
      if (status !== 'active' || activity !== 'paused') return false
      advance(at)
      currentBreak.ended_at = stamp(cursor)
      currentBreak = null
      activity = 'monitoring'
      observationTime = null
      state = 'UNKNOWN'
      return true
    },
    observe(detection, at = performance.now()) {
      if (status !== 'active' || activity !== 'monitoring') return
      advance(at)
      state = COVERAGE_STATES.includes(detection.state) ? detection.state : 'UNKNOWN'
      observationTime = cursor
      if (!detection.alarmActive) closeEvents()
      if (EVENT_KINDS.includes(detection.alert) && !open.has(detection.alert)) {
        const duration = Math.min(cursor - origin, Math.max(0, Math.round(detection.seconds * 1000)))
        const event = { id: uuid(), kind: detection.alert, started_at: stamp(cursor - duration), ended_at: null, observed_ms: duration }
        events.push(event)
        open.set(event.kind, event)
      }
    },
    snapshot(at = performance.now(), finalStatus) {
      if (status === 'active') {
        advance(at)
        if (finalStatus) {
          status = finalStatus
          closeEvents()
          if (currentBreak) { currentBreak.ended_at = stamp(cursor); currentBreak = null }
          activity = 'stopped'
        }
      }
      return {
        id, device, revision: ++revision, started_at: stamp(origin), last_seen_at: stamp(cursor),
        ended_at: status === 'active' ? null : stamp(cursor), status,
        duration_ms: cursor - origin, totals: { ...totals }, events: events.map((event) => ({ ...event })),
        activity, thresholds: { ...thresholds }, break_ms: breakMs, breaks: breaks.map((entry) => ({ ...entry })),
      }
    },
  }
}

export function recoverSnapshot(snapshot) {
  if (snapshot.status !== 'active') return snapshot
  return {
    ...snapshot, status: 'interrupted', ended_at: snapshot.last_seen_at, revision: snapshot.revision + 1,
    activity: 'stopped',
    breaks: (snapshot.breaks || []).map((entry) => ({ ...entry, ended_at: entry.ended_at || snapshot.last_seen_at })),
    events: snapshot.events.map((event) => ({ ...event, ended_at: event.ended_at || snapshot.last_seen_at })),
  }
}

function isRejectedSnapshot(cause) {
  // SQL data/constraint errors cannot be fixed by retrying the same payload.
  // P0001 is also used for access checks, so only classify known validation errors.
  const code = String(cause.code || '')
  return /^(22|23)/.test(code) || cause.status === 413 || (code === 'P0001' && [
    'Invalid session timing', 'Invalid coverage totals', 'Coverage must equal session duration',
    'Events must be an array', 'Invalid event timing', 'Session belongs to another staff member',
  ].includes(cause.message))
}

export function createSessionOutbox(userId, { storage = localStorage, send, onChange = () => {} }) {
  const key = `focuswatch.outbox.v1.${userId}`
  let entries = JSON.parse(storage.getItem(key) || '{}')
  for (const entry of Object.values(entries)) {
    if (entry.snapshot.status === 'active') {
      entry.snapshot = recoverSnapshot(entry.snapshot)
      entry.pending = true
      delete entry.rejection
    }
  }
  let flight = null
  let manualRetry = null
  let storageError = ''
  let syncError = ''
  function report() {
    const pending = Object.values(entries).filter((entry) => entry.pending)
    const rejected = pending.filter((entry) => entry.rejection)
    const rejectedMessage = rejected.length ? `${rejected.length} session(s) rejected by the server and kept on this device. ${rejected[0].rejection.message}. Other valid sessions can still sync. Select Sync now to retry rejected records.` : ''
    onChange({ pending: pending.length, rejected: rejected.length, error: storageError || [syncError, rejectedMessage].filter(Boolean).join(' ') })
  }
  function persist() {
    try { storage.setItem(key, JSON.stringify(entries)); storageError = '' }
    catch { storageError = 'Cannot save the local sync queue. Keep this app open and restore local storage space.' }
    report()
  }
  persist()
  function flush({ retryRejected = false } = {}) {
    if (flight) {
      if (!retryRejected) return manualRetry || flight
      // A manual retry must also reach records skipped by an in-flight auto sync.
      manualRetry ??= flight.then(() => {
        manualRetry = null
        return flush({ retryRejected: true })
      })
      return manualRetry
    }
    flight = (async () => {
      for (const entry of Object.values(entries).filter((entry) => entry.pending && (retryRejected || !entry.rejection))) {
        const snapshot = entry.snapshot
        try {
          await send(snapshot)
          syncError = ''
          // A checkpoint written during this request must remain pending.
          if (entries[snapshot.id]?.snapshot.revision === snapshot.revision) {
            if (snapshot.status === 'active') {
              entries[snapshot.id].pending = false
              delete entries[snapshot.id].rejection
            }
            else delete entries[snapshot.id]
          }
          persist()
        } catch (cause) {
          if (isRejectedSnapshot(cause)) {
            // Do not reject a newer checkpoint because an older revision failed.
            if (entries[snapshot.id]?.snapshot.revision === snapshot.revision) {
              entries[snapshot.id].rejection = { code: cause.code, message: cause.message || 'Invalid session data' }
            }
            syncError = ''
            persist()
            continue
          }
          syncError = `Sync pending: ${cause.message || 'Connection unavailable'}`
          report()
          break
        }
      }
    })().finally(() => { flight = null })
    return flight
  }
  return {
    put(snapshot) {
      entries[snapshot.id] = { snapshot, pending: true }
      persist()
    },
    flush,
  }
}
