import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { containsPath, normalizeRoots, rootsKey, selectedRoots } from '../src/main/local-roots'
import { LocalScanCache } from '../src/main/local-cache'
import type { MapSnapshot } from '../src/shared/types'

test('scan selections collapse nested paths and duplicates without confusing sibling names', () => {
  const root = join(tmpdir(), 'sentry-roots')
  expect(normalizeRoots([join(root, 'child'), root, root, `${root}-other`])).toEqual([root, `${root}-other`])
  expect(containsPath(root, join(root, '..hidden'))).toBe(true)
  expect(containsPath(root, `${root}-other`)).toBe(false)
  expect(containsPath(root, join(root, '..', 'outside'))).toBe(false)
  expect(selectedRoots({ scanRoot: root })).toEqual([root])
  expect(() => normalizeRoots([])).toThrow()
  expect(() => normalizeRoots('relative')).toThrow()
  if (process.platform === 'win32') {
    expect(normalizeRoots(['C:\\Users', 'D:\\', 'c:\\', 'E:\\', 'F:\\'])).toEqual(['D:\\', 'c:\\', 'E:\\', 'F:\\'])
    expect(rootsKey(['C:\\', 'D:\\'])).toBe(rootsKey(['d:\\', 'c:\\']))
    expect(containsPath('C:\\', 'D:\\file')).toBe(false)
  }
})

test('multi-location cache survives restart and reordered selection, and reads the old single-folder format', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sentry-cache-'))
  const roots = ['one', 'two', 'three', 'four'].map((name) => join(dir, name))
  const snapshot: MapSnapshot = {
    source: 'local', scannedAt: new Date().toISOString(), durationMs: 1, suggestions: [], disk: null,
    root: { id: 'local:computer', name: 'This PC', virtual: true, isDir: true, category: 'other', size: 40, files: 4, dirs: 4, newest: 0,
      children: roots.map((root) => ({ id: root, name: root, isDir: true, category: 'other', size: 10, files: 1, dirs: 0, newest: 0 })) }
  }
  try {
    await new LocalScanCache(dir).save(roots, snapshot)
    const cache = new LocalScanCache(dir)
    expect((await cache.load([...roots].reverse()))?.root.files).toBe(4)
    expect(await cache.load(roots.slice(1))).toBeNull()
    await cache.prune(roots, [roots[2]])
    expect((await cache.load(roots))?.root.size).toBe(30)
    const legacy = { ...snapshot, root: snapshot.root.children![0] }
    await writeFile(join(dir, 'local-scan.json'), JSON.stringify({ version: 1, root: roots[0], snapshot: legacy }))
    expect((await cache.load(roots[0]))?.root.id).toBe(roots[0])
    expect(await cache.load(roots)).toBeNull()
    await cache.clear()
    expect(await cache.load(roots[0])).toBeNull()
  } finally {
    if (dir !== parse(dir).root && dir.startsWith(tmpdir())) await rm(dir, { recursive: true, force: true })
  }
})
