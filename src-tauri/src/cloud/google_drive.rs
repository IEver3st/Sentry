//! Google Drive Integration - Upload, download, and manage backups in Google Drive

use bytes::Bytes;
use chrono::{DateTime, Utc};
use futures_util::stream::{Stream, StreamExt, TryStreamExt};
use reqwest::{multipart, Body, Client};
use serde::{
    de::{self, DeserializeOwned, Deserializer},
    Deserialize, Serialize,
};
use std::env;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

#[derive(Error, Debug)]
pub enum DriveError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Authentication required")]
    AuthRequired,
    #[error("Token expired")]
    TokenExpired,
    #[error("API error: {0}")]
    Api(String),
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Upload failed: {0}")]
    UploadFailed(String),
    #[error("{0}")]
    OAuth(OAuthError),
}

/// Structured OAuth error with detailed troubleshooting information
#[derive(Debug, Clone)]
pub struct OAuthError {
    pub error_code: String,
    pub error_description: String,
    pub troubleshooting: String,
}

impl std::fmt::Display for OAuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "OAuth Error: {} - {}\n\nTroubleshooting:\n{}",
            self.error_code, self.error_description, self.troubleshooting
        )
    }
}

/// Parse OAuth error response and provide detailed troubleshooting guidance
fn parse_oauth_error(response_body: &str) -> DriveError {
    #[derive(Deserialize)]
    struct OAuthErrorResponse {
        error: Option<String>,
        error_description: Option<String>,
    }

    let parsed: Result<OAuthErrorResponse, _> = serde_json::from_str(response_body);

    match parsed {
        Ok(err_resp) => {
            let error_code = err_resp.error.unwrap_or_else(|| "unknown".to_string());
            let error_description = err_resp
                .error_description
                .unwrap_or_else(|| "No description provided".to_string());

            let troubleshooting = match error_code.as_str() {
                "invalid_client" => {
                    "This error indicates a problem with your OAuth client configuration:\n\n\
                    1. WRONG CLIENT TYPE: Your OAuth client must be a 'Web application' type, \
                       not 'Desktop app' or other types.\n\n\
                    2. CHECK CREDENTIALS: Verify your Client ID and Client Secret are correct \
                       and match what's shown in Google Cloud Console.\n\n\
                    3. REGENERATED SECRETS: If you recently regenerated the client secret, \
                       make sure you're using the new one.\n\n\
                    To fix:\n\
                    • Go to Google Cloud Console → APIs & Services → Credentials\n\
                    • Click on your OAuth 2.0 Client ID\n\
                    • Ensure 'Application type' is 'Web application'\n\
                    • Add 'http://localhost:3000' as an Authorized redirect URI\n\
                    • Copy the correct Client ID and Client Secret"
                        .to_string()
                }
                "invalid_grant" => {
                    "This error indicates a problem with the authorization code:\n\n\
                    1. CODE EXPIRED: Authorization codes expire after ~10 minutes. \
                       Try connecting again.\n\n\
                    2. CODE ALREADY USED: Each code can only be used once. \
                       Start the connection process again.\n\n\
                    3. REDIRECT URI MISMATCH: The redirect URI used during authorization \
                       must exactly match the one used during token exchange.\n\n\
                    To fix:\n\
                    • Click 'Connect' again to start fresh\n\
                    • Complete the authorization quickly (within 10 minutes)\n\
                    • Ensure 'http://localhost:3000' (no trailing slash) is in your \
                      authorized redirect URIs"
                        .to_string()
                }
                "unauthorized_client" => {
                    "This error indicates your OAuth client is not authorized:\n\n\
                    1. OAUTH CONSENT SCREEN: Your OAuth consent screen may not be configured \
                       or may be in 'Testing' mode without your email added as a test user.\n\n\
                    2. API NOT ENABLED: The Google Drive API may not be enabled for your project.\n\n\
                    To fix:\n\
                    • Go to Google Cloud Console → APIs & Services → OAuth consent screen\n\
                    • If in 'Testing' mode, add your email as a test user\n\
                    • Go to APIs & Services → Library → Search 'Google Drive API' → Enable it"
                        .to_string()
                }
                "access_denied" => {
                    "Access was denied during authorization:\n\n\
                    1. USER CANCELLED: You may have clicked 'Cancel' or 'Deny' \
                       on the Google consent screen.\n\n\
                    2. INSUFFICIENT PERMISSIONS: The requested scopes may not be allowed.\n\n\
                    To fix:\n\
                    • Try connecting again and click 'Allow' on the consent screen\n\
                    • If you see a warning about unverified app, click 'Advanced' → \
                      'Go to Sentry (unsafe)' to proceed"
                        .to_string()
                }
                "redirect_uri_mismatch" => {
                    "The redirect URI doesn't match what's configured in Google Cloud:\n\n\
                    To fix:\n\
                    • Go to Google Cloud Console → APIs & Services → Credentials\n\
                    • Click on your OAuth 2.0 Client ID\n\
                    • Under 'Authorized redirect URIs', add exactly:\n\
                      http://localhost:3000\n\
                    • Make sure there's no trailing slash\n\
                    • Save the changes and try again"
                        .to_string()
                }
                "invalid_request" => {
                    "The OAuth request was malformed:\n\n\
                    1. MISSING PARAMETERS: Required parameters may be missing.\n\n\
                    2. ENCODING ISSUES: The authorization code may have been corrupted.\n\n\
                    To fix:\n\
                    • Try connecting again from the start\n\
                    • If the issue persists, try clearing your browser cache"
                        .to_string()
                }
                _ => format!(
                    "An unexpected OAuth error occurred.\n\n\
                    Error code: {}\n\
                    Description: {}\n\n\
                    Please verify your Google Cloud Console settings:\n\
                    • OAuth client type is 'Web application'\n\
                    • Redirect URI 'http://localhost:3000' is configured\n\
                    • Google Drive API is enabled\n\
                    • Client ID and Secret are correct",
                    error_code, error_description
                ),
            };

            DriveError::OAuth(OAuthError {
                error_code,
                error_description,
                troubleshooting,
            })
        }
        Err(_) => {
            // Couldn't parse as OAuth error, return as generic API error
            DriveError::Api(format!("Authentication failed: {}", response_body))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub mime_type: Option<String>,
    #[serde(deserialize_with = "deserialize_size", default)]
    pub size: Option<u64>,
    pub created_time: Option<DateTime<Utc>>,
    pub modified_time: Option<DateTime<Utc>>,
    pub parents: Option<Vec<String>>,
    pub web_view_link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileList {
    pub files: Vec<DriveFile>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadProgress {
    pub bytes_uploaded: u64,
    pub total_bytes: u64,
    pub file_name: String,
    pub status: UploadStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UploadStatus {
    Pending,
    Uploading,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub backup_folder_name: String,
}

/// Accept both string and numeric representations for file sizes returned by Drive.
fn deserialize_size<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;

    match value {
        Some(serde_json::Value::Number(num)) => num
            .as_u64()
            .ok_or_else(|| de::Error::custom("invalid size number"))
            .map(Some),
        Some(serde_json::Value::String(s)) => s
            .parse::<u64>()
            .map(Some)
            .map_err(|_| de::Error::custom("invalid size string")),
        Some(other) => Err(de::Error::custom(format!(
            "unexpected type for size: {other}"
        ))),
        None => Ok(None),
    }
}

/// Detect common placeholder values to avoid attempting OAuth with invalid credentials.
fn is_placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("your-google-oauth-client-id")
        || lower.contains("your-google-oauth-client-secret")
        || lower.contains("placeholder")
        || lower == "changeme"
}

impl Default for DriveConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: "http://localhost:3000".to_string(),
            backup_folder_name: "Sentry Backups".to_string(),
        }
    }
}

impl DriveConfig {
    /// Build a drive config from environment variables, if both id and secret are present.
    pub fn from_env() -> Option<Self> {
        let client_id = env::var("GOOGLE_DRIVE_CLIENT_ID").ok();
        let client_secret = env::var("GOOGLE_DRIVE_CLIENT_SECRET").ok();

        match (client_id, client_secret) {
            (Some(id), Some(secret))
                if !id.is_empty()
                    && !secret.is_empty()
                    && !is_placeholder(&id)
                    && !is_placeholder(&secret) =>
            {
                Some(Self {
                    client_id: id,
                    client_secret: secret,
                    redirect_uri: env::var("GOOGLE_DRIVE_REDIRECT_URI")
                        .unwrap_or_else(|_| "http://localhost:3000".to_string()),
                    backup_folder_name: env::var("GOOGLE_DRIVE_BACKUP_FOLDER")
                        .unwrap_or_else(|_| "Sentry Backups".to_string()),
                })
            }
            _ => None,
        }
    }
}

#[derive(Clone)]
pub struct GoogleDriveClient {
    client: Client,
    config: DriveConfig,
    tokens: Option<GoogleTokens>,
    backup_folder_id: Option<String>,
}

impl GoogleDriveClient {
    const API_BASE: &'static str = "https://www.googleapis.com/drive/v3";
    const UPLOAD_BASE: &'static str = "https://www.googleapis.com/upload/drive/v3";
    const AUTH_URL: &'static str = "https://accounts.google.com/o/oauth2/v2/auth";
    const TOKEN_URL: &'static str = "https://oauth2.googleapis.com/token";
    const SCOPES: &'static str =
        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata";

    /// Decode JSON only when the response is successful; otherwise return API error text.
    async fn parse_json_response<T: DeserializeOwned>(
        response: reqwest::Response,
    ) -> Result<T, DriveError> {
        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(DriveError::Api(body));
        }

        serde_json::from_str(&body).map_err(DriveError::Json)
    }

    pub fn new(config: DriveConfig) -> Self {
        Self {
            client: Client::new(),
            config,
            tokens: None,
            backup_folder_id: None,
        }
    }

    pub fn get_auth_url(&self) -> String {
        format!(
            "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
            Self::AUTH_URL,
            urlencoding::encode(&self.config.client_id),
            urlencoding::encode(&self.config.redirect_uri),
            urlencoding::encode(Self::SCOPES)
        )
    }

    pub async fn exchange_code(&mut self, code: &str) -> Result<GoogleTokens, DriveError> {
        let response = self
            .client
            .post(Self::TOKEN_URL)
            .form(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("redirect_uri", self.config.redirect_uri.as_str()),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(parse_oauth_error(&error_text));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: i64,
            token_type: String,
            scope: String,
        }

        let token_response: TokenResponse = response.json().await?;
        let tokens = GoogleTokens {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at: Utc::now() + chrono::Duration::seconds(token_response.expires_in),
            token_type: token_response.token_type,
            scope: token_response.scope,
        };

        self.tokens = Some(tokens.clone());
        Ok(tokens)
    }

    pub async fn refresh_token(&mut self) -> Result<GoogleTokens, DriveError> {
        let refresh_token = self
            .tokens
            .as_ref()
            .and_then(|t| t.refresh_token.clone())
            .ok_or(DriveError::AuthRequired)?;

        let response = self
            .client
            .post(Self::TOKEN_URL)
            .form(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(parse_oauth_error(&error_text));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: i64,
            token_type: String,
            scope: String,
        }

        let token_response: TokenResponse = response.json().await?;
        let tokens = GoogleTokens {
            access_token: token_response.access_token,
            refresh_token: Some(refresh_token),
            expires_at: Utc::now() + chrono::Duration::seconds(token_response.expires_in),
            token_type: token_response.token_type,
            scope: token_response.scope,
        };

        self.tokens = Some(tokens.clone());
        Ok(tokens)
    }

    pub fn set_tokens(&mut self, tokens: GoogleTokens) {
        self.tokens = Some(tokens);
    }

    pub fn get_tokens(&self) -> Option<&GoogleTokens> {
        self.tokens.as_ref()
    }

    pub fn is_authenticated(&self) -> bool {
        self.tokens
            .as_ref()
            .map(|t| t.expires_at > Utc::now())
            .unwrap_or(false)
    }

    async fn ensure_authenticated(&mut self) -> Result<String, DriveError> {
        let tokens = self.tokens.as_ref().ok_or(DriveError::AuthRequired)?;

        if tokens.expires_at <= Utc::now() {
            self.refresh_token().await?;
        }

        Ok(self.tokens.as_ref().unwrap().access_token.clone())
    }

    pub async fn get_or_create_backup_folder(&mut self) -> Result<String, DriveError> {
        if let Some(folder_id) = &self.backup_folder_id {
            return Ok(folder_id.clone());
        }

        let access_token = self.ensure_authenticated().await?;

        // Search for existing folder
        let query = format!(
            "name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            self.config.backup_folder_name
        );

        let response = self
            .client
            .get(format!("{}/files", Self::API_BASE))
            .bearer_auth(&access_token)
            .query(&[("q", query.as_str()), ("fields", "files(id,name)")])
            .send()
            .await?;

        let file_list: DriveFileList = Self::parse_json_response(response).await?;

        if let Some(folder) = file_list.files.first() {
            self.backup_folder_id = Some(folder.id.clone());
            return Ok(folder.id.clone());
        }

        // Create folder
        let metadata = serde_json::json!({
            "name": self.config.backup_folder_name,
            "mimeType": "application/vnd.google-apps.folder"
        });

        let response = self
            .client
            .post(format!("{}/files", Self::API_BASE))
            .bearer_auth(&access_token)
            .json(&metadata)
            .send()
            .await?;

        let folder: DriveFile = Self::parse_json_response(response).await?;
        self.backup_folder_id = Some(folder.id.clone());
        Ok(folder.id)
    }

    pub async fn upload_file(
        &mut self,
        file_path: &Path,
        file_name: &str,
        progress_callback: impl Fn(UploadProgress) + Send + Sync + 'static,
    ) -> Result<DriveFile, DriveError> {
        if !file_path.exists() {
            return Err(DriveError::FileNotFound(file_path.display().to_string()));
        }

        let folder_id = self.get_or_create_backup_folder().await?;
        let total_size = self.file_size(file_path).await?;
        let callback: Arc<dyn Fn(UploadProgress) + Send + Sync + 'static> =
            Arc::new(progress_callback);

        Self::emit_progress(
            callback.clone(),
            file_name,
            total_size,
            0,
            UploadStatus::Uploading,
        );

        let file_metadata = serde_json::json!({
            "name": file_name,
            "parents": [folder_id]
        });

        if total_size < 5 * 1024 * 1024 {
            self.upload_multipart(file_path, file_name, file_metadata, total_size, callback)
                .await
        } else {
            self.upload_resumable(file_path, file_name, file_metadata, total_size, callback)
                .await
        }
    }

    async fn upload_multipart(
        &mut self,
        file_path: &Path,
        file_name: &str,
        file_metadata: serde_json::Value,
        total_size: u64,
        progress_callback: Arc<dyn Fn(UploadProgress) + Send + Sync + 'static>,
    ) -> Result<DriveFile, DriveError> {
        let access_token = self.ensure_authenticated().await?;
        let content = tokio::fs::read(file_path).await?;
        let file_metadata_json = serde_json::to_string(&file_metadata)?;

        let form = multipart::Form::new()
            .part(
                "metadata",
                multipart::Part::text(file_metadata_json)
                    .mime_str("application/json; charset=UTF-8")?,
            )
            .part(
                "file",
                multipart::Part::bytes(content).mime_str("application/octet-stream")?,
            );

        let response = self
            .client
            .post(format!("{}/files?uploadType=multipart", Self::UPLOAD_BASE))
            .bearer_auth(&access_token)
            .multipart(form)
            .send()
            .await?;

        Self::handle_upload_response(response, file_name, total_size, progress_callback).await
    }

    async fn upload_resumable(
        &mut self,
        file_path: &Path,
        file_name: &str,
        file_metadata: serde_json::Value,
        total_size: u64,
        progress_callback: Arc<dyn Fn(UploadProgress) + Send + Sync + 'static>,
    ) -> Result<DriveFile, DriveError> {
        // Two attempts max: initial + one retry after refresh
        for attempt in 0..=1 {
            let access_token = self.ensure_authenticated().await?;

            let init_response = self
                .client
                .post(format!("{}/files?uploadType=resumable", Self::UPLOAD_BASE))
                .bearer_auth(&access_token)
                .header("Content-Type", "application/json")
                .header("X-Upload-Content-Type", "application/octet-stream")
                .header("X-Upload-Content-Length", total_size.to_string())
                .json(&file_metadata)
                .send()
                .await?;

            let upload_url = init_response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| DriveError::UploadFailed("No upload URL received".to_string()))?
                .to_string();

            let stream = Self::build_progress_stream(
                file_path,
                file_name,
                total_size,
                progress_callback.clone(),
            )
            .await?;

            let response = self
                .client
                .put(&upload_url)
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", total_size.to_string())
                .body(Body::wrap_stream(stream))
                .send()
                .await?;

            if response.status().is_success() {
                return Self::handle_upload_response(
                    response,
                    file_name,
                    total_size,
                    progress_callback,
                )
                .await;
            }

            if (response.status().as_u16() == 401 || response.status().as_u16() == 403)
                && attempt == 0
            {
                // Refresh token and retry once
                self.refresh_token().await?;
                continue;
            }

            let error_text = response.text().await?;
            Self::emit_progress(
                progress_callback,
                file_name,
                total_size,
                0,
                UploadStatus::Failed,
            );
            return Err(DriveError::UploadFailed(error_text));
        }

        Err(DriveError::UploadFailed(
            "Upload failed after retry".to_string(),
        ))
    }

    async fn handle_upload_response(
        response: reqwest::Response,
        file_name: &str,
        total_size: u64,
        progress_callback: Arc<dyn Fn(UploadProgress) + Send + Sync + 'static>,
    ) -> Result<DriveFile, DriveError> {
        if !response.status().is_success() {
            let error_text = response.text().await?;
            Self::emit_progress(
                progress_callback,
                file_name,
                total_size,
                0,
                UploadStatus::Failed,
            );
            return Err(DriveError::UploadFailed(error_text));
        }

        let uploaded_file: DriveFile = response.json().await?;
        Self::emit_progress(
            progress_callback,
            file_name,
            total_size,
            total_size,
            UploadStatus::Completed,
        );
        Ok(uploaded_file)
    }

    async fn build_progress_stream(
        file_path: &Path,
        file_name: &str,
        total_size: u64,
        progress_callback: Arc<dyn Fn(UploadProgress) + Send + Sync + 'static>,
    ) -> Result<
        Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static>>,
        DriveError,
    > {
        let file = File::open(file_path).await?;
        let name = file_name.to_string();
        let callback = progress_callback.clone();
        let uploaded = Arc::new(AtomicU64::new(0));

        let stream = ReaderStream::new(file).inspect_ok(move |bytes| {
            let current =
                uploaded.fetch_add(bytes.len() as u64, Ordering::Relaxed) + bytes.len() as u64;
            callback(UploadProgress {
                bytes_uploaded: current,
                total_bytes: total_size,
                file_name: name.clone(),
                status: UploadStatus::Uploading,
            });
        });

        Ok(Box::pin(stream))
    }

    fn emit_progress(
        progress_callback: Arc<dyn Fn(UploadProgress)>,
        file_name: &str,
        total_size: u64,
        bytes_uploaded: u64,
        status: UploadStatus,
    ) {
        progress_callback(UploadProgress {
            bytes_uploaded,
            total_bytes: total_size,
            file_name: file_name.to_string(),
            status,
        });
    }

    async fn file_size(&self, file_path: &Path) -> Result<u64, DriveError> {
        let metadata = tokio::fs::metadata(file_path).await?;
        Ok(metadata.len())
    }

    pub async fn download_file(
        &mut self,
        file_id: &str,
        output_path: &Path,
        progress_callback: impl Fn(u64, u64),
    ) -> Result<(), DriveError> {
        let access_token = self.ensure_authenticated().await?;

        let response = self
            .client
            .get(format!("{}/files/{}?alt=media", Self::API_BASE, file_id))
            .bearer_auth(&access_token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(DriveError::FileNotFound(file_id.to_string()));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut file = File::create(output_path).await?;
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;

        while let Some(chunk) = stream.next().await {
            let bytes = chunk?;
            file.write_all(&bytes).await?;
            downloaded += bytes.len() as u64;
            progress_callback(downloaded, total_size);
        }

        Ok(())
    }

    /// Download a Drive file and return its raw bytes (no disk writes).
    pub async fn download_bytes(&mut self, file_id: &str) -> Result<Vec<u8>, DriveError> {
        let access_token = self.ensure_authenticated().await?;

        let response = self
            .client
            .get(format!("{}/files/{}?alt=media", Self::API_BASE, file_id))
            .bearer_auth(&access_token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(DriveError::FileNotFound(file_id.to_string()));
        }

        let content = response.bytes().await?;
        Ok(content.to_vec())
    }

    pub async fn list_backups(&mut self) -> Result<Vec<DriveFile>, DriveError> {
        let access_token = self.ensure_authenticated().await?;
        let folder_id = self.get_or_create_backup_folder().await?;

        let query = format!("'{}' in parents and trashed=false", folder_id);

        let response = self
            .client
            .get(format!("{}/files", Self::API_BASE))
            .bearer_auth(&access_token)
            .query(&[
                ("q", query.as_str()),
                (
                    "fields",
                    "files(id,name,size,createdTime,modifiedTime,webViewLink)",
                ),
                ("orderBy", "createdTime desc"),
            ])
            .send()
            .await?;

        let file_list: DriveFileList = Self::parse_json_response(response).await?;
        Ok(file_list.files)
    }

    pub async fn delete_file(&mut self, file_id: &str) -> Result<(), DriveError> {
        let access_token = self.ensure_authenticated().await?;

        let response = self
            .client
            .delete(format!("{}/files/{}", Self::API_BASE, file_id))
            .bearer_auth(&access_token)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(DriveError::Api(error_text));
        }

        Ok(())
    }

    pub async fn get_storage_quota(&mut self) -> Result<(u64, u64), DriveError> {
        let access_token = self.ensure_authenticated().await?;

        let response = self
            .client
            .get(format!("{}/about", Self::API_BASE))
            .bearer_auth(&access_token)
            .query(&[("fields", "storageQuota")])
            .send()
            .await?;

        #[derive(Deserialize)]
        struct AboutResponse {
            #[serde(rename = "storageQuota")]
            storage_quota: StorageQuota,
        }

        #[derive(Deserialize)]
        struct StorageQuota {
            usage: String,
            limit: String,
        }

        let about: AboutResponse = Self::parse_json_response(response).await?;
        let used = about.storage_quota.usage.parse().unwrap_or(0);
        let total = about.storage_quota.limit.parse().unwrap_or(0);

        Ok((used, total))
    }
}
