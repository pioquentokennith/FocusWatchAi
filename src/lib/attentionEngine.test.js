import { describe, expect, it } from 'vitest'
import { createAttentionEngine } from './attentionEngine.js'

const open = { kind: 'FACE', leftEye: 0.3, rightEye: 0.3, blink: 0, yaw: 0, pitch: 0, gazeValid: true, leftGazeX: 0.5, rightGazeX: 0.5, leftGazeY: 0.5, rightGazeY: 0.5 }
const closed = { ...open, leftEye: 0.06, rightEye: 0.06, blink: 1 }
const away = { ...open, yaw: 35 }

function simulator(thresholds) {
  const engine = createAttentionEngine(thresholds)
  let time = 0
  let view
  const alerts = []
  const feed = (metrics, duration) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 100) {
      view = engine.update(time, metrics)
      if (view.alert) alerts.push(view.alert)
      time += 100
    }
    return view
  }
  return { engine, feed, alerts, skip: (ms) => { time += ms } }
}

describe('calibration', () => {
  it('requires enough open-eye observations and calibrates a neutral pose', () => {
    const { feed } = simulator()
    expect(feed(closed, 5000).phase).toBe('calibrating')
    expect(feed(open, 3000).phase).toBe('calibrating')
    expect(feed(open, 2000).phase).toBe('monitoring')
  })

  it('rejects drifting poses and offers a retry after timeout', () => {
    const { feed, engine } = simulator()
    for (let index = 0; index < 260; index++) feed({ ...open, yaw: index % 40 }, 100)
    expect(feed(open, 5000).phase).toBe('calibration_failed')
    engine.recalibrate()
    expect(feed(open, 5000).phase).toBe('monitoring')
  })

  it('keeps valid calibration samples across a short CPU stall, but not suspension', () => {
    const { feed, skip, engine } = simulator()
    feed(open, 2500)
    skip(900)
    expect(feed(open, 2500).phase).toBe('monitoring')
    engine.recalibrate()
    feed(open, 2500)
    engine.resetContinuity()
    expect(feed(open, 2500).phase).toBe('calibrating')
  })

  it('requires fresh calibration after a sustained eye closure', () => {
    const { feed } = simulator()
    expect(feed(open, 4000).progress).toBeGreaterThan(80)
    expect(feed({ ...closed, gazeValid: false }, 15000).progress).toBe(0)
    expect(feed(open, 500).phase).toBe('calibrating')
    expect(feed(open, 4500).phase).toBe('monitoring')
  })

  it('tolerates a brief blink but never completes calibration during it', () => {
    const { feed } = simulator()
    feed(open, 4500)
    expect(feed(closed, 300).phase).toBe('calibrating')
    expect(feed(open, 100).phase).toBe('monitoring')
  })
})

describe('continuous event timing', () => {
  it.each([
    ['NO_FACE', { kind: 'NO_FACE' }, 1000],
    ['EYES_CLOSED', closed, 5000],
    ['LOOKING_AWAY', away, 6000],
  ])('uses the personal %s threshold independently', (kind, metrics, ms) => {
    const settings = { EYES_CLOSED: 5000, LOOKING_AWAY: 6000, NO_FACE: 1000 }
    const { feed } = simulator(settings)
    settings[kind] = 60000 // The engine owns its immutable session snapshot.
    feed(open, 5000)
    expect(feed(metrics, ms - 100).counts[kind]).toBe(0)
    expect(feed(metrics, 800).counts[kind]).toBe(1)
  })
  it('does not alert for 20 natural short blinks', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    for (let blink = 0; blink < 20; blink++) { feed(closed, 200); feed(open, 800) }
    expect(alerts).toEqual([])
  })

  it('alerts once for sustained closure and rearms after stable recovery', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    expect(feed(closed, 3000).counts.EYES_CLOSED).toBe(0)
    expect(feed(closed, 500).counts.EYES_CLOSED).toBe(1)
    feed(closed, 6000)
    expect(alerts).toEqual(['EYES_CLOSED'])
    feed(open, 1800)
    expect(feed(closed, 4000).counts.EYES_CLOSED).toBe(2)
  })

  it('does not merge separate closures or uncertain observations', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    feed(closed, 2200)
    feed({ kind: 'UNKNOWN' }, 300)
    feed(closed, 2200)
    feed(open, 500)
    feed(closed, 2200)
    expect(alerts).toEqual([])
  })

  it('does not count a missing-frame interval toward an alert', () => {
    const { feed, skip, alerts } = simulator()
    feed(open, 5000)
    feed(closed, 2200)
    skip(10000)
    feed(closed, 2000)
    expect(alerts).toEqual([])
    expect(feed(closed, 1500).counts.EYES_CLOSED).toBe(1)
  })

  it('sounds a no-face alarm without recording an eye closure', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    expect(feed({ kind: 'NO_FACE' }, 3000).alarmActive).toBe(false)
    const view = feed({ kind: 'NO_FACE' }, 1000)
    expect(view.state).toBe('NO_FACE')
    expect(view.warning).toBe(true)
    expect(view.counts.EYES_CLOSED).toBe(0)
    expect(view.counts.NO_FACE).toBe(1)
    expect(alerts).toEqual(['NO_FACE'])
  })

  it('alerts for sustained head deviation, and keeps a wink uncertain', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    expect(feed(away, 3000).counts.LOOKING_AWAY).toBe(0)
    expect(feed(away, 1000).counts.LOOKING_AWAY).toBe(1)
    feed(open, 2000)
    expect(feed({ ...open, leftEye: 0.03 }, 5000).state).toBe('UNKNOWN')
    expect(alerts).toEqual(['LOOKING_AWAY'])
  })

  it('clears episode timing during suspension and recalibration', () => {
    const { feed, engine, alerts } = simulator()
    feed(open, 5000)
    feed(closed, 2500)
    engine.resetContinuity()
    feed(closed, 2000)
    expect(alerts).toEqual([])
    engine.recalibrate()
    expect(feed(open, 1000).phase).toBe('calibrating')
    expect(feed(open, 4000).phase).toBe('monitoring')
  })

  it.each([
    { leftGazeX: 0.72, rightGazeX: 0.72 },
    { leftGazeX: 0.28, rightGazeX: 0.28 },
    { leftGazeY: 0.80, rightGazeY: 0.80 },
    { leftGazeY: 0.20, rightGazeY: 0.20 },
  ])('alerts for eyes-only deviation with a stationary head: %j', (gaze) => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    const looking = { ...open, ...gaze }
    expect(feed(looking, 3000).counts.LOOKING_AWAY).toBe(0)
    const view = feed(looking, 1000)
    expect(view.awayReason).toBe('eye direction')
    expect(view.counts.LOOKING_AWAY).toBe(1)
    feed(looking, 10000)
    expect(alerts).toEqual(['LOOKING_AWAY'])
    feed(open, 2000)
    expect(feed(looking, 4000).counts.LOOKING_AWAY).toBe(2)
  })

  it('does not alert on brief glances, small gaze changes, or disagreeing eyes', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    feed({ ...open, leftGazeX: 0.72, rightGazeX: 0.72 }, 1000)
    feed(open, 2000)
    expect(feed({ ...open, leftGazeX: 0.55, rightGazeX: 0.55 }, 5000).state).toBe('ON_SCREEN')
    expect(feed({ ...open, leftGazeX: 0.8, rightGazeX: 0.2 }, 5000).state).toBe('UNKNOWN')
    expect(alerts).toEqual([])
  })

  it('breaks an eye-direction timer if iris tracking is lost', () => {
    const { feed, alerts } = simulator()
    feed(open, 5000)
    const eyesAway = { ...open, leftGazeX: 0.72, rightGazeX: 0.72 }
    feed(eyesAway, 2200)
    expect(feed({ ...open, gazeValid: false, leftGazeX: null }, 400).state).toBe('UNKNOWN')
    feed(eyesAway, 2200)
    expect(alerts).toEqual([])
  })

  it('requires iris tracking for calibration but still detects closed eyes after calibration', () => {
    const { feed } = simulator()
    expect(feed({ ...open, gazeValid: false }, 5000).phase).toBe('calibrating')
    feed(open, 5000)
    expect(feed({ ...closed, gazeValid: false }, 4000).counts.EYES_CLOSED).toBe(1)
  })

  it('alarms before initial calibration and waits for calibration plus stable recovery', () => {
    const { feed, alerts } = simulator()
    expect(feed({ kind: 'NO_FACE' }, 3000).alarmActive).toBe(false)
    expect(feed({ kind: 'NO_FACE' }, 35000).alarmActive).toBe(true)
    expect(alerts).toEqual(['NO_FACE'])
    expect(feed(open, 5000).alarmActive).toBe(true)
    expect(feed(open, 1000).alarmActive).toBe(false)
  })

  it('keeps an alarm latched through missing faces, uncertainty, and brief recovery', () => {
    const { feed, engine, skip } = simulator()
    feed(open, 6000)
    expect(feed(away, 4000).alarmActive).toBe(true)
    expect(feed({ kind: 'UNKNOWN' }, 2000).alarmActive).toBe(true)
    expect(feed({ kind: 'NO_FACE' }, 4000).alarmActive).toBe(true)
    expect(feed(open, 700).alarmActive).toBe(true)
    skip(5000)
    expect(feed(open, 700).alarmActive).toBe(true)
    engine.resetContinuity()
    expect(feed(closed, 1000).alarmActive).toBe(true)
    expect(feed(open, 1800).alarmActive).toBe(false)
  })

  it('does not clear an active alarm when recalibrating', () => {
    const { feed, engine } = simulator()
    feed(open, 6000)
    feed(closed, 4000)
    engine.recalibrate()
    expect(feed(open, 5000).alarmActive).toBe(true)
    expect(feed(open, 1000).alarmActive).toBe(false)
  })
})
