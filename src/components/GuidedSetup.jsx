export default function GuidedSetup({ camera, detection, paused }) {
  const live = camera.status === 'live'
  const calibrated = detection.phase === 'monitoring'
  return <section className="guided-setup" aria-label="Camera setup guide">
    <div className="cloud-section-title"><h2>{paused ? 'Your camera is off during this break' : 'Ready in three steps'}</h2><span className="status-pill">{detection.landmarks ? `${detection.landmarks} points` : 'On-device AI'}</span></div>
    <ol>
      <li className={live ? 'complete' : ''}><strong>1. Choose your camera</strong><span>Select a webcam, accept the camera notice, then Start camera. Device names appear after permission is granted.</span></li>
      <li className={calibrated ? 'complete' : ''}><strong>2. Position and calibrate</strong><span>{paused ? 'Resume will run fresh calibration.' : live && !calibrated ? 'Keep your whole face and both eyes visible. Look at the center of the screen with eyes naturally open for about five seconds.' : 'Use even lighting, face the screen, and keep the camera near eye level.'}</span></li>
      <li className={calibrated ? 'complete' : ''}><strong>3. Monitor with confidence</strong><span>{calibrated ? 'Calibration complete. Test your sound, use Pause for breaks, and check your saved session in My insights.' : 'Confirm your sound level. Use Pause for planned breaks and Stop camera to finish your session.'}</span></li>
    </ol>
  </section>
}
