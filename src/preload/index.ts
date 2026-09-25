import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { SentryApi, SentryEvents } from '@shared/types'

const call =
  (name: string) =>
  (...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(`sentry:${name}`, ...args)

const methods = [
  'bootstrap', 'rendererReady', 'updateSettings', 'resetApp', 'connect', 'disconnect', 'importGoogleClient', 'cancelGoogleSignIn', 'quota', 'get', 'list', 'recent', 'search', 'shared',
  'createFolder', 'rename', 'trash', 'move', 'toggleStar', 'setLink', 'pickLocal', 'pickDirectory', 'upload', 'download',
  'cancelTransfer', 'clearTransfers', 'transfers', 'revealLocal', 'openExternal', 'copyText', 'setWindowColors', 'updateStatus', 'checkForUpdates', 'downloadUpdate', 'installUpdate', 'shellIntegration', 'setShellIntegration', 'openLocal', 'trashLocal', 'lastLocalScan', 'forgetLocalScan', 'scanDrive', 'scanLocal', 'cancelScan'
] as const

const api = Object.fromEntries(methods.map((m) => [m, call(m)])) as unknown as SentryApi

api.pathForFile = (file: File) => webUtils.getPathForFile(file)
api.setZoom = (factor: number) => webFrame.setZoomFactor(factor)
api.on = <K extends keyof SentryEvents>(event: K, listener: (payload: SentryEvents[K]) => void) => {
  const channel = `sentry:event:${event}`
  const wrapped = (_e: Electron.IpcRendererEvent, payload: SentryEvents[K]): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('sentry', api)
