import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { Settings, UpdateStatus } from '../src/shared/types'

const autoUpdater = Object.assign(new EventEmitter(), { checkForUpdates: async () => undefined })
mock.module('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.1.0' } }))
mock.module('electron-updater', () => ({ default: { autoUpdater } }))
const { Updater } = await import('../src/main/updater')

test('settings edits preserve one update schedule and disabling clears the pending first check', () => {
  const originals = { setTimeout, clearTimeout, setInterval, clearInterval }
  const timers = new Set<object>()
  const create = () => {
    const timer = { unref() { return this } }
    timers.add(timer)
    return timer
  }
  globalThis.setTimeout = create as unknown as typeof setTimeout
  globalThis.setInterval = create as unknown as typeof setInterval
  globalThis.clearTimeout = ((timer: object) => { timers.delete(timer) }) as unknown as typeof clearTimeout
  globalThis.clearInterval = ((timer: object) => { timers.delete(timer) }) as unknown as typeof clearInterval
  let settings = { autoCheckUpdates: true, autoDownloadUpdates: true, installOnQuit: true, betaUpdates: false } as Settings
  const updater = new Updater(() => settings, () => {}, () => {})
  try {
    updater.apply()
    const first = [...timers]
    for (let i = 0; i < 100; i++) updater.apply()
    expect([...timers]).toEqual(first)
    expect(timers.size).toBe(2)
    settings = { ...settings, autoCheckUpdates: false }
    updater.apply()
    expect(timers.size).toBe(0)
    settings = { ...settings, autoCheckUpdates: true }
    updater.apply()
    expect(timers.size).toBe(2)
    updater.dispose()
    expect(timers.size).toBe(0)
  } finally {
    updater.dispose()
    Object.assign(globalThis, originals)
    autoUpdater.removeAllListeners()
  }
})

test('identical rounded update progress does not rebuild the tray or notify the UI', () => {
  const updates: UpdateStatus[] = []
  const updater = new Updater(() => ({} as Settings), (status) => { updates.push(status) }, () => {})
  try {
    autoUpdater.emit('download-progress', { percent: 10.1 })
    autoUpdater.emit('download-progress', { percent: 10.3 })
    autoUpdater.emit('download-progress', { percent: 11.2 })
    expect(updates.map((status) => status.progress)).toEqual([10, 11])
  } finally { updater.dispose(); autoUpdater.removeAllListeners() }
})
