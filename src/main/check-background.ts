import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { DriveFile, Transfer } from '@shared/types'

/** Exercise the real IPC bridge with a controlled activity signal; the native window stays offscreen. */
export async function checkBackground(win: BrowserWindow, outDir: string, setActive: (active: boolean) => void): Promise<void> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>
  const waitFor = async (code: string): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js<boolean>(code)) return
      await delay(100)
    }
    throw new Error(`Background check timed out: ${code}`)
  }
  const fixtureDir = join(outDir, 'background-fixture')
  const downloadDir = join(outDir, 'background-download')
  // Start clean: files left by an earlier run would change the scan counts asserted below.
  await rm(fixtureDir, { recursive: true, force: true })
  await rm(downloadDir, { recursive: true, force: true })
  await mkdir(fixtureDir, { recursive: true })
  await mkdir(downloadDir, { recursive: true })
  const name = `Background integrity ${Date.now()}.bin`
  const fixture = join(fixtureDir, name)
  const content = Buffer.alloc(3 * 1024 * 1024, 37)
  await writeFile(fixture, content)
  const findings: Record<string, unknown> = {}
  try {
    await js(`window.__sentry.go('home')`)
    await waitFor('window.__sentry.useApp.getState().windowActive && !window.__sentry.useApp.getState().scanning.drive && Boolean(window.__sentry.useApp.getState().maps.drive)')
    // Wait for already-requested reads to settle before checking that hidden work is quiet.
    await delay(1000)
    const beforeVersion = await js<number>('window.__sentry.useApp.getState().driveVersion')
    await js(`window.__backgroundEvents = { transfers: 0, drive: 0 }; window.__backgroundOff = [window.sentry.on('transfers', () => window.__backgroundEvents.transfers++), window.sentry.on('drive-changed', () => window.__backgroundEvents.drive++)]; true`)
    setActive(false)
    await waitFor('!window.__sentry.useApp.getState().windowActive')
    await js(`window.sentry.upload([${JSON.stringify(fixture)}], null)`)
    await waitFor(`window.sentry.transfers().then(list => list.some(t => t.name === ${JSON.stringify(name)} && t.state === 'done'))`)
    await delay(500)
    assert.deepEqual(await js('window.__backgroundEvents'), { transfers: 0, drive: 0 })
    assert.equal(await js('window.__sentry.useApp.getState().driveVersion'), beforeVersion)
    findings.hiddenTransfer = 'completed with zero transfer/Drive event deliveries'
    findings.deferredDriveRefresh = true

    setActive(true)
    await waitFor(`window.__sentry.useApp.getState().transfers.some(t => t.name === ${JSON.stringify(name)} && t.state === 'done')`)
    await waitFor('!window.__sentry.useApp.getState().scanning.drive && window.__sentry.useApp.getState().driveMapVersion === window.__sentry.useApp.getState().driveVersion')
    assert.equal(await js<number>('window.__sentry.useApp.getState().driveVersion'), beforeVersion + 1)
    findings.resumedState = 'current transfers and one merged Drive invalidation'

    const files = await js<DriveFile[]>(`window.sentry.search(${JSON.stringify(name)})`)
    const uploaded = files.find((file) => file.name === name && !file.sample)
    assert.ok(uploaded)
    await js(`window.sentry.download([${JSON.stringify(uploaded.id)}], ${JSON.stringify(downloadDir)})`)
    await waitFor(`window.sentry.transfers().then(list => list.some(t => t.name === ${JSON.stringify(name)} && t.direction === 'down' && t.state === 'done'))`)
    const received = await readFile(join(downloadDir, name))
    assert.equal(createHash('sha256').update(received).digest('hex'), createHash('sha256').update(content).digest('hex'))
    findings.downloadIntegrity = 'SHA-256 matched'

    const scan = await js<{ root: { files: number; size: number } }>(`window.sentry.scanLocal(${JSON.stringify(fixtureDir)})`)
    assert.equal(scan.root.files, 1)
    assert.equal(scan.root.size, content.length)
    await js(`window.__cancelResult = null; window.sentry.scanLocal(${JSON.stringify(fixtureDir)}).then(() => window.__cancelResult = 'completed', error => window.__cancelResult = String(error)); window.sentry.cancelScan()`)
    await waitFor('window.__cancelResult !== null')
    assert.match(await js<string>('window.__cancelResult'), /cancelled/)
    findings.localScanAndCancellation = 'passed through native IPC'
    const transfers = await js<Transfer[]>('window.sentry.transfers()')
    assert.equal(transfers.filter((transfer) => transfer.name === name && transfer.state === 'done').length, 2)
    await writeFile(join(outDir, 'background-check.json'), JSON.stringify(findings, null, 2))
  } finally {
    setActive(true)
    await js('window.__backgroundOff?.forEach(off => off())')
  }
}
