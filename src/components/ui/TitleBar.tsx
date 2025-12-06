import { useState, useEffect, useRef } from 'react'
import { getCurrentWindow, Window } from '@tauri-apps/api/window'
import { Minus, Square, X, Maximize2, Shield } from 'lucide-react'

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const windowRef = useRef<Window | null>(null)

  useEffect(() => {
    // Store window reference
    windowRef.current = getCurrentWindow()
    const appWindow = windowRef.current

    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized)

    // Listen for resize events to update maximized state
    const unlisten = appWindow.onResized(async () => {
      const maximized = await appWindow.isMaximized()
      setIsMaximized(maximized)
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  const handleMinimize = async () => {
    console.log('Minimize clicked')
    if (windowRef.current) {
      await windowRef.current.minimize()
      console.log('Minimize called')
    }
  }

  const handleMaximize = async () => {
    console.log('Maximize clicked')
    if (windowRef.current) {
      await windowRef.current.toggleMaximize()
      console.log('Toggle maximize called')
    }
  }

  const handleClose = async () => {
    console.log('Close clicked')
    if (windowRef.current) {
      await windowRef.current.close()
      console.log('Close called')
    }
  }

  return (
    <div
      style={{
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'hsl(var(--card))',
        borderBottom: '1px solid hsl(var(--border))',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Draggable area */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          paddingLeft: '12px',
          paddingRight: '12px',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            background: 'hsl(var(--primary))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Shield className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
        <span
          data-tauri-drag-region
          style={{ fontSize: '14px', fontWeight: 600 }}
        >
          Sentry
        </span>
      </div>

      {/* Window controls - explicitly NOT draggable */}
      <div
        style={{
          display: 'flex',
          height: '100%',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={handleMinimize}
          style={{
            width: '48px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => e.currentTarget.style.background = 'hsl(var(--muted))'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleMaximize}
          style={{
            width: '48px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => e.currentTarget.style.background = 'hsl(var(--muted))'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          {isMaximized ? (
            <Maximize2 className="w-3.5 h-3.5" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        <button
          type="button"
          onClick={handleClose}
          style={{
            width: '48px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#ef4444'
            e.currentTarget.style.color = 'white'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'inherit'
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
