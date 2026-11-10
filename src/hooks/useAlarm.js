import { useCallback, useEffect, useRef, useState } from 'react'

function createPattern(context) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2.4), context.sampleRate)
  const samples = buffer.getChannelData(0)
  let phase = 0
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / context.sampleRate
    const pulse = Math.floor(time / 0.6)
    const local = time - pulse * 0.6
    const frequency = pulse % 2 ? 660 : 880
    phase += 2 * Math.PI * frequency / context.sampleRate
    const envelope = local < 0.03 ? local / 0.03 : local < 0.36 ? 1 : local < 0.48 ? (0.48 - local) / 0.12 : 0
    samples[index] = 2 / Math.PI * Math.asin(Math.sin(phase)) * envelope
  }
  return buffer
}

export function useAlarm({ initialVolume = 90, initialMuted = false } = {}) {
  const audio = useRef(null)
  const pattern = useRef(null)
  const active = useRef(null)
  const enabled = useRef(!initialMuted)
  const wanted = useRef(false)
  const dismissed = useRef(false)
  const pending = useRef(false)
  const level = useRef(initialVolume)
  const generation = useRef(0)
  const mounted = useRef(true)
  const restart = useRef(null)
  const [muted, setMuted] = useState(initialMuted)
  const [volume, setVolumeState] = useState(initialVolume)
  const [audioMessage, setAudioMessage] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)

  const stopPlayback = useCallback(() => {
    generation.current += 1
    pending.current = false
    const playing = active.current
    active.current = null
    if (playing) {
      playing.output.disconnect()
      try { playing.source.stop() } catch { /* Already ended. */ }
    }
    if (mounted.current) setIsPlaying(false)
  }, [])

  const unlock = useCallback(async () => {
    const token = generation.current
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) throw new Error('Audio is unavailable in this browser.')
      if (!audio.current || audio.current.state === 'closed') {
        audio.current = new AudioContext()
        pattern.current = null
      }
      const context = audio.current
      if (context.state === 'suspended') await context.resume()
      if (!mounted.current || token !== generation.current) return false
      if (context.state !== 'running') throw new Error('Sound is blocked.')
      setAudioMessage('')
      return true
    } catch {
      if (mounted.current && token === generation.current) setAudioMessage('Sound unavailable or blocked. Select Test sound and check the app or browser audio permissions.')
      return false
    }
  }, [])

  const playPattern = useCallback((loop) => {
    const context = audio.current
    if (!context || context.state !== 'running' || !mounted.current) return
    if (level.current === 0) {
      setAudioMessage('Alert volume is 0%. Raise the volume slider to hear the alarm.')
      return
    }
    stopPlayback()
    pattern.current ??= createPattern(context)
    const source = context.createBufferSource()
    const output = context.createGain()
    source.buffer = pattern.current
    source.loop = loop
    output.gain.setValueAtTime(0.65 * level.current / 100, context.currentTime)
    source.connect(output)
    output.connect(context.destination)
    const playing = { source, output, loop }
    active.current = playing
    source.onended = () => {
      source.disconnect()
      output.disconnect()
      if (active.current === playing) {
        active.current = null
        if (mounted.current) {
          setIsPlaying(false)
          restart.current?.()
        }
      }
    }
    // A native looping AudioBufferSource runs on the audio thread. It does not
    // depend on JavaScript timers, animation frames, or window visibility.
    source.start()
    setAudioMessage('')
    setIsPlaying(true)
  }, [stopPlayback])

  const startAutomatic = useCallback(async () => {
    if (!mounted.current || !wanted.current || !enabled.current || dismissed.current || level.current === 0 || active.current?.loop || pending.current) return
    pending.current = true
    const token = generation.current
    const ready = await unlock()
    if (token !== generation.current) return
    pending.current = false
    if (ready && wanted.current && enabled.current && !dismissed.current) playPattern(true)
  }, [unlock, playPattern])

  useEffect(() => { restart.current = startAutomatic }, [startAutomatic])

  const setAlarmActive = useCallback((value) => {
    if (wanted.current === value) return
    wanted.current = value
    dismissed.current = false
    if (value) startAutomatic()
    else stopPlayback()
  }, [startAutomatic, stopPlayback])

  const silence = useCallback(() => {
    dismissed.current = true
    stopPlayback()
  }, [stopPlayback])

  const testSound = useCallback(async () => {
    stopPlayback()
    if (await unlock()) playPattern(wanted.current && enabled.current && !dismissed.current)
  }, [unlock, playPattern, stopPlayback])

  const toggleMute = useCallback(() => {
    enabled.current = !enabled.current
    setMuted(!enabled.current)
    if (!enabled.current) stopPlayback()
    else {
      dismissed.current = false
      if (wanted.current) startAutomatic()
      else unlock()
    }
  }, [stopPlayback, startAutomatic, unlock])

  const setVolume = useCallback((value) => {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    level.current = Math.max(0, Math.min(100, next))
    setVolumeState(level.current)
    if (active.current && audio.current) active.current.output.gain.setValueAtTime(0.65 * level.current / 100, audio.current.currentTime)
    if (level.current === 0) stopPlayback()
    else { setAudioMessage(''); if (wanted.current && !active.current) startAutomatic() }
  }, [stopPlayback, startAutomatic])

  const endSession = useCallback(() => {
    wanted.current = false
    dismissed.current = false
    stopPlayback()
  }, [stopPlayback])
  const beginSession = useCallback(() => { endSession(); unlock() }, [unlock, endSession])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      wanted.current = false
      stopPlayback()
      const context = audio.current
      audio.current = null
      pattern.current = null
      if (context && context.state !== 'closed') context.close().catch(() => {})
    }
  }, [stopPlayback])

  return { muted, volume, setVolume, isPlaying, audioMessage, beginSession, endSession, setAlarmActive, silence, testSound, toggleMute }
}
