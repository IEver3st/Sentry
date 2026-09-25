import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import { create } from 'zustand'
import { Button } from './ui'

interface Ask {
  title: string
  body: string
  confirm: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

const useConfirm = create<{ ask: Ask | null }>(() => ({ ask: null }))

export function confirm(opts: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ ask: { ...opts, resolve } }))
}

export function ConfirmDialog() {
  const ask = useConfirm((s) => s.ask)
  const done = (ok: boolean): void => {
    ask?.resolve(ok)
    useConfirm.setState({ ask: null })
  }
  return (
    <Dialog.Root open={Boolean(ask)} onOpenChange={(o) => !o && done(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[400px] -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="rounded-2xl border border-white/[0.08] bg-ink-800 p-5 shadow-2xl shadow-black/60"
          >
            <Dialog.Title className="text-[16px] font-semibold">{ask?.title}</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[13.5px] leading-relaxed text-fog-400">{ask?.body}</Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => done(false)}>
                Cancel
              </Button>
              <Button variant={ask?.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>
                {ask?.confirm}
              </Button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
