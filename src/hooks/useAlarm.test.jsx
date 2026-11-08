import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAlarm } from './useAlarm.js'

let contexts
beforeEach(() => {
  contexts = []
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal('AudioContext', class {
    constructor() { this.state = 'running'; this.sampleRate = 24000; this.currentTime = 10; this.destination = {}; this.sources = []; this.gains = []; contexts.push(this) }
    resume = vi.fn(async () => { this.state = 'running' })
    close = vi.fn(async () => { this.state = 'closed' })
    createBuffer(channels, length, rate) { const samples = new Float32Array(length); return { duration: length / rate, getChannelData: () => samples } }
    createBufferSource() {
      const node = { loop: false, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }
      this.sources.push(node)
      return node
    }
    createGain() {
      const node = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
      this.gains.push(node)
      return node
    }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function trigger(result, value = true) {
  await act(async () => { result.current.setAlarmActive(value) })
}

describe('continuous audible reminders', () => {
  it('loops natively until recovery, without restarting on repeated frames', async () => {
    const { result } = renderHook(useAlarm)
    await trigger(result)
    const context = contexts[0]
    expect(context.sources[0].loop).toBe(true)
    expect(context.sources[0].buffer.duration).toBeGreaterThan(2)
    expect(context.sources[0].stop).not.toHaveBeenCalled()
    expect(context.gains[0].gain.setValueAtTime.mock.calls[0][0]).toBeGreaterThan(0.5)
    await trigger(result)
    expect(context.sources).toHaveLength(1)
    await trigger(result, false)
    expect(context.sources[0].stop).toHaveBeenCalledOnce()
    expect(result.current.isPlaying).toBe(false)
    await trigger(result)
    expect(context.sources).toHaveLength(2)
  })

  it('continues while hidden and stops only when explicitly ended', async () => {
    const { result, unmount } = renderHook(useAlarm)
    await trigger(result)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(result.current.isPlaying).toBe(true)
    expect(contexts[0].sources[0].stop).not.toHaveBeenCalled()
    act(() => result.current.endSession())
    expect(result.current.isPlaying).toBe(false)
    unmount()
    expect(contexts[0].close).toHaveBeenCalledOnce()
  })

  it('mutes immediately and resumes a still-active alarm when unmuted', async () => {
    const { result } = renderHook(useAlarm)
    await trigger(result)
    act(() => result.current.toggleMute())
    expect(result.current.isPlaying).toBe(false)
    await trigger(result)
    expect(contexts[0].sources).toHaveLength(1)
    await act(async () => result.current.toggleMute())
    expect(contexts[0].sources).toHaveLength(2)
    expect(result.current.isPlaying).toBe(true)
  })

  it('respects manual Silence for the episode and rearms after recovery', async () => {
    const { result } = renderHook(useAlarm)
    await trigger(result)
    act(() => result.current.silence())
    await trigger(result)
    expect(result.current.isPlaying).toBe(false)
    expect(contexts[0].sources).toHaveLength(1)
    await trigger(result, false)
    await trigger(result)
    expect(result.current.isPlaying).toBe(true)
  })

  it('previews a finite sound, changes live volume, and resumes after volume zero', async () => {
    const { result } = renderHook(useAlarm)
    await act(() => result.current.testSound())
    expect(contexts[0].sources[0].loop).toBe(false)
    await trigger(result)
    act(() => result.current.setVolume(20))
    expect(contexts[0].gains.at(-1).gain.setValueAtTime).toHaveBeenLastCalledWith(0.13, 10)
    act(() => result.current.setVolume(0))
    expect(result.current.isPlaying).toBe(false)
    await act(() => result.current.testSound())
    expect(result.current.audioMessage).toContain('0%')
    await act(async () => result.current.setVolume(90))
    expect(result.current.isPlaying).toBe(true)
    expect(contexts[0].sources.at(-1).loop).toBe(true)
  })

  it('cancels a pending audio unlock on Stop', async () => {
    const { result } = renderHook(useAlarm)
    await act(() => result.current.testSound())
    contexts[0].state = 'suspended'
    let resolve
    contexts[0].resume.mockImplementation(() => new Promise((done) => { resolve = done }))
    act(() => result.current.setAlarmActive(true))
    act(() => result.current.endSession())
    await act(async () => { contexts[0].state = 'running'; resolve() })
    expect(contexts[0].sources).toHaveLength(1)
    expect(result.current.isPlaying).toBe(false)
  })
})
