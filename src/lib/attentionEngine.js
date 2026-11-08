import { GAZE_KEYS } from './faceMetrics.js'

export const STATE_LABELS = {
  ON_SCREEN: 'Screen-facing estimate', EYES_CLOSED: 'Eyes closed', LOOKING_AWAY: 'Looking away estimate',
  NO_FACE: 'No face detected', UNKNOWN: 'Uncertain observation', CALIBRATING: 'Calibrating',
}
export const THRESHOLDS = { EYES_CLOSED: 3000, LOOKING_AWAY: 3000, NO_FACE: 3000 }
const MAX_GAP = 750
const METRIC_KEYS = ['leftEye', 'rightEye', 'yaw', 'pitch', ...GAZE_KEYS]

function reliableGaze(metrics) {
  return metrics.gazeValid === true && GAZE_KEYS.every((key) => Number.isFinite(metrics[key]))
}

function sameDirection(a, b, limit) {
  return Math.sign(a) === Math.sign(b) && Math.min(Math.abs(a), Math.abs(b)) > limit
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function createAttentionEngine() {
  let baseline = null
  let samples = []
  let calibrationStart = null
  let calibrationFailed = false
  let previousTime = null
  let smoothed = null
  let state = 'UNKNOWN'
  let stateSince = null
  let recoverySince = null
  let alerted = new Set()
  let counts = { EYES_CLOSED: 0, LOOKING_AWAY: 0, NO_FACE: 0 }
  let alarmActive = false
  let alarmReason = null

  function resetContinuity({ preserveCalibration = false } = {}) {
    previousTime = null
    smoothed = null
    state = 'UNKNOWN'
    stateSince = null
    recoverySince = null
    // Missing observations are not evidence of recovery. Keep an existing alarm
    // and its event deduplication until a fresh, stable screen-facing recovery.
    if (!preserveCalibration) {
      samples = []
      calibrationStart = null
    }
  }

  function recalibrate() {
    baseline = null
    calibrationFailed = false
    resetContinuity()
  }

  function update(time, metrics) {
    const gap = previousTime !== null ? time - previousTime : 100
    // A short CPU stall breaks alert continuity, but previously collected valid
    // calibration observations are still useful. Long gaps or suspension discard them.
    if (gap > MAX_GAP || gap < 0) resetContinuity({ preserveCalibration: gap > 0 && gap <= 3000 })
    previousTime = time
    let alert = null
    let awayReason = null
    const gazeValid = metrics.kind === 'FACE' && reliableGaze(metrics)
    let phase = 'monitoring'
    let progress = 100
    let next = metrics.kind

    if (!baseline) {
      // No-face protection is live as soon as inference starts, even before we
      // have a neutral baseline. Absence alone must not exhaust calibration.
      if (metrics.kind === 'FACE') calibrationStart ??= time
      else calibrationStart = null
      if (calibrationStart !== null && time - calibrationStart >= 25000) calibrationFailed = true
      if (!calibrationFailed && metrics.kind === 'FACE' && gazeValid && metrics.blink < 0.35 && metrics.leftEye > 0.12 && metrics.rightEye > 0.12) {
        const recent = samples.at(-1)
        if (recent && (Math.abs(metrics.yaw - recent.yaw) > 8 || Math.abs(metrics.pitch - recent.pitch) > 8)) samples = []
        samples.push({ ...metrics, time })
        // Reject drifting head poses and moving eyes during neutral calibration.
        if (Math.max(...samples.map((sample) => sample.yaw)) - Math.min(...samples.map((sample) => sample.yaw)) > 10 ||
            Math.max(...samples.map((sample) => sample.pitch)) - Math.min(...samples.map((sample) => sample.pitch)) > 10 ||
            GAZE_KEYS.some((key) => Math.max(...samples.map((sample) => sample[key])) - Math.min(...samples.map((sample) => sample[key])) > (key.endsWith('X') ? 0.20 : 0.35))) {
          samples = [samples.at(-1)]
        }
      } else if (metrics.kind !== 'FACE' || (metrics.blink < 0.35 && !gazeValid)) {
        samples = []
      }
      if (!calibrationFailed && samples.length >= 45 && time - samples[0].time >= 4500) {
        baseline = Object.fromEntries(METRIC_KEYS.map((key) => [key, median(samples.map((sample) => sample[key]))]))
        samples = []
      } else {
        phase = calibrationFailed ? 'calibration_failed' : 'calibrating'
        progress = Math.min(99, Math.round(samples.length / 45 * 100))
        next = metrics.kind === 'FACE' ? gazeValid ? 'CALIBRATING' : 'UNKNOWN' : metrics.kind
      }
    }

    if (baseline && metrics.kind === 'FACE') {
      const alpha = 1 - Math.exp(-Math.min(gap, MAX_GAP) / 120)
      smoothed = Object.fromEntries(METRIC_KEYS.map((key) => {
        if (GAZE_KEYS.includes(key) && !gazeValid) return [key, null]
        return [key, Number.isFinite(smoothed?.[key]) ? smoothed[key] + alpha * (metrics[key] - smoothed[key]) : metrics[key]]
      }))
      const eyeThreshold = state === 'EYES_CLOSED' ? 0.75 : 0.60
      const leftClosed = smoothed.leftEye < baseline.leftEye * eyeThreshold
      const rightClosed = smoothed.rightEye < baseline.rightEye * eyeThreshold
      if (leftClosed && rightClosed) next = 'EYES_CLOSED'
      else if (leftClosed || rightClosed) next = 'UNKNOWN'
      else {
        const yawLimit = state === 'LOOKING_AWAY' ? 16 : 22
        const pitchLimit = state === 'LOOKING_AWAY' ? 13 : 18
        const headAway = Math.abs(smoothed.yaw - baseline.yaw) > yawLimit || Math.abs(smoothed.pitch - baseline.pitch) > pitchLimit
        const leftX = smoothed.leftGazeX - baseline.leftGazeX
        const rightX = smoothed.rightGazeX - baseline.rightGazeX
        const leftY = smoothed.leftGazeY - baseline.leftGazeY
        const rightY = smoothed.rightGazeY - baseline.rightGazeY
        const horizontalLimit = state === 'LOOKING_AWAY' ? 0.08 : 0.12
        const verticalLimit = state === 'LOOKING_AWAY' ? 0.13 : 0.20
        const eyesAgree = gazeValid && Math.abs(leftX - rightX) < 0.22 && Math.abs(leftY - rightY) < 0.35
        const eyesAway = eyesAgree && (sameDirection(leftX, rightX, horizontalLimit) || sameDirection(leftY, rightY, verticalLimit))
        if (headAway || eyesAway) {
          next = 'LOOKING_AWAY'
          awayReason = headAway && eyesAway ? 'eyes and head' : headAway ? 'head direction' : 'eye direction'
        } else next = eyesAgree ? 'ON_SCREEN' : 'UNKNOWN'
      }
    } else {
      smoothed = null
    }

    if (next !== state || stateSince === null) {
      state = next
      stateSince = time
    }
    if (phase === 'monitoring' && state === 'ON_SCREEN') {
      recoverySince ??= time
      if (time - recoverySince >= 1000) {
        alerted.clear()
        alarmActive = false
        alarmReason = null
      }
    } else recoverySince = null

    const duration = time - stateSince
    if (counts[state] !== undefined && duration >= THRESHOLDS[state] && !alerted.has(state)) {
      alerted.add(state)
      counts[state] += 1
      alert = state
      alarmActive = true
      alarmReason = state
    }
    return {
      phase, state, progress,
      seconds: duration / 1000,
      warning: alarmActive,
      alarmActive, alarmReason,
      recoverySeconds: recoverySince === null ? 0 : Math.min(1, (time - recoverySince) / 1000),
      counts: { ...counts }, alert,
      awayReason,
      gazeTracked: gazeValid && state !== 'EYES_CLOSED' && state !== 'UNKNOWN',
      yaw: baseline && metrics.kind === 'FACE' ? Math.round(smoothed.yaw - baseline.yaw) : null,
      pitch: baseline && metrics.kind === 'FACE' ? Math.round(smoothed.pitch - baseline.pitch) : null,
    }
  }

  return { update, resetContinuity, recalibrate }
}
