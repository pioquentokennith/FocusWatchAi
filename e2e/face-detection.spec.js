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

test('shows an actionable AI error when model initialization fails', async ({ page }) => {
  await syntheticCamera(page)
  await page.route('**/models/face_landmarker.task', (route) => route.fulfill({ status: 404, body: 'Model not found' }))
  await start(page)
  await expect(page.getByRole('heading', { name: 'AI could not continue' })).toBeVisible({ timeout: 45000 })
  await expect(page.getByRole('button', { name: 'Restart AI' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click()
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
