export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'critical';
export type BreadcrumbType = 'click' | 'navigation' | 'xhr' | 'console' | 'custom' | 'error'


export interface LogContext {
    [key: string]: any;
}

export interface Breadcrumb {
    timestamp: string;
    type: BreadcrumbType;
    message: string;
    data?: Record<string, any>;
}

export interface LogEntry {
    id?: string;
    level: LogLevel;
    message: string;
    timestamp: string; // ISO 8601 format
    service: string; // e.g., "frontend-app"
    context?: LogContext; // Additional structured data specific to this log
    globalContext?: LogContext; // Context collected from getGlobalContext
    userContext?: LogContext | null;
    user?: {
        id?: string;
        username?: string;
        email?: string;
    };
    device?: {
        os_name?: string;
        os_version?: string;
        brand?: string;
        model?: string;
        family?: string;
        screen_width?: number;
        screen_height?: number;
        device_pixel_ratio?: number;
        user_agent?: string;
        user_agent_client_hints?: any; // For modern UA Client Hints

        // Network Information
        connection_type?: string; // 'cellular', 'wifi', 'ethernet', 'none', 'unknown' etc.
        effective_connection_type?: 'slow-2g' | '2g' | '3g' | '4g';
        rtt?: number; // Round-trip time in ms
        downlink?: number; // Estimated downlink speed in Mbps
        save_data?: boolean; // User has data saver enabled

        // Hardware Information
        hardware_concurrency?: number; // Number of logical processor cores
        device_memory?: number; // Device RAM in GB (approx)

        // Browser/Runtime Environment (not strictly device, but useful context)
        js_heap_size_limit?: number; // JS heap limit (bytes) - Chrome only, experimental
        total_js_heap_size?: number; // Total JS heap allocated (bytes) - Chrome only, experimental
        used_js_heap_size?: number; // Used JS heap (bytes) - Chrome only, experimental
    };
    breadcrumbs?: Breadcrumb[]; // Trail of recent events
    // For errors
    errorName?: string;
    stack?: string;
    reason?: string; // For unhandled rejections
    // For network logs
    requestMethod?: string;
    requestUrl?: string;
    statusCode?: number;
    statusText?: string;
    durationMs?: number;
    responseSize?: number;
    errorMessage?: string; // For network request errors
    // For DOM (click) logs
    element?: {
        tagName?: string;
        id?: string;
        className?: string;
        textContent?: string;
        // xpath?: string; // More advanced, requires DOM traversal
    };
    coords?: {
        x: number;
        y: number;
    };
}

export interface LogCollectorConfig {
    dsn: string; // Backend ingestion endpoint URL
    apiKey: string; // Optional API Key for authentication

    // Batching & Retries
    batchSize?: number; // Send logs in batches
    batchInterval?: number; // Send logs every X milliseconds
    maxRetries?: number; // Max retries for failed transmissions
    retryDelayMs?: number; // Initial delay for retries (ms, for exponential backoff)

    // Capture Settings
    enableConsoleCapture?: boolean; // Capture console.log, etc.
    enableErrorCapture?: boolean; // Capture window.onerror, unhandledrejection
    enableNetworkCapture?: boolean; // Capture XHR/Fetch requests
    enableDOMCapture?: boolean; // Capture clicks, keypresses
    enableNavigationCapture?: boolean; // Capture history changes

    // Filtering & Masking
    logLevel?: Exclude<LogLevel, 'trace'>; // Minimum level to capture (e.g., 'info' means debug/trace are ignored)
    ignoreUrls?: (string | RegExp)[]; // URLs to exclude from network capture
    ignoreErrors?: (string | RegExp | ((error: Error | string) => boolean))[]; // Error messages/patterns to ignore
    maskFields?: string[]; // Fields to mask in log payloads (e.g., ['password', 'creditCardNumber'])

     // Sampling & Rate Limiting
    samplingRates?: { [key in LogLevel]?: number }; // e.g., { 'debug': 0.1, 'info': 0.5, 'error': 1.0 }
    maxLogsPerMinute?: number; // Max logs to process per client per minute (0 for unlimited)

    // Context & Callbacks
    beforeSend?: (logEntry: LogEntry) => LogEntry | null; // Allow modifying or dropping logs before sending
    beforeBreadcrumb?: (breadcrumb: Breadcrumb) => Breadcrumb | null; // Allow modifying or dropping breadcrumbs
    onSendSuccess?: (logsSent: LogEntry[]) => void;
    onSendFailure?: (error: any, logsFailed: LogEntry[]) => void;
    getGlobalContext?: () => LogContext; // Dynamic global context
    getUserContext?: () => LogContext | null; // Dynamic user context

    // Persistence
    enableLocalStorage?: boolean; // Use localStorage as a fallback for sendBeacon or for persistence
    localStorageKey?: string; // Key for storing logs in localStorage
    maxLocalStorageSize?: number; // Max size for localStorage (bytes)
    enableIndexedDB?: boolean; // Use IndexedDB for more robust offline persistence
    indexedDBName?: string;
    indexedDBStoreName?: string;
    indexedDBVersion?: number;

    // Breadcrumb settings
    maxBreadcrumbs?: number; // Maximum number of breadcrumbs to store
    breadcrumbBufferInterval?: number; // Debounce interval for certain breadcrumbs (e.g., clicks)
}