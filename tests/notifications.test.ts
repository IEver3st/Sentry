import { beforeEach, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { Settings } from '../src/shared/types'

const shown: FakeNotification[] = []
class FakeNotification extends EventEmitter {
  static isSupported = () => true
  constructor(readonly options: { title: string; body: string; icon: string }) { super() }
  show(): void { shown.push(this) }
}
const register = mock(async (_appId: string, _icon: string) => {})
mock.module('../src/main/notification-identity', () => ({ registerNotificationIdentity: register }))
mock.module('electron', () => ({
  app: new EventEmitter(), Notification: FakeNotification,
  BrowserWindow: class {}, Menu: {}, nativeImage: {}, Tray: class {}
}))
const { Background } = await import('../src/main/background')
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => { shown.length = 0; register.mockReset(); register.mockResolvedValue(undefined) })
function fixture() {
  const settings = { systemNotifications: true } as Settings
  const win = { isVisible: () => false, isMinimized: () => false, isFocused: () => false, show: mock(() => {}), focus: mock(() => {}) }
  const navigate = mock(() => {})
  const background = new Background({
    settings: () => settings, window: () => win as never, navigate,
    pickAndUpload() {}, checkForUpdates() {}, installUpdate() {},
    trayIcon: 'tray.ico', notificationIcon: 'sentry.png', appId: 'com.ever3st.sentry.dev'
  })
  return { background, settings, win, navigate }
}

test.skipIf(process.platform !== 'win32')('registers the sender before showing alerts, once per process, and preserves click navigation', async () => {
  let ready!: () => void
  register.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve }))
  const { background, win, navigate } = fixture()
  background.notify('Uploaded', 'One file', false, 'transfers')
  background.notify('Downloaded', 'One file')
  expect(shown).toHaveLength(0)
  expect(register).toHaveBeenCalledTimes(1)
  expect(register).toHaveBeenCalledWith('com.ever3st.sentry.dev', 'sentry.png')
  ready()
  await settle()
  expect(shown).toHaveLength(2)
  expect(shown[0].options.icon).toBe('sentry.png')
  shown[0].emit('click')
  expect(win.show).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith('transfers')
  background.notify('Updated', 'Ready')
  await settle()
  expect(register).toHaveBeenCalledTimes(1)
})

test.skipIf(process.platform !== 'win32')('honors notification settings before and after asynchronous registration', async () => {
  const { background, settings } = fixture()
  settings.systemNotifications = false
  background.notify('Hidden', 'Disabled')
  expect(register).not.toHaveBeenCalled()
  settings.systemNotifications = true
  let ready!: () => void
  register.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve }))
  background.notify('Hidden', 'Pending')
  settings.systemNotifications = false
  ready()
  await settle()
  expect(shown).toHaveLength(0)
})

test.skipIf(process.platform !== 'win32')('registry failures preserve alerts and allow a later registration retry', async () => {
  register.mockRejectedValueOnce(new Error('Registry unavailable'))
  const { background } = fixture()
  const warn = console.warn
  console.warn = () => {}
  try {
    background.notify('Uploaded', 'Done')
    await settle()
    expect(shown).toHaveLength(1)
    background.notify('Updated', 'Ready')
    await settle()
    expect(register).toHaveBeenCalledTimes(2)
    expect(shown).toHaveLength(2)
  } finally { console.warn = warn }
})
