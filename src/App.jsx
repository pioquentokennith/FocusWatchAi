import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, Clock3, Eye, Focus, Info, Layers3, Monitor, ScanFace, Settings2, ShieldCheck, SlidersHorizontal, Square, Video, X } from 'lucide-react'
import CameraPanel from './components/CameraPanel.jsx'
import { useCamera } from './hooks/useCamera.js'
import { useFaceDetection } from './hooks/useFaceDetection.js'
import { useAlarm } from './hooks/useAlarm.js'
import DetectionStatus from './components/DetectionStatus.jsx'

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function App({ recorder }) {
  const camera = useCamera()
  const [consented, setConsented] = useState(false)
  const [mirrored, setMirrored] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [overlays, setOverlays] = useState(true)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const alarm = useAlarm()
  const detection = useFaceDetection({ stream: camera.stream, videoRef, canvasRef, overlays, onAlarmChange: alarm.setAlarmActive, onObservation: recorder.observe })
  const desktop = window.focuswatchDesktop?.backgroundMonitoring === true
  const live = camera.status === 'live'
  const requesting = camera.status === 'requesting'
  const busy = live || requesting
  useEffect(() => {
    if (!camera.stream) return
    recorder.start()
    return () => { void recorder.finish() }
  }, [camera.stream, recorder.start, recorder.finish])
  const aiStatus = { idle: 'Standby', loading: 'Loading', calibrating: 'Calibrating', calibration_failed: 'Retry needed', monitoring: 'Active', suspended: 'Suspended', waiting: 'Waiting', error: 'Error' }[detection.phase]

  function startSession() {
    alarm.beginSession()
    camera.start()
  }

  function stopSession() {
    alarm.endSession()
    camera.stop()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#workspace" aria-label="AI Object Visualizer home"><span className="brand-icon"><Focus size={23} /></span><span>visualizer<span className="brand-ai">AI</span></span></a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <a className="nav-item selected" href="#workspace"><ScanFace size={18} />Visualizer<span className="nav-active-dot" /></a>
          <a className="nav-item" href="#session"><Clock3 size={18} />Current session</a>
          <a className="nav-item" href="#controls"><SlidersHorizontal size={18} />Camera controls</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card"><span className="local-icon"><ShieldCheck size={19} /></span><strong>Local camera · Shared insights</strong><p>Your camera feed stays on this device. Session times and detection events are saved for you and your admin.</p><span className="local-badge"><span className="tiny-dot green" /> ON-DEVICE FACE AI</span></div>
          <button className="help-button" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp} aria-controls="help-panel"><CircleHelp size={17} />Quick guide<ArrowUpRight size={15} /></button>
          <div className="sidebar-version"><span className="avatar">AI</span><div>FocusWatchAI<span>Staff monitoring · v0.4</span></div></div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div className="breadcrumbs">Workspace<ChevronRight size={14} /><span>Visualizer</span></div><div className="topbar-right"><span className="demo-badge">STAFF WORKSPACE</span><span className="desktop-tag"><Monitor size={14} />{desktop ? 'Desktop · Background ready' : 'Browser demo'}</span></div></header>

        <main id="workspace">
          <div className="page-heading"><div><div className="eyebrow"><span /> SEE THE DETAILS</div><h1>AI Object Visualizer<span>.</span></h1><p>A closer look at face and eye states, right in your browser.</p></div><a className="outline-button" href="#roadmap"><Layers3 size={16} />Demo roadmap<ArrowDown size={14} /></a></div>

          <div className="milestone-banner"><span className="milestone-icon"><Focus size={19} /></span><div><strong>Your face, visualized in real time.</strong><span>Start your camera, look toward the screen for calibration, then explore face landmarks and live reminders.</span></div><span className="step-badge">MEDIAPIPE AI</span></div>
          <div className="background-notice"><Monitor size={16} /><p>{desktop ? 'Background monitoring enabled: detection and repeating alarms continue when you Alt+Tab or minimize this app. Keep your laptop awake.' : 'For reliable Alt+Tab monitoring, use the desktop app: npm run desktop. Background browser pages can be throttled; an active alarm continues until recovery or manual silence.'}</p></div>

          {showHelp && <section id="help-panel" className="help-panel" aria-labelledby="help-title"><div><h2 id="help-title">Your first AI session</h2><p>Accept the camera notice, select Start camera, and allow access. Once the model loads, look at the middle of your laptop screen with eyes naturally open for about 5 seconds. No-face detection is already active during calibration.</p><p>No face, closed eyes, or looking away for 3 seconds starts a repeating alarm. It continues through uncertain readings and brief glances back. To stop it automatically, keep your face visible, eyes open, and gaze near calibration for 1 full second. Use the desktop app for Alt+Tab monitoring. Mute, Silence, and Stop remain manual controls; recalibrating does not dismiss an active alarm.</p></div><button className="icon-button" onClick={() => setShowHelp(false)} aria-label="Close quick guide"><X size={18} /></button></section>}

          <div className="workspace-grid">
            <div className="preview-column">
              <CameraPanel camera={camera} mirrored={mirrored} videoRef={videoRef} canvasRef={canvasRef} detection={detection} />
              <section className="stats-grid" id="session" aria-label="Current session statistics">
                <div className="stat-card"><span className="stat-icon"><Clock3 size={18} /></span><span className="stat-label">{camera.status === 'stopped' ? 'Last session duration' : 'Camera session'}</span><strong className="timer">{formatTime(camera.elapsed)}</strong><span className="stat-foot">{live ? 'Camera connected' : camera.status === 'stopped' ? 'Session ended' : 'Starts with your camera'}</span></div>
                <div className="stat-card"><span className="stat-icon"><ScanFace size={18} /></span><span className="stat-label">Face landmarks</span><strong>{detection.landmarks ? `${detection.landmarks} points` : live ? 'Searching' : 'Standby'}</strong><span className="stat-foot">{detection.landmarks ? 'Face and eye mesh detected' : 'One participating user'}</span></div>
                <div className="stat-card"><span className="stat-icon"><Activity size={18} /></span><span className="stat-label">Detection engine</span><strong>{aiStatus}</strong><span className="stat-foot">MediaPipe Face Landmarker</span></div>
              </section>
              <DetectionStatus detection={detection} live={live} />
            </div>

            <aside className="controls-column">
              <section className="panel controls-panel" id="controls" aria-labelledby="controls-title"><div className="panel-title"><h2 id="controls-title">Camera controls</h2><Settings2 size={17} /></div><p className="panel-description">You’re in control of what your camera sees.</p>
                <div className="device-row"><span className="device-icon"><Video size={19} /></span><div><strong>Default webcam</strong><span>{live ? camera.resolution || 'Camera connected' : 'Selected by your browser'}</span></div><span className={`device-dot ${live ? 'green' : ''}`} /></div>
                <div className="setting-row"><div><strong>Mirror preview</strong><span>A more natural camera view</span></div><button className={`toggle ${mirrored ? 'on' : ''}`} role="switch" aria-checked={mirrored} aria-label="Mirror preview" onClick={() => setMirrored(!mirrored)}><span /></button></div>
                <div className="setting-row ai-setting"><div><strong>Face & eye overlay</strong><span>Visualize real AI landmarks</span></div><button className={`toggle ${overlays ? 'on' : ''}`} role="switch" aria-checked={overlays} aria-label="Face and eye overlay" onClick={() => setOverlays(!overlays)}><span /></button></div>
                <div className="setting-row ai-setting"><div><strong>Sound reminders</strong><span>Repeats until face & gaze recover</span></div><button className={`toggle ${!alarm.muted ? 'on' : ''}`} role="switch" aria-checked={!alarm.muted} aria-label="Sound reminders" onClick={alarm.toggleMute}><span /></button></div>
                <div className="volume-setting"><label htmlFor="alert-volume">Alert volume <output htmlFor="alert-volume">{alarm.volume}%</output></label><input id="alert-volume" type="range" min="0" max="100" step="5" value={alarm.volume} onChange={(event) => alarm.setVolume(event.target.value)} /><small>Also uses your laptop’s speaker volume.</small></div>
                <div className="ai-tools"><button className="text-button" onClick={alarm.testSound}>Test sound</button><button className="text-button" disabled={!live || ['idle', 'loading', 'error'].includes(detection.phase)} onClick={detection.recalibrate}>Recalibrate</button></div>
                {alarm.isPlaying && <div className="sound-playing" role="status">Alarm playing <button className="text-button" onClick={alarm.silence}>Silence</button></div>}
                {alarm.audioMessage && <p className="audio-message" role="status">{alarm.audioMessage}</p>}
                <div className="control-divider" />
                <label className={`consent ${busy ? 'is-disabled' : ''}`}><input type="checkbox" checked={consented} disabled={busy} onChange={(event) => setConsented(event.target.checked)} /><span>I agree to camera monitoring and session insights shared with my admin. <small>Camera images and face landmarks stay on this device. Session times, event types, and durations are saved.</small></span></label>
                <button className="start-button" disabled={!consented || busy || !recorder.ready} onClick={startSession}><Camera size={18} />{requesting ? 'Requesting access…' : live ? 'Camera is running' : camera.status === 'error' ? 'Try camera again' : 'Start camera'}{!busy && <ChevronRight size={16} />}</button>
                <button className="stop-button" disabled={!busy && !alarm.isPlaying} onClick={stopSession}><Square size={14} />{requesting ? 'Cancel request' : 'Stop camera'}</button>
                <div className="control-status" role="status"><span className={`tiny-dot ${live ? 'green' : ''}`} />{live ? `Camera active · AI ${aiStatus.toLowerCase()}` : requesting ? 'Waiting for browser permission' : camera.status === 'stopped' ? 'Camera released successfully' : camera.status === 'error' ? 'Camera needs your attention' : 'Ready when you are'}</div>
                {camera.error && <div className="error-message" role="alert"><Info size={17} /><p>{camera.error}</p></div>}
              </section>

              <section className="panel setup-panel"><div className="panel-title"><h2>A good starting point</h2><Eye size={17} /></div><ul className="setup-list"><li><span>01</span><div><strong>Find your light</strong><p>Keep your full face and both eyes clearly visible.</p></div></li><li><span>02</span><div><strong>Calibrate your eyes</strong><p>Look at the middle of the laptop screen for about 5 seconds.</p></div></li><li><span>03</span><div><strong>Try the repeating alarm</strong><p>Leave the frame or look away for 3 seconds. Return with eyes open and screen-facing gaze for 1 second to stop it.</p></div></li></ul></section>
            </aside>
          </div>

          <section className="roadmap" id="roadmap" aria-labelledby="roadmap-title"><div className="section-heading"><div><span className="eyebrow">BUILT ONE STEP AT A TIME</span><h2 id="roadmap-title">From camera to insight.</h2></div><span className="roadmap-note">The demo journey</span></div><div className="roadmap-grid">
            <div className="roadmap-step current"><span className="roadmap-number"><Check size={16} /></span><span className="roadmap-stage">READY TO TRY</span><h3>Camera foundation</h3><p>Live preview, permissions, and reliable camera controls.</p></div>
            <div className="roadmap-step current"><span className="roadmap-number"><Check size={16} /></span><span className="roadmap-stage">READY TO TRY</span><h3>Face visualization</h3><p>On-device landmarks and eye-region overlays.</p></div>
            <div className="roadmap-step current"><span className="roadmap-number"><Check size={16} /></span><span className="roadmap-stage">READY TO TRY</span><h3>States & reminders</h3><p>Calibration, live timers, and visual/audio reminders.</p></div>
            <div className="roadmap-step current"><span className="roadmap-number"><Check size={16} /></span><span className="roadmap-stage">TEAM CONNECTED</span><h3>Session insights</h3><p>Open My insights for your saved summaries, event counts, and timelines.</p></div>
          </div></section>
          <footer className="page-footer"><span><Focus size={14} />AI Object Visualizer</span><span>Made for curiosity. Built to stay local.</span><span>React + MediaPipe<span className="footer-dot">·</span>Live AI</span></footer>
        </main>
      </div>
    </div>
  )
}

export default App
