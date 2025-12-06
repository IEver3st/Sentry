//! Backup Manifest - Tracks all backed up files and their cloud locations
//! Enables incremental backups and restoration

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;

use super::engine::BackupError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub size: u64,
    pub hash: String,
    pub modified: DateTime<Utc>,
    pub backed_up_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudLocation {
    pub provider: String,
    pub file_id: String,
    pub folder_id: String,
    pub chunks: Vec<CloudChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudChunk {
    pub index: u32,
    pub file_id: String,
    pub size: u64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub id: String,
    pub backup_set_id: String,
    pub created_at: DateTime<Utc>,
    pub files: Vec<FileEntry>,
    pub total_size: u64,
    pub compressed_size: u64,
    pub cloud_location: Option<CloudLocation>,
    pub retention_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestIndex {
    pub manifests: Vec<ManifestSummary>,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestSummary {
    pub id: String,
    pub backup_set_id: String,
    pub created_at: DateTime<Utc>,
    pub file_count: u64,
    pub total_size: u64,
    pub compressed_size: u64,
    pub is_uploaded: bool,
}

pub struct ManifestManager {
    data_dir: PathBuf,
}

impl ManifestManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    fn manifests_dir(&self) -> PathBuf {
        self.data_dir.join("manifests")
    }

    fn manifest_path(&self, id: &str) -> PathBuf {
        self.manifests_dir().join(format!("{}.json", id))
    }

    fn index_path(&self) -> PathBuf {
        self.manifests_dir().join("index.json")
    }

    pub fn save_manifest(&self, manifest: &BackupManifest) -> Result<(), BackupError> {
        let dir = self.manifests_dir();
        fs::create_dir_all(&dir)?;

        let path = self.manifest_path(&manifest.id);
        let file = File::create(&path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, manifest)
            .map_err(|e| BackupError::Manifest(e.to_string()))?;

        // Update index
        self.update_index(manifest)?;

        Ok(())
    }

    pub fn load_manifest(&self, backup_set_id: &str) -> Result<Option<BackupManifest>, BackupError> {
        let index = self.load_index()?;
        
        // Find the latest manifest for this backup set
        let latest = index
            .manifests
            .iter()
            .filter(|m| m.backup_set_id == backup_set_id)
            .max_by_key(|m| m.created_at);

        match latest {
            Some(summary) => {
                let path = self.manifest_path(&summary.id);
                if path.exists() {
                    let file = File::open(&path)?;
                    let reader = BufReader::new(file);
                    let manifest: BackupManifest = serde_json::from_reader(reader)
                        .map_err(|e| BackupError::Manifest(e.to_string()))?;
                    Ok(Some(manifest))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    pub fn load_manifest_by_id(&self, id: &str) -> Result<Option<BackupManifest>, BackupError> {
        let path = self.manifest_path(id);
        if path.exists() {
            let file = File::open(&path)?;
            let reader = BufReader::new(file);
            let manifest: BackupManifest = serde_json::from_reader(reader)
                .map_err(|e| BackupError::Manifest(e.to_string()))?;
            Ok(Some(manifest))
        } else {
            Ok(None)
        }
    }

    pub fn load_index(&self) -> Result<ManifestIndex, BackupError> {
        let path = self.index_path();
        if path.exists() {
            let file = File::open(&path)?;
            let reader = BufReader::new(file);
            let index: ManifestIndex = serde_json::from_reader(reader)
                .map_err(|e| BackupError::Manifest(e.to_string()))?;
            Ok(index)
        } else {
            Ok(ManifestIndex {
                manifests: vec![],
                last_updated: Utc::now(),
            })
        }
    }

    fn update_index(&self, manifest: &BackupManifest) -> Result<(), BackupError> {
        let mut index = self.load_index()?;

        let summary = ManifestSummary {
            id: manifest.id.clone(),
            backup_set_id: manifest.backup_set_id.clone(),
            created_at: manifest.created_at,
            file_count: manifest.files.len() as u64,
            total_size: manifest.total_size,
            compressed_size: manifest.compressed_size,
            is_uploaded: manifest.cloud_location.is_some(),
        };

        // Remove old entry if exists
        index.manifests.retain(|m| m.id != manifest.id);
        index.manifests.push(summary);
        index.last_updated = Utc::now();

        let path = self.index_path();
        let file = File::create(&path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, &index)
            .map_err(|e| BackupError::Manifest(e.to_string()))?;

        Ok(())
    }

    pub fn list_manifests_for_set(&self, backup_set_id: &str) -> Result<Vec<ManifestSummary>, BackupError> {
        let index = self.load_index()?;
        Ok(index
            .manifests
            .into_iter()
            .filter(|m| m.backup_set_id == backup_set_id)
            .collect())
    }

    pub fn delete_manifest(&self, id: &str) -> Result<(), BackupError> {
        let path = self.manifest_path(id);
        if path.exists() {
            fs::remove_file(&path)?;
        }

        // Update index
        let mut index = self.load_index()?;
        index.manifests.retain(|m| m.id != id);
        index.last_updated = Utc::now();

        let index_path = self.index_path();
        let file = File::create(&index_path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, &index)
            .map_err(|e| BackupError::Manifest(e.to_string()))?;

        Ok(())
    }

    pub fn cleanup_expired(&self) -> Result<Vec<String>, BackupError> {
        let index = self.load_index()?;
        let now = Utc::now();
        let mut deleted = Vec::new();

        for summary in &index.manifests {
            if let Some(manifest) = self.load_manifest_by_id(&summary.id)? {
                if let Some(retention_until) = manifest.retention_until {
                    if retention_until < now {
                        self.delete_manifest(&summary.id)?;
                        deleted.push(summary.id.clone());
                    }
                }
            }
        }

        Ok(deleted)
    }

    pub fn update_cloud_location(
        &self,
        manifest_id: &str,
        cloud_location: CloudLocation,
    ) -> Result<(), BackupError> {
        if let Some(mut manifest) = self.load_manifest_by_id(manifest_id)? {
            manifest.cloud_location = Some(cloud_location);
            self.save_manifest(&manifest)?;
        }
        Ok(())
    }

    pub fn get_all_cloud_manifests(&self) -> Result<Vec<BackupManifest>, BackupError> {
        let index = self.load_index()?;
        let mut manifests = Vec::new();

        for summary in index.manifests {
            if summary.is_uploaded {
                if let Some(manifest) = self.load_manifest_by_id(&summary.id)? {
                    manifests.push(manifest);
                }
            }
        }

        Ok(manifests)
    }
}
