export const COVERAGE_STATES = ['ON_SCREEN', 'EYES_CLOSED', 'LOOKING_AWAY', 'NO_FACE', 'CALIBRATING', 'UNKNOWN']
export const EVENT_KINDS = ['EYES_CLOSED', 'LOOKING_AWAY', 'NO_FACE']

// No frames, face geometry, or biometric baselines enter this ledger.
export function createSessionLedger({ device, wallTime = Date.now(), time = performance.now(), uuid = () => crypto.randomUUID() }) {
  const origin = Math.round(time)
  let cursor = origin
  let observationTime = null
  let state = 'UNKNOWN'
  let revision = 0
  let status = 'active'
  const totals = Object.fromEntries(COVERAGE_STATES.map((kind) => [kind, 0]))
  const events = []
  const open = new Map()
  const id = uuid()
  const stamp = (at) => new Date(wallTime + at - origin).toISOString()

  function advance(time) {
    const at = Math.max(cursor, Math.round(time))
    const duration = at - cursor
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
    observe(detection, at = performance.now()) {
      if (status !== 'active') return
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
        if (finalStatus) { status = finalStatus; closeEvents() }
      }
      return {
        id, device, revision: ++revision, started_at: stamp(origin), last_seen_at: stamp(cursor),
        ended_at: status === 'active' ? null : stamp(cursor), status,
        duration_ms: cursor - origin, totals: { ...totals }, events: events.map((event) => ({ ...event })),
      }
    },
  }
}

export function recoverSnapshot(snapshot) {
  if (snapshot.status !== 'active') return snapshot
  return {
    ...snapshot, status: 'interrupted', ended_at: snapshot.last_seen_at, revision: snapshot.revision + 1,
    events: snapshot.events.map((event) => ({ ...event, ended_at: event.ended_at || snapshot.last_seen_at })),
  }
}

export function createSessionOutbox(userId, { storage = localStorage, send, onChange = () => {} }) {
  const key = `focuswatch.outbox.v1.${userId}`
  let entries = JSON.parse(storage.getItem(key) || '{}')
  for (const entry of Object.values(entries)) {
    if (entry.snapshot.status === 'active') {
      entry.snapshot = recoverSnapshot(entry.snapshot)
      entry.pending = true
    }
  }
  let flight = null
  let error = ''
  function report() {
    onChange({ pending: Object.values(entries).filter((entry) => entry.pending).length, error })
  }
  function persist() {
    try { storage.setItem(key, JSON.stringify(entries)); error = '' }
    catch { error = 'Cannot save the local sync queue. Keep this app open and restore local storage space.' }
    report()
  }
  persist()
  return {
    put(snapshot) {
      entries[snapshot.id] = { snapshot, pending: true }
      persist()
    },
    flush() {
      if (flight) return flight
      flight = (async () => {
        for (const entry of Object.values(entries).filter((entry) => entry.pending)) {
          const snapshot = entry.snapshot
          try {
            await send(snapshot)
            // A checkpoint written during this request must remain pending.
            if (entries[snapshot.id]?.snapshot.revision === snapshot.revision) {
              if (snapshot.status === 'active') entries[snapshot.id].pending = false
              else delete entries[snapshot.id]
            }
            persist()
          } catch (cause) {
            error = `Sync pending: ${cause.message || 'Connection unavailable'}`
            report()
            break
          }
        }
      })().finally(() => { flight = null })
      return flight
    },
  }
}
