import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeamMembers from './TeamMembers.jsx'
import { supabase } from '../lib/supabase.js'

vi.mock('../lib/supabase.js', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

let member
beforeEach(() => {
  vi.useFakeTimers()
  member = { id: 'staff', full_name: 'Original name', email: 'staff@example.test', active: true, sessions: [] }
  supabase.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: [{ ...member }], error: null }) }
    return query
  })
  supabase.rpc.mockResolvedValue({ error: null })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const refresh = () => act(async () => { await vi.advanceTimersByTimeAsync(30000) })

describe('staff edit conflicts', () => {
  it('updates clean fields after a server refresh instead of restoring stale values on Save', async () => {
    await act(async () => { render(<TeamMembers />) })
    member = { ...member, full_name: 'Latest name', active: false }
    await refresh()
    expect(screen.getByLabelText('Display name').value).toBe('Latest name')
    expect(screen.getByLabelText('Account enabled').checked).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save staff account' })) })
    expect(supabase.rpc).toHaveBeenCalledWith('update_staff', {
      staff_id: 'staff', display_name: 'Latest name', enabled: false,
      expected_display_name: 'Latest name', expected_enabled: false,
    })
  })

  it('preserves unsaved edits and blocks conflicting saves until the latest details are loaded', async () => {
    await act(async () => { render(<TeamMembers />) })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My draft' } })
    member = { ...member, active: false }
    await refresh()
    expect(screen.getByLabelText('Display name').value).toBe('My draft')
    expect(screen.getByRole('alert').textContent).toContain('changed while you were editing')
    expect(screen.getByRole('button', { name: 'Save staff account' }).disabled).toBe(true)
    expect(supabase.rpc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load latest details' }))
    expect(screen.getByLabelText('Display name').value).toBe('Original name')
    expect(screen.getByLabelText('Account enabled').checked).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('refreshes a server-detected conflict that occurred before the next poll', async () => {
    await act(async () => { render(<TeamMembers />) })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My draft' } })
    member = { ...member, active: false }
    supabase.rpc.mockResolvedValueOnce({ error: { code: '40001', message: 'This staff account changed. Load the latest details before saving.' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save staff account' })) })
    expect(screen.getByRole('alert').textContent).toContain('changed while you were editing')
    expect(screen.getByLabelText('Display name').value).toBe('My draft')
    expect(screen.getByRole('button', { name: 'Save staff account' }).disabled).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })
})
