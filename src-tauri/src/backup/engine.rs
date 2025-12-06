//! Backup Engine - Core backup functionality
//! Handles file scanning, compression, and chunked uploads

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use super::manifest::{BackupManifest, FileEntry, ManifestManager};
use super::set::BackupSet;

#[derive(Error, Debug)]
pub enum BackupError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Path error: {0}")]
    InvalidPath(String),
    #[error("Backup cancelled")]
    Cancelled,
    #[error("Manifest error: {0}")]
    Manifest(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupProgress {
    pub total_files: u64,
    pub processed_files: u64,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    pub current_file: String,
    pub status: BackupStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupStatus {
    Idle,
    Scanning,
    Compressing,
    Uploading,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub id: String,
    pub backup_set_id: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    pub total_files: u64,
    pub total_bytes: u64,
    pub compressed_bytes: u64,
    pub files_backed_up: Vec<FileEntry>,
    pub archive_path: PathBuf,
}

impl BackupResult {
    /// Convenience helper for the manifest filename corresponding to this backup result.
    pub fn manifest_file_name(&self) -> String {
        format!("{}.json", self.id)
    }
}

pub struct BackupEngine {
    manifest_manager: ManifestManager,
    temp_dir: PathBuf,
    chunk_size: usize,
}

impl BackupEngine {
    pub fn new(data_dir: PathBuf) -> Result<Self, BackupError> {
        let temp_dir = data_dir.join("temp");
        fs::create_dir_all(&temp_dir)?;

        Ok(Self {
            manifest_manager: ManifestManager::new(data_dir),
            temp_dir,
            chunk_size: 10 * 1024 * 1024, // 10MB chunks
        })
    }

    /// Calculate file hash for change detection
    pub fn calculate_hash(path: &Path) -> Result<String, BackupError> {
        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Scan directory and collect file information
    pub fn scan_directory(
        &self,
        path: &Path,
        exclude_patterns: &[String],
    ) -> Result<Vec<FileEntry>, BackupError> {
        let mut entries = Vec::new();

        for entry in WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let file_path = entry.path();

            // Skip directories
            if file_path.is_dir() {
                continue;
            }

            // Check exclusions
            let path_str = file_path.to_string_lossy();
            let should_exclude = exclude_patterns.iter().any(|pattern| {
                path_str.contains(pattern)
                    || file_path
                        .file_name()
                        .map(|n| n.to_string_lossy().contains(pattern))
                        .unwrap_or(false)
            });

            if should_exclude {
                continue;
            }

            let metadata = fs::metadata(file_path)?;
            let hash = Self::calculate_hash(file_path)?;
            let modified = metadata
                .modified()
                .map(|t| DateTime::<Utc>::from(t))
                .unwrap_or_else(|_| Utc::now());

            entries.push(FileEntry {
                path: file_path.to_path_buf(),
                relative_path: file_path
                    .strip_prefix(path)
                    .unwrap_or(file_path)
                    .to_path_buf(),
                size: metadata.len(),
                hash,
                modified,
                backed_up_at: None,
            });
        }

        Ok(entries)
    }

    /// Perform incremental backup - only backup changed files
    pub fn get_changed_files(
        &self,
        backup_set: &BackupSet,
        current_files: &[FileEntry],
    ) -> Result<Vec<FileEntry>, BackupError> {
        let manifest = self.manifest_manager.load_manifest(&backup_set.id)?;

        let backed_up_hashes: HashMap<PathBuf, String> = manifest
            .map(|m| {
                m.files
                    .iter()
                    .map(|f| (f.relative_path.clone(), f.hash.clone()))
                    .collect()
            })
            .unwrap_or_default();

        let changed: Vec<FileEntry> = current_files
            .iter()
            .filter(|file| {
                backed_up_hashes
                    .get(&file.relative_path)
                    .map(|h| h != &file.hash)
                    .unwrap_or(true)
            })
            .cloned()
            .collect();

        Ok(changed)
    }

    /// Create compressed archive from files
    pub fn create_archive(
        &self,
        backup_set: &BackupSet,
        files: &[FileEntry],
        progress_callback: impl Fn(BackupProgress),
    ) -> Result<PathBuf, BackupError> {
        let backup_id = Uuid::new_v4().to_string();
        let archive_name = format!("{}_{}.zip", backup_set.id, backup_id);
        let archive_path = self.temp_dir.join(&archive_name);

        let file = File::create(&archive_path)?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));

        let total_bytes: u64 = files.iter().map(|f| f.size).sum();
        let total_files = files.len() as u64;
        let mut processed_files = 0u64;
        let mut processed_bytes = 0u64;

        for file_entry in files {
            progress_callback(BackupProgress {
                total_files,
                processed_files,
                total_bytes,
                processed_bytes,
                current_file: file_entry.relative_path.to_string_lossy().to_string(),
                status: BackupStatus::Compressing,
                error: None,
            });

            let name = file_entry.relative_path.to_string_lossy();
            zip.start_file(name.as_ref(), options)?;

            let mut source = File::open(&file_entry.path)?;
            let mut buffer = [0u8; 8192];

            loop {
                let bytes_read = source.read(&mut buffer)?;
                if bytes_read == 0 {
                    break;
                }
                zip.write_all(&buffer[..bytes_read])?;
                processed_bytes += bytes_read as u64;
            }

            processed_files += 1;
        }

        zip.finish()?;

        // Move archive to local destination if specified
        if let Some(local_dest) = &backup_set.local_destination {
            let dest_path = Path::new(local_dest);
            fs::create_dir_all(dest_path)?;
            let final_path = dest_path.join(&archive_name);
            fs::rename(&archive_path, &final_path)?;
            Ok(final_path)
        } else {
            Ok(archive_path)
        }
    }

    /// Split archive into chunks for upload
    pub fn split_into_chunks(&self, archive_path: &Path) -> Result<Vec<PathBuf>, BackupError> {
        let mut chunks = Vec::new();
        let mut file = File::open(archive_path)?;
        let metadata = file.metadata()?;
        let total_size = metadata.len() as usize;

        if total_size <= self.chunk_size {
            return Ok(vec![archive_path.to_path_buf()]);
        }

        let mut chunk_index = 0;
        let mut buffer = vec![0u8; self.chunk_size];

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }

            let chunk_path = archive_path.with_extension(format!("part{:03}", chunk_index));
            let mut chunk_file = File::create(&chunk_path)?;
            chunk_file.write_all(&buffer[..bytes_read])?;

            chunks.push(chunk_path);
            chunk_index += 1;
        }

        Ok(chunks)
    }

    /// Execute full backup for a backup set
    pub fn execute_backup(
        &mut self,
        backup_set: &BackupSet,
        incremental: bool,
        progress_callback: impl Fn(BackupProgress),
    ) -> Result<BackupResult, BackupError> {
        let started_at = Utc::now();

        // Scan all source paths
        progress_callback(BackupProgress {
            total_files: 0,
            processed_files: 0,
            total_bytes: 0,
            processed_bytes: 0,
            current_file: "Scanning files...".to_string(),
            status: BackupStatus::Scanning,
            error: None,
        });

        let mut all_files = Vec::new();
        for source in &backup_set.sources {
            let source_path = Path::new(source);
            let files = self.scan_directory(source_path, &backup_set.exclude_patterns)?;
            all_files.extend(files);
        }

        // Get only changed files if incremental
        let files_to_backup = if incremental {
            self.get_changed_files(backup_set, &all_files)?
        } else {
            all_files.clone()
        };

        if files_to_backup.is_empty() {
            // Emit a completion event even when there is nothing to back up so the
            // frontend can clear any lingering "Scanning" states.
            progress_callback(BackupProgress {
                total_files: 0,
                processed_files: 0,
                total_bytes: 0,
                processed_bytes: 0,
                current_file: "No changes detected - already up to date".to_string(),
                status: BackupStatus::Completed,
                error: None,
            });

            return Ok(BackupResult {
                id: Uuid::new_v4().to_string(),
                backup_set_id: backup_set.id.clone(),
                started_at,
                completed_at: Utc::now(),
                total_files: 0,
                total_bytes: 0,
                compressed_bytes: 0,
                files_backed_up: vec![],
                archive_path: PathBuf::new(),
            });
        }

        // Create archive
        let archive_path = self.create_archive(backup_set, &files_to_backup, &progress_callback)?;
        let archive_size = fs::metadata(&archive_path)?.len() as u64;
        let total_uncompressed_bytes: u64 = files_to_backup.iter().map(|f| f.size).sum();

        // Upload to cloud if enabled
        if backup_set.cloud_upload {
            // TODO: Implement cloud upload logic
            // For now, just create local archive
        }

        // Update manifest
        let files_with_backup_time: Vec<FileEntry> = files_to_backup
            .iter()
            .map(|f| {
                let mut file = f.clone();
                file.backed_up_at = Some(Utc::now());
                file
            })
            .collect();

        let manifest = BackupManifest {
            id: Uuid::new_v4().to_string(),
            backup_set_id: backup_set.id.clone(),
            created_at: Utc::now(),
            files: files_with_backup_time.clone(),
            total_size: total_uncompressed_bytes,
            compressed_size: archive_size,
            cloud_location: None,
            retention_until: backup_set
                .retention_days
                .map(|days| Utc::now() + chrono::Duration::days(days as i64)),
        };

        self.manifest_manager.save_manifest(&manifest)?;

        progress_callback(BackupProgress {
            total_files: files_to_backup.len() as u64,
            processed_files: files_to_backup.len() as u64,
            total_bytes: total_uncompressed_bytes,
            processed_bytes: total_uncompressed_bytes,
            current_file: "Backup complete".to_string(),
            status: BackupStatus::Completed,
            error: None,
        });

        Ok(BackupResult {
            id: manifest.id,
            backup_set_id: backup_set.id.clone(),
            started_at,
            completed_at: Utc::now(),
            total_files: files_to_backup.len() as u64,
            total_bytes: total_uncompressed_bytes,
            compressed_bytes: archive_size,
            files_backed_up: files_with_backup_time,
            archive_path,
        })
    }

    /// Clean up old temp files
    pub fn cleanup_temp(&self) -> Result<(), BackupError> {
        if self.temp_dir.exists() {
            for entry in fs::read_dir(&self.temp_dir)? {
                let entry = entry?;
                if entry.path().is_file() {
                    fs::remove_file(entry.path())?;
                }
            }
        }
        Ok(())
    }
}
