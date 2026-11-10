import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStaffSettings } from './useStaffSettings.js'

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('../lib/supabase.js', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ({ abortSignal: api.load }) }) }) }),
  rpc: (...args) => ({ abortSignal: () => api.save(...args) }),
} }))
beforeEach(() => { localStorage.clear(); vi.resetAllMocks() })
afterEach(cleanup)

describe('personal cloud timings', () => {
  it('uses defaults for a new staff account and caches confirmed settings', async () => {
    api.load.mockResolvedValue({ data: null, error: null })
    api.save.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useStaffSettings('staff-one'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.thresholds.NO_FACE).toBe(3000)
    const next = { EYES_CLOSED: 1000, LOOKING_AWAY: 60000, NO_FACE: 4000 }
    await act(() => result.current.save(next))
    expect(result.current.thresholds).toEqual(next)
    expect(JSON.parse(localStorage.getItem('focuswatch.settings.v1.staff-one'))).toEqual(next)
    expect(api.save).toHaveBeenCalledWith('update_my_alert_settings', { alert_thresholds: next })
  })

  it('uses only this staff member’s valid cache when offline and blocks startup without it', async () => {
    api.load.mockRejectedValue(new Error('Offline'))
    localStorage.setItem('focuswatch.settings.v1.staff-one', JSON.stringify({ EYES_CLOSED: 1000, LOOKING_AWAY: 2000, NO_FACE: 4000 }))
    const one = renderHook(() => useStaffSettings('staff-one'))
    await waitFor(() => expect(one.result.current.ready).toBe(true))
    expect(one.result.current.error).toContain('last saved')
    one.unmount()
    const two = renderHook(() => useStaffSettings('staff-two'))
    await waitFor(() => expect(two.result.current.error).toContain('Retry before starting'))
    expect(two.result.current.ready).toBe(false)
    expect(two.result.current.thresholds.NO_FACE).toBe(3000)
  })

  it('keeps the last confirmed timings after a failed save', async () => {
    api.load.mockResolvedValue({ data: null, error: null })
    api.save.mockResolvedValue({ error: new Error('Offline') })
    const { result } = renderHook(() => useStaffSettings('staff-one'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await expect(result.current.save({ EYES_CLOSED: 5000, LOOKING_AWAY: 5000, NO_FACE: 5000 })).rejects.toThrow('Offline') })
    expect(result.current.thresholds.NO_FACE).toBe(3000)
    expect(result.current.saving).toBe(false)
    expect(JSON.parse(localStorage.getItem('focuswatch.settings.v1.staff-one')).NO_FACE).toBe(3000)
  })
})
