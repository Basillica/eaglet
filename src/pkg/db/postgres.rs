use sqlx::{postgres::PgPoolOptions, Pool, Postgres};
use tracing::info;
use std::time::Duration;
use crate::models;
use serde_json::Value as JsonValue;

/// Establishes a connection pool to the PostgreSQL database.
pub async fn get_db_pool(database_url: &str) -> Result<Pool<Postgres>, sqlx::Error> {
    info!("Attempting to connect to PostgreSQL at: {}", database_url);
    PgPoolOptions::new()
        .max_connections(50)
        .min_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}

/// Initializes the database schema.
pub async fn initialize_db_schema(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    info!("Initializing PostgreSQL database schema...");

    // Creates the 'logs' table if it doesn't exist.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY NOT NULL,
            level VARCHAR(10) NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL, -- TIMESTAMPTZ for timezone-aware timestamps
            service VARCHAR(255) NOT NULL,
            context JSONB,         -- Stored as JSONB for efficient querying
            global_context JSONB NOT NULL, -- JSONB, not nullable as per your model
            user_context JSONB,
            user_id TEXT,
            user_username VARCHAR(255),
            user_email VARCHAR(255),
            device JSONB,          -- Stored as JSONB
            breadcrumbs JSONB,     -- Stored as JSONB
            error_name VARCHAR(255),
            stack TEXT,
            reason JSONB,
            request_method VARCHAR(10),
            request_url TEXT,
            status_code SMALLINT, -- Fits u16
            status_text VARCHAR(255),
            duration_ms BIGINT,   -- Fits u64
            response_size BIGINT,
            error_message TEXT
        );
        "#
    )
    .execute(pool)
    .await?;

    info!("'logs' table ensured.");

    // 2. Create indexes separately
    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level);"#
    )
    .execute(pool)
    .await?;
    info!("Index 'idx_logs_level' ensured.");

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp);"#
    )
    .execute(pool)
    .await?;
    info!("Index 'idx_logs_timestamp' ensured.");

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service);"#
    )
    .execute(pool)
    .await?;
    info!("Index 'idx_logs_service' ensured.");

    info!("PostgreSQL database schema initialized successfully.");
    Ok(())
}

/// Inserts a batch of log entries into the 'logs' table.
pub async fn insert_log_entries(
    pool: &Pool<Postgres>,
    log_entries: Vec<models::LogEntry>,
) -> Result<(), sqlx::Error> {
    info!("Attempting to insert batch of {} log entries into PostgreSQL.", log_entries.len());

    let mut tx = pool.begin().await?;

    for log in log_entries {
        // Convert LogLevel enum to string for DB storage
        let level_str = match log.level {
            models::LogLevel::Trace => "trace",
            models::LogLevel::Debug => "debug",
            models::LogLevel::Info => "info",
            models::LogLevel::Warn => "warn",
            models::LogLevel::Error => "error",
            models::LogLevel::Fatal => "fatal",
            models::LogLevel::Critical => "critical",
        };

        // SQLx's `json` feature allows direct binding of `serde_json::Value` and structs
        // if they derive Serialize/Deserialize and are compatible with PostgreSQL's JSONB type.
        // Option values will be inserted as NULL if None.
        sqlx::query(
            r#"
            INSERT INTO logs (
                id, level, message, timestamp, service,
                context, global_context, user_context,
                user_id, user_username, user_email,
                device, breadcrumbs,
                error_name, stack, reason,
                request_method, request_url, status_code, status_text, duration_ms, response_size, error_message
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23
            )
            ON CONFLICT (id) DO NOTHING; -- Handle duplicate IDs if any (e.g., retries might send same ID)
            "#
        )
        .bind(log.id)
        .bind(level_str)
        .bind(log.message)
        .bind(log.timestamp)
        .bind(log.service)
        .bind(log.context.map(|c| JsonValue::from(serde_json::to_value(c).unwrap_or_default()))) // Convert HashMap to JsonValue
        .bind(JsonValue::from(serde_json::to_value(log.global_context).unwrap_or_default())) // global_context is not Option
        .bind(log.user_context.map(|uc| JsonValue::from(serde_json::to_value(uc).unwrap_or_default())))
        .bind(log.user.as_ref().and_then(|u| u.id.clone()))
        .bind(log.user.as_ref().and_then(|u| u.username.clone()))
        .bind(log.user.as_ref().and_then(|u| u.email.clone()))
        .bind(log.device.map(|d| JsonValue::from(serde_json::to_value(d).unwrap_or_default()))) // Convert DeviceInfo struct to JsonValue
        .bind(log.breadcrumbs.map(|b| JsonValue::from(serde_json::to_value(b).unwrap_or_default()))) // Convert Vec<Breadcrumb> to JsonValue
        .bind(log.error_name)
        .bind(log.stack)
        .bind(log.reason)
        .bind(log.request_method)
        .bind(log.request_url)
        .bind(log.status_code.map(|s| s as i16)) // Use i16 for SMALLINT
        .bind(log.status_text)
        .bind(log.duration_ms.map(|d| d as i64)) // Use i64 for BIGINT
        .bind(log.response_size.map(|s| s as i64))
        .bind(log.error_message)
        .execute(&mut *tx) // Execute within the transaction
        .await?;
    }
    tx.commit().await?; // Commit the transaction
    info!("Successfully inserted batch of log entries into PostgreSQL.");
    Ok(())
}