import { LogCollector } from "./lib";

export const logger = new LogCollector({
  apiKey: "super_secret_api_key",
  dsn: "http://127.0.0.1:8080/ingest",
  enableIndexedDB: true,
  batchSize: 20,
  batchInterval: 10000, // Every 10 seconds

  samplingRates: {
    debug: 0.1,
    info: 0.5,
    warn: 0.5,
    error: 1.0,
    fatal: 1.0,
    critical: 1.0,
  },

  maxLogsPerMinute: 500,
  enableConsoleCapture: true, // Keep this enabled to capture console output
  enableErrorCapture: true,
  enableNetworkCapture: true,
  enableDOMCapture: true,
  enableNavigationCapture: true,
  // ... any other configurations you need
});