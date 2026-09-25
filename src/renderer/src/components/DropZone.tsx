import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CloudUpload, FolderInput } from 'lucide-react'
import { api, fail, toast, uploadPaths, useApp } from '@/lib/store'
import { DRAG_TYPE } from './Treemap'

/**
 * One drop system for the whole window.
 * - Files from the PC upload into whatever folder is under the cursor
 *   (any element with data-drop-folder), else the open folder, else My Drive.
 * - Drive items dragged inside Sentry move into the folder under the cursor.
 */
export function DropZone() {
  const [drag, setDrag] = useState<{ kind: 'files' | 'move'; label: string } | null>(null)
  const depth = useRef(0)
  const activeEl = useRef<Element | null>(null)
  const folderName = useRef('My Drive')
  const folderId = useApp((s) => s.folderId)
  const route = useApp((s) => s.route)
  const driveVersion = useApp((s) => s.driveVersion)

  // Name of the open folder, used when dropping on empty space.
  useEffect(() => {
    if (route !== 'files' || !folderId) {
      folderName.current = 'My Drive'
      return
    }
    let live = true
    api()
      .get(folderId)
      .then((f) => live && (folderName.current = f.name))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [route, folderId, driveVersion])

  useEffect(() => {
    const kindOf = (e: DragEvent): 'files' | 'move' | null => {
      const types = e.dataTransfer?.types ?? []
      if (types.includes(DRAG_TYPE)) return 'move'
      if (types.includes('Files')) return 'files'
      return null
    }
    const targetAt = (e: DragEvent): { el: Element | null; id: string | null; name: string } => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop-folder]') ?? null
      if (el) {
        const id = el.getAttribute('data-drop-folder')
        return { el, id: id === 'root' || id === '' ? null : id, name: el.getAttribute('data-drop-name') ?? 'My Drive' }
      }
      const s = useApp.getState()
      return s.route === 'files' ? { el: null, id: s.folderId, name: folderName.current } : { el: null, id: null, name: 'My Drive' }
    }
    const mark = (el: Element | null): void => {
      if (activeEl.current === el) return
      activeEl.current?.removeAttribute('data-drop-active')
      el?.setAttribute('data-drop-active', '')
      activeEl.current = el
    }
    const reset = (): void => {
      depth.current = 0
      mark(null)
      setDrag(null)
      document.querySelectorAll('[data-dragging]').forEach((n) => n.removeAttribute('data-dragging'))
    }

    const enter = (e: DragEvent): void => {
      if (!kindOf(e)) return
      e.preventDefault()
      depth.current++
    }
    const leave = (e: DragEvent): void => {
      if (!kindOf(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) {
        mark(null)
        setDrag(null)
      }
    }
    const over = (e: DragEvent): void => {
      const kind = kindOf(e)
      if (!kind) return
      const t = targetAt(e)
      // Moves need a real folder under the cursor; uploads can always fall back.
      if (kind === 'move' && !t.el) {
        mark(null)
        setDrag((d) => (d?.kind === 'move' && d.label === '' ? d : { kind, label: '' }))
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
        return
      }
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = kind === 'move' ? 'move' : 'copy'
      mark(t.el)
      setDrag((d) => (d?.kind === kind && d.label === t.name ? d : { kind, label: t.name }))
    }
    const drop = (e: DragEvent): void => {
      const kind = kindOf(e)
      if (!kind) return
      e.preventDefault()
      const t = targetAt(e)
      if (kind === 'files') {
        const paths = Array.from(e.dataTransfer?.files ?? [])
          .map((f) => api().pathForFile(f))
          .filter(Boolean)
        void uploadPaths(paths, t.id)
      } else if (t.el) {
        let ids: string[] = []
        try {
          ids = JSON.parse(e.dataTransfer?.getData(DRAG_TYPE) ?? '[]') as string[]
        } catch {
          ids = []
        }
        ids = ids.filter((id) => id !== t.id)
        if (ids.length) {
          api()
            .move(ids, t.id)
            .then(() => toast({ tone: 'success', title: ids.length === 1 ? `Moved into ${t.name}` : `Moved ${ids.length} items into ${t.name}` }, 2400))
            .catch((err: unknown) => fail('Couldn’t move that', err))
        }
      }
      reset()
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', reset)
    }
  }, [])

  return (
    <AnimatePresence>
      {drag && (
        <>
          <motion.div
            key="edge"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 rounded-[2px] shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--color-amber)_45%,transparent)]"
          />
          <motion.div
            key="pill"
            initial={{ opacity: 0, y: 16, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 12, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex items-center gap-2.5 rounded-full border border-white/10 bg-ink-750/95 py-2 pr-4 pl-2.5 text-[13.5px] shadow-2xl shadow-black/50 backdrop-blur"
          >
            <span className="grid size-7 place-items-center rounded-full bg-amber text-ink-950">
              {drag.kind === 'files' ? <CloudUpload size={15} /> : <FolderInput size={15} />}
            </span>
            {drag.kind === 'move' && !drag.label ? (
              <span className="text-fog-300">Hover a folder to move into it</span>
            ) : (
              <span>
                {drag.kind === 'files' ? 'Drop to add to ' : 'Move into '}
                <span className="font-semibold text-amber">{drag.label}</span>
              </span>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
