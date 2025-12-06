//! Backup Set - Defines collections of paths to backup with settings

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSet {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub paths: Vec<String>,
    pub sources: Vec<String>,
    pub exclude_patterns: Vec<String>,
    pub enabled: bool,
    pub compression_level: u8,
    pub incremental: bool,
    pub retention_days: Option<u32>,
    pub max_versions: Option<u32>,
    pub cloud_upload: bool,
    pub local_destination: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_backup: Option<DateTime<Utc>>,
    pub total_backups: u64,
    pub total_size_backed_up: u64,
}

impl BackupSet {
    pub fn new(name: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            paths: vec![],
            sources: vec![],
            exclude_patterns: vec![
                "node_modules".to_string(),
                ".git".to_string(),
                "__pycache__".to_string(),
                "target".to_string(),
                ".DS_Store".to_string(),
                "Thumbs.db".to_string(),
                "*.tmp".to_string(),
                "*.temp".to_string(),
                "*.log".to_string(),
            ],
            enabled: true,
            compression_level: 6,
            incremental: true,
            retention_days: Some(30),
            max_versions: Some(10),
            cloud_upload: false, // Default to local backups only
            local_destination: None,
            created_at: now,
            updated_at: now,
            last_backup: None,
            total_backups: 0,
            total_size_backed_up: 0,
        }
    }

    pub fn with_sources(mut self, sources: Vec<PathBuf>) -> Self {
        let source_strings: Vec<String> = sources.into_iter().map(|p| p.to_string_lossy().to_string()).collect();
        self.sources = source_strings.clone();
        self.paths = source_strings;
        self
    }

    pub fn add_source(&mut self, path: PathBuf) {
        let path_str = path.to_string_lossy().to_string();
        if !self.sources.contains(&path_str) {
            self.sources.push(path_str.clone());
            self.paths.push(path_str);
            self.updated_at = Utc::now();
        }
    }

    pub fn remove_source(&mut self, path: &PathBuf) {
        let path_str = path.to_string_lossy().to_string();
        self.sources.retain(|p| p != &path_str);
        self.paths.retain(|p| p != &path_str);
        self.updated_at = Utc::now();
    }

    pub fn add_exclusion(&mut self, pattern: String) {
        if !self.exclude_patterns.contains(&pattern) {
            self.exclude_patterns.push(pattern);
            self.updated_at = Utc::now();
        }
    }

    pub fn remove_exclusion(&mut self, pattern: &str) {
        self.exclude_patterns.retain(|p| p != pattern);
        self.updated_at = Utc::now();
    }

    pub fn record_backup(&mut self, size: u64) {
        self.last_backup = Some(Utc::now());
        self.total_backups += 1;
        self.total_size_backed_up += size;
        self.updated_at = Utc::now();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSetManager {
    pub sets: Vec<BackupSet>,
}

impl BackupSetManager {
    pub fn new() -> Self {
        Self { sets: vec![] }
    }

    pub fn add_set(&mut self, set: BackupSet) {
        self.sets.push(set);
    }

    pub fn get_set(&self, id: &str) -> Option<&BackupSet> {
        self.sets.iter().find(|s| s.id == id)
    }

    pub fn get_set_mut(&mut self, id: &str) -> Option<&mut BackupSet> {
        self.sets.iter_mut().find(|s| s.id == id)
    }

    pub fn remove_set(&mut self, id: &str) -> Option<BackupSet> {
        if let Some(pos) = self.sets.iter().position(|s| s.id == id) {
            Some(self.sets.remove(pos))
        } else {
            None
        }
    }

    pub fn update_set(&mut self, set: BackupSet) {
        if let Some(existing) = self.get_set_mut(&set.id) {
            *existing = set;
        }
    }

    pub fn get_enabled_sets(&self) -> Vec<&BackupSet> {
        self.sets.iter().filter(|s| s.enabled).collect()
    }
}

impl Default for BackupSetManager {
    fn default() -> Self {
        Self::new()
    }
}

// Preset templates for common backup scenarios
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BackupPreset {
    Documents,
    Photos,
    Code,
    Desktop,
    Custom,
}

impl BackupPreset {
    pub fn create_set(&self, base_path: &PathBuf) -> BackupSet {
        match self {
            BackupPreset::Documents => {
                let mut set = BackupSet::new("Documents".to_string());
                set.description = Some("Personal documents and files".to_string());
                let doc_path = base_path.join("Documents").to_string_lossy().to_string();
                set.sources = vec![doc_path.clone()];
                set.paths = vec![doc_path];
                set.exclude_patterns.extend(vec![
                    "*.tmp".to_string(),
                    "~$*".to_string(),
                ]);
                set
            }
            BackupPreset::Photos => {
                let mut set = BackupSet::new("Photos".to_string());
                set.description = Some("Photos and images".to_string());
                let pics_path = base_path.join("Pictures").to_string_lossy().to_string();
                set.sources = vec![pics_path.clone()];
                set.paths = vec![pics_path];
                set.compression_level = 1; // Photos are already compressed
                set
            }
            BackupPreset::Code => {
                let mut set = BackupSet::new("Code Projects".to_string());
                set.description = Some("Source code and development projects".to_string());
                set.exclude_patterns.extend(vec![
                    "node_modules".to_string(),
                    "target".to_string(),
                    ".git".to_string(),
                    "dist".to_string(),
                    "build".to_string(),
                    "__pycache__".to_string(),
                    ".next".to_string(),
                    "*.pyc".to_string(),
                ]);
                set
            }
            BackupPreset::Desktop => {
                let mut set = BackupSet::new("Desktop".to_string());
                set.description = Some("Desktop files and shortcuts".to_string());
                let desktop_path = base_path.join("Desktop").to_string_lossy().to_string();
                set.sources = vec![desktop_path.clone()];
                set.paths = vec![desktop_path];
                set
            }
            BackupPreset::Custom => BackupSet::new("Custom Backup".to_string()),
        }
    }
}
