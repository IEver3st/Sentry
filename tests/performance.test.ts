import { expect, mock, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { RendererEvents } from '../src/main/renderer-events'
import type { SentryEvents, Transfer } from '../src/shared/types'
import type { DriveProvider, ProgressFn } from '../src/main/providers/types'

mock.module('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.1.0' }, safeStorage: {}, shell: {} }))
const { TransferQueue } = await import('../src/main/transfers')

test('hidden activity is silent and reopening delivers current state once after readiness', async () => {
  const delivered: Array<[string, unknown]> = []
  const events = new RendererEvents((event, payload) => { delivered.push([event, payload]) }, () => {})
  try {
    events.setVisible(true)
    events.send('navigate', { route: 'transfers' })
    expect(delivered).toHaveLength(0)
    events.rendererReady()
    expect(delivered.map(([event]) => event)).toEqual(['window-active', 'navigate'])
    events.setVisible(false)
    delivered.length = 0
    for (let i = 0; i < 1000; i++) {
      events.send('scan-progress', { files: i, bytes: i * 2, current: 'fixture' })
      events.send('transfers', [{ id: 'upload', done: i }] as Transfer[])
      events.send('drive-changed', { folderIds: [null, `folder-${i % 3}`] })
    }
    events.send('external-upload', { count: 2, target: 'My Drive' })
    events.send('external-upload', { count: 3, target: 'My Drive' })
    await delay(300)
    expect(delivered).toHaveLength(0)
    events.setVisible(true)
    expect(delivered.filter(([event]) => event === 'transfers')).toEqual([['transfers', [{ id: 'upload', done: 999 }]]])
    expect(delivered.filter(([event]) => event === 'drive-changed')).toEqual([['drive-changed', { folderIds: [null, 'folder-0', 'folder-1', 'folder-2'] }]])
    expect(delivered.filter(([event]) => event === 'external-upload')).toEqual([['external-upload', { count: 5, target: 'My Drive' }]])
    const count = delivered.length
    events.setVisible(true)
    expect(delivered).toHaveLength(count)
  } finally { events.dispose() }
})

test('a pending visible Drive refresh is retained across hide and renderer reload', async () => {
  const delivered: string[] = []
  const events = new RendererEvents((event) => { delivered.push(event) }, () => {})
  try {
    events.setVisible(true)
    events.rendererReady()
    delivered.length = 0
    events.send('drive-changed', { folderIds: [null] })
    events.setVisible(false)
    delivered.length = 0
    await delay(300)
    expect(delivered).toHaveLength(0)
    events.rendererLoading()
    events.send('navigate', { route: 'settings' })
    events.setVisible(true)
    expect(delivered).toHaveLength(0)
    events.rendererReady()
    expect(delivered).toEqual(['window-active', 'navigate', 'drive-changed'])
  } finally { events.dispose() }
})

test('visible Drive bursts cause one invalidation without delaying transfer state', async () => {
  const delivered: Array<keyof SentryEvents> = []
  const events = new RendererEvents((event) => { delivered.push(event) }, () => {})
  try {
    events.setVisible(true)
    events.rendererReady()
    delivered.length = 0
    for (let i = 0; i < 100; i++) events.send('drive-changed', { folderIds: [null] })
    events.send('transfers', [])
    expect(delivered).toEqual(['transfers'])
    await delay(300)
    expect(delivered).toEqual(['transfers', 'drive-changed'])
  } finally { events.dispose() }
})

test('hidden transfers keep working without progress snapshots; completion and cancellation survive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sentry-transfer-perf-'))
  const path = join(dir, 'fixture.txt')
  await writeFile(path, 'fixture')
  let progress: ProgressFn = () => {}
  let complete: () => void = () => {}
  const emitted: Transfer[][] = []
  const driveChanges: Array<Array<string | null>> = []
  const provider = {
    upload: async (_path: string, _parent: string | null, _name: string, onProgress: ProgressFn, signal: AbortSignal) => {
      progress = onProgress
      await new Promise<void>((resolve, reject) => {
        complete = resolve
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    }
  } as unknown as DriveProvider
  const queue = new TransferQueue(() => provider, (list) => { emitted.push(list) }, (folders) => { driveChanges.push(folders) }, () => 1)
  try {
    await queue.upload([path], null)
    progress(1) // A scheduled visible progress emission must also be cancelled on hide.
    queue.setProgressEnabled(false)
    emitted.length = 0
    for (let i = 0; i < 1000; i++) progress(i)
    await delay(130)
    expect(emitted).toHaveLength(0)
    expect(queue.isBusy()).toBe(true)
    expect(queue.list()[0].done).toBe(999)
    complete()
    await delay(20)
    expect(queue.list()[0].state).toBe('done')
    expect(emitted.at(-1)?.[0].state).toBe('done')
    expect(driveChanges).toEqual([[null]])
    await queue.upload([path], null)
    queue.cancel(queue.list()[0].id)
    await delay(20)
    expect(queue.list()[0].state).toBe('cancelled')
    expect(queue.isBusy()).toBe(false)
  } finally {
    complete()
    queue.setProgressEnabled(false)
    await rm(dir, { recursive: true, force: true })
  }
})
