import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Settings } from '@shared/types'

export function containsPath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Collapse duplicates and nested folders so each file is counted once. */
export function normalizeRoots(input: string | string[]): string[] {
  const paths = typeof input === 'string' ? [input] : input
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || !isAbsolute(p))) {
    throw new Error('Choose at least one drive or folder using an absolute path.')
  }
  const roots: string[] = []
  for (const path of paths.map((p) => resolve(p))) {
    if (roots.some((root) => containsPath(root, path))) continue
    for (let i = roots.length - 1; i >= 0; i--) if (containsPath(path, roots[i])) roots.splice(i, 1)
    roots.push(path)
  }
  return roots
}

export function selectedRoots(settings: Pick<Settings, 'scanRoot' | 'scanRoots'>): string[] {
  return normalizeRoots(settings.scanRoots ?? settings.scanRoot)
}

export function rootsKey(input: string | string[]): string {
  return JSON.stringify(normalizeRoots(input).map((p) => process.platform === 'win32' ? p.toLowerCase() : p).sort())
}
