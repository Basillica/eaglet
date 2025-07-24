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
export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0,
            v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}