import type { BrowserWindow } from 'electron'
import { access, mkdir, rm, writeFile, appendFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { checkBackground } from './check-background'

/**
 * Headless render + flow check. The window is offscreen (never shown), so this
 * is safe to run on any machine. Walks onboarding → every page, performs a real
 * upload and download round-trip against the demo drive, and writes PNGs plus
 * a log to ./capture.
 */
export async function runCapture(win: BrowserWindow, outDir: string, setRendererActivity: (active: boolean) => void): Promise<void> {
  const shots = join(outDir, 'shots')
  const downloads = join(outDir, 'downloads')
  const fixtures = join(outDir, 'fixtures')
  await rm(shots, { recursive: true, force: true })
  await rm(downloads, { recursive: true, force: true })
  await mkdir(shots, { recursive: true })
  await mkdir(downloads, { recursive: true })
  await mkdir(fixtures, { recursive: true })
  const log = join(outDir, 'capture.log')
  await writeFile(log, `capture ${new Date().toISOString()}\n`)
  const note = async (line: string): Promise<void> => appendFile(log, `${line}\n`)

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') void note(`[console:${e.level}] ${e.message}`)
  })
  win.webContents.on('render-process-gone', (_e, d) => void note(`[crash] ${d.reason}`))

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T = unknown>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>
  const size = async (w: number, h: number): Promise<void> => {
    win.setContentSize(w, h)
    await wait(350)
  }
  const shot = async (name: string, settle = 700): Promise<void> => {
    await wait(settle)
    const img = await win.webContents.capturePage()
    await writeFile(join(shots, `${name}.png`), img.toPNG())
    await note(`shot ${name} ${img.getSize().width}x${img.getSize().height}`)
  }
  const click = async (text: string): Promise<void> => {
    const ok = await js<boolean>(`(() => {
      const all = [...document.querySelectorAll('button,[role=option],[role=menuitem]')]
      const el = all.find(b => b.textContent.trim() === ${JSON.stringify(text)}) ?? all.find(b => b.textContent.trim().includes(${JSON.stringify(text)}))
      if (!el) return false
      el.click(); return true
    })()`)
    await note(`click "${text}" ${ok ? 'ok' : 'NOT FOUND'}`)
  }
  const state = (expr: string): Promise<unknown> => js(`window.__sentry.useApp.setState(${expr})`)
  const nav = (route: string, folder?: string | null): Promise<unknown> =>
    js(`window.__sentry.go(${JSON.stringify(route)}${folder !== undefined ? `, ${JSON.stringify(folder)}` : ''})`)

  await new Promise<void>((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', () => r()) : r()))
  await size(1360, 880)

  try {
    if (process.argv.includes('--capture-background')) {
      // A focused rerun uses the same native bridge and demo provider without recapturing every page.
      await js(`window.sentry.connect('demo').then(() => window.sentry.updateSettings({ onboarded: true, bootAnimation: false, downloadDir: ${JSON.stringify(downloads)}, scanRoot: ${JSON.stringify(fixtures)} })).then(() => window.sentry.bootstrap()).then(b => window.__sentry.useApp.setState({ boot: b, settings: b.settings, status: b.status, route: 'home' }))`)
      await checkBackground(win, outDir, setRendererActivity)
      await note('background checks passed')
      return
    }
    // Boot sequence, sampled across its timeline (times are approximate: each capture takes a few ms).
    await win.webContents.reload()
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    const started = Date.now()
    for (const at of [60, 200, 380, 620, 850, 1100, 1450, 1650, 1850]) {
      await wait(Math.max(0, at - (Date.now() - started)))
      await shot(`00-boot-${String(at).padStart(4, '0')}`, 0)
    }

    // Onboarding
    await shot('01-welcome', 1400)
    await click('Let’s go')
    await wait(400)
    win.webContents.insertText('Manuel')
    await shot('02-name')
    await click('Nice to meet you')
    await shot('03-connect')
    await click('Try a demo drive')
    await wait(800)
    await shot('04-setup')
    await click('Looks good')
    await shot('05-ready', 1000)
    await click('Open Sentry')
    // Keep test downloads and scans inside ./capture, never the user's real folders.
    await js(`window.sentry.updateSettings({ downloadDir: ${JSON.stringify(downloads)}, scanRoot: ${JSON.stringify(process.cwd())} }).then(s => window.__sentry.useApp.setState({ settings: s }))`)
    await shot('06-home-welcome', 2200)

    // Real upload round-trip
    const fixture = join(fixtures, 'Trip itinerary.pdf')
    await writeFile(fixture, Buffer.alloc(3 * 1024 * 1024, 7))
    await js(`window.sentry.upload([${JSON.stringify(fixture)}], null)`)
    await nav('transfers')
    await shot('07-transfers', 1600)
    const found = await js<Array<{ id: string; name: string; sample?: boolean }>>(`window.sentry.search('Trip itinerary')`)
    const uploaded = found.find((f) => !f.sample)
    await note(`uploaded file present in drive: ${Boolean(uploaded)}`)
    if (uploaded) {
      await js(`window.sentry.download([${JSON.stringify(uploaded.id)}])`)
      await wait(1200)
      try {
        const s = await stat(join(downloads, 'Trip itinerary.pdf'))
        await note(`download round-trip ok: ${s.size} bytes`)
      } catch {
        await note('download round-trip FAILED: file missing')
      }
      const shared = await js<{ link: { url: string } | null }>(`window.sentry.setLink(${JSON.stringify(uploaded.id)}, 'reader')`)
      await note(`share link created: ${shared.link?.url ?? 'none'}`)
    }

    // Home settled
    await state('{ justOnboarded: false }')
    await nav('home')
    await shot('08-home', 1800)

    // My Drive: map + list
    await nav('files', null)
    await shot('09-drive-root', 1600)
    await js(`document.querySelector('button[aria-label="Refresh (F5)"]')?.click()`)
    await shot('09b-drive-refreshing', 60)
    await shot('09c-drive-refreshed', 1500)
    // Click a folder tile on the map; the list row should select with it.
    await js(`[...document.querySelectorAll('[role=treeitem]')].find(t => t.getAttribute('aria-label').startsWith('Photos,'))?.click()`)
    await shot('10-drive-tile-selected', 600)
    // Click a tile deeper than the list shows.
    await js(`[...document.querySelectorAll('[role=treeitem]')].find(t => t.getAttribute('aria-label').startsWith('PC backup'))?.click()`)
    await shot('11-drive-deep-selected', 900)

    // Drag "Trip itinerary.pdf" onto the Documents folder tile (real DnD events through the app's handlers).
    const trip = (await js<Array<{ id: string; name: string; sample?: boolean; parentId: string | null }>>(`window.sentry.search('Trip itinerary')`)).find((f) => !f.sample)
    if (trip) {
      const dragged = await js<boolean>(`(() => {
        const target = [...document.querySelectorAll('[role=treeitem][data-drop-folder]')].find(t => t.getAttribute('aria-label').startsWith('Documents,'))
        if (!target) return false
        const r = target.getBoundingClientRect()
        const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 40)
        const dt = new DataTransfer()
        dt.setData('application/x-sentry-ids', JSON.stringify([${JSON.stringify(trip.id)}]))
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
        window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
        window.__dt = { dt, x, y }
        return true
      })()`)
      await note(`drag over Documents tile: ${dragged}`)
      await shot('12-drive-drag-over', 500)
      await js(`(() => { const { dt, x, y } = window.__dt; window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })) })()`)
      await wait(900)
      const moved = await js<{ parentId: string | null }>(`window.sentry.get(${JSON.stringify(trip.id)})`)
      const docs = (await js<Array<{ id: string; name: string }>>(`window.sentry.search('Documents')`)).find((f) => f.name === 'Documents')
      await note(`move into Documents: ${moved.parentId !== null && moved.parentId === docs?.id ? 'ok' : `FAILED (parent ${moved.parentId})`}`)
      await shot('13-drive-after-move', 900)
    }

    const resume = (await js<Array<{ id: string; name: string; parentId: string | null }>>(`window.sentry.search('Resume.pdf')`))[0]
    if (resume) {
      await js(`window.__sentry.go('files', ${JSON.stringify(resume.parentId)}, ${JSON.stringify(resume.id)})`)
      await wait(1200)
      await shot('14-drive-subfolder', 300)
      await click('Share')
      await shot('15-share-dialog', 900)
      const pickAccess = (label: string): Promise<unknown> =>
        js(`[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.includes(${JSON.stringify(label)}))?.click()`)
      await pickAccess('Restricted')
      await shot('15b-share-restricted', 900)
      await pickAccess('Anyone with the link')
      await shot('15c-share-live-again', 900)
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await wait(300)
    }

    // This PC (scans the project folder so it's quick)
    await nav('map')
    await shot('16-pc-start', 600)
    await click('Scan now')
    await shot('17-pc-scanning', 250)
    await nav('files', null)
    await shot('17b-scan-from-elsewhere', 150)
    for (let i = 0; i < 60; i++) {
      const busy = await js<boolean>(`window.__sentry.useApp.getState().scanning.local`)
      if (!busy) break
      await wait(500)
    }
    await shot('17c-scan-ready', 700)
    // The project scan is too quick to catch mid-flight, so render the sidebar states directly.
    await state(`s => ({ scanning: { ...s.scanning, local: true }, scanProgress: { files: 218000, bytes: 49929979904, current: 'C:/Users/User' } })`)
    await shot('17d-sidebar-scanning', 500)
    await state(`s => ({ scanning: { ...s.scanning, local: false }, localScanUnseen: true })`)
    await shot('17e-sidebar-ready', 700)
    await nav('map')
    for (let i = 0; i < 60; i++) {
      const busy = await js<boolean>(`window.__sentry.useApp.getState().scanning.local`)
      if (!busy) break
      await wait(500)
    }
    await shot('18-pc-map', 1400)
    // Right-click a folder tile on the This PC map.
    await js(`(() => {
      const tiles = [...document.querySelectorAll('[role=treeitem]')]
      const t = tiles.find((x) => x.getAttribute('aria-label').startsWith('electron,')) ?? tiles[0]
      const r = t.getBoundingClientRect()
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 60, button: 2 }))
    })()`)
    await shot('18b-pc-context-menu', 600)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(250)

    await nav('shared')
    await shot('19-shared', 1200)

    // Settings takeover
    await nav('settings')
    await shot('20-settings-general', 900)
    await click('Startup & background')
    await shot('20b-settings-background', 900)
    await click('Updates')
    await shot('20c-settings-updates', 700)
    await click('Appearance')
    await shot('21-settings-appearance', 900)
    await click('Graphite')
    await wait(200)
    await js(`[...document.querySelectorAll('[role=radio][aria-label=Sky]')][0]?.click()`)
    await shot('22-settings-graphite-sky', 900)
    await click('Drive & account')
    await shot('23-settings-drive', 700)
    await js(`(() => { const i = document.querySelector('input[aria-label="Search settings"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'download'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await shot('24-settings-search', 700)
    await click('Back')
    await nav('files', null)
    await shot('25-drive-graphite-sky', 1400)
    await js(`window.sentry.updateSettings({ theme: 'midnight', accent: 'amber' }).then(s => window.__sentry.useApp.setState({ settings: s }))`)

    // Wide window
    await size(2200, 1250)
    await nav('home')
    await shot('25b-home-wide', 1600)
    await nav('files', null)
    await shot('25c-drive-wide', 1200)

    // Narrow window
    await size(980, 660)
    await nav('home')
    await shot('26-home-narrow', 1500)
    await nav('files', null)
    await shot('27-drive-narrow', 1200)
    await nav('settings')
    await shot('28-settings-narrow', 800)
    await click('Back')
    await size(1360, 880)

    // Local-only mode: no drive at all, This PC leads and Drive pages offer an optional connect.
    await js(`window.sentry.disconnect().then(s => window.__sentry.useApp.setState({ status: s, quota: null, maps: { drive: null, local: null }, route: 'map' }))`)
    await wait(600)
    await click('Scan now')
    for (let i = 0; i < 60; i++) {
      if (!(await js<boolean>(`window.__sentry.useApp.getState().scanning.local`))) break
      await wait(400)
    }
    await shot('30-local-only-pc', 1200)
    await nav('files')
    await shot('31-local-only-connect', 1200)
    await click('Explore a demo drive')
    await wait(1200)
    await shot('32-demo-added-later', 1500)

    // The This PC scan survives a relaunch of the UI.
    await js(`location.reload()`)
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    await wait(2500)
    const restored = await js<boolean>(`Boolean(window.__sentry.useApp.getState().maps.local) && !window.__sentry.useApp.getState().scanning.local`)
    await note(`saved PC scan restored after reload: ${restored}`)

    // A failed Drive map shows an error with Retry, never an endless skeleton.
    await nav('home')
    await wait(800)
    // Hold the scan flag so nothing retries during the frame; this renders the failed state itself.
    await state(`s => ({ maps: { ...s.maps, drive: null }, driveMapError: 'Google Drive returned 503.', scanning: { ...s.scanning, drive: true }, driveScanAttemptVersion: s.driveVersion })`)
    await wait(100)
    await state(`s => ({ scanning: { ...s.scanning, drive: false } })`)
    await shot('33-home-map-error', 300)
    await js(`window.__sentry.useApp.setState({ driveMapError: null, driveScanAttemptVersion: -1 })`)

    // Boot sequence in a non-default theme: it must use Graphite + Sky from the first frame.
    await js(`window.sentry.updateSettings({ theme: 'graphite', accent: 'sky' })`)
    await js(`location.search = '?theme=graphite&accent=sky&capture=1'`)
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    const t0 = Date.now()
    for (const at of [150, 900, 1700]) {
      await wait(Math.max(0, at - (Date.now() - t0)))
      await shot(`34-boot-graphite-${at}`, 0)
    }
    await wait(1500)
    await js(`window.sentry.updateSettings({ theme: 'midnight', accent: 'sky' }).then(s => window.__sentry.useApp.setState({ settings: s }))`)

    // Empty folder state
    await js(`window.sentry.createFolder(null, 'Empty test').then(f => window.__sentry.go('files', f.id))`)
    await shot('29-drive-empty', 1200)
    await checkBackground(win, outDir, setRendererActivity)
    await note('background checks passed: hidden transfer, deferred Drive refresh, resumed state, scan cancellation')
  } catch (error) {
    await note(`[capture error] ${error instanceof Error ? error.stack : String(error)}`)
    process.exitCode = 1
  }

  try {
    await access(join(downloads, 'Trip itinerary.pdf'))
  } catch {
    /* already logged */
  }
  await note('done')
}
