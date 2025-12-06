import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Types
export interface CommandResult<T> {
  success: boolean
  data: T | null
  error: string | null
}

export interface AppSettings {
  theme: 'Light' | 'Dark' | 'System'
  minimize_to_tray: boolean
  start_minimized: boolean
  start_on_boot: boolean
  check_for_updates: boolean
  notification_enabled: boolean
  notification_on_backup_complete: boolean
  notification_on_weather_alert: boolean
  weather_check_interval_minutes: number
  backup_check_interval_minutes: number
  max_concurrent_uploads: number
  chunk_size_mb: number
}

export interface OnboardingState {
  completed: boolean
  current_step: number
  google_connected: boolean
  location_set: boolean
  first_backup_set_created: boolean
  completed_at: string | null
}

export interface DriveConfig {
  client_id: string
  client_secret: string
  redirect_uri: string
  backup_folder_name: string
}

export interface BackupSet {
  id: string
  name: string
  description: string | null
  paths: string[]           // Alias for sources for frontend compatibility
  sources: string[]
  exclude_patterns: string[]
  enabled: boolean
  compression_level: number
  incremental: boolean
  retention_days: number | null
  max_versions: number | null
  cloud_upload: boolean
  local_destination: string | null
  created_at: string
  updated_at: string
  last_backup: string | null
  total_backups: number
  total_size_backed_up: number
}

export interface Schedule {
  id: string
  name: string
  backup_set_id: string
  schedule_type: 'daily' | 'weekly' | 'monthly'
  enabled: boolean
  time: string
  days_of_week?: number[]
  day_of_month?: number
  weather_trigger_enabled?: boolean
  weather_alert_types?: string[]
  weather_triggers?: WeatherTrigger[]
  last_run?: string | null
  next_run?: string | null
  created_at?: string
  updated_at?: string
}

export interface WeatherTrigger {
  alert_type: string
  enabled: boolean
}

export interface AppState {
  settings: AppSettings
  onboarding: OnboardingState
  backup_sets: { sets: BackupSet[] }
  schedules: Schedule[]
  google_tokens: any | null
  google_drive_config?: DriveConfig | null
  location: Location | null
  last_weather_check: string | null
  last_backup_check: string | null
  app_version: string
  first_run: boolean
  updated_at: string
}

export interface Location {
  latitude: number
  longitude: number
  city: string | null
  state: string | null
  country: string | null
}

export interface BackupProgress {
  total_files: number
  processed_files: number
  total_bytes: number
  processed_bytes: number
  current_file: string
  status: string
  error: string | null
  backup_set_id?: string
  trigger?: 'manual' | 'schedule' | 'unknown' | string
}

export interface BackupResult {
  id: string
  backup_set_id: string
  started_at: string
  completed_at: string
  total_files: number
  total_bytes: number
  compressed_bytes: number
  archive_path: string
}

export interface DriveFile {
  id: string
  name: string
  mime_type: string
  size: number | null
  created_time: string | null
  modified_time: string | null
  web_view_link: string | null
}

export interface WeatherAlert {
  id: string
  event: string
  headline: string
  description: string
  severity: string
  certainty: string
  urgency: string
  effective: string
  expires: string
  sender: string
  alert_type: string | null
}

export interface WeatherConditions {
  temperature: number | null
  humidity: number | null
  wind_speed: number | null
  description: string
  icon: string | null
}

export interface FileEntry {
  path: string
  relative_path: string
  size: number
  hash: string
  modified: string
  backed_up_at: string | null
}

export interface BackupManifest {
  id: string
  backup_set_id: string
  created_at: string
  files: FileEntry[]
  total_size: number
  compressed_size: number
  cloud_location: any | null
  retention_until: string | null
}

export interface CloudBackupBundle {
  manifest: BackupManifest
  manifest_file: DriveFile
  archive_file: DriveFile
}

export interface DownloadProgressEvent {
  downloaded: number
  total: number
  fileName?: string
  targetPath?: string
  fileId?: string
}

// API functions
export const api = {
  // App state
  getAppState: () => invoke<CommandResult<AppState>>('get_app_state'),
  isFirstRun: () => invoke<boolean>('is_first_run'),
  updateSettings: (settings: AppSettings) =>
    invoke<CommandResult<void>>('update_settings', { settings }),
  updateOnboarding: (onboarding: OnboardingState) =>
    invoke<CommandResult<void>>('update_onboarding', { onboarding }),
  completeOnboarding: () => invoke<CommandResult<void>>('complete_onboarding'),

  // Backup sets
  listBackupSets: () => invoke<CommandResult<BackupSet[]>>('get_backup_sets'),
  getBackupSets: () => invoke<CommandResult<BackupSet[]>>('get_backup_sets'),
  getBackupSet: (id: string) => invoke<CommandResult<BackupSet | null>>('get_backup_set', { id }),
  createBackupSet: (name: string, sources: string[]) =>
    invoke<CommandResult<BackupSet>>('create_backup_set', { name, sources }),
  createBackupSetFromPreset: (preset: string, homeDir: string) =>
    invoke<CommandResult<BackupSet>>('create_backup_set_from_preset', { preset, homeDir }),
  updateBackupSet: (set: BackupSet) =>
    invoke<CommandResult<void>>('update_backup_set', { set }),
  deleteBackupSet: (id: string) =>
    invoke<CommandResult<void>>('delete_backup_set', { id }),

  // Schedules
  listSchedules: () => invoke<CommandResult<Schedule[]>>('get_schedules'),
  getSchedules: () => invoke<CommandResult<Schedule[]>>('get_schedules'),
  createSchedule: (params: {
    name: string
    backupSetId: string
    scheduleType: string
    time?: string
    daysOfWeek?: number[]
    dayOfMonth?: number
  }) => invoke<CommandResult<Schedule>>('create_schedule', {
    name: params.name,
    backupSetId: params.backupSetId,
    scheduleType: params.scheduleType,
    time: params.time,
    daysOfWeek: params.daysOfWeek,
    dayOfMonth: params.dayOfMonth
  }),
  updateSchedule: (schedule: Schedule) =>
    invoke<CommandResult<void>>('update_schedule', { schedule }),
  deleteSchedule: (id: string) =>
    invoke<CommandResult<void>>('delete_schedule', { id }),
  setWeatherTriggers: (scheduleId: string, triggers: string[]) =>
    invoke<CommandResult<void>>('set_weather_triggers', { scheduleId, triggers }),

  // Backup execution
  runBackup: (backupSetId: string, incremental: boolean) =>
    invoke<CommandResult<BackupResult>>('run_backup', { backupSetId, incremental }),

  // Google Drive
  getGoogleAuthUrl: (clientId?: string, clientSecret?: string) =>
    invoke<CommandResult<string>>('get_google_auth_url', { clientId, clientSecret }),
  exchangeGoogleCode: (code: string) =>
    invoke<CommandResult<void>>('exchange_google_code', { code }),
  startOAuthCallbackServer: () =>
    invoke<CommandResult<void>>('start_oauth_callback_server'),
  isGoogleAuthenticated: () => invoke<boolean>('is_google_authenticated'),
  uploadToDrive: (filePath: string, fileName: string) =>
    invoke<CommandResult<DriveFile>>('upload_to_drive', { filePath, fileName }),
  listDriveBackups: () => invoke<CommandResult<DriveFile[]>>('list_drive_backups'),
  listDriveBackupBundles: () =>
    invoke<CommandResult<CloudBackupBundle[]>>('list_drive_backup_bundles'),
  downloadFromDrive: (fileId: string, outputPath: string) =>
    invoke<CommandResult<void>>('download_from_drive', { fileId, outputPath }),
  deleteFromDrive: (fileId: string) =>
    invoke<CommandResult<void>>('delete_from_drive', { fileId }),
  downloadBackupBundle: (params: {
    manifestFileId: string
    manifestFileName: string
    archiveFileId: string
    archiveFileName: string
    outputDir: string
  }) =>
    invoke<CommandResult<[string, string]>>('download_backup_bundle', {
      manifestFileId: params.manifestFileId,
      manifestFileName: params.manifestFileName,
      archiveFileId: params.archiveFileId,
      archiveFileName: params.archiveFileName,
      outputDir: params.outputDir
    }),
  getDriveQuota: () => invoke<CommandResult<[number, number]>>('get_drive_quota'),
  disconnectGoogle: () => invoke<CommandResult<void>>('disconnect_google'),

  // Weather
  detectLocation: () => invoke<CommandResult<Location>>('detect_location'),
  getWeatherAlerts: () => invoke<CommandResult<WeatherAlert[]>>('get_weather_alerts'),
  getWeatherConditions: () => invoke<CommandResult<WeatherConditions>>('get_weather_conditions'),
  setLocation: (latitude: number, longitude: number, city?: string, stateName?: string) =>
    invoke<CommandResult<void>>('set_location', { latitude, longitude, city, state_name: stateName }),

  // System
  getHomeDirectory: () => invoke<string>('get_home_directory'),
  getDocumentsDirectory: () => invoke<string>('get_documents_directory'),
  pickDirectory: () => invoke<string | null>('pick_directory'),
  pickDirectories: () => invoke<string[]>('pick_directories'),
  getFolderStats: (paths: string[]) =>
    invoke<CommandResult<{ file_count: number; total_size: number }>>('get_folder_stats', { paths }),
}

// Event listeners
export const events = {
  onBackupProgress: (callback: (progress: BackupProgress) => void) =>
    listen<BackupProgress>('backup:progress', (event) => callback(event.payload)),
  onUploadProgress: (callback: (progress: { bytes_uploaded: number; total_bytes: number; file_name: string; status: string }) => void) =>
    listen('upload:progress', (event) => callback(event.payload as any)),
  onUploadError: (callback: (message: string) => void) =>
    listen<string>('upload:error', (event) => callback(event.payload as any)),
  onDownloadProgress: (callback: (progress: DownloadProgressEvent) => void) =>
    listen('download:progress', (event) => callback(event.payload as DownloadProgressEvent)),
  onTrayBackupNow: (callback: () => void) =>
    listen('tray:backup_now', () => callback()),
}
