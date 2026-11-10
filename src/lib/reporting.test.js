import { describe, expect, it } from 'vitest'
import { datePreset, reportArguments, reportCsv, reportTotals, teamStatus } from './reporting.js'
import { devicePreferences, normalizeThresholds, validThresholds } from './settings.js'

describe('daily reporting and preferences', () => {
  it('uses local inclusive date presets and an exclusive next-day report boundary', () => {
    expect(datePreset(7, new Date(2026, 10, 9, 15))).toEqual({ from: '2026-11-03', to: '2026-11-09' })
    const args = reportArguments('2026-11-03', '2026-11-09', 'staff')
    expect(new Date(args.range_end).getDate()).toBe(10)
    expect(args.staff_id).toBe('staff')
    expect(() => reportArguments('2026-11-10', '2026-11-09')).toThrow(/valid/)
  })
  it('totals every row and produces escaped spreadsheet-safe UTF-8 CSV', () => {
    const rows = Array.from({ length: 32 }, (_, index) => ({ day: '2026-11-09', user_id: `staff-${index}`, full_name: '=SUM(1,2)"\nname', sessions: 2, camera_ms: 2500, break_ms: 1000 }))
    expect(reportTotals(rows)).toMatchObject({ sessions: 64, camera_ms: 80000, break_ms: 32000 })
    const csv = reportCsv(rows, 'UTC')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\'=SUM(1,2)""\nname"')
    expect(csv).toContain('"staff-31"')
    expect(csv).toContain('"2.5","1"')
    expect(csv).toContain('Entire sessions grouped by start date')
  })
  it('marks stale active sessions unknown and respects paused, completed, and disabled states', () => {
    const member = { active: true, sessions: [{ status: 'active', activity: 'paused', synced_at: new Date(100000).toISOString() }] }
    expect(teamStatus(member, 150000)).toBe('On break')
    expect(teamStatus(member, 161000)).toBe('Connection unknown')
    member.sessions[0].status = 'completed'
    expect(teamStatus(member, 161000)).toBe('Stopped')
    member.active = false
    expect(teamStatus(member, 161000)).toBe('Disabled')
  })
  it('rejects invalid timing shapes and sanitizes device preferences', () => {
    expect(validThresholds({ EYES_CLOSED: 1000, LOOKING_AWAY: 60000, NO_FACE: 3000 })).toBe(true)
    for (const value of [null, {}, { EYES_CLOSED: 1500, LOOKING_AWAY: 3000, NO_FACE: 3000 }, { EYES_CLOSED: 0, LOOKING_AWAY: 3000, NO_FACE: 3000 }]) expect(validThresholds(value)).toBeFalsy()
    expect(normalizeThresholds({ NO_FACE: 0 }).NO_FACE).toBe(3000)
    expect(devicePreferences({ volume: 500, mirrored: 'yes', cameraId: 123 })).toMatchObject({ volume: 100, mirrored: true, cameraId: '' })
  })
})
