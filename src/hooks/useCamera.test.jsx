import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCamera } from './useCamera.js'

function mockStream() {
  const track = { stop: vi.fn(), getSettings: () => ({ width: 640, height: 480 }), readyState: 'live', onended: null }
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } }
}

function mockCamera(getUserMedia) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
}

afterEach(cleanup)

describe('camera lifecycle', () => {
  it('requests the selected camera exactly and returns its stream only after success', async () => {
    const { stream } = mockStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    mockCamera(getUserMedia)
    const { result } = renderHook(useCamera)
    await act(async () => expect(await result.current.start('usb-camera')).toBe(stream))
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, deviceId: { exact: 'usb-camera' } } })
  })
  it('requests video only and releases the track on Stop', async () => {
    const { stream, track } = mockStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    mockCamera(getUserMedia)
    const { result } = renderHook(useCamera)
    await act(() => result.current.start())
    expect(result.current.status).toBe('live')
    expect(result.current.resolution).toBe('640 × 480')
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
    act(() => result.current.stop())
    expect(track.stop).toHaveBeenCalledOnce()
    expect(result.current.stream).toBe(null)
    expect(result.current.status).toBe('stopped')
  })

  it('releases a late permission result without restarting a stopped session', async () => {
    let resolve
    const { stream, track } = mockStream()
    mockCamera(vi.fn(() => new Promise((done) => { resolve = done })))
    const { result } = renderHook(useCamera)
    let pending
    act(() => { pending = result.current.start() })
    act(() => result.current.stop())
    await act(async () => { resolve(stream); await pending })
    expect(result.current.status).toBe('stopped')
    expect(result.current.stream).toBe(null)
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('prevents duplicate permission requests', async () => {
    let resolve
    const { stream } = mockStream()
    const getUserMedia = vi.fn(() => new Promise((done) => { resolve = done }))
    mockCamera(getUserMedia)
    const { result } = renderHook(useCamera)
    let pending
    act(() => { pending = result.current.start(); result.current.start() })
    expect(getUserMedia).toHaveBeenCalledOnce()
    await act(async () => { resolve(stream); await pending })
  })

  it('explains permission denial and allows retry', async () => {
    const { stream } = mockStream()
    const getUserMedia = vi.fn().mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError')).mockResolvedValueOnce(stream)
    mockCamera(getUserMedia)
    const { result } = renderHook(useCamera)
    await act(() => result.current.start())
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('site settings')
    await act(() => result.current.start())
    expect(result.current.status).toBe('live')
    expect(result.current.error).toBe('')
  })

  it('handles an unplugged camera and releases resources', async () => {
    const { stream, track } = mockStream()
    mockCamera(vi.fn().mockResolvedValue(stream))
    const { result } = renderHook(useCamera)
    await act(() => result.current.start())
    act(() => track.onended())
    expect(result.current.status).toBe('error')
    expect(result.current.stream).toBe(null)
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('releases camera resources on unmount', async () => {
    const { stream, track } = mockStream()
    mockCamera(vi.fn().mockResolvedValue(stream))
    const { result, unmount } = renderHook(useCamera)
    await act(() => result.current.start())
    unmount()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(track.onended).toBe(null)
  })
})
