import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Camera, ChevronRight, CircleHelp, Clock3, Coffee, Eye, Focus, Info, Monitor, Pause, Play, ScanFace, Settings2, ShieldCheck, SlidersHorizontal, Square, Video, X } from 'lucide-react'
import CameraPanel from './components/CameraPanel.jsx'
import { useCamera } from './hooks/useCamera.js'
import { useFaceDetection } from './hooks/useFaceDetection.js'
import { useAlarm } from './hooks/useAlarm.js'
import DetectionStatus from './components/DetectionStatus.jsx'
import GuidedSetup from './components/GuidedSetup.jsx'
import { useDevicePreferences } from './hooks/useDevicePreferences.js'
import { useCameraDevices } from './hooks/useCameraDevices.js'
import { ALERT_NAMES, BREAK_REASONS } from './lib/settings.js'

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function App({ recorder, profile, settings }) {
  const camera = useCamera()
  const { preferences, update, error: preferenceError } = useDevicePreferences(profile.id)
  const devices = useCameraDevices(camera.stream)
  const [consented, setConsented] = useState(false)
  const { mirrored, overlays, cameraId } = preferences
  const [showHelp, setShowHelp] = useState(false)
  const [breakReason, setBreakReason] = useState('Personal')
  const [breakNote, setBreakNote] = useState('')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const mounted = useRef(true)
  const alarm = useAlarm({ initialVolume: preferences.volume, initialMuted: preferences.muted })
  const session = recorder.session
  const active = session?.status === 'active'
  const paused = active && session.activity === 'paused'
  const thresholds = active ? session.thresholds : settings.thresholds
  const observed = useFaceDetection({ stream: camera.stream, videoRef, canvasRef, overlays, thresholds, onAlarmChange: alarm.setAlarmActive, onObservation: recorder.observe })
  const detection = { ...observed, thresholds, counts: session?.counts || observed.counts }
  const desktop = window.focuswatchDesktop?.backgroundMonitoring === true
  const live = camera.status === 'live'
  const requesting = camera.status === 'requesting'
  const busy = live || requesting
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; void recorder.finish('interrupted') }
  }, [recorder.finish])
  useEffect(() => {
    if (camera.status === 'error' && active && !paused) {
      alarm.endSession()
      void recorder.finish('interrupted')
    }
  }, [camera.status, active, paused, alarm.endSession, recorder.finish])
  const aiStatus = { idle: 'Standby', loading: 'Loading', calibrating: 'Calibrating', calibration_failed: 'Retry needed', monitoring: 'Active', waiting: 'Waiting', error: 'Error' }[detection.phase]

  async function startSession() {
    alarm.beginSession()
    const stream = await camera.start(cameraId)
    if (stream && mounted.current) {
      if (paused) recorder.resume()
      else recorder.start(settings.thresholds)
    }
  }

  function stopSession() {
    alarm.endSession()
    camera.stop()
    void recorder.finish()
  }

  function pauseSession() {
    if (!recorder.pause(breakReason, breakNote)) return
    alarm.endSession()
    camera.stop()
    setBreakNote('')
  }

  function cancelRequest() {
    alarm.endSession()
    camera.stop()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#workspace" aria-label="FocusWatchAI home"><span className="brand-icon"><Focus size={23} /></span><span>FocusWatch<span className="brand-ai">AI</span></span></a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <a className="nav-item selected" href="#workspace"><ScanFace size={18} />Monitor<span className="nav-active-dot" /></a>
          <a className="nav-item" href="#session"><Clock3 size={18} />Current session</a>
          <a className="nav-item" href="#controls"><SlidersHorizontal size={18} />Camera controls</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card"><span className="local-icon"><ShieldCheck size={19} /></span><strong>Local camera · Shared insights</strong><p>Your camera feed stays on this device. Session times and detection events are saved for you and your admin.</p><span className="local-badge"><span className="tiny-dot green" /> ON-DEVICE FACE AI</span></div>
          <button className="help-button" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp} aria-controls="help-panel"><CircleHelp size={17} />Quick guide<ArrowUpRight size={15} /></button>
          <div className="sidebar-version"><span className="avatar">AI</span><div>FocusWatchAI<span>Daily workspace · v0.5</span></div></div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div className="breadcrumbs">Workspace<ChevronRight size={14} /><span>Monitor</span></div><div className="topbar-right"><span className="demo-badge">STAFF WORKSPACE</span><span className="desktop-tag"><Monitor size={14} />{desktop ? 'Desktop · Background ready' : 'Browser workspace'}</span></div></header>

        <main id="workspace">
          <div className="page-heading"><div><div className="eyebrow"><span /> YOUR DAILY WORKSPACE</div><h1>FocusWatchAI<span>.</span></h1><p>Personal reminders, recorded breaks, and clear session insights.</p></div><a className="outline-button" href="#controls"><Settings2 size={16} />Set up your session</a></div>

          <div className="milestone-banner"><span className="milestone-icon"><Focus size={19} /></span><div><strong>Your session. Your alert timings.</strong><span>Choose your timings in Alert settings. Planned breaks are recorded separately from camera observations.</span></div><span className="step-badge">ON-DEVICE AI</span></div>
          <div className="background-notice"><Monitor size={16} /><p>{desktop ? 'Background monitoring enabled: detection and repeating alarms continue when you Alt+Tab or minimize this app. Keep your laptop awake.' : 'For reliable Alt+Tab monitoring, use the desktop app: npm run desktop. Background browser pages can be throttled; an active alarm continues until recovery or manual silence.'}</p></div>

          {showHelp && <section id="help-panel" className="help-panel" aria-labelledby="help-title"><div><h2 id="help-title">Your daily session</h2><p>Accept the camera notice, select Start camera, and allow access. Look at the middle of your screen with eyes naturally open for about 5 seconds. No-face detection is already active during calibration.</p><p>Your saved alert timings apply when each new session starts. Keep your face visible and eyes screen-facing for 1 full second to recover from an alarm. Pause switches off the camera and sound and records your break. Resume starts fresh calibration using the same session settings. Stop camera finishes your session; My insights contains your summaries and exports.</p></div><button className="icon-button" onClick={() => setShowHelp(false)} aria-label="Close quick guide"><X size={18} /></button></section>}

          {paused && <section className="break-banner" role="status"><Coffee size={24} /><div><strong>On break · {session.currentBreak.reason}</strong><p>{formatTime(Math.floor(session.currentBreak.duration_ms / 1000))} · Camera and alarm are off. Resume when you are ready.</p></div><button className="outline-button" disabled={requesting || !consented || !recorder.ready} onClick={startSession}><Play size={16} />Resume session</button></section>}

          <div className="workspace-grid">
            <div className="preview-column">
              <GuidedSetup camera={camera} detection={detection} paused={paused} />
              <CameraPanel camera={camera} mirrored={mirrored} videoRef={videoRef} canvasRef={canvasRef} detection={detection} paused={paused} />
              <section className="stats-grid" id="session" aria-label="Current session statistics">
                <div className="stat-card"><span className="stat-icon"><Clock3 size={18} /></span><span className="stat-label">{active ? 'Session elapsed' : 'Last session duration'}</span><strong className="timer">{formatTime(Math.floor((session?.duration_ms || 0) / 1000))}</strong><span className="stat-foot">{paused ? 'On break' : live ? 'Monitoring' : 'Includes camera time and breaks'}</span></div>
                <div className="stat-card"><span className="stat-icon"><Video size={18} /></span><span className="stat-label">Camera time</span><strong className="timer">{formatTime(Math.floor((session?.camera_ms || 0) / 1000))}</strong><span className="stat-foot">AI {aiStatus.toLowerCase()} · Excludes breaks</span></div>
                <div className="stat-card"><span className="stat-icon"><Coffee size={18} /></span><span className="stat-label">Break time</span><strong className="timer">{formatTime(Math.floor((session?.break_ms || 0) / 1000))}</strong><span className="stat-foot">{session?.break_count || 0} recorded break(s)</span></div>
              </section>
              {!paused && <DetectionStatus detection={detection} live={live} />}
            </div>

            <aside className="controls-column">
              <section className="panel controls-panel" id="controls" aria-labelledby="controls-title"><div className="panel-title"><h2 id="controls-title">Camera controls</h2><Settings2 size={17} /></div><p className="panel-description">You’re in control of what your camera sees.</p>
                <div className="device-row"><span className="device-icon"><Video size={19} /></span><div><strong>{cameraId ? devices.find((device) => device.deviceId === cameraId)?.label || 'Selected webcam' : 'System default webcam'}</strong><span>{live ? camera.resolution || 'Camera connected' : 'Choose your camera below'}</span></div><span className={`device-dot ${live ? 'green' : ''}`} /></div>
                <label className="control-field">Camera<select value={cameraId} disabled={busy} onChange={(event) => update({ cameraId: event.target.value })}><option value="">System default camera</option>{cameraId && !devices.some((device) => device.deviceId === cameraId) && <option value={cameraId}>Saved camera (connect it or choose another)</option>}{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
                <div className="setting-row"><div><strong>Mirror preview</strong><span>A more natural camera view</span></div><button className={`toggle ${mirrored ? 'on' : ''}`} role="switch" aria-checked={mirrored} aria-label="Mirror preview" onClick={() => update({ mirrored: !mirrored })}><span /></button></div>
                <div className="setting-row ai-setting"><div><strong>Face & eye overlay</strong><span>Visualize real AI landmarks</span></div><button className={`toggle ${overlays ? 'on' : ''}`} role="switch" aria-checked={overlays} aria-label="Face and eye overlay" onClick={() => update({ overlays: !overlays })}><span /></button></div>
                <div className="setting-row ai-setting"><div><strong>Sound reminders</strong><span>Repeats until face & gaze recover</span></div><button className={`toggle ${!alarm.muted ? 'on' : ''}`} role="switch" aria-checked={!alarm.muted} aria-label="Sound reminders" onClick={() => { alarm.toggleMute(); update({ muted: !alarm.muted }) }}><span /></button></div>
                <div className="volume-setting"><label htmlFor="alert-volume">Alert volume <output htmlFor="alert-volume">{alarm.volume}%</output></label><input id="alert-volume" type="range" min="0" max="100" step="5" value={alarm.volume} onChange={(event) => { alarm.setVolume(event.target.value); update({ volume: Number(event.target.value) }) }} /><small>Also uses your laptop’s speaker volume.</small></div>
                <div className="ai-tools"><button className="text-button" onClick={alarm.testSound}>Test sound</button><button className="text-button" disabled={!live || ['idle', 'loading', 'error'].includes(detection.phase)} onClick={detection.recalibrate}>Recalibrate</button></div>
                {alarm.isPlaying && <div className="sound-playing" role="status">Alarm playing <button className="text-button" onClick={alarm.silence}>Silence</button></div>}
                {alarm.audioMessage && <p className="audio-message" role="status">{alarm.audioMessage}</p>}
                {preferenceError && <p className="audio-message" role="status">{preferenceError}</p>}
                <div className="session-policy"><strong>{active ? 'This session’s alert timings' : 'Next session’s alert timings'}</strong>{Object.entries(ALERT_NAMES).map(([key, label]) => <span key={key}>{label}: {thresholds[key] / 1000}s</span>)}<small>Change these in Alert settings.</small></div>
                {settings.error && <p className="audio-message" role="status">{settings.error} <button className="text-button" onClick={settings.retry}>Retry settings</button></p>}
                <div className="control-divider" />
                <label className={`consent ${busy || active ? 'is-disabled' : ''}`}><input type="checkbox" checked={consented} disabled={busy || active} onChange={(event) => setConsented(event.target.checked)} /><span>I agree to camera monitoring and session insights shared with my admin. <small>Camera images and face landmarks stay on this device. Session times, event types, and durations are saved.</small></span></label>
                {!paused && <button className="start-button" disabled={!consented || busy || !recorder.ready || !settings.ready} onClick={startSession}><Camera size={18} />{requesting ? 'Requesting access…' : live ? 'Camera is running' : camera.status === 'error' ? 'Try camera again' : 'Start camera'}{!busy && <ChevronRight size={16} />}</button>}
                {live && active && <div className="break-controls"><label className="control-field">Break reason<select value={breakReason} onChange={(event) => setBreakReason(event.target.value)}>{BREAK_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="control-field">Break note (optional)<input maxLength="250" value={breakNote} onChange={(event) => setBreakNote(event.target.value)} placeholder="For example: team meeting" /></label><button className="outline-button" onClick={pauseSession}><Pause size={16} />Pause session</button></div>}
                <button className="stop-button" disabled={!busy && !active && !alarm.isPlaying} onClick={requesting ? cancelRequest : stopSession}><Square size={14} />{requesting ? 'Cancel request' : paused ? 'End session' : 'Stop camera'}</button>
                <div className="control-status" role="status"><span className={`tiny-dot ${live ? 'green' : ''}`} />{live ? `Camera active · AI ${aiStatus.toLowerCase()}` : requesting ? 'Waiting for browser permission' : paused ? 'On break · Camera off' : camera.status === 'stopped' ? 'Camera released successfully' : camera.status === 'error' ? 'Camera needs your attention' : 'Ready when you are'}</div>
                {camera.error && <div className="error-message" role="alert"><Info size={17} /><p>{camera.error}</p></div>}
              </section>

               <section className="panel setup-panel"><div className="panel-title"><h2>Make each session useful</h2><Eye size={17} /></div><ul className="setup-list"><li><span>01</span><div><strong>Find your light</strong><p>Keep your full face and both eyes clearly visible.</p></div></li><li><span>02</span><div><strong>Take recorded breaks</strong><p>Pause before stepping away. The camera stays off until you resume.</p></div></li><li><span>03</span><div><strong>Review your day</strong><p>Open My insights for daily summaries, break history, and CSV reports.</p></div></li></ul></section>
            </aside>
          </div>

          <footer className="page-footer"><span><Focus size={14} />FocusWatchAI</span><span>Camera frames stay local. Session insights stay with your team.</span><span>Daily workspace · v0.5</span></footer>
        </main>
      </div>
    </div>
  )
}

export default App
