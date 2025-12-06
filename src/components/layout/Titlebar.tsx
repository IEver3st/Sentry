import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { Minus, Square, CopyMinus, X, Shield } from 'lucide-react'

const appWindow = getCurrentWindow()

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let unlistenResize: UnlistenFn | null = null
    let isMounted = true

    appWindow.isMaximized().then((maximized) => {
      if (isMounted) {
        setIsMaximized(maximized)
      }
    })

    appWindow.onResized(async () => {
      const maximized = await appWindow.isMaximized()
      if (isMounted) {
        setIsMaximized(maximized)
      }
    }).then((unlisten) => {
      unlistenResize = unlisten
    })

    return () => {
      isMounted = false
      if (unlistenResize) {
        unlistenResize()
      }
    }
  }, [])

  const handleMinimize = () => appWindow.minimize()
  const handleToggleMaximize = () => {
    if (isMaximized) {
      appWindow.unmaximize()
    } else {
      appWindow.maximize()
    }
  }
  const handleClose = () => appWindow.close()

  return (
    <header
      className="app-titlebar flex h-10 items-center justify-between border-b border-border bg-card px-4"
      data-tauri-drag-region="true"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Shield className="h-3.5 w-3.5" />
        </div>
        <span>Sentry Backup</span>
      </div>

      <div className="flex items-center" data-tauri-drag-region="false">
        <button
          type="button"
          onClick={handleMinimize}
          className="flex h-8 w-10 items-center justify-center text-muted-foreground transition hover:bg-muted"
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="flex h-8 w-10 items-center justify-center text-muted-foreground transition hover:bg-muted"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <CopyMinus className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-8 w-12 items-center justify-center text-muted-foreground transition hover:bg-red-500 hover:text-white"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}
