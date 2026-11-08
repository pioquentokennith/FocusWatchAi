import { useCallback, useEffect, useRef, useState } from 'react'
import { createAttentionEngine } from '../lib/attentionEngine.js'
import { extractFaceMetrics } from '../lib/faceMetrics.js'
import { clearOverlay, drawFace } from '../lib/drawFace.js'

const initial = { phase: 'idle', state: 'UNKNOWN', progress: 0, seconds: 0, warning: false, alarmActive: false, alarmReason: null, counts: { EYES_CLOSED: 0, LOOKING_AWAY: 0, NO_FACE: 0 }, landmarks: 0, fps: 0, error: '' }

export function useFaceDetection({ stream, videoRef, canvasRef, overlays, onAlarmChange, onObservation }) {
  const [view, setView] = useState(initial)
  const [attempt, setAttempt] = useState(0)
  const engineRef = useRef(null)
  const engineSession = useRef(null)
  const options = useRef({ overlays, onAlarmChange, onObservation })
  useEffect(() => { options.current = { overlays, onAlarmChange, onObservation } }, [overlays, onAlarmChange, onObservation])
  useEffect(() => { if (!overlays) clearOverlay(canvasRef.current) }, [overlays, canvasRef])

  const recalibrate = useCallback(() => {
    engineRef.current?.recalibrate()
    setView((previous) => ({ ...previous, phase: 'calibrating', progress: 0, state: 'CALIBRATING', seconds: 0 }))
  }, [])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!stream) {
      engineSession.current = null
      setView((previous) => ({ ...initial, counts: previous.counts }))
      clearOverlay(canvasRef.current)
      return
    }
    let cancelled = false
    let model = null
    let timer = null
    let connections
    let lastVideoTime = -1
    let lastFrame = performance.now()
    let lastPublish = -Infinity
    let fpsStart = null
    let frameCount = 0
    let fps = 0
    let waiting = false
    const canvas = canvasRef.current
    const isNewSession = engineSession.current?.stream !== stream
    if (isNewSession) engineSession.current = { stream, engine: createAttentionEngine() }
    const engine = engineSession.current.engine
    engine.resetContinuity()
    engineRef.current = engine
    setView((previous) => ({ ...(isNewSession ? initial : previous), phase: 'loading', error: '' }))

    function publishStatus(phase) {
      setView((previous) => ({ ...previous, phase, state: 'UNKNOWN', seconds: 0, landmarks: 0, fps: 0 }))
    }

    function loop() {
      if (cancelled) return
      const time = performance.now()
      // Unlike requestAnimationFrame, this scheduler is not tied to a visible
      // window. Electron disables background throttling for this renderer.
      const schedule = () => { if (!cancelled && model) timer = window.setTimeout(loop, Math.max(10, 100 - (performance.now() - time))) }
      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth || video.paused || video.currentTime === lastVideoTime) {
        if (!waiting && time - lastFrame > 1000) {
          waiting = true
          engine.resetContinuity()
          clearOverlay(canvas)
          publishStatus('waiting')
        }
        schedule()
        return
      }
      waiting = false
      lastFrame = time
      lastVideoTime = video.currentTime
      try {
        const result = model.detectForVideo(video, time)
        if (cancelled) return
        const metrics = extractFaceMetrics(result, video.videoWidth, video.videoHeight)
        const detection = engine.update(time, metrics)
        options.current.onObservation?.(detection, time)
        if (options.current.overlays) drawFace(canvas, video, result.faceLandmarks?.[0], connections, detection.state)
        else clearOverlay(canvas)
        fpsStart ??= time
        frameCount += 1
        if (time - fpsStart >= 1000) {
          fps = Math.round(frameCount * 1000 / (time - fpsStart))
          frameCount = 0
          fpsStart = time
        }
        options.current.onAlarmChange?.(detection.alarmActive)
        if (detection.alert || time - lastPublish >= 200) {
          lastPublish = time
          setView({ ...detection, landmarks: result.faceLandmarks?.[0]?.length || 0, fps, error: '' })
        }
      } catch (error) {
        clearOverlay(canvas)
        engine.resetContinuity()
        model?.close()
        model = null
        setView((previous) => ({ ...previous, phase: 'error', landmarks: 0, error: `AI processing stopped: ${error.message || 'unknown error'}. Try restarting AI.` }))
      }
      schedule()
    }

    async function initialize() {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        if (cancelled) return
        connections = FaceLandmarker
        const base = import.meta.env.BASE_URL
        const files = await FilesetResolver.forVisionTasks(`${base}wasm`)
        if (cancelled) return
        const config = {
          // WASM/CPU avoids very slow software-WebGL inference on laptops without
          // hardware acceleration. The camera feed remains entirely on-device.
          baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate: 'CPU' },
          runningMode: 'VIDEO', numFaces: 1,
          minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
          outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        }
        model = await FaceLandmarker.createFromOptions(files, config)
        if (cancelled) { model.close(); model = null; return }
        lastFrame = performance.now()
        setView((previous) => ({ ...previous, phase: 'calibrating', error: '' }))
        timer = window.setTimeout(loop, 0)
      } catch (error) {
        if (cancelled) return
        model?.close()
        model = null
        setView((previous) => ({ ...previous, phase: 'error', error: `Could not load the face model. ${error.message || ''} Run npm run prepare:ai if model assets are missing, then retry.` }))
      }
    }
    initialize()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      model?.close()
      model = null
      if (engineRef.current === engine) engineRef.current = null
      clearOverlay(canvas)
    }
  }, [stream, videoRef, canvasRef, attempt])

  return { ...view, recalibrate, retry }
}
