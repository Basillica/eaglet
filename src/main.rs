use actix_web::{get, middleware, post, web, App, HttpResponse, HttpServer, Responder};
use std::{sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tracing::{error, info, instrument, warn};
use tracing_subscriber::{EnvFilter, FmtSubscriber};
use validator::Validate;
use sqlx::{Pool, Postgres};

mod pkg;
mod models;

// Define a type for the queue sender
type LogQueueSender = mpsc::Sender<Vec<models::LogEntry>>;

// Application state to hold the queue sender
struct AppState {
    log_queue_tx: LogQueueSender,
}

// --- Background Log Processor Task ---
async fn background_log_processor(mut receiver: mpsc::Receiver<Vec<models::LogEntry>>, db_pool: Arc<Pool<Postgres>>) {
    info!("Background log processor started.");
    loop {
        match receiver.recv().await {
            Some(log_batch) => {
                info!(
                    "Background processor received batch of {} logs.",
                    log_batch.len()
                );

                if let Err(e) = pkg::db::postgres::insert_log_entries(&db_pool, log_batch).await {
                    error!("Failed to insert log entries into PostgreSQL: {:?}", e);
                } else {
                    info!("Successfully persisted logs to PostgreSQL.");
                }
            }
            None => {
                // Sender dropped, no more messages will be sent.
                info!("Background log processor shutting down: all senders dropped.");
                break;
            }
        }
    }
}

#[post("/ingest")]
#[instrument(skip(log_entries, app_data), fields(count = log_entries.len()))]
async fn ingest_log_batch(
    log_entries: web::Json<Vec<models::LogEntry>>,
    app_data: web::Data<AppState>,
) -> impl Responder {
    let log_length = log_entries.len();
    info!("Received batch of {} log entries.", log_length);

    // Validate entries before queuing
    let mut valid_log_entries = Vec::with_capacity(log_length);
    for log_entry in log_entries.into_inner() {
        if let Err(errors) = log_entry.validate() {
            error!("Log validation failed for an entry: {:?}", errors);
            continue; // Skip invalid entries
        }
        // if mask_pii is enabled
        let mut processed_log_entry = log_entry;
        processed_log_entry.mask_pii();
        valid_log_entries.push(processed_log_entry);
    }

    if valid_log_entries.is_empty() {
        warn!("No valid log entries in the received batch after validation.");
        return HttpResponse::BadRequest().json(models::ApiResponse {
            status: "failed".to_string(),
            message: "No valid log entries found in batch".to_string(),
        });
    }

    // Try to send the batch to the background processor
    match app_data.log_queue_tx.send(valid_log_entries).await {
        Ok(_) => {
            info!(
                "Successfully queued {} log entries for background processing.",
                log_length
            );
            HttpResponse::Ok().json(models::ApiResponse {
                status: "success".to_string(),
                message: format!(
                    "Received and queued {} log entries for processing",
                    log_length
                ),
            })
        }
        Err(e) => {
            error!("Failed to send log entries to queue: {:?}", e);
            HttpResponse::InternalServerError().json(models::ApiResponse {
                status: "error".to_string(),
                message: "Failed to queue logs for processing".to_string(),
            })
        }
    }
}

// --- Basic Health Check Endpoint ---
#[get("/health")]
async fn health_check() -> impl Responder {
    HttpResponse::Ok().body("Service is healthy!")
}

// --- Main Application Entry Point ---
#[tokio::main] // This macro sets up the Tokio runtime for Actix Web [1]
async fn main() -> std::io::Result<()> {
    // Initialize tracing for structured logging [16]
    FmtSubscriber::builder()
        .with_env_filter(EnvFilter::from_default_env()) // Use RUST_LOG env var
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("Starting log ingestion backend service...");

    let database_url = "postgresql://app_user:mysecretpassword@localhost:5432/logs_db";
    let server_address = "127.0.0.1:8080";

    let db_pool = match pkg::db::postgres::get_db_pool(database_url).await {
        Ok(pool) => {
            info!("PostgreSQL connection pool established.");
            pool
        },
        Err(e) => {
            error!("Failed to connect to PostgreSQL: {:?}", e);
            return Err(std::io::Error::new(std::io::ErrorKind::Other, format!("DB connection failed: {}", e)));
        }
    };

    let db_pool = Arc::new(db_pool);
    // Initialize the database schema (create table if not exists)
    if let Err(e) = pkg::db::postgres::initialize_db_schema(&db_pool).await {
        error!("Failed to initialize PostgreSQL schema: {:?}", e);
        return Err(std::io::Error::new(std::io::ErrorKind::Other, format!("DB schema init failed: {}", e)));
    }

    // 1. Create the MPSC channel for the log queue
    // Adjust buffer size as needed. A larger buffer means more memory usage,
    // but can absorb higher bursts.
    let (log_queue_tx, log_queue_rx) = mpsc::channel::<Vec<models::LogEntry>>(1000);

    // 2. Spawn the background log processor task
    tokio::spawn(background_log_processor(log_queue_rx, db_pool.clone()));
    info!("Background log processor task spawned.");

    // Configure rate limiting: 10 requests per second per IP, with a burst of 5 [12]

    info!("Actix Web server starting at http://{}", server_address);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(AppState {
                log_queue_tx: log_queue_tx.clone(),
            }))
            .wrap(middleware::Logger::default()) // Enable Actix's request logger
            .wrap(pkg::middleware::rate_limiter::RateLimiter::new(
                Duration::from_secs(10),
                25,
            ))
            .wrap(middleware::DefaultHeaders::new().add(("X-XSS-Protection", "1; mode=block")))
            .wrap(middleware::Compress::default())
            .wrap(pkg::middleware::cors::cors_middleware())
            .wrap(middleware::NormalizePath::trim())
            .service(ingest_log_batch)
            .service(health_check)
    })
    .bind(server_address)?
    .run()
    .await
}
