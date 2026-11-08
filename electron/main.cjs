const { app, BrowserWindow, protocol, net, session } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const APP_ORIGIN = 'focuswatch://app'
const root = path.join(__dirname, '../dist')

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

async function createWindow() {
  const window = new BrowserWindow({
    width: 1380, height: 940, minWidth: 760, minHeight: 620,
    title: 'AI Object Visualizer', backgroundColor: '#111216',
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
