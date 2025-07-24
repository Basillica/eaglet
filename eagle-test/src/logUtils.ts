import { LogEntry, LogLevel, BreadcrumbType } from "./lib/types";

export interface LogContext {
    [key: string]: any;
}

export const LOG_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'critical'];
export const SERVICES = ['frontend-app', 'backend-api', 'auth-service', 'payment-gateway', 'reporting-service'];

export function getRandomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Generates a single mock log entry.
 * @returns {LogEntry} A mock LogEntry object.
 */
export function generateMockLog(): LogEntry {
    const level = getRandomElement(LOG_LEVELS);
    const service = getRandomElement(SERVICES);
    const timestamp = new Date().toISOString();
    const id = generateUUID();

    let message: string;
    let error_name = null;
    let stack = null;
    let reason = null;
    let request_method = null;
    let request_url = null;
    let status_code = null;
    let status_text = null;
    let error_message = null;

    switch (level) {
        case 'critical':
            message = `Critical system failure in ${service}! Database connection lost.`;
            error_name = 'DatabaseConnectionError';
            stack = 'at db.js:100\n at server.js:50\n at app.js:10';
            reason = { code: 500, detail: 'Failed to acquire DB lock' };
            request_method = 'POST';
            request_url = '/api/transactions';
            status_code = 500;
            status_text = 'Internal Server Error';
            error_message = 'Failed to process transaction due to database issues.';
            break;
        case 'fatal':
            message = `Application crashed due to unhandled exception in ${service}.`;
            error_name = 'UnhandledException';
            stack = 'at process.js:20\n at main.js:10';
            reason = { type: 'memory_leak', detail: 'Out of memory' };
            break;
        case 'error':
            message = `Failed to process request for user ${generateUUID()} on ${service}.`;
            error_name = 'BadRequestError';
            stack = 'at userController.js:45\n at routeHandler.js:20';
            request_method = 'GET';
            request_url = '/api/users/profile';
            status_code = getRandomElement([400, 401, 403, 404, 500, 503]);
            status_text = status_code === 400 ? 'Bad Request' : 'Service Unavailable';
            error_message = 'Invalid input parameters for user profile.';
            break;
        case 'warn':
            message = `Deprecated API endpoint accessed in ${service}.`;
            break;
        case 'info':
            message = `User ${generateUUID()} logged in to ${service}.`;
            break;
        case 'debug':
            message = `Processing request for path /data in ${service}.`;
            break;
        case 'trace':
            message = `Entering function 'calculatePrice' in ${service}.`;
            break;
        default:
            message = `Unknown log level: ${level}`;
    }

    const hasUser = Math.random() > 0.3; // 70% chance of having user info
    const userId = hasUser ? generateUUID() : undefined;
    const username = hasUser ? `user_${Math.random().toString(36).substring(7)}` : undefined;
    const email = hasUser ? `${username}@example.com` : undefined;

    const hasDevice = Math.random() > 0.5; // 50% chance of having device info
    const os_names = ['Windows', 'macOS', 'Linux', 'iOS', 'Android'];
    const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge'];
    const device_info = hasDevice ? {
        os_name: getRandomElement(os_names),
        os_version: `${Math.floor(Math.random() * 10) + 10}.${Math.floor(Math.random() * 5)}`,
        brand: getRandomElement(['Apple', 'Samsung', 'Dell', 'HP', 'Google']),
        model: getRandomElement(['Pro', 'Air', 'Galaxy S20', 'Pixel 6', 'XPS']),
        user_agent: `Mozilla/5.0 (${getRandomElement(os_names)}) AppleWebKit/537.36 (KHTML, like Gecko) ${getRandomElement(browsers)}/100.0.1234.56 Chrome/100.0.0.0 Safari/537.36`
    } : undefined;

    const hasBreadcrumbs = Math.random() > 0.4; // 60% chance of having breadcrumbs
    const breadcrumbs = hasBreadcrumbs ? [
        { timestamp: new Date(new Date().getTime() - 5000).toISOString(), type: 'navigation' as BreadcrumbType, message: 'User navigated to /dashboard' },
        { timestamp: new Date(new Date().getTime() - 2000).toISOString(), type: 'click' as BreadcrumbType, message: 'Clicked "Save" button', data: { element: 'save-btn' } }
    ] : undefined;


    return {
        id,
        level,
        message,
        timestamp,
        service,
        context: {
            component: "DashboardComponent",
            sessionId: "abc-123-xyz",
            userId: userId
        },
        globalContext: {
            environment: "development",
            appVersion: "1.0.0"
        },
        userContext: hasUser ? {
            country: "US",
            deviceType: device_info?.os_name === 'iOS' || device_info?.os_name === 'Android' ? 'mobile' : 'desktop'
        } : null,
        user: hasUser ? { id: userId, username, email } : undefined,
        device: device_info,
        breadcrumbs: breadcrumbs,
        errorName: error_name,
        stack: stack,
        reason: reason,
        requestMethod: request_method,
        requestUrl: request_url,
        statusCode: status_code,
        statusText: status_text,
        durationMs: Math.random() > 0.5 ? Math.floor(Math.random() * 1000) : undefined,
        responseSize: Math.random() > 0.5 ? Math.floor(Math.random() * 1024 * 10) : undefined,
        errorMessage: error_message,
    };
}

export function getLevelColorClass(level: LogLevel): string {
    return `log-${level}`;
}