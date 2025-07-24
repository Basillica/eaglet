# Awesome Log Monitoring System

This project comprises a client-side log collection and processing module, a reactive log dashboard built with SolidJS and Tailwind CSS, and a foundational Docker Compose setup for deployment orchestration. The goal is to provide a robust solution for capturing, persisting, and visualizing application logs directly from the client side.

## Table of Contents

1.  [Overall Architecture](#1-overall-architecture)
2.  [Frontend: Log Dashboard (SolidJS & Tailwind CSS)](#2-frontend-log-dashboard-solidjs--tailwind-css)
    * [Purpose](#21-purpose)
    * [Project Setup](#22-project-setup)
3.  [LogCollector Module (Client-Side Log Processing)](#3-logcollector-module-client-side-log-processing)
    * [Purpose](#31-purpose)
    * [Core Files](#32-core-files)
    * [Key Features & Concepts](#33-key-features--concepts)
    * [How to Use (API Reference)](#34-how-to-use-api-reference)
4.  [Database Integration (IndexedDB Persistence)](#4-database-integration-indexeddb-persistence)
    * [Purpose](#41-purpose)
    * [Implementation](#42-implementation)
    * [Integration with LogCollector](#43-integration-with-logcollector)
5.  [Docker Compose Setup](#5-docker-compose-setup)
    * [Purpose](#51-purpose)
    * [Service Breakdown (`docker-compose.yml`)](#52-service-breakdown-docker-composeyml)
    * [`Dockerfile.frontend`](#dockerfilefrontend)
    * [Running with Docker Compose](#53-running-with-docker-compose)
6.  [Future Enhancements](#6-future-enhancements)

---

## 1. Overall Architecture

This project is structured around a decoupled approach:

* **LogCollector Module**: A TypeScript module (potentially an npm package) designed to be integrated into any client-side application. It captures, processes (sampling, PII masking), and persists logs locally (IndexedDB/LocalStorage). It's responsible for batching and sending logs to a remote DSN.
* **Log Dashboard (SolidJS)**: A web-based user interface that currently uses mock data, but is designed to eventually visualize logs either by querying a backend or by demonstrating the capabilities of the LogCollector's data structures.
* **Database Integration (IndexedDB)**: Provides robust offline persistence for logs collected by the `LogCollector` module, ensuring logs are not lost even if the user goes offline or navigates away.
* **Docker Compose**: An orchestration tool to define and run multi-container Docker applications, facilitating easy setup and deployment of the entire system (frontend and potential backend services).

## 2. Frontend: Log Dashboard (SolidJS & Tailwind CSS)

### 2.1 Purpose

The Log Dashboard provides a dynamic and interactive user interface for viewing application logs. It's built with SolidJS for high performance and reactivity, and styled exclusively with Tailwind CSS for rapid and consistent UI development. It features search, filtering by log level and service, and a "load more" pagination mechanism.

### 2.2 Project Setup

This frontend component is set up as a standard SolidJS project using Vite.

1.  **Node.js Installation**: Ensure you have Node.js (v18+) and npm/yarn installed.
2.  **Project Initialization**:
    ```bash
    cd eagle-test
    npm install
    npm start
    ```

## 3. LogCollector Module (Client-Side Log Processing)
### 3.1 Purpose
The `LogCollector` is a robust client-side module designed to capture, process, and efficiently send application logs to a backend DSN (Data Source Name). It incorporates advanced features like batching, circuit breaking, rate limiting, log level sampling, PII masking, and offline persistence to ensure reliable and compliant log collection.

### 3.2 Core Files

All TypeScript interfaces and types for the log collector configuration and log entries:

```typescript
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'critical';

export interface LogContext { /* ... */ }
export interface Breadcrumb { /* ... */ }
export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    // ... more log entry fields ...
}

export interface LogCollectorConfig {
    dsn: string;
    apiKey?: string;
    debug?: boolean;
    batchSize?: number;
    batchInterval?: number;
    // ... more config options (circuit breaker, sampling, PII, etc.) ...
}
```

```typescript
import { LogEntry } from './types';

interface DBConfig { dbName: string; storeName: string; version: number; }

export class IndexedDBStore {
    private db: IDBDatabase | null = null;
    private config: DBConfig;
    private dbOpenPromise: Promise<IDBDatabase> | null = null;

    constructor(dbName: string, storeName: string, version: number = 1) { /* ... initialization ... */ }
    private async openDb(): Promise<IDBDatabase> { /* ... IndexedDB opening and upgrade logic ... */ }
    public async addLogs(logs: LogEntry[]): Promise<void> { /* ... add logs to store ... */ }
    public async getLogs(count: number): Promise<LogEntry[]> { /* ... retrieve logs from store ... */ }
    public async deleteLogs(ids: string[]): Promise<void> { /* ... delete logs by ID ... */ }
    // ... other methods like clear, count ...
}
```

### 3.3 Key Features & Concepts
* Client-side Log Capture: Seamlessly integrates into web applications to capture logs (console, network, custom events).

* Batching: Reduces network overhead by sending multiple log entries in a single request.

* Circuit Breaker Pattern: Enhances system resilience by gracefully handling backend outages.

* Rate Limiting: Protects your backend from excessive log volume from a single client.

* Log Level Sampling: Configurable percentage-based sampling for different log levels to manage data volume.

* PII Masking: Custom client-side function to sanitize sensitive data before transmission.

* Contextual Data: Enriches logs with dynamic global, user, device, and breadcrumb information.

* Offline Persistence: Leverages IndexedDB for reliable storage of logs that are yet to be sent.


### 3.4 How to Use (API Reference)
To use the LogCollector in your client application (e.g., in main.ts or App.tsx if standalone):

```typescript
// Example usage in an application
import { LogCollector, LogEntry } from './log-collector/src'; // Adjust path

// Example PII masking function
function clientSidePIIMasking(logEntry: LogEntry): LogEntry | null { /* ... masking logic ... */ return maskedEntry; }

const logger = new LogCollector({
    apiKey: "YOUR_API_KEY",
    dsn: 'http://localhost:3000/logs',
    batchSize: 20,
    batchInterval: 5000,
    samplingRates: { 'debug': 0.1, 'info': 0.5, 'warn': 1.0, 'error': 1.0, 'fatal': 1.0, 'critical': 1.0, },
    maxLogsPerMinute: 500,
    enableIndexedDB: true,
    indexedDBName: 'myAppLogsDB',
    indexedDBStoreName: 'logs',
    indexedDBVersion: 1,
    beforeSend: clientSidePIIMasking,
    onSendSuccess: (logsSent) => console.log(`Successfully sent ${logsSent.length} logs.`),
    onSendFailure: (error, logsFailed) => console.error('Failed to send logs:', error, logsFailed),
    getGlobalContext: () => ({ /* ... */ }),
    getUserContext: () => { /* ... */ return null; },
    circuitBreakerThreshold: 3,
    circuitResetDelay: 60000,
});

// Example logging
logger.info("Application started.");
logger.debug("Debug information about a component.");
logger.warn("Deprecated API call detected.", { apiPath: '/old/endpoint' });
try { /* ... */ } catch (e) { logger.error("An unhandled exception occurred!", e as Error, { customData: "more info" }); }
logger.critical("Database connection lost! Immediate action required.");

// Manually add breadcrumbs
logger.addBreadcrumb({ type: 'click', message: 'User clicked login button' });
logger.addBreadcrumb({ type: 'navigation', message: 'Navigated to /dashboard' });

// Simulate changing config
setTimeout(() => {
    console.log("Updating LogCollector configuration...");
    logger.updateConfig({ batchSize: 20, samplingRates: { 'info': 0.8 }, maxLogsPerMinute: 100 });
    // ...
}, 10000);
```

## 4. Database Integration (IndexedDB Persistence)
### 4.1 Purpose
The `IndexedDBStore` provides a robust client-side storage mechanism for logs. Its primary purpose is to ensure that log entries are not lost due to network unavailability, browser crashes, or page navigation before they can be sent to the backend. It acts as a reliable buffer for the LogCollector.

### 4.2 Implementation
The `IndexedDBStore` class is a Promise-based wrapper around the browser's native IndexedDB API.

`Constructor`: Initializes the store with a database name, object store name, and version. It includes a check for IndexedDB browser support.

`openDb()`: An asynchronous method that opens the IndexedDB connection. It handles database creation and upgrades, defining the object store (e.g., 'logs') and its key path ('id'). It ensures only one database connection promise is active at a time.

`addLogs(logs: LogEntry[])`: Asynchronously adds an array of LogEntry objects to the IndexedDB store. Uses a transaction for atomic operations.

`getLogs(count: number)`: Asynchronously retrieves a specified number of log entries from the store. Logs are fetched in order of insertion.

`deleteLogs(ids: string[])`: Asynchronously deletes log entries from the store based on their IDs. Uses a transaction for efficiency.

### 4.3 Integration with LogCollector
The LogCollector class (`in collector.ts`) utilizes IndexedDBStore when enableIndexedDB is set to true in its configuration.

Logs are first attempted to be sent to the DSN.

If sending fails (e.g., network error, circuit open), or if the client is offline, logs are automatically persisted to IndexedDB by the LogCollector.

The LogCollector periodically attempts to retrieve and send logs from IndexedDB, clearing them from the store upon successful transmission.


## 5. Docker Compose Setup
### 5.1 Purpose
docker-compose.yml allows you to define and run multi-container Docker applications. For this project, it orchestrates the frontend development server (`served via Nginx`) and provides a placeholder for a future log ingestion backend, allowing for a complete, isolated development environment.

### 5.2 Service Breakdown (docker-compose.yml)
Create a `docker-compose.yml` file in your project root:

```yaml
# docker-compose.yml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.frontend
    ports:
      - "80:80"
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/dist
    command: npm run dev -- --host 0.0.0.0 # Or production build command: sh -c "npm run build && nginx -g 'daemon off;'"

  # Log Ingestion Backend Service (Placeholder)
  log-backend:
    image: node:18-alpine
    working_dir: /app
    ports:
      - "3000:3000"
    volumes:
      - ./log-backend:/app
    command: sh -c "echo 'Log backend placeholder running on port 3000' && sleep infinity"
    environment:
      - NODE_ENV=development
      - LOG_DSN_ENDPOINT=/logs

volumes:
  frontend_node_modules:
  frontend_dist:
```

Inside your frontend/ directory, create Dockerfile.frontend:

```yaml
# frontend/Dockerfile.frontend
# Stage 1: Build the SolidJS application
FROM node:18-alpine as builder
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve the application with Nginx (for production build)
FROM nginx:alpine as production
COPY --from=builder /app/dist /usr/share/nginx/html
# COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 5.3 Running with Docker Compose
From your project root (`where docker-compose.yml is located`):

1. Build and start services:

```bash
docker compose up --build
```
   *  **--build** ensures your Docker images are rebuilt.

2. Access the frontend: Open your browser to http://localhost/.

3. Stop services:

```bash
docker compose down
```

## 6. Future Enhancements
This project provides a strong foundation, but several enhancements can be considered:

* Actual Backend Log Ingestion: Develop the log-backend service (e.g., using Node.js, Express, Fastify) to receive logs from the LogCollector and store them in a database (e.g., PostgreSQL, MongoDB, ElasticSearch).

* Real-time Log Display: Implement WebSockets or Server-Sent Events (SSE) in the LogDashboard to display incoming logs in real-time.

* Advanced UI Features:

    * Time range selection for logs.

    * Live tailing.

    * Log aggregation and charting (e.g., logs per service, errors over time).

    * User authentication and authorization.

    * Download log export.

* LogCollector Enhancements:

    * More sophisticated PII detection and masking (e.g., regex-based patterns).

    * Integration with other external loggers (e.g., console overrides).

    * Web Worker usage for heavy processing to avoid blocking the main thread.

* Error Boundaries: Implement SolidJS Error Boundaries for graceful handling of rendering errors in the UI.

* Testing: Add comprehensive unit, integration, and end-to-end tests for both the LogCollector and the LogDashboard.

* CI/CD Pipeline: Automate building, testing, and deployment of the frontend and backend services.

* Deployment: Configure production deployment to a cloud provider (AWS, GCP, Azure) using Docker Swarm or Kubernetes.