const { app, BrowserWindow, protocol, net, session, ipcMain, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createGoogleCallback, validateGoogleUrl } = require('./google-auth.cjs')

const APP_ORIGIN = 'focuswatch://app'
const root = path.join(__dirname, '../dist')
// Allows automated desktop checks to use a disposable profile instead of the
// signed-in user's auth session and pending recording queue.
// Keep the pre-0.5 profile location despite the new visible product name.
app.setPath('userData', process.env.FOCUSWATCH_USER_DATA_DIR || path.join(app.getPath('appData'), app.isPackaged ? 'AI Object Visualizer' : 'ai-object-visualizer'))

protocol.registerSchemesAsPrivileged([
  { scheme: 'focuswatch', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])
// Windows occlusion and Chromium's hidden-page throttling must not pause the
// camera/inference timer when the user switches applications or minimizes us.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

function isAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'focuswatch:' && url.hostname === 'app' } catch { return false }
}

let googleFlow = null
function requireApp(event) {
  if (event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('Untrusted sign-in request')
}
ipcMain.handle('google:begin', async (event) => {
  requireApp(event)
  if (googleFlow) throw new Error('Google sign-in is already in progress. Cancel it before trying again.')
  const flow = { owner: event.sender.id, callback: null, opened: false }
  googleFlow = flow
  try {
    flow.callback = await createGoogleCallback()
    if (googleFlow !== flow) { flow.callback.cancel(); throw new Error('Google sign-in cancelled.') }
    return flow.callback.redirectTo
  } catch (error) { if (googleFlow === flow) googleFlow = null; throw error }
})
ipcMain.handle('google:open', async (event, url) => {
  requireApp(event)
  if (googleFlow?.owner !== event.sender.id || !googleFlow.callback || googleFlow.opened) throw new Error('Start a new Google sign-in first')
  const target = validateGoogleUrl(url, googleFlow.callback.redirectTo)
  googleFlow.opened = true
  await shell.openExternal(target)
})
ipcMain.handle('google:wait', async (event) => {
  requireApp(event)
  const flow = googleFlow
  if (flow?.owner !== event.sender.id || !flow.callback) throw new Error('No Google sign-in in progress')
  const result = await flow.callback.result
  if (googleFlow === flow) googleFlow = null
  const window = event.sender.isDestroyed() ? null : BrowserWindow.fromWebContents(event.sender)
  if (window && !window.isDestroyed()) { window.restore(); window.show(); window.focus() }
  return result
})
ipcMain.handle('google:cancel', (event) => {
  requireApp(event)
  if (googleFlow?.owner === event.sender.id) { googleFlow.callback?.cancel(); googleFlow = null }
})

async function createWindow() {
  const window = new BrowserWindow({
    width: 1380, height: 940, minWidth: 760, minHeight: 620,
    title: 'FocusWatchAI', backgroundColor: '#111216',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault() })
  const owner = window.webContents.id
  window.on('closed', () => {
    if (googleFlow?.owner === owner) { googleFlow.callback?.cancel(); googleFlow = null }
  })
  await window.loadURL(`${APP_ORIGIN}/`)
}

app.whenReady().then(async () => {
  app.setAppUserModelId('local.focuswatch.visualizer')
  protocol.handle('focuswatch', async (request) => {
    if (!isAppUrl(request.url) || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 })
    try {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!filename.startsWith(`${root}${path.sep}`)) return new Response('Not found', { status: 404 })
      return await net.fetch(pathToFileURL(filename).href)
    } catch {
      return new Response('Asset not found. Run npm run build.', { status: 404 })
    }
  })
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'media' && isAppUrl(contents.getURL()) && isAppUrl(details.requestingUrl) &&
      (details.mediaTypes || []).every((type) => type === 'video'))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    return permission === 'media' && isAppUrl(contents?.getURL() || '') &&
      (isAppUrl(origin) || isAppUrl(details.requestingUrl || '')) && details.mediaType !== 'audio'
  })
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => googleFlow?.callback?.cancel())
