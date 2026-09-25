import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { dismissToast, useApp } from '@/lib/store'

const ICON = { info: Info, success: CircleCheck, error: CircleAlert }
const COLOR = { info: 'text-sky', success: 'text-mint', error: 'text-rose' }

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[340px] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.tone]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-white/[0.07] bg-ink-750/95 p-3 shadow-2xl shadow-black/40 backdrop-blur"
            >
              <Icon size={18} className={`mt-px shrink-0 ${COLOR[t.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-[12.5px] text-fog-400" data-selectable>{t.detail}</p>}
                {t.action && (
                  <button
                    onClick={() => {
                      t.action!.run()
                      dismissToast(t.id)
                    }}
                    className="mt-1.5 text-[12.5px] font-medium text-amber hover:underline"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-fog-500 hover:text-fog-100">
                <X size={15} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
