const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('focuswatchDesktop', Object.freeze({
  isDesktop: true,
  backgroundMonitoring: true,
  platform: process.platform,
}))
