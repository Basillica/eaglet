use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use validator::Validate;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum LogLevel {
    #[serde(rename = "trace")]
    Trace,
    #[serde(rename = "debug")]
    Debug,
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warn")]
    Warn,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "fatal")]
    Fatal,
    #[serde(rename = "critical")]
    Critical,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum BreadcrumbType {
    #[serde(rename = "click")]
    Click,
    #[serde(rename = "navigation")]
    Navigation,
    #[serde(rename = "xhr")]
    Xhr,
    #[serde(rename = "console")]
    Console,
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "error")]
    Error,
}

// LogContext maps to a HashMap with flexible JSON values (Rust's direct equivalent of JsonObject)
pub type LogContext = HashMap<String, serde_json::Value>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization
pub struct UserInfo {
    pub id: Option<String>,
    pub username: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Brand {
    pub brand: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization
pub struct UserAgentClientHints {
    pub brands: Vec<Brand>,
    pub mobile: bool,
    pub platform: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization
pub struct DeviceInfo {
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub family: Option<String>,
    pub screen_width: Option<u32>,
    pub screen_height: Option<u32>,
    pub device_pixel_ratio: Option<f32>, // Number (TS) -> f32 (Rust)
    pub user_agent: Option<String>,
    pub user_agent_client_hints: Option<UserAgentClientHints>,
    pub connection_type: Option<String>,
    pub effective_connection_type: Option<String>,
    pub rtt: Option<u32>,
    pub downlink: Option<f32>, // Number (TS) -> f32 (Rust)
    pub save_data: Option<bool>,
    pub hardware_concurrency: Option<u32>,
    pub device_memory: Option<f32>, // Number (TS) -> f32 (Rust)
    pub js_heap_size_limit: Option<u64>,
    pub total_js_heap_size: Option<u64>,
    pub used_js_heap_size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Breadcrumb {
    pub timestamp: String,
    #[serde(rename = "type")] // Explicitly rename "type" to "breadcrumb_type"
    pub breadcrumb_type: BreadcrumbType,
    pub message: String,
    pub data: Option<serde_json::Value>, // Maps to JsonObject
}

// ElementInfo and CoordsInfo are defined here for completeness of types,
// but they are NOT direct fields of LogEntry in the payload.
// They are nested within the `context` field.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementInfo {
    pub tag_name: Option<String>,
    pub id: Option<String>,
    pub class_name: Option<String>,
    pub text_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CoordsInfo {
    pub x: f64,
    pub y: f64,
}

// --- Main LogEntry Struct ---
#[derive(Debug, Serialize, Deserialize, Validate)]
#[serde(rename_all = "camelCase")] // Apply camelCase deserialization to all fields
pub struct LogEntry {
    pub id: Option<String>, // Optional string UUID
    pub level: LogLevel,
    #[validate(length(min = 1, message = "Log message cannot be empty"))]
    pub message: String,
    pub timestamp: String,
    pub service: String,

    pub context: Option<LogContext>, // Optional, flexible JSON object

    #[serde(default)] // Use default (empty HashMap) if missing in JSON
    pub global_context: LogContext,

    pub user_context: Option<LogContext>, // Can be null or an object

    pub user: Option<UserInfo>,               // Optional User object
    pub device: Option<DeviceInfo>,           // NOW OPTIONAL: Based on TS definition `device?:`
    pub breadcrumbs: Option<Vec<Breadcrumb>>, // NOW OPTIONAL: Based on TS definition `breadcrumbs?:`

    pub error_name: Option<String>,
    pub stack: Option<String>,
    pub reason: Option<serde_json::Value>, // Optional, flexible JSON value

    pub request_method: Option<String>,
    pub request_url: Option<String>,
    pub status_code: Option<u16>,
    pub status_text: Option<String>,
    pub duration_ms: Option<u64>,
    pub response_size: Option<u64>,
    pub error_message: Option<String>,
    // REMOVED: `element` and `coords` as top-level fields from LogEntry struct.
    // They are correctly observed to be nested inside `context` in the actual payloads.
    // If you need to access them, you'd do so by parsing the `context` LogContext.
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse {
    pub status: String,
    pub message: String,
}

impl LogEntry {
    /// Applies PII masking to sensitive fields within the log entry. [20, 18, 21]
    /// This is a basic example; a real-world implementation would use more sophisticated
    /// and configurable redaction rules.
    pub fn mask_pii(&mut self) {
        // Example: Mask email addresses in the message
        let email_regex = Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
            .expect("Invalid email regex");
        self.message = email_regex.replace_all(&self.message, "").to_string();

        // Recursively mask sensitive data in context if it's a string
        if let Some(context) = self.context.as_mut() {
            for (_key, value) in context.iter_mut() {
                if let serde_json::Value::String(s) = value {
                    *s = email_regex.replace_all(s, "").to_string();
                    // Add more regex for other PII types (SSN, credit card numbers, etc.) [18]
                }
            }
        }
    }
}
