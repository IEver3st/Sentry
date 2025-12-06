import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Edit,
  CloudRain,
  Play,
  Pause,
  AlertTriangle,
  Check,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import { api, events, type Schedule as ScheduleType, type BackupSet } from '@/lib/tauri'

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEATHER_ALERT_TYPES = [
  { id: 'tornado', label: 'Tornado Warning', severity: 'extreme' },
  { id: 'severe_thunderstorm', label: 'Severe Thunderstorm', severity: 'severe' },
  { id: 'flood', label: 'Flash Flood', severity: 'severe' },
  { id: 'hurricane', label: 'Hurricane/Typhoon', severity: 'extreme' },
  { id: 'winter_storm', label: 'Winter Storm', severity: 'moderate' },
]

export function Schedule() {
  const { addSchedule, updateSchedule, removeSchedule, currentBackupProgress } = useAppStore()
  const [schedules, setSchedules] = useState<ScheduleType[]>([])
  const [backupSets, setBackupSets] = useState<BackupSet[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ScheduleType | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [selectedSetId, setSelectedSetId] = useState<string>('')
  const [scheduleType, setScheduleType] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [time, setTime] = useState('02:00')
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [enabled, setEnabled] = useState(true)
  const [weatherEnabled, setWeatherEnabled] = useState(false)
  const [weatherAlerts, setWeatherAlerts] = useState<string[]>(['tornado', 'hurricane'])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const unsubPromise = events.onBackupProgress((progress) => {
      if (progress.status?.toLowerCase() === 'completed') {
        loadData()
      }
    })
    return () => {
      unsubPromise.then((unsub) => unsub?.())
    }
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [schedulesResult, setsResult] = await Promise.all([
        api.listSchedules(),
        api.listBackupSets()
      ])
      if (schedulesResult.success && schedulesResult.data) {
        setSchedules(schedulesResult.data)
      }
      if (setsResult.success && setsResult.data) {
        setBackupSets(setsResult.data)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    }
    setIsLoading(false)
  }

  const resetForm = () => {
    setName('')
    setSelectedSetId(backupSets[0]?.id || '')
    setScheduleType('daily')
    setTime('02:00')
    setSelectedDays([1, 2, 3, 4, 5])
    setDayOfMonth(1)
    setEnabled(true)
    setWeatherEnabled(false)
    setWeatherAlerts(['tornado', 'hurricane'])
    setEditingSchedule(null)
  }

  const openAddDialog = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEditDialog = (schedule: ScheduleType) => {
    setEditingSchedule(schedule)
    setName(schedule.name)
    setSelectedSetId(schedule.backup_set_id)
    setScheduleType(schedule.schedule_type)
    setTime(schedule.time)
    setSelectedDays(schedule.days_of_week || [1, 2, 3, 4, 5])
    setDayOfMonth(schedule.day_of_month || 1)
    setEnabled(schedule.enabled)
    setWeatherEnabled(schedule.weather_trigger_enabled || false)
    setWeatherAlerts(schedule.weather_alert_types || ['tornado', 'hurricane'])
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!name.trim() || !selectedSetId) {
      console.log('Validation failed: name or selectedSetId missing')
      return
    }

    console.log('handleSave called:', { name, selectedSetId, scheduleType, time })
    setIsSaving(true)
    try {
      if (editingSchedule) {
        // Update existing schedule
        const updatedSchedule: ScheduleType = {
          ...editingSchedule,
          name: name.trim(),
          backup_set_id: selectedSetId,
          schedule_type: scheduleType,
          time,
          days_of_week: scheduleType === 'weekly' ? selectedDays : undefined,
          day_of_month: scheduleType === 'monthly' ? dayOfMonth : undefined,
          enabled,
          weather_trigger_enabled: weatherEnabled,
          weather_alert_types: weatherEnabled ? weatherAlerts : undefined,
        }
        console.log('Updating schedule:', updatedSchedule)
        const result = await api.updateSchedule(updatedSchedule)
        console.log('Update result:', result)
        if (result.success) {
          updateSchedule(editingSchedule.id, updatedSchedule)
          await loadData()
        } else {
          console.error('Update failed:', result.error)
          alert('Failed to update schedule: ' + (result.error || 'Unknown error'))
        }
      } else {
        // Create new schedule
        console.log('Creating new schedule...')
        const result = await api.createSchedule({
          name: name.trim(),
          backupSetId: selectedSetId,
          scheduleType: scheduleType,
          time,
          daysOfWeek: scheduleType === 'weekly' ? selectedDays : undefined,
          dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : undefined,
        })
        console.log('Create result:', result)
        if (result.success && result.data) {
          console.log('Schedule created successfully:', result.data)
          // If we need to set weather triggers, do it separately
          if (weatherEnabled && weatherAlerts.length > 0) {
            await api.setWeatherTriggers(result.data.id, weatherAlerts)
          }
          addSchedule(result.data)
          await loadData()
        } else {
          console.error('Create failed:', result.error)
          alert('Failed to create schedule: ' + (result.error || 'Unknown error'))
        }
      }
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      console.error('Failed to save schedule:', error)
      alert('Error saving schedule: ' + String(error))
    }
    setIsSaving(false)
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await api.deleteSchedule(id)
      if (result.success) {
        removeSchedule(id)
        await loadData()
      }
    } catch (error) {
      console.error('Failed to delete schedule:', error)
    }
  }

  const handleToggleEnabled = async (schedule: ScheduleType) => {
    try {
      const result = await api.updateSchedule({ ...schedule, enabled: !schedule.enabled })
      if (result.success) {
        updateSchedule(schedule.id, { enabled: !schedule.enabled })
        await loadData()
      }
    } catch (error) {
      console.error('Failed to toggle schedule:', error)
    }
  }

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    )
  }

  const toggleWeatherAlert = (alertId: string) => {
    setWeatherAlerts(prev =>
      prev.includes(alertId) ? prev.filter(a => a !== alertId) : [...prev, alertId]
    )
  }

  const getBackupSetName = (id: string) => {
    return backupSets.find(s => s.id === id)?.name || 'Unknown'
  }

  const formatNextRun = (schedule: ScheduleType) => {
    if (schedule.next_run) {
      return new Date(schedule.next_run).toLocaleString()
    }
    return 'Not scheduled'
  }

  const timezoneLabel = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time',
    []
  )

  const setTimeOffsetMinutes = useCallback((minutes: number) => {
    const dt = new Date(Date.now() + minutes * 60 * 1000)
    const hh = String(dt.getHours()).padStart(2, '0')
    const mm = String(dt.getMinutes()).padStart(2, '0')
    setTime(`${hh}:${mm}`)
  }, [])

  const formatLastRun = (schedule: ScheduleType) => {
    if (schedule.last_run) {
      return new Date(schedule.last_run).toLocaleString()
    }
    return 'Never'
  }

  const getScheduleStatus = (schedule: ScheduleType) => {
    if (currentBackupProgress?.backup_set_id === schedule.backup_set_id) {
      return { label: 'Running now', tone: 'blue' }
    }

    const nextTs = schedule.next_run ? new Date(schedule.next_run).getTime() : null
    const now = Date.now()

    if (nextTs) {
      const diff = nextTs - now
      if (diff <= 0) return { label: 'Due now', tone: 'amber' }
      if (diff <= 2 * 60 * 1000) return { label: 'Starting soon', tone: 'green' }
    }
    return null
  }

  const handleRunNow = async (schedule: ScheduleType) => {
    setRunningScheduleId(schedule.id)
    try {
      await api.runBackup(schedule.backup_set_id, false)
    } catch (error) {
      console.error('Failed to start backup:', error)
      alert('Failed to start backup: ' + String(error))
    }
    setRunningScheduleId(null)
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
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
          <h1 className="text-3xl font-bold">Schedules</h1>
          <p className="text-muted-foreground">
            Automate your backups with schedules and weather triggers
          </p>
        </div>
        <Button onClick={openAddDialog}>
          <Plus className="w-4 h-4 mr-2" />
          New Schedule
        </Button>
      </motion.div>

      {/* Schedules List */}
      {schedules.length === 0 ? (
        <motion.div variants={item}>
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Calendar className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No schedules yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first schedule to automate backups
              </p>
              <Button onClick={openAddDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Create Schedule
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="grid gap-4">
          <AnimatePresence>
            {schedules.map((schedule, index) => (
              <motion.div
                key={schedule.id}
                variants={item}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className={!schedule.enabled ? 'opacity-60' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${schedule.enabled
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                            }`}>
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-medium flex items-center gap-2">
                              {schedule.name}
                              {schedule.weather_trigger_enabled && (
                                <CloudRain className="w-4 h-4 text-blue-500" />
                              )}
                              {getScheduleStatus(schedule) && (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full ${
                                    getScheduleStatus(schedule)?.tone === 'blue'
                                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                                      : getScheduleStatus(schedule)?.tone === 'amber'
                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                                  }`}
                                >
                                  {getScheduleStatus(schedule)?.label}
                                </span>
                              )}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {getBackupSetName(schedule.backup_set_id)}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            <span>
                              {schedule.time} · {schedule.schedule_type}
                              {schedule.schedule_type === 'weekly' && schedule.days_of_week && (
                                <span className="ml-1">
                                  ({schedule.days_of_week.map(d => DAYS_OF_WEEK[d - 1]).join(', ')})
                                </span>
                              )}
                              {schedule.schedule_type === 'monthly' && (
                                <span className="ml-1">(Day {schedule.day_of_month})</span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Play className="w-4 h-4" />
                            <span>Next: {formatNextRun(schedule)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            <span>Last: {formatLastRun(schedule)}</span>
                          </div>
                          {currentBackupProgress?.backup_set_id === schedule.backup_set_id && (
                            <div className="text-sm text-blue-500 font-medium">
                              Running now
                            </div>
                          )}
                        </div>

                        {currentBackupProgress?.backup_set_id === schedule.backup_set_id && (
                          <div className="mt-3 space-y-1">
                            <Progress
                              value={
                                currentBackupProgress.total_bytes > 0
                                  ? (currentBackupProgress.processed_bytes / currentBackupProgress.total_bytes) * 100
                                  : 100
                              }
                            />
                            <p className="text-xs text-muted-foreground">
                              {Math.round(
                                currentBackupProgress.total_bytes > 0
                                  ? (currentBackupProgress.processed_bytes / currentBackupProgress.total_bytes) * 100
                                  : 100
                              )}
                              % • {currentBackupProgress.status}
                            </p>
                          </div>
                        )}

                        {schedule.weather_trigger_enabled && schedule.weather_alert_types && (
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            {schedule.weather_alert_types.map(alertType => (
                              <span
                                key={alertType}
                                className="px-2 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                              >
                                {WEATHER_ALERT_TYPES.find(a => a.id === alertType)?.label || alertType}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRunNow(schedule)}
                          disabled={runningScheduleId === schedule.id}
                        >
                          {runningScheduleId === schedule.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleEnabled(schedule)}
                        >
                          {schedule.enabled ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(schedule)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => handleDelete(schedule.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSchedule ? 'Edit Schedule' : 'Create Schedule'}
            </DialogTitle>
            <DialogDescription>
              Configure when and how backups should run
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Schedule Name</Label>
              <Input
                id="schedule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Nightly Backup"
              />
            </div>

            {/* Backup Set Selection */}
            <div className="space-y-2">
              <Label>Backup Set</Label>
              <div className="grid gap-2">
                {backupSets.map(set => (
                  <div
                    key={set.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedSetId === set.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'hover:bg-muted'
                      }`}
                    onClick={() => setSelectedSetId(set.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{set.name}</span>
                      {selectedSetId === set.id && (
                        <Check className="w-4 h-4 text-blue-500" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {set.paths.length} path(s)
                    </p>
                  </div>
                ))}
              </div>
              {backupSets.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No backup sets available. Create one first.
                </p>
              )}
            </div>

            <Separator />

            {/* Schedule Type */}
            <div className="space-y-2">
              <Label>Frequency</Label>
              <div className="flex gap-2">
                {(['daily', 'weekly', 'monthly'] as const).map(type => (
                  <Button
                    key={type}
                    variant={scheduleType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setScheduleType(type)}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Time */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="schedule-time">Time</Label>
                <span className="text-xs text-muted-foreground">Local: {timezoneLabel}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  id="schedule-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-32"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTimeOffsetMinutes(5)}>
                    In 5m
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTimeOffsetMinutes(15)}>
                    In 15m
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTimeOffsetMinutes(60)}>
                    In 1h
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTimeOffsetMinutes(8 * 60)}>
                    Tonight
                  </Button>
                </div>
              </div>
            </div>

            {/* Days of Week (for weekly) */}
            {scheduleType === 'weekly' && (
              <div className="space-y-2">
                <Label>Days</Label>
                <div className="flex gap-2">
                  {DAYS_OF_WEEK.map((day, index) => (
                    <Button
                      key={day}
                      variant={selectedDays.includes(index + 1) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => toggleDay(index + 1)}
                      className="w-10"
                    >
                      {day.charAt(0)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Day of Month (for monthly) */}
            {scheduleType === 'monthly' && (
              <div className="space-y-2">
                <Label htmlFor="day-of-month">Day of Month</Label>
                <Input
                  id="day-of-month"
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(parseInt(e.target.value) || 1)}
                />
              </div>
            )}

            <Separator />

            {/* Weather Triggers */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Weather Triggers</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically backup when severe weather is detected
                  </p>
                </div>
                <Switch
                  checked={weatherEnabled}
                  onCheckedChange={setWeatherEnabled}
                />
              </div>

              {weatherEnabled && (
                <div className="space-y-2">
                  <Label>Alert Types</Label>
                  <div className="space-y-2">
                    {WEATHER_ALERT_TYPES.map(alert => (
                      <div
                        key={alert.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted"
                      >
                        <Checkbox
                          id={alert.id}
                          checked={weatherAlerts.includes(alert.id)}
                          onCheckedChange={() => toggleWeatherAlert(alert.id)}
                        />
                        <label
                          htmlFor={alert.id}
                          className="flex-1 cursor-pointer"
                        >
                          <span>{alert.label}</span>
                          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${alert.severity === 'extreme'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                              : alert.severity === 'severe'
                                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                            }`}>
                            {alert.severity}
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Enabled */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Enabled</Label>
                <p className="text-sm text-muted-foreground">
                  Schedule is active and will run
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || !selectedSetId || isSaving}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {editingSchedule ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
