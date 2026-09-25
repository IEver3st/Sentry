import assert from 'node:assert/strict'
import { app } from 'electron'
import { mkdtempSync, mkdirSync, writeFileSync, openSync, ftruncateSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Real IPC and renderer, isolated profile, hidden window, four temporary roots.
// Enumerates the PC's drives but never scans or modifies their existing files.
const profile = mkdtempSync(join(tmpdir(), 'sentry-multi-drive-'))
const shots = resolve('capture/multi-drive')
mkdirSync(shots, { recursive: true })
const roots = ['SSD-one', 'SSD-two', 'SSD-three', 'SSD-four'].map((name, i) => {
  const root = join(profile, name)
  mkdirSync(root)
  const fd = openSync(join(root, 'fixture.bin'), 'w')
  ftruncateSync(fd, (i + 1) * 32 * 1024 * 1024)
  closeSync(fd)
  return root
})
app.setPath('userData', profile)
app.requestSingleInstanceLock = () => true
app.setLoginItemSettings = () => {}
writeFileSync(join(profile, 'settings.json'), JSON.stringify({
  onboarded: true, provider: null, showTray: false, launchAtLogin: false,
  autoCheckUpdates: false, bootAnimation: false, reduceMotion: true, systemNotifications: false,
  scanRoot: roots[0], scanRoots: roots.map((root, i) => process.platform === 'win32' && i === 1 ? root.toLowerCase() : root), startPage: 'map', closeToTray: false
}))

app.on('browser-window-created', (_event, win) => {
  win.show = () => {}
  win.webContents.setBackgroundThrottling(false)
  const loadFile = win.loadFile.bind(win)
  win.loadFile = (path, options) => loadFile(path, { ...options, query: { ...options?.query, capture: '1' } })
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const waitFor = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return
      await delay(100)
    }
    throw new Error(`Timed out: ${code}`)
  }
  const click = async (label) => {
    assert.equal(await js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`), true, label)
  }
  const shot = async (name, width = 1360, height = 880) => {
    win.setContentSize(width, height)
    await waitFor('Boolean(window.__sentry.useApp.getState().booted)')
    // Hidden windows need a paint to deliver resize observations before settling.
    await win.webContents.capturePage()
    await delay(700)
    writeFileSync(join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        await waitFor('Boolean(window.__sentry?.useApp.getState().settings)')
        await waitFor("document.body.textContent.includes('Drives & folders')")
        const drives = await js('window.sentry.localDrives()')
        assert.ok(drives.length > 0)
        assert.ok(drives.every((drive) => typeof drive.root === 'string'))
        await click('Drives & folders')
        await waitFor("!document.body.textContent.includes('Finding drives…') && Boolean(document.querySelector('[role=dialog]'))")
        const choiceCount = await js("document.querySelectorAll('[role=dialog] input').length")
        await js("document.querySelector('[role=dialog] input:checked').click()")
        assert.equal(await js("document.querySelectorAll('[role=dialog] input').length"), choiceCount, 'Unchecking a saved folder must keep it available for re-selection')
        await click('Select all drives')
        assert.equal(await js("document.querySelectorAll('[role=dialog] input:checked').length"), drives.length)
        await shot('drive-picker')
        await shot('drive-picker-narrow', 960, 640)
        await js("document.querySelector('[aria-label=\"Close drive selection\"]').click()")
        await waitFor("!document.querySelector('[role=dialog]')")
        // Scan through the picker save path, preserving the temporary roots.
        await click('Drives & folders')
        await waitFor("!document.body.textContent.includes('Finding drives…') && Boolean(document.querySelector('[role=dialog]'))")
        await click('Scan selected')
        await waitFor('Boolean(window.__sentry.useApp.getState().maps.local) && !window.__sentry.useApp.getState().scanning.local')
        const snap = await js('window.__sentry.useApp.getState().maps.local')
        assert.equal(snap.root.children.length, 4)
        assert.equal(snap.root.files, 4)
        assert.equal(snap.root.size, 320 * 1024 * 1024)
        assert.equal(snap.disks.length, 1, 'Folders on one disk must not multiply disk capacity')
        assert.equal(snap.root.virtual, true)
        await shot('combined-map')
        await shot('combined-map-narrow', 960, 640)
        assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true)
        await js(`(() => { const select = document.querySelector('[aria-label="Map location"]'); select.value = ${JSON.stringify(roots[3])}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
        await waitFor("document.querySelector('[aria-label=\"Zoom path\"]').textContent.includes('SSD-four')")
        assert.equal(await js('window.sentry.lastLocalScan().then(s => s.root.files)'), 4)
        await assert.rejects(js(`window.sentry.trashLocal([${JSON.stringify(roots[0])}])`), /only removes/)
        await assert.rejects(js(`window.sentry.trashLocal([${JSON.stringify(join(profile, 'outside-selection'))}])`), /only removes/)
        await assert.rejects(js('window.sentry.updateSettings({scanRoots: []})'), /at least one/)
        assert.equal(await js('window.sentry.bootstrap().then(b => b.settings.scanRoots.length)'), 4)
        const loaded = new Promise((accept) => win.webContents.once('did-finish-load', accept))
        win.reload()
        await loaded
        await waitFor('Boolean(window.__sentry?.useApp.getState().maps.local)')
        assert.equal(await js('window.__sentry.useApp.getState().maps.local.root.files'), 4)
        assert.equal(await js(`(() => {
          const result = window.sentry.scanLocal().then(() => false, e => e.message.includes('cancelled'));
          return window.sentry.cancelScan().then(() => result);
        })()`), true)
        assert.equal(await js('window.sentry.lastLocalScan().then(s => s.root.files)'), 4, 'Cancellation must preserve the previous saved scan')
        const partial = await js(`window.sentry.scanLocal(${JSON.stringify([...roots, join(profile, 'offline')])})`)
        assert.equal(partial.root.files, 4)
        assert.equal(partial.scanErrors.length, 1)
        await js(`window.__sentry.useApp.setState({maps: {drive: null, local: ${JSON.stringify(partial)}}})`)
        await shot('partial-map')
        console.log(JSON.stringify({ result: 'PASS', discoveredDrives: drives.map((d) => d.root), scannedTemporaryRoots: roots.length, checks: ['selection and save via UI', 'combined totals', 'no duplicate capacity', 'drive navigation', 'cached reload', 'scan-root protection', 'invalid selection rejection', 'cancellation preserves cache', 'partial scan'], screenshots: shots }, null, 2))
        app.quit()
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })()
  })
})
void import(pathToFileURL(resolve('out/main/index.js')).href)
