import { useCallback, useEffect, useRef, useState } from 'react'

const messages = {
  NotAllowedError: 'Camera access was denied. Allow camera access in your browser’s site settings, then try again.',
  NotFoundError: 'No camera was found. Connect a webcam and try again.',
  NotReadableError: 'The camera could not start. Close other apps using it, check your system camera permissions, and try again.',
  OverconstrainedError: 'This camera cannot use the requested video settings. Try another webcam.',
  SecurityError: 'Your browser blocked camera access. Open this page on localhost or HTTPS and check site permissions.',
  AbortError: 'Camera startup was interrupted. Please try again.',
}

function release(stream) {
  stream?.getTracks().forEach((track) => {
    track.onended = null
    track.stop()
  })
}

export function useCamera() {
  const [status, setStatus] = useState('idle')
  const [stream, setStream] = useState(null)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [resolution, setResolution] = useState(null)
  const activeStream = useRef(null)
  const generation = useRef(0)
  const starting = useRef(false)
  const startedAt = useRef(null)

  const finishTiming = useCallback(() => {
    if (startedAt.current !== null) {
      setElapsed(Math.floor((performance.now() - startedAt.current) / 1000))
      startedAt.current = null
    }
  }, [])

  const stop = useCallback(() => {
    generation.current += 1
    starting.current = false
    release(activeStream.current)
    activeStream.current = null
    finishTiming()
    setStream(null)
    setResolution(null)
    setError('')
    setStatus('stopped')
  }, [finishTiming])

  const start = useCallback(async () => {
    if (starting.current || activeStream.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is unavailable. Use a supported browser on localhost or HTTPS.')
      setStatus('error')
      return
    }

    const request = ++generation.current
    starting.current = true
    setStatus('requesting')
    setError('')
    setElapsed(0)
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      })

      // Permission can resolve after Stop, a newer request, or component teardown.
      if (generation.current !== request) {
        release(nextStream)
        return
      }

      const track = nextStream.getVideoTracks()[0]
      if (!track || track.readyState === 'ended') {
        release(nextStream)
        throw new Error('The camera disconnected before it could start. Reconnect it and try again.')
      }
      activeStream.current = nextStream
      track.onended = () => {
        if (generation.current !== request) return
        generation.current += 1
        release(activeStream.current)
        activeStream.current = null
        finishTiming()
        setStream(null)
        setResolution(null)
        setError('The camera disconnected or access was revoked. Check your camera and try again.')
        setStatus('error')
      }
      const settings = track.getSettings()
      setResolution(settings.width && settings.height ? `${settings.width} × ${settings.height}` : null)
      startedAt.current = performance.now()
      setStream(nextStream)
      setStatus('live')
    } catch (cause) {
      if (generation.current !== request) return
      setError(messages[cause.name] || cause.message || 'The camera could not start. Please try again.')
      setStatus('error')
    } finally {
      if (generation.current === request) starting.current = false
    }
  }, [finishTiming])

  useEffect(() => {
    if (status !== 'live') return
    const id = window.setInterval(() => {
      if (startedAt.current !== null) {
        setElapsed(Math.floor((performance.now() - startedAt.current) / 1000))
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [status])

  useEffect(() => () => {
    generation.current += 1
    starting.current = false
    release(activeStream.current)
    activeStream.current = null
  }, [])

  return { status, stream, error, elapsed, resolution, start, stop }
}
