import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { 
  Activity, 
  Cloud, 
  FolderArchive, 
  Clock, 
  CloudRain,
  AlertTriangle,
  CheckCircle2,
  Play,
  ArrowUpRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { useAppStore, useUIStore } from '@/lib/store'
import { api } from '@/lib/tauri'
import type { BackupSet } from '@/lib/tauri'
import { formatBytes, formatRelativeTime } from '@/lib/utils'

export function Dashboard() {
  const { appState, currentBackupProgress } = useAppStore()
  const { setCurrentView } = useUIStore()
  const [weatherAlerts, setWeatherAlerts] = useState<any[]>([])
  const [isRunningBackup, setIsRunningBackup] = useState(false)
  const [noChangePromptSet, setNoChangePromptSet] = useState<BackupSet | null>(null)
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([])

  const backupSets = appState?.backup_sets?.sets ?? []
  const schedules = appState?.schedules ?? []
  const enabledSets = backupSets.filter((s) => s.enabled)

  useEffect(() => {
    // Fetch weather alerts
    const fetchWeather = async () => {
      try {
        const result = await api.getWeatherAlerts()
        if (result.success && result.data) {
          setWeatherAlerts(result.data)
        }
      } catch (error) {
        console.error('Failed to fetch weather alerts:', error)
      }
    }

    if (appState?.location) {
      fetchWeather()
    }
  }, [appState?.location])

  // Keep selected sets in sync with enabled sets
  useEffect(() => {
    const enabledIds = enabledSets.map((s) => s.id)
    setSelectedSetIds((prev) => {
      const filtered = prev.filter((id) => enabledIds.includes(id))
      const next =
        filtered.length > 0
          ? filtered
          : enabledIds.length > 0
            ? [enabledIds[0]]
            : []

      // Avoid pointless state updates that can cause render loops
      const sameLength = next.length === prev.length
      const sameOrder = sameLength && next.every((id, idx) => id === prev[idx])
      if (sameOrder) return prev
      return next
    })
  }, [enabledSets])

  // When opening the modal, ensure at least one set is selected if available
  useEffect(() => {
    if (showBackupModal && selectedSetIds.length === 0 && enabledSets.length > 0) {
      setSelectedSetIds([enabledSets[0].id])
    }
  }, [showBackupModal, selectedSetIds.length, enabledSets])

  const runBackupForSet = async (set: BackupSet, forceFull = true, manageRunning = true) => {
    if (manageRunning) setIsRunningBackup(true)
    try {
      const incremental = forceFull ? false : set.incremental
      const result = await api.runBackup(set.id, incremental)
      if (result.success && result.data) {
        if (result.data.total_bytes === 0 && result.data.total_files === 0) {
          if (!forceFull) {
            setNoChangePromptSet(set)
          }
        }
      }
    } catch (error) {
      console.error('Backup failed:', error)
    }
    if (manageRunning) setIsRunningBackup(false)
  }

  const runSelectedBackups = async () => {
    if (selectedSetIds.length === 0) return
    setShowBackupModal(false)
    setIsRunningBackup(true)

    for (const id of selectedSetIds) {
      const chosen = backupSets.find(s => s.id === id)
      if (chosen) {
        // Force full backup regardless of detected changes
        await runBackupForSet(chosen, true, false)
      }
    }

    setIsRunningBackup(false)
  }

  const totalBackedUp = backupSets.reduce((acc, s) => acc + s.total_size_backed_up, 0)
  const totalBackups = backupSets.reduce((acc, s) => acc + s.total_backups, 0)

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={item}>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor your backups and storage at a glance
        </p>
      </motion.div>

      {/* Quick actions */}
      <motion.div variants={item}>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">Quick Actions</h2>
                <p className="text-sm text-muted-foreground">
                  {backupSets.length} backup set{backupSets.length !== 1 ? 's' : ''} configured
                </p>
              </div>
              <div className="flex gap-3 items-center flex-wrap justify-end">
                <Button
                  onClick={() => setShowBackupModal(true)}
                  disabled={isRunningBackup || enabledSets.length === 0}
                >
                  <Play className="w-4 h-4 mr-2" />
                  {isRunningBackup ? 'Running...' : 'Backup Now'}
                </Button>
              </div>
            </div>

            {currentBackupProgress && currentBackupProgress.status !== 'Completed' ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 rounded-lg bg-muted flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    Backing up: {currentBackupProgress.current_file || 'Preparing...'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {currentBackupProgress.processed_files}/{currentBackupProgress.total_files} files
                  </span>
                </div>
                <Progress
                  value={
                    currentBackupProgress.total_bytes > 0
                      ? (currentBackupProgress.processed_bytes / currentBackupProgress.total_bytes) * 100
                      : 100
                  }
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatBytes(currentBackupProgress.processed_bytes)} / {formatBytes(currentBackupProgress.total_bytes)}</span>
                  <span className="capitalize">{currentBackupProgress.status}</span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 rounded-lg bg-muted text-sm text-muted-foreground"
              >
                No active backup. Start one from Backup Sets or Quick Actions.
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Stats grid */}
      <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <FolderArchive className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{backupSets.length}</p>
                <p className="text-sm text-muted-foreground">Backup Sets</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalBackups}</p>
                <p className="text-sm text-muted-foreground">Total Backups</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Cloud className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatBytes(totalBackedUp)}</p>
                <p className="text-sm text-muted-foreground">Data Backed Up</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Clock className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{schedules.filter(s => s.enabled).length}</p>
                <p className="text-sm text-muted-foreground">Active Schedules</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent activity and weather */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent backups */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Recent Backup Sets
            </CardTitle>
            <CardDescription>Your most recently updated backup sets</CardDescription>
          </CardHeader>
          <CardContent>
            {backupSets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderArchive className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No backup sets created yet</p>
                <Button 
                  variant="link" 
                  onClick={() => setCurrentView('backup-sets')}
                  className="mt-2"
                >
                  Create your first backup set
                  <ArrowUpRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {backupSets.slice(0, 5).map((set) => (
                  <div 
                    key={set.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">{set.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {set.last_backup 
                          ? `Last backup: ${formatRelativeTime(set.last_backup)}`
                          : 'Never backed up'
                        }
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatBytes(set.total_size_backed_up)}</p>
                      <p className="text-xs text-muted-foreground">
                        {set.total_backups} backup{set.total_backups !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Weather alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudRain className="w-5 h-5" />
              Weather Alerts
            </CardTitle>
            <CardDescription>
              {appState?.location 
                ? `Monitoring ${appState.location.city}, ${appState.location.state}`
                : 'Location not set'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!appState?.location ? (
              <div className="text-center py-8 text-muted-foreground">
                <CloudRain className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Location not configured</p>
                <Button 
                  variant="link" 
                  onClick={() => setCurrentView('settings')}
                  className="mt-2"
                >
                  Set up weather alerts
                  <ArrowUpRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            ) : weatherAlerts.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                </div>
                <p className="font-medium">All Clear</p>
                <p className="text-sm text-muted-foreground">No active weather alerts in your area</p>
              </div>
            ) : (
              <div className="space-y-3">
                {weatherAlerts.slice(0, 3).map((alert) => (
                  <div 
                    key={alert.id}
                    className="p-3 rounded-lg bg-orange-100 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-orange-800 dark:text-orange-200">
                          {alert.event}
                        </p>
                        <p className="text-sm text-orange-700 dark:text-orange-300 line-clamp-2">
                          {alert.headline}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Confirm full backup when no changes detected */}
      <Dialog
        open={!!noChangePromptSet}
        onOpenChange={(open) => !open && setNoChangePromptSet(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              No changes detected
            </DialogTitle>
            <DialogDescription>
              No file changes were detected since the last backup. Do you still
              want to run a full backup for{' '}
              <span className="font-medium">{noChangePromptSet?.name}</span>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setNoChangePromptSet(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (noChangePromptSet) {
                  await runBackupForSet(noChangePromptSet, true)
                }
                setNoChangePromptSet(null)
              }}
            >
              Backup anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Select backup sets modal */}
      <Dialog open={showBackupModal} onOpenChange={setShowBackupModal}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle>Select backup sets</DialogTitle>
            <DialogDescription>
              Choose which backup sets to run from Quick Actions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {enabledSets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No enabled backup sets. Enable a set first.
              </p>
            ) : (
              enabledSets.map((set) => {
                const checked = selectedSetIds.includes(set.id)
                return (
                  <label
                    key={set.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(val) => {
                        const isChecked = Boolean(val)
                        setSelectedSetIds((prev) =>
                          isChecked
                            ? [...prev, set.id]
                            : prev.filter((id) => id !== set.id)
                        )
                      }}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{set.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(set.total_size_backed_up)} backed up •{' '}
                        {set.total_backups} backups
                      </span>
                    </div>
                  </label>
                )
              })
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowBackupModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={runSelectedBackups}
              disabled={selectedSetIds.length === 0 || enabledSets.length === 0 || isRunningBackup}
            >
              Backup selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
