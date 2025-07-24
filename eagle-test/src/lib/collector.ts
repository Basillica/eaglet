import { LogCollectorConfig, LogEntry, LogLevel, LogContext, Breadcrumb } from './types';
import { IndexedDBStore } from './store';

// Utility for debouncing
export function debounce<T extends (...args: any) => void>(func: T, delay: number): T {
    let timeout: ReturnType<typeof setTimeout>;
    return function(this: any, ...args: Parameters<T>) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    } as T;
}

// Utility for throttling
export function throttle<T extends (...args: any) => void>(func: T, limit: number): T {
    let inThrottle: boolean;
    let lastResult: any;
    return function(this: any, ...args: Parameters<T>) {
        if (!inThrottle) {
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
            lastResult = func.apply(this, args);
        }
        return lastResult;
    } as T;
}

// Helper to check if a URL matches any pattern in an array
export function matchesUrl(url: string, patterns: (string | RegExp)[]): boolean {
    return patterns.some(pattern => {
        if (typeof pattern === 'string') {
            return url.includes(pattern);
        }
        return pattern.test(url);
    });
}

// Helper to check if an error message matches any pattern/function
export function matchesError(error: Error | string, patterns: (string | RegExp | ((error: Error | string) => boolean))[]): boolean {
    const errorMessage = typeof error === 'string' ? error : error.message;
    return patterns.some(pattern => {
        if (typeof pattern === 'string') {
            return errorMessage.includes(pattern);
        }
        if (pattern instanceof RegExp) {
            return pattern.test(errorMessage);
        }
        if (typeof pattern === 'function') {
            return pattern(error);
        }
        return false;
    });
}

// Simple UUID generator (moved here for collector's use, or use a library)
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0,
            v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export class LogCollector {
    private config: Required<LogCollectorConfig>;
    private logQueue: LogEntry[] = [];
    private _breadcrumbs: Breadcrumb[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private isSending: boolean = false;

    // Circuit Breaker State
    private circuitOpen: boolean = false;
    private consecutiveFailures: number = 0;
    private circuitResetTimer: ReturnType<typeof setTimeout> | null = null;
    private CIRCUIT_BREAKER_THRESHOLD = 5;
    private CIRCUIT_BREAKER_RESET_DELAY = 60000;

    // Local Rate Limiting State
    private logCounts: { [minute: number]: number } = {};
    private currentMinute: number = 0;
    private rateLimitTimer: ReturnType<typeof setTimeout> | null = null;

    private originalConsoleMethods!: { [key: string]: (...args: any) => void };
    private originalXHRopen!: XMLHttpRequest['open'];
    private originalXHRsend!: XMLHttpRequest['send'];
    private originalFetch!: typeof window.fetch;
    private originalPushState!: typeof history.pushState;
    private originalReplaceState!: typeof history.replaceState;

    private localStorageStore: Storage | null = null;
    private indexedDBStore: IndexedDBStore | null = null;

    constructor(config: LogCollectorConfig) {
        // Initialize with defaults and merge provided config
        this.config = {
            batchSize: 10,
            batchInterval: 5000,
            maxRetries: 3,
            retryDelayMs: 1000,
            enableConsoleCapture: true,
            enableErrorCapture: true,
            enableNetworkCapture: true,
            enableDOMCapture: true,
            enableNavigationCapture: true,
            logLevel: 'info',
            ignoreUrls: [],
            ignoreErrors: [],
            maskFields: [],
            samplingRates: {},
            maxLogsPerMinute: 0,
            beforeSend: (logEntry) => logEntry,
            beforeBreadcrumb: (breadcrumb) => breadcrumb,
            onSendSuccess: () => {},
            onSendFailure: () => {},
            getGlobalContext: () => ({}),
            getUserContext: () => null,
            enableLocalStorage: false,
            localStorageKey: 'log_collector_queue',
            maxLocalStorageSize: 5 * 1024 * 1024,
            enableIndexedDB: false,
            indexedDBName: 'LogCollectorDB',
            indexedDBStoreName: 'applogs',
            indexedDBVersion: 1,
            maxBreadcrumbs: 50,
            breadcrumbBufferInterval: 300,
            ...config,
        };

        if (!this.config.dsn) {
            console.warn("LogCollector: DSN is not configured. Logs will not be sent.");
        }

        // Initialize persistence stores
        if (this.config.enableIndexedDB && typeof indexedDB !== 'undefined') {
            this.indexedDBStore = new IndexedDBStore(
                this.config.indexedDBName,
                this.config.indexedDBStoreName,
                this.config.indexedDBVersion
            );
            this.loadLogsFromPersistence();
        } else if (this.config.enableLocalStorage && typeof localStorage !== 'undefined') {
            this.localStorageStore = localStorage;
            this.loadLogsFromLocalStorage();
        }

        this.setupCaptures();
        this.startBatchTimer();
        this.setupUnloadHandler();

        // Initialize rate limiting
        if (this.config.maxLogsPerMinute > 0) {
            this.initRateLimiter();
        }
    }

    /**
     * Dynamically updates the LogCollector's configuration.
     * Changes to batching or rate limiting will take effect on the next cycle.
     * Note: Enabling/disabling captures (e.g., enableConsoleCapture) will require a re-initialization
     * of the specific capture method if it was already set up. For simplicity,
     * this method primarily affects filtering, sampling, and batching parameters.
     * @param newConfig Partial new configuration to apply.
     */
    public updateConfig(newConfig: Partial<LogCollectorConfig>) {
        const oldLogLevel = this.config.logLevel;
        const oldMaxLogsPerMinute = this.config.maxLogsPerMinute;

        this.config = { ...this.config, ...newConfig };

        console.log("LogCollector: Configuration updated.", newConfig);

        // Restart batch timer if interval or batch size changed
        if (newConfig.batchInterval !== undefined || newConfig.batchSize !== undefined) {
            this.startBatchTimer();
        }

        // Re-initialize rate limiter if its settings changed
        if (newConfig.maxLogsPerMinute !== undefined && newConfig.maxLogsPerMinute !== oldMaxLogsPerMinute) {
            if (this.rateLimitTimer) {
                clearInterval(this.rateLimitTimer);
                this.rateLimitTimer = null;
            }
            if (this.config.maxLogsPerMinute > 0) {
                this.initRateLimiter();
            }
        }

        // If log level changed, perhaps re-evaluate existing queues (optional, generally not needed)
        // For simplicity, we assume new log levels apply to *new* logs or *next* flush.
    }

    private setupUnloadHandler() {
        window.addEventListener('beforeunload', async () => {
            if (this.logQueue.length > 0 && this.indexedDBStore) {
                // Assign UUIDs to pending logs before saving to IndexedDB on unload
                this.logQueue.forEach(log => {
                    if (!log.id) {
                        log.id = generateUUID();
                    }
                });
                await Promise.all(this.logQueue.map(log => this.indexedDBStore!.addLog(log)))
                    .catch(e => console.error("LogCollector: Error saving pending logs to IndexedDB on unload", e));
                this.logQueue = [];
            }

            if (this.indexedDBStore && !this.isSending) {
                const logsToSendFromDB = await this.indexedDBStore.getAllLogs().catch(() => []);
                if (logsToSendFromDB.length > 0 && navigator.sendBeacon && this.config.dsn) {
                    const payload = JSON.stringify(logsToSendFromDB);
                    if (payload.length < 60 * 1024) { // sendBeacon limit is typically 64KB
                        const success = navigator.sendBeacon(this.config.dsn, payload);
                        if (success) {
                            console.log('LogCollector: Logs sent via navigator.sendBeacon on unload.');
                            const sentIds = logsToSendFromDB.map(log => log.id).filter((id): id is string => id !== undefined); // Changed to string
                            if (sentIds.length > 0) {
                                this.indexedDBStore.deleteLogs(sentIds).catch(e => console.error("Error clearing sent logs from DB", e));
                            }
                            return;
                        } else {
                            console.warn('LogCollector: navigator.sendBeacon failed to queue data on unload. Falling back to fetch.');
                        }
                    } else {
                        console.warn('LogCollector: Logs too large for sendBeacon on unload. Falling back to fetch with keepalive.');
                    }
                }
            }
            // Always try to flush remaining queue if sendBeacon failed or not used, with keepalive
            this.flushQueue(0, true);
        });
    }

    private setupCaptures() {
        if (this.config.enableConsoleCapture) {
            this.wrapConsoleMethods();
        }
        if (this.config.enableErrorCapture) {
            this.captureUnhandledErrors();
        }
        if (this.config.enableNetworkCapture) {
            this.wrapNetworkRequests();
        }
        if (this.config.enableDOMCapture) {
            this.captureDOMEvents();
        }
        if (this.config.enableNavigationCapture) {
            this.captureNavigationEvents();
        }
    }

    // --- Breadcrumbs ---
    private addBreadcrumb(type: Breadcrumb['type'], message: string, data?: Record<string, any>) {
        let breadcrumb: Breadcrumb = {
            timestamp: new Date().toISOString(),
            type,
            message,
            data,
        };

        if (this.config.beforeBreadcrumb) {
            const modifiedBreadcrumb = this.config.beforeBreadcrumb(breadcrumb);
            if (!modifiedBreadcrumb) {
                return;
            }
            breadcrumb = modifiedBreadcrumb;
        }

        this._breadcrumbs.push(breadcrumb);
        if (this._breadcrumbs.length > this.config.maxBreadcrumbs) {
            this._breadcrumbs.shift();
        }
    }

    // --- Console Capturing ---
    private wrapConsoleMethods() {
        const methods: Array<Exclude<LogLevel, 'fatal' | 'critical'>> = ['info', 'warn', 'error', 'debug', 'trace'];
        this.originalConsoleMethods = {};
        methods.forEach(level => {
            if (typeof console[level] === 'function') {
                this.originalConsoleMethods[level] = console[level] as (...args: any) => void;
                (console as any)[level] = (...args: any) => {
                    this.captureLog(level, args);
                    this.addBreadcrumb('console', `Console ${level}: ${this.formatArgsForBreadcrumb(args)}`);
                    this.originalConsoleMethods[level].apply(console, args);
                };
            }
        });
    }

    private formatArgsForBreadcrumb(args: any[]): string {
        return args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ').substring(0, 200);
    }


    // --- Error Capturing ---
    private captureUnhandledErrors() {
        window.onerror = (message, source, lineno, colno, error) => {
            if (error && matchesError(error, this.config.ignoreErrors)) {
                return false;
            }
            this.captureLog('error', [`Unhandled Error: ${message}`], {
                source,
                lineno,
                colno,
                errorName: error?.name || 'UnknownError',
                stack: error?.stack || 'N/A',
            });
            this.addBreadcrumb('error', `Unhandled Error: ${message}`, { source, lineno, colno });
            return false;
        };

        window.onunhandledrejection = (event) => {
            const reason = event.reason;
            if (reason instanceof Error && matchesError(reason, this.config.ignoreErrors)) {
                event.preventDefault();
                return;
            } else if (typeof reason === 'string' && matchesError(reason, this.config.ignoreErrors)) {
                event.preventDefault();
                return;
            }

            this.captureLog('error', [`Unhandled Promise Rejection:`], {
                reason: reason ? String(reason) : 'N/A',
                promise: event.promise ? String(event.promise) : 'N/A',
                stack: reason instanceof Error ? reason.stack : undefined,
                errorName: reason instanceof Error ? reason.name : 'UnhandledRejection',
            });
            this.addBreadcrumb('error', `Unhandled Promise Rejection: ${reason ? String(reason).substring(0, 100) : 'N/A'}`);
            event.preventDefault();
        };
    }

    // --- Network Capturing ---
    private wrapNetworkRequests() {
        const self = this;

        this.originalXHRopen = XMLHttpRequest.prototype.open;
        this.originalXHRsend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async?: boolean, user?: string, password?: string) {
            const urlString = String(url);
            if (matchesUrl(urlString, self.config.ignoreUrls)) {
                (this as any)._skipCapture = true;
            }
            (this as any)._method = method;
            (this as any)._url = urlString;
            (this as any)._startTime = performance.now();
            return self.originalXHRopen.apply(this, [method, url, async!, user, password]);
        };

        XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
            if ((this as any)._skipCapture) {
                return self.originalXHRsend.apply(this, [body]);
            }

            this.addEventListener('loadend', () => {
                const durationMs = performance.now() - (this as any)._startTime;
                self.captureLog('info', [`XHR Loadend: ${(this as any)._method} ${(this as any)._url}`], {
                    requestMethod: (this as any)._method,
                    requestUrl: (this as any)._url,
                    statusCode: this.status,
                    statusText: this.statusText,
                    responseSize: this.responseText?.length,
                    durationMs: durationMs,
                });
                self.addBreadcrumb('xhr', `XHR: ${(this as any)._method} ${(this as any)._url} ${this.status}`, {
                    method: (this as any)._method,
                    url: (this as any)._url,
                    status: this.status,
                    durationMs: durationMs,
                });
            });
            this.addEventListener('error', () => {
                const durationMs = performance.now() - (this as any)._startTime;
                self.captureLog('error', [`XHR Error: ${(this as any)._method} ${(this as any)._url}`], {
                    requestMethod: (this as any)._method,
                    requestUrl: (this as any)._url,
                    statusCode: this.status,
                    statusText: this.statusText,
                    durationMs: durationMs,
                    errorMessage: 'XHR Failed',
                });
                self.addBreadcrumb('xhr', `XHR Error: ${(this as any)._method} ${(this as any)._url}`, {
                    method: (this as any)._method,
                    url: (this as any)._url,
                    durationMs: durationMs,
                    status: this.status,
                });
            });
            return self.originalXHRsend.apply(this, [body]);
        };

        this.originalFetch = window.fetch;
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const method = init?.method || 'GET';
            const url = input instanceof Request ? input.url : String(input);

            if (matchesUrl(url, self.config.ignoreUrls)) {
                return self.originalFetch.bind(window)(input, init);
            }

            const startTime = performance.now();

            try {
                // Use the bound originalFetch here
                const response = await self.originalFetch.bind(window)(input, init);
                const endTime = performance.now();
                const durationMs = endTime - startTime;
                self.captureLog('info', [`Fetch Success: ${method} ${url}`], {
                    requestMethod: method,
                    requestUrl: url,
                    statusCode: response.status,
                    statusText: response.statusText,
                    responseSize: response.headers.get('content-length') ? parseInt(response.headers.get('content-length')!) : undefined, // Added responseSize
                    durationMs: durationMs,
                });
                self.addBreadcrumb('xhr', `Fetch: ${method} ${url} ${response.status}`, {
                    method, url, status: response.status, durationMs
                });
                return response;
            } catch (error: any) {
                const endTime = performance.now();
                const durationMs = endTime - startTime;
                self.captureLog('error', [`Fetch Error: ${method} ${url}`], {
                    requestMethod: method,
                    requestUrl: url,
                    durationMs: endTime - startTime,
                    errorMessage: error.message,
                });
                self.addBreadcrumb('xhr', `Fetch Error: ${method} ${url}`, {
                    method, url, durationMs, errorMessage: error.message
                });
                throw error;
            }
        };
    }

    // --- DOM Capturing ---
    private captureDOMEvents() {
        document.body.addEventListener('click', debounce((event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target && target.tagName) {
                const elementDetails = {
                    tagName: target.tagName,
                    id: target.id,
                    className: target.className,
                    textContent: target.textContent?.substring(0, 100),
                };
                this.captureLog('info', [`DOM Click: ${target.tagName} #${target.id}`], {
                    element: elementDetails,
                    coords: {
                        x: event.clientX,
                        y: event.clientY,
                    },
                });
                this.addBreadcrumb('click', `Clicked ${target.tagName} #${target.id}`, { element: elementDetails });
            }
        }, this.config.breadcrumbBufferInterval));

        document.body.addEventListener('input', debounce((event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target && target.tagName === 'INPUT' && target.type !== 'password') {
                this.addBreadcrumb('custom', `Input changed in ${target.id || target.name || target.tagName}`, {
                    valueLength: target.value.length,
                    type: target.type
                });
            }
        }, this.config.breadcrumbBufferInterval));
    }

    // --- Navigation Capturing ---
    private captureNavigationEvents() {
        const self = this;

        window.addEventListener('popstate', (event) => {
            const url = window.location.href;
            self.captureLog('info', [`Navigation: Popstate to ${url}`], { url, state: event.state });
            self.addBreadcrumb('navigation', `Mapsd (popstate) to ${url}`);
        });

        this.originalPushState = history.pushState;
        history.pushState = function(...args) {
            const url = String(args[2] || window.location.href);
            self.captureLog('info', [`Navigation: pushState to ${url}`], { url, state: args[0] });
            self.addBreadcrumb('navigation', `Mapsd (pushState) to ${url}`);
            return self.originalPushState.apply(this, args);
        };

        this.originalReplaceState = history.replaceState;
        history.replaceState = function(...args) {
            const url = String(args[2] || window.location.href);
            self.captureLog('info', [`Navigation: replaceState to ${url}`], { url, state: args[0] });
            self.addBreadcrumb('navigation', `Mapsd (replaceState) to ${url}`);
            return self.originalReplaceState.apply(this, args);
        };

        window.addEventListener('load', () => {
            const url = window.location.href;
            self.captureLog('info', [`Navigation: Initial Page Load ${url}`], { url });
            self.addBreadcrumb('navigation', `Initial Page Load: ${url}`);
        });
    }

    // --- Device & Environment Info ---
    private getDeviceInfo(): LogEntry['device'] {
        const device: LogEntry['device'] = {};

        if (window.screen) {
            device.screen_width = window.screen.width;
            device.screen_height = window.screen.height;
            device.device_pixel_ratio = window.devicePixelRatio;
        }

        if (navigator.userAgent) {
            device.user_agent = navigator.userAgent;
        }

        // User-Agent Client Hints (more modern and privacy-preserving)
        if ((navigator as any).userAgentData) {
            try {
                // toJSON() provides low-entropy hints like mobile, platform, brands
                device.user_agent_client_hints = (navigator as any).userAgentData.toJSON();
            } catch (e) {
                console.warn("LogCollector: Failed to get userAgentData.toJSON()", e);
            }
        }

        // Network Information API
        if ('connection' in navigator) {
            const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
            if (connection) {
                device.connection_type = connection.type;
                device.effective_connection_type = connection.effectiveType;
                device.rtt = connection.rtt; // Round-trip time in milliseconds
                device.downlink = connection.downlink; // Downlink speed in megabits per second
                device.save_data = connection.saveData; // User has data saver enabled
            }
        }

        // Hardware Concurrency (number of CPU cores)
        if (navigator.hardwareConcurrency !== undefined) {
            device.hardware_concurrency = navigator.hardwareConcurrency;
        }

        // Device Memory (approximate RAM in GB)
        if ((navigator as any).deviceMemory !== undefined) {
            device.device_memory = (navigator as any).deviceMemory;
        }

        // Performance Memory API (Chrome-specific, experimental)
        // Provides info on JavaScript heap sizes. Requires "performance.memory"
        // to be available and not deprecated/removed.
        if (window.performance && (window.performance as any).memory) {
            const mem = (window.performance as any).memory;
            device.js_heap_size_limit = mem.jsHeapSizeLimit;
            device.total_js_heap_size = mem.totalJSHeapSize;
            device.used_js_heap_size = mem.usedJSHeapSize;
        }

        return device;
    }

    // --- Public API for manual log submission ---
    public log(level: LogLevel, message: string, context?: LogContext) {
        this.captureLog(level, [message], context);
    }
    public info(message: string, context?: LogContext) { this.log('info', message, context); }
    public warn(message: string, context?: LogContext) { this.log('warn', message, context); }
    public error(error: Error | string, context?: LogContext) {
        if (error instanceof Error) {
            if (matchesError(error, this.config.ignoreErrors)) return;
            this.captureLog('error', [error.message], {
                ...context,
                errorName: error.name,
                stack: error.stack,
            });
        } else {
            if (matchesError(error, this.config.ignoreErrors)) return;
            this.captureLog('error', [error], context);
        }
    }
    public debug(message: string, context?: LogContext) { this.log('debug', message, context); }
    public trace(message: string, context?: LogContext) { this.log('trace', message, context); }
    public fatal(message: string, context?: LogContext) { this.log('fatal', message, context); }
    public critical(message: string, context?: LogContext) { this.log('critical', message, context); }


    // --- Core Log Capture Logic ---
    private async captureLog(level: LogLevel, args: any[], additionalContext: LogContext = {}) {
        // 1. Filter by log level
        const levelOrder: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'critical'];
        if (levelOrder.indexOf(level) < levelOrder.indexOf(this.config.logLevel)) {
            return;
        }

        // 2. Apply Client-Side Sampling
        const samplingRate = this.config.samplingRates[level] ?? 1.0; // Default to 1.0 if not specified
        if (Math.random() > samplingRate) {
            // console.log(`LogCollector: Log for level '${level}' skipped due to sampling (${samplingRate * 100}% rate).`);
            return;
        }

        // 3. Apply Local Rate Limiting
        if (this.config.maxLogsPerMinute > 0) {
            const now = new Date();
            const currentMinuteKey = now.getFullYear() * 100000000 + (now.getMonth() + 1) * 1000000 + now.getDate() * 10000 + now.getHours() * 100 + now.getMinutes();

            if (this.currentMinute !== currentMinuteKey) {
                // Reset counts for a new minute
                this.logCounts = {};
                this.currentMinute = currentMinuteKey;
            }

            this.logCounts[currentMinuteKey] = (this.logCounts[currentMinuteKey] || 0) + 1;

            if (this.logCounts[currentMinuteKey] > this.config.maxLogsPerMinute) {
                console.warn(`LogCollector: Log for level '${level}' skipped due to rate limiting (${this.config.maxLogsPerMinute} logs/min).`);
                return;
            }
        }

        const message = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        let logEntry: LogEntry = {
            level: level,
            message: message,
            timestamp: new Date().toISOString(),
            service: 'frontend-app',
            context: additionalContext,
            globalContext: this.config.getGlobalContext(),
            userContext: this.config.getUserContext(),
            device: this.getDeviceInfo(), // Now includes more data
            breadcrumbs: [...this._breadcrumbs],
        };

        // Assign UUID if IndexedDB is enabled for better tracking and deletion
        if (this.indexedDBStore && !logEntry.id) {
            logEntry.id = generateUUID();
        }

        if (this.config.beforeSend) {
            if (this.config.maskFields.length > 0) {
                logEntry = this.maskSensitiveFields(logEntry, this.config.maskFields);
            }

            const modifiedLogEntry = this.config.beforeSend(logEntry);
            if (!modifiedLogEntry) {
                return;
            }
            logEntry = modifiedLogEntry;
        }

        this.logQueue.push(logEntry);

        if (this.indexedDBStore) {
            try {
                // If using IndexedDB, directly add to it for robust persistence.
                // The queue can remain a temporary buffer for logs not yet written to IDB.
                // For simplicity here, we'll try to add directly and then clear the queue.
                // In a high-volume scenario, you might want to debounce the IndexedDB writes too.
                const logsToPersist = [...this.logQueue];
                this.logQueue = []; // Clear in-memory queue after attempting to persist

                await Promise.all(logsToPersist.map(log => this.indexedDBStore!.addLog(log)));
            } catch (e) {
                console.error('LogCollector: Failed to persist log to IndexedDB. Re-queuing to memory and falling back to LocalStorage if enabled.', e);
                this.logQueue.unshift(...this.logQueue); // Re-add failed logs to queue
                if (this.localStorageStore) {
                    this.saveLogsToLocalStorage(); // Try local storage as a fallback
                }
            }
        } else if (this.localStorageStore) {
            this.saveLogsToLocalStorage();
        }

        this.processQueue();
    }

    private maskSensitiveFields(obj: any, fieldsToMask: string[]): any {
        const maskedObj = JSON.parse(JSON.stringify(obj));

        const traverseAndMask = (current: any) => {
            if (typeof current !== 'object' || current === null) {
                return;
            }
            for (const key in current) {
                if (Object.prototype.hasOwnProperty.call(current, key)) {
                    if (fieldsToMask.includes(key)) {
                        current[key] = '********';
                    } else if (typeof current[key] === 'object') {
                        traverseAndMask(current[key]);
                    }
                }
            }
        };
        traverseAndMask(maskedObj);
        return maskedObj;
    }

    // --- Batching & Persistence ---
    private startBatchTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.flushQueue();
            this.startBatchTimer();
        }, this.config.batchInterval);
    }

    private processQueue() {
        if (this.indexedDBStore) {
            // When IndexedDB is enabled, flush based on interval or if a certain number of logs are accumulated in DB
            // We'll rely more on the batchInterval for flushing from IndexedDB.
            // This condition ensures immediate flush if queue (which acts as a temporary buffer before IDB) gets too big,
            // or if no IndexedDB, then batchSize applies to in-memory queue.
            if (this.logQueue.length >= this.config.batchSize) {
                this.flushQueue();
            }
        } else if (this.logQueue.length >= this.config.batchSize) {
            this.flushQueue();
        }
    }

    private saveLogsToLocalStorage() {
        if (this.localStorageStore) {
            try {
                // Ensure logs have IDs before saving to localStorage if indexedDB is not primary
                this.logQueue.forEach(log => {
                    if (!log.id) {
                        log.id = generateUUID();
                    }
                });

                const serializedLogs = JSON.stringify(this.logQueue);
                if (serializedLogs.length < this.config.maxLocalStorageSize) {
                    this.localStorageStore.setItem(this.config.localStorageKey, serializedLogs);
                } else {
                    console.warn('LogCollector: LocalStorage limit reached, not all logs saved.');
                }
            } catch (e) {
                console.error('LogCollector: Error saving to LocalStorage', e);
                this.localStorageStore.removeItem(this.config.localStorageKey);
            }
        }
    }

    private loadLogsFromLocalStorage() {
        if (this.localStorageStore) {
            try {
                const storedLogs = this.localStorageStore.getItem(this.config.localStorageKey);
                if (storedLogs) {
                    const parsedLogs = JSON.parse(storedLogs);
                    if (Array.isArray(parsedLogs)) {
                        this.logQueue.unshift(...parsedLogs);
                        this.localStorageStore.removeItem(this.config.localStorageKey);
                        console.log(`LogCollector: Loaded ${parsedLogs.length} logs from LocalStorage.`);
                    }
                }
            } catch (e) {
                console.error('LogCollector: Error loading from LocalStorage', e);
                this.localStorageStore.removeItem(this.config.localStorageKey);
            }
        }
    }

    private async loadLogsFromPersistence() {
        if (this.indexedDBStore) {
            try {
                const storedLogs = await this.indexedDBStore.getAllLogs();
                if (storedLogs.length > 0) {
                    this.logQueue.unshift(...storedLogs);
                    console.log(`LogCollector: Loaded ${storedLogs.length} logs from IndexedDB.`);
                }
            } catch (e) {
                console.error('LogCollector: Error loading logs from IndexedDB. Falling back to LocalStorage if enabled.', e);
                if (this.localStorageStore) {
                    this.loadLogsFromLocalStorage();
                }
            }
        }
    }

    // --- Sending Logs (Flush) ---
    private async flushQueue(retries = 0, isUnload = false) {
        if (this.isSending || this.circuitOpen || !this.config.dsn) {
            return;
        }

        let logsToSend: LogEntry[] = [];
        let logsIdsToDelete: string[] = []; // Changed to string[]

        this.isSending = true;

        if (this.indexedDBStore) {
            // Get logs from IndexedDB. We fetch all but only send up to batchSize.
            // This ensures we're always pulling from the persisted source.
            const allStoredLogs = await this.indexedDBStore.getAllLogs().catch(() => []);
            logsToSend = allStoredLogs.slice(0, this.config.batchSize);
            logsIdsToDelete = logsToSend.map(log => log.id).filter((id): id is string => id !== undefined); // Ensure ID is a string

        } else {
            // If no IndexedDB, operate purely on the in-memory queue.
            logsToSend = this.logQueue.splice(0, this.config.batchSize);
        }

        if (logsToSend.length === 0) {
            this.isSending = false;
            return;
        }

        const payload = JSON.stringify(logsToSend);
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            'X-Request-Timestamp': new Date().toISOString()
        };
        if (this.config.apiKey) {
            (headers as Record<string, string>)['X-Api-Key'] = this.config.apiKey;
        }

        try {
            let success = false;
            if (isUnload && navigator.sendBeacon && payload.length < 60 * 1024) {
                success = navigator.sendBeacon(this.config.dsn, payload);
                if (success) {
                    console.log('LogCollector: Logs sent via navigator.sendBeacon.');
                } else {
                    console.warn('LogCollector: navigator.sendBeacon failed to queue data. Falling back to fetch.');
                }
            }

            if (!success) {
                try {
                    const response = await this.originalFetch?.call(window, this.config.dsn, {
                        method: 'POST',
                        headers: headers,
                        body: payload,
                        keepalive: isUnload,
                        credentials: 'omit'
                    });

                    console.log(response, "logsToSendlogsToSendlogsToSendlogsToSend")
                    if (response && !response?.ok) {
                        const errorText = await response?.text();
                        console.log(response, "the fucking response")
                        console.error(`LogCollector: Failed to send logs: ${response?.status} ${response?.statusText} - ${errorText}`);
                        this.handleSendFailure(logsToSend, retries, new Error(`HTTP ${response?.status}: ${errorText}`), logsIdsToDelete);
                    } else {
                        console.log('LogCollector: Logs sent successfully via fetch.');
                        this.handleSendSuccess(logsToSend, logsIdsToDelete);
                    }
                } catch (error) {
                    console.log(error, "the fucking >>>>>>>>>>>>>>")
                }
            } else {
                this.handleSendSuccess(logsToSend, logsIdsToDelete);
            }
        } catch (error: any) {
            console.error('LogCollector: Network error sending logs:', error);
            this.handleSendFailure(logsToSend, retries, error, logsIdsToDelete);
        } finally {
            this.isSending = false;
            // After attempting to send, regardless of success/failure, check if there are more logs to process.
            // This is crucial for keeping the queue moving, especially with IndexedDB where logs are loaded from DB.
            if (this.indexedDBStore && logsToSend.length > 0) {
                // If using IndexedDB and we just processed some, trigger another flush to grab the next batch from DB
                this.processQueue();
            } else if (!this.indexedDBStore && this.logQueue.length > 0) {
                // If not using IndexedDB, continue processing the in-memory queue.
                this.processQueue();
            }
        }
    }

    private async handleSendSuccess(logsSent: LogEntry[], idsToDelete: string[]) { // Changed idsToDelete type to string[]
        this.consecutiveFailures = 0;
        this.closeCircuit();
        this.config.onSendSuccess(logsSent);

        if (this.indexedDBStore) {
            if (idsToDelete.length > 0) {
                await this.indexedDBStore.deleteLogs(idsToDelete).catch(e =>
                    console.error('LogCollector: Error clearing successfully sent logs from IndexedDB:', e)
                );
            }
        } else if (this.localStorageStore) {
            // When using localStorage, we clear the entire key upon a successful send,
            // as it's a simple overwrite, not individual log deletion.
            this.localStorageStore.removeItem(this.config.localStorageKey);
        }
    }

    private async handleSendFailure(logsFailed: LogEntry[], retries: number, error: any, originalIds: string[]) { // Changed originalIds type to string[]
        this.consecutiveFailures++;
        this.config.onSendFailure(error, logsFailed);
        console.log("-------------------------------")

        if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
            this.openCircuit();
            console.error('LogCollector: Circuit breaker opened due to too many failures.');
        } else {
            if (retries < this.config.maxRetries) {
                const delay = this.config.retryDelayMs * Math.pow(2, retries) + Math.random() * 100;
                console.warn(`LogCollector: Retrying in ${delay}ms (attempt ${retries + 1}/${this.config.maxRetries})`);
                setTimeout(() => this.flushQueue(retries + 1), delay);
            } else {
                console.error('LogCollector: Max retries reached for batch. Logs will remain in persistence until next successful flush attempt.');
                // Logs remain in IndexedDB. If no IndexedDB, they are effectively "dropped" from in-memory queue
                // unless new logs come in before local storage is overwritten.
                // If using localStorage, failed logs implicitly remain in localStorage until a successful flush overwrites it.
            }
        }
    }

    // --- Circuit Breaker Logic ---
    private openCircuit() {
        this.circuitOpen = true;
        if (this.circuitResetTimer) {
            clearTimeout(this.circuitResetTimer);
        }
        this.circuitResetTimer = setTimeout(() => {
            this.circuitOpen = false;
            this.consecutiveFailures = 0;
            console.log('LogCollector: Circuit breaker moved to half-open state. Attempting flush.');
            this.flushQueue();
        }, this.CIRCUIT_BREAKER_RESET_DELAY);
    }

    private closeCircuit() {
        this.circuitOpen = false;
        this.consecutiveFailures = 0;
        if (this.circuitResetTimer) {
            clearTimeout(this.circuitResetTimer);
            this.circuitResetTimer = null;
        }
    }

    // --- Rate Limiter Initialization ---
    private initRateLimiter() {
        this.currentMinute = new Date().getFullYear() * 100000000 + (new Date().getMonth() + 1) * 1000000 + new Date().getDate() * 10000 + new Date().getHours() * 100 + new Date().getMinutes();
        this.logCounts[this.currentMinute] = 0;

        // Schedule a timer to clear old minute counts
        // This will run every minute to keep logCounts fresh
        this.rateLimitTimer = setInterval(() => {
            const now = new Date();
            const newMinuteKey = now.getFullYear() * 100000000 + (now.getMonth() + 1) * 1000000 + now.getDate() * 10000 + now.getHours() * 100 + now.getMinutes();

            // Clear any minute keys older than the current one
            for (const key in this.logCounts) {
                if (parseInt(key) < newMinuteKey) {
                    delete this.logCounts[key];
                }
            }
            // Ensure current minute key exists
            if (this.logCounts[newMinuteKey] === undefined) {
                this.logCounts[newMinuteKey] = 0;
            }
            this.currentMinute = newMinuteKey;
        }, 60 * 1000); // Run every minute
    }
}