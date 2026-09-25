import assert from 'node:assert/strict'
import { app } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Run with Electron after building. Use actual native visibility, never capture's
// forced-active shortcut. An invisible, unfocused window protects the desktop.
const profile = mkdtempSync(join(tmpdir(), 'sentry-lifecycle-'))
app.setPath('userData', profile)
app.requestSingleInstanceLock = () => true
app.setLoginItemSettings = () => {}
writeFileSync(join(profile, 'settings.json'), JSON.stringify({
  onboarded: true, provider: 'demo', showTray: false, launchAtLogin: false,
  autoCheckUpdates: false, bootAnimation: false, systemNotifications: false
}))

app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0)
  win.setSkipTaskbar(true)
  win.setBounds({ x: -30000, y: -30000, width: 1000, height: 700 })
  win.show = () => win.showInactive()
  const loadFile = win.loadFile.bind(win)
  win.loadFile = (path, options) => loadFile(path, { ...options, query: { ...options?.query, capture: '1' } })
  const loadURL = win.loadURL.bind(win)
  win.loadURL = (url, options) => {
    const parsed = new URL(url)
    parsed.searchParams.set('capture', '1')
    return loadURL(parsed.toString(), options)
  }
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const waitFor = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return
      await delay(100)
    }
    throw new Error(`Timed out: ${code}`)
  }
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        await waitFor('Boolean(window.__sentry?.useApp.getState().quota && window.__sentry.useApp.getState().maps.drive)')
        assert.equal(await js('window.__sentry.useApp.getState().windowActive'), true)
        win.hide()
        await waitFor('!window.__sentry.useApp.getState().windowActive')
        await js("location.hash = 'lifecycle-check'; true")
        await delay(100)
        win.showInactive()
        await waitFor('window.__sentry.useApp.getState().windowActive')
        win.minimize()
        await waitFor('!window.__sentry.useApp.getState().windowActive')
        win.restore()
        await waitFor('window.__sentry.useApp.getState().windowActive')
        win.hide()
        await waitFor('!window.__sentry.useApp.getState().windowActive')
        // A child frame's load must not invalidate the app's ready handshake.
        await js("new Promise(resolve => {const frame=document.createElement('iframe');frame.onload=()=>resolve(true);frame.src='about:blank';document.body.append(frame)})")
        win.showInactive()
        await waitFor('window.__sentry.useApp.getState().windowActive')
        const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve))
        win.reload()
        await loaded
        await waitFor('Boolean(window.__sentry?.useApp.getState().windowActive && window.__sentry.useApp.getState().quota && window.__sentry.useApp.getState().maps.drive)')
        console.log('PASS: native startup, hide/in-page navigation/reopen, minimize/restore, child-frame load, full reload; Drive data loaded.')
        app.quit()
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })()
  })
})

// Do not await app.whenReady at module scope: Electron must finish entry loading first.
void import(pathToFileURL(resolve('out/main/index.js')).href)
