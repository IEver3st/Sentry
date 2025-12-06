//! Weather Alerts - Monitor weather conditions and trigger backups
//! Uses National Weather Service (NWS) API - Free, no API key required

use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::backup::scheduler::WeatherAlertType;

#[derive(Error, Debug)]
pub enum WeatherError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Location not found")]
    LocationNotFound,
    #[error("API error: {0}")]
    Api(String),
    #[error("Geolocation failed: {0}")]
    Geolocation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherAlert {
    pub id: String,
    pub event: String,
    pub headline: String,
    pub description: String,
    pub severity: AlertSeverity,
    pub certainty: String,
    pub urgency: String,
    pub effective: DateTime<Utc>,
    pub expires: DateTime<Utc>,
    pub sender: String,
    pub alert_type: Option<WeatherAlertType>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AlertSeverity {
    Extreme,
    Severe,
    Moderate,
    Minor,
    Unknown,
}

impl From<&str> for AlertSeverity {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "extreme" => AlertSeverity::Extreme,
            "severe" => AlertSeverity::Severe,
            "moderate" => AlertSeverity::Moderate,
            "minor" => AlertSeverity::Minor,
            _ => AlertSeverity::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherConditions {
    pub temperature: Option<f64>,
    pub humidity: Option<f64>,
    pub wind_speed: Option<f64>,
    pub description: String,
    pub icon: Option<String>,
}

pub struct WeatherService {
    client: Client,
    location: Option<Location>,
    nws_zone: Option<String>,
}

impl WeatherService {
    const NWS_API: &'static str = "https://api.weather.gov";
    const IP_GEOLOCATION_API: &'static str = "http://ip-api.com/json";

    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent("SentryBackup/1.0 (backup-app)")
                .build()
                .unwrap_or_default(),
            location: None,
            nws_zone: None,
        }
    }

    pub fn with_location(mut self, location: Location) -> Self {
        self.location = Some(location);
        self
    }

    /// Get location from IP address (free, no API key)
    pub async fn detect_location(&mut self) -> Result<Location, WeatherError> {
        let response = self
            .client
            .get(Self::IP_GEOLOCATION_API)
            .send()
            .await?;

        #[derive(Deserialize)]
        struct IpApiResponse {
            lat: f64,
            lon: f64,
            city: String,
            #[serde(rename = "regionName")]
            region_name: String,
            country: String,
            status: String,
        }

        let data: IpApiResponse = response.json().await?;

        if data.status != "success" {
            return Err(WeatherError::Geolocation("IP geolocation failed".to_string()));
        }

        let location = Location {
            latitude: data.lat,
            longitude: data.lon,
            city: Some(data.city),
            state: Some(data.region_name),
            country: Some(data.country),
        };

        self.location = Some(location.clone());
        
        // Get NWS zone for this location
        self.fetch_nws_zone().await.ok();

        Ok(location)
    }

    /// Fetch NWS forecast zone for the current location
    async fn fetch_nws_zone(&mut self) -> Result<String, WeatherError> {
        let location = self.location.as_ref().ok_or(WeatherError::LocationNotFound)?;

        let response = self
            .client
            .get(format!(
                "{}/points/{:.4},{:.4}",
                Self::NWS_API,
                location.latitude,
                location.longitude
            ))
            .send()
            .await?;

        #[derive(Deserialize)]
        struct PointsResponse {
            properties: PointsProperties,
        }

        #[derive(Deserialize)]
        struct PointsProperties {
            #[serde(rename = "forecastZone")]
            forecast_zone: String,
        }

        let data: PointsResponse = response.json().await?;
        let zone = data.properties.forecast_zone
            .split('/')
            .last()
            .unwrap_or("")
            .to_string();

        self.nws_zone = Some(zone.clone());
        Ok(zone)
    }

    /// Get active weather alerts for the current location
    pub async fn get_alerts(&self) -> Result<Vec<WeatherAlert>, WeatherError> {
        let location = self.location.as_ref().ok_or(WeatherError::LocationNotFound)?;

        // Get alerts by point (more accurate than zone)
        let response = self
            .client
            .get(format!(
                "{}/alerts/active?point={:.4},{:.4}",
                Self::NWS_API,
                location.latitude,
                location.longitude
            ))
            .send()
            .await?;

        #[derive(Deserialize)]
        struct AlertsResponse {
            features: Vec<AlertFeature>,
        }

        #[derive(Deserialize)]
        struct AlertFeature {
            properties: AlertProperties,
        }

        #[derive(Deserialize)]
        struct AlertProperties {
            id: String,
            event: String,
            headline: Option<String>,
            description: Option<String>,
            severity: String,
            certainty: String,
            urgency: String,
            effective: DateTime<Utc>,
            expires: DateTime<Utc>,
            #[serde(rename = "senderName")]
            sender_name: Option<String>,
        }

        let data: AlertsResponse = response.json().await?;

        let alerts: Vec<WeatherAlert> = data
            .features
            .into_iter()
            .map(|f| {
                let props = f.properties;
                let alert_type = WeatherAlertType::from_nws_event(&props.event);
                
                WeatherAlert {
                    id: props.id,
                    event: props.event,
                    headline: props.headline.unwrap_or_default(),
                    description: props.description.unwrap_or_default(),
                    severity: AlertSeverity::from(props.severity.as_str()),
                    certainty: props.certainty,
                    urgency: props.urgency,
                    effective: props.effective,
                    expires: props.expires,
                    sender: props.sender_name.unwrap_or_default(),
                    alert_type,
                }
            })
            .collect();

        Ok(alerts)
    }

    /// Check if there are any severe weather alerts that should trigger backup
    pub async fn check_backup_triggers(&self, enabled_triggers: &[WeatherAlertType]) -> Result<Vec<WeatherAlertType>, WeatherError> {
        let alerts = self.get_alerts().await?;
        
        let triggered: Vec<WeatherAlertType> = alerts
            .iter()
            .filter_map(|alert| {
                alert.alert_type.as_ref().and_then(|t| {
                    if enabled_triggers.contains(t) {
                        Some(t.clone())
                    } else {
                        None
                    }
                })
            })
            .collect();

        Ok(triggered)
    }

    /// Get current weather conditions (optional feature using OpenWeatherMap)
    pub async fn get_current_conditions(&self) -> Result<WeatherConditions, WeatherError> {
        let location = self.location.as_ref().ok_or(WeatherError::LocationNotFound)?;

        // Use NWS forecast API for current conditions
        let response = self
            .client
            .get(format!(
                "{}/points/{:.4},{:.4}",
                Self::NWS_API,
                location.latitude,
                location.longitude
            ))
            .send()
            .await?;

        #[derive(Deserialize)]
        struct PointsResponse {
            properties: PointsProperties,
        }

        #[derive(Deserialize)]
        struct PointsProperties {
            #[serde(rename = "forecastHourly")]
            forecast_hourly: String,
        }

        let points: PointsResponse = response.json().await?;

        let forecast_response = self
            .client
            .get(&points.properties.forecast_hourly)
            .send()
            .await?;

        #[derive(Deserialize)]
        struct ForecastResponse {
            properties: ForecastProperties,
        }

        #[derive(Deserialize)]
        struct ForecastProperties {
            periods: Vec<ForecastPeriod>,
        }

        #[derive(Deserialize)]
        struct ForecastPeriod {
            temperature: f64,
            #[serde(rename = "relativeHumidity")]
            relative_humidity: Option<HumidityValue>,
            #[serde(rename = "windSpeed")]
            wind_speed: Option<String>,
            #[serde(rename = "shortForecast")]
            short_forecast: String,
            icon: Option<String>,
        }

        #[derive(Deserialize)]
        struct HumidityValue {
            value: f64,
        }

        let forecast: ForecastResponse = forecast_response.json().await?;
        
        if let Some(current) = forecast.properties.periods.first() {
            Ok(WeatherConditions {
                temperature: Some(current.temperature),
                humidity: current.relative_humidity.as_ref().map(|h| h.value),
                wind_speed: current.wind_speed.as_ref().and_then(|s| {
                    s.split_whitespace()
                        .next()
                        .and_then(|n| n.parse().ok())
                }),
                description: current.short_forecast.clone(),
                icon: current.icon.clone(),
            })
        } else {
            Ok(WeatherConditions {
                temperature: None,
                humidity: None,
                wind_speed: None,
                description: "Unknown".to_string(),
                icon: None,
            })
        }
    }

    pub fn get_location(&self) -> Option<&Location> {
        self.location.as_ref()
    }

    pub fn set_location(&mut self, location: Location) {
        self.location = Some(location);
        self.nws_zone = None;
    }
}

impl Default for WeatherService {
    fn default() -> Self {
        Self::new()
    }
}
