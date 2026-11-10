import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { mockSupabase } from './helpers/supabase.mjs'

let backend
test.beforeEach(async ({ page }) => { backend = await mockSupabase(page) })

async function syntheticCamera(page, portrait = false) {
  if (portrait) {
    const bytes = await readFile(process.env.AI_FACE_FIXTURE)
    await page.route('**/__test_face.jpg', (route) => route.fulfill({ contentType: 'image/jpeg', body: bytes }))
  }
  await page.addInitScript(({ portrait }) => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context = canvas.getContext('2d')
        let image
        if (portrait) {
          image = new Image()
          image.src = '/__test_face.jpg'
          await image.decode()
        }
        window.__blankFrame = false
        const draw = () => {
          context.fillStyle = '#a0a0a0'
          context.fillRect(0, 0, 640, 480)
          if (image && !window.__blankFrame) {
            const scale = Math.min(640 / image.width, 480 / image.height)
            const width = image.width * scale
            const height = image.height * scale
            context.drawImage(image, (640 - width) / 2, (480 - height) / 2, width, height)
          }
        }
        draw()
        window.__fakeFrame = setInterval(draw, 50)
        const stream = canvas.captureStream(10)
        window.__testStream = stream
        return stream
      },
    })
  }, { portrait })
}

async function start(page) {
  await page.goto('/')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
}

test('loads real model assets, runs inference on a blank feed, and releases the camera', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await syntheticCamera(page)
  await start(page)
  await expect(page.getByText('No face detected. Move into view to begin calibration.')).toBeVisible({ timeout: 45000 })
  await expect(page.locator('.inference-rate')).not.toHaveText('— FPS', { timeout: 10000 })
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('alert')).toContainText('Alarm active · No face detected')
  await page.getByRole('switch', { name: 'Face and eye overlay' }).click()
  await page.getByRole('switch', { name: 'Mirror preview' }).click()
  await expect(page.locator('video')).not.toHaveClass('mirrored')
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click()
  await expect(page.getByText('Camera released successfully')).toBeVisible()
  await expect.poll(() => backend.saved.some((snapshot) => snapshot.status === 'completed' && snapshot.events.some((event) => event.kind === 'NO_FACE'))).toBe(true)
  expect(backend.saved.at(-1).events.filter((event) => event.kind === 'NO_FACE')).toHaveLength(1)
  expect(await page.evaluate(() => window.__testStream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true)
  expect(errors).toEqual([])
})

test('breaks stop the camera and alarm, failed resume stays paused, and new sessions use updated timings', async ({ page }) => {
  await syntheticCamera(page)
  await start(page)
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeVisible({ timeout: 45000 })
  const id = backend.saved[0].id
  await page.getByRole('combobox', { name: 'Break reason', exact: true }).selectOption('Lunch')
  await page.getByLabel('Break note (optional)').fill('Lunch with team')
  await page.getByRole('button', { name: 'Pause session', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeHidden()
  expect(await page.evaluate(() => window.__testStream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true)
  await expect.poll(() => backend.saved.some((row) => row.activity === 'paused' && row.id === id)).toBe(true)
  await page.getByRole('button', { name: 'Alert settings', exact: true }).click()
  await page.getByLabel('No face detected (seconds)').fill('6')
  await page.getByRole('button', { name: 'Save alert timings' }).click()
  await expect(page.getByText('Alert timings saved.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Return to session' }).click()
  await page.evaluate(() => {
    window.__originalCamera = navigator.mediaDevices.getUserMedia
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError') }
  })
  await page.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('denied')
  await expect(page.getByRole('button', { name: 'End session', exact: true })).toBeEnabled()
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__originalCamera })
  await page.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect(page.getByText('No face detected. Move into view to begin calibration.')).toBeVisible({ timeout: 45000 })
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click()
  await expect.poll(() => backend.saved.some((row) => row.id === id && row.status === 'completed')).toBe(true)
  const final = backend.saved.findLast((row) => row.id === id && row.status === 'completed')
  expect(final.thresholds.NO_FACE).toBe(3000)
  expect(final.breaks).toHaveLength(1)
  expect(final.breaks[0]).toMatchObject({ reason: 'Lunch', note: 'Lunch with team' })
  expect(final.break_ms).toBeGreaterThan(0)
  expect(Object.values(final.totals).reduce((a, b) => a + b, 0) + final.break_ms).toBe(final.duration_ms)
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect.poll(() => backend.saved.some((row) => row.id !== id && row.thresholds.NO_FACE === 6000)).toBe(true)
  await page.getByRole('button', { name: 'Pause session', exact: true }).click()
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await expect.poll(() => backend.saved.some((row) => row.id !== id && row.status === 'completed' && row.breaks[0]?.ended_at)).toBe(true)
})

test('shows an actionable AI error when model initialization fails', async ({ page }) => {
  await syntheticCamera(page)
  await page.route('**/models/face_landmarker.task', (route) => route.fulfill({ status: 404, body: 'Model not found' }))
  await start(page)
  await expect(page.getByRole('heading', { name: 'AI could not continue' })).toBeVisible({ timeout: 45000 })
  await expect(page.getByRole('button', { name: 'Restart AI' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click()
})

test('camera disconnection stops an active audio source and finalizes the session', async ({ page }) => {
  await syntheticCamera(page)
  await page.addInitScript(() => {
    const Native = window.AudioContext
    window.__stoppedSounds = 0
    window.AudioContext = class extends Native {
      createBufferSource() {
        const source = super.createBufferSource()
        const stop = source.stop.bind(source)
        source.stop = (...args) => { window.__stoppedSounds++; return stop(...args) }
        return source
      }
    }
  })
  await start(page)
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeVisible({ timeout: 45000 })
  expect(await page.evaluate(() => window.__stoppedSounds)).toBe(0)
  await page.evaluate(() => {
    const track = window.__testStream.getVideoTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeHidden()
  await expect(page.getByRole('alert')).toContainText('camera disconnected')
  expect(await page.evaluate(() => window.__stoppedSounds)).toBe(1)
  await expect.poll(() => backend.saved.some((snapshot) => snapshot.status === 'interrupted' && snapshot.events.some((event) => event.kind === 'NO_FACE' && event.ended_at))).toBe(true)
})

test('renders the louder alarm waveform, respects volume, and silences on mute', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args)
        const analyser = this.createAnalyser()
        analyser.fftSize = 2048
        analyser.connect(this.destination)
        window.__soundProbe = analyser
        const createGain = this.createGain.bind(this)
        this.createGain = () => {
          const gain = createGain()
          const connect = gain.connect.bind(gain)
          gain.connect = (node, ...ports) => connect(node === this.destination ? analyser : node, ...ports)
          return gain
        }
      }
    }
  })
  const peak = () => page.evaluate(() => {
    if (!window.__soundProbe) return 0
    const waveform = new Float32Array(window.__soundProbe.fftSize)
    window.__soundProbe.getFloatTimeDomainData(waveform)
    return Math.max(...waveform.map(Math.abs))
  })
  await page.goto('/')
  await expect(page.getByRole('slider', { name: 'Alert volume' })).toHaveValue('90')
  await page.getByRole('button', { name: 'Test sound', exact: true }).click()
  await expect.poll(peak).toBeGreaterThan(0.3)
  await page.getByRole('switch', { name: 'Sound reminders' }).click()
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeHidden()
  await expect.poll(peak).toBeLessThan(0.001)
  await page.getByRole('slider', { name: 'Alert volume' }).fill('20')
  await page.getByRole('button', { name: 'Test sound', exact: true }).click()
  await expect.poll(peak).toBeGreaterThan(0.03)
  expect(await peak()).toBeLessThan(0.2)
  await page.getByRole('button', { name: 'Silence', exact: true }).click()
  await expect.poll(peak).toBeLessThan(0.001)
})

test('detects a reference portrait, calibrates, and clears stale landmarks on face loss', async ({ page }) => {
  test.skip(!process.env.AI_FACE_FIXTURE, 'Set AI_FACE_FIXTURE to a local reference portrait to test real face landmarks.')
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await syntheticCamera(page, true)
  await start(page)
  await expect(page.getByText('478 points', { exact: true })).toBeVisible({ timeout: 45000 })
  await expect(page.getByRole('heading', { name: 'Screen-facing estimate', exact: true })).toBeVisible({ timeout: 20000 })
  const hasOverlay = await page.locator('canvas.face-overlay').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return data.some((value, index) => index % 4 === 3 && value > 0)
  })
  expect(hasOverlay).toBe(true)
  await page.evaluate(() => { window.__blankFrame = true })
  await expect(page.getByRole('heading', { name: 'No face detected', exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Recalibrate', exact: true }).click()
  await expect(page.getByText('No face detected. Move into view to begin calibration.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeVisible()
  await page.evaluate(() => { window.__blankFrame = false })
  await expect(page.getByRole('heading', { name: 'Screen-facing estimate', exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeHidden({ timeout: 5000 })
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click()
  expect(errors).toEqual([])
})
