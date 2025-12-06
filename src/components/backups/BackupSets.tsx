import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Plus,
  FolderOpen,
  HardDrive,
  Cloud,
  Trash2,
  Play,
  Check,
  Clock,
  FileArchive,
  CheckCircle2,
  FolderPlus,
  Loader2,
  Files,
  Edit,
  AlertTriangle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'
import { api, events } from '@/lib/tauri'
import { Progress } from '@/components/ui/progress'
import type { BackupSet } from '@/lib/tauri'
import { formatBytes, formatRelativeTime } from '@/lib/utils'

// Helper function to determine backup type
function getBackupType(set: BackupSet): 'local' | 'cloud' | 'both' {
  if (set.cloud_upload && set.local_destination) {
    return 'both'
  } else if (set.cloud_upload) {
    return 'cloud'
  } else {
    return 'local'
  }
}

function getBackupTypeDisplay(type: 'local' | 'cloud' | 'both') {
  switch (type) {
    case 'local':
      return { icon: FileArchive, text: 'Local Only' }
    case 'cloud':
      return { icon: Cloud, text: 'Cloud Only' }
    case 'both':
      return { icon: Cloud, text: 'Cloud + Local' }
  }
}

interface FolderStats {
  file_count: number
  total_size: number
}

export function BackupSets() {
  const { appState, addBackupSet, updateBackupSet, removeBackupSet, setBackupProgress, currentBackupProgress } = useAppStore()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingSetId, setEditingSetId] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState<string | null>(null)
  const [newSetName, setNewSetName] = useState('')
  const [newSetDescription, setNewSetDescription] = useState('')
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [backupType, setBackupType] = useState<'local' | 'cloud' | 'both'>('local')
  const [localDestination, setLocalDestination] = useState('')
  const [folderStats, setFolderStats] = useState<Record<string, FolderStats>>({})
  const [loadingStats, setLoadingStats] = useState<Record<string, boolean>>({})
  const [noChangePromptSet, setNoChangePromptSet] = useState<BackupSet | null>(null)

  const backupSets = appState?.backup_sets?.sets || []

  // Listen for backup progress events
  useEffect(() => {
    const unsub = events.onBackupProgress((progress) => {
      setBackupProgress(progress)

      if (progress.status === 'Completed') {
        setIsRunning(null)
        api.getBackupSets().then((result) => {
          if (result.success && result.data) {
            result.data.forEach((set) => updateBackupSet(set.id, set))
          }
        }).catch(() => {})
      } else if (progress.status === 'Failed') {
        setIsRunning(null)
        console.error('Backup failed:', progress.error)
      }
    })

    return () => {
      unsub.then(unsubscribe => unsubscribe?.())
    }
  }, [setBackupProgress, updateBackupSet])

  // Load folder stats for all backup sets
  useEffect(() => {
    const loadFolderStats = async () => {
      for (const set of backupSets) {
        if (!folderStats[set.id] && !loadingStats[set.id] && set.sources.length > 0) {
          setLoadingStats(prev => ({ ...prev, [set.id]: true }))
          try {
            const result = await api.getFolderStats(set.sources)
            if (result.success && result.data) {
              setFolderStats(prev => ({ ...prev, [set.id]: result.data! }))
            }
          } catch (error) {
            console.error('Failed to get folder stats:', error)
          }
          setLoadingStats(prev => ({ ...prev, [set.id]: false }))
        }
      }
    }
    loadFolderStats()
  }, [backupSets])

  const handlePickDirectories = async () => {
    try {
      const dirs = await api.pickDirectories()
      if (dirs && dirs.length > 0) {
        setSelectedSources([...selectedSources, ...dirs])
      }
    } catch (error) {
      console.error('Failed to pick directories:', error)
    }
  }

  const handlePickDestination = async () => {
    try {
      const dir = await api.pickDirectory()
      if (dir) {
        setLocalDestination(dir)
      }
    } catch (error) {
      console.error('Failed to pick destination:', error)
    }
  }

  const handleCreateSet = async () => {
    if (!newSetName.trim() || selectedSources.length === 0) return

    try {
      if (editingSetId) {
        // Update existing set
        const originalSet = backupSets.find(s => s.id === editingSetId)
        if (originalSet) {
          const cloudUpload = backupType === 'cloud' || backupType === 'both'
          const updatedSet: BackupSet = {
            ...originalSet,
            name: newSetName.trim(),
            description: newSetDescription.trim() || null,
            sources: selectedSources,
            paths: selectedSources,
            cloud_upload: cloudUpload,
            local_destination: (backupType === 'local' || backupType === 'both') ? localDestination : null
          }

          await api.updateBackupSet(updatedSet)
          updateBackupSet(editingSetId, updatedSet)
        }
      } else {
        // Create new set
        const result = await api.createBackupSet(newSetName, selectedSources)
        if (result.success && result.data) {
          const cloudUpload = backupType === 'cloud' || backupType === 'both'
          const updatedSet = {
            ...result.data,
            description: newSetDescription.trim() || null,
            cloud_upload: cloudUpload,
            local_destination: (backupType === 'local' || backupType === 'both') ? localDestination : null
          }
          await api.updateBackupSet(updatedSet)
          addBackupSet(updatedSet)
        }
      }

      setIsCreateOpen(false)
      setEditingSetId(null)
      setNewSetName('')
      setNewSetDescription('')
      setSelectedSources([])
      setBackupType('local')
      setLocalDestination('')
    } catch (error) {
      console.error('Failed to save backup set:', error)
    }
  }

  const handleEditSet = (set: BackupSet) => {
    setEditingSetId(set.id)
    setNewSetName(set.name)
    setNewSetDescription(set.description || '')
    setSelectedSources(set.sources)

    if (set.cloud_upload && set.local_destination) {
      setBackupType('both')
      setLocalDestination(set.local_destination)
    } else if (set.cloud_upload) {
      setBackupType('cloud')
    } else {
      setBackupType('local')
      setLocalDestination(set.local_destination || '')
    }

    setIsCreateOpen(true)
  }

  const handleDeleteSet = async (id: string) => {
    try {
      const result = await api.deleteBackupSet(id)
      if (result.success) {
        removeBackupSet(id)
      }
    } catch (error) {
      console.error('Failed to delete backup set:', error)
    }
  }

  const handleRunBackup = async (set: BackupSet, forceFull?: boolean) => {
    console.log('handleRunBackup called for set:', set.id, set.name)
    setIsRunning(set.id)
    try {
      console.log('Calling api.runBackup for set:', set.id, 'incremental:', set.incremental)
      const incremental = forceFull ? false : set.incremental
      const result = await api.runBackup(set.id, incremental)
      console.log('runBackup result:', JSON.stringify(result, null, 2))
      if (result.success && result.data) {
        console.log('Backup successful! Files:', result.data.total_files, 'Bytes:', result.data.total_bytes)
        if (result.data.total_bytes === 0 && result.data.total_files === 0) {
          if (!forceFull) {
            setNoChangePromptSet(set)
          }
        } else {
          // Update the set with new stats
          updateBackupSet(set.id, {
            last_backup: new Date().toISOString(),
            total_backups: set.total_backups + 1,
            total_size_backed_up: set.total_size_backed_up + result.data.total_bytes
          })
          // Refresh folder stats
          setFolderStats(prev => {
            const updated = { ...prev }
            delete updated[set.id]
            return updated
          })
        }
      } else {
        console.error('Backup failed:', result.error)
        alert('Backup failed: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Backup exception:', error)
      alert('Backup error: ' + String(error))
    }
    setIsRunning(null)
  }

  const handleToggleEnabled = async (set: BackupSet) => {
    try {
      const updatedSet = { ...set, enabled: !set.enabled }
      const result = await api.updateBackupSet(updatedSet)
      if (result.success) {
        updateBackupSet(set.id, { enabled: !set.enabled })
      }
    } catch (error) {
      console.error('Failed to update backup set:', error)
    }
  }

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
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Backup Sets</h1>
          <p className="text-muted-foreground">
            Configure and manage your backup collections
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingSetId(null)
              setNewSetName('')
              setNewSetDescription('')
              setSelectedSources([])
              setBackupType('local')
              setLocalDestination('')
            }}>
              <Plus className="w-4 h-4 mr-2" />
              New Backup Set
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSetId ? 'Edit Backup Set' : 'Create Backup Set'}</DialogTitle>
              <DialogDescription>
                Create a new collection of folders to back up together
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="My Important Files"
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  placeholder="Backup of important documents and projects"
                  value={newSetDescription}
                  onChange={(e) => setNewSetDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Backup Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  <div
                    className={`relative cursor-pointer rounded-lg border-2 p-3 transition-all ${backupType === 'local'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                      }`}
                    onClick={() => setBackupType('local')}
                  >
                    {backupType === 'local' && (
                      <div className="absolute right-1 top-1">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-center text-center space-y-1">
                      <HardDrive className="h-6 w-6 text-muted-foreground" />
                      <div className="text-sm font-medium">Local</div>
                      <p className="text-xs text-muted-foreground">
                        Stored on your computer
                      </p>
                    </div>
                  </div>

                  <div
                    className={`relative cursor-pointer rounded-lg border-2 p-3 transition-all ${backupType === 'both'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                      }`}
                    onClick={() => setBackupType('both')}
                  >
                    {backupType === 'both' && (
                      <div className="absolute right-1 top-1">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-center text-center space-y-1">
                      <div className="flex items-center gap-1">
                        <HardDrive className="h-5 w-5 text-muted-foreground" />
                        <Cloud className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium">Both</div>
                      <p className="text-xs text-muted-foreground">
                        Local + Google Drive
                      </p>
                    </div>
                  </div>

                  <div
                    className={`relative cursor-pointer rounded-lg border-2 p-3 transition-all ${backupType === 'cloud'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                      }`}
                    onClick={() => setBackupType('cloud')}
                  >
                    {backupType === 'cloud' && (
                      <div className="absolute right-1 top-1">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-center text-center space-y-1">
                      <Cloud className="h-6 w-6 text-muted-foreground" />
                      <div className="text-sm font-medium">Cloud</div>
                      <p className="text-xs text-muted-foreground">
                        Google Drive only
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Local destination picker - shown conditionally */}
              {(backupType === 'local' || backupType === 'both') && (
                <div className="space-y-2">
                  <Label>Local Backup Destination</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Choose where to store local backups..."
                      value={localDestination}
                      readOnly
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handlePickDestination}
                      className="shrink-0"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Local backups will be stored in this location
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Folders to backup</Label>
                <div className="space-y-2">
                  {selectedSources.map((source, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 rounded bg-muted text-sm"
                    >
                      <FolderOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{source}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setSelectedSources(selectedSources.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handlePickDirectories}
                  >
                    <FolderPlus className="w-4 h-4 mr-2" />
                    Add Folders
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSet}
                disabled={!newSetName.trim() || selectedSources.length === 0}
              >
                {editingSetId ? 'Save Changes' : 'Create Backup Set'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Backup sets grid */}
      {backupSets.length === 0 ? (
        <motion.div variants={item}>
          <Card>
            <CardContent className="py-16 text-center">
              <FileArchive className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-semibold mb-2">No backup sets yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first backup set to start protecting your files
              </p>
              <Button onClick={() => {
                setEditingSetId(null)
                setNewSetName('')
                setNewSetDescription('')
                setSelectedSources([])
                setBackupType('local')
                setLocalDestination('')
                setIsCreateOpen(true)
              }}>
                <Plus className="w-4 h-4 mr-2" />
                Create Backup Set
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {backupSets.map((set) => {
            const backupType = getBackupType(set)
            const backupTypeDisplay = getBackupTypeDisplay(backupType)
            const Icon = backupTypeDisplay.icon
            const isSetRunning = isRunning === set.id || currentBackupProgress?.backup_set_id === set.id
            const progressValue =
              currentBackupProgress && currentBackupProgress.backup_set_id === set.id
                ? Math.min(
                    100,
                    (currentBackupProgress.processed_bytes / Math.max(currentBackupProgress.total_bytes || 1, 1)) * 100
                  )
                : undefined

            return (
              <Card key={set.id} className={!set.enabled ? 'opacity-60' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-lg">{set.name}</CardTitle>
                        {isSetRunning && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                            Running
                          </span>
                        )}
                      </div>
                      {set.description && (
                        <CardDescription>{set.description}</CardDescription>
                      )}
                      <CardDescription>
                        {set.sources.length} folder{set.sources.length !== 1 ? 's' : ''}
                      </CardDescription>
                      <CardDescription className="flex items-center gap-1">
                        <Icon className="w-3 h-3" />
                        {backupTypeDisplay.text}
                      </CardDescription>
                      {set.local_destination && (
                        <CardDescription className="text-xs">
                          📁 {set.local_destination}
                        </CardDescription>
                      )}
                    </div>
                    <Switch
                      checked={set.enabled}
                      onCheckedChange={() => handleToggleEnabled(set)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Source Size</p>
                      <p className="text-xl font-semibold">
                        {loadingStats[set.id] ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          formatBytes(folderStats[set.id]?.total_size || 0)
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Files className="w-3 h-3" />
                        Files
                      </p>
                      <p className="text-xl font-semibold">
                        {loadingStats[set.id] ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          (folderStats[set.id]?.file_count || 0).toLocaleString()
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Backups</p>
                      <p className="text-xl font-semibold">{set.total_backups}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Backed Up</p>
                      <p className="text-xl font-semibold">{formatBytes(set.total_size_backed_up)}</p>
                    </div>
                  </div>

                  {progressValue !== undefined && (
                    <div className="space-y-1">
                      <Progress value={progressValue} />
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(currentBackupProgress?.processed_bytes || 0)} / {formatBytes(currentBackupProgress?.total_bytes || 0)} • {currentBackupProgress?.status}
                      </p>
                    </div>
                  )}

                  <Separator />

                  {/* Last backup info */}
                  <div className="flex items-center gap-2 text-sm">
                    {set.last_backup ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>Last backup: {formatRelativeTime(set.last_backup)}</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Never backed up</span>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={!set.enabled || isRunning === set.id}
                      onClick={() => handleRunBackup(set)}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {isRunning === set.id ? 'Running...' : 'Backup Now'}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEditSet(set)}
                      disabled={isRunning === set.id}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDeleteSet(set.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </motion.div>
      )}

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
              onClick={() => {
                if (noChangePromptSet) {
                  handleRunBackup(noChangePromptSet, true)
                }
                setNoChangePromptSet(null)
              }}
            >
              Backup anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
