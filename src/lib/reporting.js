export const REPORT_METRICS = ['sessions', 'session_ms', 'camera_ms', 'break_ms', 'on_screen_ms', 'eyes_closed_ms', 'looking_away_ms', 'no_face_ms', 'calibrating_ms', 'unknown_ms', 'eyes_closed_events', 'looking_away_events', 'no_face_events']
export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
export const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export function datePreset(days = 7, now = new Date()) {
  const first = new Date(now)
  first.setDate(first.getDate() - days + 1)
  return { from: dateKey(first), to: dateKey(now) }
}
export function reportArguments(from, to, staff = '') {
  if (!from || !to || from > to) throw new Error('Choose a valid start and end date.')
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error('Invalid report dates.')
  end.setDate(end.getDate() + 1)
  return { range_start: start.toISOString(), range_end: end.toISOString(), report_timezone: localTimezone(), staff_id: staff || null }
}
export function reportTotals(rows) {
  return rows.reduce((total, row) => {
    for (const key of REPORT_METRICS) total[key] += Number(row[key] || 0)
    return total
  }, Object.fromEntries(REPORT_METRICS.map((key) => [key, 0])))
}
export const eventTotal = (row) => Number(row.eyes_closed_events || 0) + Number(row.looking_away_events || 0) + Number(row.no_face_events || 0)
export function teamStatus(member, now = Date.now()) {
  if (!member.active) return 'Disabled'
  const latest = member.sessions?.[0]
  if (!latest) return 'No sessions'
  if (latest.status !== 'active') return 'Stopped'
  const seen = Date.parse(latest.synced_at || latest.last_seen_at)
  if (!Number.isFinite(seen) || now - seen > 60000) return 'Connection unknown'
  return latest.activity === 'paused' ? 'On break' : 'Monitoring'
}
function csvCell(value) {
  let text = String(value ?? '')
  // Names/notes must remain text when opened in spreadsheet software.
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function reportCsv(rows, timezone) {
  const headings = ['Session start date', 'Timezone', 'Staff ID', 'Staff name', 'Sessions', 'Session seconds', 'Camera seconds', 'Break seconds', 'Screen-facing seconds', 'Eyes-closed seconds', 'Looking-away seconds', 'No-face seconds', 'Calibrating seconds', 'Uncertain seconds', 'Eyes-closed events', 'Looking-away events', 'No-face events', 'Grouping basis']
  const lines = [headings, ...rows.map((row) => [row.day, timezone, row.user_id, row.full_name,
    ...REPORT_METRICS.map((key) => key.endsWith('_ms') ? Number(row[key] || 0) / 1000 : Number(row[key] || 0)), 'Entire sessions grouped by start date'])]
  return '\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
export function downloadReport(rows, timezone, from, to) {
  const url = URL.createObjectURL(new Blob([reportCsv(rows, timezone)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `FocusWatchAI-${from}-to-${to}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
