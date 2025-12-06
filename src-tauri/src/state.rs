//! Application State and Settings Management

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;

use crate::backup::scheduler::Schedule;
use crate::backup::set::BackupSetManager;
use crate::cloud::google_drive::{DriveConfig, GoogleTokens};
use crate::weather::Location;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: Theme,
    pub minimize_to_tray: bool,
    pub start_minimized: bool,
    pub start_on_boot: bool,
    pub check_for_updates: bool,
    pub notification_enabled: bool,
    pub notification_on_backup_complete: bool,
    pub notification_on_weather_alert: bool,
    pub weather_check_interval_minutes: u32,
    pub backup_check_interval_minutes: u32,
    pub max_concurrent_uploads: u32,
    pub chunk_size_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Theme {
    Light,
    Dark,
    System,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            minimize_to_tray: true,
            start_minimized: false,
            start_on_boot: false,
            check_for_updates: true,
            notification_enabled: true,
            notification_on_backup_complete: true,
            notification_on_weather_alert: true,
            weather_check_interval_minutes: 30,
            backup_check_interval_minutes: 5,
            max_concurrent_uploads: 2,
            chunk_size_mb: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub completed: bool,
    pub current_step: u32,
    pub google_connected: bool,
    pub location_set: bool,
    pub first_backup_set_created: bool,
    pub completed_at: Option<DateTime<Utc>>,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            completed: false,
            current_step: 0,
            google_connected: false,
            location_set: false,
            first_backup_set_created: false,
            completed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub settings: AppSettings,
    pub onboarding: OnboardingState,
    pub backup_sets: BackupSetManager,
    pub schedules: Vec<Schedule>,
    pub google_tokens: Option<GoogleTokens>,
    pub google_drive_config: Option<DriveConfig>,
    pub location: Option<Location>,
    pub last_weather_check: Option<DateTime<Utc>>,
    pub last_backup_check: Option<DateTime<Utc>>,
    pub app_version: String,
    pub first_run: bool,
    pub updated_at: DateTime<Utc>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: AppSettings::default(),
            onboarding: OnboardingState::default(),
            backup_sets: BackupSetManager::new(),
            schedules: vec![],
            google_tokens: None,
            google_drive_config: None,
            location: None,
            last_weather_check: None,
            last_backup_check: None,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            first_run: true,
            updated_at: Utc::now(),
        }
    }
}

pub struct StateManager {
    data_dir: PathBuf,
    state: AppState,
}

impl StateManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            state: AppState::default(),
        }
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("app_state.json")
    }

    pub fn load(&mut self) -> Result<(), std::io::Error> {
        let path = self.state_path();
        if path.exists() {
            let file = File::open(&path)?;
            let reader = BufReader::new(file);
            self.state = serde_json::from_reader(reader)
                .unwrap_or_else(|_| AppState::default());
            self.state.first_run = false;
        }

        // Refresh next_run using the current local timezone to avoid stale offsets
        for schedule in &mut self.state.schedules {
            schedule.calculate_next_run();
        }

        // Always refresh version from the current build to avoid stale values in persisted state
        self.state.app_version = env!("CARGO_PKG_VERSION").to_string();
        Ok(())
    }

    pub fn save(&mut self) -> Result<(), std::io::Error> {
        fs::create_dir_all(&self.data_dir)?;
        let path = self.state_path();
        let file = File::create(&path)?;
        let writer = BufWriter::new(file);
        self.state.updated_at = Utc::now();
        serde_json::to_writer_pretty(writer, &self.state)?;
        Ok(())
    }

    pub fn get_state(&self) -> &AppState {
        &self.state
    }

    pub fn get_state_mut(&mut self) -> &mut AppState {
        &mut self.state
    }

    pub fn update_settings(&mut self, settings: AppSettings) -> Result<(), std::io::Error> {
        self.state.settings = settings;
        self.save()
    }

    pub fn update_onboarding(&mut self, onboarding: OnboardingState) -> Result<(), std::io::Error> {
        self.state.onboarding = onboarding;
        self.save()
    }

    pub fn complete_onboarding(&mut self) -> Result<(), std::io::Error> {
        self.state.onboarding.completed = true;
        self.state.onboarding.completed_at = Some(Utc::now());
        self.state.first_run = false;
        self.save()
    }

    pub fn set_google_tokens(
        &mut self,
        tokens: Option<GoogleTokens>,
    ) -> Result<(), std::io::Error> {
        self.state.google_tokens = tokens;
        self.save()
    }

    pub fn set_google_drive_config(
        &mut self,
        config: Option<DriveConfig>,
    ) -> Result<(), std::io::Error> {
        self.state.google_drive_config = config;
        self.save()
    }

    pub fn set_location(&mut self, location: Option<Location>) -> Result<(), std::io::Error> {
        self.state.location = location;
        self.save()
    }

    pub fn add_backup_set(
        &mut self,
        set: crate::backup::set::BackupSet,
    ) -> Result<(), std::io::Error> {
        self.state.backup_sets.add_set(set);
        self.save()
    }

    pub fn update_backup_set(
        &mut self,
        set: crate::backup::set::BackupSet,
    ) -> Result<(), std::io::Error> {
        self.state.backup_sets.update_set(set);
        self.save()
    }

    pub fn remove_backup_set(
        &mut self,
        id: &str,
    ) -> Result<Option<crate::backup::set::BackupSet>, std::io::Error> {
        let removed = self.state.backup_sets.remove_set(id);
        self.save()?;
        Ok(removed)
    }

    pub fn add_schedule(&mut self, schedule: Schedule) -> Result<(), std::io::Error> {
        self.state.schedules.push(schedule);
        self.save()
    }

    pub fn update_schedule(&mut self, mut schedule: Schedule) -> Result<(), std::io::Error> {
        schedule.calculate_next_run();
        schedule.updated_at = Utc::now();

        if let Some(existing) = self.state.schedules.iter_mut().find(|s| s.id == schedule.id) {
            *existing = schedule;
        } else {
            // If the schedule was not found, append it to avoid dropping the update
            self.state.schedules.push(schedule);
        }
        self.save()
    }

    pub fn remove_schedule(&mut self, id: &str) -> Result<(), std::io::Error> {
        self.state.schedules.retain(|s| s.id != id);
        self.save()
    }

    pub fn is_first_run(&self) -> bool {
        self.state.first_run
    }

    pub fn is_onboarding_complete(&self) -> bool {
        self.state.onboarding.completed
    }
}

