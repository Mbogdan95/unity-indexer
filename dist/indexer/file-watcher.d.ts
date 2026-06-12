import type { Indexer } from "./indexer.js";
export declare class FileWatcher {
    private indexer;
    private projectRoot;
    private debounceMs;
    private bulkThreshold;
    private bulkWindowMs;
    private watcher;
    private pendingChanges;
    private debounceTimer;
    private bulkTimer;
    private bulkCount;
    constructor(indexer: Indexer, projectRoot: string, debounceMs?: number, bulkThreshold?: number, bulkWindowMs?: number);
    start(): void;
    stop(): void;
    private onFileEvent;
    private flush;
    private handleBulkChange;
}
