//! Sentry Backup - Intelligent Backup Management System
//!
//! A high-performance desktop application for managing backups with:
//! - Scheduled and weather-triggered backups
//! - Google Drive cloud storage integration
//! - Incremental backup support with manifests
//! - System tray integration

pub mod backup;
pub mod cloud;
pub mod commands;
pub mod state;
pub mod weather;

use commands::*;
use state::StateManager;
use std::sync::Arc;
use std::collections::HashSet;
use chrono::Utc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use dotenvy::dotenv;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables for secrets/configuration before starting the app
    dotenv().ok();
    dotenvy::from_filename("src-tauri/.env").ok();

    tauri::Builder::default()
        // Plugins
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Setup app state
        .setup(|app| {
            // Get app data directory
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize state manager
            let mut state_manager = StateManager::new(data_dir.clone());
            state_manager.load().ok();

            // Initialize backup engine
            let backup_engine = match backup::engine::BackupEngine::new(data_dir.clone()) {
                Ok(engine) => {
                    println!("Backup engine initialized successfully");
                    Some(engine)
                }
                Err(e) => {
                    eprintln!("Failed to initialize backup engine: {}", e);
                    None
                }
            };

            // Initialize weather service with saved location
            let mut weather_service = weather::WeatherService::new();
            if let Some(location) = state_manager.get_state().location.clone() {
                weather_service = weather_service.with_location(location);
            }

            // Initialize Google Drive client with saved tokens and config
            let mut drive_client: Option<cloud::google_drive::GoogleDriveClient> = None;
            let env_config = cloud::google_drive::DriveConfig::from_env();
            let saved_config = state_manager
                .get_state()
                .google_drive_config
                .clone()
                .filter(|cfg| !cfg.client_id.is_empty() && !cfg.client_secret.is_empty());

            if let Some(tokens) = state_manager.get_state().google_tokens.clone() {
                let config = env_config
                    .clone()
                    .or(saved_config)
                    .unwrap_or_default();

                // Only restore the client when we have credentials to refresh tokens
                if !config.client_id.is_empty() && !config.client_secret.is_empty() {
                    let mut client = cloud::google_drive::GoogleDriveClient::new(config);
                    client.set_tokens(tokens);
                    drive_client = Some(client);
                } else {
                    eprintln!("Google Drive credentials missing; reconnect required");
                }
            }

            // Register state
            let state_arc = Arc::new(Mutex::new(state_manager));
            let engine_arc = Arc::new(Mutex::new(backup_engine));
            let drive_arc = Arc::new(Mutex::new(drive_client));

            app.manage(AppStateManager(state_arc.clone()));
            app.manage(BackupEngineState(engine_arc.clone()));
            app.manage(DriveClientState(drive_arc.clone()));
            app.manage(WeatherServiceState(Arc::new(Mutex::new(weather_service))));

            // Spawn schedule worker to process due schedules
            let schedule_state = state_arc.clone();
            let schedule_engine = engine_arc.clone();
            let schedule_drive = drive_arc.clone();
            let app_handle = app.handle().clone();
            let mut running: HashSet<String> = HashSet::new();

            tauri::async_runtime::spawn(async move {
                loop {
                    // Poll every 3s to minimize delay between target time and execution.
                    let interval_seconds: u64 = 3;

                    let due: Vec<(String, String)> = {
                        let mgr = schedule_state.lock().await;
                        mgr.get_state()
                            .schedules
                            .iter()
                            .filter(|s| s.enabled && s.should_run_now())
                            .map(|s| (s.id.clone(), s.backup_set_id.clone()))
                            .collect()
                    };

                    if !due.is_empty() {
                        println!("Schedule worker: {} due backup(s)", due.len());
                    }

                    for (schedule_id, backup_set_id) in due {
                        if running.contains(&schedule_id) {
                            continue;
                        }
                        running.insert(schedule_id.clone());

                        let run_result = execute_backup_with_trigger(
                            backup_set_id.clone(),
                            false,
                            "schedule",
                            app_handle.clone(),
                            schedule_state.clone(),
                            schedule_engine.clone(),
                            schedule_drive.clone(),
                        )
                        .await;

                        let mut mgr = schedule_state.lock().await;
                        if let Some(sched) =
                            mgr.get_state_mut().schedules.iter_mut().find(|s| s.id == schedule_id)
                        {
                            if run_result.is_ok() {
                                sched.last_run = Some(Utc::now());
                                sched.calculate_next_run();
                            }
                            sched.updated_at = Utc::now();
                        }
                        mgr.save().ok();

                        if let Err(e) = run_result {
                            let _ = app_handle.emit(
                                "upload:error",
                                format!("Scheduled backup failed: {}", e),
                            );
                            eprintln!(
                                "Scheduled backup failed for schedule {} set {}: {}",
                                schedule_id, backup_set_id, e
                            );
                        }

                        running.remove(&schedule_id);
                    }

                    sleep(Duration::from_secs(interval_seconds)).await;
                }
            });

            // Setup system tray
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let backup_now =
                MenuItem::with_id(app, "backup_now", "Backup Now", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show, &backup_now, &quit])?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .expect("App icon should exist; regenerate icons if missing");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("Sentry Backup")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    }
                    "backup_now" => {
                        // Emit event to frontend to trigger backup
                        if let Some(window) = app.get_webview_window("main") {
                            window.emit("tray:backup_now", ()).ok();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // Register commands
        .invoke_handler(tauri::generate_handler![
            // App state
            get_app_state,
            is_first_run,
            update_settings,
            update_onboarding,
            complete_onboarding,
            // Backup sets
            get_backup_sets,
            get_backup_set,
            create_backup_set,
            create_backup_set_from_preset,
            update_backup_set,
            delete_backup_set,
            // Schedules
            get_schedules,
            create_schedule,
            update_schedule,
            delete_schedule,
            set_weather_triggers,
            // Backup execution
            run_backup,
            // Google Drive
            get_google_auth_url,
            exchange_google_code,
            start_oauth_callback_server,
            is_google_authenticated,
            disconnect_google,
            upload_to_drive,
            list_drive_backups,
            list_drive_backup_bundles,
            download_from_drive,
            download_backup_bundle,
            delete_from_drive,
            get_drive_quota,
            // Weather
            detect_location,
            get_weather_alerts,
            get_weather_conditions,
            set_location,
            // Manifests
            get_manifests_for_set,
            // System
            get_home_directory,
            get_documents_directory,
            pick_directory,
            pick_directories,
            get_folder_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
