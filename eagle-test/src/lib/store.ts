import { LogEntry } from './types'; // Assuming types.ts is in the same directory

interface DBConfig {
    dbName: string;
    storeName: string;
    version: number;
}

// Simple UUID generator (for demonstration, consider a robust library for production)
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0,
            v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * A Promise-based wrapper for IndexedDB operations,
 * specifically tailored for storing and retrieving log entries.
 */
export class IndexedDBStore {
    private db: IDBDatabase | null = null;
    private config: DBConfig = {dbName: "", storeName: "", version: 0};
    private dbOpenPromise: Promise<IDBDatabase> | null = null;

    constructor(dbName: string, storeName: string, version: number = 1) {
        if (!window.indexedDB) {
            console.warn("IndexedDB not supported in this browser. Persistence will be disabled.");
            return;
        }
        this.config = { dbName, storeName, version };
    }

    /**
     * Opens the IndexedDB connection. Handles database creation and upgrades.
     * Returns a promise that resolves with the IDBDatabase instance.
     */
    private async openDb(): Promise<IDBDatabase> {
        if (this.db) {
            return this.db;
        }
        if (this.dbOpenPromise) {
            return this.dbOpenPromise; // Return existing promise if already opening
        }

        this.dbOpenPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.config.dbName, this.config.version);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.config.storeName)) {
                    // Create object store if it doesn't exist.
                    // 'id' is the primary key, NO autoIncrement.
                    db.createObjectStore(this.config.storeName, { keyPath: 'id' }); // Removed autoIncrement
                    console.log(`IndexedDB: Object store '${this.config.storeName}' created or upgraded.`);
                }
                // Future versions could add more object stores or indexes here.
                // Example for adding an index if we later wanted to query by timestamp:
                // if (!store.indexNames.contains('timestamp')) {
                //    store.createIndex('timestamp', 'timestamp', { unique: false });
                // }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                console.log(`IndexedDB: Database '${this.config.dbName}' opened successfully (version ${this.db.version}).`);
                resolve(this.db);
                this.dbOpenPromise = null; // Clear the promise once resolved
            };

            request.onerror = (event) => {
                const error = (event.target as IDBRequest).error;
                console.error('IndexedDB: Error opening database:', error);
                this.dbOpenPromise = null; // Clear the promise on error
                reject(error);
            };

            request.onblocked = (event) => {
                // This event fires if a database connection is blocking an upgrade.
                // For a logger, we might just warn or wait. For critical apps, user intervention might be needed.
                console.warn('IndexedDB: Database upgrade blocked. Please close other tabs with this application.');
            };
        });
        return this.dbOpenPromise;
    }

    /**
     * Adds a single log entry to the object store.
     * @param log The log entry to add.
     * @returns A Promise that resolves when the log is added, or rejects on error.
     */
    async addLog(log: LogEntry): Promise<void> {
        if (!this.db) {
            await this.openDb(); // Ensure DB is open before trying to add
            if (!this.db) {
                console.error("IndexedDB: Database not available to add log.");
                return; // Cannot proceed if DB fails to open
            }
        }

        // Assign a UUID if the log doesn't already have one
        if (!log.id) {
            log.id = generateUUID();
        }

        return new Promise((resolve, reject) => {
            // Use 'readwrite' transaction to add data
            const transaction = this.db!.transaction([this.config.storeName], 'readwrite');
            const store = transaction.objectStore(this.config.storeName);
            const request = store.add(log); // Add the log entry. Now 'id' is expected to be present.

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error('IndexedDB: Error adding log:', (event.target as IDBRequest).error);
                reject((event.target as IDBRequest).error);
            };

            // Important: Handle transaction completion/errors
            transaction.oncomplete = () => { /* console.log('IndexedDB: Add transaction complete.'); */ };
            transaction.onerror = (event) => {
                console.error('IndexedDB: Transaction error during add:', (event.target as IDBTransaction).error);
                reject((event.target as IDBTransaction).error);
            };
            transaction.onabort = () => {
                console.warn('IndexedDB: Add transaction aborted.');
                reject(new Error('Transaction aborted'));
            };
        });
    }

    /**
     * Retrieves all log entries from the object store.
     * @returns A Promise that resolves with an array of LogEntry.
     */
    async getAllLogs(): Promise<LogEntry[]> {
        if (!this.db) {
            await this.openDb();
            if (!this.db) {
                console.error("IndexedDB: Database not available to get all logs.");
                return [];
            }
        }

        return new Promise((resolve, reject) => {
            // Use 'readonly' transaction to retrieve data
            const transaction = this.db!.transaction([this.config.storeName], 'readonly');
            const store = transaction.objectStore(this.config.storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => {
                console.error('IndexedDB: Error getting all logs:', (event.target as IDBRequest).error);
                reject((event.target as IDBRequest).error);
            };
            transaction.onerror = (event) => {
                console.error('IndexedDB: Transaction error during getAll:', (event.target as IDBTransaction).error);
                reject((event.target as IDBTransaction).error);
            };
            transaction.onabort = () => {
                console.warn('IndexedDB: GetAll transaction aborted.');
                reject(new Error('Transaction aborted'));
            };
        });
    }

    /**
     * Clears all log entries from the object store.
     * @returns A Promise that resolves when the store is cleared.
     */
    async clearLogs(): Promise<void> {
        if (!this.db) {
            await this.openDb();
            if (!this.db) {
                console.error("IndexedDB: Database not available to clear logs.");
                return;
            }
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.config.storeName], 'readwrite');
            const store = transaction.objectStore(this.config.storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error('IndexedDB: Error clearing logs:', (event.target as IDBRequest).error);
                reject((event.target as IDBRequest).error);
            };
            transaction.onerror = (event) => {
                console.error('IndexedDB: Transaction error during clear:', (event.target as IDBTransaction).error);
                reject((event.target as IDBTransaction).error);
            };
            transaction.onabort = () => {
                console.warn('IndexedDB: Clear transaction aborted.');
                reject(new Error('Transaction aborted'));
            };
        });
    }

    /**
     * Deletes specific log entries by their IDs.
     * Useful after a successful send to remove only the sent logs.
     * @param ids An array of IDs of logs to delete.
     * @returns A Promise that resolves when the logs are deleted.
     */
    async deleteLogs(ids: string[]): Promise<void> { // Changed ids type to string[]
        if (!ids || ids.length === 0) {
            return Promise.resolve();
        }

        if (!this.db) {
            await this.openDb();
            if (!this.db) {
                console.error("IndexedDB: Database not available to delete logs.");
                return;
            }
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.config.storeName], 'readwrite');
            const store = transaction.objectStore(this.config.storeName);

            let outstandingDeletes = ids.length;
            const checkCompletion = () => {
                outstandingDeletes--;
                if (outstandingDeletes === 0) {
                    resolve();
                }
            };

            for (const id of ids) {
                const request = store.delete(id);
                request.onsuccess = checkCompletion;
                request.onerror = (event) => {
                    console.error(`IndexedDB: Error deleting log with ID ${id}:`, (event.target as IDBRequest).error);
                    // Don't reject the whole transaction if one delete fails, just log it.
                    // This allows other deletes to complete.
                    checkCompletion(); // Still count as processed, even if failed.
                };
            }

            transaction.oncomplete = () => resolve(); // Resolves once all requests in transaction complete
            transaction.onerror = (event) => {
                console.error('IndexedDB: Transaction error during delete:', (event.target as IDBTransaction).error);
                reject((event.target as IDBTransaction).error);
            };
            transaction.onabort = () => {
                console.warn('IndexedDB: Delete transaction aborted.');
                reject(new Error('Transaction aborted'));
            };
        });
    }
}