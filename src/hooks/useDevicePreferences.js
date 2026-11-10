import { useCallback, useEffect, useState } from 'react'
import { devicePreferences } from '../lib/settings.js'

export function useDevicePreferences(userId) {
  const key = `focuswatch.device.v1.${userId}`
  const [preferences, setPreferences] = useState(() => {
    try { return devicePreferences(JSON.parse(localStorage.getItem(key)) || {}) }
    catch { return devicePreferences() }
  })
  const [error, setError] = useState('')
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(preferences)); setError('') }
    catch { setError('Preferences work for this session, but could not be saved on this device.') }
  }, [key, preferences])
  const update = useCallback((changes) => {
    setPreferences((previous) => devicePreferences({ ...previous, ...changes }))
  }, [])
  return { preferences, update, error }
}
