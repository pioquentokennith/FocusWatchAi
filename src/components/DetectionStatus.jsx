import { Activity, Info, ScanFace } from 'lucide-react'
import { STATE_LABELS, THRESHOLDS } from '../lib/attentionEngine.js'

export default function DetectionStatus({ detection, live }) {
  const { phase, state, counts, seconds, progress, warning } = detection
  const thresholds = detection.thresholds || THRESHOLDS
  let title = 'AI starts with your camera'
  let detail = 'Start the camera to load the face model and calibrate your natural screen-facing position.'
  if (phase === 'loading') {
    title = 'Loading the face model…'
    detail = 'Preparing on-device inference. The first start can take a few seconds.'
  } else if (phase === 'calibrating') {
    title = `Calibrating your baseline · ${progress}%`
    detail = state === 'NO_FACE' ? 'No face detected. Move into view to begin calibration.' : state === 'UNKNOWN' ? 'Keep your whole face and both irises visible, a little closer to the camera.' : 'Look at the middle of your laptop screen with eyes naturally open. Keep your head and gaze steady for about 5 seconds.'
  } else if (phase === 'calibration_failed') {
    title = 'Calibration needs another try'
    detail = 'Improve your lighting, keep your full face visible, and select Recalibrate. Keep your eyes naturally open.'
  } else if (phase === 'monitoring') {
    title = STATE_LABELS[state]
    detail = state === 'NO_FACE' ? `No face has been detected. A repeating alarm starts after ${thresholds.NO_FACE / 1000} seconds.` : state === 'UNKNOWN' ? 'The face or eye direction cannot be estimated reliably. New alert timers pause, but an existing alarm stays active until reliable recovery.' : state === 'EYES_CLOSED' ? `Both eyes appear closed. An alarm follows ${thresholds.EYES_CLOSED / 1000} seconds of sustained closure.` : state === 'LOOKING_AWAY' ? `Your ${detection.awayReason || 'eye or head direction'} differs from calibration. An alarm follows ${thresholds.LOOKING_AWAY / 1000} seconds of sustained deviation.` : 'Your eyes and head are close to the screen-facing position you calibrated.'
  } else if (phase === 'waiting') {
    title = 'Waiting for fresh video'
    detail = 'AI will continue when new camera frames arrive. Observation gaps do not count toward a new alert or clear an existing alarm.'
  } else if (phase === 'error') {
    title = 'AI could not continue'
    detail = detection.error
  }
  const threshold = thresholds[state]

  return (
    <section className={`detection-panel ${warning ? 'detection-warning' : ''}`} aria-labelledby="detection-title">
      <div className="detection-heading"><span className="detection-symbol"><ScanFace size={22} /></span><div><span className="eyebrow">ON-DEVICE FACE AI</span><h2 id="detection-title">{title}</h2></div><span className="inference-rate"><Activity size={13} />{live && detection.fps ? `${detection.fps} FPS` : '— FPS'}</span></div>
      <p className="detection-detail" role="status">{detail}</p>
      {phase === 'calibrating' && <progress className="calibration-progress" aria-label="Calibration progress" value={progress} max="100" />}
      {threshold && <div className="episode-timer"><span>{state === 'NO_FACE' ? 'No-face alarm' : 'Current episode'}</span><strong>{seconds.toFixed(1)}s / {threshold / 1000}s</strong><progress aria-label="Current episode duration" value={Math.min(seconds * 1000, threshold)} max={threshold} /></div>}
      {warning && <div className="detection-alert" role="alert"><Info size={17} /><span>Alarm active · {STATE_LABELS[detection.alarmReason] || 'Waiting for recovery'}. {phase === 'calibrating' || phase === 'calibration_failed' ? 'Return to view and complete calibration first. ' : ''}{state === 'ON_SCREEN' ? `Hold this position for ${Math.max(0, 1 - (detection.recoverySeconds || 0)).toFixed(1)}s to stop the alarm.` : 'The alarm repeats until your face is visible, eyes are open, and gaze is screen-facing for 1 second.'}</span></div>}
      {phase === 'error' && <button className="outline-button ai-retry" onClick={detection.retry}>Restart AI</button>}
      <div className="event-summary"><span>Session reminders</span><span><strong>{counts.EYES_CLOSED}</strong> eye closure</span><span><strong>{counts.LOOKING_AWAY}</strong> looking away</span><span><strong>{counts.NO_FACE}</strong> no face</span></div>
      <p className="estimate-note">Eye direction uses calibrated iris position alongside head orientation. This estimates looking away; it cannot prove exact screen gaze or focus. One person at a time.</p>
    </section>
  )
}
