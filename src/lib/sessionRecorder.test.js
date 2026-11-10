import { describe, expect, it, vi } from 'vitest'
import { createSessionLedger, createSessionOutbox, recoverSnapshot } from './sessionRecorder.js'

function ledger() {
  let id = 0
  return createSessionLedger({ device: 'desktop', wallTime: 100000, time: 0, uuid: () => `id-${++id}` })
}
function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
}

describe('session recording', () => {
  it('excludes breaks from observation time and resumes in the same session with fixed settings', () => {
    const thresholds = { EYES_CLOSED: 1000, LOOKING_AWAY: 5000, NO_FACE: 10000 }
    const log = createSessionLedger({ device: 'desktop', time: 0, wallTime: 100000, thresholds })
    thresholds.NO_FACE = 1000
    log.observe({ state: 'ON_SCREEN' }, 0)
    log.pause('Lunch', '  Lunch break  ', 500)
    log.observe({ state: 'NO_FACE', alert: 'NO_FACE', seconds: 10, alarmActive: true }, 5000)
    const paused = log.snapshot(10500)
    expect(paused).toMatchObject({ activity: 'paused', break_ms: 10000, totals: { ON_SCREEN: 500 }, thresholds: { NO_FACE: 10000 } })
    expect(paused.events).toEqual([])
    expect(log.summary(11500).currentBreak.duration_ms).toBe(11000)
    log.resume(12500)
    log.observe({ state: 'CALIBRATING' }, 13000)
    const final = log.snapshot(13500, 'completed')
    expect(final.id).toBe(paused.id)
    expect(final).toMatchObject({ activity: 'stopped', break_ms: 12000, duration_ms: 13500, totals: { ON_SCREEN: 500, UNKNOWN: 500, CALIBRATING: 500 } })
    expect(final.breaks[0]).toMatchObject({ reason: 'Lunch', note: 'Lunch break', duration_ms: 12000, ended_at: new Date(112500).toISOString() })
  })

  it('closes alarms on pause and closes an unfinished break at the last checkpoint after a crash', () => {
    const log = ledger()
    log.observe({ state: 'NO_FACE', alert: 'NO_FACE', seconds: 3, alarmActive: true }, 3000)
    log.pause('Meeting', '', 3500)
    const recovered = recoverSnapshot(log.snapshot(9000))
    expect(recovered).toMatchObject({ status: 'interrupted', activity: 'stopped', break_ms: 5500 })
    expect(recovered.events[0].ended_at).toBe(new Date(103500).toISOString())
    expect(recovered.breaks[0].ended_at).toBe(recovered.last_seen_at)
    expect(Object.values(recovered.totals).reduce((a, b) => a + b, 0) + recovered.break_ms).toBe(recovered.duration_ms)
  })
  it('counts an alarm episode once, excludes unknown gaps, and rearms after recovery', () => {
    const log = ledger()
    for (let time = 0; time <= 5000; time += 100) log.observe({ state: 'NO_FACE', alarmActive: time >= 3000, seconds: time / 1000, alert: time === 3000 ? 'NO_FACE' : null }, time)
    log.observe({ state: 'UNKNOWN', alarmActive: true }, 5100)
    log.observe({ state: 'NO_FACE', alarmActive: true }, 7000)
    log.observe({ state: 'NO_FACE', alarmActive: true }, 7100)
    log.observe({ state: 'ON_SCREEN', alarmActive: false }, 7200)
    for (let time = 7300; time <= 10300; time += 100) log.observe({ state: 'NO_FACE', alarmActive: time === 10300, seconds: (time - 7300) / 1000, alert: time === 10300 ? 'NO_FACE' : null }, time)
    const result = log.snapshot(10300, 'completed')
    expect(result.events).toHaveLength(2)
    expect(result.events[0].observed_ms).toBe(5300)
    expect(result.events[1].observed_ms).toBe(3000)
    expect(result.totals.UNKNOWN).toBe(1900)
    expect(Object.values(result.totals).reduce((a, b) => a + b, 0)).toBe(result.duration_ms)
    expect(result.events.every((event) => event.ended_at)).toBe(true)
  })

  it('does not count a held alarm as continuous eye closure during lost inference', () => {
    const log = ledger()
    for (let time = 0; time <= 3000; time += 100) log.observe({ state: 'EYES_CLOSED', alarmActive: time === 3000, alert: time === 3000 ? 'EYES_CLOSED' : null, seconds: time / 1000 }, time)
    const result = log.snapshot(10000, 'interrupted')
    expect(result.events[0].observed_ms).toBe(3000)
    expect(result.totals.UNKNOWN).toBe(7000)
    expect(result.ended_at).toBe(result.last_seen_at)
  })

  it('retains failed sync across a restart and recovers only to the last known time', async () => {
    const storage = memoryStorage()
    const failure = vi.fn(async () => { throw new Error('Offline') })
    const first = createSessionOutbox('staff-one', { storage, send: failure })
    first.put(ledger().snapshot(5000))
    await first.flush()
    const send = vi.fn(async () => {})
    const recovered = createSessionOutbox('staff-one', { storage, send })
    await recovered.flush()
    expect(send.mock.calls[0][0]).toMatchObject({ status: 'interrupted', duration_ms: 5000, revision: 2 })
    expect(send.mock.calls[0][0].ended_at).toBe(send.mock.calls[0][0].last_seen_at)
    await recovered.flush()
    expect(send).toHaveBeenCalledOnce()
  })

  it('retains a newer checkpoint while an older request is in flight', async () => {
    let release
    const send = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const outbox = createSessionOutbox('staff-one', { storage: memoryStorage(), send })
    const log = ledger()
    outbox.put(log.snapshot(1000))
    const pending = outbox.flush()
    outbox.put(log.snapshot(2000, 'completed'))
    release()
    await pending
    const second = outbox.flush()
    expect(send.mock.calls[1][0]).toMatchObject({ status: 'completed', revision: 2, duration_ms: 2000 })
    release()
    await second
  })

  it('never syncs another staff account’s outbox', async () => {
    const storage = memoryStorage()
    createSessionOutbox('staff-one', { storage, send: vi.fn() }).put(ledger().snapshot(1000))
    const send = vi.fn()
    await createSessionOutbox('staff-two', { storage, send }).flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('recovers even acknowledged active sessions after a crash', async () => {
    const storage = memoryStorage()
    const send = vi.fn(async () => {})
    const first = createSessionOutbox('staff', { storage, send })
    first.put(ledger().snapshot(1000))
    await first.flush()
    await createSessionOutbox('staff', { storage, send }).flush()
    expect(send.mock.calls[1][0].status).toBe('interrupted')
  })

  it.each([
    { code: 'P0001', message: 'Invalid session timing' },
    { code: '23514', message: 'Session constraint violated' },
    { status: 413, message: 'Payload too large' },
  ])('retains rejected records without blocking valid uploads: %j', async (rejection) => {
    const storage = memoryStorage()
    const onChange = vi.fn()
    const bad = { ...ledger().snapshot(1000, 'completed'), id: 'bad' }
    const good = { ...ledger().snapshot(2000, 'completed'), id: 'good' }
    const send = vi.fn(async (snapshot) => { if (snapshot.id === 'bad') throw rejection })
    const outbox = createSessionOutbox('staff', { storage, send, onChange })
    outbox.put(bad)
    outbox.put(good)
    await outbox.flush()
    expect(send.mock.calls.map(([snapshot]) => snapshot.id)).toEqual(['bad', 'good'])
    expect(onChange.mock.lastCall[0]).toMatchObject({ pending: 1, rejected: 1 })
    expect(onChange.mock.lastCall[0].error).toContain('kept on this device')
    const saved = JSON.parse(storage.getItem('focuswatch.outbox.v1.staff'))
    expect(saved.bad.snapshot).toEqual(bad)
    expect(saved.good).toBeUndefined()

    const retry = vi.fn(async () => {})
    const restarted = createSessionOutbox('staff', { storage, send: retry, onChange })
    await restarted.flush()
    expect(retry).not.toHaveBeenCalled()
    await restarted.flush({ retryRejected: true })
    expect(retry).toHaveBeenCalledWith(bad)
    expect(onChange.mock.lastCall[0]).toEqual({ pending: 0, rejected: 0, error: '' })
  })

  it.each([
    new Error('Offline'),
    { code: 'P0001', message: 'Active staff access required' },
    { code: 'P0001', message: 'Session owner does not match signed-in staff' },
  ])('keeps connection/access failures retryable and visible across checkpoints: %j', async (problem) => {
    const onChange = vi.fn()
    const send = vi.fn().mockRejectedValueOnce(problem).mockResolvedValue(undefined)
    const outbox = createSessionOutbox('staff', { storage: memoryStorage(), send, onChange })
    const log = ledger()
    outbox.put(log.snapshot(1000))
    await outbox.flush()
    outbox.put(log.snapshot(2000))
    expect(onChange.mock.lastCall[0]).toMatchObject({ rejected: 0, error: `Sync pending: ${problem.message}` })
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(2)
    expect(onChange.mock.lastCall[0]).toEqual({ pending: 0, rejected: 0, error: '' })
  })

  it('does not quarantine a newer snapshot when an older upload is rejected', async () => {
    let reject
    const send = vi.fn().mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail })).mockResolvedValue(undefined)
    const outbox = createSessionOutbox('staff', { storage: memoryStorage(), send })
    const log = ledger()
    outbox.put(log.snapshot(1000))
    const first = outbox.flush()
    const final = log.snapshot(2000, 'completed')
    outbox.put(final)
    reject({ code: 'P0001', message: 'Invalid session timing' })
    await first
    await outbox.flush()
    expect(send).toHaveBeenLastCalledWith(final)
  })

  it('honors a manual rejected-record retry requested during an automatic sync', async () => {
    const send = vi.fn().mockRejectedValueOnce({ code: 'P0001', message: 'Invalid session timing' })
    const outbox = createSessionOutbox('staff', { storage: memoryStorage(), send })
    outbox.put({ ...ledger().snapshot(1000, 'completed'), id: 'rejected' })
    await outbox.flush()
    let release
    send.mockImplementationOnce(() => new Promise((resolve) => { release = resolve })).mockResolvedValue(undefined)
    outbox.put({ ...ledger().snapshot(2000, 'completed'), id: 'valid' })
    const automatic = outbox.flush()
    const manual = outbox.flush({ retryRejected: true })
    expect(outbox.flush({ retryRejected: true })).toBe(manual)
    // Recorder teardown must wait for the queued retry before releasing its lock.
    expect(outbox.flush()).toBe(manual)
    release()
    await automatic
    await manual
    expect(send.mock.calls.map(([snapshot]) => snapshot.id)).toEqual(['rejected', 'valid', 'rejected'])
  })
})
