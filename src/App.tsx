import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Onboarding } from '@/components/onboarding/Onboarding'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { BackupSets } from '@/components/backups/BackupSets'
import { Schedule } from '@/components/schedule/Schedule'
import { CloudStorage } from '@/components/cloud/CloudStorage'
import { Settings } from '@/components/settings/Settings'
import { DownloadDock } from '@/components/downloads/DownloadDock'
import { Titlebar } from '@/components/ui/TitleBar'
import { useAppStore, useUIStore } from '@/lib/store'
import { api, events } from '@/lib/tauri'
import { check as checkForUpdate, type DownloadEvent } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { Loader2, LayoutDashboard, FolderArchive, Calendar, Cloud, Settings as SettingsIcon, ChevronLeft, Menu, AlertTriangle } from 'lucide-react'
import '@/styles/globals.css'

type View = 'dashboard' | 'backup-sets' | 'schedules' | 'cloud' | 'settings'

const navItems = [
  { id: 'dashboard' as View, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'backup-sets' as View, label: 'Backup Sets', icon: FolderArchive },
  { id: 'schedules' as View, label: 'Schedules', icon: Calendar },
  { id: 'cloud' as View, label: 'Cloud Storage', icon: Cloud },
  { id: 'settings' as View, label: 'Settings', icon: SettingsIcon },
]

function App() {
  const { appState, setAppState, setOnboardingComplete, setBackupProgress } = useAppStore()
  const { theme, currentView, setCurrentView, sidebarOpen, setSidebarOpen } = useUIStore()
  const [isLoading, setIsLoading] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoUpdateAttempted = useRef(false)

  useEffect(() => {
    initializeApp()
  }, [])

  useEffect(() => {
    const unsubPromise = events.onBackupProgress(async (progress) => {
      setBackupProgress(progress)

      const status = progress.status?.toLowerCase()
      if (status === 'completed') {
        // Refresh state so counters (e.g. total backed up) stay in sync
        try {
          const refreshed = await api.getAppState()
          if (refreshed.success && refreshed.data) {
            setAppState(refreshed.data)
          }
        } catch (err) {
          console.error('Failed to refresh state after backup', err)
        }

        // Clear progress shortly after completion so UI hides finished bars
        setTimeout(() => setBackupProgress(null), 1500)
      }
    })

    return () => {
      unsubPromise.then((unsub) => unsub?.())
    }
  }, [setBackupProgress, setAppState])

  useEffect(() => {
    // Apply theme
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', isDark)
    } else {
      document.documentElement.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  useEffect(() => {
    if (!appState?.settings?.check_for_updates) return
    if (autoUpdateAttempted.current) return

    autoUpdateAttempted.current = true
    ;(async () => {
      try {
        const update = await checkForUpdate()
        if (!update?.available) return

        await update.downloadAndInstall((event: DownloadEvent) => {
          console.log('Auto-update progress', event)
        })

        await relaunch()
      } catch (err) {
        console.error('Auto-update check failed', err)
        // Avoid re-running in a tight loop; rely on manual check if this fails
      }
    })()
  }, [appState?.settings?.check_for_updates])

  const initializeApp = async () => {
    try {
      setError(null)
      const result = await api.getAppState()
      if (result.success && result.data) {
        setAppState(result.data)
        // Check the correct field: onboarding.completed
        const isOnboardingComplete = result.data.onboarding?.completed === true
        setShowOnboarding(!isOnboardingComplete)
      } else {
        // No data or error, show onboarding
        setShowOnboarding(true)
      }
    } catch (err) {
      console.error('Failed to initialize app:', err)
      setError(err instanceof Error ? err.message : 'Failed to connect to backend')
      // On error, still show onboarding so user isn't stuck
      setShowOnboarding(true)
    }
    setIsLoading(false)
  }

  const handleOnboardingComplete = async () => {
    // First hide onboarding immediately to prevent blank screen
    setShowOnboarding(false)
    setOnboardingComplete(true)

    // Then reload app state in background
    try {
      const result = await api.getAppState()
      if (result.success && result.data) {
        setAppState(result.data)
      }
    } catch (err) {
      console.error('Failed to reload app state:', err)
    }
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />
      case 'backup-sets':
        return <BackupSets />
      case 'schedules':
        return <Schedule />
      case 'cloud':
        return <CloudStorage />
      case 'settings':
        return <Settings />
      default:
        return <Dashboard />
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <Titlebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-2xl">S</span>
            </div>
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <Titlebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 p-8 max-w-md text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold">Connection Error</h2>
            <p className="text-muted-foreground">{error}</p>
            <button
              onClick={() => {
                setIsLoading(true)
                setError(null)
                initializeApp()
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (showOnboarding) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <Titlebar />
        <div className="flex-1 overflow-auto">
          <Onboarding onComplete={handleOnboardingComplete} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarOpen ? 240 : 70 }}
          transition={{ duration: 0.2 }}
          className="relative flex flex-col border-r bg-card"
        >
          {/* Navigation */}
          <nav className="flex-1 p-3 pt-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = currentView === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id)}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors ${isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {sidebarOpen && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm font-medium whitespace-nowrap overflow-hidden"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </button>
              )
            })}
          </nav>

          <div className="border-t">
            <DownloadDock sidebarOpen={sidebarOpen} />
          </div>

          <div className="p-3 border-t">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center justify-center w-full p-2 rounded-lg hover:bg-muted transition-colors"
            >
              {sidebarOpen ? (
                <ChevronLeft className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </motion.aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {renderView()}
          </motion.div>
        </main>
      </div>
    </div>
  )
}

export default App
