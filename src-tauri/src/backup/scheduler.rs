//! Backup Scheduler - Handles scheduled and triggered backups
//! Supports cron-like scheduling and weather-based triggers

use chrono::{DateTime, Datelike, Local, LocalResult, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleType {
    #[serde(alias = "Daily")]
    Daily,
    #[serde(alias = "Weekly")]
    Weekly,
    #[serde(alias = "Monthly")]
    Monthly,
    #[serde(alias = "Custom")]
    Custom,
    #[serde(
        alias = "WeatherTriggered",
        alias = "Weather",
        alias = "weather",
        alias = "weather_triggered"
    )]
    WeatherTriggered,
    #[serde(alias = "Manual")]
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub backup_set_id: String,
    pub schedule_type: ScheduleType,
    #[serde(default)]
    pub enabled: bool,
    pub time: Option<String>, // Store as string for frontend compatibility
    #[serde(default)]
    pub days_of_week: Vec<u8>, // Store as numbers (0=Sun, 1=Mon, etc)
    pub day_of_month: Option<u32>,
    #[serde(default)]
    pub weather_trigger_enabled: bool,
    #[serde(default)]
    pub weather_alert_types: Vec<String>,
    #[serde(default)]
    pub weather_triggers: Vec<WeatherTrigger>,
    pub last_run: Option<DateTime<Utc>>,
    pub next_run: Option<DateTime<Utc>>,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherTrigger {
    pub alert_type: WeatherAlertType,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WeatherAlertType {
    Thunderstorm,
    Tornado,
    Hurricane,
    FlashFlood,
    SevereWeather,
    WinterStorm,
    ExtremeHeat,
    ExtremeCold,
}

impl WeatherAlertType {
    pub fn from_nws_event(event: &str) -> Option<Self> {
        let event_lower = event.to_lowercase();
        if event_lower.contains("tornado") {
            Some(WeatherAlertType::Tornado)
        } else if event_lower.contains("hurricane") || event_lower.contains("tropical") {
            Some(WeatherAlertType::Hurricane)
        } else if event_lower.contains("thunderstorm") || event_lower.contains("thunder") {
            Some(WeatherAlertType::Thunderstorm)
        } else if event_lower.contains("flood") {
            Some(WeatherAlertType::FlashFlood)
        } else if event_lower.contains("winter")
            || event_lower.contains("blizzard")
            || event_lower.contains("ice")
        {
            Some(WeatherAlertType::WinterStorm)
        } else if event_lower.contains("heat") {
            Some(WeatherAlertType::ExtremeHeat)
        } else if event_lower.contains("cold") || event_lower.contains("freeze") {
            Some(WeatherAlertType::ExtremeCold)
        } else if event_lower.contains("severe") {
            Some(WeatherAlertType::SevereWeather)
        } else {
            None
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            WeatherAlertType::Thunderstorm => "Thunderstorm",
            WeatherAlertType::Tornado => "Tornado",
            WeatherAlertType::Hurricane => "Hurricane/Tropical Storm",
            WeatherAlertType::FlashFlood => "Flash Flood",
            WeatherAlertType::SevereWeather => "Severe Weather",
            WeatherAlertType::WinterStorm => "Winter Storm",
            WeatherAlertType::ExtremeHeat => "Extreme Heat",
            WeatherAlertType::ExtremeCold => "Extreme Cold",
        }
    }
}

impl Schedule {
    pub fn new(name: String, backup_set_id: String, schedule_type: ScheduleType) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            backup_set_id,
            schedule_type,
            enabled: true,
            time: Some("02:00".to_string()), // Default 2 AM
            days_of_week: vec![],
            day_of_month: None,
            weather_trigger_enabled: false,
            weather_alert_types: vec![],
            weather_triggers: vec![],
            last_run: None,
            next_run: None,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn calculate_next_run(&mut self) {
        let now = Local::now();

        // Parse time string to NaiveTime
        let time = self
            .time
            .as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok())
            .unwrap_or_else(|| NaiveTime::from_hms_opt(2, 0, 0).unwrap());

        let next_naive = match self.schedule_type {
            ScheduleType::Daily => {
                let today_run = now.date_naive().and_time(time);
                if today_run > now.naive_local() {
                    today_run
                } else {
                    today_run + chrono::Duration::days(1)
                }
            }
            ScheduleType::Weekly => {
                if self.days_of_week.is_empty() {
                    return;
                }
                let mut next_run = now.date_naive().and_time(time);
                for i in 0..8 {
                    let check_date = now.date_naive() + chrono::Duration::days(i);
                    let weekday_num = check_date.weekday().num_days_from_sunday() as u8;
                    if self.days_of_week.contains(&weekday_num) {
                        let potential = check_date.and_time(time);
                        if potential > now.naive_local() {
                            next_run = potential;
                            break;
                        }
                    }
                }
                next_run
            }
            ScheduleType::Monthly => {
                let day = self.day_of_month.unwrap_or(1);
                let this_month = now.date_naive().with_day(day).map(|d| d.and_time(time));

                match this_month {
                    Some(run_time) if run_time > now.naive_local() => run_time,
                    _ => {
                        // Next month
                        let next_month = if now.month() == 12 {
                            now.with_year(now.year() + 1).and_then(|d| d.with_month(1))
                        } else {
                            now.with_month(now.month() + 1)
                        };
                        next_month
                            .and_then(|d| d.date_naive().with_day(day))
                            .map(|d| d.and_time(time))
                            .unwrap_or(now.naive_local())
                    }
                }
            }
            _ => return,
        };

        let next_local = match Local.from_local_datetime(&next_naive) {
            LocalResult::Single(dt) => dt,
            // Prefer the later occurrence when time is ambiguous (e.g., DST fall-back)
            LocalResult::Ambiguous(dt1, dt2) => dt1.max(dt2),
            // Fallback to current time if the local time is invalid (e.g., DST spring-forward gap)
            LocalResult::None => {
                let ts = next_naive.and_utc();
                Local
                    .timestamp_opt(ts.timestamp(), ts.timestamp_subsec_nanos())
                    .single()
                    .unwrap_or_else(Local::now)
            }
        };

        self.next_run = Some(next_local.with_timezone(&Utc));
    }

    pub fn should_run_now(&self) -> bool {
        if !self.enabled {
            return false;
        }

        match self.next_run {
            Some(next) => Utc::now() >= next,
            None => false,
        }
    }
}

pub struct Scheduler {
    schedules: Arc<RwLock<HashMap<String, Schedule>>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            schedules: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add_schedule(&self, schedule: Schedule) {
        let mut schedules = self.schedules.write().await;
        schedules.insert(schedule.id.clone(), schedule);
    }

    pub async fn remove_schedule(&self, id: &str) {
        let mut schedules = self.schedules.write().await;
        schedules.remove(id);
    }

    pub async fn update_schedule(&self, schedule: Schedule) {
        let mut schedules = self.schedules.write().await;
        schedules.insert(schedule.id.clone(), schedule);
    }

    pub async fn get_schedule(&self, id: &str) -> Option<Schedule> {
        let schedules = self.schedules.read().await;
        schedules.get(id).cloned()
    }

    pub async fn get_schedules_for_set(&self, backup_set_id: &str) -> Vec<Schedule> {
        let schedules = self.schedules.read().await;
        schedules
            .values()
            .filter(|s| s.backup_set_id == backup_set_id)
            .cloned()
            .collect()
    }

    pub async fn get_pending_backups(&self) -> Vec<String> {
        let schedules = self.schedules.read().await;
        schedules
            .values()
            .filter(|s| s.should_run_now())
            .map(|s| s.backup_set_id.clone())
            .collect()
    }

    pub async fn mark_completed(&self, schedule_id: &str) {
        let mut schedules = self.schedules.write().await;
        if let Some(schedule) = schedules.get_mut(schedule_id) {
            schedule.last_run = Some(Utc::now());
            schedule.calculate_next_run();
            schedule.updated_at = Utc::now();
        }
    }

    pub async fn check_weather_triggers(&self, alerts: &[WeatherAlertType]) -> Vec<String> {
        let schedules = self.schedules.read().await;
        let mut triggered = Vec::new();

        for schedule in schedules.values() {
            if !schedule.enabled {
                continue;
            }

            for trigger in &schedule.weather_triggers {
                if trigger.enabled && alerts.contains(&trigger.alert_type) {
                    triggered.push(schedule.backup_set_id.clone());
                    break;
                }
            }
        }

        triggered
    }

    pub async fn get_all_schedules(&self) -> Vec<Schedule> {
        let schedules = self.schedules.read().await;
        schedules.values().cloned().collect()
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}
