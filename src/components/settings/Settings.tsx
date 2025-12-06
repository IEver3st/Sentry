import { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  Moon, 
  Sun, 
  Monitor,
  Bell,
  MapPin,
  Shield,
  Power,
  Loader2,
  Check,
  RefreshCw,
  AlertCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useAppStore, useUIStore } from '@/lib/store'
import { api } from '@/lib/tauri'
import { check as checkForUpdate, type DownloadEvent } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export function Settings() {
  const { appState, updateSettings, setLocation } = useAppStore()
  const { theme, setTheme } = useUIStore()
  const [isDetectingLocation, setIsDetectingLocation] = useState(false)
  const [, setIsSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'disabled' | 'checking' | 'none' | 'available' | 'downloading' | 'installed' | 'error'>('disabled')
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)

  const settings = appState?.settings
  const location = appState?.location

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
    // Apply theme to document
    if (newTheme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', isDark)
    } else {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    }
  }

  const handleSettingChange = async (key: string, value: any) => {
    if (!settings) return
    
    setIsSaving(true)
    try {
      const newSettings = { ...settings, [key]: value }
      await api.updateSettings(newSettings)
      updateSettings({ [key]: value })
    } catch (error) {
      console.error('Failed to update settings:', error)
    }
    setIsSaving(false)
  }

  const handleDetectLocation = async () => {
    setIsDetectingLocation(true)
    try {
      const result = await api.detectLocation()
      if (result.success && result.data) {
        setLocation(result.data)
      }
    } catch (error) {
      console.error('Failed to detect location:', error)
    }
    setIsDetectingLocation(false)
  }

  const handleCheckForUpdates = async () => {
    try {
      setUpdateStatus('checking')
      setUpdateMessage(null)
      setUpdateProgress(0)
      const update = await checkForUpdate()
      if (!update?.available) {
        setUpdateStatus('none')
        setUpdateMessage('You are on the latest version.')
        return
      }

      setUpdateStatus('downloading')
      setUpdateMessage(`Downloading ${update.version}...`)

      let totalBytes = 0
      let downloadedBytes = 0

      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case 'Started': {
            totalBytes = event.data.contentLength ?? 0
            setUpdateProgress(0)
            break
          }
          case 'Progress': {
            downloadedBytes += event.data.chunkLength
            if (totalBytes > 0) {
              const pct = Math.min(
                100,
                Math.round((downloadedBytes / totalBytes) * 100)
              )
              setUpdateProgress(pct)
            }
            break
          }
          case 'Finished': {
            setUpdateProgress(100)
            break
          }
          default:
            break
        }
      })

      setUpdateStatus('installed')
      setUpdateMessage('Update installed. Restarting...')
      await relaunch()
    } catch (error) {
      console.error('Update failed', error)
      const message = error instanceof Error ? error.message : String(error)
      setUpdateStatus('error')

      if (message.toLowerCase().includes('valid release json')) {
        setUpdateMessage('Update feed not found. Verify latest.json exists at the configured endpoint.')
      } else if (message.toLowerCase().includes('not allowed')) {
        setUpdateMessage('Updater permissions missing. Restart the app or ensure updater permissions are granted.')
      } else {
        setUpdateMessage('Update failed. Please try again.')
      }
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
      className="space-y-6 max-w-2xl"
    >
      {/* Header */}
      <motion.div variants={item}>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure Sentry to work the way you want
        </p>
      </motion.div>

      {/* Appearance */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Appearance
            </CardTitle>
            <CardDescription>
              Customize how Sentry looks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Theme</Label>
              <div className="flex gap-2">
                <Button
                  variant={theme === 'light' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleThemeChange('light')}
                >
                  <Sun className="w-4 h-4 mr-2" />
                  Light
                </Button>
                <Button
                  variant={theme === 'dark' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleThemeChange('dark')}
                >
                  <Moon className="w-4 h-4 mr-2" />
                  Dark
                </Button>
                <Button
                  variant={theme === 'system' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleThemeChange('system')}
                >
                  <Monitor className="w-4 h-4 mr-2" />
                  System
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Notifications */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
            </CardTitle>
            <CardDescription>
              Control when Sentry notifies you
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Enable notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Show desktop notifications for important events
                </p>
              </div>
              <Switch
                checked={settings?.notification_enabled ?? true}
                onCheckedChange={(checked) => handleSettingChange('notification_enabled', checked)}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Backup complete</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when a backup finishes
                </p>
              </div>
              <Switch
                checked={settings?.notification_on_backup_complete ?? true}
                onCheckedChange={(checked) => handleSettingChange('notification_on_backup_complete', checked)}
                disabled={!settings?.notification_enabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Weather alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when severe weather triggers a backup
                </p>
              </div>
              <Switch
                checked={settings?.notification_on_weather_alert ?? true}
                onCheckedChange={(checked) => handleSettingChange('notification_on_weather_alert', checked)}
                disabled={!settings?.notification_enabled}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Location */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Location
            </CardTitle>
            <CardDescription>
              Used for weather-based backup triggers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {location ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium">{location.city}, {location.state}</p>
                    <p className="text-sm text-muted-foreground">
                      {location.latitude.toFixed(2)}°, {location.longitude.toFixed(2)}°
                    </p>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleDetectLocation}
                  disabled={isDetectingLocation}
                >
                  {isDetectingLocation ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </Button>
              </div>
            ) : (
              <div className="text-center py-4">
                <MapPin className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-3">
                  Location not set
                </p>
                <Button onClick={handleDetectLocation} disabled={isDetectingLocation}>
                  {isDetectingLocation ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <MapPin className="w-4 h-4 mr-2" />
                  )}
                  Detect Location
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Startup */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="w-5 h-5" />
              Startup
            </CardTitle>
            <CardDescription>
              Control how Sentry starts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Start on boot</Label>
                <p className="text-sm text-muted-foreground">
                  Launch Sentry when you log in to Windows
                </p>
              </div>
              <Switch
                checked={settings?.start_on_boot ?? false}
                onCheckedChange={(checked) => handleSettingChange('start_on_boot', checked)}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Start minimized</Label>
                <p className="text-sm text-muted-foreground">
                  Start in the system tray instead of showing window
                </p>
              </div>
              <Switch
                checked={settings?.start_minimized ?? false}
                onCheckedChange={(checked) => handleSettingChange('start_minimized', checked)}
                disabled={!settings?.start_on_boot}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Minimize to tray</Label>
                <p className="text-sm text-muted-foreground">
                  Keep running in the background when closed
                </p>
              </div>
              <Switch
                checked={settings?.minimize_to_tray ?? true}
                onCheckedChange={(checked) => handleSettingChange('minimize_to_tray', checked)}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* About */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              About Sentry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span>{appState?.app_version || '1.0.2'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Built with</span>
                <span>Tauri V2 + React</span>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Restart Onboarding</Label>
                <p className="text-sm text-muted-foreground">
                  Go through the setup wizard again
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={async () => {
                  try {
                    await api.updateOnboarding({
                      completed: false,
                      current_step: 0,
                      google_connected: false,
                      location_set: false,
                      first_backup_set_created: false,
                      completed_at: null
                    })
                    window.location.reload()
                  } catch (error) {
                    console.error('Failed to restart onboarding:', error)
                  }
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Restart
              </Button>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Updates</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatic updates are disabled as Sentry is feature
                    complete and not receiving further releases.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCheckForUpdates}
                  disabled
                  className="flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4" />
                  Updates disabled
                </Button>
              </div>
              {updateStatus !== 'idle' && updateStatus !== 'disabled' && updateMessage && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                  {updateStatus === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-destructive" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <div className="flex-1">
                    <p>{updateMessage}</p>
                    {updateStatus === 'downloading' && (
                      <p className="text-xs mt-1">Progress: {updateProgress}%</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
