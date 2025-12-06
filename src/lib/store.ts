import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, BackupSet, Schedule, Location, BackupProgress, AppSettings } from './tauri'

interface AppStore {
  // State
  appState: AppState | null
  isLoading: boolean
  currentBackupProgress: BackupProgress | null
  
  // Actions
  setAppState: (state: AppState) => void
  setLoading: (loading: boolean) => void
  setBackupProgress: (progress: BackupProgress | null) => void
  setOnboardingComplete: (complete: boolean) => void
  
  // Backup sets
  addBackupSet: (set: BackupSet) => void
  updateBackupSet: (id: string, updates: Partial<BackupSet>) => void
  removeBackupSet: (id: string) => void
  
  // Schedules
  addSchedule: (schedule: Schedule) => void
  updateSchedule: (id: string, updates: Partial<Schedule>) => void
  removeSchedule: (id: string) => void
  
  // Settings
  updateSettings: (settings: Partial<AppSettings>) => void
  
  // Location
  setLocation: (location: Location | null) => void
  
  // Auth
  setGoogleAuthenticated: (authenticated: boolean) => void
}

export const useAppStore = create<AppStore>()((set) => ({
  appState: null,
  isLoading: true,
  currentBackupProgress: null,

  setAppState: (appState) => set({ appState }),
  setLoading: (isLoading) => set({ isLoading }),
  setBackupProgress: (currentBackupProgress) => set({ currentBackupProgress }),
  
  setOnboardingComplete: (complete) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        onboarding: {
          ...state.appState.onboarding,
          completed: complete
        }
      }
    }
  }),

  addBackupSet: (backupSet) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        backup_sets: {
          sets: [...state.appState.backup_sets.sets, backupSet]
        }
      }
    }
  }),

  updateBackupSet: (id, updates) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        backup_sets: {
          sets: state.appState.backup_sets.sets.map(s => 
            s.id === id ? { ...s, ...updates } : s
          )
        }
      }
    }
  }),

  removeBackupSet: (id) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        backup_sets: {
          sets: state.appState.backup_sets.sets.filter(s => s.id !== id)
        }
      }
    }
  }),

  addSchedule: (schedule) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        schedules: [...state.appState.schedules, schedule]
      }
    }
  }),

  updateSchedule: (id, updates) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        schedules: state.appState.schedules.map(s => 
          s.id === id ? { ...s, ...updates } : s
        )
      }
    }
  }),

  removeSchedule: (id) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        schedules: state.appState.schedules.filter(s => s.id !== id)
      }
    }
  }),

  updateSettings: (settings) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        settings: { ...state.appState.settings, ...settings }
      }
    }
  }),

  setLocation: (location) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        location
      }
    }
  }),

  setGoogleAuthenticated: (authenticated) => set((state) => {
    if (!state.appState) return state
    return {
      appState: {
        ...state.appState,
        onboarding: {
          ...state.appState.onboarding,
          google_connected: authenticated
        }
      }
    }
  }),
}))

// UI Store for local UI state
interface UIStore {
  sidebarOpen: boolean
  currentView: string
  theme: 'light' | 'dark' | 'system'
  
  setSidebarOpen: (open: boolean) => void
  setCurrentView: (view: string) => void
  setTheme: (theme: UIStore['theme']) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      currentView: 'dashboard',
      theme: 'system',

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setCurrentView: (currentView) => set({ currentView }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'sentry-ui-storage',
    }
  )
)
