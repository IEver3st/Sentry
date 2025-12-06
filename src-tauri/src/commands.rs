//! Tauri Commands - Bridge between frontend and backend
#![allow(non_snake_case)]

use crate::backup::engine::{BackupEngine, BackupResult};
use crate::backup::manifest::{BackupManifest, ManifestSummary};
use crate::backup::scheduler::{Schedule, ScheduleType, WeatherAlertType, WeatherTrigger};
use crate::backup::set::{BackupPreset, BackupSet};
use crate::cloud::google_drive::{DriveConfig, DriveFile, GoogleDriveClient};
use crate::state::{AppSettings, AppState, OnboardingState, StateManager};
use crate::weather::{Location, WeatherAlert, WeatherConditions, WeatherService};

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{self, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use urlencoding::decode;

// State wrappers for thread-safe access
pub struct AppStateManager(pub Arc<Mutex<StateManager>>);
pub struct BackupEngineState(pub Arc<Mutex<Option<BackupEngine>>>);
pub struct DriveClientState(pub Arc<Mutex<Option<GoogleDriveClient>>>);
pub struct WeatherServiceState(pub Arc<Mutex<WeatherService>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudBackupBundle {
    pub manifest: BackupManifest,
    pub manifest_file: DriveFile,
    pub archive_file: DriveFile,
}

// Response types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> CommandResult<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

/// Shared executor used by manual and scheduled backups to keep progress payloads consistent.
pub async fn execute_backup_with_trigger(
    backup_set_id: String,
    incremental: bool,
    trigger: &str,
    app: AppHandle,
    state: Arc<Mutex<StateManager>>,
    engine_state: Arc<Mutex<Option<BackupEngine>>>,
    drive_state: Arc<Mutex<Option<GoogleDriveClient>>>,
) -> Result<BackupResult, String> {
    println!(
        "execute_backup_with_trigger: backup_set_id={}, incremental={}, trigger={}",
        backup_set_id, incremental, trigger
    );

    let manager = state.lock().await;
    let backup_set = manager
        .get_state()
        .backup_sets
        .get_set(&backup_set_id)
        .cloned();
    drop(manager);

    let Some(backup_set) = backup_set else {
        println!("Backup set not found: {}", backup_set_id);
        return Err("Backup set not found".to_string());
    };

    println!(
        "Found backup set: {} with {} sources",
        backup_set.name,
        backup_set.sources.len()
    );

    let mut engine_guard = engine_state.lock().await;
    let engine = engine_guard
        .as_mut()
        .ok_or("Backup engine not initialized")?;

    println!("Backup engine initialized successfully");

    let progress_handle = app.clone();
    let backup_set_id_for_progress = backup_set_id.clone();
    let trigger_label = trigger.to_string();
    let trigger_label_for_progress = trigger_label.clone();
    let result = engine.execute_backup(&backup_set, incremental, move |progress| {
        let mut value: Value = serde_json::to_value(&progress).unwrap_or(Value::Null);
        if let Value::Object(ref mut map) = value {
            map.insert(
                "backup_set_id".to_string(),
                Value::String(backup_set_id_for_progress.clone()),
            );
            map.insert(
                "trigger".to_string(),
                Value::String(trigger_label_for_progress.clone()),
            );
        }
        let _ = progress_handle.emit("backup:progress", value);
    });
    drop(engine_guard);

    match result {
        Ok(result) => {
            let no_changes = result.total_bytes == 0 && result.total_files == 0;

            if !no_changes {
                // Handle cloud upload if enabled
                if backup_set.cloud_upload {
                    let mut client_guard = drive_state.lock().await;

                    if let Some(client) = client_guard.as_mut() {
                        if !result.archive_path.exists() {
                            let msg = format!(
                                "Archive path missing for upload: {:?}",
                                result.archive_path
                            );
                            eprintln!("{msg}");
                            let _ = app.emit("upload:error", msg);
                        } else {
                            let archive_name = format!("backup_{}.zip", result.id);
                            let progress_handle = app.clone();
                            let error_handle = app.clone();
                            match client
                                .upload_file(&result.archive_path, &archive_name, move |progress| {
                                    let _ = progress_handle.emit("upload:progress", progress);
                                })
                                .await
                            {
                                Ok(_drive_file) => {
                                    println!("Archive uploaded successfully");

                                    // Upload Manifest
                                    if let Ok(app_data_dir) = app.path().app_data_dir() {
                                        let manifest_path = app_data_dir
                                            .join("manifests")
                                            .join(result.manifest_file_name());
                                        let manifest_name =
                                            format!("manifest_{}.json", result.id.clone());
                                        if manifest_path.exists() {
                                            let progress_handle = app.clone();
                                            match client
                                                .upload_file(
                                                    &manifest_path,
                                                    &manifest_name,
                                                    move |progress| {
                                                        let _ = progress_handle
                                                            .emit("upload:progress", progress);
                                                    },
                                                )
                                                .await
                                            {
                                                Ok(_manifest_file) => {
                                                    println!("Manifest uploaded successfully");
                                                }
                                                Err(e) => {
                                                    let msg = format!(
                                                        "Manifest upload failed: {}",
                                                        e
                                                    );
                                                    eprintln!("{msg}");
                                                    let _ = error_handle.emit("upload:error", msg);
                                                }
                                            }
                                        } else {
                                            let msg = format!(
                                                "Manifest file not found at {:?}",
                                                manifest_path
                                            );
                                            eprintln!("{msg}");
                                            let _ = error_handle.emit("upload:error", msg);
                                        }
                                    }
                                }
                                Err(e) => {
                                    let msg = format!("Cloud upload failed: {}", e);
                                    eprintln!("{msg}");
                                    let _ = app.emit("upload:error", msg);
                                }
                            }
                        }
                    } else {
                        let msg = "Cloud upload skipped: Google Drive not connected".to_string();
                        eprintln!("{msg}");
                        let _ = app.emit("upload:error", msg);
                    }
                }

                // Clean up temp file if it's in temp dir (when no local destination)
                if backup_set.local_destination.is_none() {
                    let _ = std::fs::remove_file(&result.archive_path);
                }

                // Update backup set stats
                let mut manager = state.lock().await;
                if let Some(set) = manager
                    .get_state_mut()
                    .backup_sets
                    .get_set_mut(&backup_set_id)
                {
                    set.record_backup(result.total_bytes);
                }
                manager.save().ok();
            } else {
                println!(
                    "Backup skipped: no changes detected for {} (trigger: {})",
                    backup_set.name, trigger_label
                );
            }

            Ok(result)
        }
        Err(e) => Err(e.to_string()),
    }
}

fn resolve_drive_config(
    env_config: Option<DriveConfig>,
    provided_client_id: Option<String>,
    provided_client_secret: Option<String>,
    saved_config: Option<DriveConfig>,
) -> Result<(DriveConfig, bool), String> {
    let is_valid = |cfg: &DriveConfig| !cfg.client_id.is_empty() && !cfg.client_secret.is_empty();

    let provided_id = provided_client_id.unwrap_or_default();
    let provided_secret = provided_client_secret.unwrap_or_default();
    if !provided_id.is_empty() && !provided_secret.is_empty() {
        return Ok((
            DriveConfig {
                client_id: provided_id,
                client_secret: provided_secret,
                ..Default::default()
            },
            false,
        ));
    }

    // Prefer environment values over any previously saved ones.
    if let Some(config) = env_config {
        if is_valid(&config) {
            return Ok((config, true));
        }
    }

    if let Some(config) = saved_config {
        if is_valid(&config) {
            return Ok((config, false));
        }
    }

    Err("Google Drive client_id and client_secret are required. Provide them when connecting or set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in your .env."
        .to_string())
}

// ============= App State Commands =============

#[tauri::command]
pub async fn get_app_state(
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<AppState>, String> {
    let manager = state.0.lock().await;
    Ok(CommandResult::ok(manager.get_state().clone()))
}

#[tauri::command]
pub async fn is_first_run(
    state: State<'_, AppStateManager>,
) -> Result<bool, String> {
    let manager = state.0.lock().await;
    Ok(manager.is_first_run() || !manager.is_onboarding_complete())
}

#[tauri::command]
pub async fn update_settings(
    settings: AppSettings,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.update_settings(settings) {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn update_onboarding(
    onboarding: OnboardingState,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.update_onboarding(onboarding) {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn complete_onboarding(
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.complete_onboarding() {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

// ============= Backup Set Commands =============

#[tauri::command]
pub async fn get_backup_sets(
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<Vec<BackupSet>>, String> {
    let manager = state.0.lock().await;
    let sets = manager.get_state().backup_sets.sets.clone();
    Ok(CommandResult::ok(sets))
}

#[tauri::command]
pub async fn get_backup_set(
    id: String,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<Option<BackupSet>>, String> {
    let manager = state.0.lock().await;
    let set = manager.get_state().backup_sets.get_set(&id).cloned();
    Ok(CommandResult::ok(set))
}

#[tauri::command]
pub async fn create_backup_set(
    name: String,
    sources: Vec<String>,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<BackupSet>, String> {
    let mut manager = state.0.lock().await;
    let mut set = BackupSet::new(name);
    set.sources = sources.clone();
    set.paths = sources;
    manager.add_backup_set(set.clone()).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok(set))
}

#[tauri::command]
pub async fn create_backup_set_from_preset(
    preset: String,
    home_dir: String,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<BackupSet>, String> {
    let mut manager = state.0.lock().await;
    let preset = match preset.to_lowercase().as_str() {
        "documents" => BackupPreset::Documents,
        "photos" => BackupPreset::Photos,
        "code" => BackupPreset::Code,
        "desktop" => BackupPreset::Desktop,
        _ => BackupPreset::Custom,
    };
    
    let set = preset.create_set(&PathBuf::from(home_dir));
    manager.add_backup_set(set.clone()).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok(set))
}

#[tauri::command]
pub async fn update_backup_set(
    set: BackupSet,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.update_backup_set(set) {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn delete_backup_set(
    id: String,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.remove_backup_set(&id) {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

// ============= Schedule Commands =============

#[tauri::command]
pub async fn get_schedules(
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<Vec<Schedule>>, String> {
    let manager = state.0.lock().await;
    Ok(CommandResult::ok(manager.get_state().schedules.clone()))
}

#[tauri::command]
pub async fn create_schedule(
    name: String,
    backupSetId: String,
    scheduleType: String,
    time: Option<String>,
    daysOfWeek: Option<Vec<u8>>,
    dayOfMonth: Option<u32>,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<Schedule>, String> {
    println!("create_schedule called: name={}, backupSetId={}, type={}", name, backupSetId, scheduleType);
    
    let mut manager = state.0.lock().await;
    
    let stype = match scheduleType.to_lowercase().as_str() {
        "daily" => ScheduleType::Daily,
        "weekly" => ScheduleType::Weekly,
        "monthly" => ScheduleType::Monthly,
        "weather" => ScheduleType::WeatherTriggered,
        _ => ScheduleType::Manual,
    };

    let mut schedule = Schedule::new(name, backupSetId, stype);
    
    // Set time directly as string
    if let Some(t) = time {
        schedule.time = Some(t);
    }

    // Set days directly as u8 vec
    if let Some(days) = daysOfWeek {
        schedule.days_of_week = days;
    }

    schedule.day_of_month = dayOfMonth;
    schedule.calculate_next_run();

    println!("Created schedule: {:?}", schedule);
    
    manager.add_schedule(schedule.clone()).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok(schedule))
}

#[tauri::command]
pub async fn update_schedule(
    schedule: Schedule,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.update_schedule(schedule) {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn delete_schedule(
    id: String,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    match manager.remove_schedule(&id) {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn set_weather_triggers(
    schedule_id: String,
    triggers: Vec<String>,
    state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut manager = state.0.lock().await;
    
    if let Some(schedule) = manager.get_state_mut().schedules.iter_mut().find(|s| s.id == schedule_id) {
        schedule.weather_triggers = triggers.into_iter().filter_map(|t| {
            let alert_type = match t.to_lowercase().as_str() {
                "thunderstorm" => Some(WeatherAlertType::Thunderstorm),
                "tornado" => Some(WeatherAlertType::Tornado),
                "hurricane" => Some(WeatherAlertType::Hurricane),
                "flood" | "flash_flood" => Some(WeatherAlertType::FlashFlood),
                "severe" | "severe_weather" => Some(WeatherAlertType::SevereWeather),
                "winter" | "winter_storm" => Some(WeatherAlertType::WinterStorm),
                "heat" | "extreme_heat" => Some(WeatherAlertType::ExtremeHeat),
                "cold" | "extreme_cold" => Some(WeatherAlertType::ExtremeCold),
                _ => None,
            };
            alert_type.map(|at| WeatherTrigger { alert_type: at, enabled: true })
        }).collect();
        
        manager.save().map_err(|e| e.to_string())?;
    }
    
    Ok(CommandResult::ok(()))
}

// ============= Backup Execution Commands =============

#[tauri::command]
pub async fn run_backup(
    backupSetId: String,
    incremental: bool,
    app: AppHandle,
    state: State<'_, AppStateManager>,
    engine_state: State<'_, BackupEngineState>,
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<BackupResult>, String> {
    println!("run_backup called with backupSetId: {}, incremental: {}", backupSetId, incremental);
    
    let manager = state.0.lock().await;
    let backup_set = manager.get_state().backup_sets.get_set(&backupSetId).cloned();
    drop(manager);

    let Some(backup_set) = backup_set else {
        println!("Backup set not found: {}", backupSetId);
        return Ok(CommandResult::err("Backup set not found".to_string()));
    };

    println!("Found backup set: {} with {} sources", backup_set.name, backup_set.sources.len());

    let mut engine_guard = engine_state.0.lock().await;
    let engine = engine_guard.as_mut().ok_or("Backup engine not initialized")?;
    
    println!("Backup engine initialized successfully");

    let progress_handle = app.clone();
    let backup_set_id_for_progress = backupSetId.clone();
    let result = engine.execute_backup(&backup_set, incremental, move |progress| {
        let mut value: Value = serde_json::to_value(&progress).unwrap_or(Value::Null);
        if let Value::Object(ref mut map) = value {
            map.insert(
                "backup_set_id".to_string(),
                Value::String(backup_set_id_for_progress.clone()),
            );
            map.insert("trigger".to_string(), Value::String("manual".to_string()));
        }
        let _ = progress_handle.emit("backup:progress", value);
    });

    match result {
        Ok(result) => {
            let no_changes = result.total_bytes == 0 && result.total_files == 0;

            if !no_changes {
                // Handle cloud upload if enabled
                if backup_set.cloud_upload {
                    let mut client_guard = drive_state.0.lock().await;

                    if let Some(client) = client_guard.as_mut() {
                        if !result.archive_path.exists() {
                            let msg = format!(
                                "Archive path missing for upload: {:?}",
                                result.archive_path
                            );
                            eprintln!("{msg}");
                            let _ = app.emit("upload:error", msg);
                        } else {
                            let archive_name = format!("backup_{}.zip", result.id);
                            let progress_handle = app.clone();
                            let error_handle = app.clone();
                            match client
                                .upload_file(&result.archive_path, &archive_name, move |progress| {
                                    let _ = progress_handle.emit("upload:progress", progress);
                                })
                                .await
                            {
                                Ok(_drive_file) => {
                                    println!("Archive uploaded successfully");

                                    // Upload Manifest
                                    if let Ok(app_data_dir) = app.path().app_data_dir() {
                                        let manifest_path = app_data_dir
                                            .join("manifests")
                                            .join(format!("{}.json", result.id));
                                        if manifest_path.exists() {
                                            let manifest_name =
                                                format!("manifest_{}.json", result.id);
                                            if let Err(e) =
                                                client.upload_file(&manifest_path, &manifest_name, |_| {}).await
                                            {
                                                let msg =
                                                    format!("Failed to upload manifest: {}", e);
                                                eprintln!("{msg}");
                                                let _ = error_handle.emit("upload:error", msg);
                                            } else {
                                                println!("Manifest uploaded successfully");
                                            }
                                        } else {
                                            let msg = format!(
                                                "Manifest file not found at {:?}",
                                                manifest_path
                                            );
                                            eprintln!("{msg}");
                                            let _ = error_handle.emit("upload:error", msg);
                                        }
                                    }
                                }
                                Err(e) => {
                                    let msg = format!("Cloud upload failed: {}", e);
                                    eprintln!("{msg}");
                                    let _ = error_handle.emit("upload:error", msg);
                                }
                            }
                        }
                    } else {
                        let msg = "Cloud upload skipped: Google Drive not connected".to_string();
                        eprintln!("{msg}");
                        let _ = app.emit("upload:error", msg);
                    }
                }

                // Clean up temp file if it's in temp dir (when no local destination)
                if backup_set.local_destination.is_none() {
                    let _ = std::fs::remove_file(&result.archive_path);
                }

                // Update backup set stats
                let mut manager = state.0.lock().await;
                if let Some(set) = manager.get_state_mut().backup_sets.get_set_mut(&backupSetId) {
                    set.record_backup(result.total_bytes);
                }
                manager.save().ok();
            } else {
                println!("Backup skipped: no changes detected for {}", backup_set.name);
            }
            
            Ok(CommandResult::ok(result))
        }
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

// ============= Google Drive Commands =============

#[tauri::command]
pub async fn get_google_auth_url(
    client_id: Option<String>,
    client_secret: Option<String>,
    drive_state: State<'_, DriveClientState>,
    app_state: State<'_, AppStateManager>,
) -> Result<CommandResult<String>, String> {
    let mut client_guard = drive_state.0.lock().await;

    let mut manager = app_state.0.lock().await;
    let (config, from_env) = resolve_drive_config(
        DriveConfig::from_env(),
        client_id,
        client_secret,
        manager.get_state().google_drive_config.clone(),
    )?;

    // Persist only when the values were provided by the user, not from env
    if !from_env {
        manager
            .set_google_drive_config(Some(config.clone()))
            .map_err(|e| e.to_string())?;
    }

    let client = GoogleDriveClient::new(config);
    let url = client.get_auth_url();
    *client_guard = Some(client);

    Ok(CommandResult::ok(url))
}

#[tauri::command]
pub async fn exchange_google_code(
    code: String,
    drive_state: State<'_, DriveClientState>,
    app_state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
    
    match client.exchange_code(&code).await {
        Ok(tokens) => {
            let mut manager = app_state.0.lock().await;
            manager.set_google_tokens(Some(tokens)).map_err(|e| e.to_string())?;
            Ok(CommandResult::ok(()))
        }
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn start_oauth_callback_server(
    drive_state: State<'_, DriveClientState>,
    app_state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    
    // Start listening on port 3000
    let listener = TcpListener::bind("127.0.0.1:3000").await
        .map_err(|e| format!("Failed to start OAuth server: {}", e))?;
    
    // Wait for the callback (with timeout)
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(300), // 5 minute timeout
        async {
            let (mut socket, _) = listener.accept().await?;
            
            let mut buffer = [0u8; 4096];
            let n = socket.read(&mut buffer).await?;
            let request = String::from_utf8_lossy(&buffer[..n]);
            
            // Parse the code from the request
            // Example: GET /?code=4/0AX... HTTP/1.1
            let code = request
                .lines()
                .next()
                .and_then(|line| {
                    if line.starts_with("GET /?code=") || line.contains("?code=") {
                        line.split("code=")
                            .nth(1)
                            .and_then(|s| s.split('&').next())
                            .and_then(|s| s.split(' ').next())
                            .map(|s| s.to_string())
                    } else {
                        None
                    }
                });
            
            // Send success response
            let success_html = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sentry - Authorization Successful</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css"/>
</head>
 <body class="min-h-screen bg-[#03050c] text-slate-100 flex items-center justify-center p-6">
   <div class="relative w-full max-w-md text-center space-y-6 animate__animated animate__fadeInUp animate__faster">
     <div class="absolute inset-0 rounded-3xl bg-black/40 blur-3xl" aria-hidden="true"></div>
     <div class="relative rounded-3xl border border-white/10 bg-[#0a1220]/90 backdrop-blur shadow-2xl shadow-emerald-900/20 px-10 py-12 space-y-6">
       <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-200 animate__animated animate__bounceIn">
        <i data-lucide="badge-check" class="w-8 h-8"></i>
      </div>
      <div class="space-y-2">
        <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Authorization</p>
        <h1 class="text-2xl font-semibold text-white">Authorization Successful</h1>
         <p class="text-sm text-slate-500">You can close this window and return to Sentry.</p>
      </div>
      <div class="flex items-center justify-center gap-2 text-xs text-slate-500">
        <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>Securely connected to Google Drive</span>
      </div>
    </div>
  </div>
  <script src="https://unpkg.com/lucide@latest"></script>
  <script>
    lucide.createIcons();
  </script>
</body>
</html>"#;
            
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                success_html.len(),
                success_html
            );
            socket.write_all(response.as_bytes()).await?;
            socket.flush().await?;
            
            Ok::<Option<String>, std::io::Error>(code)
        }
    ).await;
    
    match result {
        Ok(Ok(Some(raw_code))) => {
            // Decode the authorization code to avoid double-encoding during exchange.
            let code = decode(&raw_code)
                .map(|c| c.into_owned())
                .unwrap_or(raw_code);

            // Exchange the code for tokens
            let mut client_guard = drive_state.0.lock().await;
            let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
            
            match client.exchange_code(&code).await {
                Ok(tokens) => {
                    let mut manager = app_state.0.lock().await;
                    manager.set_google_tokens(Some(tokens)).map_err(|e| e.to_string())?;
                    Ok(CommandResult::ok(()))
                }
                Err(e) => Ok(CommandResult::err(format!("Failed to exchange code: {}", e))),
            }
        }
        Ok(Ok(None)) => Ok(CommandResult::err("No authorization code received".to_string())),
        Ok(Err(e)) => Ok(CommandResult::err(format!("Server error: {}", e))),
        Err(_) => Ok(CommandResult::err("Authorization timed out".to_string())),
    }
}

#[tauri::command]
pub async fn is_google_authenticated(
    app_state: State<'_, AppStateManager>,
) -> Result<bool, String> {
    let manager = app_state.0.lock().await;
    Ok(manager.get_state().google_tokens.is_some())
}

#[tauri::command]
pub async fn disconnect_google(
    app_state: State<'_, AppStateManager>,
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<()>, String> {
    // Clear the tokens from app state
    let mut manager = app_state.0.lock().await;
    manager.get_state_mut().google_tokens = None;
    manager.get_state_mut().google_drive_config = None;
    manager.save().map_err(|e| e.to_string())?;
    
    // Clear the drive client
    let mut client_guard = drive_state.0.lock().await;
    *client_guard = None;
    
    Ok(CommandResult::ok(()))
}

#[tauri::command]
pub async fn upload_to_drive(
    file_path: String,
    file_name: String,
    app: AppHandle,
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<DriveFile>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
    
    let app_handle = app.clone();
    match client.upload_file(&PathBuf::from(file_path), &file_name, move |progress| {
        let _ = app_handle.emit("upload:progress", progress);
    }).await {
        Ok(file) => Ok(CommandResult::ok(file)),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn list_drive_backups(
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<Vec<DriveFile>>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
    
    match client.list_backups().await {
        Ok(files) => Ok(CommandResult::ok(files)),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn list_drive_backup_bundles(
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<Vec<CloudBackupBundle>>, String> {
    let (client_template, files) = {
        let mut client_guard = drive_state.0.lock().await;
        let client = client_guard
            .as_mut()
            .ok_or("Google Drive client not initialized")?;

        match client.list_backups().await {
            Ok(files) => (client.clone(), files),
            Err(e) => return Ok(CommandResult::err(e.to_string())),
        }
    };

    let files = Arc::new(files);
    let manifest_files: Vec<DriveFile> = files
        .iter()
        .filter(|f| f.name.starts_with("manifest_") && f.name.ends_with(".json"))
        .cloned()
        .collect();

    let bundles = stream::iter(manifest_files.into_iter().map(|manifest_file| {
        let mut client = client_template.clone();
        let files = Arc::clone(&files);

        async move {
            let manifest_id = manifest_file
                .name
                .trim_start_matches("manifest_")
                .trim_end_matches(".json")
                .to_string();
            let archive_name = format!("backup_{}.zip", manifest_id);

            let archive_file = files
                .iter()
                .find(|f| f.name == archive_name)
                .cloned();

            let Some(archive_file) = archive_file else {
                return None;
            };

            match client.download_bytes(&manifest_file.id).await {
                Ok(bytes) => match serde_json::from_slice::<BackupManifest>(&bytes) {
                    Ok(manifest) => Some(CloudBackupBundle {
                        manifest,
                        manifest_file: manifest_file.clone(),
                        archive_file,
                    }),
                    Err(e) => {
                        eprintln!(
                            "Failed to parse manifest {}: {}",
                            manifest_file.id, e
                        );
                        None
                    }
                },
                Err(e) => {
                    eprintln!("Failed to download manifest {}: {}", manifest_file.id, e);
                    None
                }
            }
        }
    }))
    .buffer_unordered(4)
    .filter_map(|bundle| async move { bundle })
    .collect::<Vec<_>>()
    .await;

    Ok(CommandResult::ok(bundles))
}

#[tauri::command]
pub async fn download_backup_bundle(
    manifestFileId: String,
    manifestFileName: String,
    archiveFileId: String,
    archiveFileName: String,
    outputDir: String,
    app: AppHandle,
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<(String, String)>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;

    let output_dir = PathBuf::from(&outputDir);
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|e| e.to_string())?;

    let manifest_path = output_dir.join(&manifestFileName);
    let archive_path = output_dir.join(&archiveFileName);
    let archive_path_string = archive_path.to_string_lossy().to_string();
    let archive_name = archiveFileName.clone();
    let archive_id = archiveFileId.clone();

    client
        .download_file(&manifestFileId, &manifest_path, |_a, _b| {})
        .await
        .map_err(|e| e.to_string())?;

    let download_handle = app.clone();
    client
        .download_file(&archiveFileId, &archive_path, move |downloaded, total| {
            let _ = download_handle.emit(
                "download:progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                    "fileName": archive_name,
                    "targetPath": archive_path_string,
                    "fileId": archive_id
                }),
            );
        })
        .await
        .map_err(|e| e.to_string())?;

    Ok(CommandResult::ok((
        manifest_path.to_string_lossy().to_string(),
        archive_path.to_string_lossy().to_string(),
    )))
}

#[tauri::command]
pub async fn download_from_drive(
    file_id: String,
    output_path: String,
    app: AppHandle,
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<()>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
    
    let app_handle = app.clone();
    let output_path_buf = PathBuf::from(&output_path);
    let target_path = output_path_buf.to_string_lossy().to_string();
    let file_name = output_path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download")
        .to_string();
    let file_id_clone = file_id.clone();

    match client.download_file(&file_id, &output_path_buf, move |downloaded, total| {
        let _ = app_handle.emit("download:progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total,
            "fileName": file_name,
            "targetPath": target_path,
            "fileId": file_id_clone
        }));
    }).await {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn delete_from_drive(
    file_id: String,
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<()>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
    
    match client.delete_file(&file_id).await {
        Ok(_) => Ok(CommandResult::ok(())),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn get_drive_quota(
    drive_state: State<'_, DriveClientState>,
) -> Result<CommandResult<(u64, u64)>, String> {
    let mut client_guard = drive_state.0.lock().await;
    let client = client_guard.as_mut().ok_or("Google Drive client not initialized")?;
    
    match client.get_storage_quota().await {
        Ok(quota) => Ok(CommandResult::ok(quota)),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

// ============= Weather Commands =============

#[tauri::command]
pub async fn detect_location(
    weather_state: State<'_, WeatherServiceState>,
    app_state: State<'_, AppStateManager>,
) -> Result<CommandResult<Location>, String> {
    let mut weather = weather_state.0.lock().await;
    
    match weather.detect_location().await {
        Ok(location) => {
            let mut manager = app_state.0.lock().await;
            manager.set_location(Some(location.clone())).ok();
            Ok(CommandResult::ok(location))
        }
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn get_weather_alerts(
    weather_state: State<'_, WeatherServiceState>,
) -> Result<CommandResult<Vec<WeatherAlert>>, String> {
    let weather = weather_state.0.lock().await;
    
    match weather.get_alerts().await {
        Ok(alerts) => Ok(CommandResult::ok(alerts)),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn get_weather_conditions(
    weather_state: State<'_, WeatherServiceState>,
) -> Result<CommandResult<WeatherConditions>, String> {
    let weather = weather_state.0.lock().await;
    
    match weather.get_current_conditions().await {
        Ok(conditions) => Ok(CommandResult::ok(conditions)),
        Err(e) => Ok(CommandResult::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn set_location(
    latitude: f64,
    longitude: f64,
    city: Option<String>,
    state_name: Option<String>,
    weather_state: State<'_, WeatherServiceState>,
    app_state: State<'_, AppStateManager>,
) -> Result<CommandResult<()>, String> {
    let mut weather = weather_state.0.lock().await;
    
    let location = Location {
        latitude,
        longitude,
        city,
        state: state_name,
        country: None,
    };
    
    weather.set_location(location.clone());
    
    let mut manager = app_state.0.lock().await;
    manager.set_location(Some(location)).map_err(|e| e.to_string())?;
    
    Ok(CommandResult::ok(()))
}

// ============= Manifest Commands =============

#[tauri::command]
pub async fn get_manifests_for_set(
    _backup_set_id: String,
    _engine_state: State<'_, BackupEngineState>,
) -> Result<CommandResult<Vec<ManifestSummary>>, String> {
    // This would need the manifest manager exposed differently
    // For now return empty - will be implemented with proper state management
    Ok(CommandResult::ok(vec![]))
}

// ============= System Commands =============

#[tauri::command]
pub async fn get_home_directory() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub async fn get_documents_directory() -> Result<String, String> {
    dirs::document_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine documents directory".to_string())
}

#[tauri::command]
pub fn pick_directory() -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_title("Select Directory")
        .pick_folder()
}

#[tauri::command]
pub fn pick_directories() -> Vec<PathBuf> {
    rfd::FileDialog::new()
        .set_title("Select Directories")
        .pick_folders()
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderStats {
    pub file_count: u64,
    pub total_size: u64,
}

#[tauri::command]
pub async fn get_folder_stats(paths: Vec<String>) -> Result<CommandResult<FolderStats>, String> {
    use walkdir::WalkDir;
    
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    
    for path in paths {
        let path = PathBuf::from(path);
        if path.exists() {
            for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    file_count += 1;
                    if let Ok(metadata) = entry.metadata() {
                        total_size += metadata.len();
                    }
                }
            }
        }
    }
    
    Ok(CommandResult::ok(FolderStats { file_count, total_size }))
}
