import { describe, expect, it, vi } from 'vitest'
import { createSessionLedger, createSessionOutbox } from './sessionRecorder.js'

function ledger() {
  let id = 0
  return createSessionLedger({ device: 'desktop', wallTime: 100000, time: 0, uuid: () => `id-${++id}` })
}
function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
}

describe('session recording', () => {
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
})
