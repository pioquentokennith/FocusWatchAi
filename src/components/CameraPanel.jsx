import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Expand, LoaderCircle, Maximize, ScanFace, ShieldCheck } from 'lucide-react'
import { STATE_LABELS } from '../lib/attentionEngine.js'

export default function CameraPanel({ camera, mirrored, videoRef, canvasRef, detection }) {
  const panelRef = useRef(null)
  const [previewError, setPreviewError] = useState('')
  const [fullscreenError, setFullscreenError] = useState('')
  const live = camera.status === 'live'
  const requesting = camera.status === 'requesting'

  useEffect(() => {
    const video = videoRef.current
    let current = true
    setPreviewError('')
    video.srcObject = camera.stream
    if (camera.stream) {
      video.play().catch(() => {
        if (current) setPreviewError('Preview playback was blocked. Use Play preview to retry.')
      })
    }
    return () => {
      current = false
      video.srcObject = null
    }
  }, [camera.stream])

  async function fullscreen() {
    try {
      setFullscreenError('')
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (panelRef.current.requestFullscreen) await panelRef.current.requestFullscreen()
      else setFullscreenError('Fullscreen is unavailable in this browser.')
    } catch {
      setFullscreenError('Fullscreen was blocked by your browser.')
    }
  }

  async function playPreview() {
    try {
      await videoRef.current.play()
      setPreviewError('')
    } catch {
      setPreviewError('Preview is still blocked. Stop the camera and try starting it again.')
    }
  }

  return (
    <section className="camera-card" aria-labelledby="camera-title" ref={panelRef}>
      <div className="card-header">
        <div className="card-heading"><Camera size={17} /><h2 id="camera-title">Live preview</h2><span className="small-label">CAM 01</span></div>
        <span className={`status-pill ${live ? 'is-live' : ''}`}><span className="status-dot" />{live ? 'Camera live' : requesting ? 'Connecting' : 'Camera off'}</span>
      </div>

      <div className={`camera-stage ${live ? 'has-video' : ''}`}>
        <video ref={videoRef} autoPlay muted playsInline className={mirrored ? 'mirrored' : ''} aria-label="Live webcam preview" hidden={!live} />
        <canvas ref={canvasRef} className={`face-overlay ${mirrored ? 'mirrored' : ''}`} aria-hidden="true" hidden={!live} />
        <div className="stage-top"><span><span className={`tiny-dot ${live ? 'green' : ''}`} />{live ? 'LIVE FEED' : 'PREVIEW STANDBY'}</span><span>{camera.resolution || 'LOCAL CAMERA'}</span></div>
        {!live && (
          <div className="camera-placeholder">
            <div className="scan-illustration"><span className="corner tl" /><span className="corner tr" /><ScanFace size={54} strokeWidth={1} /><span className="corner bl" /><span className="corner br" /></div>
            <h3>{requesting ? 'Waiting for camera access' : camera.status === 'stopped' ? 'Session complete. Take a breather.' : camera.status === 'error' ? 'Let’s reconnect your camera' : 'Your perspective, visualized.'}</h3>
            <p>{requesting ? 'Allow access in your browser’s permission prompt.' : camera.status === 'stopped' ? 'Your camera is off. Start again whenever you’re ready.' : camera.status === 'error' ? 'Check the message below to get your preview running.' : 'Enable your camera to bring the workspace to life.'}</p>
            <span className="placeholder-note">{requesting ? <LoaderCircle size={14} className="spin" /> : <CameraOff size={14} />}{requesting ? 'You can cancel at any time' : 'No camera active'}</span>
          </div>
        )}
        {live && <div className={`preview-caption ${detection.warning ? 'caption-warning' : ''}`}><ScanFace size={14} />{detection.phase === 'monitoring' ? `AI active · ${STATE_LABELS[detection.state]}` : detection.phase === 'calibrating' ? `AI active · Calibrating ${detection.progress}%` : detection.phase === 'loading' ? 'Loading on-device AI model…' : detection.phase === 'error' ? 'AI unavailable · See message below' : detection.phase === 'suspended' ? 'AI suspended · Return to this tab' : detection.phase === 'calibration_failed' ? 'Calibration needs a retry' : 'AI waiting for fresh camera frames'}</div>}
        <div className="stage-bottom"><span className="frame-mark"><Maximize size={15} /> {mirrored ? 'MIRRORED VIEW' : 'NATURAL VIEW'}</span><button className="icon-button" onClick={fullscreen} aria-label="Toggle preview fullscreen" title="Toggle fullscreen"><Expand size={17} /></button></div>
      </div>
      {(previewError || fullscreenError) && <div className="preview-message" role="status">{previewError || fullscreenError}{previewError && <button className="text-button" onClick={playPreview}>Play preview</button>}</div>}
      <div className="camera-footer"><span><ShieldCheck size={15} /> Your camera stays on your device</span><span>No recording. No uploads.</span></div>
    </section>
  )
}
