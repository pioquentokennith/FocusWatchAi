import { useEffect, useState } from 'react'

export function useCameraDevices(stream) {
  const [devices, setDevices] = useState([])
  useEffect(() => {
    let cancelled = false
    const media = navigator.mediaDevices
    async function refresh() {
      try {
        const found = await media?.enumerateDevices?.()
        if (!cancelled) setDevices((found || []).filter((device) => device.kind === 'videoinput' && device.deviceId))
      } catch { if (!cancelled) setDevices([]) }
    }
    void refresh()
    media?.addEventListener?.('devicechange', refresh)
    return () => { cancelled = true; media?.removeEventListener?.('devicechange', refresh) }
  }, [stream])
  return devices
}
