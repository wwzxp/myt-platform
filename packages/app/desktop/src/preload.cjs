'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mytDesktop', {
  isDesktop: true,
  platform: process.platform,
  /** 内核崩溃/启动失败时，主进程推来的致命消息。 */
  onFatal: (callback) => {
    ipcRenderer.on('app/fatal', (_event, message) => callback(String(message)))
  },
})
