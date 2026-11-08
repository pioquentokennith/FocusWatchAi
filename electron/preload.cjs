const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('focuswatchDesktop', Object.freeze({
  isDesktop: true,
  backgroundMonitoring: true,
  platform: process.platform,
  beginGoogleSignIn: () => ipcRenderer.invoke('google:begin'),
  openGoogleSignIn: (url) => ipcRenderer.invoke('google:open', url),
  waitForGoogleSignIn: () => ipcRenderer.invoke('google:wait'),
  cancelGoogleSignIn: () => ipcRenderer.invoke('google:cancel'),
}))
