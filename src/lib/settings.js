export const DEFAULT_THRESHOLDS = Object.freeze({ EYES_CLOSED: 3000, LOOKING_AWAY: 3000, NO_FACE: 3000 })
export const ALERT_NAMES = { EYES_CLOSED: 'Eyes closed', LOOKING_AWAY: 'Looking away', NO_FACE: 'No face detected' }
export const BREAK_REASONS = ['Lunch', 'Personal', 'Meeting', 'Other']

export function validThresholds(value) {
  return value && Object.keys(value).length === 3 && Object.keys(DEFAULT_THRESHOLDS).every((key) =>
    Number.isInteger(value[key]) && value[key] >= 1000 && value[key] <= 60000 && value[key] % 1000 === 0)
}

export function normalizeThresholds(value) {
  return { ...(validThresholds(value) ? value : DEFAULT_THRESHOLDS) }
}

export const DEFAULT_DEVICE_PREFERENCES = { cameraId: '', volume: 90, muted: false, mirrored: true, overlays: true }
export function devicePreferences(value = {}) {
  return {
    cameraId: typeof value.cameraId === 'string' ? value.cameraId : '',
    volume: Number.isFinite(value.volume) ? Math.max(0, Math.min(100, value.volume)) : 90,
    muted: typeof value.muted === 'boolean' ? value.muted : false,
    mirrored: typeof value.mirrored === 'boolean' ? value.mirrored : true,
    overlays: typeof value.overlays === 'boolean' ? value.overlays : true,
  }
}
