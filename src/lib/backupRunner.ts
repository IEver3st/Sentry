import { api } from '@/lib/tauri'
import type { BackupSet } from '@/lib/tauri'
import { useAppStore } from '@/lib/store'

function getBackupSetFromStore(id: string): BackupSet | null {
  const { appState } = useAppStore.getState()
  return appState?.backup_sets?.sets.find((set) => set.id === id) ?? null
}

export async function runBackupForSet(setId: string) {
  const store = useAppStore.getState()
  const backupSet = getBackupSetFromStore(setId)

  if (!backupSet) {
    throw new Error('Backup set not found')
  }

  const result = await api.runBackup(setId, backupSet.incremental)

  if (!result.success) {
    throw new Error(result.error ?? 'Backup failed')
  }

  if (result.data) {
    // If nothing changed, skip stat increments to avoid misleading counters
    if (result.data.total_bytes === 0 && result.data.total_files === 0) {
      return result
    }

    const { updateBackupSet } = store
    updateBackupSet(setId, {
      last_backup: result.data.completed_at,
      total_backups: backupSet.total_backups + 1,
      total_size_backed_up: backupSet.total_size_backed_up + result.data.total_bytes,
    })
  }

  return result
}

export async function runFirstEnabledBackup() {
  const { appState } = useAppStore.getState()
  const enabledSet = appState?.backup_sets?.sets.find((set) => set.enabled)

  if (!enabledSet) {
    throw new Error('No enabled backup sets available')
  }

  return runBackupForSet(enabledSet.id)
}
