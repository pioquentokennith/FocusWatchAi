import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { mockSupabase } from '../e2e/helpers/supabase.mjs'

const profiles = []
test.afterAll(async () => {
  for (const directory of profiles) await rm(directory, { recursive: true, force: true, maxRetries: 3 })
})

async function launch() {
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env
  const tempRoot = path.join(os.tmpdir(), 'opencode')
  await mkdir(tempRoot, { recursive: true })
  const userData = await mkdtemp(path.join(tempRoot, 'focuswatch-test-'))
  profiles.push(userData)
  const executablePath = process.env.AI_DESKTOP_EXE
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [path.resolve('.')]), '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream'],
    env: { ...env, FOCUSWATCH_USER_DATA_DIR: userData },
  })
  const page = await application.firstWindow()
  await mockSupabase(page)
  await page.reload()
  await page.waitForURL('focuswatch://app/')
  await expect(page.getByText('Desktop · Background ready')).toBeVisible()
  // Analyse real generated audio without playing test alarms on the user's speakers.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true))
  await page.evaluate(() => {
    const Native = window.AudioContext
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args)
        const analyser = this.createAnalyser()
        analyser.fftSize = 2048
        analyser.connect(this.destination)
        window.__soundProbe = analyser
        window.__audioSources = []
        const createSource = this.createBufferSource.bind(this)
        this.createBufferSource = () => { const source = createSource(); window.__audioSources.push(source); return source }
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
  return { application, page }
}

const peak = (page) => page.evaluate(() => {
  if (!window.__soundProbe) return 0
  const data = new Float32Array(window.__soundProbe.fftSize)
  window.__soundProbe.getFloatTimeDomainData(data)
  return Math.max(...data.map(Math.abs))
})

// Read through the main process while minimized. Renderer automation helpers
// may activate a native window; executeJavaScript does not request focus.
const readBackground = (application, expression) => application.evaluate(async ({ BrowserWindow }, script) => {
  const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().startsWith('focuswatch:'))
  return window.webContents.executeJavaScript(script)
}, expression)

test('native camera inference starts an initial no-face alarm while minimized and keeps it repeating', async () => {
  const { application, page } = await launch()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Start camera', exact: true }).click()
    await expect(page.getByText('Camera live', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('No face detected. Move into view to begin calibration.')).toBeVisible({ timeout: 45000 })
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      globalThis.__windowEvents = []
      for (const name of ['minimize', 'restore', 'show', 'hide', 'focus', 'blur']) {
        window.on(name, () => globalThis.__windowEvents.push({ name, at: Date.now() }))
      }
    })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true)
    await expect.poll(() => readBackground(application, 'document.querySelector(".detection-alert")?.textContent || ""'), { timeout: 45000 }).toContain('Alarm active · No face detected')
    await expect.poll(() => readBackground(application, 'parseFloat(document.querySelector(".episode-timer strong")?.textContent || "0")'), { timeout: 15000 }).toBeGreaterThan(8)
    await expect.poll(() => readBackground(application, '(() => { const data = new Float32Array(window.__soundProbe.fftSize); window.__soundProbe.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); })()')).toBeGreaterThan(0.3)
    expect(await readBackground(application, 'window.__audioSources.length')).toBe(1)
    expect(await readBackground(application, 'window.__audioSources[0].loop')).toBe(true)
    const windowState = await application.evaluate(({ BrowserWindow }) => ({ minimized: BrowserWindow.getAllWindows()[0].isMinimized(), events: globalThis.__windowEvents }))
    expect(windowState.minimized, JSON.stringify(windowState.events)).toBe(true)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Stop camera').click())
    await expect(page.getByText('Camera released successfully')).toBeVisible()
    await expect.poll(() => peak(page)).toBeLessThan(0.001)
    expect(errors).toEqual([])
  } finally { await application.close() }
})

test('recovers and rearms while another application window has focus', async () => {
  test.skip(!process.env.AI_FACE_FIXTURE, 'Set AI_FACE_FIXTURE to test face recovery with a reference portrait.')
  const { application, page } = await launch()
  const portrait = (await readFile(process.env.AI_FACE_FIXTURE)).toString('base64')
  try {
    await page.evaluate((imageData) => {
      window.__blankFrame = true
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${imageData}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context = canvas.getContext('2d')
        const scale = Math.min(640 / image.width, 480 / image.height)
        const draw = () => {
          context.fillStyle = '#a0a0a0'
          context.fillRect(0, 0, 640, 480)
          if (!window.__blankFrame) context.drawImage(image, (640 - image.width * scale) / 2, (480 - image.height * scale) / 2, image.width * scale, image.height * scale)
        }
        draw()
        window.__drawTimer = setInterval(draw, 50)
        window.__testStream = canvas.captureStream(10)
        return window.__testStream
      } })
    }, portrait)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Start camera', exact: true }).click()
    await application.evaluate(async ({ BrowserWindow }) => {
      const other = new BrowserWindow({ width: 600, height: 450, title: 'Other application window', webPreferences: { nodeIntegration: false, contextIsolation: true } })
      await other.loadURL('data:text/html,<h1>Another window has focus</h1>')
      other.focus()
    })
    await expect(page.getByRole('alert')).toContainText('Alarm active · No face detected', { timeout: 45000 })
    await page.evaluate(() => { window.__blankFrame = false })
    await expect(page.getByRole('heading', { name: 'Screen-facing estimate', exact: true })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeHidden({ timeout: 5000 })
    await expect.poll(() => peak(page)).toBeLessThan(0.001)
    await page.evaluate(() => { window.__blankFrame = true })
    await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeVisible({ timeout: 10000 })
    expect(await page.evaluate(() => window.__audioSources.length)).toBe(2)
    await page.evaluate(() => { window.__blankFrame = false })
    await expect(page.getByRole('button', { name: 'Silence', exact: true })).toBeHidden({ timeout: 10000 })
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('focuswatch:')).isFocused())).toBe(false)
  } finally { await application.close() }
})
